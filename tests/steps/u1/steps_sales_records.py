"""#209 추가 S10 시나리오. 임시 DB·실제 API·실제 규칙 엔진을 사용한다."""

from pytest_bdd import given, then, when

from tests.unit.u1.test_industry_filter import industry_env  # noqa: F401
from tests.unit.u1.test_region_filter import region_env  # noqa: F401
from tests.unit.u1.test_sales_records import post, set_test_phone
from tests.unit.u1.test_sales_records import records_env as sales_env  # noqa: F401


@given("영업 기록용 가상 기회를 평가했다", target_fixture="record_context")
def evaluated_opportunity(sales_env):  # noqa: F811
    client, opp_id = sales_env
    scores = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"]
    return client, opp_id, scores


@when("추천 목록 카드를 조회하면")
def read_record_card(record_context):
    client, _, _ = record_context
    assert client.get("/api/v1/opportunities").status_code == 200


@then("카드의 영업 단계는 null이다")
def verify_card_without_outcome(record_context):
    client, opp_id, _ = record_context
    card = client.get("/api/v1/opportunities").json()["data"][0]
    assert card["oppId"] == opp_id
    assert card["records"]["outcome"] is None


@when("미접촉 다음에 접촉 단계를 저장하면")
def save_two_stages(record_context):
    client, opp_id, _ = record_context
    for status in ("NOT_EXECUTED", "IN_PROGRESS"):
        assert post(client, opp_id, "outcomes", {"status": status}).status_code == 200


@then("카드와 상세에 접촉 단계가 보이고 점수는 그대로다")
def verify_card_latest_outcome(record_context):
    client, opp_id, scores = record_context
    card = client.get("/api/v1/opportunities").json()["data"][0]
    assert card["oppId"] == opp_id
    assert card["records"]["outcome"] == {"status": "IN_PROGRESS"}
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"]["status"] == "IN_PROGRESS"
    assert detail["scores"] == scores


@when("접촉 단계와 가상 영업 메모를 저장하면")
def save_stage_and_note(record_context):
    client, opp_id, _ = record_context
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {
                "status": "IN_PROGRESS",
                "nextScheduleAt": "2026-11-12",
                "nextScheduleNote": "견적 준비",
            },
        ).status_code
        == 200
    )
    assert (
        post(client, opp_id, "notes", {"text": "가상 상담 sales@example.invalid"}).status_code
        == 200
    )


@then("관심 목록과 활동 이력에서 기록을 확인하고 점수는 그대로다")
def verify_saved_records(record_context):
    client, opp_id, scores = record_context
    # 기록을 남긴 회사는 자동으로 관심 목록에 들고(#356), 단계로 걸러도 보인다.
    for query in ("bookmarked=true", "stage=IN_PROGRESS"):
        listed = client.get(f"/api/v1/opportunities?{query}").json()["data"]
        assert [card["oppId"] for card in listed] == [opp_id], query
    activities = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert {item["kind"] for item in activities} >= {"NOTE", "OUTCOME"}
    assert client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"] == scores
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"]["nextScheduleNote"] == "견적 준비"
    assert client.get("/api/v1/config/ui").json()["data"]["records"] == {
        "approvalEnabled": False,
        "noteMaxLength": 200,
    }


@when("가상 대표번호를 확인하고 자료 조사와 전화 시도를 저장하면")
def save_phone_and_research(record_context):
    client, opp_id, _ = record_context
    set_test_phone(opp_id)
    assert (
        post(client, opp_id, "main-phone/confirm", {"expectedPhone": "041-000-0000"}).status_code
        == 200
    )
    assert (
        post(client, opp_id, "notes", {"kind": "RESEARCH", "text": "가상 자료 조사"}).status_code
        == 200
    )
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {
                "status": "IN_PROGRESS",
                "method": "CALL",
                "result": "ABSENT",
                "attemptedAt": "2026-11-03",
            },
        ).status_code
        == 200
    )


@then("확인 정보와 전화 한 건이 보이고 자료 조사는 횟수에 포함되지 않는다")
def verify_phone_and_counts(record_context):
    client, opp_id, scores = record_context
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["header"]["mainPhoneConfirmedBy"] == "park-lee"
    assert detail["records"]["contactCount"] == {"total": 1, "call": 1, "email": 0, "visit": 0}
    assert detail["scores"] == scores


@given("여러 산업군의 가상 회사 기회를 평가했다", target_fixture="filter_context")
def evaluated_industries(industry_env):  # noqa: F811
    client, ids = industry_env
    original = client.get("/api/v1/opportunities").json()
    return {"client": client, "ids": ids, "original": original}


@when("아노다이징과 반도체를 함께 선택하면")
def select_process_industry(filter_context):
    response = filter_context["client"].get(
        "/api/v1/opportunities", params={"process": "ANODIZING", "industry": "반도체"}
    )
    assert response.status_code == 200
    filter_context["response"] = response.json()


@then("해당 회사만 공정 안 첫 순위로 보이고 점수는 그대로다")
def verify_process_industry(filter_context):
    result = filter_context["response"]
    assert len(result["data"]) == result["meta"]["total"] == 1
    card = result["data"][0]
    assert card["oppId"] == filter_context["ids"][0]
    assert card["rank"] == 1
    original = next(
        row for row in filter_context["original"]["data"] if row["oppId"] == card["oppId"]
    )
    assert card["scoreDisplay"] == original["scoreDisplay"]
    assert card["classificationCode"] == original["classificationCode"]


@given("여러 지역의 가상 회사 기회를 평가했다", target_fixture="region_context")
def evaluated_regions(region_env):  # noqa: F811
    client, ids, _ = region_env
    return {"client": client, "ids": ids, "original": client.get("/api/v1/opportunities").json()}


@when("천안 인근과 아노다이징 및 반도체를 함께 선택하면")
def select_region_filters(region_context):
    response = region_context["client"].get(
        "/api/v1/opportunities",
        params={"region": "천안 인근", "process": "ANODIZING", "industry": "반도체"},
    )
    assert response.status_code == 200
    region_context["response"] = response.json()


@then("천안의 가상 회사만 보이고 기존 점수는 그대로다")
def verify_region_filters(region_context):
    data = region_context["response"]["data"]
    assert len(data) == 1
    assert data[0]["oppId"] == region_context["ids"][0]
    assert data[0]["region"] == "천안시" and data[0]["rank"] == 1
    original = next(
        row for row in region_context["original"]["data"] if row["oppId"] == data[0]["oppId"]
    )
    assert data[0]["scoreDisplay"] == original["scoreDisplay"]
    assert data[0]["classificationCode"] == original["classificationCode"]
