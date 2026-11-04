"""#263: 가상 회사·실제 임시 DB·API의 표시 정보 시나리오."""

from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import func, select

from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u1.test_sales_records import records_env as shared_records_env
from tests.unit.u1.test_score_state import read_display

records_env = shared_records_env
scenarios("u1/score_state.feature")


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
