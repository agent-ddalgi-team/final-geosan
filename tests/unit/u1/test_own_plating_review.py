"""#363: 실제 임시 DB·API로 표시 줄과 기존 체크 저장을 확인한다. 외부 호출 없음."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import ReviewCheck
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_review_checks import detail, save_check
from tests.unit.u1.test_sales_records import records_env as sales_env
from tests.unit.u1.test_snapshot_ledger import _write

records_env = sales_env
ITEM_ID = "FLAG:OWN_PLATING_LINE_SUSPECTED"
LABEL = "표면처리를 직접 하는 회사일 수 있음"
BASIS = "생산품 '알루미늄 아노다이징'"


def set_flag(opp_id, *, suspected=True, basis=BASIS, source="AI"):
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id)
        customer.own_plating_line_suspected = suspected
        customer.own_plating_line_basis = basis
        customer.own_plating_line_source = source


def flagged_item(data):
    rows = [item for item in data["reviewItems"] if item["itemId"] == ITEM_ID]
    assert len(rows) == 1
    return rows[0]


@pytest.mark.parametrize("source,expected", [("AI", "AI"), ("INDUSTRY_NAME", "RULE")])
@pytest.mark.parametrize("basis", [BASIS, None, ""])
def test_flag_appends_one_line_with_approved_text_and_source(records_env, source, expected, basis):
    client, opp_id = records_env
    before = detail(client, opp_id)
    set_flag(opp_id, source=source, basis=basis)
    after = detail(client, opp_id)
    item = flagged_item(after)
    assert after["reviewItems"][:-1] == before["reviewItems"]
    assert item["kind"] == "OWN_PLATING_LINE_SUSPECTED"
    assert item["source"] == expected
    assert item["text"] == (f"{LABEL}: {basis}" if basis else LABEL)
    assert item["targetLabel"] is None
    assert item["checked"] is False and item["checkedBy"] is None and item["checkedAt"] is None
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]


def test_false_flag_leaves_existing_items_and_check_history_unchanged(records_env):
    client, opp_id = records_env
    before = detail(client, opp_id)
    set_flag(opp_id, suspected=False)
    after = detail(client, opp_id)
    assert after["reviewItems"] == before["reviewItems"]
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 0


def test_check_and_uncheck_reuse_existing_storage_without_changing_scores_or_order(records_env):
    client, opp_id = records_env
    set_flag(opp_id)
    before = detail(client, opp_id)
    cards = client.get("/api/v1/opportunities").json()["data"]
    checked = save_check(client, opp_id, ITEM_ID, before["evalId"], True)
    assert checked.status_code == 200
    assert flagged_item(detail(client, opp_id))["checked"] is True
    unchecked = save_check(client, opp_id, ITEM_ID, before["evalId"], False, "kim-gwajang")
    assert unchecked.status_code == 200
    after = detail(client, opp_id)
    item = flagged_item(after)
    assert item["checked"] is False and item["checkedBy"] == "kim-gwajang"
    assert item["checkedAt"] == unchecked.json()["data"]["checkedAt"]
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]
    assert after["header"] == before["header"]
    assert client.get("/api/v1/opportunities").json()["data"] == cards
    with session_scope() as session:
        rows = session.scalars(select(ReviewCheck).where(ReviewCheck.item_id == ITEM_ID)).all()
        assert len(rows) == 2 and {row.checked for row in rows} == {True, False}
        assert {row.eval_id for row in rows} == {before["evalId"]}


def test_basis_and_evaluation_changes_keep_the_same_item_id_and_checked_state(records_env):
    client, opp_id = records_env
    set_flag(opp_id)
    before = detail(client, opp_id)
    assert save_check(client, opp_id, ITEM_ID, before["evalId"], True).status_code == 200
    set_flag(opp_id, basis="업종명 '도금업'", source="INDUSTRY_NAME")
    assert run_evaluation(opp_ids=[opp_id]).ok
    after = detail(client, opp_id)
    assert after["evalId"] != before["evalId"]
    item = flagged_item(after)
    assert item["checked"] is True and item["checkedBy"] == "park-lee"
    assert item["source"] == "RULE" and item["text"] == f"{LABEL}: 업종명 '도금업'"
    assert after["scores"]["batchId"] != before["scores"]["batchId"]
    # 재평가는 새 회차·시각을 남긴다. 점수와 판정 내용은 그대로여야 한다.
    for name, value in before["scores"].items():
        if name not in {"batchId", "evaluatedAt"}:
            assert after["scores"][name] == value


def test_removed_flag_hides_line_and_rejects_check_but_retains_history(records_env):
    client, opp_id = records_env
    set_flag(opp_id)
    before = detail(client, opp_id)
    assert save_check(client, opp_id, ITEM_ID, before["evalId"], True).status_code == 200
    set_flag(opp_id, suspected=False)
    assert all(item["itemId"] != ITEM_ID for item in detail(client, opp_id)["reviewItems"])
    assert save_check(client, opp_id, ITEM_ID, before["evalId"], False).status_code == 404
    set_flag(opp_id)
    assert flagged_item(detail(client, opp_id))["checked"] is True
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 1


@pytest.fixture
def unevaluated_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    result = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    set_flag(result.opp_id)
    with TestClient(create_app()) as client:
        yield client, result.opp_id


def test_unevaluated_company_shows_line_but_cannot_save_a_check(unevaluated_env):
    client, opp_id = unevaluated_env
    data = detail(client, opp_id)
    assert data["evalId"] is None and data["scores"] is None
    assert flagged_item(data)["checked"] is False
    for body in (
        {"checked": True},
        {"checked": True, "evalId": None},
        {"checked": True, "evalId": "made-up-evaluation"},
    ):
        response = client.post(
            f"/api/v1/opportunities/{opp_id}/review-items/{ITEM_ID}/check",
            json=body,
            headers={"X-Staff-Key": "park-lee"},
        )
        assert response.status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ReviewCheck)) == 0
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == 0


@pytest.mark.parametrize("source", [None, "UNRECOGNIZED"])
def test_unknown_source_is_not_silently_relabelled_as_a_rule(records_env, source):
    client, opp_id = records_env
    set_flag(opp_id, source=source)
    response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 500
    assert "출처" in response.json()["error"]["message"]
    assert "UNRECOGNIZED" not in response.text
