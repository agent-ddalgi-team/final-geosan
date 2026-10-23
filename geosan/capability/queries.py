"""거산 값은 지정한 묶음만 조회한다. 검수 상태 원본은 최근 FieldEvidence다."""

from __future__ import annotations

import logging

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

logger = logging.getLogger(__name__)


def latest_review(session: Session, row, *, dataset_kind: str) -> FieldEvidence | None:
    key = next(iter(row.__table__.primary_key.columns)).name
    return session.scalar(
        select(FieldEvidence)
        .where(
            FieldEvidence.dataset_kind == dataset_kind,
            FieldEvidence.target_table == row.__tablename__,
            FieldEvidence.target_id == getattr(row, key),
            FieldEvidence.target_field == "reviewStatus",
        )
        .order_by(FieldEvidence.data_version.desc())
    )


def review_status(session: Session, row, *, dataset_kind: str) -> str:
    """검수 기록이 없으면 미확보다. 사본만 검수 완료라고 적혀 있어도 쓰지 않는다."""
    if row.dataset_kind != dataset_kind:
        raise ValueError("다른 묶음의 검수 상태를 조회할 수 없습니다")
    evidence = latest_review(session, row, dataset_kind=dataset_kind)
    status = evidence.review_status if evidence else "UNAVAILABLE"
    if row.review_status != status:
        logger.warning("검수 상태 사본 불일치: table=%s", row.__tablename__)
        row.review_status = status
        session.flush()
    return status


def list_processes(session: Session, *, dataset_kind: str) -> list[Process]:
    rows = list(session.scalars(select(Process).where(Process.dataset_kind == dataset_kind)))
    for row in rows:
        review_status(session, row, dataset_kind=dataset_kind)
    return rows


def get_process(session: Session, code: str, *, dataset_kind: str) -> Process | None:
    row = session.scalar(
        select(Process).where(Process.dataset_kind == dataset_kind, Process.code == code)
    )
    if row is not None:
        review_status(session, row, dataset_kind=dataset_kind)
    return row


def list_capabilities(session: Session, *, dataset_kind: str) -> list[ProcessCapability]:
    return _reviewed_rows(session, ProcessCapability, dataset_kind)


def list_delivery_records(session: Session, *, dataset_kind: str) -> list[DeliveryRecord]:
    return _reviewed_rows(session, DeliveryRecord, dataset_kind)


def list_qualifications(session: Session, *, dataset_kind: str) -> list[Qualification]:
    return _reviewed_rows(session, Qualification, dataset_kind)


def list_scopes(session: Session, *, dataset_kind: str) -> list[QualificationScope]:
    return _reviewed_rows(session, QualificationScope, dataset_kind)


def _reviewed_rows(session: Session, model, dataset_kind: str) -> list:
    rows = list(session.scalars(select(model).where(model.dataset_kind == dataset_kind)))
    for row in rows:
        review_status(session, row, dataset_kind=dataset_kind)
    return rows


def latest_qualification_status(
    session: Session, qual_id: str, *, dataset_kind: str
) -> QualificationStatus | None:
    """파일 평가와 같이 발생일·확인일을 우선하며, 날짜 동률에서만 저장 순서를 쓴다."""
    return session.scalar(
        select(QualificationStatus)
        .where(
            QualificationStatus.dataset_kind == dataset_kind,
            QualificationStatus.qual_id == qual_id,
        )
        .order_by(
            QualificationStatus.occurred_at.desc().nulls_last(),
            QualificationStatus.confirmed_at.desc().nulls_last(),
            QualificationStatus.created_at.desc(),
            QualificationStatus.status_id.desc(),
        )
    )
