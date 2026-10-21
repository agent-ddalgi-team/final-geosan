"""담당자가 본 평가에 의견을 새 행으로 남긴다. 시스템 평가에는 쓰지 않는다."""

from typing import Annotated

from fastapi import APIRouter, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.api.deps import SessionDep, StaffDep
from geosan.api.schemas import Meta, OpinionEnvelope, OpinionRecord, OpinionRequest, OpinionResponse
from geosan.config.errors import FieldError, InputError, NotFoundError
from geosan.config.validators import scan_contacts
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.models import Opportunity
from geosan.records.models import ReviewOpinion
from geosan.storage.base import new_id, utcnow

router = APIRouter()


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
        fields.append(FieldError(path="reason", message="대상 아님을 고르면 사유가 필요합니다."))
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
