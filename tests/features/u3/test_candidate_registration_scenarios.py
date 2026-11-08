"""#426: 외부 AI 없이 선정 판단 이후 실제 DB 저장 경계를 검사한다."""

import pytest
from pytest_bdd import given, scenarios, then, when

from geosan.evaluation.models import EvaluationRun, ItemJudgmentInput
from geosan.opportunity.candidate_registration import RegistrationResult, register_candidates
from geosan.opportunity.models import Customer, IngestBatch, MergeCandidate, OppProcessLink
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_registration import (
    BATCH,
    existing,
    judgment,
    register,
    rows,
)
from tests.unit.u3.test_candidate_registration import registration_context as registration_context

scenarios("u3/candidate_registration.feature")


@given("승인된 공개 공장과 선정 판단이 있다")
def ready(registration_context):
    pass


@given("같은 주소에 이름이 다른 회사가 있다")
def ambiguous():
    existing(name="가상볼트공업")


@when("선정 판단을 회사로 등록한다", target_fixture="result")
def registered():
    return register()


@then("새 회사와 확인 전 AI 공정이 저장되고 점수와 연락처는 만들지 않는다")
def check_new(result):
    assert result == RegistrationResult(1, 0, 0)
    (customer,) = rows(Customer)
    assert customer.pick_reason == judgment().reason and customer.ingest_batch_id == BATCH
    assert customer.main_phone is None
    assert {row.process_code for row in rows(OppProcessLink)} == set(judgment().process_codes)
    assert all(row.source == "AI" and row.state == "PENDING" for row in rows(OppProcessLink))
    assert not rows(EvaluationRun) and not rows(ItemJudgmentInput)


@then("기존 회사를 보존하고 확인할 고객 쌍을 남긴다")
def check_ambiguous(result):
    assert result == RegistrationResult(1, 0, 1)
    assert len(rows(Customer)) == 2
    (pair,) = rows(MergeCandidate)
    assert pair.customer_id_a == "existing" and pair.status == "PENDING"


@when("등록 뒤 같은 트랜잭션의 회차 집계가 실패한다")
def rollback():
    with pytest.raises(RuntimeError):
        with session_scope() as session:
            result = register_candidates(session, BATCH, [judgment()])
            session.get(IngestBatch, BATCH).new_count = result.new_count
            raise RuntimeError("가상 집계 실패")


@then("회사와 공정 및 집계가 함께 되돌아간다")
def check_rollback():
    assert not rows(Customer) and not rows(OppProcessLink)
    assert rows(IngestBatch)[0].new_count == 0
