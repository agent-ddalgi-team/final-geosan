"""#363: 가상 입력·실제 SQLite·실제 API의 확인 줄과 평가 전 체크 거부."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.evaluation.models import EvaluationRun
from geosan.records.models import ReviewCheck
from geosan.storage.session import session_scope
from tests.unit.u1 import test_own_plating_review as support

records_env = support.records_env
unevaluated_env = support.unevaluated_env
scenarios("u5/own_plating_review.feature")


@given("평가된 가상 회사에 AI 표면처리 표시가 붙었다", target_fixture="review_context")
def evaluated(records_env):
    client, opp_id = records_env
    before = support.detail(client, opp_id)
    support.set_flag(opp_id)
    return client, opp_id, before


@when("담당자가 표면처리 확인 줄을 체크한다", target_fixture="check_response")
def checked(review_context):
    client, opp_id, before = review_context
    return support.save_check(client, opp_id, support.ITEM_ID, before["evalId"], True)


@then("기존 검토사항과 점수는 그대로이고 마지막 확인 줄에 체크가 남는다")
def saved(review_context, check_response):
    client, opp_id, before = review_context
    assert check_response.status_code == 200
    after = support.detail(client, opp_id)
    item = support.flagged_item(after)
    assert after["reviewItems"][:-1] == before["reviewItems"]
    assert item["source"] == "AI" and item["text"] == f"{support.LABEL}: {support.BASIS}"
    assert item["checked"] is True and item["checkedBy"] == "park-lee"
    assert item["checkedAt"] == check_response.json()["data"]["checkedAt"]
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]


@given("평가하지 않은 가상 회사에 업종명 표면처리 표시가 붙었다", target_fixture="pending_context")
def unevaluated(unevaluated_env):
    client, opp_id = unevaluated_env
    support.set_flag(opp_id, basis=None, source="INDUSTRY_NAME")
    return client, opp_id


@when("담당자가 확인 줄을 읽고 평가 없이 체크를 요청한다", target_fixture="pending_response")
def request_pending(pending_context):
    client, opp_id = pending_context
    data = support.detail(client, opp_id)
    response = support.save_check(client, opp_id, support.ITEM_ID, None, True)
    return data, response


@then("규칙 출처의 확인 줄이 보이고 평가와 체크 기록은 생기지 않는다")
def refused(pending_response):
    data, response = pending_response
    item = support.flagged_item(data)
    assert data["evalId"] is None and data["scores"] is None
    assert item["source"] == "RULE" and item["text"] == support.LABEL
    assert item["checked"] is False and response.status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 0
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == 0
