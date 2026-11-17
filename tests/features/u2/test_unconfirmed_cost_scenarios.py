from decimal import Decimal

from pytest_bdd import given, scenarios, then, when
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = support.extract_env
scenarios("u2/unconfirmed_cost.feature")


@given("공개 회사의 AI 조사 응답을 한 번 받지 못했다", target_fixture="before")
def failed(extract_env):
    case, transport = extract_env
    before = support.counts()
    transport.side_effect = [TimeoutError(), support.reply()]
    result = run_extract(case.opp_id, support.URL)
    assert not result.ok and result.error.kind == "LLM_FAILED"
    assert support.counts() == before and transport.call_count == 1
    return before


@given("추정 비용만으로 이번 달 상한에 닿았다")
def limit():
    search_support.change_setting("llm", monthlyCostLimitUsd=0.1)


@when("같은 회사의 조사를 다시 실행한다", target_fixture="result")
def retry(extract_env):
    return run_extract(extract_env[0].opp_id, support.URL)


@then("새 근거와 평가가 저장되고 이전 호출은 추정 비용으로 남는다")
def saved(result, extract_env, before):
    assert result.ok and result.new_eval_ids
    assert support.counts()[0] == before[0] + 1
    assert support.counts()[1] == before[1] + 1
    assert extract_env[1].call_count == 2
    assert [row.cost_usd for row in search_support.logs()] == [None, Decimal("0.004")]
    cost = CliRunner().invoke(app, ["cost"])
    assert "한도 계산 비용 $0.104000" in cost.output


@then("비용 한도로 거절하고 추가 호출과 저장을 하지 않는다")
def stopped(result, extract_env, before):
    assert not result.ok and result.error.kind == "LLM_LIMIT"
    assert extract_env[1].call_count == 1 and support.counts() == before
    assert [row.call_count for row in search_support.logs()] == [1, 0]
