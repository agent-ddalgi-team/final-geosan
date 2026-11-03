"""러너 확인용 최소 테스트(Step 5). 항상 참인 테스트가 아니라 경계 코드가 실제로 동작하는지 본다."""

from __future__ import annotations

import json
from datetime import date

import pytest

from geosan.rules.codes import ClassificationCode, classification_entry
from geosan.rules.models import evaluate


def test_classification_table_has_eleven_codes_in_rule_order() -> None:
    """11분기와 접촉 후보 3종의 순서를 유지하고 어느 분류도 단독으로 승인을 막지 않는다."""
    entries = [classification_entry(code) for code in ClassificationCode]
    assert [entry.order for entry in entries] == list(range(1, 12))
    contact = [entry.code for entry in entries if entry.is_contact_candidate]
    assert contact == [
        ClassificationCode.CONTACT_URGENT,
        ClassificationCode.CONTACT_PLANNED,
        ClassificationCode.CONTACT_REVIEW,
    ]
    assert all(not entry.blocks_approval for entry in entries)


def test_apjeong_example_expected_values_match_fr10_1(apjeong_case_path, base_date: date) -> None:
    """A정밀 예시 파일의 기대값이 FR10.1(E 77 / P 95 / S 81.1 / R 82)과 같다."""
    data = json.loads(apjeong_case_path.read_text(encoding="utf-8"))
    assert data["baseDate"] == base_date.isoformat()
    expected = data["expected"]
    assert (expected["E"], expected["P"], expected["S"], expected["R"]) == (77, 95, 81.1, 82)
    assert expected["classificationCode"] == "CONTACT_URGENT"


def test_evaluate_is_not_implemented_until_step_13() -> None:
    """규칙 엔진 본문은 Step 13(유동렬)에서 채운다. 그 전에는 NotImplementedError가 난다."""
    with pytest.raises(NotImplementedError):
        evaluate(None)  # type: ignore[arg-type]
