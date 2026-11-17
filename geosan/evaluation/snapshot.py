"""현재 입력과 활성 역량 묶음을 모아 평가 입력 및 재현용 해시를 만든다."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.capability import queries as catalog
from geosan.capability.models import FieldEvidence
from geosan.config.errors import InputError
from geosan.evaluation.inputs import current_item_inputs, current_readiness_check
from geosan.evidence.models import Evidence
from geosan.opportunity import queries as opportunities
from geosan.opportunity.models import Customer, Opportunity
from geosan.questions.store import current_research
from geosan.rules.models import (
    CapabilityInput,
    CapabilitySnapshot,
    DeliveryRecordInput,
    EvaluationInput,
    EvidenceInput,
    InteractionInput,
    ItemInput,
    OpportunityInput,
    ProcessInput,
    ProcessLinkInput,
    QualificationInput,
    QualificationScopeInput,
    ReadinessCheckInput,
    RequirementInput,
    ResearchReadinessInput,
    RuleConfig,
    SignalInput,
)


def canonical_hash(document: Any) -> str:
    encoded = json.dumps(
        document, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass
class Snapshot:
    evaluation_input: EvaluationInput
    document: dict[str, Any]
    snapshot_hash: str
    capability_version: str


def freeze_snapshot(evaluation_input: EvaluationInput, capability_version: str) -> Snapshot:
    """해시와 저장 문서는 엔진에 넘기는 가변 모델에서 분리한다."""
    document = evaluation_input.model_dump(mode="json", by_alias=True)
    return Snapshot(evaluation_input, document, canonical_hash(document), capability_version)


def _convert(model, row, **overrides):
    values = {key: getattr(row, key) for key in model.model_fields if hasattr(row, key)}
    values.update(overrides)
    return model.model_validate(values)


def _capability_snapshot(session: Session, dataset_kind: str) -> CapabilitySnapshot:
    qualifications = []
    for row in catalog.list_qualifications(session, dataset_kind=dataset_kind):
        status = catalog.latest_qualification_status(
            session, row.qual_id, dataset_kind=dataset_kind
        )
        qualifications.append(
            _convert(
                QualificationInput, row, current_status=status.status if status else "UNCONFIRMED"
            )
        )
    snapshot = CapabilitySnapshot(
        processes=[
            _convert(ProcessInput, row)
            for row in catalog.list_processes(session, dataset_kind=dataset_kind)
        ],
        capabilities=[
            _convert(CapabilityInput, row)
            for row in catalog.list_capabilities(session, dataset_kind=dataset_kind)
        ],
        delivery_records=[
            _convert(DeliveryRecordInput, row)
            for row in catalog.list_delivery_records(session, dataset_kind=dataset_kind)
        ],
        qualifications=qualifications,
        qualification_scopes=[
            _convert(QualificationScopeInput, row)
            for row in catalog.list_scopes(session, dataset_kind=dataset_kind)
        ],
    )
    for rows, key in (
        (snapshot.processes, "process_id"),
        (snapshot.capabilities, "capability_id"),
        (snapshot.delivery_records, "record_id"),
        (snapshot.qualifications, "qual_id"),
        (snapshot.qualification_scopes, "scope_id"),
    ):
        rows.sort(key=lambda row, field=key: getattr(row, field))
    return snapshot


def _resolve_refs(refs: list[dict], capability: CapabilitySnapshot) -> tuple[list[str], bool]:
    processes = {row.code: row for row in capability.processes}
    resolved = []
    complete = True
    for ref in refs:
        process = processes.get(ref["processCode"])
        matches = []
        if process is not None:
            if ref["kind"] == "PROCESS":
                matches = [process.process_id]
            elif ref["kind"] == "CAPABILITY":
                matches = [
                    row.capability_id
                    for row in capability.capabilities
                    if row.process_id == process.process_id and row.name == ref.get("name")
                ]
            elif ref["kind"] == "DELIVERY_RECORD":
                matches = [
                    row.record_id
                    for row in capability.delivery_records
                    if row.process_id == process.process_id and row.industry == ref.get("industry")
                ]
        if len(matches) != 1:
            complete = False
        else:
            resolved.extend(matches)
    return sorted(set(resolved)), complete


def build_snapshot(
    session: Session,
    opp_id: str,
    *,
    base_date: date,
    dataset_kind: str,
    rule_config: RuleConfig,
    allow_empty_inputs: bool = False,
) -> Snapshot | None:
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise InputError(f"평가할 기회가 없습니다: {opp_id}")
    customer = session.get(Customer, opportunity.customer_id)
    if customer is None:
        raise InputError(f"기회의 고객을 찾을 수 없습니다: {opp_id}")
    inputs = current_item_inputs(session, opp_id)
    expected = {item.item_code for item in rule_config.new_profile_items}
    if len(inputs) != len(expected) or {item.item_code for item in inputs} != expected:
        if inputs or not allow_empty_inputs:
            return None

    capability = _capability_snapshot(session, dataset_kind)
    processes = {row.code: row for row in capability.processes}
    evidence_rows = list(
        session.scalars(
            select(Evidence)
            .where(Evidence.opp_id == opp_id, Evidence.superseded_at.is_(None))
            .order_by(Evidence.evidence_id)
        )
    )
    permitted = {row.evidence_id for row in evidence_rows if row.security_grade != "FORBIDDEN"}
    evidence = [
        _convert(EvidenceInput, row, certainty=row.certainty_confirmed or row.certainty_proposed)
        for row in evidence_rows
        if row.evidence_id in permitted
    ]
    items = []
    refs_complete = True
    for row in inputs:
        ids, complete = _resolve_refs(row.used_capability_refs, capability)
        refs_complete = refs_complete and complete
        items.append(
            _convert(
                ItemInput,
                row,
                evidence_ids=sorted(set(row.evidence_ids) & permitted),
                signal_ids=sorted(row.signal_ids),
                used_capability_ids=ids,
            )
        )
    reviews = {
        **{row.process_id: row.review_status for row in capability.processes},
        **{row.capability_id: row.review_status for row in capability.capabilities},
        **{row.record_id: row.review_status for row in capability.delivery_records},
    }
    operational_ready = (
        bool(inputs)
        and refs_complete
        and all(reviews[key] == "REVIEWED" for item in items for key in item.used_capability_ids)
        and all(
            row.security_grade in {"PUBLIC", "EXTERNAL_AI_OK", "INTERNAL_ONLY"}
            for row in evidence_rows
        )
    )
    interactions = opportunities.list_linked_interactions(session, opp_id)
    readiness = current_readiness_check(session, opp_id)
    research = current_research(session, opp_id)
    evaluation_input = EvaluationInput(
        base_date=base_date,
        profile="NEW",
        rule_config=rule_config,
        dataset_kind=dataset_kind,
        opportunity=_convert(
            OpportunityInput,
            opportunity,
            relation_status=customer.relation_status,
            company_filter_status=customer.company_filter_status,
            has_linked_interaction=bool(interactions),
            linked_interaction_kinds=sorted({row.kind for row in interactions}),
        ),
        process_links=[
            _convert(
                ProcessLinkInput,
                row,
                process_id=processes[row.process_code].process_id
                if row.process_code in processes
                else None,
            )
            for row in sorted(
                opportunities.list_process_links(session, opp_id), key=lambda r: r.link_id
            )
        ],
        requirements=[
            _convert(RequirementInput, row)
            for row in sorted(
                opportunities.list_requirements(session, opp_id), key=lambda r: r.req_id
            )
        ],
        signals=[
            _convert(
                SignalInput,
                row,
                evidence_ids=[row.evidence_id] if row.evidence_id in permitted else [],
            )
            for row in sorted(
                opportunities.list_signals(session, opp_id), key=lambda r: r.signal_id
            )
        ],
        interactions=[
            _convert(InteractionInput, row, linked_to_opportunity=True)
            for row in sorted(interactions, key=lambda r: r.interaction_id)
            if row.security_grade != "FORBIDDEN"
        ],
        evidence=evidence,
        capability=capability,
        readiness_check=_convert(ReadinessCheckInput, readiness) if readiness else None,
        research_readiness=ResearchReadinessInput(
            has_graded_evidence=any(row.source_grade in {"A", "B", "C"} for row in evidence),
            has_question_set=bool(research.question_set),
            has_channel_and_owner=bool(research.allowed_channel and research.owner),
            question_can_change_class=bool(research.can_change_class),
            estimated_hours=research.estimated_hours,
            max_hours=research.max_hours,
            question_set=[str(q) for q in (research.question_set or [])],
        )
        if research
        else None,
        operational_ready=operational_ready,
        item_inputs=items,
    )
    versions = [
        (row.target_table, row.target_id, row.target_field, row.data_version)
        for row in session.scalars(
            select(FieldEvidence).where(FieldEvidence.dataset_kind == dataset_kind)
        )
    ]
    result = freeze_snapshot(evaluation_input, canonical_hash(sorted(versions)))
    # 엔진에는 금지 자료를 넘기지 않고, 기록에는 식별자·차단 사유만 남긴다(BR7.3).
    result.document["evidence"].extend(
        {"evidenceId": row.evidence_id, "blocked": True, "blockedReason": "처리 금지 자료"}
        for row in evidence_rows
        if row.security_grade == "FORBIDDEN"
    )
    result.document["evidence"].sort(key=lambda row: row["evidenceId"])
    result.snapshot_hash = canonical_hash(result.document)
    return result
