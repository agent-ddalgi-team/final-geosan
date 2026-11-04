"""#263: 가상 회사·실제 임시 DB·API의 표시 정보 시나리오."""

from pytest_bdd import given, parsers, then, when
from sqlalchemy import func, select

from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u1.test_industry_filter import industry_env as shared_industry_env
from tests.unit.u1.test_sales_records import records_env as shared_records_env
from tests.unit.u1.test_score_state import read_display

records_env = shared_records_env
industry_env = shared_industry_env


@given(
    parsers.parse('거래 관계가 "{relation}"인 가상 회사의 평가가 있다'),
    target_fixture="state_context",
)
def evaluated_company(records_env, relation):
    client, opp_id = records_env
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.relation_status = relation
        if relation == "UNCONFIRMED":
            customer.relation_confirmed_at = None
    assert run_evaluation().ok
    before, _ = read_display(client, opp_id)
    with session_scope() as session:
        count = session.scalar(select(func.count()).select_from(EvaluationRun))
    return {"client": client, "opp_id": opp_id, "before": before, "count": count}


@when("카드와 상세의 점수 표시 정보를 읽으면")
def read_state(state_context):
    state_context["card"], state_context["header"] = read_display(
        state_context["client"], state_context["opp_id"]
    )


@then(parsers.parse('두 화면의 점수 상태는 "{state}"이고 거래 관계는 "{relation}"이다'))
def matching_state(state_context, state, relation):
    card, header = state_context["card"], state_context["header"]
    assert card["scoreState"] == header["scoreState"] == state
    assert card["relationStatus"] == header["relationStatus"] == relation
    assert header["relationConfirmedBy"] is None


@then("점수와 순위와 평가 이력은 바뀌지 않는다")
def retained_scores(state_context):
    for key in ("scoreDisplay", "scoreS", "rank", "evalId", "classificationCode"):
        assert state_context["card"][key] == state_context["before"][key]
    with session_scope() as session:
        assert (
            session.scalar(select(func.count()).select_from(EvaluationRun))
            == state_context["count"]
        )


@then(parsers.parse('두 화면의 점수 문구는 "{text}"이다'))
def numeric_score(state_context, text):
    assert state_context["card"]["scoreDisplay"] == state_context["header"]["scoreDisplay"] == text


@given(
    "거래 중인 연락 후보와 새 연락 후보와 거래 확인 전 후보를 함께 평가했다",
    target_fixture="placement_context",
)
def mixed_relations(industry_env):
    client, ids = industry_env
    with session_scope() as session:
        for opp_id, relation in zip(
            ids, ["EXISTING_CONFIRMED", "NEW_CONFIRMED", "UNCONFIRMED"], strict=True
        ):
            customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
            customer.relation_status = relation
            if relation == "UNCONFIRMED":
                customer.relation_confirmed_at = None
    assert run_evaluation().ok
    return {"client": client, "ids": ids}


@when("전체와 공정별 추천 목록을 읽는다")
def read_placements(placement_context):
    placement_context["lists"] = []
    for params in ({}, {"process": "ANODIZING"}):
        response = placement_context["client"].get("/api/v1/opportunities", params=params)
        assert response.status_code == 200
        placement_context["lists"].append(response.json()["data"])


@then("신규와 확인 전 후보 뒤에 기존 거래처가 있고 점수와 분류는 유지된다")
def existing_last(placement_context):
    existing, new, pending = placement_context["ids"]
    for cards in placement_context["lists"]:
        assert [card["oppId"] for card in cards] == [new, pending, existing]
        assert [card["rank"] for card in cards] == [1, 2, 3]
        assert [card["classificationCode"] for card in cards] == [
            "CONTACT_URGENT",
            "FILTER_PENDING",
            "CONTACT_URGENT",
        ]
        assert [card["scoreState"] for card in cards] == ["CONFIRMED", "PENDING", "CONFIRMED"]
        assert all(card["scoreDisplay"] == "77점 · 7/8" for card in cards)
        assert all(card["scoreS"] == 81.1 for card in cards)
