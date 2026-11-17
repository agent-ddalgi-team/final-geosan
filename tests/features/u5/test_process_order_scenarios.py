"""#406: 실제 임시 DB와 API의 공정 파일 재투입 시나리오."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_process_order as support

process_env = support.process_env
scenarios("u5/process_order.feature")


@given("공정 아홉 종류와 평가된 가상 회사 세 곳이 있다", target_fixture="order_context")
def prepared(process_env):
    client, _, capability = process_env
    before = client.get("/api/v1/opportunities").json()
    return client, support.reordered_capability(capability), before


@when("공정 순서를 바꾼 파일을 같은 저장 시각으로 다시 넣는다")
def reimported(order_context, tmp_path):
    _, capability, _ = order_context
    support.reimport_with_shared_times(capability, tmp_path, len(capability["processes"]))


@then("모든 공정과 빈 공정이 파일 순서대로 보이고 기존 회사 결과는 유지된다")
def preserved(order_context):
    client, capability, before = order_context
    after = client.get("/api/v1/opportunities").json()
    counts = after["meta"]["processCounts"]
    assert [row["processCode"] for row in counts] == [
        row["code"] for row in capability["processes"]
    ]
    assert len(counts) == 9
    assert sum(row["count"] == 0 for row in counts) == 7
    assert [(row["oppId"], row["evalId"], row["scoreDisplay"]) for row in after["data"]] == [
        (row["oppId"], row["evalId"], row["scoreDisplay"]) for row in before["data"]
    ]
