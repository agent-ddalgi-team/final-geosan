"""#209 추가 S10 시나리오. 임시 DB·실제 API·실제 규칙 엔진을 사용한다."""

from datetime import date

from pytest_bdd import given, parsers, then, when

from geosan.api.routes import records
from tests.unit.u1.test_industry_filter import industry_env  # noqa: F401
from tests.unit.u1.test_region_filter import region_env  # noqa: F401
from tests.unit.u1.test_sales_records import post, set_test_phone
from tests.unit.u1.test_sales_records import records_env as sales_env  # noqa: F401


@when(
    parsers.parse("{state} 평가 번호로 영업 기록과 메모를 저장하면"),
    target_fixture="viewed_records",
)
def save_records_with_viewed_evaluation(record_context, tmp_path, state):
    from geosan.opportunity.importer import import_case
    from geosan.workflows.flow_evaluate import run_evaluation
    from tests import factories
    from tests.unit.u1.test_record_evaluation import body_for, viewed_evaluation
    from tests.unit.u1.test_snapshot_ledger import _write

    client, opp_id, _ = record_context
    eval_id = viewed_evaluation(client, opp_id)
    if state == "낡은":
        assert run_evaluation().ok
        assert viewed_evaluation(client, opp_id) != eval_id
    elif state == "다른 회사":
        case = factories.apjeong_case()
        case["caseId"] = "scenario-other"
        case["customer"]["name"] = "가상 다른 회사"
        other = import_case(_write(tmp_path, "other.json", case))
        assert run_evaluation().ok
        eval_id = viewed_evaluation(client, other.opp_id)
    elif state == "없는":
        eval_id = None
    # 재평가는 판정 행 번호를 새로 만든다. 기록 저장 직전과 직후를 비교한다.
    scores_before_save = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"]
    responses = [
        post(client, opp_id, kind, body_for(kind, eval_id)) for kind in ("outcomes", "notes")
    ]
    return responses, eval_id, scores_before_save


@then(parsers.parse("{result} 결과이고 당시 평가 번호 저장 규칙을 지킨다"))
def verify_records_viewed_evaluation(record_context, viewed_records, result):
    from sqlalchemy import select

    from geosan.records.models import Bookmark, Note, Outcome
    from geosan.storage.session import session_scope

    client, opp_id, _ = record_context
    responses, eval_id, scores = viewed_records
    expected_status = 400 if result == "거부" else 200
    assert [response.status_code for response in responses] == [expected_status, expected_status]
    with session_scope() as session:
        for model in (Outcome, Note):
            rows = session.scalars(select(model).where(model.opp_id == opp_id)).all()
            assert [row.eval_id for row in rows] == ([] if result == "거부" else [eval_id])
        if result == "거부":
            assert session.scalar(select(Bookmark)) is None
    assert client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"] == scores


@given("영업 기록용 가상 기회를 평가했다", target_fixture="record_context")
def evaluated_opportunity(sales_env):  # noqa: F811
    client, opp_id = sales_env
    scores = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["scores"]
    return client, opp_id, scores


@when("내일 날짜의 접촉 기록을 저장하면", target_fixture="future_contact_result")
def save_future_contact(record_context, monkeypatch):
    client, opp_id, _ = record_context
    monkeypatch.setattr(records, "today_in_seoul", lambda: date(2026, 11, 8))
    return post(
        client,
        opp_id,
        "outcomes",
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "ABSENT",
            "attemptedAt": "2026-11-09",
        },
    )


@then("접촉 날짜 안내가 나오고 기록과 점수는 그대로다")
def verify_future_contact_not_saved(record_context, future_contact_result):
    client, opp_id, scores = record_context
    assert future_contact_result.status_code == 400
    assert future_contact_result.json()["error"]["fields"] == [
        {
            "path": "attemptedAt",
            "message": "앞으로 할 일은 다음 일정에 적어 주세요. 접촉 날짜는 오늘까지입니다.",
        }
    ]
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"] is None
    assert detail["records"]["contactCount"]["total"] == 0
    assert detail["scores"] == scores


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
