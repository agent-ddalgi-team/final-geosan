"""#680: 실제 임시 DB·실제 API로 영업 비서 시나리오를 확인한다. 외부 AI는 가짜 응답이다."""

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
scenarios("u7/sales_assistant.feature")

QUESTION = "가격 때문에 거절된 회사는?"


@given("영업 기록이 있는 가상 회사들이 있고 외부 AI는 가짜 응답이다", target_fixture="context")
def seeded(assistant_env):
    client, opp_ids, fake = assistant_env
    support.seed(client, opp_ids)
    return {
        "client": client,
        "opp_ids": opp_ids,
        "fake": fake,
        "names": support.names(opp_ids),
        "before": support.row_counts(),
        "responses": [],
    }


@given("영업 기록 전용 스위치가 꺼져 있다")
def switch_off(context):
    support.use_external_ai(salesRecordsEnabled=False)


@given("하루 질문 한도가 1번이다")
def daily_limit_one(context):
    support.change_assistant(dailyQuestionLimit=1)


@given("가짜 AI가 조회에 있는 회사 하나와 없는 회사 이름 하나를 답에 적는다")
def answer_with_unknown_company(context):
    context["fake"].answer = f"{context['names'][0]}와 없는회사Z가 가격 때문에 거절했습니다."


@given("그 가운데 한 곳이 실제 회사로 표시돼 있다")
def one_real_company(context):
    with session_scope() as session:
        opportunity = session.get(Opportunity, context["opp_ids"][1])
        opportunity.is_virtual = False
        session.get(Customer, opportunity.customer_id).is_virtual = False


@when("담당자가 질문을 하고 한 회사의 통화 준비를 누른다")
def ask_and_prepare(context):
    context["responses"] = [
        support.ask(context["client"], QUESTION),
        support.call_prep(context["client"], context["opp_ids"][1]),
    ]


@when(parsers.parse('담당자가 "{question}"이라고 묻는다'))
def ask_once(context, question):
    context["responses"] = [support.ask(context["client"], question)]


@when("담당자가 같은 질문을 두 번 한다")
def ask_twice(context):
    context["responses"] = [support.ask(context["client"], QUESTION) for _ in range(2)]


@then("둘 다 설정이 꺼져 있다는 오류로 거부된다")
def both_rejected(context):
    for response in context["responses"]:
        assert response.status_code == 422, response.text
        assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"


@then("외부 AI로 나간 글이 없고 거부 기록만 남는다")
def nothing_sent_only_rejections(context):
    assert context["fake"].payloads == []
    assert [row[2:] for row in support.logs()] == [("REJECTED", 0)] * 2


@then("AI가 쓴 답 표시와 함께 답이 온다")
def answer_arrives(context):
    (response,) = context["responses"]
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["answer"] == context["fake"].answer and data["aiGenerated"] is True


@then("조회에 실린 회사마다 전송 기록이 한 줄씩 남고 호출은 한 번이다")
def one_row_per_company(context):
    rows = support.logs()
    assert sorted(row[0] for row in rows) == sorted(context["opp_ids"][:3])
    assert all(row[1:3] == ("SALES_RECORD", "ALLOWED") for row in rows)
    assert sum(row[3] for row in rows) == 1 and len(context["fake"].payloads) == 1


@then("보낸 글에 영업 메모·한 줄 메모·일정 글·거절 사유 글·대표번호·담당자 이름이 없다")
def no_free_text_sent(context):
    assert all(response.status_code == 200 for response in context["responses"])
    assert len(context["fake"].payloads) == 2
    for planted in support.PLANTED:
        assert planted not in context["fake"].sent, planted


@then("보낸 글에 회사 이름과 접촉 날짜와 고른 답은 있다")
def picked_values_sent(context):
    sent = context["fake"].sent
    for expected in (context["names"][0], "2026-10-06 전화 연결됨", "→ 외주 줌"):
        assert expected in sent, expected


@then("근거 회사에는 조회에 있던 회사 하나만 있다")
def sources_only_known(context):
    (response,) = context["responses"]
    assert response.json()["data"]["sources"] == [
        {"oppId": context["opp_ids"][0], "name": context["names"][0]}
    ]
    assert "없는회사Z" in response.json()["data"]["answer"]


@then("두 번째 질문은 오늘 한도를 넘었다는 오류로 거부되고 호출은 한 번뿐이다")
def second_rejected(context):
    first, second = context["responses"]
    assert first.status_code == 200, first.text
    assert second.status_code == 503 and second.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(context["fake"].payloads) == 1


@then("입력 오류로 거부되고 외부 AI로 나간 글이 없다")
def contact_question_rejected(context):
    (response,) = context["responses"]
    assert response.status_code == 400, response.text
    assert context["fake"].payloads == [] and support.logs() == []


@then("영업 기록·고른 답·메모·관심·평가 행 수가 호출 전과 같다")
def nothing_changed(context):
    assert all(response.status_code == 200 for response in context["responses"])
    assert support.row_counts() == context["before"]


@then("보낸 글에 실제 회사로 표시된 곳의 이름이 없고 전송 기록도 달리지 않는다")
def real_company_left_out(context):
    (response,) = context["responses"]
    assert response.status_code == 200, response.text
    assert context["names"][1] not in context["fake"].sent
    assert context["opp_ids"][1] not in [row[0] for row in support.logs()]
