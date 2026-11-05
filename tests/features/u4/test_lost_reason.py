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


@given("기타 이유에 가상 조건 불일치 설명을 저장했다")
def saved_other(company):
    client, opp_id, _ = company
    result = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 조건 불일치"},
    )
    assert result.status_code == 200


@when("같은 기타 이유로 설명 없이 다음 일정을 저장한다")
def save_schedule(company):
    client, opp_id, _ = company
    result = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "OTHER", "nextScheduleAt": "2026-11-12"},
    )
    assert result.status_code == 200


@then("이전 설명과 새 일정이 함께 저장되고 이력은 두 줄이다")
def explanation_and_schedule_are_saved(company):
    client, opp_id, _ = company
    with session_scope() as session:
        rows = list(
            session.scalars(
                select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version)
            )
        )
        assert [row.reason for row in rows] == ["가상 조건 불일치", "가상 조건 불일치"]
        assert rows[1].next_schedule_at.isoformat() == "2026-11-12"
    assert len(client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]) == 2


@given("가격 이유에 가상 가격 설명을 저장했다")
def saved_price(company):
    client, opp_id, _ = company
    result = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "PRICE", "reason": "가상 가격 설명"},
    )
    assert result.status_code == 200


@then("입력 오류이며 이전 가격 이유만 남아 있다")
def only_previous_price_remains(rejected):
    assert rejected.status_code == 400
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome)))
        assert len(rows) == 1 and rows[0].lost_reason_code == "PRICE"
