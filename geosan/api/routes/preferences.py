"""담당자 선호 제안·승인 창구(#943, 계약 C1, PM 결정 2026-11-26 되먹임 ③).

`GET /preferences`는 누구나 읽고(보기 전용 포함), 승인·끄기는 관리자(operations.staffKeys)만 한다.
AI·외부 호출 없음. 점수·분류는 바꾸지 않고 목록 "근거 있음" 묶음 안 순서만 다음 조회부터 바뀐다.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Path
from pydantic import Field

from geosan.api.deps import SessionDep, current_account, require_staff, runtime_for
from geosan.api.operations import is_operations_staff
from geosan.api.preferences import preference_state, same_combo
from geosan.api.process_catalog import load_process_catalog
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import AppError, FieldError, ForbiddenError, InputError, NotFoundError
from geosan.dashboard.preference import DISTANCE, PROCESS_INDUSTRY, Combo, Suggestion
from geosan.dashboard.sales_analysis import process_display_name
from geosan.records.models import PreferenceApproval
from geosan.storage.base import new_id, utcnow

router = APIRouter()

PreferenceKind = Literal["PROCESS_INDUSTRY", "DISTANCE"]
NOT_SUGGESTED = "PREFERENCE_NOT_SUGGESTED"
_VIRTUAL_DATASET_KIND = "VIRTUAL_REVIEWED"


class PreferenceBasis(_ApiModel):
    window_days: int
    min_picks: int
    min_share: float
    distance_km: float
    min_closed_for_rate: int
    approval_days: int
    picked_count: int = Field(description="기간 안 고른 회사 수(제외한 회사 뺌)")


class PreferenceSuggestionView(_ApiModel):
    kind: PreferenceKind
    process_code: str | None = None
    process_name: str | None = None
    industry: str | None = None
    distance_km: float | None = None
    picked_count: int
    excluded_count: int
    share: float
    closed_count: int
    won_count: int
    other_closed_count: int
    other_won_count: int


class PreferenceApprovalView(_ApiModel):
    pref_id: str
    kind: PreferenceKind
    process_code: str | None = None
    process_name: str | None = None
    industry: str | None = None
    distance_km: float | None = None
    approved_by: str
    approved_at: datetime
    expires_at: datetime


class PreferencesView(_ApiModel):
    enabled: bool
    can_approve: bool
    basis: PreferenceBasis | None = None
    suggestions: list[PreferenceSuggestionView] = Field(default_factory=list)
    active: list[PreferenceApprovalView] = Field(default_factory=list)


class PreferenceApproveRequest(_RequestModel):
    kind: PreferenceKind
    process_code: str | None = None
    industry: str | None = None
    distance_km: float | None = None


class PreferenceRevoked(_ApiModel):
    pref_id: str
    revoked_at: datetime


def _staff_key(session, header_key: str | None) -> str | None:
    account = current_account(session)
    return account.staff_key if account is not None else header_key


def _process_names(session) -> dict[str, str]:
    kind = runtime_for(session).app_settings.active_dataset_kind
    return {row.code: process_display_name(row.name) for row in load_process_catalog(session, kind)}


def _suggestion_view(row: Suggestion, names: dict[str, str]) -> PreferenceSuggestionView:
    combo = row.combo
    return PreferenceSuggestionView(
        kind=combo.kind,
        process_code=combo.process_code,
        process_name=names.get(combo.process_code) if combo.process_code else None,
        industry=combo.industry,
        distance_km=combo.distance_km,
        picked_count=row.picked_count,
        excluded_count=row.excluded_count,
        share=row.share,
        closed_count=row.closed_count,
        won_count=row.won_count,
        other_closed_count=row.other_closed_count,
        other_won_count=row.other_won_count,
    )


def approval_view(row: PreferenceApproval, names: dict[str, str]) -> PreferenceApprovalView:
    return PreferenceApprovalView(
        pref_id=row.pref_id,
        kind=row.kind,
        process_code=row.process_code,
        process_name=names.get(row.process_code) if row.process_code else None,
        industry=row.industry,
        distance_km=float(row.distance_km) if row.distance_km is not None else None,
        approved_by=row.approved_by,
        approved_at=row.approved_at,
        expires_at=row.expires_at,
    )


def _meta(session, now: datetime) -> Meta:
    kind = runtime_for(session).app_settings.active_dataset_kind
    return Meta(
        updated_at=now, dataset_kind=kind, has_virtual_data=kind.value == _VIRTUAL_DATASET_KIND
    )


def _require_operations(session, staff: str) -> None:
    if not is_operations_staff(runtime_for(session).app_settings, staff):
        raise ForbiddenError(
            "선호 제안은 관리자만 승인할 수 있습니다.",
            "설정 operations.staffKeys에 든 담당자로 골라 주세요.",
        )


def _begin_write(session) -> None:
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


@router.get("/preferences", response_model=Envelope[PreferencesView])
def get_preferences(
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    now = utcnow()
    state = preference_state(session, now)
    settings = runtime_for(session).app_settings
    if state.settings is None:
        return Envelope[PreferencesView](
            data=PreferencesView(enabled=False, can_approve=False), meta=_meta(session, now)
        )
    names = _process_names(session)
    found = state.settings
    return Envelope[PreferencesView](
        data=PreferencesView(
            enabled=True,
            can_approve=is_operations_staff(settings, _staff_key(session, staff_key)),
            basis=PreferenceBasis(
                window_days=found.window_days,
                min_picks=found.min_picks,
                min_share=found.min_share,
                distance_km=found.distance_km,
                min_closed_for_rate=found.min_closed_for_rate,
                approval_days=found.approval_days,
                picked_count=state.picked_count,
            ),
            suggestions=[_suggestion_view(row, names) for row in state.suggestions],
            active=[approval_view(row, names) for row in state.active],
        ),
        meta=_meta(session, now),
    )


def _check_body(body: PreferenceApproveRequest) -> Combo:
    if body.kind == PROCESS_INDUSTRY:
        missing = [
            FieldError(path=name, message="공정 × 산업군 제안에는 공정과 산업군이 필요합니다.")
            for name, value in (("processCode", body.process_code), ("industry", body.industry))
            if not value
        ]
        if missing or body.distance_km is not None:
            raise InputError(
                "승인할 제안의 칸이 맞지 않습니다.",
                "화면을 새로 고쳐 다시 눌러 주세요.",
                fields=missing or [FieldError(path="distanceKm", message="거리 제안에만 씁니다.")],
            )
        return Combo(PROCESS_INDUSTRY, process_code=body.process_code, industry=body.industry)
    if body.distance_km is None or body.process_code or body.industry:
        raise InputError(
            "승인할 제안의 칸이 맞지 않습니다.",
            "화면을 새로 고쳐 다시 눌러 주세요.",
            fields=[FieldError(path="distanceKm", message="거리 제안에는 거리만 보냅니다.")],
        )
    return Combo(DISTANCE, distance_km=body.distance_km)


@router.post("/preferences", response_model=Envelope[PreferenceApprovalView])
def approve_preference(
    body: PreferenceApproveRequest,
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    staff = require_staff(session, staff_key)
    _require_operations(session, staff)
    combo = _check_body(body)
    _begin_write(session)
    now = utcnow()
    state = preference_state(session, now)
    found = next((row for row in state.suggestions if same_combo(row, combo)), None)
    if state.settings is None or found is None:
        raise AppError(
            "지금 제안에 없는 조합입니다.",
            "이미 승인했거나 기준이 바뀌었을 수 있습니다. 화면을 새로 고쳐 다시 봐 주세요.",
            status=409,
            kind=NOT_SUGGESTED,
        )
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind.value
    row = PreferenceApproval(
        pref_id=new_id("pref"),
        kind=combo.kind,
        process_code=combo.process_code,
        industry=combo.industry,
        distance_km=combo.distance_km,
        approved_by=staff,
        approved_at=now,
        expires_at=now + timedelta(days=state.settings.approval_days),
        basis={
            "pickedCount": found.picked_count,
            "excludedCount": found.excluded_count,
            "share": found.share,
            "totalPicked": state.picked_count,
            "closedCount": found.closed_count,
            "wonCount": found.won_count,
            "otherClosedCount": found.other_closed_count,
            "otherWonCount": found.other_won_count,
        },
        created_by=staff,
        dataset_kind=dataset_kind,
        is_virtual=dataset_kind == _VIRTUAL_DATASET_KIND,
    )
    session.add(row)
    session.flush()
    return Envelope[PreferenceApprovalView](
        data=approval_view(row, _process_names(session)), meta=_meta(session, now)
    )


@router.post("/preferences/{prefId}/revoke", response_model=Envelope[PreferenceRevoked])
def revoke_preference(
    pref_id: Annotated[str, Path(alias="prefId")],
    session: SessionDep,
    staff_key: Annotated[str | None, Header(alias="X-Staff-Key")] = None,
):
    staff = require_staff(session, staff_key)
    _require_operations(session, staff)
    _begin_write(session)
    now = utcnow()
    row = session.get(PreferenceApproval, pref_id)
    dataset_kind = runtime_for(session).app_settings.active_dataset_kind.value
    if row is None or row.dataset_kind != dataset_kind:
        raise NotFoundError("끌 선호 승인이 없습니다.", "화면을 새로 고쳐 다시 봐 주세요.")
    if row.revoked_at is not None or row.expires_at <= now:
        raise AppError(
            "이미 꺼진 선호입니다.",
            "화면을 새로 고쳐 지금 켜진 것을 다시 봐 주세요.",
            status=409,
        )
    row.revoked_at = now
    row.revoked_by = staff
    session.flush()
    return Envelope[PreferenceRevoked](
        data=PreferenceRevoked(pref_id=row.pref_id, revoked_at=now), meta=_meta(session, now)
    )
