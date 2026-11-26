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


# #958(PM 결정 2026-11-26) 소재 코드 → 쉬운 말.
# 화면 대응표(web labels materialLabels)와 같은 말이다.
# 표에 없는 코드는 코드 그대로 보인다(이름을 지어내지 않는다).
MATERIAL_NAMES = {
    "AL": "알루미늄",
    "AL_CASTING": "알루미늄 주물",
    "FE": "철",
    "CU": "구리",
    "SUS": "스테인리스",
    "ZN": "아연",
    # #964: 브로슈어 역량 파일의 아노다이징 소재(회사소개서 값).
    "MG": "마그네슘",
    "TI": "티타늄",
    "HF": "하프늄",
    "NB": "니오븀",
}


def material_options(session: Session, dataset_kind: DatasetKind) -> dict[str, str]:
    """#958 거산 처리 소재 목록 {코드: 이름}.

    역량 파일 공정 순서대로 materialCodes를 합친다(같은 코드는 한 번).
    """
    found: dict[str, str] = {}
    for process in load_process_catalog(session, dataset_kind):
        for code in process.material_codes or []:
            found.setdefault(code, MATERIAL_NAMES.get(code, code))
    return found
