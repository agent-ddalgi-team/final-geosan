"""#685: 통화에서 확인한 신호가 점수로 들어가는 흐름을 실제 임시 DB·API로 본다. 외부 호출 없음."""

from pytest_bdd import given, parsers, scenarios, then, when

from tests.unit.u1 import test_call_signals as support
from tests.unit.u1 import test_record_cancel as cancels
from tests.unit.u1 import test_sales_questions as questions

call_env = support.call_env

scenarios("u5/call_signals.feature")


def _context(client, opp_id):
    before = support.detail(client, opp_id)
    return {"client": client, "opp_id": opp_id, "before": before, "run": support.run_of(opp_id)}


def _bid(context):
    return support.item(context["client"], context["opp_id"], "SIG_BID")


@given("A정밀 가상 사례가 평가돼 있다", target_fixture="context")
def apjeong(call_env):
    client, _, apjeong_id = call_env
    return _context(client, apjeong_id)


@given("공고가 없는 가상 회사가 평가돼 있다", target_fixture="context")
def free_company(call_env):
    client, free, _ = call_env
    context = _context(client, free)
    assert _bid(context)["state"] == "NO_SIGNAL" and _bid(context)["score"] == 0
    return context


@given("점수 입력이 없는 평가 전 가상 회사가 있다", target_fixture="context")
def not_evaluated_company(call_env):
    client, free, _ = call_env
    support.as_not_evaluated(free)
    context = _context(client, free)
    assert context["before"]["header"]["classificationCode"] == "NOT_EVALUATED"
    return context


@when("답을 고르지 않고 연결된 접촉만 저장하면")
def contact_only(context):
    context["meta"] = support.call(context["client"], context["opp_id"])["meta"]


@then("A정밀은 E 77, P 95, S 81.1, R 82 그대로이고 다시 평가하지 않는다")
def apjeong_unchanged(context):
    data = support.detail(context["client"], context["opp_id"])
    scores = data["scores"]
    assert (scores["E"], scores["P"], scores["S"], scores["R"]) == (77, 95, 81.1, 82)
    assert data["evalId"] == context["before"]["evalId"]
    assert context["meta"].get("reevaluated") is not True
    assert _bid(context)["score"] == 7 and support.call_signals(context["opp_id"]) == []


@then('점수표의 항목 이름은 "구매·외주 의향"과 "관심"이다')
def widened_labels(context):
    items = support.detail(context["client"], context["opp_id"])["scores"]["items"]
    labels = {row["itemCode"]: (row["label"], row["weight"]) for row in items}
    assert labels["SIG_BID"] == ("구매·외주 의향", 7)
    assert labels["SIG_HIRE"] == ("관심", 5)


@given('기준일의 통화에서 "견적 요청"을 골라 저장했다')
@when('기준일의 통화에서 "견적 요청"을 골라 저장하면')
def quote_today(context):
    context["meta"] = support.call(context["client"], context["opp_id"], support.QUOTE)["meta"]


@when(parsers.parse('기준일보다 {days:d}일 전 통화에서 "견적 요청"을 골라 저장하면'))
def quote_days_ago(context, days):
    support.call(context["client"], context["opp_id"], support.QUOTE, days_ago=days)


@then('구매·외주 의향은 7점이고 설명은 "통화에서 확인(10/20) · 견적 요청"이다')
def full_score(context):
    row = _bid(context)
    assert (row["label"], row["state"], row["score"]) == ("구매·외주 의향", "CONFIRMED", 7)
    assert (row["matchRate"], row["certainty"], row["decay"]) == (1.0, 1.0, 1.0)
    assert row["factJudged"] == "통화에서 확인(10/20) · 견적 요청"
    assert support.call_signals(context["opp_id"]) == [
        ("CALL_INTENT", "DIRECT", support.BASE_DATE, "CALL", None)
    ]
    assert support.input_rows(context["opp_id"], "SIG_BID") == [
        (1, "FILE", "NO_SIGNAL", False),
        (2, "CALL", "CONFIRMED", True),
    ]


@then("다시 평가되고 E가 7점 오른다")
def reevaluated_with_more_points(context):
    assert context["meta"]["reevaluated"] is True
    data = support.detail(context["client"], context["opp_id"])
    assert data["evalId"] != context["before"]["evalId"]
    assert data["scores"]["E"] == context["before"]["scores"]["E"] + 7


@then('"지금 바로 연락" 조건과 카드 유효 기한은 그대로다')
def not_an_action_signal(context):
    # 통화 신호는 점수에만 쓴다: 직접 행동 신호 조건·유효 기한은 그대로라, E가 "지금 바로 연락"
    # 기준점을 넘어도 그 분류가 되지 않는다(점수로 오르는 분류까지만 간다).
    before, after = context["run"], support.run_of(context["opp_id"])
    assert after["eval_id"] != before["eval_id"]
    for key in ("timing_requirements", "valid_until"):
        assert after[key] == before[key], key
    assert after["timing_requirements"]["directSignal"] is False and after["valid_until"] is None
    assert support.detail(context["client"], context["opp_id"])["scores"]["E"] >= 75
    assert after["classification_code"] == "CONTACT_PLANNED"


@then(parsers.parse("구매·외주 의향은 {score:d}점이다"))
def decayed_score(context, score):
    row = _bid(context)
    assert (row["state"], row["score"]) == ("CONFIRMED", score)


@when("그 접촉 기록을 잘못 입력으로 표시하면")
def cancel_contact(context):
    client, opp_id = context["client"], context["opp_id"]
    assert _bid(context)["score"] == 7
    context["eval_before_cancel"] = support.detail(client, opp_id)["evalId"]
    record_id = cancels.record_id_of(client, opp_id, "CONTACT_ATTEMPT")
    context["response"] = cancels.cancel(client, opp_id, record_id)


@then('구매·외주 의향은 사례 파일의 "신호 없음" 0점으로 돌아가고 다시 평가된다')
def score_removed(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["response"].status_code == 200, context["response"].text
    assert context["response"].json()["meta"]["reevaluated"] is True
    row = _bid(context)
    assert (row["state"], row["score"]) == ("NO_SIGNAL", 0)
    assert row["factJudged"] == "홈페이지에 입찰·협력사 모집 글 없음(가상)"
    data = support.detail(client, opp_id)
    assert data["evalId"] != context["eval_before_cancel"]
    assert data["scores"] == {**data["scores"], "E": context["before"]["scores"]["E"]}
    assert support.call_signals(opp_id) == []
    assert support.input_rows(opp_id, "SIG_BID") == [
        (1, "FILE", "NO_SIGNAL", False),
        (2, "CALL", "CONFIRMED", False),
        (3, "FILE", "NO_SIGNAL", True),
    ]


@when('통화에서 "아직 없음"과 "모름"과 "관심 낮음"을 골라 저장하면')
def unknown_answers(context):
    answers = [support.NOT_YET, ("SWITCH_INTENT", "UNKNOWN"), ("INTEREST", "LOW")]
    context["meta"] = support.call(context["client"], context["opp_id"], *answers)["meta"]


@then("점수와 확인 범위는 그대로이고 다시 평가하지 않으며 통화 신호도 없다")
def nothing_changes(context):
    data = support.detail(context["client"], context["opp_id"])
    assert data["evalId"] == context["before"]["evalId"]
    assert data["scores"] == context["before"]["scores"]
    assert context["meta"].get("reevaluated") is not True
    assert support.call_signals(context["opp_id"], live=False) == []
    assert support.input_rows(context["opp_id"], "SIG_BID") == [(1, "FILE", "NO_SIGNAL", True)]
    assert support.input_rows(context["opp_id"], "SIG_HIRE") == [(1, "FILE", "UNAVAILABLE", True)]


@then("그 회사는 평가 전 그대로이고 점수 입력 행은 생기지 않는다")
def still_not_evaluated(context):
    data = support.detail(context["client"], context["opp_id"])
    assert context["meta"].get("reevaluated") is not True
    assert data["evalId"] == context["before"]["evalId"]
    assert data["header"]["classificationCode"] == "NOT_EVALUATED"
    assert data["scores"]["S"] is None
    assert all(row[3] is False for row in support.input_rows(context["opp_id"], "SIG_BID"))
    assert questions.step_of(context["client"], context["opp_id"])["code"] == "MATERIAL_QUOTE"


@then("통화 신호 행은 하나 저장돼 있다")
def signal_row_kept(context):
    assert support.call_signals(context["opp_id"]) == [
        ("CALL_INTENT", "DIRECT", support.BASE_DATE, "CALL", None)
    ]
