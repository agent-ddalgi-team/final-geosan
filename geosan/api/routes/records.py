"""담당자가 본 평가에 의견을 새 행으로 남긴다. 시스템 평가에는 쓰지 않는다."""

from typing import Annotated

from fastapi import APIRouter, Path, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.schemas import (
    ActivityEnvelope,
    ActivityItem,
    Meta,
    NoteEnvelope,
    NoteRequest,
    NoteResponse,
    OpinionEnvelope,
    OpinionRecord,
    OpinionRequest,
    OpinionResponse,
    OutcomeEnvelope,
    OutcomeRequest,
    OutcomeResponse,
)
from geosan.config.errors import FieldError, InputError, NotFoundError
from geosan.config.validators import scan_contacts
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Opportunity
from geosan.records.models import Note, Outcome, ReviewOpinion
from geosan.storage.base import new_id, utcnow

router = APIRouter()


def latest_outcome(session: Session, opp_id: str) -> Outcome | None:
    return session.scalar(
        select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
    )


def outcome_view(row: Outcome | None) -> dict | None:
    if row is None:
        return None
    return {
        "version": row.version,
        "updatedBy": row.created_by,
        "updatedAt": row.created_at.isoformat(),
        "status": row.status,
        "nextScheduleAt": row.next_schedule_at.isoformat() if row.next_schedule_at else None,
    }


@router.post("/opportunities/{oppId}/outcomes", response_model=OutcomeEnvelope)
def save_outcome(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: OutcomeRequest,
    session: SessionDep,
    staff: StaffDep,
):
    fields = scan_contacts(
        {"reason": body.reason, "memo": body.memo, "nextScheduleNote": body.next_schedule_note}
    )
    if body.status == "LOST" and not (body.reason and body.reason.strip()):
        fields.append(FieldError(path="reason", message="거절 사유를 적어 주세요."))
    if fields:
        raise InputError("영업 기록의 항목을 확인해 주세요.", fields=fields)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("기록을 남길 기회가 없습니다.")
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_outcome(session, opp_id)
    values = body.model_dump(exclude={"eval_id", "expected_version"})
    # 단계만 바꾸는 요청은 이미 잡아 둔 다음 일정을 지우지 않는다.
    for name in ("next_schedule_at", "next_schedule_note"):
        if previous and name not in body.model_fields_set:
            values[name] = getattr(previous, name)
    row = Outcome(
        outcome_id=new_id("outcome"),
        opp_id=opp_id,
        **values,
        version=previous.version + 1 if previous else 1,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    session.flush()
    previous_value = None
    if previous and previous.version > (body.expected_version or 0):
        previous_value = outcome_view(previous)
    return OutcomeEnvelope(
        data=OutcomeResponse(
            status=row.status, version=row.version, updated_by=staff, updated_at=row.created_at
        ),
        meta=Meta(
            updated_at=row.created_at,
            has_virtual_data=row.is_virtual,
            dataset_kind=row.dataset_kind,
            previous_value=previous_value,
        ),
    )


@router.get("/opportunities/{oppId}/activity", response_model=ActivityEnvelope)
def activity(
    opp_id: Annotated[str, Path(alias="oppId")],
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("활동을 조회할 기회가 없습니다.")
    items = []
    for row in session.scalars(
        select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc()).limit(limit)
    ):
        items.append(
            ActivityItem(at=row.created_at, actor=row.staff_key, kind="NOTE", summary=row.text)
        )
    for row in session.scalars(
        select(Outcome)
        .where(Outcome.opp_id == opp_id)
        .order_by(Outcome.version.desc())
        .limit(limit)
    ):
        status_label = {
            "NOT_EXECUTED": "미접촉",
            "INTERESTED": "관심",
            "IN_PROGRESS": "접촉",
            "SAMPLE_OR_REGISTRATION_APPROVED": "견적·샘플",
            "ON_HOLD": "보류",
            "WON": "성사",
            "LOST": "거절",
        }[row.status]
        summary = status_label
        if row.method:
            method = {"CALL": "전화", "EMAIL": "메일", "VISIT": "방문"}[row.method]
            result = {"REACHED": "연결됨", "ABSENT": "부재", "DECLINED": "거절"}.get(row.result, "")
            summary += f" · {row.attempted_at or ''} {method} {result}"
        if row.next_schedule_at:
            summary += f" · 다음 일정 {row.next_schedule_at} {row.next_schedule_note or ''}"
        if row.reason:
            summary += f" · {row.reason}"
        items.append(
            ActivityItem(
                at=row.created_at,
                actor=row.created_by,
                kind="CONTACT_ATTEMPT" if row.method else "OUTCOME",
                summary=summary,
            )
        )
    for row in session.scalars(
        select(ReviewOpinion)
        .where(ReviewOpinion.opp_id == opp_id)
        .order_by(ReviewOpinion.version.desc())
        .limit(limit)
    ):
        items.append(
            ActivityItem(
                at=row.recorded_at,
                actor=row.staff_name,
                kind="OPINION",
                summary=row.opinion,
                eval_id=row.eval_id,
            )
        )
    items.sort(key=lambda item: item.at, reverse=True)
    return ActivityEnvelope(
        data=items[:limit],
        meta=Meta(
            dataset_kind=opportunity.dataset_kind,
            has_virtual_data=opportunity.is_virtual,
        ),
    )


@router.post("/opportunities/{oppId}/notes", response_model=NoteEnvelope)
def save_note(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: NoteRequest,
    session: SessionDep,
    staff: StaffDep,
):
    limit = runtime_for(session).app_settings.records.note_max_length
    if len(body.text) > limit:
        raise InputError(
            "영업 메모의 글자 수를 확인해 주세요.",
            fields=[FieldError(path="text", message=f"{limit}자 이내로 적어 주세요.")],
        )
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("메모를 남길 기회가 없습니다.")
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = session.scalar(
        select(Note).where(Note.opp_id == opp_id).order_by(Note.version.desc())
    )
    now = utcnow()
    row = Note(
        note_id=new_id("note"),
        opp_id=opp_id,
        staff_key=staff,
        text=body.text,
        version=previous.version + 1 if previous else 1,
        created_at=now,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    session.flush()
    return NoteEnvelope(
        data=NoteResponse(
            note_id=row.note_id, version=row.version, updated_by=staff, updated_at=now
        ),
        meta=Meta(updated_at=now, has_virtual_data=row.is_virtual, dataset_kind=row.dataset_kind),
    )


def latest_opinion(session: Session, opp_id: str) -> ReviewOpinion | None:
    return session.scalar(
        select(ReviewOpinion)
        .where(ReviewOpinion.opp_id == opp_id)
        .order_by(ReviewOpinion.version.desc(), ReviewOpinion.recorded_at.desc())
    )


def opinion_view(row: ReviewOpinion | None) -> OpinionRecord | None:
    if row is None:
        return None
    return OpinionRecord(
        version=row.version,
        updated_by=row.staff_name,
        updated_at=row.recorded_at,
        opinion=row.opinion,
        reason=row.reason,
        memo=row.memo,
    )


@router.post(
    "/opportunities/{oppId}/opinions",
    response_model=OpinionEnvelope,
    response_model_exclude_unset=True,
)
def save_opinion(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: OpinionRequest,
    session: SessionDep,
    staff: StaffDep,
):
    fields = scan_contacts({"reason": body.reason, "memo": body.memo})
    if body.opinion == "NOT_TARGET" and (body.reason is None or not body.reason.strip()):
        fields.append(
            FieldError(path="reason", message="검토 대상 제외를 고르면 사유가 필요합니다.")
        )
    if body.expected_version is not None and body.expected_version < 0:
        fields.append(
            FieldError(path="expectedVersion", message="버전은 0 이상의 정수여야 합니다.")
        )
    if fields:
        raise InputError("의견을 저장할 항목을 확인해 주세요.", fields=fields)
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("의견을 남길 기회가 없습니다.")
    evaluation = session.get(EvaluationRun, body.eval_id)
    batch = session.get(EvaluationBatch, evaluation.batch_id) if evaluation else None
    if (
        evaluation is None
        or evaluation.opp_id != opp_id
        or evaluation.run_status not in {"CONFIRMED", "SUPERSEDED"}
        or batch is None
        or batch.status != "CONFIRMED"
    ):
        raise InputError(
            "이 기회에서 본 평가 ID를 넣어 주세요.",
            fields=[FieldError(path="evalId", message="기회와 평가 연결을 확인해 주세요.")],
        )
    # SQLite의 쓰기 잠금을 먼저 잡아 의견 버전 읽기와 추가가 겹치지 않게 한다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    previous = latest_opinion(session, opp_id)
    now = utcnow()
    row = ReviewOpinion(
        opinion_id=new_id("opinion"),
        opp_id=opp_id,
        eval_id=body.eval_id,
        opinion=body.opinion.value,
        memo=body.memo,
        reason=body.reason,
        staff_name=staff,
        recorded_at=now,
        previous_opinion_id=previous.opinion_id if previous else None,
        version=previous.version + 1 if previous else 1,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
        created_by=staff,
    )
    session.add(row)
    session.flush()
    previous_value = None
    if previous and previous.version > (body.expected_version or 0):
        previous_value = opinion_view(previous).model_dump(mode="json", by_alias=True)
    return OpinionEnvelope(
        data=OpinionResponse(**opinion_view(row).model_dump()),
        meta=Meta(
            updated_at=now,
            has_virtual_data=row.is_virtual,
            dataset_kind=row.dataset_kind,
            previous_value=previous_value,
        ),
    )
