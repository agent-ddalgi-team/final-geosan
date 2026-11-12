"""#607: 가상 입력·실제 SQLite·실제 API로 꼬리 질문 답과 세부 단계를 본다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_sales_questions as support
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
scenarios("u5/sales_questions.feature")


def detail(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]


@given("평가된 가상 회사에 아직 접촉 기록이 없다", target_fixture="context")
def no_contact(records_env):
    client, opp_id = records_env
    before = detail(client, opp_id)
    assert before["records"]["salesStep"]["code"] is None
    return {"client": client, "opp_id": opp_id, "before": before, "steps": []}


@when('부재와 다른 부서 통화를 저장한 뒤 담당 부서와 연결돼 "외주 줌"과 한 줄 메모를 저장하면')
def contacts(context):
    client, opp_id = context["client"], context["opp_id"]
    support.save(client, opp_id, support.contact(result="ABSENT", attemptedAt="2026-10-15"))
    support.save(client, opp_id, support.contact(answers=[("WHO_TALKED", "OTHER_DEPT")]))
    context["steps"].append(support.step_of(client, opp_id)["code"])
    body = support.contact(
        answers=[("WHO_TALKED", "RIGHT_PERSON"), ("PLATING_NOW", "OUTSOURCED")],
        memo="다음 달 새 라인이 들어온다고 함(가상)",
    )
    context["saved"] = support.save(client, opp_id, body)


@then("세부 단계는 연결 전에 머물다가 수요 확인이 되고 큰 단계는 접촉이며 점수는 그대로다")
def demand(context):
    client, opp_id, before = context["client"], context["opp_id"], context["before"]
    assert context["steps"] == ["NOT_REACHED"]
    after = detail(client, opp_id)
    step = after["records"]["salesStep"]
    assert step["code"] == "DEMAND_CONFIRMED"
    assert [item["answer"] for item in step["known"]] == ["담당 부서", "외주 줌"]
    assert "SWITCH_INTENT" in step["openQuestions"]
    assert context["saved"]["status"] == "IN_PROGRESS"
    assert after["records"]["contactCount"]["call"] == 3
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]


@when('연결된 접촉에서 "견적 요청"을 고르면')
def quote(context):
    client, opp_id = context["client"], context["opp_id"]
    body = support.contact(status="NOT_EXECUTED", answers=[("QUOTE_REQUEST", "QUOTE")])
    context["saved"] = support.save(client, opp_id, body)


@then("큰 단계는 견적·샘플이고 세부 단계는 자료·견적이며 카드에도 같은 세부 단계가 보인다")
def quoted(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["saved"]["status"] == "SAMPLE_OR_REGISTRATION_APPROVED"
    assert support.step_of(client, opp_id)["code"] == "MATERIAL_QUOTE"
    card = support.card_of(client, opp_id)
    assert card["salesStep"] == "MATERIAL_QUOTE"
    assert card["records"]["outcome"]["status"] == "SAMPLE_OR_REGISTRATION_APPROVED"
