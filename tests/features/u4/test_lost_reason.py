from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_records as support
from tests.unit.u1.test_sales_records import post

records_env = support.records_env

scenarios("u4/lost_reason.feature")


@given("가상 회사가 평가되어 있다", target_fixture="company")
def company(records_env):
    client, opp_id = records_env
    url = f"/api/v1/opportunities/{opp_id}"
    return client, opp_id, client.get(url).json()["data"]


@when("거절 이유로 가격을 저장한다")
def save_price(company):
    client, opp_id, _ = company
    assert (
        post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"}).status_code
        == 200
    )


@then("상세에는 가격 코드가 보이고 활동에는 거절 가격이 남는다")
def price_is_visible(company):
    client, opp_id, _ = company
    url = f"/api/v1/opportunities/{opp_id}"
    assert client.get(url).json()["data"]["records"]["outcome"]["lostReasonCode"] == "PRICE"
    assert client.get(url + "/activity").json()["data"][0]["summary"] == "거절 · 가격"


@then("점수와 평가 번호는 바뀌지 않는다")
def evaluation_is_unchanged(company):
    client, opp_id, before = company
    after = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert (after["scores"], after["evalId"]) == (before["scores"], before["evalId"])


@when("기타 이유를 고르고 설명 없이 저장한다", target_fixture="rejected")
def save_empty_other(company):
    client, opp_id, _ = company
    return post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "OTHER"})


@then("입력 오류이며 거절 기록은 생기지 않는다")
def no_record(rejected):
    assert rejected.status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0
