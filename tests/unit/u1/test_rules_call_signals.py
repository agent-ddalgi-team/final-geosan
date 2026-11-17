"""#685 규칙 엔진: 통화에서 확인한 신호의 항목 짝·감쇠·직접 행동 신호 제외를 가상 입력으로 본다."""

from datetime import timedelta

import pytest

from geosan.rules.engine import evaluate
from geosan.rules.items import calculate_items
from geosan.rules.models import CallSignalRule, SignalInput
from geosan.rules.timing import direct_action_signals, valid_contact_until
from tests.factories import replace_contract, rule_engine_input

BID_ITEM, HIRE_ITEM = 6, 7
CALL_RULES = [
    {
        "itemCode": "SIG_BID",
        "signalKind": "CALL_INTENT",
        "answers": [{"questionId": "QUOTE_REQUEST", "answerId": "QUOTE", "relation": "DIRECT"}],
    },
    {
        "itemCode": "SIG_HIRE",
        "signalKind": "CALL_INTEREST",
        "answers": [{"questionId": "INTEREST", "answerId": "HIGH", "relation": "DIRECT"}],
    },
]


def call_signal(data, kind="CALL_INTENT", days_ago=0, relation="DIRECT", signal_id="sig-call-1"):
    return SignalInput.model_validate(
        {
            "signalId": signal_id,
            "signalKind": kind,
            "occurredAt": (data.base_date - timedelta(days=days_ago)).isoformat(),
            "certainty": "CONFIRMED",
            "relation": relation,
        }
    )


def with_call(index=BID_ITEM, *, rules=True, keep_bid=False, **signal):
    """A정밀 입력에서 한 시점 항목을 통화 신호에 연결한다(가상)."""
    data = rule_engine_input()
    if rules:
        data.rule_config.call_signals = [CallSignalRule.model_validate(row) for row in CALL_RULES]
    row = call_signal(data, **signal)
    data.signals.append(row)
    item = data.item_inputs[index]
    ids = [*item.signal_ids, row.signal_id] if keep_bid else [row.signal_id]
    data.item_inputs[index] = replace_contract(
        item, state="CONFIRMED", match_rate=None, match_rate_step=None, signal_ids=ids
    )
    if not keep_bid:
        data.item_inputs[index] = replace_contract(data.item_inputs[index], evidence_ids=[])
    return data


@pytest.mark.parametrize(
    "days,decay,score", [(0, 1.0, 7), (30, 1.0, 7), (31, 0.5, 4), (90, 0.5, 4), (91, 0.0, 0)]
)
def test_call_signal_uses_general_decay_from_the_call_date(days, decay, score):
    """Given 통화 의향 신호 / When 통화 날짜가 지남 / Then 공고 예외가 아니라 일반 감쇠를 쓴다."""
    row = calculate_items(with_call(days_ago=days))[BID_ITEM]
    assert (row.state, row.match_rate, row.decay, row.score) == ("CONFIRMED", 1.0, decay, score)


def test_indirect_call_signal_gives_half():
    """Given 간접 관련 통화 신호 / When 계산 / Then 배점의 절반(7 → 4, 5 → 3)."""
    assert calculate_items(with_call(relation="INDIRECT"))[BID_ITEM].score == 4
    data = with_call(HIRE_ITEM, kind="CALL_INTEREST", relation="INDIRECT")
    assert calculate_items(data)[HIRE_ITEM].score == 3
    data = with_call(HIRE_ITEM, kind="CALL_INTEREST")
    assert calculate_items(data)[HIRE_ITEM].score == 5


def test_bid_signal_wins_when_both_are_linked():
    """Given 한 항목에 공고와 통화 신호가 같이 연결 / When 계산 / Then 공고만 쓴다(마감 기준)."""
    data = with_call(keep_bid=True, days_ago=100)
    row = calculate_items(data)[BID_ITEM]
    assert (row.decay, row.score) == (1.0, 7)
    assert calculate_items(rule_engine_input())[BID_ITEM].score == 7


def test_call_signal_is_ignored_without_the_setting_or_with_the_wrong_kind():
    """Given 설정에 대응표가 없거나 짝이 다른 신호 / When 계산 / Then 연결된 신호 없음(0점)."""
    row = calculate_items(with_call(rules=False))[BID_ITEM]
    assert (row.state, row.score) == ("NO_SIGNAL", 0)
    row = calculate_items(with_call(kind="CALL_INTEREST"))[BID_ITEM]
    assert (row.state, row.score) == ("NO_SIGNAL", 0)


def test_call_signal_is_not_a_direct_action_signal():
    """Given 공고 대신 통화 신호만 / When 평가 / Then 점수는 같아도 지금 바로 연락이 아니다."""
    original = evaluate(rule_engine_input())
    assert original.classification_code == "CONTACT_URGENT"
    data = with_call()
    data.signals = [s for s in data.signals if s.signal_kind != "BID"]
    output = evaluate(data)
    assert output.totals.E == original.totals.E == 77
    assert direct_action_signals(data) == [] and valid_contact_until(data) is None
    assert output.timing.direct_signal is False
    assert output.classification_code != "CONTACT_URGENT"
    assert output.sort_key.valid_until is None


def test_apjeong_expected_values_do_not_change():
    """A정밀 기대값(역산한 가정값, 규칙서 확인 전)은 통화 신호 규칙을 더해도 그대로다."""
    totals = evaluate(rule_engine_input()).totals
    assert (totals.E, totals.P, totals.S, totals.R) == (77, 95, 81.1, 82)
