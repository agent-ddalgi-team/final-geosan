"""#742: 영업 코치를 실제 임시 DB·실제 API로 본다. 외부 AI는 가짜 응답이다(실제 호출 없음)."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import OutcomeAnswer
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_assistant as support
from tests.unit.u7 import test_sales_coach as coach_support
from tests.unit.u7.test_peers import note

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
coach_env = coach_support.coach_env
scenarios("u7/sales_coach.feature")


@given(
    "외주를 주는 가상 회사에 이름이 적힌 이전 통화 기록이 있고 영업 기록 스위치가 켜져 있다",
    target_fixture="context",
)
def company_with_first_contact(coach_env):
    client, opp_ids, fake = coach_env
    return {"client": client, "opp_ids": opp_ids, "fake": fake, "rows": support.row_counts()}


@when('"견적 요청함"이 적힌 메모를 영업 코치에 보내면')
def send_memo(context):
    response = coach_support.coach(context["client"], context["opp_ids"][0])
    assert response.status_code == 200, response.text
    context["data"] = response.json()["data"]


@then('외부 AI로 나간 글에는 "[이름] 과장"이 있고 사람 이름과 전화번호는 없다')
def only_scrubbed_copy(context):
    sent = context["fake"].sent
    assert "[이름] 과장 통화" in sent
    for planted in coach_support.PLANTED:
        assert planted not in sent, planted


@then(
    "견적 요청은 AI가 채우고 맡길 공정은 제안으로만 오며 빠진 필수 질문은 "
    "통화 전 단계의 외주처 바꿀 생각뿐이다"
)
def filled_and_missing(context):
    fills = {item["questionId"]: item["fill"] for item in context["data"]["answers"]}
    assert fills == {"QUOTE_REQUEST": "AI", "NEXT_ACTION": "AI", "CONFIRM_PROCESS": "SUGGEST"}
    # (바뀜 #742 PM 결정) 이번 메모로 넘어간 자료·견적 단계의 질문은 묻지 않는다.
    assert context["data"]["missingRequired"] == ["SWITCH_INTENT"]


@then("피드백은 이전 기록의 날짜를 짚은 줄만 남고 금액·할인·연락처가 든 줄은 없다")
def feedback_points_back(context):
    assert context["data"]["feedback"] == ["10/21 메모의 납기 걱정에 아직 답을 못 줬어요."]


@then("기록은 그대로이고 전송 기록만 SALES_COACH로 1행 늘었다")
def read_only(context):
    assert support.row_counts() == context["rows"]
    assert support.logs()[-1] == (context["opp_ids"][0], "SALES_COACH", "ALLOWED", 1)
    assert [row[1] for row in support.logs()].count("SALES_COACH") == 1


@when("받은 답을 그대로 접촉 기록으로 저장하고 첫 피드백을 보고서에 남기면")
def save_as_is(context):
    """화면의 [이대로 저장]과 같은 요청: AI가 채운 답은 AI_CONFIRMED, 빠진 필수는 담당자가."""
    data = context["data"]
    answers = [
        {"questionId": item["questionId"], "answerId": answer_id, "filledBy": "AI_CONFIRMED"}
        for item in data["answers"]
        if item["fill"] == "AI"
        for answer_id in item["answerIds"]
    ]
    answers.append({"questionId": "SWITCH_INTENT", "answerId": "YES", "filledBy": "STAFF"})
    schedule = data["nextSchedule"]
    coach_support.record(
        context["client"],
        context["opp_ids"][0],
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "memo": coach_support.MEMO,
            "answers": answers,
            "nextScheduleAt": schedule["date"],
            "nextScheduleNote": "다시 연락",
        },
    )
    context["advice"] = data["feedback"][0]
    note(context["client"], context["opp_ids"][0], context["advice"], kind="ADVICE")


@then("저장된 견적 요청 답은 AI가 채운 답으로 남고 담당자가 고른 답은 담당자 답으로 남는다")
def filled_by_saved(context):
    with session_scope() as session:
        filled = dict(
            session.execute(
                select(OutcomeAnswer.question_id, OutcomeAnswer.filled_by).where(
                    OutcomeAnswer.opp_id == context["opp_ids"][0]
                )
            ).all()
        )
    assert filled["QUOTE_REQUEST"] == "AI_CONFIRMED"
    assert filled["NEXT_ACTION"] == "AI_CONFIRMED"
    assert filled["SWITCH_INTENT"] == "STAFF"


@then("상세의 남긴 피드백과 활동 이력에 그 줄이 있다")
def advice_listed(context):
    client, opp_id = context["client"], context["opp_ids"][0]
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert [row["text"] for row in detail["records"]["advice"]] == [context["advice"]]
    items = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert f"남긴 피드백 · {context['advice']}" in [item["summary"] for item in items]


@when("스위치를 끄고 메모를 영업 코치에 보내면")
def send_with_switch_off(context):
    support.use_external_ai(salesRecordsEnabled=False)
    context["response"] = coach_support.coach(context["client"], context["opp_ids"][0])


@then('"영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."로 거부되고 외부 AI는 불리지 않는다')
def rejected_by_switch(context):
    response = context["response"]
    assert response.status_code == 422, response.text
    assert (
        response.json()["error"]["message"] == "영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다."
    )
    assert context["fake"].payloads == []


@when("코치 하루 한도를 1회로 두고 메모를 두 번 보내면")
def send_twice(context):
    support.change_assistant(coachDailyLimit=1, dailyQuestionLimit=1)
    client, opp_ids = context["client"], context["opp_ids"]
    context["first"] = coach_support.coach(client, opp_ids[0])
    context["second"] = coach_support.coach(client, opp_ids[0])


@then("두 번째는 COACH_LIMIT로 거부되고 영업 비서 질문은 그대로 나간다")
def limit_apart(context):
    assert context["first"].status_code == 200, context["first"].text
    assert context["second"].status_code == 503
    assert context["second"].json()["error"]["kind"] == "COACH_LIMIT"
    context["fake"].answer = "가상 답입니다."
    assert support.ask(context["client"]).status_code == 200
    assert len(context["fake"].payloads) == 2
