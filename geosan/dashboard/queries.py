"""대시보드 집계 (계약 C1 `GET /dashboard` v2, 이슈 #216).

읽는 곳은 기록 표(단계·일정·메모·의견)와 최근 확정 평가의 대상 목록뿐이다.
평가 점수·분류는 섞지 않는다.
세는 대상은 추천 목록(`GET /opportunities`)과 같다: 활성 거산 묶음의
최근 확정 전체 평가 안에 있는 기회. 그래서 대시보드 건수를 눌러 열리는
목록 건수와 같은 기준이 된다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from geosan.evaluation.ledger import latest_full_batch
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome, ReviewOpinion

# 계약 C1: "이번 주 일정" = 기한이 지난 것부터 오늘 + 7일까지.
SCHEDULE_WINDOW_DAYS = 7
# 계약 C1 Q4: 최근 내가 한 기록 10건.
RECENT_ACTIVITY_LIMIT = 10
# 이미 끝난 영업(성사·거절)에 남은 다음 일정은 앞으로 할 일이 아니므로 일정에서 뺀다.
CLOSED_STATUSES = ("WON", "LOST")

STAGE_LABELS = {
    "NOT_EXECUTED": "미접촉",
    "INTERESTED": "관심",
    "IN_PROGRESS": "접촉",
    "SAMPLE_OR_REGISTRATION_APPROVED": "견적·샘플",
    "ON_HOLD": "보류",
    "WON": "성사",
    "LOST": "거절",
}
# 메모 종류별 요약. 본문은 넣지 않는다(계약 C4: 메모·답 글은 대시보드 요약으로 안 나감).
NOTE_SUMMARIES = {
    "MEMO": "메모를 남김",
    "REPLY": "질문 답을 기록함",
    "RESEARCH": "자료 조사를 기록함",
}
METHOD_LABELS = {"CALL": "전화", "EMAIL": "메일", "VISIT": "방문"}
RESULT_LABELS = {"REACHED": "연결됨", "ABSENT": "부재", "DECLINED": "거절"}
OPINION_LABELS = {
    "WORTH_REVIEW": "검토 권고",
    "NEED_CHECK": "추가 확인 필요",
    "NOT_TARGET": "검토 대상 제외",
}


@dataclass(frozen=True)
class DashboardCounts:
    not_contacted: int
    interested: int
    in_contact: int
    quote_sample: int
    schedule_due: int


@dataclass(frozen=True)
class ScheduleItem:
    opp_id: str
    customer_name: str
    opp_title: str
    due_at: date
    note: str
    overdue: bool
    staff_key: str


@dataclass(frozen=True)
class RecentActivityItem:
    at: datetime
    opp_id: str
    customer_name: str
    kind: str  # NOTE / STAGE / CONTACT_ATTEMPT / SCHEDULE / OPINION
    summary: str


@dataclass(frozen=True)
class Dashboard:
    counts: DashboardCounts
    schedule: list[ScheduleItem]
    recent_activity: list[RecentActivityItem]
    as_of: datetime


@dataclass(frozen=True)
class DashboardResult:
    data: Dashboard
    has_virtual_data: bool


def _month_day(value: date) -> str:
    return f"{value.month}/{value.day}"


def _latest_outcomes(session: Session, population) -> list[Outcome]:
    """기회마다 가장 새로 저장한 영업 기록 한 행."""
    newest = (
        select(Outcome.opp_id, func.max(Outcome.version).label("version"))
        .where(Outcome.opp_id.in_(population))
        .group_by(Outcome.opp_id)
        .subquery()
    )
    return list(
        session.scalars(
            select(Outcome).join(
                newest, and_(Outcome.opp_id == newest.c.opp_id, Outcome.version == newest.c.version)
            )
        )
    )


def schedule_due_outcomes(today: date, population=None):
    """'이번 주 일정'에 드는 영업 기록(기회마다 최신 한 행)을 고르는 select.

    조건: 다음 일정이 있고, 끝나지 않은 영업(성사·거절 아님)이며, 일정일이 오늘 + 7일 이하
    (기한 지남 포함). 대시보드 건수·일정 카드와 목록 거르기(`?filter=SCHEDULE_DUE`)가 이
    한 곳을 같이 써서 눌렀을 때 열리는 목록 건수가 건수와 늘 같다.
    """
    newest = select(Outcome.opp_id, func.max(Outcome.version).label("version")).group_by(
        Outcome.opp_id
    )
    if population is not None:
        newest = newest.where(Outcome.opp_id.in_(population))
    newest = newest.subquery()
    return (
        select(Outcome)
        .join(newest, and_(Outcome.opp_id == newest.c.opp_id, Outcome.version == newest.c.version))
        .where(
            Outcome.next_schedule_at.is_not(None),
            Outcome.status.notin_(CLOSED_STATUSES),
            Outcome.next_schedule_at <= today + timedelta(days=SCHEDULE_WINDOW_DAYS),
        )
    )


def schedule_due_opp_ids(today: date):
    """목록 거르기용: '이번 주 일정'에 드는 기회 번호를 고르는 select."""
    return select(schedule_due_outcomes(today).subquery().c.opp_id)


def _schedule(session: Session, population, today: date) -> tuple[list[ScheduleItem], int]:
    due = list(session.scalars(schedule_due_outcomes(today, population)))
    if not due:
        return [], 0
    names = {
        opp_id: (customer_name, item)
        for opp_id, customer_name, item in session.execute(
            select(Opportunity.opp_id, Customer.name, Opportunity.item)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_([row.opp_id for row in due]))
        )
    }
    items = [
        ScheduleItem(
            opp_id=row.opp_id,
            customer_name=names[row.opp_id][0],
            opp_title=names[row.opp_id][1],
            due_at=row.next_schedule_at,
            note=row.next_schedule_note or "",
            overdue=row.next_schedule_at < today,
            staff_key=row.created_by,
        )
        # 기한 지남이 맨 위, 그다음 날짜순(기한이 지난 날짜가 더 이르므로 날짜순이면 같은 결과다).
        for row in sorted(due, key=lambda r: (r.next_schedule_at, r.opp_id))
    ]
    return items, len(items)


def _outcome_activity(session: Session, row: Outcome) -> tuple[str, str]:
    """영업 기록 한 행을 (종류, 한 줄 설명)으로 바꾼다. 앞선 기록과 비교해 종류를 정한다."""
    if row.method:
        method = METHOD_LABELS.get(row.method, row.method)
        result = RESULT_LABELS.get(row.result or "", "")
        return "CONTACT_ATTEMPT", f"{method} 시도, {result}" if result else f"{method} 시도"
    previous = session.scalar(
        select(Outcome).where(Outcome.opp_id == row.opp_id, Outcome.version == row.version - 1)
    )
    label = STAGE_LABELS.get(row.status, row.status)
    if previous is not None and previous.status == row.status:
        if (previous.next_schedule_at, previous.next_schedule_note) != (
            row.next_schedule_at,
            row.next_schedule_note,
        ):
            if row.next_schedule_at is None:
                return "SCHEDULE", "다음 일정을 비움"
            note = f" {row.next_schedule_note}" if row.next_schedule_note else ""
            return "SCHEDULE", f"다음 일정: {_month_day(row.next_schedule_at)}{note}"
        return "STAGE", label
    if previous is not None:
        return "STAGE", f"{STAGE_LABELS.get(previous.status, previous.status)} → {label}"
    return "STAGE", label


def _recent_activity(
    session: Session, population, staff_key: str | None
) -> list[RecentActivityItem]:
    """요청한 담당자가 남긴 최근 10건(메모·영업 기록·검토 의견). 담당자 키가 없으면 비어 있다."""
    if not staff_key:
        return []
    entries: list[tuple[datetime, str, str, str]] = []  # (시각, 기회, 종류, 설명)
    for note in session.scalars(
        select(Note)
        .where(Note.staff_key == staff_key, Note.opp_id.in_(population))
        .order_by(Note.created_at.desc(), Note.note_id.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ):
        # 메모·답·자료 조사 글은 내부 전용이라(계약 C4) 요약에는 종류만 적고 본문은 싣지 않는다.
        summary = NOTE_SUMMARIES.get(note.kind, NOTE_SUMMARIES["MEMO"])
        entries.append((note.created_at, note.opp_id, "NOTE", summary))
    for outcome in session.scalars(
        select(Outcome)
        .where(Outcome.created_by == staff_key, Outcome.opp_id.in_(population))
        .order_by(Outcome.created_at.desc(), Outcome.outcome_id.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ):
        kind, summary = _outcome_activity(session, outcome)
        entries.append((outcome.created_at, outcome.opp_id, kind, summary))
    for opinion in session.scalars(
        select(ReviewOpinion)
        .where(ReviewOpinion.staff_name == staff_key, ReviewOpinion.opp_id.in_(population))
        .order_by(ReviewOpinion.recorded_at.desc(), ReviewOpinion.opinion_id.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ):
        label = OPINION_LABELS.get(opinion.opinion, opinion.opinion)
        entries.append((opinion.recorded_at, opinion.opp_id, "OPINION", f"검토 의견: {label}"))
    entries.sort(key=lambda entry: entry[0], reverse=True)
    entries = entries[:RECENT_ACTIVITY_LIMIT]
    names = dict(
        session.execute(
            select(Opportunity.opp_id, Customer.name)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_({entry[1] for entry in entries}))
        ).all()
    )
    return [
        RecentActivityItem(
            at=at, opp_id=opp_id, customer_name=names.get(opp_id, ""), kind=kind, summary=summary
        )
        for at, opp_id, kind, summary in entries
    ]


def build_dashboard(
    session: Session,
    *,
    dataset_kind: str,
    staff_key: str | None,
    today: date,
    now: datetime,
) -> DashboardResult:
    """오늘(`today`, 한국 날짜)과 지금(`now`)을 받아 계산한다. 시각을 직접 읽지 않는다(NFR12)."""
    batch = latest_full_batch(session, dataset_kind=dataset_kind)
    if batch is None:
        zero = DashboardCounts(
            not_contacted=0, interested=0, in_contact=0, quote_sample=0, schedule_due=0
        )
        return DashboardResult(
            Dashboard(counts=zero, schedule=[], recent_activity=[], as_of=now), False
        )
    population = select(EvaluationRun.opp_id).where(EvaluationRun.batch_id == batch.batch_id)
    total = session.scalar(
        select(func.count(func.distinct(EvaluationRun.opp_id))).where(
            EvaluationRun.batch_id == batch.batch_id
        )
    )
    latest = _latest_outcomes(session, population)
    by_status: dict[str, int] = {}
    for row in latest:
        by_status[row.status] = by_status.get(row.status, 0) + 1
    # 기록이 없거나 최신 단계가 미접촉이면 미접촉이다(목록의 ?stage=NOT_EXECUTED와 같다).
    recorded = sum(count for status, count in by_status.items() if status != "NOT_EXECUTED")
    schedule, due_count = _schedule(session, population, today)
    counts = DashboardCounts(
        not_contacted=total - recorded,
        interested=by_status.get("INTERESTED", 0),
        in_contact=by_status.get("IN_PROGRESS", 0),
        quote_sample=by_status.get("SAMPLE_OR_REGISTRATION_APPROVED", 0),
        schedule_due=due_count,
    )
    has_virtual = bool(
        session.scalar(
            select(func.count())
            .select_from(Opportunity)
            .where(Opportunity.opp_id.in_(population), Opportunity.is_virtual.is_(True))
        )
    )
    return DashboardResult(
        Dashboard(
            counts=counts,
            schedule=schedule,
            recent_activity=_recent_activity(session, population, staff_key),
            as_of=now,
        ),
        has_virtual,
    )
