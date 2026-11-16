"""운영 관리 경로(#799, 계약 C1 `GET /operations`). 운영 담당(설정 operations.staffKeys)만 읽는다.

읽기 전용. AI·외부 호출·저장 없음. 본문·메모·연락처·검색어는 응답에 없다.
"""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header

from geosan.api.deps import SessionDep, current_account, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel
from geosan.config.errors import ForbiddenError
from geosan.dashboard.operations import build_operations, is_operations_staff
from geosan.storage.base import utcnow

router = APIRouter()


class UsageGroup(_ApiModel):
    group: Literal["RESEARCH", "WEB_SEARCH", "SALES", "OTHER"]
    calls: int
    cost_usd: float


class DailyCost(_ApiModel):
    day: date
    cost_usd: float


class AutoResearchToday(_ApiModel):
    used_usd: float
    # 자동 조사 스위치가 꺼져 있거나 하루 금액이 0이면 null.
    limit_usd: float | None


class Usage(_ApiModel):
    """이번 달(한국 시간). 비용은 `geosan cost`·호출 예약과 같은 한도 계산 비용."""

    month: str
    calls: int
    call_limit: int
    cost_usd: float
    cost_limit_usd: float
    # 설정 llm.costAlertRatio. 이 비율 이상이면 대시보드에 운영 알림.
    alert_ratio: float
    groups: list[UsageGroup]
    daily: list[DailyCost]
    auto_research_today: AutoResearchToday


class SourceStatus(_ApiModel):
    source: Literal[
        "FACTORY_FILE", "FACTORY_REGISTRY", "FACTORY_PROFILE", "WATER_LIST", "AI_JUDGMENT"
    ]
    as_of: date | None
    loaded_at: datetime | None
    rows: int
    # 공장현황 파일만 기준일 + 설정 operations.factoryCsvRefreshDays. 나머지는 null.
    refresh_due_at: date | None
    refresh_overdue: bool


class BlockedTransfer(_ApiModel):
    occurred_at: datetime
    purpose: str
    kind: str
    reason: str | None


class Operations(_ApiModel):
    usage: Usage
    sources: list[SourceStatus]
    blocked: list[BlockedTransfer]


OperationsEnvelope = Envelope[Operations]


@router.get("/operations", response_model=OperationsEnvelope)
def operations(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    """운영 관리 화면. 운영 담당이 아니면(보기 전용·키 없음 포함) 403."""
    runtime = runtime_for(session)
    settings = runtime.app_settings
    account = current_account(session)
    if account is not None:
        staff_key = account.staff_key
    if not is_operations_staff(settings, staff_key):
        raise ForbiddenError(
            "운영 관리 화면은 운영 담당만 볼 수 있습니다.",
            "운영 담당으로 고르거나, 설정 operations.staffKeys에 넣어 달라고 PM에게 요청해 주세요.",
        )
    now = utcnow()
    return OperationsEnvelope(
        data=Operations.model_validate(
            build_operations(session, settings, now), from_attributes=True
        ),
        meta=Meta(updated_at=now, dataset_kind=settings.active_dataset_kind),
    )
