"""#263: 가상 회사의 점수·거래 관계 표시 정보를 실제 임시 DB·API로 읽는다."""

import pytest
from sqlalchemy import func, select

from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_industry_filter import industry_env as shared_industry_env
from tests.unit.u1.test_sales_records import records_env as shared_records_env
from tests.unit.u1.test_snapshot_ledger import _write

records_env = shared_records_env
industry_env = shared_industry_env


def read_display(client, opp_id):
    listing = client.get("/api/v1/opportunities")
    detail = client.get(f"/api/v1/opportunities/{opp_id}")
    assert listing.status_code == detail.status_code == 200
    card = next(x for x in listing.json()["data"] if x["oppId"] == opp_id)
    return card, detail.json()["data"]["header"]


@pytest.mark.parametrize(
    "relation,state",
    [
        ("UNCONFIRMED", "PENDING"),
        ("NEW_CONFIRMED", "CONFIRMED"),
        ("EXISTING_CONFIRMED", "CONFIRMED"),
    ],
)
def test_real_evaluation_exposes_relation_and_score_state(records_env, tmp_path, relation, state):
    """Given 거래 관계별 가상 평가 / When 목록·상세 조회 / Then 같은 표시 상태와 확인일을 준다."""
    client, opp_id = records_env
    factories.register_relation_check(tmp_path, "BLOCK")  # 거래 확인 전 대기 동작(#567)
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.relation_status = relation
        if relation == "UNCONFIRMED":
            customer.relation_confirmed_at = None
        confirmed_at = customer.relation_confirmed_at
    assert run_evaluation().ok
    with session_scope() as session:
        before_count = session.scalar(select(func.count()).select_from(EvaluationRun))
    card, header = read_display(client, opp_id)
    assert card["scoreState"] == header["scoreState"] == state
    assert card["relationStatus"] == header["relationStatus"] == relation
    assert header["relationConfirmedAt"] == (confirmed_at.isoformat() if confirmed_at else None)
    assert "relationConfirmedBy" in header and header["relationConfirmedBy"] is None
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == before_count
        run = session.get(EvaluationRun, card["evalId"])
        assert card["scoreS"] == run.score_s
        assert card["scoreDisplay"] == header["scoreDisplay"] == run.score_display
        assert card["classificationCode"] == run.classification_code


@pytest.mark.parametrize(
    "classification,score,state",
    [
        ("FILTER_PENDING", 0.0, "PENDING"),
        ("OPS_PENDING", 0.0, "PENDING"),
        ("CONTACT_URGENT", 0.0, "CONFIRMED"),
        ("FILTER_PENDING", None, "NONE"),
        ("CONTACT_URGENT", None, "NONE"),
    ],
)
def test_saved_zero_and_missing_scores_are_distinct(records_env, classification, score, state):
    """Given 가상 저장 결과 / When 조회 / Then 0점은 점수 있음이고 null만 점수 없음이다."""
    client, opp_id = records_env
    original, _ = read_display(client, opp_id)
    with session_scope() as session:
        run = session.get(EvaluationRun, original["evalId"])
        run.classification_code = classification
        run.score_s = score
        # #262 이전 저장분처럼 점수가 있어도 문자열이 숨겨진 상태를 시험한다.
        run.score_display = "--"
    card, header = read_display(client, opp_id)
    assert card["scoreState"] == header["scoreState"] == state
    assert card["scoreDisplay"] == header["scoreDisplay"] == "--"
    assert card["rank"] == original["rank"] and card["evalId"] == original["evalId"]


def test_latest_partial_evaluation_is_used_for_state(records_env, tmp_path):
    """Given 목록 뒤 부분 재평가 / When 조회 / Then 원래 순위와 최신 평가의 상태를 함께 준다."""
    client, opp_id = records_env
    factories.register_relation_check(tmp_path, "BLOCK")  # 거래 확인 전 대기 동작(#567)
    before, _ = read_display(client, opp_id)
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.relation_status = "UNCONFIRMED"
        customer.relation_confirmed_at = None
    result = run_evaluation([opp_id])
    assert result.ok
    card, header = read_display(client, opp_id)
    assert card["scoreState"] == header["scoreState"] == "PENDING"
    assert card["evalId"] == result.new_eval_ids[0] != before["evalId"]
    assert card["reevaluated"] and card["rank"] == before["rank"]


def test_unevaluated_detail_returns_none_state(records_env, tmp_path):
    client, _ = records_env
    case = factories.apjeong_renamed_customer("no-score", name="가상평가전")
    case["customer"]["bizNumber"] = None
    opp_id = import_case(_write(tmp_path, "no-score.json", case)).opp_id
    response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["evalId"] is None and data["scores"] is None
    assert data["header"]["scoreState"] == "NONE"
    assert data["header"]["scoreDisplay"] == "--"
    assert data["header"]["relationConfirmedBy"] is None
    assert opp_id not in {x["oppId"] for x in client.get("/api/v1/opportunities").json()["data"]}


def test_company_states_are_isolated_across_pages_and_filters(industry_env):
    client, ids = industry_env
    baseline = client.get("/api/v1/opportunities").json()["data"]
    statuses = dict(zip(ids, ["NEW_CONFIRMED", "UNCONFIRMED", "EXISTING_CONFIRMED"], strict=True))
    expected = {}
    with session_scope() as session:
        for index, opp_id in enumerate(ids):
            customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
            customer.relation_status = statuses[opp_id]
            run = session.scalar(select(EvaluationRun).where(EvaluationRun.opp_id == opp_id))
            run.classification_code = "FILTER_PENDING" if index == 1 else "CONTACT_URGENT"
            run.score_s = None if index == 2 else run.score_s
            expected[opp_id] = ["CONFIRMED", "PENDING", "NONE"][index]
    listing = client.get("/api/v1/opportunities").json()["data"]
    assert [x["oppId"] for x in listing] == [x["oppId"] for x in baseline]
    for page, card in enumerate(listing, start=1):
        assert card["scoreState"] == expected[card["oppId"]]
        assert card["relationStatus"] == statuses[card["oppId"]]
        assert client.get("/api/v1/opportunities", params={"pageSize": 1, "page": page}).json()[
            "data"
        ] == [card]
    filtered = client.get("/api/v1/opportunities", params={"industry": "반도체"}).json()["data"]
    assert [x["oppId"] for x in filtered] == [ids[0]]
    assert filtered[0]["scoreState"] == expected[ids[0]]


def test_relation_check_ignore_keeps_unconfirmed_score_confirmed(records_env):
    """Given 예시 설정(거래 관계 확인 끔) / When 확인 전으로 재평가 / Then 대기가 아니다 (#567)."""
    client, opp_id = records_env
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.relation_status = "UNCONFIRMED"
        customer.relation_confirmed_at = None
    assert run_evaluation().ok
    card, header = read_display(client, opp_id)
    assert card["relationStatus"] == header["relationStatus"] == "UNCONFIRMED"
    assert card["scoreState"] == header["scoreState"] == "CONFIRMED"
    assert card["classificationCode"] != "FILTER_PENDING"
