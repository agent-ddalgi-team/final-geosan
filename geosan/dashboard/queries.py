"""대시보드 집계 (계약 C1 `GET /dashboard` v3, 이슈 #216·#356).

읽는 곳은 기록 표(관심·단계·일정·메모·의견)와 최근 확정 평가의 대상 목록뿐이다.
평가 점수·분류는 섞지 않는다.
건수는 **관심으로 켜 둔 기회만** 센다(#356). 대상 범위는 추천 목록(`GET /opportunities`)과
같다: 활성 거산 묶음의 최근 확정 전체 평가 안에 있는 기회. 칸 나누기는 `classify_bookmarked`
한 곳이 맡고 목록 거르기(`?filter=<칸>`)도 같은 함수를 써서, 칸의 숫자와 눌러 열리는 목록
건수가 늘 같다.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from geosan.evaluation.ledger import latest_full_batch
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Bookmark, Note, Outcome, ReviewOpinion

# 계약 C1: "이번 주 일정" = 기한이 지난 것부터 오늘 + 7일까지.
SCHEDULE_WINDOW_DAYS = 7
# 계약 C1 Q4: 최근 내가 한 기록 10건.
RECENT_ACTIVITY_LIMIT = 10
# 이미 끝난 영업(성사·거절)에 남은 다음 일정은 앞으로 할 일이 아니므로 일정에서 뺀다.
CLOSED_STATUSES = ("WON", "LOST")

STAGE_LABELS = {
    "NOT_EXECUTED": "미접촉",
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


# 계약 C1(#356): 관심 기업 전체 칸과, 관심 기업 하나가 꼭 하나에만 드는 여덟 칸.
BOOKMARKED_KEY = "BOOKMARKED"
BOARD_KEYS = (
    "NO_OPINION",
    "NEED_CHECK",
    "NOT_TARGET",
    "NOT_CONTACTED",
    "IN_CONTACT",
    "QUOTE_SAMPLE",
    "ON_HOLD",
    "DONE",
)
# ② 최신 영업 단계 → 칸. 여기 없는 단계(기록 없음·NOT_EXECUTED)는 ③ 검토 의견으로 정한다.
_STAGE_BOARD_KEYS = {
    "IN_PROGRESS": "IN_CONTACT",
    "SAMPLE_OR_REGISTRATION_APPROVED": "QUOTE_SAMPLE",
    "ON_HOLD": "ON_HOLD",
    "WON": "DONE",
    "LOST": "DONE",
}
# ③ 접촉 전일 때 최신 검토 의견 → 칸. None은 의견을 아직 고르지 않은 기회다.
_OPINION_BOARD_KEYS = {
    "WORTH_REVIEW": "NOT_CONTACTED",
    "NEED_CHECK": "NEED_CHECK",
    None: "NO_OPINION",
}


@dataclass(frozen=True)
class DashboardCounts:
    bookmarked: int
    no_opinion: int
    need_check: int
    not_target: int
    not_contacted: int
    in_contact: int
    quote_sample: int
    on_hold: int
    done: int
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


def bookmarked_opp_ids(population=None):
    """관심으로 켜 둔 기회 번호를 고르는 select: 기회마다 마지막 관심 행이 '켬'인 것.

    대시보드 건수와 목록 거르기(`?bookmarked=true`, `?filter=<칸>`)가 이 한 곳을 같이 쓴다.
    """
    newest = select(Bookmark.opp_id, func.max(Bookmark.version).label("version")).group_by(
        Bookmark.opp_id
    )
    if population is not None:
        newest = newest.where(Bookmark.opp_id.in_(population))
    newest = newest.subquery()
    return (
        select(Bookmark.opp_id)
        .join(
            newest, and_(Bookmark.opp_id == newest.c.opp_id, Bookmark.version == newest.c.version)
        )
        .where(Bookmark.active.is_(True))
    )


def board_key(opinion: str | None, stage: str | None) -> str:
    """관심 기업 하나가 드는 칸(계약 C1 #356). 위에서부터 처음 맞는 칸 하나다.

    ① 최신 검토 의견이 검토 대상 제외 → NOT_TARGET
    ② 최신 영업 단계가 접촉·견적/샘플·보류·성사/거절 → IN_CONTACT·QUOTE_SAMPLE·ON_HOLD·DONE
    ③ 단계 기록이 없거나 미접촉 → 의견에 따라 NOT_CONTACTED·NEED_CHECK·NO_OPINION
    """
    if opinion == "NOT_TARGET":
        return "NOT_TARGET"
    if stage in _STAGE_BOARD_KEYS:
        return _STAGE_BOARD_KEYS[stage]
    if stage not in (None, "NOT_EXECUTED"):
        raise ValueError(f"모르는 영업 단계 값이라 대시보드 칸을 정할 수 없습니다: {stage!r}")
    if opinion not in _OPINION_BOARD_KEYS:
        raise ValueError(f"모르는 검토 의견 값이라 대시보드 칸을 정할 수 없습니다: {opinion!r}")
    return _OPINION_BOARD_KEYS[opinion]


def classify_bookmarked(session: Session, population=None) -> dict[str, str]:
    """관심으로 켜 둔 기회마다 드는 칸 이름. 관심이 아닌 기회는 결과에 없다.

    대시보드 건수와 목록 `?filter=<칸>`이 이 함수 하나를 같이 쓴다. `population`을 주면
    그 안의 기회만 본다(대시보드: 최근 확정 평가 대상). 안 주면 관심 기업 전체다(목록은
    자기 쪽에서 평가 대상과 AND 한다).
    """
    bookmarked = bookmarked_opp_ids(population)
    opp_ids = list(session.scalars(bookmarked))
    if not opp_ids:
        return {}
    # 상세·카드의 최신 의견(버전, 그다음 저장 시각)과 같은 순서로 마지막 행을 고른다.
    opinions: dict[str, str] = {}
    for opp_id, opinion in session.execute(
        select(ReviewOpinion.opp_id, ReviewOpinion.opinion)
        .where(ReviewOpinion.opp_id.in_(bookmarked))
        .order_by(ReviewOpinion.version, ReviewOpinion.recorded_at)
    ):
        opinions[opp_id] = opinion
    stages = {row.opp_id: row.status for row in _latest_outcomes(session, bookmarked)}
    return {opp_id: board_key(opinions.get(opp_id), stages.get(opp_id)) for opp_id in opp_ids}


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


def _counts(classified: dict[str, str], schedule_due: int) -> DashboardCounts:
    """칸별 건수. 여덟 칸의 합은 언제나 관심 기업 수(BOOKMARKED)와 같다."""
    tally = Counter(classified.values())
    return DashboardCounts(
        bookmarked=len(classified),
        schedule_due=schedule_due,
        **{key.lower(): tally[key] for key in BOARD_KEYS},
    )


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
        zero = _counts({}, 0)
        return DashboardResult(
            Dashboard(counts=zero, schedule=[], recent_activity=[], as_of=now), False
        )
    population = select(EvaluationRun.opp_id).where(EvaluationRun.batch_id == batch.batch_id)
    # 관심으로 켜 둔 기회만 센다. 관심이 아닌 기회는 어느 칸에도 들지 않는다(#356).
    classified = classify_bookmarked(session, population)
    schedule, due_count = _schedule(session, population, today)
    counts = _counts(classified, due_count)
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
