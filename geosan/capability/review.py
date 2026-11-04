"""검수 전환의 저장 단계. 재평가와 함께 호출자 트랜잭션에 참여한다 (C2)."""

from copy import deepcopy
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.capability.models import (
    DeliveryRecord,
    FieldEvidence,
    Process,
    ProcessCapability,
    Qualification,
    QualificationScope,
    QualificationStatus,
)
from geosan.capability.queries import latest_review
from geosan.config.errors import InputError
from geosan.rules.codes import ReviewStatus
from geosan.storage.base import new_id

ReviewedValue = Process | ProcessCapability | DeliveryRecord | Qualification | QualificationScope
REVIEW_MODELS = (Process, ProcessCapability, DeliveryRecord, Qualification, QualificationScope)


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


def resolve_review_target(
    session: Session, kind: str, target_id: str, dataset_kind: str
) -> ReviewedValue:
    """질문에서 쓰는 기존 targetKind·ID로 거산 값을 찾는다(C0·C2)."""
    models = {
        "PROCESS": (Process,),
        "CAPABILITY": (ProcessCapability,),
        "QUALIFICATION": (Qualification,),
        "FIELD": (DeliveryRecord, QualificationScope),
    }.get(kind)
    if models is None:
        raise InputError("검수 대상 종류는 PROCESS·CAPABILITY·QUALIFICATION·FIELD만 가능합니다.")
    found = [row for model in models if (row := session.get(model, target_id)) is not None]
    if len(found) != 1 or found[0].dataset_kind != dataset_kind:
        raise InputError("현재 활성 묶음에서 검수 대상을 찾을 수 없습니다.")
    return found[0]


def copy_confirmed_dataset(
    session: Session, *, reviewer: str, basis: str, reviewed_at: date
) -> dict[str, int]:
    """소개서 원본을 보존하고 새 묶음에서 PENDING만 확인 완료로 바꾼다(#212 PM 결정 A)."""
    for model in (*REVIEW_MODELS, QualificationStatus, FieldEvidence):
        if session.scalar(select(model).where(model.dataset_kind == "COMPANY_CONFIRMED").limit(1)):
            raise InputError("이미 COMPANY_CONFIRMED 묶음이 있습니다. 덮어쓰지 않습니다.")
    originals = {
        model: list(session.scalars(select(model).where(model.dataset_kind == "BROCHURE")))
        for model in (*REVIEW_MODELS, QualificationStatus)
    }
    if not originals[Process]:
        raise InputError("복사할 소개서 값이 없습니다. 먼저 소개서 역량 파일을 투입해 주세요.")
    if not reviewer.strip() or not basis.strip():
        raise InputError("검수자와 확인 근거를 모두 입력해 주세요.")
    # 식별자는 먼저 모두 정해 자격 범위·공정 연결이 원본 묶음을 가리키지 않게 한다.
    identifiers = {}
    for rows in originals.values():
        for row in rows:
            key = next(iter(row.__table__.primary_key.columns)).name
            old_id = getattr(row, key)
            identifiers[old_id] = new_id(old_id.split("-", 1)[0])
    counts = {}
    ordered = (
        Process,
        Qualification,
        ProcessCapability,
        DeliveryRecord,
        QualificationScope,
        QualificationStatus,
    )
    for model in ordered:
        rows = originals[model]
        counts[model.__tablename__] = len(rows)
        if model is QualificationStatus:
            rows.sort(key=lambda row: (row.created_at, row.status_id))
        for row in rows:
            key = next(iter(row.__table__.primary_key.columns)).name
            values = {
                column.name: deepcopy(getattr(row, column.name))
                for column in row.__table__.columns
                if column.name not in {"created_at", "created_by", "session_ref"}
            }
            values[key] = identifiers[getattr(row, key)]
            for reference in ("process_id", "qual_id"):
                if reference == key or reference not in values or values[reference] is None:
                    continue
                if values[reference] not in identifiers:
                    raise InputError("소개서 값의 공정·자격 연결을 확인해 주세요.")
                values[reference] = identifiers[values[reference]]
            values.update(dataset_kind="COMPANY_CONFIRMED", is_virtual=False, created_by=reviewer)
            previous = (
                latest_review(session, row, dataset_kind="BROCHURE")
                if model in REVIEW_MODELS
                else None
            )
            original_status = previous.review_status if previous else "UNAVAILABLE"
            confirm = original_status == "PENDING"
            if model in REVIEW_MODELS:
                values["review_status"] = "REVIEWED" if confirm else original_status
            copied = model(**values)
            session.add(copied)
            session.flush()
            if model in REVIEW_MODELS:
                append_review(
                    session,
                    copied,
                    None,
                    values["review_status"],
                    reviewer=reviewer if confirm else previous.reviewer if previous else None,
                    reviewed_at=reviewed_at
                    if confirm
                    else previous.reviewed_at
                    if previous
                    else None,
                    basis=basis if confirm else previous.basis if previous else None,
                    requested_by=reviewer,
                )
    return counts
