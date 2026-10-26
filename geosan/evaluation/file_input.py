"""사례 파일 → 규칙 엔진 입력 변환기 (Step 32, 예비 경로, 계약 C3·C7).

DB를 거치지 않고 **역량 파일 하나 + 사례 파일 폴더**를 읽어 C3 `EvaluationInput` 목록을 만든다.
Step 18의 스냅샷(`geosan/evaluation/snapshot.py`, 이강욱)과 같은 뜻의 입력이되 저장소가 없으므로
ID는 `caseId`·공정 코드 기반 임시값이다(예: `opp-<caseId>`, `proc-anodizing`).

규칙:
- 검사는 `check-case`·역량 파일 검사와 같은 검사기(`geosan.config.file_checks`)를 그대로 쓴다.
- 연락처 패턴·형식 오류가 한 파일에라도 있으면 그 파일을 건너뛰지 않고 **전체를 실패**시킨다
  (InputError).
- 기준일은 `base_date` 인자 > 사례 파일 `baseDate` > 오류.
- 거산 값 묶음(datasetKind)은 역량 파일의 것이 기준이다. 사례 파일의 묶음이 다르면 경고만 남긴다.
- 처리 금지(FORBIDDEN) 근거는 엔진에 넘기지 않고 ID·사유만 남긴다(BR7.3). 운영 전제(BR5.5)는
  스냅샷과 같은 식으로 계산한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from geosan.config.errors import FieldError, InputError
from geosan.config.file_checks import CheckReport, check_capability_file, check_case_file
from geosan.config.registry import DEFAULT_RULE_CONFIG_PATH
from geosan.config.rule_config import load_rule_config, step_name_for
from geosan.config.schemas import CapabilityFile, CaseFile
from geosan.rules.codes import DatasetKind, FilterState, Profile, ScopeKind, SecurityGrade
from geosan.rules.models import (
    AgreedWindow,
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
    UsedCapabilityRef,
)

ALLOWED_SECURITY_GRADES = {
    SecurityGrade.PUBLIC,
    SecurityGrade.EXTERNAL_AI_OK,
    SecurityGrade.INTERNAL_ONLY,
}
"""운영 전제(BR5.5)가 허용하는 근거 보안 등급. FORBIDDEN·UNKNOWN은 전제를 깨뜨린다."""

FORBIDDEN_REASON = "처리 금지 자료"


def process_id_for(code: str) -> str:
    """공정 코드 → 임시 공정 ID (`ANODIZING` → `proc-anodizing`). 테스트 입력 파일과 같은 규칙."""
    return "proc-" + code.lower().replace("_", "-")


def _slug(code: str) -> str:
    return code.lower().replace("_", "-")


@dataclass
class FileCase:
    """사례 파일 하나를 변환한 결과."""

    path: Path
    case: CaseFile
    evaluation_input: EvaluationInput
    blocked_evidence: list[tuple[str, str]] = field(default_factory=list)
    """(evidenceId, 차단 사유). 엔진에는 넘기지 않고 출력물의 근거 수 설명에만 쓴다."""
    warnings: list[str] = field(default_factory=list)

    @property
    def case_id(self) -> str:
        return self.case.case_id

    @property
    def opp_id(self) -> str:
        return self.evaluation_input.opportunity.opp_id


@dataclass
class FileInputs:
    """역량 파일 + 사례 파일 폴더를 변환한 전체 결과."""

    capability_path: Path
    capability: CapabilityFile
    snapshot: CapabilitySnapshot
    dataset_kind: DatasetKind
    rule_config: RuleConfig
    cases: list[FileCase]
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 역량 파일 → CapabilitySnapshot
# ---------------------------------------------------------------------------


def capability_snapshot(capability: CapabilityFile) -> CapabilitySnapshot:
    """역량 파일을 C3 capability 모양으로 바꾼다. ID는 공정 코드·순번 기반 임시값."""
    processes: list[ProcessInput] = []
    capabilities: list[CapabilityInput] = []
    records: list[DeliveryRecordInput] = []
    for process in capability.processes:
        pid = process_id_for(process.code)
        processes.append(
            ProcessInput(
                process_id=pid,
                code=process.code,
                material_codes=list(process.material_codes),
                performance_tags=list(process.performance_tags),
                review_status=process.review_status,
                dataset_kind=capability.dataset_kind,
            )
        )
        for index, item in enumerate(process.capabilities, start=1):
            capabilities.append(
                CapabilityInput(
                    capability_id=f"cap-{_slug(process.code)}-{index:02d}",
                    process_id=pid,
                    cap_kind=item.cap_kind,
                    name=item.name,
                    numeric_min=item.numeric_min,
                    numeric_max=item.numeric_max,
                    unit=item.unit,
                    is_descriptive_only=item.is_descriptive_only,
                    review_status=item.review_status,
                )
            )
        for index, record in enumerate(process.delivery_records, start=1):
            records.append(
                DeliveryRecordInput(
                    record_id=f"rec-{_slug(process.code)}-{index:02d}",
                    process_id=pid,
                    industry=record.industry,
                    part_type=record.part_type,
                    review_status=record.review_status,
                )
            )

    qualifications: list[QualificationInput] = []
    scopes: list[QualificationScopeInput] = []
    for q_index, qual in enumerate(capability.qualifications, start=1):
        qual_id = f"qual-{q_index:02d}"
        latest = max(
            qual.statuses, key=lambda s: (s.occurred_at or date.min, s.confirmed_at or date.min)
        )
        qualifications.append(
            QualificationInput(
                qual_id=qual_id,
                kind=qual.kind,
                official_name=qual.official_name,
                number=qual.number,
                edition=qual.edition,
                holder=qual.holder,
                site=qual.site,
                valid_from=qual.valid_from,
                valid_to=qual.valid_to,
                review_status=qual.review_status,
                current_status=latest.status,
            )
        )
        for s_index, scope in enumerate(qual.scopes, start=1):
            scopes.append(
                QualificationScopeInput(
                    scope_id=f"scope-{q_index:02d}-{s_index:02d}",
                    qual_id=qual_id,
                    scope_kind=scope.scope_kind,
                    process_id=process_id_for(scope.process_code)
                    if scope.scope_kind == "PROCESS" and scope.process_code
                    else None,
                    customer_id=scope.customer_ref if scope.scope_kind == "CUSTOMER" else None,
                    opp_id=None,  # 파일 경로에서는 기회 범위 자격을 특정 기회에 묶을 방법이 없다
                    applicability=scope.applicability,
                    review_status=scope.review_status,
                )
            )
    return CapabilitySnapshot(
        processes=processes,
        capabilities=capabilities,
        delivery_records=records,
        qualifications=qualifications,
        qualification_scopes=scopes,
    )


def _resolve_refs(
    refs: list, snapshot: CapabilitySnapshot
) -> tuple[list[str], list[UsedCapabilityRef], bool]:
    """usedCapabilityRefs를 스냅샷 ID로 해석한다(snapshot.py와 같은 규칙).

    하나라도 못 찾으면 미완(complete=False)."""
    processes = {row.code: row for row in snapshot.processes}
    resolved: list[str] = []
    converted: list[UsedCapabilityRef] = []
    complete = True
    for ref in refs:
        converted.append(
            UsedCapabilityRef(
                kind=ref.kind, process_code=ref.process_code, name=ref.name, industry=ref.industry
            )
        )
        process = processes.get(ref.process_code)
        matches: list[str] = []
        if process is not None:
            if ref.kind == "PROCESS":
                matches = [process.process_id]
            elif ref.kind == "CAPABILITY":
                matches = [
                    row.capability_id
                    for row in snapshot.capabilities
                    if row.process_id == process.process_id and row.name == ref.name
                ]
            elif ref.kind == "DELIVERY_RECORD":
                matches = [
                    row.record_id
                    for row in snapshot.delivery_records
                    if row.process_id == process.process_id and row.industry == ref.industry
                ]
        if len(matches) != 1:
            complete = False
        else:
            resolved.extend(matches)
    return sorted(set(resolved)), converted, complete


# ---------------------------------------------------------------------------
# 사례 파일 → EvaluationInput
# ---------------------------------------------------------------------------


def case_to_evaluation_input(
    report: CheckReport,
    *,
    snapshot: CapabilitySnapshot,
    dataset_kind: DatasetKind,
    rule_config: RuleConfig,
    base_date: date | None,
) -> FileCase:
    """검사를 통과한 사례 파일(report.case)을 엔진 입력으로 바꾼다."""
    case = report.case
    if case is None:
        raise ValueError("검사를 통과한 사례 파일만 변환할 수 있습니다")
    effective_base = base_date or case.base_date
    if effective_base is None:
        raise InputError(
            message=(
                f"{report.path.name}: 기준일이 없습니다. "
                "--base-date를 주거나 파일에 baseDate를 적어 주세요."
            ),
            next_action="예: --base-date 2026-10-27",
            fields=[FieldError(path="baseDate", message="기준일이 없습니다", line=1)],
        )
    cid = case.case_id
    warnings: list[str] = []
    if case.dataset_kind != dataset_kind:
        warnings.append(
            f"{report.path.name}: 사례 파일의 거산 값 묶음 {case.dataset_kind}과 역량 파일의 "
            f"{dataset_kind}이 다릅니다. 평가는 역량 파일 묶음({dataset_kind})으로 합니다."
        )

    processes = {row.code: row for row in snapshot.processes}

    # 공정 연결
    links: list[ProcessLinkInput] = []
    link_id_by_code: dict[str, str] = {}
    for index, link in enumerate(case.process_links, start=1):
        link_id = f"link-{cid}-{index:04d}"
        link_id_by_code.setdefault(link.process_code, link_id)
        process = processes.get(link.process_code)
        links.append(
            ProcessLinkInput(
                link_id=link_id,
                process_id=process.process_id if process else None,
                process_code=link.process_code,
                applied_material=link.applied_material,
            )
        )

    # 요구
    requirements = [
        RequirementInput(
            req_id=f"req-{cid}-{index:04d}",
            link_id=link_id_by_code.get(req.link_process_code)
            if req.scope_kind == ScopeKind.PROCESS_LINK and req.link_process_code
            else None,
            req_kind=req.req_kind,
            name=req.name,
            content=req.content,
            req_level=req.req_level,
            scope_kind=req.scope_kind,
            needed_stage=req.needed_stage,
            due_at=req.due_at,
            certainty=req.certainty,
            required_value=req.required_value,
            unit=req.unit,
            edition=req.edition,
            holder=None,
            site=None,
        )
        for index, req in enumerate(case.requirements, start=1)
    ]

    # 근거: 처리 금지 자료는 엔진에 넘기지 않는다(BR7.3)
    evidence_ids = [f"ev-{cid}-{index:04d}" for index in range(1, len(case.evidence) + 1)]
    blocked: list[tuple[str, str]] = []
    permitted: set[str] = set()
    evidence: list[EvidenceInput] = []
    for ev_id, ev in zip(evidence_ids, case.evidence, strict=True):
        if ev.security_grade == SecurityGrade.FORBIDDEN:
            blocked.append((ev_id, FORBIDDEN_REASON))
            continue
        permitted.add(ev_id)
        evidence.append(
            EvidenceInput(
                evidence_id=ev_id,
                source_grade=ev.source_grade,
                certainty=ev.certainty,
                is_llm_proposed=ev.is_llm_proposed,
                subject=ev.subject,
                occurred_at=ev.occurred_at,
                security_grade=ev.security_grade,
            )
        )

    # 신호의 근거는 그 신호를 가리키는 항목 입력의 근거로 잇는다(사례 파일에는 직접 연결이 없음)
    signal_ids = [f"sig-{cid}-{index:04d}" for index in range(1, len(case.signals) + 1)]
    signal_evidence: dict[str, set[str]] = {sid: set() for sid in signal_ids}
    for item in case.item_inputs:
        for s_ref in item.signal_refs:
            for e_ref in item.evidence_refs:
                if evidence_ids[e_ref] in permitted:
                    signal_evidence[signal_ids[s_ref]].add(evidence_ids[e_ref])
    signals = [
        SignalInput(
            signal_id=sid,
            signal_kind=sig.signal_kind,
            occurred_at=sig.occurred_at,
            announced_at=sig.announced_at,
            scheduled_at=sig.scheduled_at,
            deadline_at=sig.deadline_at,
            progress_status=sig.progress_status,
            agreed_window=AgreedWindow(days=sig.agreed_window.days, basis=sig.agreed_window.basis)
            if sig.agreed_window
            else None,
            certainty=sig.certainty,
            relation=sig.relation,
            evidence_ids=sorted(signal_evidence[sid]),
        )
        for sid, sig in zip(signal_ids, case.signals, strict=True)
    ]

    interactions = [
        InteractionInput(
            interaction_id=f"int-{cid}-{index:04d}",
            kind=inter.kind,
            occurred_at=inter.occurred_at,
            linked_to_opportunity=inter.linked_to_opportunity,
            certainty=inter.certainty,
        )
        for index, inter in enumerate(case.interactions, start=1)
    ]
    linked = [inter for inter in case.interactions if inter.linked_to_opportunity]

    # 8항목 입력
    items: list[ItemInput] = []
    refs_complete = True
    for item in case.item_inputs:
        ids, converted, complete = _resolve_refs(item.used_capability_refs, snapshot)
        refs_complete = refs_complete and complete
        rate = report.match_rates.get(str(item.item_code))
        step = item.match_rate if isinstance(item.match_rate, str) else None
        if step is None and rate is not None:
            step = step_name_for(rule_config, str(item.item_code), rate)
        items.append(
            ItemInput(
                item_code=item.item_code,
                state=item.state,
                match_rate=rate,
                match_rate_step=step,
                fact_judged=item.fact_judged,
                summary=item.summary,
                evidence_ids=sorted(
                    {evidence_ids[e] for e in item.evidence_refs if evidence_ids[e] in permitted}
                ),
                signal_ids=sorted({signal_ids[s] for s in item.signal_refs}),
                used_capability_refs=converted,
                used_capability_ids=ids,
            )
        )

    reviews = {
        **{row.process_id: row.review_status for row in snapshot.processes},
        **{row.capability_id: row.review_status for row in snapshot.capabilities},
        **{row.record_id: row.review_status for row in snapshot.delivery_records},
    }
    operational_ready = (
        refs_complete
        and all(reviews[key] == "REVIEWED" for item in items for key in item.used_capability_ids)
        and all(ev.security_grade in ALLOWED_SECURITY_GRADES for ev in case.evidence)
    )

    research = case.research_readiness
    evaluation_input = EvaluationInput(
        base_date=effective_base,
        profile=Profile.NEW,
        rule_config=rule_config,
        dataset_kind=dataset_kind,
        opportunity=OpportunityInput(
            opp_id=f"opp-{cid}",
            customer_id=f"cust-{cid}",
            relation_status=case.customer.relation_status,
            purpose=case.opportunity.purpose,
            company_filter_status=FilterState.PASS,
            has_linked_interaction=bool(linked),
            linked_interaction_kinds=sorted({inter.kind for inter in linked}),
            card_reason=case.opportunity.card_reason,
        ),
        process_links=links,
        requirements=requirements,
        signals=signals,
        interactions=interactions,
        evidence=evidence,
        capability=snapshot,
        readiness_check=ReadinessCheckInput(
            checked=case.readiness_check.checked,
            checked_at=case.readiness_check.checked_at,
            eval_id_at_check=None,
        )
        if case.readiness_check
        else None,
        research_readiness=ResearchReadinessInput(
            has_graded_evidence=any(ev.source_grade in {"A", "B", "C"} for ev in evidence),
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
    return FileCase(
        path=report.path,
        case=case,
        evaluation_input=evaluation_input,
        blocked_evidence=blocked,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# 폴더 전체
# ---------------------------------------------------------------------------


def list_case_files(cases_dir: Path) -> list[Path]:
    """폴더 안 `*.json`을 이름순으로.

    `case-template.json`처럼 빈 틀은 걸러지지 않으니 사례 파일 폴더를 따로 둔다."""
    return sorted(p for p in cases_dir.glob("*.json") if p.is_file() and not p.is_symlink())


def _fields_with_file(report: CheckReport) -> list[FieldError]:
    """검사기 오류의 경로 앞에 파일 이름을 붙여 어느 파일인지 보이게 한다."""
    return [
        FieldError(
            path=f"{report.path.name}: {e.path}" if e.path else report.path.name,
            message=e.message,
            line=e.line,
        )
        for e in report.errors
    ]


def load_file_inputs(
    capability_path: Path,
    cases_dir: Path,
    *,
    base_date: date | None = None,
    rule_config_path: Path | None = None,
) -> FileInputs:
    """역량 파일 + 사례 파일 폴더 → 엔진 입력 목록.

    어느 파일이든 오류가 있으면 전체가 InputError(아무것도 돌려주지 않음)."""
    rule_config = load_rule_config(rule_config_path or DEFAULT_RULE_CONFIG_PATH)

    cap_report = check_capability_file(capability_path)
    if not cap_report.ok or cap_report.capability is None:
        raise InputError(
            message=(
                f"역량 파일 검사 실패: {capability_path.name}에 오류 {len(cap_report.errors)}건"
            ),
            next_action="위 줄 번호의 항목을 고친 뒤 다시 실행해 주세요.",
            fields=_fields_with_file(cap_report),
        )
    capability = cap_report.capability
    snapshot = capability_snapshot(capability)
    dataset_kind = DatasetKind(capability.dataset_kind)

    paths = list_case_files(cases_dir)
    if not paths:
        raise InputError(
            message=f"사례 파일 폴더에 JSON 파일이 없습니다: {cases_dir}",
            next_action="사례 파일(*.json)을 그 폴더에 넣거나 --cases 경로를 확인해 주세요.",
        )

    warnings: list[str] = list(cap_report.warnings)
    errors: list[FieldError] = []
    failed_files: list[str] = []
    reports: list[CheckReport] = []
    for path in paths:
        report = check_case_file(path, capability_path, rule_config_path)
        warnings.extend(f"{path.name}: {w}" for w in report.warnings)
        if not report.ok:
            failed_files.append(path.name)
            errors.extend(_fields_with_file(report))
        else:
            reports.append(report)
    if errors:
        raise InputError(
            message=(
                f"사례 파일 검사 실패: {', '.join(failed_files)} (오류 {len(errors)}건). "
                "아무것도 쓰지 않았습니다."
            ),
            next_action=(
                "위 줄 번호의 항목을 고친 뒤 다시 실행해 주세요. 연락처가 있으면 그 칸을 지웁니다."
            ),
            fields=errors,
        )

    cases: list[FileCase] = []
    seen: dict[str, str] = {}
    for report in reports:
        file_case = case_to_evaluation_input(
            report,
            snapshot=snapshot,
            dataset_kind=dataset_kind,
            rule_config=rule_config,
            base_date=base_date,
        )
        if file_case.case_id in seen:
            raise InputError(
                message=(
                    f"같은 caseId '{file_case.case_id}'가 두 파일에 있습니다: "
                    f"{seen[file_case.case_id]}, {report.path.name}"
                ),
                next_action="한 파일의 caseId를 바꿔 주세요.",
            )
        seen[file_case.case_id] = report.path.name
        warnings.extend(file_case.warnings)
        cases.append(file_case)

    return FileInputs(
        capability_path=capability_path,
        capability=capability,
        snapshot=snapshot,
        dataset_kind=dataset_kind,
        rule_config=rule_config,
        cases=cases,
        warnings=warnings,
    )
