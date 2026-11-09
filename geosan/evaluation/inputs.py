"""사례 파일의 항목 입력·기한 체크 저장. 평가 결과와 별도로 이력을 보존한다."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.config.errors import InputError
from geosan.config.schemas import CaseFile
from geosan.evaluation.models import ItemJudgmentInput, ReadinessCheck
from geosan.opportunity.models import Opportunity
from geosan.rules.models import RuleConfig
from geosan.storage.base import new_id, utcnow


def current_item_inputs(session: Session, opp_id: str) -> list[ItemJudgmentInput]:
    return list(
        session.scalars(
            select(ItemJudgmentInput)
            .where(ItemJudgmentInput.opp_id == opp_id, ItemJudgmentInput.superseded_at.is_(None))
            .order_by(ItemJudgmentInput.item_code)
        )
    )


AI_PROPOSED = "AI"


def has_ai_pending_inputs(session: Session, opp_id: str) -> bool:
    """현재 점수 입력에 AI 제안(확인 전) 행이 하나라도 있으면 True(#286, C1 scoreState PENDING)."""
    return any(row.proposed_by == AI_PROPOSED for row in current_item_inputs(session, opp_id))


def current_readiness_check(session: Session, opp_id: str) -> ReadinessCheck | None:
    return session.scalar(
        select(ReadinessCheck)
        .where(
            ReadinessCheck.opp_id == opp_id,
            ReadinessCheck.superseded_at.is_(None),
            ReadinessCheck.reset_at.is_(None),
        )
        .order_by(ReadinessCheck.created_at.desc())
    )


def supersede_inputs(session: Session, opp_id: str) -> None:
    for model in (ItemJudgmentInput, ReadinessCheck):
        for row in session.scalars(
            select(model).where(model.opp_id == opp_id, model.superseded_at.is_(None))
        ):
            row.superseded_at = utcnow()
    session.flush()


def store_inputs(
    session: Session,
    opp_id: str,
    model: CaseFile,
    *,
    rule_config: RuleConfig,
    match_rates: dict[str, float | None],
    evidence_ids: list[str],
    signal_ids: list[str],
    requested_by: str,
) -> None:
    if session.get(Opportunity, opp_id) is None:
        raise InputError("항목 입력을 연결할 기회가 없습니다.")
    common = dict(
        dataset_kind=model.dataset_kind.value, is_virtual=model.is_virtual, created_by=requested_by
    )
    by_code = {item.item_code.value: item for item in model.item_inputs}
    for config_item in rule_config.new_profile_items:
        code = config_item.item_code
        item = by_code.get(code)
        version = (
            session.scalar(
                select(func.max(ItemJudgmentInput.version)).where(
                    ItemJudgmentInput.opp_id == opp_id, ItemJudgmentInput.item_code == code
                )
            )
            or 0
        )
        session.add(
            ItemJudgmentInput(
                item_input_id=new_id("ii"),
                opp_id=opp_id,
                item_code=code,
                state=item.state.value if item else "UNAVAILABLE",
                match_rate_step=item.match_rate.strip()
                if item
                and isinstance(item.match_rate, str)
                and item.match_rate.strip() in config_item.match_rate_steps
                else None,
                match_rate=match_rates.get(code),
                fact_judged=item.fact_judged if item else None,
                summary=item.summary if item else None,
                evidence_ids=[evidence_ids[ref] for ref in item.evidence_refs] if item else [],
                signal_ids=[signal_ids[ref] for ref in item.signal_refs] if item else [],
                used_capability_refs=[
                    ref.model_dump(mode="json", by_alias=True) for ref in item.used_capability_refs
                ]
                if item
                else [],
                proposed_by="FILE",
                entered_by=requested_by,
                entered_at=utcnow(),
                version=version + 1,
                **common,
            )
        )
    if model.readiness_check:
        check = model.readiness_check
        session.add(
            ReadinessCheck(
                readiness_check_id=new_id("rc"),
                opp_id=opp_id,
                checked=check.checked,
                staff_name=check.staff_key,
                checked_at=check.checked_at,
                eval_id_at_check=None,
                **common,
            )
        )
    session.flush()
