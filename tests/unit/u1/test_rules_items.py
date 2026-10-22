"""가상 입력으로 점수·날짜 경계·누락 처리 검사 (BR4.1~4.5)."""

from datetime import timedelta

import pytest

from geosan.rules.codes import ItemState
from geosan.rules.items import calculate_items, round_half_up, score_product
from tests.factories import replace_contract, rule_engine_input


@pytest.mark.parametrize(
    "value,places,expected", [(10.05, 0, "10"), (81.05, 1, "81.1"), (2.5, 0, "3"), (0.05, 1, "0.1")]
)
def test_decimal_rounding(value, places, expected):
    """Given 십진 경계값, When HALF_UP, Then 은행가 반올림을 하지 않는다."""
    assert str(round_half_up(value, places)) == expected
    assert score_product(15, 0.67, 1, 1) == 10


@pytest.mark.parametrize(
    "change",
    [
        dict(match_rate=0.8, match_rate_step=None),
        dict(match_rate_step="없는 단계"),
        dict(match_rate=0.5),
        dict(match_rate=None, match_rate_step=None),
    ],
)
def test_invalid_match_rate_rejected(change):
    """Given 단계 밖 또는 서로 다른 값, When 점수 계산, Then 오류를 알린다."""
    data = rule_engine_input()
    data.item_inputs[1] = replace_contract(data.item_inputs[1], **change)
    with pytest.raises(ValueError):
        calculate_items(data)


@pytest.mark.parametrize(
    "state,score",
    [
        ("CONFIRMED", 25),
        ("STRONG", 16),
        ("WEAK", 6),
        ("MISMATCH", 0),
        ("NO_BONUS", 0),
        ("NO_SIGNAL", 0),
        ("UNAVAILABLE", None),
    ],
)
def test_all_states_keep_all_rows(state, score):
    """Given 일곱 판정 상태, When 계산, Then 미확보만 null이고 전체 항목은 유지된다."""
    data = rule_engine_input()
    data.item_inputs[0] = replace_contract(data.item_inputs[0], state=state)
    before = data.model_dump()
    rows = calculate_items(data)
    assert len(rows) == 8 and rows[0].score == score
    assert data.model_dump() == before
    assert [r.score for r in rows[1:]] == [20, 10, 5, 10, 0, 7, None]
    data.item_inputs = []
    assert all(r.score is None for r in calculate_items(data))


@pytest.mark.parametrize("kind", ["EXPANSION", "BID"])
def test_representative_signal_and_evidence(kind):
    """Given 여러 신호, When 대표 선택, Then 최근 발생·이른 마감과 모든 근거를 사용한다."""
    data = rule_engine_input()
    index, original = (4, data.signals[1]) if kind == "EXPANSION" else (6, data.signals[0])
    selected = replace_contract(
        original,
        signal_id="selected",
        relation="INDIRECT",
        occurred_at=data.base_date,
        deadline_at=data.base_date,
        evidence_ids=["ev-apjeong-0003"],
    )
    data.signals.append(selected)
    data.item_inputs[index].signal_ids.append(selected.signal_id)
    row = calculate_items(data)[index]
    assert row.match_rate == 0.5 and row.decay == 1
    assert set(row.evidence_ids) == set(original.evidence_ids + selected.evidence_ids)
    data.signals.reverse()
    assert calculate_items(data)[index] == row


@pytest.mark.parametrize(
    "age,expected", [(0, 10), (30, 10), (31, 5), (90, 5), (91, 0), (-1, None), (None, None)]
)
def test_general_decay_uses_occurrence(age, expected):
    """Given 실제 발생일 경계·미상·미래, When 계산, Then 수집일로 대체하지 않는다."""
    data = rule_engine_input()
    data.signals[1].occurred_at = None if age is None else data.base_date - timedelta(days=age)
    assert calculate_items(data)[4].score == expected
    data.rule_config.general_decay[0].factor = 0.2
    data.signals[1].occurred_at = data.base_date
    assert calculate_items(data)[4].score == 2
    data.rule_config.general_decay = []
    with pytest.raises(ValueError, match="감쇠 설정"):
        calculate_items(data)


@pytest.mark.parametrize(
    "status,days,score",
    [
        ("OPEN", 0, 7),
        ("OPEN", 1, 7),
        ("OPEN", -1, 0),
        ("CLOSED", 1, 0),
        ("CANCELLED", 1, 0),
        ("OPEN", None, None),
    ],
)
def test_bid_deadline_inclusive(status, days, score):
    """Given 마감 당일·종료·미상, When 공고 점수, Then 당일까지 유효하며 미상만 null이다."""
    data = rule_engine_input()
    data.signals[0] = replace_contract(
        data.signals[0],
        progress_status=status,
        deadline_at=None if days is None else data.base_date + timedelta(days=days),
    )
    assert calculate_items(data)[6].score == score


@pytest.mark.parametrize("status,expected", [("OPEN", 5), ("CLOSED", 0), ("DONE", 0)])
def test_hiring_closed_and_no_signal(status, expected):
    """Given 종료·완료 채용 또는 연결 없는 신호, When 계산, Then 0점 판정을 남긴다."""
    data = rule_engine_input()
    signal = replace_contract(
        data.signals[1], signal_id="hire", signal_kind="HIRING", progress_status=status
    )
    data.signals.append(signal)
    data.item_inputs[7] = replace_contract(
        data.item_inputs[7], state="CONFIRMED", match_rate=1, signal_ids=[signal.signal_id]
    )
    assert calculate_items(data)[7].score == expected
    data.item_inputs[7].signal_ids = [data.signals[0].signal_id]
    assert calculate_items(data)[7].state == ItemState.NO_SIGNAL
    data.item_inputs[7].signal_ids = ["missing"]
    with pytest.raises(ValueError, match="신호 참조"):
        calculate_items(data)


@pytest.mark.parametrize(
    "problem",
    ["d_only", "missing_evidence", "duplicate", "wrong_profile", "bad_config", "missing_step"],
)
def test_invalid_input_and_d_grade(problem):
    """Given 사용할 수 없는 근거·입력 구조, When 계산, Then 잘못된 성공으로 바꾸지 않는다."""
    data = rule_engine_input()
    if problem == "d_only":
        for evidence in data.evidence:
            evidence.source_grade = "D"
        assert calculate_items(data)[0].state == ItemState.UNAVAILABLE
        return
    if problem == "missing_evidence":
        data.evidence = []
    elif problem == "duplicate":
        data.item_inputs.append(data.item_inputs[0])
    elif problem == "wrong_profile":
        data.profile = "RECONTACT"
    elif problem == "bad_config":
        data.rule_config.new_profile_items.pop()
    else:
        data.item_inputs[0].match_rate = None
        data.item_inputs[0].match_rate_step = "해당"
        assert calculate_items(data)[0].score == 25
        return
    with pytest.raises(ValueError):
        calculate_items(data)
