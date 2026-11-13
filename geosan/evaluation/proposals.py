"""AI 점수 입력·공정 연결 제안 저장(#286, C6·C9 1차 최소 범위).

사람 값 우선: 사례 파일(FILE)·담당자(STAFF)가 적은 항목은 AI 제안이 덮지 않는다.
AI 제안은 `proposed_by = "AI"` 행으로 남고, 담당자가 확정하면 STAFF 행이 새 버전으로 들어온다.
출처·상태·확정자·근거 참조는 기존 열(proposed_by, entered_by/entered_at, evidence_ids)로 표현한다.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from geosan.config.rule_config import match_rate_steps
from geosan.evaluation.call_inputs import apply_call_signal_inputs, call_item_codes
from geosan.evaluation.inputs import AI_PROPOSED, current_item_inputs, has_ai_pending_inputs
from geosan.evaluation.models import ItemJudgmentInput
from geosan.evidence.extraction import Extraction
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Opportunity, OppProcessLink
from geosan.rules.models import RuleConfig
from geosan.storage.base import new_id, utcnow

AI = AI_PROPOSED

__all__ = ["has_ai_pending_inputs", "store_item_proposals", "store_process_link_proposals"]


def store_item_proposals(
    session: Session,
    opportunity: Opportunity,
    result: Extraction,
    evidence_rows: list[Evidence],
    *,
    rule_config: RuleConfig,
    requested_by: str,
) -> int:
    """제안을 점수 입력 행으로 저장하고 저장한 제안 수를 돌려준다.

    - 사람 값(FILE·STAFF·통화에서 확인한 CALL)이 있는 항목은 건너뛴다(사례 파일 18곳 보호).
    - 제안이 하나도 없으면 아무것도 쓰지 않는다(회사는 "평가 전" 그대로).
    - 제안이 있으면 8항목을 모두 채운다: 제안 없는 항목은 UNAVAILABLE(점수 null) AI 행.
      이전 AI 행은 대체(superseded)한다.
    """
    # #685: 통화에서 확인한 신호로 채우는 항목은 AI 제안을 받지 않는다(와도 저장하지 않는다).
    call_items = call_item_codes(rule_config)
    proposals = {
        item.item_code.value: item
        for item in result.item_input_proposals
        if item.item_code.value not in call_items
    }
    if not proposals:
        return 0
    steps = match_rate_steps(rule_config)
    current = {row.item_code: row for row in current_item_inputs(session, opportunity.opp_id)}
    ids_by_quote: dict[str, list[str]] = {}
    for row in evidence_rows:
        ids_by_quote.setdefault(row.quote, []).append(row.evidence_id)
    now = utcnow()
    stored = 0
    for config_item in rule_config.new_profile_items:
        code = config_item.item_code
        existing = current.get(code)
        if existing is not None and existing.proposed_by != AI:
            continue
        proposal = proposals.get(code)
        if proposal is None and existing is not None:
            continue
        if existing is not None:
            existing.superseded_at = now
        version = (
            session.scalar(
                select(func.max(ItemJudgmentInput.version)).where(
                    ItemJudgmentInput.opp_id == opportunity.opp_id,
                    ItemJudgmentInput.item_code == code,
                )
            )
            or 0
        )
        if proposal is None:
            fields = dict(state="UNAVAILABLE", match_rate_step=None, match_rate=None)
            fact, evidence_ids = None, []
        else:
            fields = dict(
                state=proposal.certainty_proposed,
                match_rate_step=proposal.match_rate_step,
                match_rate=steps[code][proposal.match_rate_step],
            )
            fact, evidence_ids = proposal.fact_judged, sorted(ids_by_quote.get(proposal.quote, []))
            stored += 1
        session.add(
            ItemJudgmentInput(
                item_input_id=new_id("ii"),
                opp_id=opportunity.opp_id,
                item_code=code,
                fact_judged=fact,
                summary=fact,
                evidence_ids=evidence_ids,
                signal_ids=[],
                used_capability_refs=[],
                proposed_by=AI,
                entered_by=requested_by,
                entered_at=now,
                version=version + 1,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
                created_by=requested_by,
                **fields,
            )
        )
    session.flush()
    # #685: 8항목 입력이 생겼으니, 먼저 저장돼 있던 통화 신호가 있으면 그 값을 함께 넣는다.
    apply_call_signal_inputs(
        session, opportunity.opp_id, rule_config, entered_by=requested_by, now=now
    )
    return stored


def store_process_link_proposals(
    session: Session,
    opportunity: Opportunity,
    result: Extraction,
    *,
    allowed_codes: set[str],
    requested_by: str,
) -> int:
    """아직 연결되지 않은 공정만 AI·확인 전 연결로 더한다. 기존 연결은 건드리지 않는다."""
    linked = set(
        session.scalars(
            select(OppProcessLink.process_code).where(
                OppProcessLink.opp_id == opportunity.opp_id,
                OppProcessLink.superseded_at.is_(None),
            )
        )
    )
    added = 0
    for link in result.process_link_proposals:
        if link.process_code not in allowed_codes or link.process_code in linked:
            continue
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=opportunity.opp_id,
                process_code=link.process_code,
                current_reason=link.basis,
                source=AI,
                state="PENDING",
                evidence_ref=link.quote,
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
                created_by=requested_by,
            )
        )
        linked.add(link.process_code)
        added += 1
    if added:
        session.flush()
    return added
