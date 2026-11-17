"""#691: 누가 먼저 연락했는지(기본 보기가 있는 질문)를 접촉마다 남긴다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import OutcomeAnswer
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_questions as support
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
scenarios("u5/who_first.feature")


def who_first_answers(opp_id):
    with session_scope() as session:
        return list(
            session.scalars(
                select(OutcomeAnswer.answer_id).where(
                    OutcomeAnswer.opp_id == opp_id, OutcomeAnswer.question_id == "WHO_FIRST"
                )
            )
        )


@given("평가된 가상 회사가 있다", target_fixture="context")
def company(records_env):
    client, opp_id = records_env
    return {"client": client, "opp_id": opp_id}


@when('연결된 전화를 누가 먼저 "상대가"와 누구와 이야기했나 "담당 부서"로 저장하면')
def reached_theirs(context):
    body = support.contact(answers=[("WHO_FIRST", "THEIRS"), ("WHO_TALKED", "RIGHT_PERSON")])
    context["saved"] = support.save(context["client"], context["opp_id"], body)


@then('그 접촉에 "상대가" 답이 남고 세부 단계는 "연결됨"이며 큰 단계는 접촉이다')
def theirs_kept(context):
    assert context["saved"]["status"] == "IN_PROGRESS"
    assert who_first_answers(context["opp_id"]) == ["THEIRS"]
    assert support.step_of(context["client"], context["opp_id"])["code"] == "REACHED"


@when('부재로 끝난 전화를 누가 먼저 "우리가"로 저장하면')
def absent_ours(context):
    body = support.contact(result="ABSENT", answers=[("WHO_FIRST", "OURS")])
    context["saved"] = support.save(context["client"], context["opp_id"], body)


@then('저장되고 세부 단계는 "연결 전"이며 그 접촉에 "우리가" 답이 남는다')
def absent_kept(context):
    assert context["saved"]["status"] == "IN_PROGRESS"
    assert support.step_of(context["client"], context["opp_id"])["code"] == "NOT_REACHED"
    assert who_first_answers(context["opp_id"]) == ["OURS"]


@when('부재로 끝난 전화를 누가 먼저 "우리가"와 관심 정도 "높음"으로 저장하면')
def absent_with_other(context):
    body = support.contact(result="ABSENT", answers=[("WHO_FIRST", "OURS"), ("INTEREST", "HIGH")])
    context["response"] = records.post(context["client"], context["opp_id"], "outcomes", body)


@then('"연결된 접촉에서만 답을 고를 수 있습니다."로 거부되고 기록은 남지 않는다')
def absent_rejected(context):
    response = context["response"]
    assert response.status_code == 400, response.text
    fields = response.json()["error"]["fields"]
    assert [(item["path"], item["message"]) for item in fields] == [
        ("answers", "연결된 접촉에서만 답을 고를 수 있습니다.")
    ]
    assert who_first_answers(context["opp_id"]) == []
    assert support.step_of(context["client"], context["opp_id"])["code"] is None


@when("걸려 온 전화와 상대가 온 방문과 우리가 건 전화를 차례로 저장하면")
def three_contacts(context):
    client, opp_id = context["client"], context["opp_id"]
    theirs = [("WHO_FIRST", "THEIRS")]
    support.save(client, opp_id, support.contact(attemptedAt="2026-10-18", answers=theirs))
    visit = support.contact(attemptedAt="2026-10-19", answers=theirs, method="VISIT")
    support.save(client, opp_id, visit)
    ours = support.contact(
        result="ABSENT", attemptedAt="2026-10-20", answers=[("WHO_FIRST", "OURS")]
    )
    support.save(client, opp_id, ours)
    support.save(client, opp_id, support.contact(result="ABSENT", attemptedAt="2026-10-21"))


@then(
    '활동 이력의 접촉 줄은 "상대가 먼저"와 "상대가 옴"으로 끝나고 '
    "우리가 건 전화에는 아무것도 붙지 않는다"
)
def activity_tails(context):
    client, opp_id = context["client"], context["opp_id"]
    rows = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    contacts = {
        row["summary"].split(" · ")[1]: row["summary"]
        for row in rows
        if row["kind"] == "CONTACT_ATTEMPT"
    }
    assert contacts == {
        "2026-10-18 전화 연결됨": "접촉 · 2026-10-18 전화 연결됨 · 상대가 먼저",
        "2026-10-19 방문 연결됨": "접촉 · 2026-10-19 방문 연결됨 · 상대가 옴",
        "2026-10-20 전화 부재": "접촉 · 2026-10-20 전화 부재",
        "2026-10-21 전화 부재": "접촉 · 2026-10-21 전화 부재",
    }
