"""요구 조건 판정·표시·공정별 필터를 입력 스냅샷만으로 계산한다 (BR3.1~3.7, BR3.10).

REQUIRED·UNKNOWN 단계의 PASS 표시는 BR3.3·S08을 잠정 적용한다(이슈 #6, PM 확정 대기).
DB·파일·현재 시각을 사용하지 않고 경계 모델이나 입력을 변경하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any

from geosan.rules.codes import (
    Applicability,
    CapKind,
    CheckDisplay,
    CheckResult,
    ExclusionScope,
    FilterState,
    NeededStage,
    QualificationStatusCode,
    RelationStatus,
    ReqKind,
    ReqLevel,
    ReviewStatus,
    ScopeKind,
)
from geosan.rules.models import (
    CapabilityInput,
    EvaluationInput,
    ProcessLinkInput,
    ProcessLinkResult,
    QualificationInput,
    QualificationScopeInput,
    RequirementCheckOutput,
    RequirementInput,
)


@dataclass(frozen=True)
class RequirementComparison:
    """BR3.1의 판정·사유·비교값. C3 표시값을 만들기 전의 내부 계산 결과."""

    result: CheckResult
    reason: str
    compared_value: dict[str, Any] | None = None
    qual_id: str | None = None
    follow_up_condition: str | None = None


@dataclass(frozen=True)
class RequirementAssessment:
    """C3 EvaluationOutput의 요구·필터 관련 값만 묶은 내부 계산 결과 (BR3.1~3.7)."""

    requirement_checks: list[RequirementCheckOutput]
    filter_state: FilterState
    exclusion_scope: ExclusionScope | None
    process_link_results: list[ProcessLinkResult]


def requirement_display(requirement: RequirementInput, result: CheckResult) -> CheckDisplay:
    """판정과 화면 표시를 구분한다. 나중 단계는 후속 단계 미완료다 (BR3.3, BR3.5)."""
    if result == CheckResult.EXCLUDED:
        return CheckDisplay.EXCLUDED
    # C1과 차이, PM 확정 대기(이슈 #6)
    if (
        requirement.req_level == ReqLevel.REQUIRED
        and requirement.needed_stage == NeededStage.UNKNOWN
    ):
        return CheckDisplay.PENDING_BLOCKS
    if result == CheckResult.PASS:
        return CheckDisplay.PASS
    if requirement.needed_stage == NeededStage.LATER:
        return CheckDisplay.LATER_STAGE
    if requirement.req_level == ReqLevel.REQUIRED:
        return CheckDisplay.PENDING_BLOCKS
    return CheckDisplay.QUESTION_NEEDED


def check_requirement(
    requirement: RequirementInput, evaluation_input: EvaluationInput
) -> RequirementCheckOutput:
    """요구 하나의 비교 결과를 기존 C3 판정 행으로 만든다 (BR3.1~3.6)."""
    comparison = compare_requirement(requirement, evaluation_input)
    reason = comparison.reason
    if comparison.result == CheckResult.EXCLUDED and requirement.req_level != ReqLevel.REQUIRED:
        reason += "; 우대·비요구·수준 미확인 요구 미충족 (승인은 막지 않음)"
    return RequirementCheckOutput(
        req_id=requirement.req_id,
        result=comparison.result,
        display_result=requirement_display(requirement, comparison.result),
        stage_judged=requirement.needed_stage,
        scope_judged=(
            ScopeKind.PROCESS_LINK
            if requirement.req_kind == ReqKind.TECHNICAL
            else requirement.scope_kind
        ),
        reason=reason,
        compared_value=comparison.compared_value,
        qual_id=comparison.qual_id,
        link_id=requirement.link_id,
        follow_up_condition=comparison.follow_up_condition,
    )


def assess_requirements(evaluation_input: EvaluationInput) -> RequirementAssessment:
    """요구마다 판정 한 행을 만들고 제외 범위·필터를 집계한다 (BR3.1, BR3.4, BR3.7, BR3.10)."""
    checks = [check_requirement(req, evaluation_input) for req in evaluation_input.requirements]
    blocking = [
        check
        for req, check in zip(evaluation_input.requirements, checks, strict=True)
        if req.req_kind != ReqKind.QUANTITY_DELIVERY
        and req.req_level == ReqLevel.REQUIRED
        and req.needed_stage != NeededStage.LATER
    ]
    links = [
        _check_process_link(link, evaluation_input, blocking)
        for link in evaluation_input.process_links
    ]
    opportunity_checks = [
        check for check in blocking if check.scope_judged == ScopeKind.OPPORTUNITY
    ]
    whole_scope = None
    if evaluation_input.opportunity.company_filter_status == FilterState.EXCLUDED:
        whole_scope = ExclusionScope.COMPANY
    elif any(check.result == CheckResult.EXCLUDED for check in opportunity_checks):
        whole_scope = ExclusionScope.OPPORTUNITY
    if whole_scope is not None:
        links = [
            ProcessLinkResult(
                link_id=link.link_id,
                result=FilterState.EXCLUDED,
                reason="기업 전체 제한"
                if whole_scope == ExclusionScope.COMPANY
                else "기회 필수 요구 미충족",
            )
            for link in links
        ]
        return RequirementAssessment(checks, FilterState.EXCLUDED, whole_scope, links)

    excluded_links = {link.link_id for link in links if link.result == FilterState.EXCLUDED}
    exclusion_scope = ExclusionScope.LINK if excluded_links else None
    remaining = [link for link in links if link.result != FilterState.EXCLUDED]
    if links and not remaining:
        return RequirementAssessment(checks, FilterState.EXCLUDED, exclusion_scope, links)
    active_checks = [
        check
        for check in blocking
        if check.scope_judged == ScopeKind.OPPORTUNITY or check.link_id not in excluded_links
    ]
    pending = (
        evaluation_input.opportunity.company_filter_status == FilterState.PENDING
        or evaluation_input.opportunity.relation_status == RelationStatus.UNCONFIRMED
        or any(link.result == FilterState.PENDING for link in remaining)
        or any(_check_is_pending(check) for check in active_checks)
    )
    return RequirementAssessment(
        checks, FilterState.PENDING if pending else FilterState.PASS, exclusion_scope, links
    )


def _check_is_pending(check: RequirementCheckOutput) -> bool:
    """필수 요구는 단계가 미확인이거나 충족 여부가 미확인이면 대기한다 (BR3.4)."""
    return check.stage_judged == NeededStage.UNKNOWN or check.result == CheckResult.UNKNOWN


def _check_process_link(
    link: ProcessLinkInput,
    evaluation_input: EvaluationInput,
    blocking: list[RequirementCheckOutput],
) -> ProcessLinkResult:
    """공정·소재와 그 연결의 필수 요구만 판정해 다른 연결로 제외를 전파하지 않는다 (BR3.7)."""
    checks = [
        check
        for check in blocking
        if check.scope_judged == ScopeKind.PROCESS_LINK and check.link_id == link.link_id
    ]
    process = next(
        (
            process
            for process in evaluation_input.capability.processes
            if process.process_id == link.process_id
            and process.code == link.process_code
            and process.dataset_kind == evaluation_input.dataset_kind
        ),
        None,
    )
    mismatch = (
        process is not None
        and process.review_status == ReviewStatus.REVIEWED
        and bool(process.material_codes)
        and bool(link.applied_material)
        and link.applied_material not in process.material_codes
    )
    excluded = next((check for check in checks if check.result == CheckResult.EXCLUDED), None)
    if mismatch or excluded is not None:
        return ProcessLinkResult(
            link_id=link.link_id,
            result=FilterState.EXCLUDED,
            reason="검수된 공정의 처리 소재와 일치하지 않습니다" if mismatch else excluded.reason,
        )
    if (
        process is None
        or process.review_status != ReviewStatus.REVIEWED
        or not process.material_codes
        or not link.applied_material
        or any(_check_is_pending(check) for check in checks)
    ):
        return ProcessLinkResult(
            link_id=link.link_id,
            result=FilterState.PENDING,
            reason="공정·소재 또는 지금 단계 필수 요구의 확인이 필요합니다",
        )
    return ProcessLinkResult(
        link_id=link.link_id,
        result=FilterState.PASS,
        reason="공정·소재와 지금 단계 필수 요구가 일치합니다",
    )


def compare_requirement(
    requirement: RequirementInput, evaluation_input: EvaluationInput
) -> RequirementComparison:
    """요구 하나를 비교한다. 수준·필요 단계는 추정하거나 바꾸지 않는다 (BR3.1~3.6).

    LATER는 현재 자격의 충족 여부와 무관하게 UNKNOWN이다. QUANTITY_DELIVERY는
    항상 UNKNOWN이며 필터에서 제외해야 한다(BR3.6). 표시값·필터는 여기서 계산하지 않는다.
    """
    if requirement.needed_stage == NeededStage.LATER:
        return RequirementComparison(
            result=CheckResult.UNKNOWN,
            reason="나중 단계에 필요한 요구이므로 지금 충족 여부를 판정하지 않습니다",
            follow_up_condition="후속 단계 미완료: " + (requirement.content or requirement.name),
        )
    if requirement.req_kind == ReqKind.QUANTITY_DELIVERY:
        return RequirementComparison(
            result=CheckResult.UNKNOWN,
            reason="수량·납기·생산 여력은 담당자 확인 대상이며 자동 판정하지 않습니다",
        )
    if requirement.req_kind == ReqKind.TECHNICAL:
        return _compare_technical(requirement, evaluation_input)
    return _compare_qualification(requirement, evaluation_input)


def _scope_matches(
    scope: QualificationScopeInput,
    requirement: RequirementInput,
    evaluation_input: EvaluationInput,
) -> bool:
    """공정·고객·기회 범위를 해당 대상의 ID와 대조한다 (BR1.4, BR3.2)."""
    if scope.scope_kind == "PROCESS":
        return scope.process_id is not None and any(
            link.link_id == requirement.link_id and link.process_id == scope.process_id
            for link in evaluation_input.process_links
        )
    if scope.scope_kind == "CUSTOMER":
        return scope.customer_id == evaluation_input.opportunity.customer_id
    return scope.opp_id == evaluation_input.opportunity.opp_id


def _compare_qualification(
    requirement: RequirementInput, evaluation_input: EvaluationInput
) -> RequirementComparison:
    """명칭·판본·종류가 일치하는 자격만 후보로 삼는다 (BR3.2)."""
    candidates = sorted(
        (
            qualification
            for qualification in evaluation_input.capability.qualifications
            if qualification.kind == requirement.req_kind
            and qualification.official_name == requirement.name
            and (not requirement.edition or qualification.edition == requirement.edition)
        ),
        key=lambda qualification: qualification.qual_id,
    )
    if not candidates:
        return RequirementComparison(CheckResult.UNKNOWN, "해당 자격 등록 없음")
    comparisons = [
        _compare_qualification_candidate(requirement, qualification, evaluation_input)
        for qualification in candidates
    ]
    return _select_comparison(comparisons)


def _compare_qualification_candidate(
    requirement: RequirementInput,
    qualification: QualificationInput,
    evaluation_input: EvaluationInput,
) -> RequirementComparison:
    """검수·주체·사업장·범위·기간·현재 상태를 함께 확인한다 (BR1.3~1.5, BR3.2)."""
    compared_value = qualification.model_dump(mode="json", by_alias=True)

    def result(code: CheckResult, reason: str) -> RequirementComparison:
        return RequirementComparison(code, reason, compared_value, qualification.qual_id)

    if qualification.review_status != ReviewStatus.REVIEWED:
        return result(CheckResult.UNKNOWN, "자격 정보가 검수 완료되지 않았습니다")

    scopes = [
        scope
        for scope in evaluation_input.capability.qualification_scopes
        if scope.qual_id == qualification.qual_id
        and _scope_matches(scope, requirement, evaluation_input)
    ]
    reviewed_scopes = [scope for scope in scopes if scope.review_status == ReviewStatus.REVIEWED]
    if any(scope.applicability == Applicability.NOT_APPLIES for scope in reviewed_scopes):
        return result(CheckResult.EXCLUDED, "검수된 자격 범위에서 해당 대상은 적용 제외입니다")
    if qualification.valid_to is not None and qualification.valid_to < evaluation_input.base_date:
        return result(CheckResult.EXCLUDED, "자격 유효기간이 기준일 전에 끝났습니다")
    if qualification.current_status in {
        QualificationStatusCode.CANCELLED,
        QualificationStatusCode.EXPIRED,
    }:
        return result(CheckResult.EXCLUDED, "자격의 현재 상태가 취소 또는 만료입니다")
    for label, required, actual in (
        ("보유 주체", requirement.holder, qualification.holder),
        ("사업장", requirement.site, qualification.site),
    ):
        if required and actual and required != actual:
            return result(CheckResult.EXCLUDED, f"검수된 자격의 {label}이 요구와 다릅니다")

    if not qualification.holder or not qualification.site:
        return result(CheckResult.UNKNOWN, "자격의 보유 주체 또는 사업장을 확인해야 합니다")
    if not any(scope.applicability == Applicability.APPLIES for scope in reviewed_scopes):
        return result(CheckResult.UNKNOWN, "해당 대상에 적용되는 검수 완료 자격 범위가 없습니다")
    if qualification.valid_from is None or qualification.valid_to is None:
        return result(CheckResult.UNKNOWN, "자격 유효기간의 시작일 또는 종료일이 미확인입니다")
    if qualification.valid_from > evaluation_input.base_date:
        return result(CheckResult.UNKNOWN, "기준일에 자격 유효기간이 아직 시작되지 않았습니다")
    if qualification.current_status != QualificationStatusCode.ACTIVE:
        return result(CheckResult.UNKNOWN, "자격의 현재 상태가 활성으로 확인되지 않았습니다")
    return result(CheckResult.PASS, "검수 완료 자격의 일곱 조건이 요구와 일치합니다")


def _compare_technical(
    requirement: RequirementInput, evaluation_input: EvaluationInput
) -> RequirementComparison:
    """해당 공정의 검수된 수치 사양과 동일 이름·동일 단위로 대조한다 (BR3.6).

    설정에 없는 이름 대응표나 단위 변환은 추정하지 않는다. 설비·시험 설명은
    수치 사양(SPEC) 대조 대상에 포함하지 않는다.
    """
    if requirement.required_value is None or not requirement.unit:
        return RequirementComparison(CheckResult.UNKNOWN, "요구 수치 또는 단위가 미확인입니다")
    if not isfinite(requirement.required_value):
        raise ValueError("기술 조건의 요구 수치는 유한한 숫자여야 합니다 (BR3.6)")
    process_ids = {
        link.process_id
        for link in evaluation_input.process_links
        if link.link_id == requirement.link_id and link.process_id is not None
    }
    candidates = sorted(
        (
            capability
            for capability in evaluation_input.capability.capabilities
            if capability.process_id in process_ids
            and capability.cap_kind == CapKind.SPEC
            and not capability.is_descriptive_only
            and capability.name == requirement.name
            and capability.unit == requirement.unit
        ),
        key=lambda capability: capability.capability_id,
    )
    if not candidates:
        return RequirementComparison(
            CheckResult.UNKNOWN, "대조할 공정의 동일 이름·단위 사양이 없습니다"
        )
    return _select_comparison(
        [
            _compare_specification(requirement.required_value, capability)
            for capability in candidates
        ]
    )


def _compare_specification(
    required_value: float, capability: CapabilityInput
) -> RequirementComparison:
    """검수된 최소·최대 범위의 양 끝을 포함해 비교한다 (BR3.6)."""
    compared_value = capability.model_dump(mode="json", by_alias=True)
    if capability.review_status != ReviewStatus.REVIEWED:
        return RequirementComparison(
            CheckResult.UNKNOWN, "기술 사양이 검수 완료되지 않았습니다", compared_value
        )
    minimum, maximum = capability.numeric_min, capability.numeric_max
    if minimum is None or maximum is None:
        return RequirementComparison(
            CheckResult.UNKNOWN, "기술 사양의 최소 또는 최대 수치가 미확인입니다", compared_value
        )
    if not isfinite(minimum) or not isfinite(maximum) or minimum > maximum:
        raise ValueError("기술 사양은 유한한 숫자이며 최소가 최대 이하여야 합니다 (BR1.2, BR3.6)")
    if minimum <= required_value <= maximum:
        return RequirementComparison(
            CheckResult.PASS, "요구 수치가 검수된 기술 사양 범위 안입니다", compared_value
        )
    return RequirementComparison(
        CheckResult.EXCLUDED, "요구 수치가 검수된 기술 사양 범위 밖입니다", compared_value
    )


def _select_comparison(comparisons: list[RequirementComparison]) -> RequirementComparison:
    """충족 자격·사양을 찾고, 미확인 후보가 있으면 부재로 단정하지 않는다 (BR3.2, BR3.6)."""
    for result in (CheckResult.PASS, CheckResult.UNKNOWN, CheckResult.EXCLUDED):
        for comparison in comparisons:
            if comparison.result == result:
                return comparison
    raise ValueError("대조할 후보가 없습니다 (BR3.2, BR3.6)")
