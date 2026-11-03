"""#209 추가 S10 시나리오. 임시 DB·실제 API·실제 규칙 엔진을 사용한다."""

from pytest_bdd import given, then, when

from tests.unit.u1.test_sales_records import post
from tests.unit.u1.test_sales_records import records_env as sales_env  # noqa: F401


@given("영업 기록용 가상 기회를 평가했다", target_fixture="record_context")
def evaluated_opportunity(sales_env):  # noqa: F811
    client, opp_id = sales_env
    scores = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"]
    return client, opp_id, scores


@when("관심 단계와 가상 영업 메모를 저장하면")
def save_interest_and_note(record_context):
    client, opp_id, _ = record_context
    assert post(client, opp_id, "outcomes", {"status": "INTERESTED"}).status_code == 200
    assert (
        post(client, opp_id, "notes", {"text": "가상 상담 sales@example.invalid"}).status_code
        == 200
    )


@then("관심 목록과 활동 이력에서 기록을 확인하고 점수는 그대로다")
def verify_saved_records(record_context):
    client, opp_id, scores = record_context
    assert client.get("/api/v1/opportunities?stage=INTERESTED").json()["data"][0]["oppId"] == opp_id
    activities = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert {item["kind"] for item in activities} >= {"NOTE", "OUTCOME"}
    assert client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"] == scores
