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
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.sales_questions import KST
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Outcome
from geosan.rules.codes import ContactMethod, ContactResult, LostReasonCode, OutcomeStatus

CONTACT_METHODS: tuple[str, ...] = tuple(ContactMethod)
# 접촉은 했지만 아직 끝나지 않은 단계. 접촉만 적고 단계를 안 바꾼 옛 기록(미접촉)도 여기에 센다.
IN_PROGRESS_STATUSES = frozenset(
    {
        OutcomeStatus.NOT_EXECUTED,
        OutcomeStatus.IN_PROGRESS,
        OutcomeStatus.SAMPLE_OR_REGISTRATION_APPROVED,
    }
)
CLOSED_STATUSES = frozenset({OutcomeStatus.WON, OutcomeStatus.LOST})
# 계약 C1: 공정 연결이 없는 회사와 산업군이 없는 회사는 맨 끝 줄에 따로 센다.
NO_PROCESS_NAME = "공정 미확정"
NO_INDUSTRY_NAME = "미확정"
_VIRTUAL_DATASET_KIND = "VIRTUAL_REVIEWED"
_LOST_REASON_ORDER = {code.value: index for index, code in enumerate(LostReasonCode)}


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


@dataclass(frozen=True)
class ProcessRow:
    process_code: str | None
    process_name: str
    stats: GroupStats
    by_industry: list[IndustryRow]


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


def _contact_day(line: RecordLine) -> date:
    return line.attempted_at or line.created_at.astimezone(KST).date()


def _closed_since(lines: Sequence[RecordLine]) -> datetime | None:
    """지금 성사·거절이면 그 결과로 처음 바뀐 행의 저장 시각. 뒤에 덧붙인 행은 보지 않는다."""
    since: datetime | None = None
    status: str | None = None
    for line in lines:
        if line.status != status:
            status = line.status
            since = line.created_at if line.status in CLOSED_STATUSES else None
    return since


def summarize_company(company: CompanyRecords, today: date) -> CompanyRow | None:
    """회사 한 곳의 기록을 표 한 줄로 줄인다. 접촉 시도가 없으면 표 대상이 아니라 None."""
    contacts = [line for line in company.lines if line.method in CONTACT_METHODS]
    if not contacts:
        return None
    status = company.lines[-1].status
    if status not in set(OutcomeStatus):
        raise ValueError(f"모르는 영업 단계 값이라 분석표에 셀 수 없습니다: {status!r}")
    tried = Counter(line.method for line in contacts)
    reached = Counter(line.method for line in contacts if line.result == ContactResult.REACHED)
    days = [_contact_day(line) for line in contacts]
    first, last = min(days), max(days)
    closed_at = _closed_since(company.lines)
    outcome_at = closed_at.astimezone(KST).date() if closed_at else None
    return CompanyRow(
        opp_id=company.opp_id,
        name=company.name,
        process_codes=list(company.process_codes),
        industries=list(company.industries),
        contact_count=ContactCount(
            total=len(contacts),
            call=tried[ContactMethod.CALL],
            email=tried[ContactMethod.EMAIL],
            visit=tried[ContactMethod.VISIT],
        ),
        outcome_status=status,
        sales_step=company.sales_step,
        lost_reason_code=(
            company.lines[-1].lost_reason_code if status == OutcomeStatus.LOST else None
        ),
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


def group_stats(rows: Sequence[CompanyRow], min_sample_for_ratio: int) -> GroupStats:
    """회사 줄 묶음의 집계 칸. 표본이 기준보다 적으면 비율(ratios)을 내지 않는다."""
    contacted = len(rows)
    statuses = Counter(row.outcome_status for row in rows)
    won = [row for row in rows if row.outcome_status == OutcomeStatus.WON]
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
        on_hold_count=statuses[OutcomeStatus.ON_HOLD],
        won_count=len(won),
        lost_count=statuses[OutcomeStatus.LOST],
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
                    _LOST_REASON_ORDER.get(item[0], len(_LOST_REASON_ORDER)),
                ),
            )
        ],
        ratios=ratios,
    )


def _industry_rows(
    rows: Sequence[CompanyRow], industries: Sequence[str], min_sample_for_ratio: int
) -> list[IndustryRow]:
    result = []
    for name in industries:
        members = [row for row in rows if name in row.industries]
        if members:
            result.append(IndustryRow(name, group_stats(members, min_sample_for_ratio)))
    unknown = [row for row in rows if not any(name in industries for name in row.industries)]
    if unknown:
        result.append(IndustryRow(NO_INDUSTRY_NAME, group_stats(unknown, min_sample_for_ratio)))
    return result


def build_sales_analysis(
    companies: Sequence[CompanyRecords],
    *,
    processes: Sequence[tuple[str, str]],
    industries: Sequence[str],
    min_sample_for_ratio: int,
    closed_window_days: int,
    now: datetime,
) -> SalesAnalysis:
    """공정별·회사별 표를 계산한다. 시각은 직접 읽지 않고 `now`를 받는다(NFR12).

    `processes`는 역량 파일 순서의 (코드, 이름), `industries`는 설정 순서다. 한 회사가
    공정·산업군이 여러 개면 각각 세므로 줄의 합이 회사 수보다 클 수 있다.
    """
    today = now.astimezone(KST).date()
    oldest_closed = now - timedelta(days=closed_window_days)
    rows: list[CompanyRow] = []
    older_closed = 0
    for company in companies:
        row = summarize_company(company, today)
        if row is None:
            continue
        if row.closed_at is not None and row.closed_at < oldest_closed:
            older_closed += 1
            continue
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
                    stats=group_stats(members, min_sample_for_ratio),
                    by_industry=_industry_rows(members, industries, min_sample_for_ratio),
                )
            )
    unlinked = [row for row in rows if not row.process_codes]
    if unlinked:
        by_process.append(
            ProcessRow(
                process_code=None,
                process_name=NO_PROCESS_NAME,
                stats=group_stats(unlinked, min_sample_for_ratio),
                by_industry=_industry_rows(unlinked, industries, min_sample_for_ratio),
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
    )


# ---------------------------------------------------------------------------
# DB 읽기
# ---------------------------------------------------------------------------


def process_display_name(name: str) -> str:
    """목록 머리 선택란과 같은 공정 이름(가상 묶음의 '— 가상' 꼬리는 띠가 대신 알린다)."""
    return re.sub(r"\s*—\s*가상\s*$", "", name)


def _live_outcomes(virtual: bool):
    """분석에 세는 영업 기록 행을 고르는 select(기회·저장 순서).

    취소된 기록(#253)은 세지 않는다는 약속을 지키는 자리다. 지금은 취소 표시 열이 아직 없어
    모든 행이 살아 있는 행이다. 기록 취소 서버가 열을 더하면 이 select 한 곳에 조건을 건다.
    """
    return (
        select(Outcome, Customer.name, Customer.industries)
        .join(Opportunity, Outcome.opp_id == Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(Opportunity.is_virtual.is_(virtual), Customer.is_virtual.is_(virtual))
        .order_by(Outcome.opp_id, Outcome.version)
    )


def load_company_records(
    session: Session,
    *,
    dataset_kind: str,
    sales_step_of: Callable[[str, str], str | None],
) -> list[CompanyRecords]:
    """접촉 시도가 있는 회사의 기록을 계산용 값으로 읽는다.

    대상은 추천 목록과 같다: 활성 묶음에 속하고 최신 확정 평가가 있는 기회. 가상 회사와 실제
    회사는 섞지 않는다. `sales_step_of(opp_id, 최신 단계)`는 카드와 같은 세부 단계 계산을
    창구가 넘겨 준다(이 부품이 창구를 거꾸로 부르지 않게).
    """
    grouped: dict[str, tuple[str, list[str], list[RecordLine]]] = {}
    for outcome, name, industries in session.execute(
        _live_outcomes(dataset_kind == _VIRTUAL_DATASET_KIND)
    ):
        _, _, lines = grouped.setdefault(outcome.opp_id, (name, list(industries or []), []))
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
        for opp_id, code in session.execute(
            select(OppProcessLink.opp_id, OppProcessLink.process_code)
            .where(OppProcessLink.opp_id.in_(targets), OppProcessLink.superseded_at.is_(None))
            .distinct()
        ):
            codes.setdefault(opp_id, set()).add(code)
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
