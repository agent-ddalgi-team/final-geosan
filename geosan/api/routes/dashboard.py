"""대시보드 경로 (U7, 계약 C1 `GET /dashboard` v3). 응답 모양은 이 파일에 둔다(경로 묶음별 모델)."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Request, Response
from pydantic import Field

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.routes.opportunities import list_filters, supported_filters
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import AppError
from geosan.dashboard.map_points import build_map_points, build_visit_groups
from geosan.dashboard.queries import (
    BOARD_KEYS,
    BOOKMARKED_KEY,
    BreakdownSource,
    build_dashboard,
    classify_bookmarked,
    schedule_due_opp_ids,
)
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
    """ "같이 들를 곳"의 근처 회사(#673). distance_km는 묶음 중심 회사에서의 직선거리."""

    opp_id: str
    customer_name: str
    distance_km: float
    group: Literal["INTERESTED", "IN_PROGRESS", "WON_THIS_YEAR"] | None


class VisitGroup(_ApiModel):
    """방문할 회사(points 가운데 진행 중·관심) 하나와 그 반경 안의 근처 회사(가까운 순)."""

    opp_id: str
    nearby: list[VisitNearby]


class DashboardMap(_ApiModel):
    center: MapCenter
    rings_km: list[float]
    points: list[MapPoint]
    missing_coordinates: int
    as_of: datetime
    visit_radius_km: float
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


class Dashboard(_ApiModel):
    counts: DashboardCounts
    schedule: list[ScheduleItem]
    recent_activity: list[RecentActivityItem]
    as_of: datetime
    # 가상 묶음이면 없다(null, 가상 사례는 집계에서 제외). 없으면 화면이 막대 줄을 숨긴다.
    breakdown: DashboardBreakdown | None = None


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


supported_filters.add(SCHEDULE_DUE_FILTER)
supported_filters.update(BOARD_FILTERS)
for _list_filter in (schedule_due_list_filter, bookmark_board_list_filter):
    if _list_filter not in list_filters:
        list_filters.append(_list_filter)


@router.get("/dashboard", response_model=DashboardEnvelope)
def dashboard(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """건수 10칸·이번 주 일정·최근 내 기록·공정/산업군 막대.

    보기 전용(담당자 키 없음)이면 최근 기록만 비어 있다.
    """
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    now = utcnow()
    result = build_dashboard(
        session,
        dataset_kind=dataset_kind.value,
        staff_key=staff_key if runtime.app_settings.is_recording_staff(staff_key) else None,
        today=now.astimezone(KST).date(),
        now=now,
        breakdown_source=BreakdownSource(
            processes=[(row.code, row.name) for row in load_process_catalog(session, dataset_kind)],
            industries=runtime.app_settings.industries,
            count_proposed_industries=runtime.app_settings.dashboard.count_proposed_industries,
        ),
    )
    return DashboardEnvelope(
        data=Dashboard.model_validate(result.data, from_attributes=True),
        meta=Meta(
            updated_at=now, dataset_kind=dataset_kind, has_virtual_data=result.has_virtual_data
        ),
    )
