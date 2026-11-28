"""#799 운영 관리 화면과 대시보드 운영 알림(PM 결정 2026-11-16). 읽기만 하고 저장·외부 호출은 없다.

비용은 `geosan cost`·호출 예약과 같은 계산(month_usage·accounted_cost)을, 오늘 자동 조사는 자동
조사 줄과 같은 계산(used_today·daily_limit)을 그대로 부른다. 숫자 기준은 설정에서만 읽는다
(llm.costAlertRatio, operations.factoryCsvRefreshDays).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.config.app_settings import AppSettings
from geosan.evidence.transfer import KST, TransferLog, accounted_cost, month_usage
from geosan.opportunity.complex_store import API_SOURCE_ID
from geosan.opportunity.factory_csv import SOURCE_ID as FACTORY_CSV_SOURCE_ID
from geosan.opportunity.source_models import (
    CandidateJudgment,
    FactoryProfile,
    SourceFactoryRow,
    WaterSite,
)
from geosan.workflows.research_queue import daily_limit, used_today

BLOCKED_LIMIT = 10
COST_PURPOSES = ("EXTERNAL_SEARCH", "EXTERNAL_AI")
SALES_KINDS = ("SALES_RECORD", "SALES_COACH", "SALES_ANALYSIS")  # #824 영업 분석 피드백 포함

ALERT_AI_USAGE = "AI_USAGE_ALERT"
ALERT_AI_LIMIT = "AI_LIMIT_REACHED"
ALERT_DATA_REFRESH = "DATA_REFRESH_DUE"


@dataclass(frozen=True)
class UsageGroup:
    group: str
    calls: int
    cost_usd: Decimal


@dataclass(frozen=True)
class DailyCost:
    day: date
    cost_usd: Decimal


@dataclass(frozen=True)
class AutoResearchToday:
    used_usd: Decimal
    limit_usd: Decimal | None


@dataclass(frozen=True)
class Usage:
    month: str
    calls: int
    call_limit: int
    cost_usd: Decimal
    cost_limit_usd: Decimal
    alert_ratio: float
    groups: list[UsageGroup]
    daily: list[DailyCost]
    auto_research_today: AutoResearchToday


@dataclass(frozen=True)
class SourceStatus:
    source: str
    as_of: date | None
    loaded_at: datetime | None
    rows: int
    refresh_due_at: date | None
    refresh_overdue: bool


@dataclass(frozen=True)
class BlockedTransfer:
    occurred_at: datetime
    purpose: str
    kind: str
    reason: str | None


@dataclass(frozen=True)
class ContactRevealLine:
    """#980 가린 연락처·메모를 연 기록 한 줄. 연 이름·번호·글은 없다."""

    at: datetime
    staff_key: str
    staff_name: str
    opp_id: str
    customer_name: str
    kind: str


@dataclass(frozen=True)
class Operations:
    usage: Usage
    sources: list[SourceStatus]
    blocked: list[BlockedTransfer]
    contact_reveals: list[ContactRevealLine]


@dataclass(frozen=True)
class OperationAlert:
    kind: str
    used_usd: Decimal | None = None
    limit_usd: Decimal | None = None
    percent: int | None = None
    as_of: date | None = None
    due_at: date | None = None


def is_operations_staff(settings: AppSettings, staff_key: str | None) -> bool:
    """운영 관리 화면·운영 알림을 받는 사람인가(설정 operations.staffKeys, 기록 담당자만)."""
    return (
        staff_key is not None
        and settings.is_recording_staff(staff_key)
        and staff_key in settings.operations_staff_keys()
    )


def _group_of(row: TransferLog) -> str:
    if row.purpose == "EXTERNAL_SEARCH":
        return "WEB_SEARCH"
    if row.kind in SALES_KINDS:
        return "SALES"
    if row.kind == "PUBLIC_TEXT":
        return "RESEARCH"
    return "OTHER"


def _month_start(now: datetime) -> datetime:
    local = now.astimezone(KST)
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def build_usage(session: Session, settings: AppSettings, now: datetime) -> Usage:
    """이번 달(한국 시간) 사용액·쓰임새별·날짜별과 오늘 자동 조사 금액."""
    llm = settings.llm
    calls, cost = month_usage(session, llm, now=now)
    rows = session.scalars(
        select(TransferLog).where(
            TransferLog.occurred_at >= _month_start(now).astimezone(UTC),
            TransferLog.purpose.in_(COST_PURPOSES),
            TransferLog.call_count > 0,
        )
    ).all()
    groups: dict[str, list[Decimal | int]] = defaultdict(lambda: [0, Decimal(0)])
    days: dict[date, Decimal] = defaultdict(Decimal)
    for row in rows:
        spent = accounted_cost(row, llm)
        entry = groups[_group_of(row)]
        entry[0] += row.call_count
        entry[1] += spent
        days[row.occurred_at.astimezone(KST).date()] += spent
    order = ("RESEARCH", "WEB_SEARCH", "SALES", "OTHER")
    return Usage(
        month=_month_start(now).strftime("%Y-%m"),
        calls=calls,
        call_limit=llm.monthly_call_limit,
        cost_usd=cost,
        cost_limit_usd=Decimal(str(llm.monthly_cost_limit_usd)),
        alert_ratio=llm.cost_alert_ratio,
        groups=[
            UsageGroup(key, int(groups[key][0]), Decimal(groups[key][1]))
            for key in order
            if key in groups
        ],
        daily=[DailyCost(day, days[day]) for day in sorted(days)],
        auto_research_today=AutoResearchToday(
            used_usd=used_today(session, settings), limit_usd=daily_limit(settings)
        ),
    )


def _factory_file_status(session: Session, settings: AppSettings, today: date) -> SourceStatus:
    as_of, loaded, rows = session.execute(
        select(
            func.max(SourceFactoryRow.file_date),
            func.max(SourceFactoryRow.loaded_at),
            func.count(),
        ).where(
            SourceFactoryRow.source_id == FACTORY_CSV_SOURCE_ID,
            SourceFactoryRow.file_date.is_not(None),
        )
    ).one()
    due = as_of + timedelta(days=settings.operations.factory_csv_refresh_days) if as_of else None
    return SourceStatus("FACTORY_FILE", as_of, loaded, rows, due, due is not None and due < today)


def _status(source: str, as_of, loaded, rows) -> SourceStatus:
    if isinstance(as_of, datetime):
        as_of = as_of.astimezone(KST).date()
    return SourceStatus(source, as_of, loaded, rows or 0, None, False)


def build_sources(session: Session, settings: AppSettings, today: date) -> list[SourceStatus]:
    """자료별 기준일·넣은 날·행 수. 갱신 권장일은 공장현황 파일에만 있다(PM 결정 180일)."""
    registry = session.execute(
        select(
            func.max(SourceFactoryRow.fetched_at),
            func.max(SourceFactoryRow.loaded_at),
            func.count(),
        ).where(
            SourceFactoryRow.source_id == API_SOURCE_ID,
            SourceFactoryRow.fetched_at.is_not(None),
        )
    ).one()
    profile = session.execute(
        select(func.max(FactoryProfile.file_date), func.max(FactoryProfile.loaded_at), func.count())
    ).one()
    water = session.execute(
        select(func.max(WaterSite.file_date), func.max(WaterSite.loaded_at), func.count())
    ).one()
    judged = session.execute(
        select(
            func.max(CandidateJudgment.judged_at),
            func.max(CandidateJudgment.created_at),
            func.count(),
        ).where(CandidateJudgment.is_virtual.is_(False))
    ).one()
    judged_at = judged[0]
    if isinstance(judged_at, str):
        judged_at = datetime.fromisoformat(judged_at)
    return [
        _factory_file_status(session, settings, today),
        _status("FACTORY_REGISTRY", *registry),
        _status("FACTORY_PROFILE", *profile),
        _status("WATER_LIST", *water),
        _status("AI_JUDGMENT", judged_at, judged[1], judged[2]),
    ]


def build_blocked(session: Session) -> list[BlockedTransfer]:
    """전송 기록의 거부 행 최근 10건. 이유만 싣고 본문·검색어는 없다(행에도 없다)."""
    rows = session.execute(
        select(
            TransferLog.occurred_at,
            TransferLog.purpose,
            TransferLog.kind,
            TransferLog.reject_reason,
        )
        .where(TransferLog.decision == "REJECTED")
        .order_by(TransferLog.occurred_at.desc(), TransferLog.transfer_log_id.desc())
        .limit(BLOCKED_LIMIT)
    ).all()
    return [BlockedTransfer(*row) for row in rows]


def build_operations(session: Session, settings: AppSettings, now: datetime) -> Operations:
    today = now.astimezone(KST).date()
    return Operations(
        usage=build_usage(session, settings, now),
        sources=build_sources(session, settings, today),
        blocked=build_blocked(session),
        contact_reveals=build_contact_reveals(session, settings),
    )


REVEAL_LIMIT = 50


def build_contact_reveals(session: Session, settings: AppSettings) -> list[ContactRevealLine]:
    """#980 가린 연락처·메모를 연 기록 최근 50건(최신 먼저). 연 값은 싣지 않는다."""
    from geosan.opportunity.models import Customer, Opportunity
    from geosan.records.models import ContactReveal

    names = {entry.key: entry.display_name for entry in settings.staff}
    rows = session.execute(
        select(
            ContactReveal.created_at,
            ContactReveal.staff_key,
            ContactReveal.opp_id,
            Customer.name,
            ContactReveal.contact_id,
        )
        .join(Opportunity, Opportunity.opp_id == ContactReveal.opp_id)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .order_by(ContactReveal.created_at.desc(), ContactReveal.reveal_id.desc())
        .limit(REVEAL_LIMIT)
    ).all()
    return [
        ContactRevealLine(
            at=at,
            staff_key=staff,
            staff_name=names.get(staff, staff),
            opp_id=opp_id,
            customer_name=name,
            kind="CONTACT" if contact_id else "NOTE",
        )
        for at, staff, opp_id, name, contact_id in rows
    ]


def operation_alerts(
    session: Session, settings: AppSettings, staff_key: str | None, now: datetime
) -> list[OperationAlert]:
    """대시보드 "오늘 확인할 것" 맨 앞 알림 줄. 기록 담당자가 아니면 없다.

    한도 도달은 모든 기록 담당자에게(조사·코치가 멈추므로), 사용률·자료 갱신은 운영 담당에게만.
    """
    if staff_key is None or not settings.is_recording_staff(staff_key):
        return []
    llm = settings.llm
    calls, cost = month_usage(session, llm, now=now)
    limit = Decimal(str(llm.monthly_cost_limit_usd))
    percent = int((cost / limit * 100).to_integral_value()) if limit > 0 else None
    alerts: list[OperationAlert] = []
    reached = (limit > 0 and cost >= limit) or (
        llm.monthly_call_limit > 0 and calls >= llm.monthly_call_limit
    )
    if reached:
        alerts.append(
            OperationAlert(ALERT_AI_LIMIT, used_usd=cost, limit_usd=limit, percent=percent)
        )
    operations = is_operations_staff(settings, staff_key)
    if (
        operations
        and not reached
        and limit > 0
        and cost >= limit * Decimal(str(llm.cost_alert_ratio))
    ):
        alerts.append(
            OperationAlert(ALERT_AI_USAGE, used_usd=cost, limit_usd=limit, percent=percent)
        )
    if operations:
        factory = _factory_file_status(session, settings, now.astimezone(KST).date())
        if factory.refresh_overdue:
            alerts.append(
                OperationAlert(
                    ALERT_DATA_REFRESH, as_of=factory.as_of, due_at=factory.refresh_due_at
                )
            )
    return alerts
