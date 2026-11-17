"""#227: 가상 회사·실제 임시 DB·API의 검토사항 체크 흐름."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.records.models import ReviewCheck
from geosan.storage.session import session_scope
from tests.unit.u1.test_review_checks import detail, save_check
from tests.unit.u1.test_sales_records import records_env as sales_env

records_env = sales_env
scenarios("u5/review_checks.feature")


@given("검토사항이 있는 가상 회사를 평가했다", target_fixture="review_context")
def evaluated_review(records_env):
    client, opp_id = records_env
    data = detail(client, opp_id)
    return client, opp_id, data


@when("영업 담당자가 체크하고 검수 담당자가 체크를 해제하면")
def change_checks(review_context):
    client, opp_id, data = review_context
    item_id = data["reviewItems"][0]["itemId"]
    assert save_check(client, opp_id, item_id, data["evalId"], True).status_code == 200
    assert (
        save_check(client, opp_id, item_id, data["evalId"], False, "kim-gwajang").status_code == 200
    )


@then("해제 상태와 담당자가 보이고 두 이력과 점수는 보존된다")
def verify_check_history(review_context):
    client, opp_id, before = review_context
    after = detail(client, opp_id)
    item = next(
        x for x in after["reviewItems"] if x["itemId"] == before["reviewItems"][0]["itemId"]
    )
    assert item["checked"] is False
    assert item["checkedBy"] == "kim-gwajang" and item["checkedAt"]
    assert after["scores"] == before["scores"]
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck)).all()
        assert len(rows) == 2 and {x.checked for x in rows} == {True, False}
        assert {x.eval_id for x in rows} == {before["evalId"]}
