"""AI 근거는 미확인 후보로 저장하며 사람의 근거와 이전 조사 이력을 보존한다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.evidence.extraction import Extraction, ProposedEvidence
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Opportunity
from geosan.storage.base import new_id, utcnow


def store_extraction(
    session: Session,
    opportunity: Opportunity,
    result: Extraction,
    source_url: str,
    requested_by: str,
) -> list[Evidence]:
    now = utcnow()
    for row in session.scalars(
        select(Evidence).where(
            Evidence.opp_id == opportunity.opp_id,
            Evidence.superseded_at.is_(None),
            Evidence.is_llm_proposed.is_(True),
            Evidence.extraction_method == "LLM",
            Evidence.certainty_confirmed.is_(None),
        )
    ):
        row.superseded_at = now
    rows = []
    proposals = [
        ProposedEvidence(
            quote=f"요구 후보(미확인): {item.name}\n공개 본문: {item.quote}",
            subject="REQUIREMENT",
            occurred_at_candidate=None,
            source_grade_proposed="D",
            certainty_proposed="UNKNOWN",
        )
        for item in result.requirement_candidates
    ]
    for item in [*result.evidence, *proposals]:
        row = Evidence(
            evidence_id=new_id("ev"),
            opp_id=opportunity.opp_id,
            source_grade=item.source_grade_proposed.value,
            source_ref=source_url,
            quote=item.quote,
            subject=item.subject.value,
            occurred_at=item.occurred_at_candidate,
            security_grade="PUBLIC",
            external_ai_allowed=True,
            presentation_allowed=False,
            extraction_method="LLM",
            extracted_by=requested_by,
            extracted_at=now,
            certainty_proposed=item.certainty_proposed.value,
            certainty_confirmed=None,
            is_llm_proposed=True,
            dataset_kind=opportunity.dataset_kind,
            is_virtual=opportunity.is_virtual,
            created_by=requested_by,
        )
        session.add(row)
        rows.append(row)
    session.flush()
    return rows
