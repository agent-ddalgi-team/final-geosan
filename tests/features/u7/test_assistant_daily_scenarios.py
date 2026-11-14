"""#743: 실제 임시 DB·실제 API로 같이 들를 곳과 오늘 정리를 확인한다. 외부 AI는 가짜 응답이다."""

from pytest_bdd import given, parsers, scenarios, then, when

from tests.unit.u7 import test_assistant_daily as support
from tests.unit.u7 import test_sales_assistant as assistant

brochure_env = support.brochure_env
daily_env = support.daily_env
scenarios("u7/assistant_daily.feature")


@given(
    "내일 방문할 회사 근처 1.1km에 관심 기업이 있고 외부 AI는 가짜 응답이다",
    target_fixture="context",
)
def seeded(daily_env):
    client, ids, fake = daily_env
    support.seed(client, ids)
    return {"client": client, "ids": ids, "fake": fake, "responses": []}


@given("영업 기록 전용 스위치가 꺼져 있다")
def switch_off(context):
    assistant.use_external_ai(salesRecordsEnabled=False)


@given("하루 질문 한도 1번을 질문 하나로 다 썼다")
def limit_used(context):
    assistant.change_assistant(dailyQuestionLimit=1)
    assert assistant.ask(context["client"], "이번 주에 연락할 회사는?").status_code == 200


@when(parsers.parse('담당자가 "{question}"라고 묻는다'))
def ask_once(context, question):
    context["responses"] = [assistant.ask(context["client"], question)]


@when("담당자가 대시보드를 두 번 연다")
def open_twice(context):
    context["responses"] = [support.daily(context["client"]) for _ in range(2)]


@then("보낸 글에 방문할 회사와 근처 관심 기업의 이름·거리·묶음이 있다")
def visit_line_sent(context):
    (response,) = context["responses"]
    assert response.status_code == 200, response.text
    assert "가상 anchor(진행 중) → 가상 near 1.1km(관심)" in context["fake"].sent


@then("보낸 글에 주소·좌표·대표번호·메모·사람 이름이 없다")
def nothing_private_sent(context):
    for planted in support.FORBIDDEN:
        assert planted not in context["fake"].sent, planted


@then("두 번 다 같은 오늘 정리가 보이고 AI 호출은 한 번이다")
def same_brief_once(context):
    first, second = (response.json()["data"] for response in context["responses"])
    assert first["summary"] == second["summary"] and first["aiGenerated"] is True
    assert (first["reused"], second["reused"]) == (False, True)
    assert len(context["fake"].payloads) == 1


@then("오늘 정리는 설정이 꺼져 있다는 오류로 거부되고 AI 호출은 없다")
def rejected_switch_off(context):
    for response in context["responses"]:
        assert response.status_code == 422
        assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert context["fake"].payloads == [] and support.calls() == 0


@then("오늘 정리는 오늘 한도를 넘었다는 오류로 거부되고 AI 호출은 질문 한 번뿐이다")
def rejected_limit(context):
    for response in context["responses"]:
        assert response.status_code == 503
        assert response.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(context["fake"].payloads) == 1 and support.calls() == 1
