"""사례 파일 검사와 투입(W2). 재투입은 이전 자식 행을 보존하고 현재 행을 교체한다."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from geosan.capability.models import Process
from geosan.config.errors import FieldError, InputError, RunFailedError
from geosan.config.file_checks import CheckReport, check_case_file
from geosan.config.loader import load_document
from geosan.config.paths import normalize_input_path
from geosan.config.registry import load_runtime_config
from geosan.config.schemas import CaseFile
from geosan.evaluation.inputs import store_inputs, supersede_inputs
from geosan.evidence.queries import store_evidence, supersede_evidence
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    Interaction,
    Opportunity,
    OppProcessLink,
    Requirement,
    Signal,
)
from geosan.opportunity.queries import (
    find_case,
    find_customer,
    normalize_address,
    normalize_name,
    supersede_children,
)
from geosan.questions.store import store_research, supersede_research
from geosan.rules.models import RuleConfig
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope


@dataclass
class CaseImportResult:
    customer_id: str
    opp_id: str
    evidence_count: int
    requirement_count: int
    signal_count: int
    warnings: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return (
            f"고객 1·기회 1·근거 {self.evidence_count}·요구 {self.requirement_count}·"
            f"신호 {self.signal_count} 저장. 평가하려면 geosan evaluate"
        )


def check_case(path: Path | str, capability_path: Path | str | None = None) -> CheckReport:
    """DB 연결·저장 없이 기존 검사기의 결과를 돌려준다(BR2.9)."""
    return check_case_file(
        normalize_input_path(path),
        normalize_input_path(capability_path) if capability_path else None,
    )


def import_case(
    path: Path | str, *, requested_by: str = "system", db_path: Path | str | None = None
) -> CaseImportResult:
    file_path = normalize_input_path(path)
    try:
        with session_scope(db_path) as session:
            runtime = load_runtime_config(session)
            report = check_case_file(file_path, rule_config_path=runtime.rule_config_path)
            if not report.ok:
                raise InputError("사례 파일에 오류가 있습니다.", fields=report.errors)
            if report.case is None:
                raise RunFailedError("사례 파일 검사 결과가 없습니다.")
            return _store(
                session,
                report,
                runtime.rule_config,
                runtime.app_settings.active_dataset_kind.value,
                requested_by,
            )
    except SQLAlchemyError as exc:
        raise RunFailedError("사례 파일을 저장하지 못했습니다.") from exc


def _check_processes(
    session: Session, model: CaseFile, report: CheckReport, active_dataset_kind: str
) -> list[str]:
    all_codes = set(session.scalars(select(Process.code)))
    active_codes = set(
        session.scalars(select(Process.code).where(Process.dataset_kind == active_dataset_kind))
    )
    references = [
        (f"processLinks[{i}].processCode", item.process_code.value)
        for i, item in enumerate(model.process_links)
    ]
    references.extend(
        (f"itemInputs[{i}].usedCapabilityRefs[{j}].processCode", ref.process_code.value)
        for i, item in enumerate(model.item_inputs)
        for j, ref in enumerate(item.used_capability_refs)
    )
    missing = [(path, code) for path, code in references if code not in all_codes]
    if missing:
        document = load_document(report.path)
        raise InputError(
            "저장된 역량에 없는 공정입니다.",
            fields=[
                FieldError(
                    path=path,
                    line=document.line_of(path),
                    message=f"공정 {code}의 역량 파일을 먼저 투입해 주세요.",
                )
                for path, code in missing
            ],
        )
    return [
        f"활성 묶음에 없는 공정 {code}: 평가에서 연결이 미확인 처리됩니다."
        for code in sorted({code for _, code in references} - active_codes)
    ]


def _store(
    session: Session,
    report: CheckReport,
    rule_config: RuleConfig,
    active_dataset_kind: str,
    requested_by: str,
) -> CaseImportResult:
    model = report.case
    if model is None:
        raise RunFailedError("사례 파일 검사 결과가 없습니다.")
    warnings = report.warnings + _check_processes(session, model, report, active_dataset_kind)
    common = dict(
        dataset_kind=model.dataset_kind.value, is_virtual=model.is_virtual, created_by=requested_by
    )
    customer = find_customer(
        session,
        biz_number=model.customer.biz_number,
        name=model.customer.name,
        address=model.customer.address,
    )
    if customer is None:
        customer = Customer(customer_id=new_id("cust"), **common)
        session.add(customer)
    values = model.customer.model_dump(exclude={"address"}, mode="json")
    values.update(
        normalized_name=normalize_name(model.customer.name),
        normalized_address=normalize_address(model.customer.address),
        relation_confirmed_at=model.customer.relation_confirmed_at,
    )
    for key, value in values.items():
        setattr(customer, key, value)
    customer.summary_line = model.opportunity.card_reason
    customer.highlights = []
    customer.researched_at = utcnow()
    customer.research_source = "CASE_FILE"
    session.flush()
    opportunity = find_case(session, model.case_id)
    if opportunity is None:
        opportunity = Opportunity(
            opp_id=new_id("opp"), customer_id=customer.customer_id, case_id=model.case_id, **common
        )
        session.add(opportunity)
    elif opportunity.customer_id != customer.customer_id:
        raise InputError(
            "같은 caseId가 다른 고객에 연결되어 있습니다.",
            fields=[
                FieldError(
                    path="caseId", message="기존 사례의 고객 식별 값과 일치하는지 확인해 주세요."
                )
            ],
        )
    else:
        supersede_children(session, opportunity.opp_id)
        supersede_evidence(session, opportunity.opp_id)
        supersede_inputs(session, opportunity.opp_id)
        supersede_research(session, opportunity.opp_id)
    for key, value in model.opportunity.model_dump(mode="json").items():
        setattr(opportunity, key, value)
    opportunity.base_date = model.base_date
    opportunity.dataset_kind = model.dataset_kind.value
    opportunity.is_virtual = model.is_virtual
    session.flush()
    opp_id = opportunity.opp_id
    links = {}
    for item in model.process_links:
        row = OppProcessLink(
            link_id=new_id("link"), opp_id=opp_id, **item.model_dump(mode="json"), **common
        )
        session.add(row)
        links[item.process_code.value] = row
    session.flush()
    evidence = store_evidence(
        session,
        opp_id,
        model.evidence,
        requested_by=requested_by,
        dataset_kind=model.dataset_kind.value,
        is_virtual=model.is_virtual,
    )
    discovery_keys = set()
    for item in model.discovery_paths:
        key = (item.source_id, item.origin_key)
        if key in discovery_keys:
            continue
        discovery_keys.add(key)
        session.add(
            DiscoveryPath(
                path_id=new_id("path"),
                opp_id=opp_id,
                **item.model_dump(),
                **common,
            )
        )
    for item in model.requirements:
        values = item.model_dump(exclude={"link_process_code"}, mode="json")
        values.update(due_at=item.due_at)
        session.add(
            Requirement(
                req_id=new_id("req"),
                opp_id=opp_id,
                link_id=links[item.link_process_code.value].link_id
                if item.link_process_code
                else None,
                **values,
                **common,
            )
        )
    signals = []
    for item in model.signals:
        values = item.model_dump()
        if item.agreed_window:
            values["agreed_window"] = item.agreed_window.model_dump(mode="json")
        row = Signal(
            signal_id=new_id("sig"), opp_id=opp_id, entered_by=requested_by, **values, **common
        )
        session.add(row)
        signals.append(row)
    session.flush()
    for item in model.interactions:
        linked_opp = opp_id if item.linked_to_opportunity else None
        existing = None
        if linked_opp is None:
            # 고객 전체의 이력은 다른 사례에 속할 수도 있다. 같은 이력은 재사용한다.
            existing = session.scalar(
                select(Interaction).where(
                    Interaction.customer_id == customer.customer_id,
                    Interaction.opp_id.is_(None),
                    Interaction.superseded_at.is_(None),
                    Interaction.kind == item.kind.value,
                    Interaction.occurred_at == item.occurred_at,
                    Interaction.allowed_summary == item.allowed_summary,
                )
            )
        if existing is None:
            session.add(
                Interaction(
                    interaction_id=new_id("int"),
                    customer_id=customer.customer_id,
                    opp_id=linked_opp,
                    entered_by=requested_by,
                    **item.model_dump(exclude={"linked_to_opportunity"}),
                    **common,
                )
            )
            session.flush()
    store_inputs(
        session,
        opp_id,
        model,
        rule_config=rule_config,
        match_rates=report.match_rates,
        evidence_ids=[row.evidence_id for row in evidence],
        signal_ids=[row.signal_id for row in signals],
        requested_by=requested_by,
    )
    store_research(
        session,
        opp_id,
        model.research_readiness,
        dataset_kind=model.dataset_kind.value,
        is_virtual=model.is_virtual,
        requested_by=requested_by,
    )
    session.flush()
    return CaseImportResult(
        customer.customer_id, opp_id, len(evidence), len(model.requirements), len(signals), warnings
    )
