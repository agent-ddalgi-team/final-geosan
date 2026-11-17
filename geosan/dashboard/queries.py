"""대시보드 집계 (계약 C1 `GET /dashboard` v3, 이슈 #216·#356).

읽는 곳은 기록 표(관심·단계·일정·메모·의견)와 회사별 최신 확정 평가뿐이다.
평가 점수·분류는 섞지 않는다.
건수는 **관심으로 켜 둔 기회만** 센다(#356). 대상 범위는 추천 목록(`GET /opportunities`)과
같다: 활성 거산 묶음에 속하며 최신 확정 평가가 있는 기회(#465). 전체 평가는 기다리지 않는다.
칸 나누기는 `classify_bookmarked`
한 곳이 맡고 목록 거르기(`?filter=<칸>`)도 같은 함수를 써서, 칸의 숫자와 눌러 열리는 목록
건수가 늘 같다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select, true
from sqlalchemy.orm import Session

from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
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
    # #731 프로그램이 남긴 변경 기록(공정·산업 확정, AI 제안 확정·물리침)
    "CHANGE": "변경 기록을 남김",
    # #742 영업 코치 피드백 가운데 담당자가 보고서에 남긴 줄
    "ADVICE": "피드백을 남김",
    # #750 영업 코치가 같은 호출에서 준 다음 통화에 물어볼 것
    "CALL_PREP": "통화 준비를 남김",
    "HANDOFF": "전달 사항을 남김",
}
METHOD_LABELS = {"CALL": "전화", "EMAIL": "메일", "VISIT": "방문"}
RESULT_LABELS = {"REACHED": "연결됨", "ABSENT": "부재", "DECLINED": "거절"}
# 화면에 보이는 말(#697, PM 결정 2026-11-13). 저장 값은 그대로다.
OPINION_LABELS = {
    "WORTH_REVIEW": "영업 대상",
    "NEED_CHECK": "검토 중",
    "NOT_TARGET": "제외",
}


# 계약 C1(#356, #536): 관심 기업 전체 칸과, 관심 기업 하나가 꼭 하나에만 드는 일곱 칸.
# 검토 대상 제외로 저장한 회사는 관심 기업이 아니므로 칸이 없다(#536).
BOOKMARKED_KEY = "BOOKMARKED"
# #766(PM 결정 2026-11-16): "영업 진행" 4칸 띠의 "성사" 칸.
# DONE(성사·거절)의 일부라 칸 합계에 넣지 않는다.
WON_KEY = "WON"
BOARD_KEYS = (
    "NO_OPINION",
    "NEED_CHECK",
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

# 계약 C1 breakdown: "대시보드 대상" = 관심 / 진행 중 / 최근 12개월 성공. 응답 basis.statuses에
# 계약에 적힌 이름 그대로 싣는다.
BREAKDOWN_STATUSES = (
    "INTERESTED",
    "IN_PROGRESS",
    "SAMPLE_OR_REGISTRATION_APPROVED",
    "WON_LAST_12M",
)
# 관심으로 켜 두고 아직 접촉 전(단계 기록 없음·미접촉)이면 "관심" 묶음이다(#356).
_INTERESTED_STAGES = (None, "NOT_EXECUTED")
_IN_PROGRESS_STAGES = ("IN_PROGRESS", "SAMPLE_OR_REGISTRATION_APPROVED")
# 계약 C1: 최근 12개월 성공 = 성사로 바뀐 기록이 오늘부터 365일 안.
WON_WINDOW_DAYS = 365
# 계약 C1: 산업군이 하나도 없는 회사는 맨 끝 "미확정" 줄에 센다.
UNCONFIRMED_INDUSTRY = "미확정"
# AI가 제안하고 사람이 아직 확정하지 않은 산업군의 출처 값(C6 industriesSource).
_PROPOSED_INDUSTRY_SOURCE = "AI"
# 가상 사례는 공정·산업군 집계에 세지 않는다(계약 C1). 가상 묶음에서는 막대를 만들지 않는다.
_VIRTUAL_DATASET_KIND = "VIRTUAL_REVIEWED"


@dataclass(frozen=True)
class BreakdownSource:
    """공정·산업군 막대를 만들 때 창구(API)가 넘겨 주는 재료.

    공정 목록은 역량 파일 순서의 (코드, 이름), 산업군 목록은 설정 `industries` 순서다.
    """

    processes: Sequence[tuple[str, str]]
    industries: Sequence[str]
    count_proposed_industries: bool


@dataclass(frozen=True)
class BreakdownBasis:
    statuses: list[str]
    total: int


@dataclass(frozen=True)
class ProcessBreakdownItem:
    process_code: str
    process_name: str
    count: int
    ratio: float


@dataclass(frozen=True)
class IndustryBreakdownItem:
    industry: str
    count: int
    ratio: float
    includes_proposed: bool


@dataclass(frozen=True)
class Breakdown:
    basis: BreakdownBasis
    by_process: list[ProcessBreakdownItem]
    by_industry: list[IndustryBreakdownItem]


@dataclass(frozen=True)
class DashboardCounts:
    bookmarked: int
    no_opinion: int
    need_check: int
    not_contacted: int
    in_contact: int
    quote_sample: int
    on_hold: int
    done: int
    schedule_due: int
    won: int = 0


@dataclass(frozen=True)
class ScheduleItem:
    opp_id: str
    customer_name: str
    opp_title: str
    due_at: date
    note: str
    overdue: bool
    staff_key: str
    # #766: 이 일정이 실린 최신 영업 기록 번호. "지난 일정" 단추가 expectedVersion으로 보낸다.
    outcome_version: int = 0


@dataclass(frozen=True)
class RecentActivityItem:
    at: datetime
    opp_id: str
    customer_name: str
    kind: str  # NOTE / STAGE / CONTACT_ATTEMPT / SCHEDULE / OPINION
    summary: str


# "오늘 확인할 것" 줄의 종류(#679, 계약 C1 todayChecks). 줄 순서도 이 순서다.
TODAY_SCHEDULE_TODAY = "SCHEDULE_TODAY"
TODAY_SCHEDULE_OVERDUE = "SCHEDULE_OVERDUE"
TODAY_CHECK_LEFT = "CHECK_LEFT"
# #771: 지금 담당자에게 온 확인 전 전달 사항이 있는 회사.
TODAY_HANDOFF_FOR_ME = "HANDOFF_FOR_ME"
# #854: 지금 담당자가 보냈는데 받는 사람이 아직 확인하지 않은 전달 사항이 있는 회사.
TODAY_HANDOFF_FROM_ME = "HANDOFF_FROM_ME"
_KST = ZoneInfo("Asia/Seoul")


@dataclass(frozen=True)
class TodayCheckItem:
    opp_id: str
    customer_name: str
    # 일정 줄만 날짜와 일정 한 줄이 있다. 메모 글·연락처는 싣지 않는다.
    due_at: date | None = None
    note: str | None = None
    # #766: 일정 줄만. 그 일정이 실린 최신 영업 기록 번호(지난 일정 단추의 expectedVersion).
    outcome_version: int | None = None
    # #794: "나에게 온 전달 사항" 줄만. 가장 최근 확인 전 전달 글의 앞부분(받는 사람 화면 전용).
    # #854: "내가 보낸 전달 사항" 줄도 같은 자르기로 보낸 글 앞부분(보낸 사람 화면 전용).
    text: str | None = None
    # #854: "나에게 온 전달 사항" 줄만. 그 회사에서 나에게 온 확인 전 전달 사항 번호 전부
    # (최신 먼저). 대시보드 [확인]이 번호마다 확인을 저장해 줄이 한 번에 빠지게 한다.
    note_ids: tuple[str, ...] | None = None


@dataclass(frozen=True)
class TodayCheckRow:
    kind: str
    count: int
    items: list[TodayCheckItem]
    # 누르면 열 목록의 `?filter=` 값. 없으면 화면이 줄 아래에 작은 목록을 편다.
    list_filter: str | None = None
    # #799: 운영 알림 줄(AI_USAGE_ALERT·AI_LIMIT_REACHED·DATA_REFRESH_DUE)만. 다른 줄은 None.
    alert: object | None = None


# #800(PM 결정 2026-11-16): 영업 진행 띠의 칸(브리핑 순서) + 띠 아래 "보류".
# 칸 숫자와 같은 분류를 쓴다.
PROGRESS_BAND_KEYS = ("NOT_CONTACTED", "IN_CONTACT", "QUOTE_SAMPLE", WON_KEY, "ON_HOLD")
# "멈춘 회사"를 보는 칸. 미접촉(접촉 없음)·성사·보류는 멈춤이 아니다.
_STALL_BANDS = ("IN_CONTACT", "QUOTE_SAMPLE")


@dataclass(frozen=True)
class ProgressCompany:
    """진행 띠 칸을 눌렀을 때 펴지는 회사 한 줄. 메모·연락처는 없다."""

    opp_id: str
    customer_name: str
    last_contact_at: date | None
    next_schedule_at: date | None
    # 최신 영업 기록의 일정 한 줄(schedule.note와 같은 값). 메모 글이 아니다.
    next_schedule_note: str | None
    stalled: bool


def stalled_company(
    band: str, last_contact: date | None, next_schedule: date | None, today: date, days: int
) -> bool:
    """멈춘 회사(#800): 접촉·견적 칸이고, 다음 일정이 없고, 마지막 접촉 뒤 `days`일 이상."""
    return (
        band in _STALL_BANDS
        and next_schedule is None
        and last_contact is not None
        and (today - last_contact).days >= days
    )


def _last_contacts(session: Session, opp_ids: list[str]) -> dict[str, date]:
    """기회마다 취소하지 않은 접촉 시도 행의 접촉 날짜 가운데 가장 늦은 날."""
    if not opp_ids:
        return {}
    return dict(
        session.execute(
            select(Outcome.opp_id, func.max(Outcome.attempted_at))
            .where(
                Outcome.opp_id.in_(opp_ids),
                Outcome.cancelled_at.is_(None),
                Outcome.method.is_not(None),
                Outcome.attempted_at.is_not(None),
            )
            .group_by(Outcome.opp_id)
        ).all()
    )


def build_progress_companies(
    session: Session,
    population,
    classified: Mapping[str, str],
    won_ids: Sequence[str],
    today: date,
    stalled_after_days: int,
) -> dict[str, list[ProgressCompany]]:
    """진행 띠 칸마다 회사 목록.

    칸은 건수와 같은 분류(`classified`, 성사는 `won_ids`)라 숫자와 늘 같다.

    순서: 멈춘 회사 → 다음 일정 가까운 순 → 마지막 접촉 오래된 순 → 이름.
    """
    bands: dict[str, list[str]] = {key: [] for key in PROGRESS_BAND_KEYS}
    for opp_id, key in classified.items():
        if key in bands:
            bands[key].append(opp_id)
    bands[WON_KEY] = list(won_ids)
    every = sorted({opp_id for ids in bands.values() for opp_id in ids})
    if not every:
        return {key: [] for key in PROGRESS_BAND_KEYS}
    names = dict(
        session.execute(
            select(Opportunity.opp_id, Customer.name)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(every))
        ).all()
    )
    latest = {row.opp_id: row for row in _latest_outcomes(session, population)}
    contacts = _last_contacts(session, every)
    result: dict[str, list[ProgressCompany]] = {}
    for key, ids in bands.items():
        rows = []
        for opp_id in ids:
            outcome = latest.get(opp_id)
            schedule = outcome.next_schedule_at if outcome else None
            last = contacts.get(opp_id)
            rows.append(
                ProgressCompany(
                    opp_id=opp_id,
                    customer_name=names[opp_id],
                    last_contact_at=last,
                    next_schedule_at=schedule,
                    next_schedule_note=(outcome.next_schedule_note or None) if schedule else None,
                    stalled=stalled_company(key, last, schedule, today, stalled_after_days),
                )
            )
        rows.sort(
            key=lambda row: (
                not row.stalled,
                row.next_schedule_at or date.max,
                row.last_contact_at or date.max,
                row.customer_name,
                row.opp_id,
            )
        )
        result[key] = rows
    return result


@dataclass(frozen=True)
class Dashboard:
    counts: DashboardCounts
    schedule: list[ScheduleItem]
    recent_activity: list[RecentActivityItem]
    as_of: datetime
    # 가상 묶음이거나 재료를 받지 않았으면 None. 화면은 None이면 막대 줄을 숨긴다.
    breakdown: Breakdown | None = None
    # 맨 위 "오늘 확인할 것" 줄 목록(#679). 0건인 줄은 없다.
    today_checks: list[TodayCheckRow] = field(default_factory=list)
    # #800: 영업 진행 띠 칸별 회사(칸 숫자와 같은 분류). 옛 호출은 빈 값.
    progress_companies: dict[str, list[ProgressCompany]] = field(default_factory=dict)


@dataclass(frozen=True)
class DashboardResult:
    data: Dashboard
    has_virtual_data: bool


def _month_day(value: date) -> str:
    return f"{value.month}/{value.day}"


def _latest_outcomes(session: Session, population) -> list[Outcome]:
    """기회마다 가장 새로 저장한 영업 기록 한 행. 잘못 입력으로 표시한 행은 뺀다(#253)."""
    newest = (
        select(Outcome.opp_id, func.max(Outcome.version).label("version"))
        .where(Outcome.opp_id.in_(population), Outcome.cancelled_at.is_(None))
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
    """관심 기업 하나가 드는 칸(계약 C1 #356·#536). 위에서부터 처음 맞는 칸 하나다.

    ① 최신 영업 단계가 접촉·견적/샘플·보류·성사/거절 → IN_CONTACT·QUOTE_SAMPLE·ON_HOLD·DONE
    ② 단계 기록이 없거나 미접촉 → 의견에 따라 NOT_CONTACTED·NEED_CHECK·NO_OPINION

    검토 대상 제외 의견을 저장하면 관심이 꺼지므로(#536) 관심 기업에 제외 의견은 없다.
    있으면 기록이 어긋난 것이라 숨기지 않고 오류로 알린다.
    """
    if opinion == "NOT_TARGET":
        raise ValueError(
            "관심 기업에 검토 대상 제외 의견인 회사가 있습니다. "
            "제외를 저장하면 관심이 꺼져야 합니다"
            " (#536). `geosan init-db`로 마이그레이션이 최신인지 확인해 주세요."
        )
    if stage in _STAGE_BOARD_KEYS:
        return _STAGE_BOARD_KEYS[stage]
    if stage not in (None, "NOT_EXECUTED"):
        raise ValueError(f"모르는 영업 단계 값이라 대시보드 칸을 정할 수 없습니다: {stage!r}")
    if opinion not in _OPINION_BOARD_KEYS:
        raise ValueError(f"모르는 검토 의견 값이라 대시보드 칸을 정할 수 없습니다: {opinion!r}")
    return _OPINION_BOARD_KEYS[opinion]


def bookmarked_won_ids(session: Session, population=None) -> list[str]:
    """관심 기업 가운데 최신 영업 단계가 성사(WON)인 기회(#766).

    대시보드 칸과 목록 거르기가 같이 쓴다.
    """
    bookmarked = bookmarked_opp_ids(population)
    return sorted(
        row.opp_id for row in _latest_outcomes(session, bookmarked) if row.status == "WON"
    )


def classify_bookmarked(session: Session, population=None) -> dict[str, str]:
    """관심으로 켜 둔 기회마다 드는 칸 이름. 관심이 아닌 기회는 결과에 없다.

    대시보드 건수와 목록 `?filter=<칸>`이 이 함수 하나를 같이 쓴다. `population`을 주면
    그 안의 기회만 본다(대시보드: 활성 묶음의 최신 확정 평가 대상). 안 주면 관심 기업 전체다(목록은
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
    # 잘못 입력으로 표시한 행은 빼고 최신 행을 고른다(#253).
    newest = (
        select(Outcome.opp_id, func.max(Outcome.version).label("version"))
        .where(Outcome.cancelled_at.is_(None))
        .group_by(Outcome.opp_id)
    )
    if population is not None:
        newest = newest.where(Outcome.opp_id.in_(population))
    newest = newest.subquery()
    return (
        select(Outcome)
        .join(newest, and_(Outcome.opp_id == newest.c.opp_id, Outcome.version == newest.c.version))
        .where(
            Outcome.next_schedule_at.is_not(None),
            # (바뀜 2026-11-14 #720 — PM 결정) 끝난 영업이라도 남아 있는 일정은 보인다.
            # 끝나는 저장은 남은 일정을 비우므로(#719), 남아 있는 것은 끝난 뒤 일부러 잡은
            # 일정이다(#279의 제외를 풂).
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
            outcome_version=row.version,
        )
        # 기한 지남이 맨 위, 그다음 날짜순(기한이 지난 날짜가 더 이르므로 날짜순이면 같은 결과다).
        for row in sorted(due, key=lambda r: (r.next_schedule_at, r.opp_id))
    ]
    return items, len(items)


HANDOFF_PREVIEW_CHARS = 80


def _handoff_preview(text: str | None) -> str | None:
    """#794 대시보드 한 줄용: 줄바꿈을 빈칸으로 모으고 앞 80자, 넘으면 끝에 "…"."""
    flat = " ".join((text or "").split())
    if not flat:
        return None
    if len(flat) <= HANDOFF_PREVIEW_CHARS:
        return flat
    return flat[:HANDOFF_PREVIEW_CHARS] + "…"


def _handoff_row(
    session: Session, population, staff_key: str, staff_names: Mapping[str, str]
) -> TodayCheckRow:
    """#771 나에게 온 확인 전 전달 사항. 회사마다 한 줄(가장 최근 전달), 보낸 사람·날짜와
    #794 전달 글 앞부분. 받는 사람 본인 화면에만 가므로 메모 화면 규칙(C4) 그대로다."""
    rows = session.execute(
        select(Note.note_id, Note.opp_id, Note.staff_key, Note.created_at, Customer.name, Note.text)
        .join(Opportunity, Note.opp_id == Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Note.kind == "HANDOFF",
            Note.to_staff_key == staff_key,
            Note.confirmed_at.is_(None),
            Note.cancelled_at.is_(None),
            Note.opp_id.in_(population),
        )
        .order_by(Note.created_at.desc(), Note.note_id)
    ).all()
    seen: dict[str, TodayCheckItem] = {}
    ids: dict[str, list[str]] = {}
    for note_id, opp_id, sender, created_at, name, text in rows:
        ids.setdefault(opp_id, []).append(note_id)
        if opp_id in seen:
            continue
        day = created_at.astimezone(_KST).date()
        note = f"{staff_names.get(sender, sender)} · {day.month}/{day.day}"
        seen[opp_id] = TodayCheckItem(opp_id, name, None, note, text=_handoff_preview(text))
    items = [replace(item, note_ids=tuple(ids[item.opp_id])) for item in seen.values()]
    return TodayCheckRow(kind=TODAY_HANDOFF_FOR_ME, count=len(items), items=items)


def _handoff_from_me_row(
    session: Session, population, staff_key: str, staff_names: Mapping[str, str]
) -> TodayCheckRow:
    """#854 내가 보냈는데 받는 사람이 아직 확인하지 않은 전달 사항. 회사마다 한 줄(가장 최근 전달),
    받는 사람·날짜와 전달 글 앞부분. 보낸 사람 본인 화면에만 간다(메모 화면 규칙 C4 그대로)."""
    rows = session.execute(
        select(Note.opp_id, Note.to_staff_key, Note.created_at, Customer.name, Note.text)
        .join(Opportunity, Note.opp_id == Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .where(
            Note.kind == "HANDOFF",
            Note.staff_key == staff_key,
            Note.confirmed_at.is_(None),
            Note.cancelled_at.is_(None),
            Note.opp_id.in_(population),
        )
        .order_by(Note.created_at.desc(), Note.note_id)
    ).all()
    seen: dict[str, TodayCheckItem] = {}
    for opp_id, receiver, created_at, name, text in rows:
        if opp_id in seen:
            continue
        day = created_at.astimezone(_KST).date()
        note = f"{staff_names.get(receiver or '', receiver or '')} · {day.month}/{day.day}"
        seen[opp_id] = TodayCheckItem(opp_id, name, None, note, text=_handoff_preview(text))
    return TodayCheckRow(kind=TODAY_HANDOFF_FROM_ME, count=len(seen), items=list(seen.values()))


def build_today_checks(
    session: Session,
    schedule: list[ScheduleItem],
    today: date,
    check_left_opp_ids: Sequence[str] | None = None,
    *,
    population=None,
    staff_key: str | None = None,
    staff_names: Mapping[str, str] | None = None,
) -> list[TodayCheckRow]:
    """맨 위 "오늘 확인할 것" 줄 목록(#679). AI 없이 저장된 값으로만 만든다.

    일정 두 줄은 달력이 쓰는 일정 목록(`schedule`)에서 그대로 골라 달력과 숫자가 어긋나지 않는다.
    "확인할 것이 남은 관심 회사"는 카드와 같은 계산이 창구 쪽(api)에 있어서, 창구가 계산한
    기회 번호를 받아 이름만 붙인다(이 부품은 api를 가져오지 않는다). 0건인 줄은 만들지 않는다.
    줄을 더할 때(예: #677 "다시 조사할 때")는 이 목록에 한 줄을 덧붙이면 된다.
    """

    def schedule_row(kind: str, picked: list[ScheduleItem]) -> TodayCheckRow:
        return TodayCheckRow(
            kind=kind,
            count=len(picked),
            items=[
                TodayCheckItem(
                    row.opp_id, row.customer_name, row.due_at, row.note, row.outcome_version
                )
                for row in picked
            ],
        )

    rows = [
        schedule_row(TODAY_SCHEDULE_TODAY, [row for row in schedule if row.due_at == today]),
        schedule_row(TODAY_SCHEDULE_OVERDUE, [row for row in schedule if row.overdue]),
    ]
    if staff_key and population is not None:
        rows.append(_handoff_row(session, population, staff_key, staff_names or {}))
        rows.append(_handoff_from_me_row(session, population, staff_key, staff_names or {}))
    if check_left_opp_ids:
        names = session.execute(
            select(Opportunity.opp_id, Customer.name)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(check_left_opp_ids))
            .order_by(Customer.name, Opportunity.opp_id)
        ).all()
        rows.append(
            TodayCheckRow(
                kind=TODAY_CHECK_LEFT,
                count=len(names),
                items=[TodayCheckItem(opp_id, name) for opp_id, name in names],
                list_filter=TODAY_CHECK_LEFT,
            )
        )
    return [row for row in rows if row.count > 0]


def _outcome_activity(session: Session, row: Outcome) -> tuple[str, str]:
    """영업 기록 한 행을 (종류, 한 줄 설명)으로 바꾼다. 앞선 기록과 비교해 종류를 정한다."""
    if row.method:
        method = METHOD_LABELS.get(row.method, row.method)
        result = RESULT_LABELS.get(row.result or "", "")
        return "CONTACT_ATTEMPT", f"{method} 시도, {result}" if result else f"{method} 시도"
    # 바로 앞의 살아 있는 기록과 견준다. 잘못 입력으로 표시한 행은 건너뛴다(#253).
    previous = session.scalar(
        select(Outcome)
        .where(
            Outcome.opp_id == row.opp_id,
            Outcome.version < row.version,
            Outcome.cancelled_at.is_(None),
        )
        .order_by(Outcome.version.desc())
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
        .where(
            Note.staff_key == staff_key,
            Note.opp_id.in_(population),
            Note.cancelled_at.is_(None),
        )
        .order_by(Note.created_at.desc(), Note.note_id.desc())
        .limit(RECENT_ACTIVITY_LIMIT)
    ):
        # 메모·답·자료 조사 글은 내부 전용이라(계약 C4) 요약에는 종류만 적고 본문은 싣지 않는다.
        summary = NOTE_SUMMARIES.get(note.kind, NOTE_SUMMARIES["MEMO"])
        entries.append((note.created_at, note.opp_id, "NOTE", summary))
    for outcome in session.scalars(
        select(Outcome)
        .where(
            Outcome.created_by == staff_key,
            Outcome.opp_id.in_(population),
            Outcome.cancelled_at.is_(None),
        )
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


def _counts(classified: dict[str, str], schedule_due: int, won: int = 0) -> DashboardCounts:
    """칸별 건수. 일곱 칸의 합은 언제나 관심 기업 수(BOOKMARKED)와 같다. 성사(WON)는 DONE의 일부."""
    tally = Counter(classified.values())
    return DashboardCounts(
        bookmarked=len(classified),
        schedule_due=schedule_due,
        won=won,
        **{key.lower(): tally[key] for key in BOARD_KEYS},
    )


def _ratio(count: int, total: int) -> float:
    """count ÷ total, 소수 2자리(0.5는 올림). 대상이 0곳이면 나누지 않고 0이다."""
    if total == 0:
        return 0.0
    return float(
        (Decimal(count) / Decimal(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    )


def _won_since(session: Session, opp_ids: list[str]) -> dict[str, datetime]:
    """지금 성사인 기회마다 성사로 바뀐 기록의 저장 시각.

    성사 뒤에 덧붙인 기록(일정·메모 수정)이 있어도 성사로 처음 바뀐 행의 시각을 쓴다.
    """
    since: dict[str, datetime] = {}
    if not opp_ids:
        return since
    for opp_id, status, created_at in session.execute(
        select(Outcome.opp_id, Outcome.status, Outcome.created_at)
        .where(Outcome.opp_id.in_(opp_ids), Outcome.cancelled_at.is_(None))
        .order_by(Outcome.opp_id, Outcome.version)
    ):
        if status != "WON":
            since.pop(opp_id, None)
        elif opp_id not in since:
            since[opp_id] = created_at
    return since


def breakdown_target_opp_ids(session: Session, population, now: datetime) -> list[str]:
    """막대에 세는 "대시보드 대상" 기회 번호(계약 C1 breakdown.basis).

    관심으로 켜 둔 기회 가운데 ① 아직 접촉 전(관심) ② 접촉·견적/샘플(진행 중)
    ③ 성사로 바뀐 지 365일 안(최근 12개월 성공)만 남긴다. 관심이 아닌 기회(미접촉)와
    보류·거절·12개월 이전 성공은 뺀다. 관심 기업 고르기와 최신 단계 읽기는 건수와 같은
    함수(`bookmarked_opp_ids`, `_latest_outcomes`)를 쓴다.
    """
    bookmarked = bookmarked_opp_ids(population)
    opp_ids = list(session.scalars(bookmarked))
    if not opp_ids:
        return []
    stages = {row.opp_id: row.status for row in _latest_outcomes(session, bookmarked)}
    won_since = _won_since(session, [opp_id for opp_id in opp_ids if stages.get(opp_id) == "WON"])
    oldest_won = now - timedelta(days=WON_WINDOW_DAYS)
    targets = []
    for opp_id in opp_ids:
        stage = stages.get(opp_id)
        if stage in _INTERESTED_STAGES or stage in _IN_PROGRESS_STAGES:
            targets.append(opp_id)
        elif stage == "WON" and won_since[opp_id] >= oldest_won:
            targets.append(opp_id)
    return targets


def build_breakdown(
    session: Session, population, source: BreakdownSource, now: datetime
) -> Breakdown:
    """공정별·산업군별 막대(계약 C1 breakdown). 읽기만 한다.

    공정은 목록의 공정 건수와 같은 방식으로 센다(교체된 연결은 빼고, 같은 기회·공정은 한 번).
    한 회사가 여러 공정·산업군이면 각각 세므로 비율의 합이 1을 넘을 수 있다.
    """
    targets = breakdown_target_opp_ids(session, population, now)
    total = len(targets)
    codes_by_opportunity: dict[str, set[str]] = {}
    industries_by_opportunity: dict[str, tuple[list[str], bool]] = {}
    if targets:
        for opp_id, code in session.execute(
            select(OppProcessLink.opp_id, OppProcessLink.process_code)
            .where(OppProcessLink.opp_id.in_(targets), OppProcessLink.superseded_at.is_(None))
            .distinct()
        ):
            codes_by_opportunity.setdefault(opp_id, set()).add(code)
        for opp_id, industries, industries_source in session.execute(
            select(Opportunity.opp_id, Customer.industries, Customer.industries_source)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(targets))
        ):
            proposed = industries_source == _PROPOSED_INDUSTRY_SOURCE
            # 설정을 끄면 AI 제안뿐인 회사는 산업군이 없는 것으로 보고 "미확정"에 센다.
            counted = [] if proposed and not source.count_proposed_industries else industries
            industries_by_opportunity[opp_id] = (
                [name for name in counted or [] if name in source.industries],
                proposed,
            )
    by_process = [
        ProcessBreakdownItem(
            process_code=code,
            process_name=name,
            count=(count := sum(code in codes for codes in codes_by_opportunity.values())),
            ratio=_ratio(count, total),
        )
        for code, name in source.processes
    ]
    by_industry = []
    for name in source.industries:
        holders = [
            proposed for names, proposed in industries_by_opportunity.values() if name in names
        ]
        by_industry.append(
            IndustryBreakdownItem(
                industry=name,
                count=len(holders),
                ratio=_ratio(len(holders), total),
                includes_proposed=any(holders),
            )
        )
    unconfirmed = sum(not names for names, _ in industries_by_opportunity.values())
    by_industry.append(
        IndustryBreakdownItem(
            industry=UNCONFIRMED_INDUSTRY,
            count=unconfirmed,
            ratio=_ratio(unconfirmed, total),
            includes_proposed=False,
        )
    )
    return Breakdown(
        basis=BreakdownBasis(statuses=list(BREAKDOWN_STATUSES), total=total),
        by_process=by_process,
        by_industry=by_industry,
    )


def dashboard_population(dataset_kind: str):
    """관심 켠 기회의 최신 확정 평가·활성 묶음 범위를 대시보드와 지도가 공유한다."""
    # latest_confirmed_evaluation과 같은 순서로 최신 확정 평가를 먼저 고른다.
    # 묶음 조건을 먼저 걸면 다른 묶음으로 바뀐 회사의 낡은 평가가 다시 잡힐 수 있다.
    confirmed = (
        select(
            EvaluationRun.opp_id,
            EvaluationRun.dataset_kind.label("run_dataset_kind"),
            EvaluationBatch.dataset_kind.label("batch_dataset_kind"),
            func.row_number()
            .over(
                partition_by=EvaluationRun.opp_id,
                order_by=(EvaluationRun.created_at.desc(), EvaluationRun.eval_id.desc()),
            )
            .label("position"),
        )
        .join(EvaluationBatch, EvaluationRun.batch_id == EvaluationBatch.batch_id)
        .where(
            EvaluationRun.run_status == "CONFIRMED",
            EvaluationBatch.status == "CONFIRMED",
            EvaluationRun.opp_id.in_(bookmarked_opp_ids()),
        )
        .subquery()
    )
    population = (
        select(Opportunity.opp_id)
        .join(Customer, Opportunity.customer_id == Customer.customer_id)
        .join(confirmed, confirmed.c.opp_id == Opportunity.opp_id)
        .where(
            confirmed.c.position == 1,
            confirmed.c.run_dataset_kind == dataset_kind,
            confirmed.c.batch_dataset_kind == dataset_kind,
            # 회사의 원본 자료 표시는 검수 전환 뒤에도 BROCHURE로 남을 수 있다.
            # 현재 기준은 평가 묶음으로 고르고, 가상 회사와 실제 회사는 분리한다.
            Opportunity.is_virtual.is_(dataset_kind == "VIRTUAL_REVIEWED"),
            Customer.is_virtual.is_(dataset_kind == "VIRTUAL_REVIEWED"),
        )
    )
    return population


# 왼쪽 메뉴 📊 숫자(#770)에 넣는 "오늘 확인할 것" 줄. "확인할 것이 남은 관심 기업"은 넣지 않는다.
MENU_BADGE_TODAY_KINDS = (TODAY_SCHEDULE_OVERDUE, TODAY_SCHEDULE_TODAY, TODAY_HANDOFF_FOR_ME)


def today_badge_count(
    session: Session, *, dataset_kind: str, staff_key: str | None, today: date
) -> int:
    """왼쪽 메뉴 📊 숫자(#770): 오늘 확인할 것의 지난 일정 + 오늘 일정 + 나에게 온 전달 사항 곳 수.

    대시보드 줄과 같은 계산(`_schedule`·`build_today_checks`)을 그대로 불러 숫자가 어긋나지 않는다.
    """
    population = dashboard_population(dataset_kind)
    schedule, _due = _schedule(session, population, today)
    rows = build_today_checks(
        session, schedule, today, None, population=population, staff_key=staff_key
    )
    return sum(row.count for row in rows if row.kind in MENU_BADGE_TODAY_KINDS)


def bookmark_news_count(
    session: Session, *, dataset_kind: str, staff_key: str | None, since: datetime
) -> int:
    """왼쪽 메뉴 ⭐ 숫자(#770): since 뒤에 다른 사람이 기록·메모를 남겼거나 조사 결과가 새로 붙은
    관심 기업 수. staff_key가 없으면(보기 전용) 누가 남겼든 센다. 곳 수만 돌려준다."""
    population = dashboard_population(dataset_kind)
    outcome_by = Outcome.created_by != staff_key if staff_key else true()
    note_by = Note.staff_key != staff_key if staff_key else true()
    changed: set[str] = set(
        session.scalars(
            select(Outcome.opp_id).where(
                Outcome.opp_id.in_(population),
                Outcome.cancelled_at.is_(None),
                Outcome.created_at > since,
                outcome_by,
            )
        )
    )
    changed.update(
        session.scalars(
            select(Note.opp_id).where(
                Note.opp_id.in_(population),
                Note.cancelled_at.is_(None),
                Note.created_at > since,
                note_by,
            )
        )
    )
    changed.update(
        session.scalars(
            select(Opportunity.opp_id)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id.in_(population), Customer.researched_at > since)
        )
    )
    return len(changed)


def build_dashboard(
    session: Session,
    *,
    dataset_kind: str,
    staff_key: str | None,
    today: date,
    now: datetime,
    breakdown_source: BreakdownSource | None = None,
    check_left_opp_ids: Sequence[str] | None = None,
    staff_names: Mapping[str, str] | None = None,
    stalled_after_days: int = 14,
) -> DashboardResult:
    """오늘(`today`, 한국 날짜)과 지금(`now`)을 받아 계산한다. 시각을 직접 읽지 않는다(NFR12).

    `check_left_opp_ids`는 창구가 카드와 같은 계산으로 고른 "확인할 것이 남은 관심 회사"다(#679).

    `breakdown_source`를 주면 공정·산업군 막대도 만든다. 가상 묶음은 가상 사례뿐이라
    (집계에서 제외, 계약 C1) 막대를 만들지 않는다.
    """
    population = dashboard_population(dataset_kind)
    # 관심으로 켜 둔 기회만 센다. 관심이 아닌 기회는 어느 칸에도 들지 않는다(#356).
    classified = classify_bookmarked(session, population)
    schedule, due_count = _schedule(session, population, today)
    won_ids = bookmarked_won_ids(session, population)
    counts = _counts(classified, due_count, len(won_ids))
    has_virtual = bool(
        session.scalar(
            select(func.count())
            .select_from(Opportunity)
            .where(Opportunity.opp_id.in_(population), Opportunity.is_virtual.is_(True))
        )
    )
    breakdown = None
    if breakdown_source is not None and dataset_kind != _VIRTUAL_DATASET_KIND:
        breakdown = build_breakdown(session, population, breakdown_source, now)
    return DashboardResult(
        Dashboard(
            counts=counts,
            schedule=schedule,
            recent_activity=_recent_activity(session, population, staff_key),
            as_of=now,
            breakdown=breakdown,
            today_checks=build_today_checks(
                session,
                schedule,
                today,
                check_left_opp_ids,
                population=population,
                staff_key=staff_key,
                staff_names=staff_names,
            ),
            progress_companies=build_progress_companies(
                session, population, classified, won_ids, today, stalled_after_days
            ),
        ),
        has_virtual,
    )
