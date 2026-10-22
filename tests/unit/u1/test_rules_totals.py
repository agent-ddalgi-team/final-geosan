"""완료 기준 합계·미확보·추정 상승분과 불변식 검사 (BR4.6·4.7)."""

import pytest

from geosan.rules.items import calculate_items
from geosan.rules.totals import calculate_totals
from tests.factories import replace_contract, rule_engine_input


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("apjeong-input.json", dict(E=77, F=60, T=17, P=95, R=82, S=81.1, C=87.5)),
        ("reading_example2.json", dict(E=25, F=25, T=0, P=25, R=100, S=100.0, C=12.5)),
    ],
)
def test_acceptance_totals(filename, expected):
    """Given PM 완료 기준 입력, When 합산, Then 약속된 기대값 그대로다."""
    data = rule_engine_input(filename)
    assert calculate_totals(calculate_items(data), data.rule_config).model_dump() == expected


def test_zero_completed_weight():
    """Given 전부 미확보, When 합산, Then S는 산정 전이고 R만 전체 배점이다."""
    data = rule_engine_input()
    data.item_inputs = []
    totals = calculate_totals(calculate_items(data), data.rule_config)
    assert totals.model_dump() == dict(E=0, F=0, T=0, P=0, R=100, S=None, C=0)


@pytest.mark.parametrize("state,e,r", [("STRONG", 74, 82), ("WEAK", 70, 82)])
def test_potential_recomputes_uncertain_items(state, e, r):
    """Given 추정 납품실적, When R 계산, Then 반올림된 점수를 나누지 않고 원식으로 재계산한다."""
    data = rule_engine_input()
    data.item_inputs[2] = replace_contract(data.item_inputs[2], state=state)
    totals = calculate_totals(calculate_items(data), data.rule_config)
    assert (totals.E, totals.R) == (e, r)


@pytest.mark.parametrize(
    "problem",
    [
        "too_high",
        "negative",
        "unavailable_score",
        "null_completed",
        "missing_row",
        "duplicate_row",
        "weight",
        "total_weight",
        "missing_rate",
        "r_bounds",
    ],
)
def test_invalid_totals_raise(problem):
    """Given 손상된 항목·설정, When 합계, Then 실패를 성공 값으로 숨기지 않는다."""
    data = rule_engine_input()
    rows = calculate_items(data)
    if problem == "too_high":
        rows[0].score = 26
    elif problem == "negative":
        rows[0].score = -1
    elif problem == "unavailable_score":
        rows[7].score = 0
    elif problem == "null_completed":
        rows[0].score = None
    elif problem == "missing_row":
        rows.pop()
    elif problem == "duplicate_row":
        rows[7] = rows[0]
    elif problem == "weight":
        rows[0].weight = 24
    elif problem == "total_weight":
        data.rule_config.new_profile_items[0].weight = 24
    elif problem == "missing_rate":
        rows[0].state = "STRONG"
        rows[0].match_rate = None
    else:
        rows[0].state = "STRONG"
        rows[0].match_rate = 10
    with pytest.raises(ValueError):
        calculate_totals(rows, data.rule_config)


def test_completion_is_count_not_weight():
    """Given 서로 다른 배점의 완료 항목, When C 계산, Then 행 수 기준 소수 첫째 자리다."""
    data = rule_engine_input("reading_example2.json")
    data.item_inputs[-1] = replace_contract(data.item_inputs[-1], state="NO_BONUS")
    totals = calculate_totals(calculate_items(data), data.rule_config)
    assert (totals.P, totals.C) == (30, 25)


def test_confirmed_factor_is_configured():
    """Given 설정의 확실도 변경, When 계산, Then E와 R 모두 설정을 따른다."""
    data = rule_engine_input()
    data.rule_config.certainty.CONFIRMED = 0.8
    data.item_inputs[2] = replace_contract(data.item_inputs[2], state="STRONG")
    totals = calculate_totals(calculate_items(data), data.rule_config)
    assert (totals.E, totals.R) == (61, 67)
