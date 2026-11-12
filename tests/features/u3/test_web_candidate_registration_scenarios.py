"""#523: 등록 여부·선정 판단은 가상, 회사 등록과 트랜잭션은 실제 DB."""

import pytest
from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.opportunity.candidate_registration import RegistrationResult, register_candidates
from geosan.opportunity.models import Customer, IngestBatch, Opportunity, OppProcessLink
from geosan.opportunity.source_models import WebCandidate
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_registration import BATCH, existing, judgment, rows, snapshot
from tests.unit.u3.test_candidate_registration import registration_context as registration_context
from tests.unit.u3.test_web_candidate_registration import register_web, saved_candidates
from tests.unit.u3.test_web_candidate_registration import web_context as web_context

scenarios("u3/web_candidate_registration.feature")


@given("등록 확인된 웹 후보와 선정 판단이 있다", target_fixture="context")
def ready(web_context):
    return {"selected": judgment(saved_candidates().candidate_ids[0])}


@given("이름과 주소가 같은 사례 회사가 있다")
def original(context):
    existing(pick_reason="기존 담당자 값")
    context["before"] = snapshot(Customer)


@given("후보는 등록 자료에서 못 찾았고 확인되지 않은 홈페이지 주소만 있다")
def unconfirmed(context):
    with session_scope() as session:
        row = session.get(WebCandidate, context["selected"].row_id)
        row.registry_status = "NOT_FOUND"
        row.homepage_url = "https://bolt.example/"


@when("웹 후보를 회사로 등록한다")
def register(context):
    context["result"] = register_web(context["selected"])


@when("웹 후보 등록을 요청하면 거부된다")
def rejected(context):
    with pytest.raises(AppError):
        register_web(context["selected"])


@when("웹 등록 뒤 같은 트랜잭션의 회차 집계가 실패한다")
def rollback(context):
    with pytest.raises(RuntimeError):
        with session_scope() as session:
            result = register_candidates(session, BATCH, [context["selected"]], source_kind="WEB")
            session.get(IngestBatch, BATCH).new_count = result.new_count
            raise RuntimeError("가상 집계 실패")


@then("웹 출처와 등록 확인 및 확인 전 공정이 저장된다")
def saved(context):
    assert context["result"] == RegistrationResult(1, 0, 0)
    (customer,) = rows(Customer)
    assert customer.discovery_source == "WEB_SEARCH" and customer.registry_status == "FOUND"
    assert customer.discovery_source_url == "https://bolt.example/products"
    assert customer.pick_reason == context["selected"].reason
    assert all(row.source == "AI" and row.state == "PENDING" for row in rows(OppProcessLink))
    assert {row.process_code for row in rows(OppProcessLink)} == set(
        context["selected"].process_codes
    )


@then("기존 회사의 모든 값이 보존되고 새 회사는 생기지 않는다")
def preserved(context):
    assert context["result"] == RegistrationResult(0, 1, 0)
    assert snapshot(Customer) == context["before"] and not rows(Opportunity)


@then("회사와 기회가 생기지 않는다")
def empty():
    assert not rows(Customer) and not rows(Opportunity)


@then("회차 집계와 공정 연결도 남지 않는다")
def no_counts():
    assert rows(IngestBatch)[0].new_count == 0 and not rows(OppProcessLink)
