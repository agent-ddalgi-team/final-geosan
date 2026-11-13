"""영업 분석표 계산 (계약 C1 `GET /sales-analysis`, 이슈 #608).

담당자가 남긴 영업 기록(rec_outcome)만으로 공정별·회사별 표를 계산한다. AI·외부 호출·저장 없음.
계산(`build_sales_analysis`)은 받은 값만 쓰는 순수 함수이고, DB 읽기(`load_company_records`)와
나뉘어 있다. 기준 숫자(표본 최소 건수·기간)는 설정 `salesAnalysis`에서 받아 온다(규칙 ⑩).

숫자의 뜻은 다른 화면과 같다: 접촉 수 = 접촉 시도 행 수(상세 `records.contactCount`),
방법별 시도·연결 = 비슷한 회사·성사/거절 분석 줄의 `contactReach`.
응답에 나갈 값은 코드·건수·날짜·회사 이름뿐이다. 메모 글·사람 이름·연락처는 읽지도 않는다.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, tzinfo
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.evaluation.inputs import AI_PROPOSED
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Outcome

# 계약 C0의 코드값. 이 부품은 규칙·설정 부품을 가져오지 않아서(`queries.py`와 같은 방식) 글자 그대로
# 적는다. 코드표 전체가 필요한 것(거절 이유 순서)과 시간대는 창구가 인자로 넘긴다.
STATUS_WON = "WON"
STATUS_LOST = "LOST"
STATUS_ON_HOLD = "ON_HOLD"
METHOD_CALL = "CALL"
METHOD_EMAIL = "EMAIL"
METHOD_VISIT = "VISIT"
RESULT_REACHED = "REACHED"
CONTACT_METHODS: tuple[str, ...] = (METHOD_CALL, METHOD_EMAIL, METHOD_VISIT)
# 접촉은 했지만 아직 끝나지 않은 단계. 접촉만 적고 단계를 안 바꾼 옛 기록(미접촉)도 여기에 센다.
IN_PROGRESS_STATUSES = frozenset({"NOT_EXECUTED", "IN_PROGRESS", "SAMPLE_OR_REGISTRATION_APPROVED"})
CLOSED_STATUSES = frozenset({STATUS_WON, STATUS_LOST})
KNOWN_STATUSES = IN_PROGRESS_STATUSES | CLOSED_STATUSES | {STATUS_ON_HOLD}
# 계약 C1(#652): 확정된 공정이 없는 회사와 확정된 산업군이 없는 회사는 맨 끝 줄에 따로 센다.
NO_PROCESS_NAME = "공정 확인 전"
NO_INDUSTRY_NAME = "산업 확인 전"
# 확정된 값만 센다(#652): 공정 연결은 state CONFIRMED(사례 파일·담당자), 산업군은 아래 출처만.
LINK_CONFIRMED = "CONFIRMED"
# (#678) 담당자가 확정한 공정 연결의 출처 값(꼬리 질문 확정 #652 · 검토사항 [확정] #497).
LINK_SOURCE_STAFF = "STAFF"
CONFIRMED_INDUSTRY_SOURCES = frozenset({"CASE_FILE", "STAFF"})
_VIRTUAL_DATASET_KIND = "VIRTUAL_REVIEWED"


# ---------------------------------------------------------------------------
# 계산에 넣는 값
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RecordLine:
    """영업 기록 한 행에서 계산에 쓰는 칸만. 저장 순서(version)대로 넘긴다."""

    status: str
    method: str | None
    result: str | None
    attempted_at: date | None
    created_at: datetime
    lost_reason_code: str | None
    # (#684) 이 행을 저장한 뒤의 세부 단계. 창구가 상세·카드와 같은 계산으로 넘긴다(없으면 None).
    step_after: str | None = None


@dataclass(frozen=True)
class CompanyRecords:
    opp_id: str
    name: str
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    sales_step: str | None
    lines: tuple[RecordLine, ...]


# ---------------------------------------------------------------------------
# 계산 결과
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReachCount:
    reached: int
    tried: int


@dataclass(frozen=True)
class ContactReach:
    call: ReachCount
    email: ReachCount
    visit: ReachCount


@dataclass(frozen=True)
class ReachRatios:
    call: float | None
    email: float | None
    visit: float | None


@dataclass(frozen=True)
class Ratios:
    won: float
    reach: ReachRatios


@dataclass(frozen=True)
class LostReasonCount:
    code: str
    count: int


@dataclass(frozen=True)
class GroupStats:
    """공정 한 줄(또는 그 아래 산업군 한 줄)의 집계 칸."""

    contacted_count: int
    in_progress_count: int
    on_hold_count: int
    won_count: int
    lost_count: int
    avg_contacts_to_won: float | None
    contact_reach: ContactReach
    lost_reasons: list[LostReasonCount]
    ratios: Ratios | None


@dataclass(frozen=True)
class IndustryRow:
    industry: str
    stats: GroupStats
    # (#684) 이 줄의 회사 가운데 같은 공정 아래 다른 산업군 줄에도 든 회사 수.
    overlap_count: int = 0


@dataclass(frozen=True)
class ProcessRow:
    process_code: str | None
    process_name: str
    stats: GroupStats
    by_industry: list[IndustryRow]
    # (#684) 이 줄의 회사 가운데 다른 공정 줄에도 든 회사 수.
    overlap_count: int = 0


@dataclass(frozen=True)
class StepRow:
    """(#684) 세부 단계 한 줄: 그 단계에 머무는 동안의 접촉과, 그 단계에 이르기까지의 접촉."""

    step: str
    contacted_count: int
    contact_count: int
    contact_reach: ContactReach
    reach_ratios: ReachRatios | None
    reached_count: int
    contacts_to_reach: int
    avg_contacts_to_reach: float | None


@dataclass(frozen=True)
class ContactCount:
    total: int
    call: int
    email: int
    visit: int


@dataclass(frozen=True)
class CompanyRow:
    opp_id: str
    name: str
    process_codes: list[str]
    industries: list[str]
    contact_count: ContactCount
    outcome_status: str
    sales_step: str | None
    lost_reason_code: str | None
    first_contact_at: date
    last_contact_at: date
    days_since_first_contact: int
    outcome_at: date | None
    days_to_outcome: int | None
    # 표에 싣지 않고 묶음 집계에만 쓰는 값.
    reach: ContactReach
    closed_at: datetime | None


@dataclass(frozen=True)
class Basis:
    min_sample_for_ratio: int
    closed_window_days: int
    company_count: int
    older_closed_excluded: int


@dataclass(frozen=True)
class SalesAnalysis:
    as_of: datetime
    basis: Basis
    by_process: list[ProcessRow]
    companies: list[CompanyRow]
    # (#684) 회사를 한 번씩만 센 합계와 단계별 접촉.
    total: GroupStats
    by_sales_step: list[StepRow]


# ---------------------------------------------------------------------------
# 순수 계산
# ---------------------------------------------------------------------------


def _rounded(value: Decimal, places: str) -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _ratio(count: int, total: int) -> float | None:
    """count ÷ total, 소수 2자리(0.5 올림). 나눌 수가 0이면 나누지 않고 None이다."""
    if total == 0:
        return None
    return _rounded(Decimal(count) / Decimal(total), "0.01")


def _contact_day(line: RecordLine, tz: tzinfo) -> date:
    return line.attempted_at or line.created_at.astimezone(tz).date()


def _closed_since(lines: Sequence[RecordLine]) -> datetime | None:
    """지금 성사·거절이면 그 결과로 처음 바뀐 행의 저장 시각. 뒤에 덧붙인 행은 보지 않는다."""
    since: datetime | None = None
    status: str | None = None
    for line in lines:
        if line.status != status:
            status = line.status
            since = line.created_at if line.status in CLOSED_STATUSES else None
    return since


def summarize_company(company: CompanyRecords, today: date, *, tz: tzinfo) -> CompanyRow | None:
    """회사 한 곳의 기록을 표 한 줄로 줄인다. 접촉 시도가 없으면 표 대상이 아니라 None.

    `tz`는 저장 시각을 날짜로 바꿀 때 쓰는 시간대(한국 시간)로, 창구가 넘긴다.
    """
    contacts = [line for line in company.lines if line.method in CONTACT_METHODS]
    if not contacts:
        return None
    status = company.lines[-1].status
    if status not in KNOWN_STATUSES:
        raise ValueError(f"모르는 영업 단계 값이라 분석표에 셀 수 없습니다: {status!r}")
    tried = Counter(line.method for line in contacts)
    reached = Counter(line.method for line in contacts if line.result == RESULT_REACHED)
    days = [_contact_day(line, tz) for line in contacts]
    first, last = min(days), max(days)
    closed_at = _closed_since(company.lines)
    outcome_at = closed_at.astimezone(tz).date() if closed_at else None
    return CompanyRow(
        opp_id=company.opp_id,
        name=company.name,
        process_codes=list(company.process_codes),
        industries=list(company.industries),
        contact_count=ContactCount(
            total=len(contacts),
            call=tried[METHOD_CALL],
            email=tried[METHOD_EMAIL],
            visit=tried[METHOD_VISIT],
        ),
        outcome_status=status,
        sales_step=company.sales_step,
        lost_reason_code=(company.lines[-1].lost_reason_code if status == STATUS_LOST else None),
        first_contact_at=first,
        last_contact_at=last,
        days_since_first_contact=max((today - first).days, 0),
        outcome_at=outcome_at,
        days_to_outcome=max((outcome_at - first).days, 0) if outcome_at else None,
        reach=ContactReach(
            **{
                method.lower(): ReachCount(reached=reached[method], tried=tried[method])
                for method in CONTACT_METHODS
            }
        ),
        closed_at=closed_at,
    )


def group_stats(
    rows: Sequence[CompanyRow], min_sample_for_ratio: int, lost_reason_order: Sequence[str]
) -> GroupStats:
    """회사 줄 묶음의 집계 칸. 표본이 기준보다 적으면 비율(ratios)을 내지 않는다.

    `lost_reason_order`는 계약 C0 거절 이유 코드표 순서(건수가 같을 때의 순서)로, 창구가 넘긴다.
    """
    reason_order = {code: index for index, code in enumerate(lost_reason_order)}
    contacted = len(rows)
    statuses = Counter(row.outcome_status for row in rows)
    won = [row for row in rows if row.outcome_status == STATUS_WON]
    reach = ContactReach(
        **{
            method.lower(): ReachCount(
                reached=sum(getattr(row.reach, method.lower()).reached for row in rows),
                tried=sum(getattr(row.reach, method.lower()).tried for row in rows),
            )
            for method in CONTACT_METHODS
        }
    )
    # 거절 이유 코드가 없는 옛 거절 기록은 분포에 싣지 않는다(거절 수에는 들어 있다).
    reasons = Counter(row.lost_reason_code for row in rows if row.lost_reason_code)
    ratios = None
    if contacted >= min_sample_for_ratio and contacted > 0:
        ratios = Ratios(
            won=_ratio(len(won), contacted) or 0.0,
            reach=ReachRatios(
                call=_ratio(reach.call.reached, reach.call.tried),
                email=_ratio(reach.email.reached, reach.email.tried),
                visit=_ratio(reach.visit.reached, reach.visit.tried),
            ),
        )
    return GroupStats(
        contacted_count=contacted,
        in_progress_count=sum(statuses[status] for status in IN_PROGRESS_STATUSES),
        on_hold_count=statuses[STATUS_ON_HOLD],
        won_count=len(won),
        lost_count=statuses[STATUS_LOST],
        avg_contacts_to_won=(
            _rounded(
                Decimal(sum(row.contact_count.total for row in won)) / Decimal(len(won)), "0.1"
            )
            if won
            else None
        ),
        contact_reach=reach,
        lost_reasons=[
            LostReasonCount(code=code, count=count)
            for code, count in sorted(
                reasons.items(),
                key=lambda item: (
                    -item[1],
                    reason_order.get(item[0], len(reason_order)),
                ),
            )
        ],
        ratios=ratios,
    )


def _industry_rows(
    rows: Sequence[CompanyRow],
    industries: Sequence[str],
    min_sample_for_ratio: int,
    lost_reason_order: Sequence[str],
) -> list[IndustryRow]:
    result = []
    for name in industries:
        members = [row for row in rows if name in row.industries]
        if members:
            result.append(
                IndustryRow(
                    name,
                    group_stats(members, min_sample_for_ratio, lost_reason_order),
                    overlap_count=sum(
                        1
                        for row in members
                        if sum(1 for other in industries if other in row.industries) > 1
                    ),
                )
            )
    unknown = [row for row in rows if not any(name in industries for name in row.industries)]
    if unknown:
        result.append(
            IndustryRow(
                NO_INDUSTRY_NAME, group_stats(unknown, min_sample_for_ratio, lost_reason_order)
            )
        )
    return result


def step_rows(
    companies: Sequence[CompanyRecords], step_order: Sequence[str], min_sample_for_ratio: int
) -> list[StepRow]:
    """(#684) 세부 단계마다 그 단계에 머무는 동안의 접촉과 그 단계에 이르기까지의 접촉 수.

    회사마다 기록 행을 저장 순서로 읽는다. 접촉 시도 행은 그 행을 저장하기 직전의 세부
    단계(첫 접촉은 `step_order`의 첫 단계 = 연결 전)에서 일어난 접촉으로 센다. 행을 저장한 뒤의
    단계(`step_after`)가 그 회사가 아직 이른 적 없는 단계면 그 행까지의 누적 접촉 수가
    "이르기까지"다. 건너뛴 단계는 이른 것으로 세지 않는다. 고친 단계는 창구가 넘긴 값에 이미
    들어 있다.
    """
    if not step_order:
        return []
    first = step_order[0]
    tried = {step: Counter() for step in step_order}
    reached = {step: Counter() for step in step_order}
    companies_at: dict[str, set[str]] = {step: set() for step in step_order}
    to_reach: dict[str, list[int]] = {step: [] for step in step_order}
    for company in companies:
        current: str | None = None
        seen = {first}
        contacts = 0
        for line in company.lines:
            if line.step_after is not None and line.step_after not in tried:
                raise ValueError(
                    f"모르는 세부 단계 값이라 단계별 접촉에 셀 수 없습니다: {line.step_after!r}"
                )
            if line.method in CONTACT_METHODS:
                contacts += 1
                before = current or first
                tried[before][line.method] += 1
                if line.result == RESULT_REACHED:
                    reached[before][line.method] += 1
                companies_at[before].add(company.opp_id)
            current = line.step_after
            if current is not None and current not in seen and contacts > 0:
                seen.add(current)
                to_reach[current].append(contacts)
    rows = []
    for step in step_order:
        contact_count = sum(tried[step].values())
        arrived = to_reach[step]
        if contact_count == 0 and not arrived:
            continue
        reach = ContactReach(
            **{
                method.lower(): ReachCount(reached=reached[step][method], tried=tried[step][method])
                for method in CONTACT_METHODS
            }
        )
        contacted = len(companies_at[step])
        rows.append(
            StepRow(
                step=step,
                contacted_count=contacted,
                contact_count=contact_count,
                contact_reach=reach,
                reach_ratios=(
                    ReachRatios(
                        call=_ratio(reach.call.reached, reach.call.tried),
                        email=_ratio(reach.email.reached, reach.email.tried),
                        visit=_ratio(reach.visit.reached, reach.visit.tried),
                    )
                    if contacted >= min_sample_for_ratio and contacted > 0
                    else None
                ),
                reached_count=len(arrived),
                contacts_to_reach=sum(arrived),
                avg_contacts_to_reach=(
                    _rounded(Decimal(sum(arrived)) / Decimal(len(arrived)), "0.1")
                    if arrived and len(arrived) >= min_sample_for_ratio
                    else None
                ),
            )
        )
    return rows


def build_sales_analysis(
    companies: Sequence[CompanyRecords],
    *,
    processes: Sequence[tuple[str, str]],
    industries: Sequence[str],
    min_sample_for_ratio: int,
    closed_window_days: int,
    now: datetime,
    tz: tzinfo,
    lost_reason_order: Sequence[str],
    step_order: Sequence[str] = (),
) -> SalesAnalysis:
    """공정별·회사별 표를 계산한다. 시각은 직접 읽지 않고 `now`를 받는다(NFR12).

    `step_order`는 세부 단계 코드표 순서로 창구가 넘긴다(#684 단계별 접촉). 비우면 그 표를 내지
    않는다. 합계(`total`)는 표에 든 회사를 공정·산업군과 상관없이 한 번씩만 센다.

    `processes`는 역량 파일 순서의 (코드, 이름), `industries`는 설정 순서다. 한 회사가
    공정·산업군이 여러 개면 각각 세므로 줄의 합이 회사 수보다 클 수 있다. 영업 분석표는
    확정된 공정·산업군만 넘겨받으므로(#652) 확인 전 회사는 "확인 전" 한 줄에만 들어간다.
    """
    today = now.astimezone(tz).date()
    oldest_closed = now - timedelta(days=closed_window_days)
    rows: list[CompanyRow] = []
    counted: list[CompanyRecords] = []
    older_closed = 0
    for company in companies:
        row = summarize_company(company, today, tz=tz)
        if row is None:
            continue
        if row.closed_at is not None and row.closed_at < oldest_closed:
            older_closed += 1
            continue
        counted.append(company)
        # 카드와 같이 역량 파일 순서로 보이고, 역량 파일에 없는 공정 코드는 싣지 않는다.
        ordered = [code for code, _ in processes if code in row.process_codes]
        rows.append(replace(row, process_codes=ordered))
    rows.sort(key=lambda row: row.name)
    rows.sort(key=lambda row: row.last_contact_at, reverse=True)

    by_process: list[ProcessRow] = []
    for code, name in processes:
        members = [row for row in rows if code in row.process_codes]
        if members:
            by_process.append(
                ProcessRow(
                    process_code=code,
                    process_name=name,
                    stats=group_stats(members, min_sample_for_ratio, lost_reason_order),
                    by_industry=_industry_rows(
                        members, industries, min_sample_for_ratio, lost_reason_order
                    ),
                    overlap_count=sum(1 for row in members if len(row.process_codes) > 1),
                )
            )
    unlinked = [row for row in rows if not row.process_codes]
    if unlinked:
        by_process.append(
            ProcessRow(
                process_code=None,
                process_name=NO_PROCESS_NAME,
                stats=group_stats(unlinked, min_sample_for_ratio, lost_reason_order),
                by_industry=_industry_rows(
                    unlinked, industries, min_sample_for_ratio, lost_reason_order
                ),
            )
        )
    return SalesAnalysis(
        as_of=now,
        basis=Basis(
            min_sample_for_ratio=min_sample_for_ratio,
            closed_window_days=closed_window_days,
            company_count=len(rows),
            older_closed_excluded=older_closed,
        ),
        by_process=by_process,
        companies=rows,
        total=group_stats(rows, min_sample_for_ratio, lost_reason_order),
        by_sales_step=step_rows(counted, step_order, min_sample_for_ratio),
    )


# ---------------------------------------------------------------------------
# DB 읽기
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProposalHit:
    """(#678) 담당자가 확정한 회사 수와 그 가운데 AI 제안 안에서 고른 회사 수."""

    confirmed_count: int
    hit_count: int
    ratio: float | None


def proposal_hit(confirmed_count: int, hit_count: int, min_sample_for_ratio: int) -> ProposalHit:
    """표본이 기준보다 적으면 비율 없이 건수만 낸다."""
    enough = confirmed_count >= min_sample_for_ratio and confirmed_count > 0
    return ProposalHit(
        confirmed_count=confirmed_count,
        hit_count=hit_count,
        ratio=_ratio(hit_count, confirmed_count) if enough else None,
    )


def load_process_proposal_hit(
    session: Session, *, dataset_kind: str, min_sample_for_ratio: int
) -> ProposalHit:
    """(#678) 담당자가 확정한 공정이 AI 제안 안에 있었는지를 회사 수로 센다. 저장·AI 호출 없음.

    대상은 추천 목록과 같다(활성 묶음, 최신 확정 평가가 있는 기회). 접촉 기록은 보지 않는다.
    담당자 확정 = 지금 살아 있는 공정 연결 가운데 출처가 담당자이고 확정인 행. AI 제안 = 같은
    기회·같은 공정 코드의 AI 행으로, 담당자 행보다 먼저 만들어진 것(확정하면서 이력이 된 행 포함).
    한 회사가 확정한 공정이 모두 AI 제안 안에 있었을 때만 적중으로 센다.
    """
    virtual = dataset_kind == _VIRTUAL_DATASET_KIND
    rows = session.execute(
        select(
            OppProcessLink.opp_id,
            OppProcessLink.process_code,
            OppProcessLink.source,
            OppProcessLink.state,
            OppProcessLink.superseded_at,
            OppProcessLink.created_at,
        )
        .join(Opportunity, OppProcessLink.opp_id == Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Opportunity.is_virtual.is_(virtual),
            Customer.is_virtual.is_(virtual),
            OppProcessLink.source.in_([LINK_SOURCE_STAFF, AI_PROPOSED]),
        )
    ).all()
    confirmed: dict[str, dict[str, datetime]] = {}
    proposed: dict[tuple[str, str], datetime] = {}
    for opp_id, code, source, state, superseded_at, created_at in rows:
        if source == AI_PROPOSED:
            key = (opp_id, code)
            proposed[key] = min(proposed.get(key, created_at), created_at)
        elif state == LINK_CONFIRMED and superseded_at is None:
            confirmed.setdefault(opp_id, {})[code] = created_at
    confirmed_count = hit_count = 0
    for opp_id, codes in confirmed.items():
        evaluation = latest_confirmed_evaluation(session, opp_id)
        if evaluation is None or evaluation.dataset_kind != dataset_kind:
            continue
        confirmed_count += 1
        if all(
            (opp_id, code) in proposed and proposed[(opp_id, code)] <= confirmed_at
            for code, confirmed_at in codes.items()
        ):
            hit_count += 1
    return proposal_hit(confirmed_count, hit_count, min_sample_for_ratio)


def process_display_name(name: str) -> str:
    """목록 머리 선택란과 같은 공정 이름(가상 묶음의 '— 가상' 꼬리는 띠가 대신 알린다)."""
    return re.sub(r"\s*—\s*가상\s*$", "", name)


def _live_outcomes(virtual: bool):
    """분석에 세는 영업 기록 행을 고르는 select(기회·저장 순서).

    취소된 기록(#253)은 세지 않는다는 약속을 지키는 자리다. 잘못 입력으로 표시한 행은
    이 select 한 곳에서 뺀다.
    """
    return (
        select(Outcome, Customer.name, Customer.industries, Customer.industries_source)
        .join(Opportunity, Outcome.opp_id == Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Opportunity.is_virtual.is_(virtual),
            Customer.is_virtual.is_(virtual),
            Outcome.cancelled_at.is_(None),
        )
        .order_by(Outcome.opp_id, Outcome.version)
    )


def load_company_records(
    session: Session,
    *,
    dataset_kind: str,
    sales_step_of: Callable[[str, str], str | None],
    confirmed_only: bool = False,
    steps_after_of: Callable[[str], Mapping[str, str | None]] | None = None,
) -> list[CompanyRecords]:
    """접촉 시도가 있는 회사의 기록을 계산용 값으로 읽는다.

    대상은 추천 목록과 같다: 활성 묶음에 속하고 최신 확정 평가가 있는 기회. 가상 회사와 실제
    회사는 섞지 않는다. `sales_step_of(opp_id, 최신 단계)`는 카드와 같은 세부 단계 계산을
    창구가 넘겨 준다(이 부품이 창구를 거꾸로 부르지 않게).

    `confirmed_only`가 True면 확정된 공정 연결(사례 파일·담당자)과 확정된 산업군(사례 파일·담당자)만
    싣는다(#652 영업 분석표). False면 전처럼 AI 제안까지 싣는다(세 묶음 순서 조정 #610이 쓰는 값).

    `steps_after_of(opp_id)`는 {기록 행 id: 그 행을 저장한 뒤의 세부 단계}로, 창구가 상세·카드와
    같은 계산으로 넘긴다(#684 단계별 접촉). 넘기지 않으면 행마다의 단계를 싣지 않는다.
    """
    grouped: dict[str, tuple[str, list[str], list[RecordLine]]] = {}
    outcome_ids: dict[str, list[str]] = {}
    for outcome, name, industries, industries_source in session.execute(
        _live_outcomes(dataset_kind == _VIRTUAL_DATASET_KIND)
    ):
        if confirmed_only and industries_source not in CONFIRMED_INDUSTRY_SOURCES:
            industries = []
        _, _, lines = grouped.setdefault(outcome.opp_id, (name, list(industries or []), []))
        outcome_ids.setdefault(outcome.opp_id, []).append(outcome.outcome_id)
        lines.append(
            RecordLine(
                status=outcome.status,
                method=outcome.method,
                result=outcome.result,
                attempted_at=outcome.attempted_at,
                created_at=outcome.created_at,
                lost_reason_code=outcome.lost_reason_code,
            )
        )
    contacted = [
        opp_id
        for opp_id, (_, _, lines) in grouped.items()
        if any(line.method in CONTACT_METHODS for line in lines)
    ]
    targets = []
    for opp_id in contacted:
        evaluation = latest_confirmed_evaluation(session, opp_id)
        if evaluation is not None and evaluation.dataset_kind == dataset_kind:
            targets.append(opp_id)
    codes: dict[str, set[str]] = {}
    if targets:
        # 목록과 같은 방식: 재투입으로 교체된 연결은 빼고, 같은 기회·공정은 한 번만 센다.
        links = select(OppProcessLink.opp_id, OppProcessLink.process_code).where(
            OppProcessLink.opp_id.in_(targets), OppProcessLink.superseded_at.is_(None)
        )
        if confirmed_only:
            links = links.where(OppProcessLink.state == LINK_CONFIRMED)
        for opp_id, code in session.execute(links.distinct()):
            codes.setdefault(opp_id, set()).add(code)
    if steps_after_of is not None:
        for opp_id in targets:
            steps = steps_after_of(opp_id)
            lines = grouped[opp_id][2]
            # 행마다 계산한 단계가 빠져 있으면 조용히 "연결 전"으로 세지 않고 알린다.
            lines[:] = [
                replace(line, step_after=steps[outcome_id])
                for line, outcome_id in zip(lines, outcome_ids[opp_id], strict=True)
            ]
    return [
        CompanyRecords(
            opp_id=opp_id,
            name=grouped[opp_id][0],
            process_codes=tuple(sorted(codes.get(opp_id, set()))),
            industries=tuple(grouped[opp_id][1]),
            sales_step=sales_step_of(opp_id, grouped[opp_id][2][-1].status),
            lines=tuple(grouped[opp_id][2]),
        )
        for opp_id in targets
    ]
