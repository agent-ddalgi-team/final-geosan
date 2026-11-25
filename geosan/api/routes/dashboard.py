"""대시보드 경로 (U7, 계약 C1 `GET /dashboard` v3). 응답 모양은 이 파일에 둔다(경로 묶음별 모델)."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field

from geosan.api.check_points import check_left_opp_ids
from geosan.api.deps import SessionDep, current_account, runtime_for
from geosan.api.operations import operation_alerts
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.opportunities import list_filters, supported_filters
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import AppError
from geosan.dashboard.map_points import build_map_points, build_visit_groups
from geosan.dashboard.queries import (
    BOARD_KEYS,
    BOOKMARKED_KEY,
    TODAY_CHECK_LEFT,
    WON_KEY,
    BreakdownSource,
    bookmarked_opp_ids,
    bookmarked_won_ids,
    build_dashboard,
    classify_bookmarked,
    dashboard_population,
    schedule_due_opp_ids,
)
from geosan.dashboard.queries import TodayCheckRow as TodayCheckRowData
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.transfer import KST
from geosan.storage.base import utcnow

router = APIRouter()


class MapCenter(_ApiModel):
    lat: float
    lng: float


class MapPoint(MapCenter):
    opp_id: str
    customer_name: str
    group: Literal["INTERESTED", "IN_PROGRESS", "WON_THIS_YEAR"]
    distance_km: float


class VisitNearby(MapCenter):
    """ "같이 들를 곳"의 근처 관심 기업(#673). distance_km는 묶음 중심 회사에서의 직선거리."""

    opp_id: str
    customer_name: str
    distance_km: float
    group: Literal["INTERESTED", "IN_PROGRESS", "WON_THIS_YEAR"]


class VisitGroup(_ApiModel):
    """방문할 회사(points 가운데 진행 중·관심) 하나와 그 반경 안의 근처 회사(가까운 순)."""

    opp_id: str
    # 이 회사에 쓴 반경(km). 기본 반경 안이 기준 곳 수 미만이면 넓힌 반경이다(#743).
    radius_km: float
    nearby: list[VisitNearby]


class DashboardMap(_ApiModel):
    center: MapCenter
    rings_km: list[float]
    points: list[MapPoint]
    missing_coordinates: int
    as_of: datetime
    visit_radius_km: float
    # 기본 반경 안 관심 기업이 이 수 미만이면 그 회사만 넓힌다(설정, #743).
    visit_widen_below_count: int
    visit_groups: list[VisitGroup]


DashboardMapEnvelope = Envelope[DashboardMap]


@router.get("/dashboard/map", response_model=DashboardMapEnvelope)
def dashboard_map(response: Response, session: SessionDep):
    """지도 전용 읽기. 내부 메모·연락처·대표번호·주소는 응답 모델에 없다."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    settings = runtime_for(session).app_settings
    if settings.geosan.lat is None or settings.geosan.lng is None:
        raise AppError(
            "거산의 기준 좌표가 준비되지 않았습니다.",
            "운영 담당자가 거산의 기준 좌표를 등록한 뒤 다시 열어 주세요.",
            status=503,
        )
    now = utcnow()
    points, missing = build_map_points(session, settings, now, tz=KST)
    visit_groups = build_visit_groups(settings, points)
    return DashboardMapEnvelope(
        data=DashboardMap(
            center=MapCenter(lat=settings.geosan.lat, lng=settings.geosan.lng),
            rings_km=settings.distance_filter_presets_km,
            points=[MapPoint.model_validate(point) for point in points],
            missing_coordinates=missing,
            as_of=now,
            visit_radius_km=settings.visit_group_radius_km,
            visit_widen_below_count=settings.visit_group_widen_below_count,
            visit_groups=[VisitGroup.model_validate(group) for group in visit_groups],
        ),
        meta=Meta(
            updated_at=now,
            dataset_kind=settings.active_dataset_kind,
            has_virtual_data=False,
        ),
    )


SCHEDULE_DUE_FILTER = "SCHEDULE_DUE"
# 대시보드 칸을 누르면 열리는 목록 `?filter=<칸>` 값 8개(#356, #536에서 제외 칸 삭제).
BOARD_FILTERS = frozenset({BOOKMARKED_KEY, *BOARD_KEYS})

ActivityKind = Literal["NOTE", "STAGE", "CONTACT_ATTEMPT", "SCHEDULE", "OPINION"]


class DashboardCounts(_ApiModel):
    """관심으로 켜 둔 기회만 센다(#356). 누르면 /opportunities?filter=<키>
    (BOOKMARKED는 ?bookmarked=true). 일정 칸을 뺀 일곱 칸의 합은 BOOKMARKED와 같다.
    검토 대상 제외로 저장한 회사는 관심 기업이 아니라서 칸이 없다(#536)."""

    # 계약의 건수 키는 대문자 코드 그대로다(camelCase로 바꾸지 않는다).
    bookmarked: int = Field(alias="BOOKMARKED")
    no_opinion: int = Field(alias="NO_OPINION")
    need_check: int = Field(alias="NEED_CHECK")
    not_contacted: int = Field(alias="NOT_CONTACTED")
    in_contact: int = Field(alias="IN_CONTACT")
    quote_sample: int = Field(alias="QUOTE_SAMPLE")
    on_hold: int = Field(alias="ON_HOLD")
    done: int = Field(alias="DONE")
    schedule_due: int = Field(alias="SCHEDULE_DUE")
    # #766: 관심 기업 가운데 최신 단계 성사. DONE의 일부라 칸 합계에는 넣지 않는다.
    won: int = Field(alias="WON")


class ScheduleItem(_ApiModel):
    opp_id: str
    customer_name: str
    opp_title: str
    due_at: date
    note: str
    overdue: bool
    staff_key: str


class RecentActivityItem(_ApiModel):
    at: datetime
    opp_id: str
    customer_name: str
    kind: ActivityKind
    summary: str


class BreakdownBasis(_ApiModel):
    """막대에 세는 "대시보드 대상": 관심 / 진행 중 / 최근 12개월 성공. total은 그 기회 수."""

    statuses: list[str]
    total: int


class ProcessBreakdownItem(_ApiModel):
    process_code: str
    process_name: str
    count: int
    ratio: float


class IndustryBreakdownItem(_ApiModel):
    industry: str
    count: int
    ratio: float
    includes_proposed: bool


class DashboardBreakdown(_ApiModel):
    """공정별·산업군별 막대(#627). ratio = count ÷ basis.total, 소수 2자리."""

    basis: BreakdownBasis
    by_process: list[ProcessBreakdownItem]
    by_industry: list[IndustryBreakdownItem]


class TodayCheckItem(_ApiModel):
    """회사 이름·날짜·일정 한 줄. 연락처·대표번호는 이 모델에 없다. 메모 글은 "나에게 온 전달
    사항" 줄의 text(받는 사람 본인에게, 앞 80자)뿐이다(#794)."""

    opp_id: str
    customer_name: str
    due_at: date | None = None
    note: str | None = None
    # #766: 일정 줄만. 그 일정이 실린 최신 영업 기록 번호(지난 일정 단추의 expectedVersion).
    outcome_version: int | None = None
    # #794: HANDOFF_FOR_ME 줄만. 가장 최근 확인 전 전달 글 앞 80자(넘으면 "…"). 다른 줄은 null.
    # #854: HANDOFF_FROM_ME 줄도 같은 자르기로 보낸 글 앞부분.
    text: str | None = None
    # #854: HANDOFF_FOR_ME 줄만. 그 회사에서 나에게 온 확인 전 전달 사항 번호 전부(최신 먼저).
    # 화면 [확인]이 번호마다 POST /notes/{noteId}/confirm을 부른다. 다른 줄은 null.
    note_ids: list[str] | None = None


class TodayAlert(_ApiModel):
    """#799 운영 알림 줄의 숫자. AI 줄은 사용액·한도·%, 자료 갱신 줄은 기준일·권장일."""

    used_usd: float | None = None
    limit_usd: float | None = None
    percent: int | None = None
    as_of: date | None = None
    due_at: date | None = None


class TodayCheckRow(_ApiModel):
    """맨 위 "오늘 확인할 것"의 한 줄(#679). kind 값은 뒤에 늘 수 있다(#677)."""

    kind: Literal[
        "SCHEDULE_TODAY",
        "SCHEDULE_OVERDUE",
        "CHECK_LEFT",
        "HANDOFF_FOR_ME",
        "HANDOFF_FROM_ME",
        "AI_USAGE_ALERT",
        "AI_LIMIT_REACHED",
        "DATA_REFRESH_DUE",
    ]
    count: int
    items: list[TodayCheckItem]
    # 누르면 열 목록의 `?filter=` 값. null이면 화면이 줄 아래에 작은 목록을 편다.
    list_filter: str | None = None
    # #799: 운영 알림 세 줄(회사가 아니라 count 1·items 빈 배열)만. 다른 줄은 null.
    alert: TodayAlert | None = None


class ProgressCompany(_ApiModel):
    """#800 영업 진행 띠 칸을 눌렀을 때 펴지는 회사 한 줄. 메모·연락처·대표번호는 없다."""

    opp_id: str
    customer_name: str
    last_contact_at: date | None
    next_schedule_at: date | None
    # 최신 영업 기록의 일정 한 줄(schedule.note와 같은 값). 메모 글이 아니다.
    next_schedule_note: str | None
    # 접촉·견적 칸이고 다음 일정 없이 마지막 접촉 뒤 설정 dashboard.stalledAfterDays일 이상.
    stalled: bool
    # #921(PM 결정 2026-11-25): 영업 홈 "진행 중인 회사" 표의 마지막 접촉 방식과 담당.
    # 방식은 접촉 기록의 코드값, 담당은 그 접촉을 적은 사람(키 + 설정의 표시 이름). 접촉이 없으면 null.
    last_contact_method: Literal["CALL", "EMAIL", "VISIT"] | None = None
    last_contact_staff_key: str | None = None
    last_contact_staff_name: str | None = None


class Dashboard(_ApiModel):
    counts: DashboardCounts
    schedule: list[ScheduleItem]
    recent_activity: list[RecentActivityItem]
    as_of: datetime
    # 가상 묶음이면 없다(null, 가상 사례는 집계에서 제외). 없으면 화면이 막대 줄을 숨긴다.
    breakdown: DashboardBreakdown | None = None
    # 0건인 줄은 없다. 모두 0건이면 빈 배열이다.
    today_checks: list[TodayCheckRow] = Field(default_factory=list)
    # #800: 칸 이름(NOT_CONTACTED·IN_CONTACT·QUOTE_SAMPLE·WON·ON_HOLD) → 회사.
    # 목록 길이는 counts의 그 칸 숫자와 같다.
    progress_companies: dict[str, list[ProgressCompany]] = Field(default_factory=dict)


DashboardEnvelope = Envelope[Dashboard]


def schedule_due_list_filter(session, query, request: Request):
    """추천 목록 `?filter=SCHEDULE_DUE`: 대시보드 '이번 주 일정' 건수와 같은 기준으로 거른다.

    `opportunities.py`의 지원 값(`supported_filters`)과 거르기 자리(`list_filters`)에 등록만 한다.
    연결되지 않은 값(다른 filter 값·탭)을 막는 입력 검사는 목록 쪽 첫 검사가 맡는다.
    """
    if request.query_params.get("filter") != SCHEDULE_DUE_FILTER:
        return query
    today = utcnow().astimezone(KST).date()
    return query.where(EvaluationRun.opp_id.in_(schedule_due_opp_ids(today)))


def bookmark_board_list_filter(session, query, request: Request):
    """추천 목록 `?filter=<대시보드 칸>`: 대시보드와 같은 분류 함수로 거른다(#356).

    `BOOKMARKED`는 관심 기업 전체, 나머지 일곱 값은 그 칸에 든 관심 기업만 남긴다.
    """
    key = request.query_params.get("filter")
    if key not in BOARD_FILTERS:
        return query
    classified = classify_bookmarked(session)
    opp_ids = [
        opp_id for opp_id, board in classified.items() if key == BOOKMARKED_KEY or board == key
    ]
    return query.where(EvaluationRun.opp_id.in_(opp_ids))


def won_list_filter(session, query, request: Request):
    """목록 `?filter=WON`: 대시보드 "영업 진행" 띠의 "성사" 칸과 같은 계산(#766)."""
    if request.query_params.get("filter") != WON_KEY:
        return query
    return query.where(EvaluationRun.opp_id.in_(bookmarked_won_ids(session)))


def _catalog_codes(session, dataset_kind) -> frozenset[str]:
    return frozenset(row.code for row in load_process_catalog(session, dataset_kind))


def check_left_list_filter(session, query, request: Request):
    """목록 `?filter=CHECK_LEFT`: 대시보드 "확인할 것이 남은 관심 회사"와 같은 계산(#679)."""
    if request.query_params.get("filter") != TODAY_CHECK_LEFT:
        return query
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind
    opp_ids = check_left_opp_ids(
        session, list(session.scalars(bookmarked_opp_ids())), _catalog_codes(session, dataset_kind)
    )
    return query.where(EvaluationRun.opp_id.in_(opp_ids))


supported_filters.add(SCHEDULE_DUE_FILTER)
supported_filters.update(BOARD_FILTERS)
supported_filters.add(TODAY_CHECK_LEFT)
supported_filters.add(WON_KEY)
for _list_filter in (
    schedule_due_list_filter,
    bookmark_board_list_filter,
    check_left_list_filter,
    won_list_filter,
):
    if _list_filter not in list_filters:
        list_filters.append(_list_filter)


def _my_staff_key(session, runtime, staff_key):
    """최근 내 기록의 담당자. 계정 방식(#754)이면 로그인한 사람, 보기 전용이면 None."""
    account = current_account(session)
    if account is not None:
        staff_key = account.staff_key
    return staff_key if runtime.app_settings.is_recording_staff(staff_key) else None


@router.get("/dashboard", response_model=DashboardEnvelope)
def dashboard(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """건수 10칸·이번 주 일정·최근 내 기록·공정/산업군 막대·오늘 확인할 것 줄.

    보기 전용(담당자 키 없음)이면 최근 기록만 비어 있다.
    """
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    now = utcnow()
    catalog = load_process_catalog(session, dataset_kind)
    # "확인할 것이 남은 관심 회사"(#679)는 카드와 같은 계산(api 쪽)이라 창구가 구해 넘긴다.
    check_left = check_left_opp_ids(
        session,
        list(session.scalars(dashboard_population(dataset_kind.value))),
        frozenset(row.code for row in catalog),
    )
    result = build_dashboard(
        session,
        dataset_kind=dataset_kind.value,
        staff_key=_my_staff_key(session, runtime, staff_key),
        today=now.astimezone(KST).date(),
        now=now,
        breakdown_source=BreakdownSource(
            processes=[(row.code, row.name) for row in catalog],
            industries=runtime.app_settings.industries,
            count_proposed_industries=runtime.app_settings.dashboard.count_proposed_industries,
        ),
        check_left_opp_ids=check_left,
        staff_names={entry.key: entry.display_name for entry in runtime.app_settings.staff},
        # #853: 내가 속한 전달 역할 묶음(예: 영업)으로 온 전달 사항도 "나에게 온 전달 사항"에.
        staff_teams=runtime.app_settings.handoff_teams_of(
            _my_staff_key(session, runtime, staff_key)
        ),
        # #854: "내가 보낸 전달 사항" 줄의 받는 쪽이 역할 묶음이면 그 이름(예: 영업).
        team_names={team.key: team.label for team in runtime.app_settings.handoff_teams},
        stalled_after_days=runtime.app_settings.dashboard.stalled_after_days,
    )
    # #799: 운영 알림 줄을 맨 앞에 둔다(메뉴 숫자 #770은 곳 수라 이 줄을 세지 않는다).
    alerts = operation_alerts(
        session, runtime.app_settings, _my_staff_key(session, runtime, staff_key), now
    )
    result.data.today_checks[:0] = [
        TodayCheckRowData(kind=alert.kind, count=1, items=[], alert=alert) for alert in alerts
    ]
    return DashboardEnvelope(
        data=Dashboard.model_validate(result.data, from_attributes=True),
        meta=Meta(
            updated_at=now, dataset_kind=dataset_kind, has_virtual_data=result.has_virtual_data
        ),
    )
