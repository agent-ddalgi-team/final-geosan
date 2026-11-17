"""목록과 후보 가져오기에서 함께 쓰는 활성 역량 파일의 공정 순서(#406·#428)."""

from sqlalchemy import func, literal_column, select
from sqlalchemy.orm import Session

from geosan.capability.models import FieldEvidence, Process
from geosan.rules.codes import DatasetKind


def load_process_catalog(session: Session, dataset_kind: DatasetKind) -> list[Process]:
    reviews = (
        select(FieldEvidence)
        .where(
            FieldEvidence.target_table == Process.__tablename__,
            FieldEvidence.target_id == Process.process_id,
            FieldEvidence.target_field == "reviewStatus",
            FieldEvidence.dataset_kind == dataset_kind.value,
        )
        .correlate(Process)
    )
    imported_at = reviews.with_only_columns(func.max(FieldEvidence.created_at)).scalar_subquery()
    # 투입기가 파일 순서대로 flush한 검수 이력으로 같은 시각에 재투입한 순서도 보존한다.
    imported_order = reviews.with_only_columns(
        func.max(literal_column("cap_field_evidence.rowid"))
    ).scalar_subquery()
    return list(
        session.scalars(
            select(Process)
            .where(Process.dataset_kind == dataset_kind.value)
            .order_by(
                func.coalesce(imported_at, Process.created_at), imported_order, Process.process_id
            )
        )
    )
