"""영업 비서(#680)가 외부 AI에 보내는 "정해진 조회" 결과를 글로 만드는 한 곳 (계약 C1·C4).

AI는 DB를 읽지 않는다. 여기서 이미 있는 계산(영업 분석표·대시보드 일정·비슷한 회사·세부 단계)을
불러 그 결과를 글로 바꾸고, AI는 그 글만으로 답한다. 읽기만 하고 아무것도 저장하지 않는다.

**고른 값만 싣는다.** 글에 들어가는 것: 회사 이름, 확정된 공정·산업, 관심 여부, 영업 큰 단계·세부
단계, 접촉 날짜·방법·결과, 거절 이유의 쉬운 말, 꼬리 질문에서 고른 답(질문 글·보기 이름), 다음 일정
날짜, 그 값들로 센 건수, 같이 들를 곳의 직선거리(km)·지도 묶음 이름(#743 — 대시보드 지도 함수가
좌표로 잰 값만 받고 좌표는 싣지 않는다). **자유 글은 하나도 싣지 않는다**: 영업 메모(rec_note),
접촉의 한 줄 메모(memo), 다음 일정의 할 일 글(next_schedule_note), 결과 사유 글(reason),
검토 의견의 메모·사유, 비슷한 회사의 마지막 메모. 대표번호·주소·담당자 키·점수도 싣지 않는다
(PM 결정 2026-11-14: 이름 지우기가 직함 없는 이름을 놓친다). 이 파일은 그 칸들을 읽는 코드를
두지 않아 그 약속을 지킨다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.api.routes.peers import peers as peers_view
from geosan.api.routes.records import (
    LOST_REASON_LABELS,
    choice_catalog,
    sales_questions,
    sales_step_state,
)
from geosan.api.routes.sales_analysis import sales_analysis as sales_analysis_view
from geosan.config.sales_questions import KST
from geosan.dashboard.map_points import build_map_points, build_visit_groups
from geosan.dashboard.queries import (
    METHOD_LABELS,
    RESULT_LABELS,
    SCHEDULE_WINDOW_DAYS,
    STAGE_LABELS,
    dashboard_population,
    schedule_due_outcomes,
)
from geosan.dashboard.sales_analysis import CONFIRMED_INDUSTRY_SOURCES, LINK_CONFIRMED
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Outcome, OutcomeAnswer
from geosan.storage.base import utcnow

QUERY_COMPANY_LIST = "COMPANY_LIST"
QUERY_COMPANY_SUMMARY = "COMPANY_SUMMARY"
QUERY_SALES_ANALYSIS = "SALES_ANALYSIS"
QUERY_SCHEDULE = "SCHEDULE"
QUERY_LOST_REASONS = "LOST_REASONS"
QUERY_PEERS = "PEERS"

_NONE = "없음"
_NO_STAGE = "NOT_EXECUTED"
_CLOSED = ("WON", "LOST")
_WEEKDAYS = "월화수목금토일"
_STEP_NOT_STARTED = "접촉 전"
_STEP_ENDED = "해당 없음"
_ON_HOLD = "ON_HOLD"
# 대시보드 지도(#642·#673)의 묶음 이름. 화면 이름표(web labels `groups`)와 같은 말이다.
MAP_GROUP_LABELS = {"INTERESTED": "관심", "IN_PROGRESS": "진행 중", "WON_THIS_YEAR": "올해 성공"}


@dataclass(frozen=True)
class CompanyRef:
    """조회 글에 실린 회사 하나. 답의 근거 링크(sources)는 이 목록에서만 고른다."""

    opp_id: str
    name: str


@dataclass(frozen=True)
class AssistantContext:
    text: str
    companies: tuple[CompanyRef, ...]
    total_companies: int
    used_queries: tuple[str, ...]


@dataclass
class _Company:
    """회사 하나의 고른 값. 자유 글 칸은 이 모양에 없다."""

    opp_id: str
    name: str
    processes: list[str]
    industries: list[str]
    bookmarked: bool = False
    status: str = _NO_STAGE
    step: str | None = None
    lost_reason: str | None = None
    next_schedule: date | None = None
    contacts: list[tuple[date, str, str]] = field(default_factory=list)  # 날짜·방법·결과
    answers: list[tuple[date, str, str]] = field(default_factory=list)  # 날짜·질문 글·보기 이름


def _day_label(day: date) -> str:
    return f"{day.isoformat()}({_WEEKDAYS[day.weekday()]})"


def _names(values: Sequence[str]) -> str:
    return "·".join(values) if values else "확인 전"


def _load_companies(session: Session, opp_ids: Sequence[str], analysis_rows=()) -> list[_Company]:
    """회사들의 고른 값을 읽는다. 순서는 받은 opp_ids 그대로.

    접촉 기록이 있는 회사의 확정 공정·산업·세부 단계는 영업 분석표가 계산한 줄(analysis_rows)을
    그대로 쓰고, 나머지 회사는 같은 기준(확정된 연결·확정된 산업군)으로 읽는다.
    """
    if not opp_ids:
        return []
    catalog = choice_catalog(session)
    questions = sales_questions(session)
    analysed = {row.opp_id: row for row in analysis_rows}
    companies: dict[str, _Company] = {}
    for opp_id, name, industries, source in session.execute(
        select(Opportunity.opp_id, Customer.name, Customer.industries, Customer.industries_source)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(Opportunity.opp_id.in_(opp_ids))
    ):
        confirmed = list(industries or []) if source in CONFIRMED_INDUSTRY_SOURCES else []
        companies[opp_id] = _Company(opp_id, name, [], confirmed)
    codes: dict[str, set[str]] = {}
    for opp_id, code in session.execute(
        select(OppProcessLink.opp_id, OppProcessLink.process_code)
        .where(
            OppProcessLink.opp_id.in_(opp_ids),
            OppProcessLink.superseded_at.is_(None),
            OppProcessLink.state == LINK_CONFIRMED,
        )
        .distinct()
    ):
        codes.setdefault(opp_id, set()).add(code)
    for opp_id, company in companies.items():
        row = analysed.get(opp_id)
        process_codes = row.process_codes if row else sorted(codes.get(opp_id, set()))
        # 공정 목록에 없는 코드는 이름을 모르므로 싣지 않는다(코드값을 그대로 내보내지 않는다).
        company.processes = [
            catalog["PROCESS"][code] for code in process_codes if code in catalog["PROCESS"]
        ]
        if row:
            company.industries = list(row.industries)
            company.step = row.sales_step.value if row.sales_step else None
    # 취소된 기록은 뺀다(#253). 여기서 읽는 칸은 코드값·날짜뿐이다 — 글 칸(memo·reason·
    # next_schedule_note)은 읽지 않는다.
    outcome_days: dict[str, date] = {}
    for (
        outcome_id,
        opp_id,
        status,
        method,
        result,
        attempted_at,
        created_at,
        reason,
        due,
    ) in session.execute(
        select(
            Outcome.outcome_id,
            Outcome.opp_id,
            Outcome.status,
            Outcome.method,
            Outcome.result,
            Outcome.attempted_at,
            Outcome.created_at,
            Outcome.lost_reason_code,
            Outcome.next_schedule_at,
        )
        .where(Outcome.opp_id.in_(opp_ids), Outcome.cancelled_at.is_(None))
        .order_by(Outcome.opp_id, Outcome.version)
    ):
        company = companies[opp_id]
        day = attempted_at or created_at.astimezone(KST).date()
        outcome_days[outcome_id] = day
        # 마지막 행이 지금 값이다.
        company.status = status
        company.lost_reason = reason if status == "LOST" else None
        company.next_schedule = due if status not in _CLOSED else None
        if method in METHOD_LABELS:
            company.contacts.append((day, method, result or ""))
    for outcome_id, opp_id, question_id, answer_id in session.execute(
        select(
            OutcomeAnswer.outcome_id,
            OutcomeAnswer.opp_id,
            OutcomeAnswer.question_id,
            OutcomeAnswer.answer_id,
        )
        .where(OutcomeAnswer.opp_id.in_(opp_ids))
        .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
    ):
        question = questions.question(question_id)
        if outcome_id not in outcome_days or question is None:
            continue  # 취소한 접촉의 답·지금 질문 파일에 없는 질문은 싣지 않는다.
        if question.choices:
            label = catalog[question.choices].get(answer_id)
        else:
            option = question.option(answer_id)
            label = option.label if option else None
        if label is not None:
            companies[opp_id].answers.append((outcome_days[outcome_id], question.text, label))
    return [companies[opp_id] for opp_id in opp_ids if opp_id in companies]


def _step_labels(session: Session) -> dict[str, str]:
    return {entry.code.value: entry.label for entry in sales_questions(session).steps}


def _step_label(company: _Company, steps: dict[str, str]) -> str:
    """세부 단계의 쉬운 말. 끝난 영업(성사·거절·보류)은 세부 단계가 없다(카드와 같은 계산)."""
    if company.step:
        return steps.get(company.step, company.step)
    return _STEP_NOT_STARTED if company.status == _NO_STAGE else _STEP_ENDED


def _table_line(company: _Company, steps: dict[str, str]) -> str:
    last = max((day for day, _, _ in company.contacts), default=None)
    return " | ".join(
        [
            company.name,
            _names(company.processes),
            _names(company.industries),
            "관심" if company.bookmarked else "관심 아님",
            STAGE_LABELS.get(company.status, company.status),
            _step_label(company, steps),
            f"{len(company.contacts)}회",
            last.isoformat() if last else _NONE,
            LOST_REASON_LABELS.get(company.lost_reason, _NONE) if company.lost_reason else _NONE,
            company.next_schedule.isoformat() if company.next_schedule else _NONE,
        ]
    )


_TABLE_HEAD = (
    "회사 | 확정 공정 | 확정 산업 | 관심 | 큰 단계 | 세부 단계 | 접촉 횟수 | 마지막 접촉 | "
    "거절 이유 | 다음 일정"
)


def _summary_lines(company: _Company) -> list[str]:
    lines = [f"■ {company.name}"]
    for day, method, result in company.contacts:
        outcome = RESULT_LABELS.get(result, "")
        lines.append(f"  - {day.isoformat()} {METHOD_LABELS[method]} {outcome}".rstrip())
    for day, question, answer in company.answers:
        lines.append(f"  - {day.isoformat()} 고른 답: {question} → {answer}")
    if len(lines) == 1:
        lines.append("  - 접촉 기록 없음")
    return lines


def _stats_line(label: str, stats) -> str:
    return (
        f"{label} | 접촉한 곳 {stats.contacted_count}곳 | 진행 중 {stats.in_progress_count}곳 | "
        f"보류 {stats.on_hold_count}곳 | 성사 {stats.won_count}곳 | 거절 {stats.lost_count}곳"
    )


def _reach_line(reach) -> str:
    return ", ".join(
        f"{METHOD_LABELS[code]} {count.tried}번 중 {count.reached}번 연결"
        for code, count in (("CALL", reach.call), ("EMAIL", reach.email), ("VISIT", reach.visit))
    )


@dataclass
class _Selection:
    """질문에 답하기·오늘 정리가 함께 쓰는 대상 회사(활성 묶음의 관심 회사 + 접촉한 회사)."""

    analysis: object
    population: object
    ordered: list[str]
    companies: list[_Company]
    by_id: dict[str, _Company]
    steps: dict[str, str]


def _select_companies(session: Session, max_companies: int) -> _Selection:
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind
    analysis = sales_analysis_view(session).data
    population = dashboard_population(dataset_kind.value)
    bookmarked = set(session.scalars(population))
    analysed = {row.opp_id for row in analysis.companies}
    names = dict(
        session.execute(
            select(Opportunity.opp_id, Customer.name)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(bookmarked | analysed))
        ).all()
    )
    # 관심 회사를 먼저, 그다음 이름순. 상한을 넘는 회사는 조회 글에 싣지 않는다.
    ordered = sorted(names, key=lambda opp_id: (opp_id not in bookmarked, names[opp_id], opp_id))
    companies = _load_companies(session, ordered[:max_companies], analysis.companies)
    for company in companies:
        company.bookmarked = company.opp_id in bookmarked
    return _Selection(
        analysis=analysis,
        population=population,
        ordered=ordered,
        companies=companies,
        by_id={company.opp_id: company for company in companies},
        steps=_step_labels(session),
    )


def _schedule_lines(
    session: Session, today: date, selection: _Selection
) -> tuple[list[str], list[str]]:
    """놓친 일정·오늘·앞으로 7일(대시보드와 같은 기준). 날짜와 회사 이름만. 실린 회사도 준다."""
    by_id = selection.by_id
    due = sorted(
        (row.next_schedule_at, by_id[row.opp_id].name, row.opp_id)
        for row in session.scalars(schedule_due_outcomes(today, selection.population))
        if row.opp_id in by_id
    )
    week_end = today + timedelta(days=SCHEDULE_WINDOW_DAYS)
    lines = []
    for label, picked in (
        ("놓친 일정", [item for item in due if item[0] < today]),
        ("오늘", [item for item in due if item[0] == today]),
        (f"앞으로 {SCHEDULE_WINDOW_DAYS}일", [item for item in due if today < item[0] <= week_end]),
    ):
        text = ", ".join(f"{_day_label(day)} {name}" for day, name, _ in picked) or _NONE
        lines.append(f"{label}: {text}")
    return lines, [opp_id for _, _, opp_id in due]


def _visit_lines(
    session: Session, now: datetime, by_id: dict[str, _Company], until: date | None = None
) -> tuple[list[str], list[str]]:
    """같이 들를 곳(#743): 대시보드 지도 "같이 들를 곳"(#673)과 같은 계산을 글로 바꾼다.

    반경은 설정 `visitGroupRadiusKm`, 중심은 진행 중·관심 회사, 근처는 관심 기업만이다(지도의
    함수를 그대로 부른다). 거리는 프로그램이 잰 직선거리다 — AI는 문장만 쓴다. 싣는 것은 회사
    이름·거리·지도 묶음 이름·다음 일정 날짜뿐이고 주소·좌표는 싣지 않는다. 조회 글에 실린 회사만
    쓴다. until이 있으면 다음 일정이 그날 이하인 중심 회사만 싣는다(오늘 정리).
    """
    settings = runtime_for(session).app_settings
    points, _missing = build_map_points(session, settings, now, tz=KST)
    group_of = {point["opp_id"]: point["group"] for point in points}
    picked = []
    for group in build_visit_groups(settings, points):
        anchor = by_id.get(group["opp_id"])
        nearby = [row for row in group["nearby"] if row["opp_id"] in by_id]
        if anchor is None or not nearby:
            continue
        due = anchor.next_schedule
        if until is not None and (due is None or due > until):
            continue
        picked.append((due is None, due or date.max, anchor.name, anchor, nearby))
    picked.sort(key=lambda item: item[:3])
    lines = [
        f"같이 들를 곳: 방문할 회사(진행 중·관심) 근처 {settings.visit_group_radius_km:g}km 안의 "
        "관심 기업. 거리는 그 회사에서 잰 직선거리"
    ]
    opp_ids = []
    for _, _, _, anchor, nearby in picked:
        day = _day_label(anchor.next_schedule) if anchor.next_schedule else "일정 없음"
        near = ", ".join(
            f"{by_id[row['opp_id']].name} {row['distance_km']}km({MAP_GROUP_LABELS[row['group']]})"
            for row in nearby
        )
        group_label = MAP_GROUP_LABELS[group_of[anchor.opp_id]]
        lines.append(f"- {day} {anchor.name}({group_label}) → {near}")
        opp_ids += [anchor.opp_id, *(row["opp_id"] for row in nearby)]
    if not picked:
        lines.append(_NONE)
    return lines, opp_ids


def build_ask_context(
    session: Session, today: date, max_companies: int, now: datetime | None = None
) -> AssistantContext:
    """질문에 답하기용 조회 5개. 대상은 활성 묶음뿐이다(영업 분석·대시보드와 같은 기준)."""
    selection = _select_companies(session, max_companies)
    analysis, ordered, companies = selection.analysis, selection.ordered, selection.companies
    steps = selection.steps

    lines = [f"오늘: {_day_label(today)}", ""]
    lines.append(
        f"[조회 1. 회사 목록] 관심 회사와 접촉 기록이 있는 회사 {len(ordered)}곳 가운데 "
        f"{len(companies)}곳"
    )
    lines.append(_TABLE_HEAD)
    lines += [_table_line(company, steps) for company in companies]

    lines += ["", "[조회 2. 회사 요약] 회사별 접촉 기록과 꼬리 질문에서 고른 답"]
    for company in companies:
        lines += _summary_lines(company)

    basis = analysis.basis
    lines += [
        "",
        f"[조회 3. 영업 분석표] 접촉 기록이 있는 회사 {basis.company_count}곳 기준. "
        f"성사·거절은 최근 {basis.closed_window_days}일 안의 것만 센다",
        _stats_line("합계", analysis.total),
        f"합계 방법별 연결: {_reach_line(analysis.total.contact_reach)}",
    ]
    for row in analysis.by_process:
        lines.append(_stats_line(f"공정 {row.process_name}", row))
    for row in analysis.by_sales_step:
        lines.append(
            f"세부 단계 {steps.get(row.step.value, row.step.value)} | 이 단계에서 접촉한 회사 "
            f"{row.contacted_count}곳 | 접촉 {row.contact_count}번 | 이 단계에 이른 회사 "
            f"{row.reached_count}곳"
        )

    lines += ["", f"[조회 4. 일정] 놓친 일정과 오늘부터 {SCHEDULE_WINDOW_DAYS}일 안의 일정"]
    lines += _schedule_lines(session, today, selection)[0]
    # #743: 일정 조회의 한 부분으로 근처 같이 들를 관심 기업을 싣는다(usedQueries 값은 그대로).
    lines += _visit_lines(session, now or utcnow(), selection.by_id)[0]

    lines += ["", "[조회 5. 거절 이유별 회사] 거절 이유 | 회사 | 확정 공정"]
    lost = [company for company in companies if company.status == "LOST"]
    for company in lost:
        reason = LOST_REASON_LABELS.get(company.lost_reason, "이유 기록 없음")
        lines.append(f"{reason} | {company.name} | {_names(company.processes)}")
    if not lost:
        lines.append(_NONE)

    return AssistantContext(
        text="\n".join(lines),
        companies=tuple(CompanyRef(company.opp_id, company.name) for company in companies),
        total_companies=len(ordered),
        used_queries=(
            QUERY_COMPANY_LIST,
            QUERY_COMPANY_SUMMARY,
            QUERY_SALES_ANALYSIS,
            QUERY_SCHEDULE,
            QUERY_LOST_REASONS,
        ),
    )


# 앞으로 가는 순서(#743 PM 결정): 미접촉 → 접촉 → 견적·샘플. 보류·성사·거절은 이 줄 밖이다.
_FORWARD_ORDER = {_NO_STAGE: 0, "IN_PROGRESS": 1, "SAMPLE_OR_REGISTRATION_APPROVED": 2}


def _stage_moves(
    session: Session, opp_ids: Sequence[str], since: date
) -> list[tuple[date, str, str, str]]:
    """큰 단계가 앞으로 간 기록(취소한 기록 제외)을 저장 순서대로 본다. 코드값·날짜만 읽는다.

    뒤로 간 이동은 싣지 않는다(PM 결정 2026-11-14): 앞으로 가는 줄(미접촉 → 접촉 → 견적·샘플)에서
    그 회사가 이미 이른 단계 이하로 가는 이동(예: 접촉 → 미접촉, 그 뒤 다시 접촉)은 빼고, 보류·성사·
    거절로 바뀐 것은 싣는다. 잘못 입력으로 취소한 기록은 처음부터 보지 않는다.
    """
    moves = []
    previous: dict[str, str] = {}
    reached: dict[str, int] = {}
    for opp_id, status, attempted_at, created_at in session.execute(
        select(Outcome.opp_id, Outcome.status, Outcome.attempted_at, Outcome.created_at)
        .where(Outcome.opp_id.in_(opp_ids), Outcome.cancelled_at.is_(None))
        .order_by(Outcome.opp_id, Outcome.version)
    ):
        before = previous.get(opp_id, _NO_STAGE)
        previous[opp_id] = status
        if status == before:
            continue
        rank = _FORWARD_ORDER.get(status)
        if rank is not None:
            if rank <= reached.get(opp_id, 0):
                continue  # 뒤로 갔거나 이미 이른 단계로 되돌아온 것
            reached[opp_id] = rank
        day = attempted_at or created_at.astimezone(KST).date()
        if day >= since:
            moves.append((day, opp_id, before, status))
    return sorted(moves)


def build_daily_context(
    session: Session, today: date, now: datetime, max_companies: int
) -> AssistantContext:
    """오늘 정리(#743)용 조회 4개: 일정, 이번 주 일정 회사의 같이 들를 곳, 단계 이동, 막힌 회사.

    대상 회사는 질문에 답하기와 같다. 글에 실린 회사가 하나도 없으면 companies가 비어 있다
    (창구가 보내지 않는다).
    """
    selection = _select_companies(session, max_companies)
    by_id = selection.by_id
    mentioned: list[str] = []

    lines = [f"오늘: {_day_label(today)}", ""]
    lines.append(f"[조회 1. 일정] 놓친 일정과 오늘부터 {SCHEDULE_WINDOW_DAYS}일 안의 일정")
    schedule, opp_ids = _schedule_lines(session, today, selection)
    lines += schedule
    mentioned += opp_ids

    lines += ["", "[조회 2. 이번 주 일정이 있는 회사의 같이 들를 곳]"]
    until = today + timedelta(days=SCHEDULE_WINDOW_DAYS)
    visits, opp_ids = _visit_lines(session, now, by_id, until=until)
    lines += visits
    mentioned += opp_ids

    since = today - timedelta(days=SCHEDULE_WINDOW_DAYS)
    lines += [
        "",
        f"[조회 3. 지난 {SCHEDULE_WINDOW_DAYS}일 단계 이동] "
        "날짜 | 회사 | 이전 큰 단계 → 지금 큰 단계",
    ]
    moves = _stage_moves(session, list(by_id), since)
    for day, opp_id, before, after in moves:
        lines.append(
            f"{day.isoformat()} | {by_id[opp_id].name} | "
            f"{STAGE_LABELS.get(before, before)} → {STAGE_LABELS.get(after, after)}"
        )
        mentioned.append(opp_id)
    if not moves:
        lines.append(_NONE)

    lines += ["", "[조회 4. 막힌 회사] 지금 큰 단계가 보류인 회사 | 마지막 접촉"]
    held = [company for company in selection.companies if company.status == _ON_HOLD]
    for company in held:
        last = max((day for day, _, _ in company.contacts), default=None)
        lines.append(f"{company.name} | {last.isoformat() if last else _NONE}")
        mentioned.append(company.opp_id)
    if not held:
        lines.append(_NONE)

    refs = tuple(CompanyRef(opp_id, by_id[opp_id].name) for opp_id in dict.fromkeys(mentioned))
    return AssistantContext(
        text="\n".join(lines),
        companies=refs,
        total_companies=len(selection.ordered),
        used_queries=(),
    )


def build_call_prep_context(session: Session, opp_id: str, today: date) -> AssistantContext:
    """통화 준비용 조회 2개: 이 회사의 고른 값 + 비슷한 회사 건수 요약(/peers와 같은 계산).

    비슷한 회사의 마지막 메모 글과 확정 전 공정·산업 값은 싣지 않는다. 회사가 없으면 404다.
    """
    result = peers_view(opp_id, session).data  # 기회가 없으면 여기서 404
    company = _own_company(session, opp_id)
    steps = _step_labels(session)
    summary = result.summary
    lines = [f"오늘: {_day_label(today)}", "", "[조회 1. 이 회사 요약]", _TABLE_HEAD]
    lines.append(_table_line(company, steps))
    lines += _summary_lines(company)

    lines += [
        "",
        f"[조회 2. 비슷한 회사] 같은 공정 {summary.process_count}곳, "
        f"같은 산업 {summary.industry_count}곳",
    ]
    stages = ", ".join(
        f"{STAGE_LABELS.get(stage.value, stage.value)} {count}곳"
        for stage, count in summary.stage_counts.items()
    )
    lines.append(f"단계별 회사 수: {stages or _NONE}")
    reasons = ", ".join(
        f"{LOST_REASON_LABELS.get(item.code.value, item.code.value)} {item.count}곳"
        for item in summary.top_lost_reasons
    )
    lines.append(f"많은 거절 이유: {reasons or _NONE}")
    reach = ", ".join(
        f"{METHOD_LABELS[method.value]} {count.tried}번 중 {count.reached}번 연결"
        for method, count in summary.contact_reach.items()
    )
    lines.append(f"방법별 연결: {reach or _NONE}")
    lines.append("회사 | 같은 공정 | 같은 산업 | 큰 단계 | 거절 이유 | 마지막 접촉")
    refs = [CompanyRef(company.opp_id, company.name)]
    for peer in result.companies:
        status = peer.outcome_status.value if peer.outcome_status else _NO_STAGE
        if peer.last_contact_at and peer.last_contact_method:
            last = (
                f"{peer.last_contact_at.astimezone(KST).date().isoformat()} "
                f"{METHOD_LABELS[peer.last_contact_method.value]}"
            )
        else:
            last = _NONE
        lines.append(
            " | ".join(
                [
                    peer.name,
                    "예" if peer.same_process else "아니오",
                    "예" if peer.same_industry else "아니오",
                    STAGE_LABELS.get(status, status),
                    LOST_REASON_LABELS.get(peer.lost_reason_code.value, _NONE)
                    if peer.lost_reason_code
                    else _NONE,
                    last,
                ]
            )
        )
        refs.append(CompanyRef(peer.opp_id, peer.name))
    if not result.companies:
        lines.append(_NONE)
    return AssistantContext(
        text="\n".join(lines),
        companies=tuple(refs),
        total_companies=len(refs),
        used_queries=(QUERY_COMPANY_SUMMARY, QUERY_PEERS),
    )


def _own_company(session: Session, opp_id: str) -> _Company:
    """회사 하나의 고른 값(세부 단계·관심 여부 포함). 통화 준비와 메모 읽기가 함께 쓴다."""
    (company,) = _load_companies(session, [opp_id])
    if company.status != _NO_STAGE or company.contacts:
        code = sales_step_state(session, opp_id, status=company.status).code
        company.step = code.value if code is not None else None
    company.bookmarked = opp_id in set(
        session.scalars(
            dashboard_population(runtime_for(session).app_settings.active_dataset_kind.value)
        )
    )
    return company


def build_memo_read_context(session: Session, opp_id: str, today: date) -> AssistantContext:
    """메모 읽기(#720)에 함께 싣는 글: 오늘 날짜와 이 회사의 고른 값 한 줄.

    통화 준비의 표 한 줄과 같은 칸이다. 접촉 날짜별 줄·고른 답·자유 글은 싣지 않는다.
    """
    company = _own_company(session, opp_id)
    lines = [
        f"오늘: {_day_label(today)}",
        "",
        "[이 회사의 지금 값]",
        _TABLE_HEAD,
        _table_line(company, _step_labels(session)),
    ]
    return AssistantContext(
        text="\n".join(lines),
        companies=(CompanyRef(company.opp_id, company.name),),
        total_companies=1,
        used_queries=(QUERY_COMPANY_SUMMARY,),
    )


def named_sources(answer: str, companies: Sequence[CompanyRef]) -> list[CompanyRef]:
    """답 글에 이름이 그대로 나온 회사만 고른다. 조회에 없던 이름은 답에 있어도 근거가 아니다."""
    return [company for company in companies if company.name and company.name in answer]
