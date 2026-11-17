"""실제 임시 SQLite·API로 질문 답 저장 시나리오를 검증한다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.questions.models import ConfirmationQuestion
from geosan.records.models import Note
from geosan.storage.session import session_scope
from tests.unit.u1 import test_question_reply as support

records_env = support.records_env
reply_env = support.reply_env
scenarios("u4/question_reply.feature")


@given("같은 확인 질문이 가상 회사 두 곳에 연결되어 있다")
def shared_question(reply_env):
    client, opp_id, other_id, question_id = reply_env
    for company in (opp_id, other_id):
        item = next(
            row
            for row in support.detail(client, company)["reviewItems"]
            if row["itemId"] == f"Q:{question_id}"
        )
        assert item["replyText"] is None and item["repliedBy"] is None


@when("담당자가 질문 답을 두 번 저장한다")
def save_twice(reply_env):
    client, _, _, question_id = reply_env
    assert support.reply(client, question_id, "가상 첫 답").status_code == 200
    assert support.reply(client, question_id, "가상 최신 답").status_code == 200


@then("두 회사에는 최신 답과 이전 답 이력이 함께 보인다")
def latest_and_history(reply_env):
    client, opp_id, other_id, question_id = reply_env
    for company in (opp_id, other_id):
        item = next(
            row
            for row in support.detail(client, company)["reviewItems"]
            if row["itemId"] == f"Q:{question_id}"
        )
        assert item["replyText"] == "가상 최신 답" and item["repliedBy"] == "park-lee"
        history = client.get(f"/api/v1/opportunities/{company}/activity").json()["data"]
        answers = [row for row in history if row["kind"] == "REPLY"]
        assert len(answers) == 2
        assert any("가상 첫 답" in row["summary"] for row in answers)
        assert any("가상 최신 답" in row["summary"] for row in answers)


@when("보기 전용 담당자가 답 저장을 시도한다")
def viewer(reply_env):
    client, _, _, question_id = reply_env
    assert support.reply(client, question_id, staff="viewer").status_code == 403


@then("답과 답 이력이 모두 저장되지 않는다")
def nothing_saved(reply_env):
    _, _, _, question_id = reply_env
    with session_scope() as session:
        assert session.get(ConfirmationQuestion, question_id).reply_text is None
        assert session.scalar(select(func.count()).select_from(Note)) == 0
