"""#425: 실제 임시 DB와 가상 외부 응답. 운영·실제 AI는 별도 소량 검사."""

import pytest
from pytest_bdd import given, scenarios, then, when

from geosan.commands.cost import run_cost
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import CandidateJudgment, SourceFactoryRow
from geosan.storage.session import session_scope
from tests.unit.u3.conftest import factory_file as factory_file
from tests.unit.u3.conftest import ingest_batch as ingest_batch
from tests.unit.u3.test_candidate_pick import envelope, fake, run, stored
from tests.unit.u3.test_candidate_pick import pick_context as pick_context
from tests.unit.u3.test_judgment_store import public_rows as public_rows

scenarios("u3/candidate_pick.feature")


@given("공개 공장 두 행과 허용된 가상 AI 응답이 있다", target_fixture="context")
def ready(pick_context, monkeypatch):
    fake(pick_context, monkeypatch)
    return pick_context


@given("공개 공장 두 행과 행이 빠진 가상 AI 응답이 있다", target_fixture="context")
def missing(pick_context, monkeypatch):
    fake(pick_context, monkeypatch, lambda answer, count: envelope("[]"))
    return pick_context


@given("공개 공장 두 행과 사용량이 없는 가상 AI 응답이 있다", target_fixture="context")
def unknown(pick_context, monkeypatch):
    fake(pick_context, monkeypatch, lambda answer, count: answer | {"usage": None})
    return pick_context


@given("한 번의 추정 비용이 이번 달 상한과 같다")
def limit():
    with session_scope() as session:
        row = session.get(AppSetting, "llm")
        row.value = row.value | {"monthlyCostLimitUsd": row.value["unconfirmedCallCostUsd"]}


@when("두 행을 판단한 뒤 고른 공정만 바꿔 다시 판단한다")
def change_selection(context):
    run(context)
    with session_scope() as session:
        session.get(IngestBatch, context["batch"]).criteria = {
            "regions": ["충남"],
            "processCodes": ["ANODIZING"],
        }
    context["result"] = run(context)


@when("두 행을 판단한 뒤 첫 행의 업종명만 바꿔 다시 판단한다")
def change_industry(context):
    run(context)
    with session_scope() as session:
        session.get(SourceFactoryRow, context["ids"][0]).industry_name = "금속가공업"
    context["result"] = run(context)


@when("AI 후보 판단을 실행한다")
def fails(context):
    with pytest.raises(AppError):
        run(context)


@when("AI 후보 판단을 실행한 뒤 다시 실행한다")
def twice(context):
    fails(context)
    with pytest.raises(AppError) as error:
        run(context)
    context["error"] = error.value


@then("요청 순서대로 모든 판단을 받고 외부 호출은 처음 두 번뿐이다")
def reused(context):
    assert [row.row_id for row in context["result"]] == list(context["ids"])
    assert len(context["calls"]) == len(stored(TransferLog)) == 2


@then("첫 행만 한 번 더 호출하고 두 행의 판단을 모두 돌려준다")
def changed(context):
    assert [row.row_id for row in context["result"]] == list(context["ids"])
    assert len(context["calls"]) == len(stored(CandidateJudgment)) == 3


@then("판단은 저장되지 않고 확정한 사용량은 남는다")
def cost_only(context):
    assert not stored(CandidateJudgment)
    (row,) = stored(TransferLog)
    assert row.input_tokens == 1000 and row.output_tokens == 200 and row.cost_usd > 0


@then("호출은 두 번 나가고 모르는 사용량은 추정 비용에 더한다")
def estimated(context):
    assert len(context["calls"]) == 2
    assert context["error"].kind == "LLM_FAILED"
    assert not stored(CandidateJudgment)
    assert all(row.cost_usd is None and row.call_count == 1 for row in stored(TransferLog))
    output = []
    assert run_cost(None, output.append) == 2
    assert any("추정 비용 $0.200000" in line for line in output)


@then("첫 호출만 나가고 다음 실행은 비용 한도 오류다")
def limited(context):
    assert len(context["calls"]) == 1
    assert context["error"].kind == "LLM_LIMIT"
    assert stored(TransferLog)[0].cost_usd is None
    assert sorted(row.call_count for row in stored(TransferLog)) == [0, 1]
    assert not stored(CandidateJudgment)
