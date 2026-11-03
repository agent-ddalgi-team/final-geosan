"""검수 전환의 저장 단계. 재평가와 함께 호출자 트랜잭션에 참여한다 (C2)."""

from datetime import date

from sqlalchemy.orm import Session

from geosan.capability.models import (
    DeliveryRecord,
    FieldEvidence,
    Process,
    ProcessCapability,
    Qualification,
    QualificationScope,
)
from geosan.capability.queries import latest_review
from geosan.config.errors import InputError
from geosan.rules.codes import ReviewStatus
from geosan.storage.base import new_id

ReviewedValue = Process | ProcessCapability | DeliveryRecord | Qualification | QualificationScope


def append_review(
    session: Session,
    value: ReviewedValue,
    previous: FieldEvidence | None,
    status: str,
    *,
    reviewer: str | None,
    reviewed_at: date | None,
    basis: str | None,
    requested_by: str,
) -> None:
    """파일 투입과 담당자 검수 모두 같은 방식으로 그 시점의 값과 근거를 보존한다."""
    table = value.__table__
    key = next(iter(table.primary_key.columns)).name
    snapshot = {
        column.name: getattr(value, column.name)
        for column in table.columns
        if column.name not in {"created_at", "created_by", "session_ref"}
    }
    snapshot["review_status"] = status
    session.add(
        FieldEvidence(
            field_evidence_id=new_id("fe"),
            target_table=table.name,
            target_id=getattr(value, key),
            target_field="reviewStatus",
            value_snapshot={
                k: v.isoformat() if isinstance(v, date) else v for k, v in snapshot.items()
            },
            data_version=previous.data_version + 1 if previous else 1,
            review_status=status,
            reviewer=reviewer,
            reviewed_at=reviewed_at,
            basis=basis,
            dataset_kind=value.dataset_kind,
            is_virtual=value.is_virtual,
            created_by=requested_by,
        )
    )
    session.flush()


def transition_review(
    session: Session,
    value: ReviewedValue,
    status: ReviewStatus | str,
    *,
    reviewer: str,
    basis: str,
    reviewed_at: date,
) -> None:
    """새 검수 이력을 먼저 보존하고 같은 값의 조회용 상태를 맞춘다."""
    if status not in (ReviewStatus.REVIEWED, ReviewStatus.RECHECK):
        raise InputError("검수 전환은 REVIEWED 또는 RECHECK만 가능합니다.")
    if not reviewer.strip() or not basis.strip():
        raise InputError("검수자와 확인 근거를 모두 입력해 주세요.")
    previous = latest_review(session, value, dataset_kind=value.dataset_kind)
    if previous is None or previous.review_status == ReviewStatus.UNAVAILABLE:
        raise InputError("검수할 값이 없습니다. 먼저 역량 파일을 투입해 주세요.")
    if previous.review_status != status:
        if status == ReviewStatus.RECHECK and previous.review_status != ReviewStatus.REVIEWED:
            raise InputError("검수 완료한 값만 재확인으로 되돌릴 수 있습니다.")
        append_review(
            session,
            value,
            previous,
            status,
            reviewer=reviewer.strip(),
            basis=basis.strip(),
            reviewed_at=reviewed_at,
            requested_by=reviewer.strip(),
        )
    value.review_status = status
    session.flush()
