"""#477: 검수 전환 → 공개 후보 등록의 실제 DB·API 연결, 외부 AI 호출 없음."""

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.candidate_registration import RegistrationResult
from geosan.opportunity.models import Customer, MergeCandidate, Opportunity
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_registration import rows, snapshot
from tests.unit.u3.test_registration_after_review import listed, register_ids
from tests.unit.u3.test_registration_after_review import (
    reviewed_registration as reviewed_registration,
)

scenarios("u3/registration_after_review.feature")


@given("기존 18곳을 투입하고 실제 검수 전환 명령을 실행했다", target_fixture="state")
def prepared(reviewed_registration):
    with TestClient(create_app()) as client:
        cards = listed(client)
    return {
        "ids": reviewed_registration,
        "cards": cards,
        "before": {model: snapshot(model) for model in (Customer, Opportunity, EvaluationRun)},
    }


@when("같은 이름과 주소의 공개 공장 18곳을 등록한다")
def exact(state):
    state["result"] = register_ids(state["ids"])


@then("새 회사는 없고 기존 18곳의 원본과 평가 및 순위가 그대로다")
def preserved(state):
    assert state["result"] == RegistrationResult(0, 18, 0)
    assert {model: snapshot(model) for model in state["before"]} == state["before"]
    with TestClient(create_app()) as client:
        assert listed(client) == state["cards"]
    assert not rows(MergeCandidate)


@when("같은 주소에 다른 이름인 공개 공장 한 곳을 등록한다")
def partial(state):
    row_id = state["ids"][0]
    with session_scope() as session:
        row = session.get(SourceFactoryRow, row_id)
        state["original_id"] = session.scalar(
            select(Customer.customer_id).where(Customer.name == row.company_name)
        )
        row.company_name = "다른 가상 회사"
    state["result"] = register_ids([row_id])


@then("원래 고객과 새 고객의 확인 필요 쌍을 저장한다")
def pending_pair(state):
    assert state["result"] == RegistrationResult(1, 0, 1)
    (pair,) = rows(MergeCandidate)
    assert pair.customer_id_a == state["original_id"] and pair.status == "PENDING"
    assert snapshot(Customer)[:18] == state["before"][Customer]
