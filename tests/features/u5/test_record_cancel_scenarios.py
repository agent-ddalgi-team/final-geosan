"""#253: 가상 입력·실제 SQLite·실제 API로 기록 취소 뒤 현재 값을 본다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_record_cancel as support
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
scenarios("u5/record_cancel.feature")

HEADERS = {"X-Staff-Key": "park-lee"}


def dashboard(client):
    return client.get("/api/v1/dashboard", headers=HEADERS).json()["data"]


def outcome_ids(client, opp_id):
    """최신 기록부터의 영업 기록 번호."""
    return [
        item["recordId"]
        for item in support.activity(client, opp_id)
        if item["recordKind"] == "OUTCOME"
    ]


@given("평가된 가상 회사에 접촉 다음 견적·샘플 단계를 저장했다", target_fixture="context")
def two_stages(records_env):
    client, opp_id = records_env
    before = support.detail(client, opp_id)
    for status in ("IN_PROGRESS", "SAMPLE_OR_REGISTRATION_APPROVED"):
        assert records.post(client, opp_id, "outcomes", {"status": status}).status_code == 200
    assert support.detail(client, opp_id)["records"]["outcome"]["status"] == (
        "SAMPLE_OR_REGISTRATION_APPROVED"
    )
    return {"client": client, "opp_id": opp_id, "before": before, "board": dashboard(client)}


@when("박 담당이 견적·샘플 기록을 잘못 입력으로 표시하면")
def cancel_latest(context):
    client, opp_id = context["client"], context["opp_id"]
    context["cancelled_id"] = outcome_ids(client, opp_id)[0]
    context["response"] = support.cancel(client, opp_id, context["cancelled_id"])


@then("상세와 카드와 대시보드가 접촉 단계로 돌아가고 활동 이력에 취소 줄이 남으며 점수는 그대로다")
def back_to_previous(context):
    client, opp_id, before = context["client"], context["opp_id"], context["before"]
    assert context["response"].status_code == 200
    after = support.detail(client, opp_id)
    assert after["records"]["outcome"]["status"] == "IN_PROGRESS"
    assert questions.card_of(client, opp_id)["records"]["outcome"]["status"] == "IN_PROGRESS"
    assert dashboard(client) != context["board"]
    items = support.activity(client, opp_id)
    struck = next(item for item in items if item["recordId"] == context["cancelled_id"])
    assert struck["cancelled"] is True and struck["cancelledBy"] == "park-lee"
    assert [item["kind"] for item in items].count("RECORD_CANCELLED") == 1
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]


@when("박 담당이 표시한 기록을 다시 표시하고 김 과장이 박 담당의 다른 기록을 표시하면")
def cancel_twice_and_other(context):
    client, opp_id = context["client"], context["opp_id"]
    newest, oldest = outcome_ids(client, opp_id)
    assert support.cancel(client, opp_id, newest).status_code == 200
    context["again"] = support.cancel(client, opp_id, newest)
    context["other"] = support.cancel(client, opp_id, oldest, staff="kim-gwajang")


@then("다시 표시는 409이고 남의 기록은 403이며 기록은 그대로다")
def rejected(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["again"].status_code == 409
    assert context["other"].status_code == 403
    items = support.activity(client, opp_id)
    assert [item["kind"] for item in items].count("RECORD_CANCELLED") == 1
    assert support.detail(client, opp_id)["records"]["outcome"]["status"] == "IN_PROGRESS"
