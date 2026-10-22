"""파일 근거 저장·조회. 금지 원문은 저장하지 않으며 현재 행만 기본 조회한다."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import FieldError, InputError
from geosan.config.schemas import CaseEvidence
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Opportunity
from geosan.rules.codes import SecurityGrade
from geosan.storage.base import new_id, utcnow


def list_evidence(session: Session, opp_id: str) -> list[Evidence]:
    return list(
        session.scalars(
            select(Evidence).where(
                Evidence.opp_id == opp_id,
                Evidence.superseded_at.is_(None),
                Evidence.security_grade != SecurityGrade.FORBIDDEN.value,
            )
        )
    )


def store_evidence(
    session: Session,
    opp_id: str,
    items: list[CaseEvidence],
    *,
    dataset_kind: str,
    is_virtual: bool,
    requested_by: str,
) -> list[Evidence]:
    if session.get(Opportunity, opp_id) is None:
        raise InputError("근거를 연결할 기회가 없습니다.")
    rows = []
    for index, item in enumerate(items):
        if item.security_grade == SecurityGrade.FORBIDDEN:
            raise InputError(
                "처리 금지 원문은 저장할 수 없습니다.",
                fields=[
                    FieldError(
                        path=f"evidence[{index}].quote",
                        message="처리 금지 원문은 저장하지 않습니다.",
                    )
                ],
            )
        row = Evidence(
            evidence_id=new_id("ev"),
            opp_id=opp_id,
            source_grade=item.source_grade.value,
            source_ref=item.source_ref,
            quote=item.quote,
            subject=item.subject.value,
            occurred_at=item.occurred_at,
            security_grade=item.security_grade.value,
            external_ai_allowed=item.external_ai_allowed,
            presentation_allowed=False,
            extraction_method="MANUAL",
            extracted_by=requested_by,
            extracted_at=utcnow(),
            certainty_confirmed=item.certainty.value,
            is_llm_proposed=False,
            dataset_kind=dataset_kind,
            is_virtual=is_virtual,
            created_by=requested_by,
        )
        session.add(row)
        rows.append(row)
    session.flush()
    return rows


def supersede_evidence(session: Session, opp_id: str) -> None:
    for row in session.scalars(
        select(Evidence).where(Evidence.opp_id == opp_id, Evidence.superseded_at.is_(None))
    ):
        row.superseded_at = utcnow()
    session.flush()
