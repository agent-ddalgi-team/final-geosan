"""대시보드 경로 (U7, 계약 C1 `GET /dashboard` v2). 응답 모양은 이 파일에 둔다(경로 묶음별 모델)."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Request
from pydantic import Field

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.routes.opportunities import list_filters, supported_filters
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.dashboard.queries import build_dashboard, schedule_due_opp_ids
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.transfer import KST
from geosan.storage.base import utcnow

router = APIRouter()

SCHEDULE_DUE_FILTER = "SCHEDULE_DUE"

ActivityKind = Literal["NOTE", "STAGE", "CONTACT_ATTEMPT", "SCHEDULE", "OPINION"]


class DashboardCounts(_ApiModel):
    """누르면 /opportunities?stage=… (SCHEDULE_DUE만 ?filter=SCHEDULE_DUE)."""

    # 계약의 건수 키는 대문자 코드 그대로다(camelCase로 바꾸지 않는다).
    not_contacted: int = Field(alias="NOT_CONTACTED")
    interested: int = Field(alias="INTERESTED")
    in_contact: int = Field(alias="IN_CONTACT")
    quote_sample: int = Field(alias="QUOTE_SAMPLE")
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


class Dashboard(_ApiModel):
    counts: DashboardCounts
    schedule: list[ScheduleItem]
    recent_activity: list[RecentActivityItem]
    as_of: datetime
    # 공정·산업군 막대(breakdown)는 2차(#229)에서 붙인다. 없으면(null) 화면이 막대 줄을 숨긴다.
    breakdown: None = None


DashboardEnvelope = Envelope[Dashboard]


def schedule_due_list_filter(session, query, request: Request):
    """추천 목록 `?filter=SCHEDULE_DUE`: 대시보드 '이번 주 일정' 건수와 같은 기준으로 거른다.

    `opportunities.py`의 지원 값(`supported_filters`)과 거르기 자리(`list_filters`)에 등록만 한다.
    연결되지 않은 값(다른 filter 값·탭·북마크)을 막는 입력 검사는 목록 쪽 첫 검사가 맡는다.
    """
    if request.query_params.get("filter") != SCHEDULE_DUE_FILTER:
        return query
    today = utcnow().astimezone(KST).date()
    return query.where(EvaluationRun.opp_id.in_(schedule_due_opp_ids(today)))


supported_filters.add(SCHEDULE_DUE_FILTER)
if schedule_due_list_filter not in list_filters:
    list_filters.append(schedule_due_list_filter)


@router.get("/dashboard", response_model=DashboardEnvelope)
def dashboard(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """건수 5개·이번 주 일정·최근 내 기록. 보기 전용(담당자 키 없음)이면 최근 기록만 비어 있다."""
    runtime = runtime_for(session)
    dataset_kind = runtime.app_settings.active_dataset_kind
    now = utcnow()
    result = build_dashboard(
        session,
        dataset_kind=dataset_kind.value,
        staff_key=staff_key if runtime.app_settings.is_recording_staff(staff_key) else None,
        today=now.astimezone(KST).date(),
        now=now,
    )
    return DashboardEnvelope(
        data=Dashboard.model_validate(result.data, from_attributes=True),
        meta=Meta(
            updated_at=now, dataset_kind=dataset_kind, has_virtual_data=result.has_virtual_data
        ),
    )
