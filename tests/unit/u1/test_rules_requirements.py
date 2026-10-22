"""요구 판정 시나리오·경계값 검사 (S07·S08, BR3.1~3.7·BR3.10).

입력은 기존 A정밀 단독 입력의 사본이며 모두 가상·거산 실제 사양 아님이다.
DB·명령·화면 연결이 아닌 실제 순수 계산 함수를 검사한다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from geosan.config.loader import load_document
from geosan.rules.codes import CheckResult, DatasetKind, FilterState, RelationStatus, ReviewStatus
from geosan.rules.models import (
    EvaluationInput,
    ProcessLinkInput,
    QualificationInput,
    QualificationScopeInput,
    RequirementInput,
)
from geosan.rules.requirements import assess_requirements, check_requirement
from tests.factories import DATA_DIR


@pytest.fixture
def evaluation_input() -> EvaluationInput:
    return EvaluationInput.model_validate(load_document(DATA_DIR / "apjeong-input.json").data)


def _replace(model: Any, **changes: Any) -> Any:
    """값을 바꾼 뒤 경계 모델로 다시 검사한다. 문자열 enum도 실제 enum으로 변환한다."""
    return type(model).model_validate(model.model_dump() | changes)


def _iso(evaluation_input: EvaluationInput) -> QualificationInput:
    return next(
        q for q in evaluation_input.capability.qualifications if q.official_name == "ISO 9001"
    )


def _iso_scope(evaluation_input: EvaluationInput) -> QualificationScopeInput:
    return next(
        scope
        for scope in evaluation_input.capability.qualification_scopes
        if scope.qual_id == _iso(evaluation_input).qual_id
        and scope.process_id == evaluation_input.process_links[0].process_id
    )


def _technical_requirement(evaluation_input: EvaluationInput, **changes: Any) -> RequirementInput:
    return _replace(
        evaluation_input.requirements[0],
        **(
            {"req_kind": "TECHNICAL", "name": "피막 두께", "required_value": 15, "unit": "μm"}
            | changes
        ),
    )


@pytest.mark.parametrize("filename", ["apjeong-input.json", "reading_example2.json"])
def test_reference_cases_keep_expected_requirement_results(filename: str) -> None:
    """Given 기존 완료 기준 입력, When 요구 판정, Then A정밀의 세 판정·필터 유지 (S07·S08)."""
    data = EvaluationInput.model_validate(load_document(DATA_DIR / filename).data)
    assert not any(
        req.req_level == "REQUIRED" and req.needed_stage == "UNKNOWN" for req in data.requirements
    )

    result = assess_requirements(data)

    assert result.exclusion_scope is None
    if filename == "apjeong-input.json":
        assert result.filter_state == "PASS"
        iso, sample, nadcap = result.requirement_checks
        assert (iso.result, iso.display_result, iso.qual_id) == ("PASS", "PASS", "qual-01")
        assert iso.link_id == data.requirements[0].link_id
        assert iso.compared_value["officialName"] == "ISO 9001"
        assert (sample.result, sample.display_result) == ("UNKNOWN", "LATER_STAGE")
        assert sample.follow_up_condition == "후속 단계 미완료: 샘플 승인 후 양산"
        assert (nadcap.result, nadcap.display_result) == ("UNKNOWN", "QUESTION_NEEDED")
        assert nadcap.qual_id is None
    else:
        assert result.requirement_checks == []


@pytest.mark.parametrize(
    ("requirement_changes", "qualification_changes", "scope_changes", "expected"),
    [
        ({"name": "다른 인증"}, {}, {}, "UNKNOWN"),
        ({"edition": "다른 판본"}, {}, {}, "UNKNOWN"),
        ({"req_kind": "APPROVAL"}, {}, {}, "UNKNOWN"),
        ({}, {"review_status": "PENDING"}, {}, "UNKNOWN"),
        ({}, {"review_status": "RECHECK"}, {}, "UNKNOWN"),
        ({}, {"review_status": "UNAVAILABLE"}, {}, "UNKNOWN"),
        ({}, {"holder": ""}, {}, "UNKNOWN"),
        ({}, {"site": None}, {}, "UNKNOWN"),
        ({"holder": "다른 법인"}, {}, {}, "EXCLUDED"),
        ({"site": "다른 사업장"}, {}, {}, "EXCLUDED"),
        ({}, {"valid_from": None}, {}, "UNKNOWN"),
        ({}, {"valid_to": None}, {}, "UNKNOWN"),
        ({}, {"valid_from": "2026-10-21"}, {}, "UNKNOWN"),
        ({}, {"valid_from": "2026-10-20"}, {}, "PASS"),
        ({}, {"valid_to": "2026-10-20"}, {}, "PASS"),
        ({}, {"valid_to": "2026-10-19"}, {}, "EXCLUDED"),
        ({}, {"current_status": "CANCELLED"}, {}, "EXCLUDED"),
        ({}, {"current_status": "EXPIRED"}, {}, "EXCLUDED"),
        ({}, {"current_status": "SUSPENDED"}, {}, "UNKNOWN"),
        ({}, {"current_status": "UNCONFIRMED"}, {}, "UNKNOWN"),
        ({}, {}, {"applicability": "NOT_APPLIES"}, "EXCLUDED"),
        ({}, {}, {"applicability": "UNKNOWN"}, "UNKNOWN"),
        ({}, {}, {"review_status": "PENDING"}, "UNKNOWN"),
        ({}, {}, {"review_status": "PENDING", "applicability": "NOT_APPLIES"}, "UNKNOWN"),
        ({}, {}, {"process_id": "다른-공정"}, "UNKNOWN"),
        ({}, {}, {"process_id": None}, "UNKNOWN"),
        ({}, {}, {"qual_id": "다른-자격"}, "UNKNOWN"),
    ],
)
def test_qualification_requires_all_seven_conditions(
    evaluation_input: EvaluationInput,
    requirement_changes: dict[str, Any],
    qualification_changes: dict[str, Any],
    scope_changes: dict[str, Any],
    expected: str,
) -> None:
    """Given 일곱 조건 중 한 조건 변화, When 자격 대조, Then 확인된 불일치와 미확인을 구분한다."""
    requirement = _replace(evaluation_input.requirements[0], **requirement_changes)
    qualification = _replace(_iso(evaluation_input), **qualification_changes)
    scope = _replace(_iso_scope(evaluation_input), **scope_changes)
    evaluation_input.capability.qualifications = [qualification]
    evaluation_input.capability.qualification_scopes = [scope]

    result = check_requirement(requirement, evaluation_input)

    assert result.result == expected
    assert result.reason
    if result.qual_id is not None:
        assert result.compared_value == qualification.model_dump(mode="json", by_alias=True)


@pytest.mark.parametrize(
    ("level", "stage", "status", "expected_result", "display", "filter_state"),
    [
        ("REQUIRED", "NOW", "ACTIVE", "PASS", "PASS", "PASS"),
        ("REQUIRED", "UNKNOWN", "ACTIVE", "PASS", "PENDING_BLOCKS", "PENDING"),
        ("REQUIRED", "UNKNOWN", "EXPIRED", "EXCLUDED", "EXCLUDED", "EXCLUDED"),
        ("REQUIRED", "NOW", "UNCONFIRMED", "UNKNOWN", "PENDING_BLOCKS", "PENDING"),
        ("REQUIRED", "UNKNOWN", "UNCONFIRMED", "UNKNOWN", "PENDING_BLOCKS", "PENDING"),
        ("REQUIRED", "LATER", "EXPIRED", "UNKNOWN", "LATER_STAGE", "PASS"),
        ("REQUIRED", "LATER", "ACTIVE", "UNKNOWN", "LATER_STAGE", "PASS"),
        ("UNKNOWN", "UNKNOWN", "ACTIVE", "PASS", "PASS", "PASS"),
        ("UNKNOWN", "UNKNOWN", "UNCONFIRMED", "UNKNOWN", "QUESTION_NEEDED", "PASS"),
        ("UNKNOWN", "NOW", "EXPIRED", "EXCLUDED", "EXCLUDED", "PASS"),
        ("PREFERRED", "NOW", "EXPIRED", "EXCLUDED", "EXCLUDED", "PASS"),
        ("NOT_REQUIRED", "NOW", "EXPIRED", "EXCLUDED", "EXCLUDED", "PASS"),
        ("PREFERRED", "LATER", "ACTIVE", "UNKNOWN", "LATER_STAGE", "PASS"),
        ("UNKNOWN", "LATER", "ACTIVE", "UNKNOWN", "LATER_STAGE", "PASS"),
    ],
)
def test_requirement_level_and_stage_control_display_and_filter(
    evaluation_input: EvaluationInput,
    level: str,
    stage: str,
    status: str,
    expected_result: str,
    display: str,
    filter_state: str,
) -> None:
    """Given 요구 수준·단계·상태, When 판정, Then 판정과 표시를 구분한다 (S07·S08)."""
    evaluation_input.requirements = [
        _replace(evaluation_input.requirements[0], req_level=level, needed_stage=stage)
    ]
    evaluation_input.capability.qualifications = [
        _replace(_iso(evaluation_input), current_status=status)
    ]

    assessment = assess_requirements(evaluation_input)

    check = assessment.requirement_checks[0]
    assert (check.result, check.display_result) == (expected_result, display)
    assert (check.stage_judged, evaluation_input.requirements[0].req_level) == (stage, level)
    assert assessment.filter_state == filter_state
    if expected_result == "EXCLUDED" and level != "REQUIRED":
        assert "승인은 막지 않음" in check.reason


@pytest.mark.parametrize(
    ("requirement_changes", "capability_changes", "expected"),
    [
        ({"required_value": 5}, {}, "PASS"),
        ({"required_value": 25}, {}, "PASS"),
        ({"required_value": 4.99}, {}, "EXCLUDED"),
        ({"required_value": 25.01}, {}, "EXCLUDED"),
        ({"required_value": None}, {}, "UNKNOWN"),
        ({"unit": None}, {}, "UNKNOWN"),
        ({"unit": "mm"}, {}, "UNKNOWN"),
        ({"name": "다른 사양"}, {}, "UNKNOWN"),
        ({"link_id": "없는-연결"}, {}, "UNKNOWN"),
        ({}, {"cap_kind": "EQUIPMENT"}, "UNKNOWN"),
        ({}, {"cap_kind": "TEST"}, "UNKNOWN"),
        ({}, {"is_descriptive_only": True}, "UNKNOWN"),
        ({}, {"review_status": "PENDING"}, "UNKNOWN"),
        ({}, {"numeric_min": None}, "UNKNOWN"),
        ({}, {"numeric_max": None}, "UNKNOWN"),
        ({"required_value": float("nan")}, {}, "INVALID"),
        ({}, {"numeric_min": float("-inf")}, "INVALID"),
        ({}, {"numeric_min": 30, "numeric_max": 5}, "INVALID"),
    ],
)
def test_technical_requirements_compare_reviewed_numeric_ranges_only(
    evaluation_input: EvaluationInput,
    requirement_changes: dict[str, Any],
    capability_changes: dict[str, Any],
    expected: str,
) -> None:
    """Given 같은 공정의 사양, When 수치 대조, Then 양 끝 포함·설명용 제외·미확인 구분 (BR3.6)."""
    requirement = _technical_requirement(evaluation_input, **requirement_changes)
    capability = next(
        cap for cap in evaluation_input.capability.capabilities if cap.name == "피막 두께"
    )
    capability = _replace(capability, **capability_changes)
    evaluation_input.capability.capabilities = [capability]
    evaluation_input.requirements = [requirement]
    if expected == "INVALID":
        with pytest.raises(ValueError, match="기술"):
            assess_requirements(evaluation_input)
        return

    assessment = assess_requirements(evaluation_input)

    check = assessment.requirement_checks[0]
    assert check.result == expected
    assert check.scope_judged == "PROCESS_LINK"
    if expected == "EXCLUDED":
        assert (assessment.filter_state, assessment.exclusion_scope) == ("EXCLUDED", "LINK")
    if check.compared_value is not None:
        assert check.compared_value == capability.model_dump(mode="json", by_alias=True)


@pytest.mark.parametrize(
    ("scope_kind", "matches", "expected"),
    [
        ("PROCESS", True, "PASS"),
        ("CUSTOMER", True, "PASS"),
        ("OPPORTUNITY", True, "PASS"),
        ("PROCESS", False, "UNKNOWN"),
        ("CUSTOMER", False, "UNKNOWN"),
        ("OPPORTUNITY", False, "UNKNOWN"),
    ],
)
def test_qualification_scope_only_applies_to_its_target(
    evaluation_input: EvaluationInput, scope_kind: str, matches: bool, expected: str
) -> None:
    """Given 공정·고객·기회 적용 범위, When 대상 ID 대조, Then 다른 대상의 범위를 빌리지 않는다."""
    targets = {
        "PROCESS": ("process_id", evaluation_input.process_links[0].process_id),
        "CUSTOMER": ("customer_id", evaluation_input.opportunity.customer_id),
        "OPPORTUNITY": ("opp_id", evaluation_input.opportunity.opp_id),
    }
    key, target = targets[scope_kind]
    changes = {"process_id": None, "customer_id": None, "opp_id": None, "scope_kind": scope_kind}
    changes[key] = target if matches else "다른-대상"
    evaluation_input.capability.qualification_scopes = [
        _replace(_iso_scope(evaluation_input), **changes)
    ]

    result = check_requirement(evaluation_input.requirements[0], evaluation_input)

    assert result.result == expected


@pytest.mark.parametrize(
    ("case", "filter_state", "scope", "link_states"),
    [
        ("company", "EXCLUDED", "COMPANY", ["EXCLUDED", "EXCLUDED"]),
        ("opportunity", "EXCLUDED", "OPPORTUNITY", ["EXCLUDED", "EXCLUDED"]),
        ("material", "PASS", "LINK", ["EXCLUDED", "PASS"]),
        ("qualification", "PASS", "LINK", ["EXCLUDED", "PASS"]),
        ("all_materials", "EXCLUDED", "LINK", ["EXCLUDED", "EXCLUDED"]),
        ("relation", "PENDING", None, ["PASS", "PASS"]),
        ("company_pending", "PENDING", None, ["PASS", "PASS"]),
        ("process_missing", "PENDING", None, ["PENDING", "PASS"]),
        ("process_pending", "PENDING", None, ["PENDING", "PASS"]),
        ("other_dataset", "PENDING", None, ["PENDING", "PASS"]),
        ("material_missing", "PENDING", None, ["PENDING", "PASS"]),
        ("material_list_missing", "PENDING", None, ["PENDING", "PASS"]),
        ("opportunity_pending", "PENDING", None, ["PASS", "PASS"]),
        ("no_links", "PASS", None, []),
    ],
)
def test_exclusions_stay_within_their_scope(
    evaluation_input: EvaluationInput,
    case: str,
    filter_state: str,
    scope: str | None,
    link_states: list[str],
) -> None:
    """Given 두 공정 연결, When 제한 적용, Then 한 연결의 제외가 다른 연결을 막지 않는다 (S08)."""
    data = evaluation_input
    data.process_links.append(
        ProcessLinkInput(
            link_id="link-chromate",
            process_id="proc-chromate",
            process_code="CHROMATE",
            applied_material="AL",
        )
    )
    anodizing = next(p for p in data.capability.processes if p.code == "ANODIZING")
    if case == "company":
        data.opportunity.company_filter_status = FilterState.EXCLUDED
        data.opportunity.relation_status = RelationStatus.UNCONFIRMED
    elif case == "opportunity":
        data.requirements = [_replace(data.requirements[0], scope_kind="OPPORTUNITY", link_id=None)]
        data.capability.qualifications = [_replace(_iso(data), current_status="EXPIRED")]
    elif case in {"material", "all_materials"}:
        data.process_links[0].applied_material = "SUS"
        if case == "all_materials":
            data.process_links[1].applied_material = "SUS"
    elif case == "qualification":
        data.capability.qualification_scopes = [
            _replace(_iso_scope(data), applicability="NOT_APPLIES")
        ]
    elif case == "relation":
        data.opportunity.relation_status = RelationStatus.UNCONFIRMED
    elif case == "company_pending":
        data.opportunity.company_filter_status = FilterState.PENDING
    elif case == "process_missing":
        data.process_links[0].process_id = None
    elif case == "process_pending":
        anodizing.review_status = ReviewStatus.PENDING
    elif case == "other_dataset":
        anodizing.dataset_kind = DatasetKind.BROCHURE
    elif case == "material_missing":
        data.process_links[0].applied_material = None
    elif case == "material_list_missing":
        anodizing.material_codes = []
    elif case == "opportunity_pending":
        data.requirements = [
            _replace(
                data.requirements[0], name="미등록 자격", scope_kind="OPPORTUNITY", link_id=None
            )
        ]
    elif case == "no_links":
        data.requirements = []
        data.process_links = []
    data = EvaluationInput.model_validate(data.model_dump())

    result = assess_requirements(data)

    assert (result.filter_state, result.exclusion_scope) == (filter_state, scope)
    assert [link.result for link in result.process_link_results] == link_states


@pytest.mark.parametrize("level", ["REQUIRED", "PREFERRED", "NOT_REQUIRED", "UNKNOWN"])
@pytest.mark.parametrize("stage", ["NOW", "LATER", "UNKNOWN"])
def test_quantity_delivery_never_gets_automatic_approval_or_blocks_filter(
    evaluation_input: EvaluationInput, level: str, stage: str
) -> None:
    """Given 수량·납기 요구, When 판정, Then 항상 UNKNOWN이며 필터에 영향이 없다 (S08, CON-23)."""
    evaluation_input.requirements = [
        _replace(
            evaluation_input.requirements[0],
            req_kind="QUANTITY_DELIVERY",
            req_level=level,
            needed_stage=stage,
        )
    ]

    assessment = assess_requirements(evaluation_input)

    check = assessment.requirement_checks[0]
    assert check.result == CheckResult.UNKNOWN
    assert check.qual_id is None
    assert check.compared_value is None
    assert assessment.filter_state == "PASS"
    assert assessment.exclusion_scope is None


@pytest.mark.parametrize("status", ["ACTIVE", "UNCONFIRMED", "EXPIRED"])
def test_multiple_candidates_are_deterministic_and_input_is_unchanged(
    evaluation_input: EvaluationInput, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    """Given 옛·갱신 자격, When 반복·역순 판정, Then 같은 결과이며 입력 불변 (BR4.8)."""
    data = evaluation_input
    original_qualification, original_scope = _iso(data), _iso_scope(data)
    old = _replace(original_qualification, qual_id="old", current_status="EXPIRED")
    new = _replace(original_qualification, qual_id="new", current_status=status)
    data.capability.qualifications = [old, new]
    data.capability.qualification_scopes = [
        _replace(original_scope, qual_id="old"),
        _replace(original_scope, qual_id="new"),
    ]
    data.requirements = [data.requirements[0]]
    before = data.model_dump(mode="json")

    def forbidden_io(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("규칙 엔진에서 파일을 읽거나 쓰면 안 됩니다")

    monkeypatch.setattr("builtins.open", forbidden_io)
    monkeypatch.setattr(Path, "open", forbidden_io)
    first = assess_requirements(data)
    assert data.model_dump(mode="json") == before
    data.capability.qualifications.reverse()
    data.capability.qualification_scopes.reverse()
    second = assess_requirements(data)

    assert first == second
    expected = {"ACTIVE": "PASS", "UNCONFIRMED": "UNKNOWN", "EXPIRED": "EXCLUDED"}
    assert first.requirement_checks[0].result == expected[status]
    first.requirement_checks[0].compared_value["holder"] = "결과 사본만 변경"
    assert all(
        qualification.holder == original_qualification.holder
        for qualification in data.capability.qualifications
    )
