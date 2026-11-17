"""#259: 가상 입력·실제 SQLite·실제 API로 자료 줄 메모를 본다. 외부 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_gap_note as support
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
scenarios("u5/gap_note.feature")


@given("평가된 가상 회사의 검토사항에 자료 줄이 있다", target_fixture="context")
def gap_line(records_env):
    client, opp_id = records_env
    before = support.detail(client, opp_id)
    return {
        "client": client,
        "opp_id": opp_id,
        "before": before,
        "gap": support.gap_item(client, opp_id),
    }


@when("박 담당이 그 줄에 자료 조사 메모를 두 번 붙이면")
def save_twice(context):
    client, opp_id, gap = context["client"], context["opp_id"], context["gap"]
    for text in ("첫 자료(가상)", "다시 찾은 자료(가상)"):
        assert support.save(client, opp_id, gap["itemId"], text).status_code == 200


@then("그 줄에는 최신 메모만 보이고 활동 이력에는 두 줄이 남으며 점수는 그대로다")
def latest_only(context):
    client, opp_id, gap = context["client"], context["opp_id"], context["gap"]
    assert support.item_of(client, opp_id, gap["itemId"])["note"]["text"] == "다시 찾은 자료(가상)"
    notes = [x for x in support.activity(client, opp_id) if x["kind"] == "NOTE"]
    assert len(notes) == 2 and all(gap["text"] in x["summary"] for x in notes)
    after = support.detail(client, opp_id)
    assert after["scores"] == context["before"]["scores"]
    assert after["evalId"] == context["before"]["evalId"]


@when("박 담당이 질문 줄과 없는 줄에 자료 조사 메모를 붙이면")
def save_wrong_lines(context):
    client, opp_id = context["client"], context["opp_id"]
    context["question"] = support.save(client, opp_id, "Q:any", "가상 메모")
    context["missing"] = support.save(client, opp_id, "GAP:REQ:none", "가상 메모")


@then("질문 줄은 400이고 없는 줄은 404이며 저장된 메모는 없다")
def rejected(context):
    client, opp_id = context["client"], context["opp_id"]
    assert context["question"].status_code == 400
    assert context["missing"].status_code == 404
    assert support.activity(client, opp_id) == []
