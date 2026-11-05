"""대시보드 경로 (U7, 계약 C1 `GET /dashboard` v2). 응답 모양은 이 파일에 둔다(경로 묶음별 모델)."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header
from pydantic import Field

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.dashboard.queries import build_dashboard
from geosan.evidence.transfer import KST
from geosan.storage.base import utcnow

router = APIRouter()

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
