"""#643: 마무리 꼬리 질문이 단계를 정하는지 본다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_sales_questions as support
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
scenarios("u5/sales_close_questions.feature")


def detail(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]


@given("평가된 가상 회사와 한 번 연결된 접촉 기록이 있다", target_fixture="context")
def one_contact(records_env):
    client, opp_id = records_env
    first = support.contact(attemptedAt="2026-10-15", answers=[("WHO_TALKED", "RIGHT_PERSON")])
    assert support.save(client, opp_id, first)["status"] == "IN_PROGRESS"
    return {"client": client, "opp_id": opp_id, "before": detail(client, opp_id)}


@when('연결된 접촉에서 다음 할 일 "끝", 어떻게 끝났나 "거절", 거절 이유 "가격"을 골라 저장하면')
def close_lost(context):
    body = support.contact(
        answers=[("NEXT_ACTION", "END"), ("CLOSE_RESULT", "LOST"), ("LOST_REASON", "PRICE")]
    )
    context["saved"] = support.save(context["client"], context["opp_id"], body)


@then("큰 단계는 거절이고 거절 이유는 가격이며 영업 분석의 거절 이유에 가격 1건이 잡힌다")
def lost_with_reason(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["saved"]["status"] == "LOST"
    after = detail(client, opp_id)
    outcome = after["records"]["outcome"]
    assert (outcome["status"], outcome["lostReasonCode"]) == ("LOST", "PRICE")
    assert after["records"]["salesStep"]["code"] is None
    assert after["scores"] == context["before"]["scores"]
    card = support.card_of(client, opp_id)
    assert card["records"]["outcome"]["status"] == "LOST"
    analysis = client.get("/api/v1/sales-analysis").json()["data"]
    company = next(row for row in analysis["companies"] if row["oppId"] == opp_id)
    assert (company["outcomeStatus"], company["lostReasonCode"]) == ("LOST", "PRICE")
    assert company["contactCount"]["total"] == 2
    rows = analysis["byProcess"]
    assert rows and all(row["lostCount"] == 1 for row in rows)
    assert all(row["lostReasons"] == [{"code": "PRICE", "count": 1}] for row in rows)


@when('결과가 거절인 접촉에서 다음 할 일 "끝", 어떻게 끝났나 "보류 · 나중에 다시"를 골라 저장하면')
def close_on_hold(context):
    body = support.contact(
        result="DECLINED", answers=[("NEXT_ACTION", "END"), ("CLOSE_RESULT", "ON_HOLD")]
    )
    context["saved"] = support.save(context["client"], context["opp_id"], body)


@then("큰 단계는 보류이고 세부 단계는 비며 접촉 횟수는 2회다")
def on_hold(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["saved"]["status"] == "ON_HOLD"
    after = detail(client, opp_id)["records"]
    assert after["outcome"]["status"] == "ON_HOLD"
    assert after["outcome"]["lostReasonCode"] is None
    assert after["salesStep"]["code"] is None
    assert after["contactCount"]["total"] == 2


@when('연결된 접촉에서 다음 할 일 "끝", 어떻게 끝났나 "거절"만 골라 저장하면')
def close_without_reason(context):
    body = support.contact(answers=[("NEXT_ACTION", "END"), ("CLOSE_RESULT", "LOST")])
    context["response"] = records.post(context["client"], context["opp_id"], "outcomes", body)


@then('"거절 이유를 골라 주세요."로 거부되고 단계와 접촉 횟수는 그대로다')
def rejected(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    fields = response.json()["error"]["fields"]
    assert [(item["path"], item["message"]) for item in fields] == [
        ("lostReasonCode", "거절 이유를 골라 주세요.")
    ]
    after = detail(context["client"], context["opp_id"])["records"]
    assert after == context["before"]["records"]
