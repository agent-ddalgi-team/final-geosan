"""대상별 질문 생성·검수 완료 제외·중복 방지 검사 (BR8.1~8.2)."""

import pytest

from geosan.rules.codes import ReviewStatus
from geosan.rules.items import calculate_items
from geosan.rules.questions import question_candidates
from geosan.rules.requirements import assess_requirements
from tests.factories import replace_contract, rule_engine_input


def questions(data):
    return question_candidates(
        data, calculate_items(data), assess_requirements(data).requirement_checks
    )


@pytest.mark.parametrize("status", ["PENDING", "UNAVAILABLE", "RECHECK"])
def test_pending_compared_qualification(status):
    """Given 대조한 미검수 자격, When 질문 생성, Then 그 자격을 확인하는 질문이 나온다."""
    data = rule_engine_input()
    data.capability.qualifications[0] = replace_contract(
        data.capability.qualifications[0], review_status=status
    )
    candidates = questions(data)
    qualification = [q for q in candidates if q.target_kind == "QUALIFICATION"]
    assert len(qualification) == 1 and "ISO 9001" in qualification[0].text


@pytest.mark.parametrize(
    "level,stage,count,words",
    [
        ("UNKNOWN", "NOW", 1, "필수입니까"),
        ("REQUIRED", "UNKNOWN", 1, "어느 단계"),
        ("UNKNOWN", "UNKNOWN", 1, "필수입니까"),
        ("REQUIRED", "NOW", 0, ""),
    ],
)
def test_unknown_requirement_level_or_stage(level, stage, count, words):
    """Given 수준·단계 미확인 요구, When 질문 생성, Then 한 대상에 확인 질문 하나만 만든다."""
    data = rule_engine_input()
    data.requirements = [
        replace_contract(data.requirements[0], req_level=level, needed_stage=stage)
    ]
    candidates = questions(data)
    assert len(candidates) == count
    if candidates:
        assert words in candidates[0].text


def test_reviewed_values_have_no_question():
    """Given 가상 검수 A정밀, When 질문, Then 통과 ISO에는 없고 Nadcap에만 질문이 있다."""
    data = rule_engine_input()
    candidates = questions(data)
    assert len(candidates) == 1
    assert candidates[0].target_kind == "REQUIREMENT"
    assert "Nadcap" in candidates[0].text
    data.requirements = []
    assert questions(data) == []


@pytest.mark.parametrize(
    "kind,collection,id_field",
    [
        ("PROCESS", "processes", "process_id"),
        ("CAPABILITY", "capabilities", "capability_id"),
        ("FIELD", "delivery_records", "record_id"),
    ],
)
def test_only_used_pending_values_are_questioned(kind, collection, id_field):
    """Given 사용한 값과 쓰지 않은 미검수 값, When 질문, Then 사용한 대상만 포함한다."""
    data = rule_engine_input()
    used = {key for item in data.item_inputs for key in item.used_capability_ids}
    values = getattr(data.capability, collection)
    for index, value in enumerate(values):
        values[index] = replace_contract(value, review_status="PENDING")
    expected = {getattr(value, id_field) for value in values if getattr(value, id_field) in used}
    actual = {q.target_id for q in questions(data) if q.target_kind == kind}
    assert actual == expected and actual


def test_deduplication_and_determinism():
    """Given 여러 항목이 같은 값 사용, When 질문 생성 반복, Then 대상별 하나이며 입력을 유지한다."""
    data = rule_engine_input()
    process = next(p for p in data.capability.processes if p.process_id == "proc-anodizing")
    process.review_status = ReviewStatus.PENDING
    data.item_inputs[0].used_capability_ids = [process.process_id, process.process_id]
    before = data.model_dump(mode="json")
    candidates = questions(data)
    assert sum(q.target_id == process.process_id for q in candidates) == 1
    assert questions(data) == candidates and data.model_dump(mode="json") == before
    data.item_inputs[0].used_capability_ids = ["missing"]
    with pytest.raises(ValueError, match="거산 값 참조"):
        questions(data)
