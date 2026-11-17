"""#265 시나리오: 가상 입력과 실제 임시 DB·API·평가 엔진을 사용한다."""

from pytest_bdd import given, then, when

from geosan.opportunity.importer import import_case
from geosan.workflows import flow_evaluate
from tests.unit.u1.test_customer_relation import (
    detail,
    relation_env,  # noqa: F401
    save,
    stored_rows,
)


@given("거래 관계가 확인 전인 가상 기회를 평가했다", target_fixture="relation_context")
def evaluated_relation(relation_env):  # noqa: F811
    client, opp_id, path = relation_env
    return {"client": client, "opp_id": opp_id, "path": path}


@when("담당자가 거래 중과 거래 없음과 확인 전을 차례로 저장하면")
def change_each_direction(relation_context):
    ctx = relation_context
    ctx["saves"] = []
    for status in ["EXISTING_CONFIRMED", "NEW_CONFIRMED", "UNCONFIRMED"]:
        before = detail(ctx["client"], ctx["opp_id"])
        response = save(ctx["client"], ctx["opp_id"], status, before["evalId"])
        assert response.status_code == 200
        ctx["saves"].append((before["evalId"], response.json()["data"]["evalId"]))


@then("각 저장마다 새 평가와 거래 관계 변경 이력이 남는다")
def saved_history(relation_context):
    ctx = relation_context
    assert all(old != new for old, new in ctx["saves"])
    data = detail(ctx["client"], ctx["opp_id"])
    assert data["header"]["relationStatus"] == "UNCONFIRMED"
    assert data["header"]["classificationCode"] == "FILTER_PENDING"
    activity = ctx["client"].get(f"/api/v1/opportunities/{ctx['opp_id']}/activity").json()["data"]
    assert len([row for row in activity if row["kind"] == "RELATION_CONFIRMED"]) == 3


@when("담당자가 거래 중으로 저장한 뒤 원래 사례 파일을 다시 넣으면")
def reimport_original(relation_context):
    ctx = relation_context
    response = save(
        ctx["client"],
        ctx["opp_id"],
        "EXISTING_CONFIRMED",
        detail(ctx["client"], ctx["opp_id"])["evalId"],
    )
    assert response.status_code == 200
    ctx["import_result"] = import_case(ctx["path"])


@then("거래 중과 확인 담당자는 유지되고 파일 값 무시 안내가 나온다")
def relation_preserved(relation_context):
    ctx = relation_context
    header = detail(ctx["client"], ctx["opp_id"])["header"]
    assert header["relationStatus"] == "EXISTING_CONFIRMED"
    assert header["relationConfirmedBy"] == "park-lee"
    assert any("담당자가 입력한 값을 유지" in warning for warning in ctx["import_result"].warnings)


@when("거래 관계 변경 뒤 평가 저장 도중 오류가 나면")
def fail_relation_save(relation_context, monkeypatch):
    ctx = relation_context
    ctx["before"] = stored_rows()
    original = flow_evaluate.save_evaluation

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("가상 평가 저장 실패")

    monkeypatch.setattr(flow_evaluate, "save_evaluation", fail)
    ctx["response"] = save(
        ctx["client"],
        ctx["opp_id"],
        "EXISTING_CONFIRMED",
        detail(ctx["client"], ctx["opp_id"])["evalId"],
    )


@then("거래 관계와 평가와 변경 이력이 변경 전 그대로다")
def all_rolled_back(relation_context):
    assert relation_context["response"].status_code == 500
    assert stored_rows() == relation_context["before"]
