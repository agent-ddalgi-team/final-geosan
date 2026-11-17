from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import openai_search
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from tests.unit.u2 import test_research_command as support

search_env = support.search_env
extract_env = support.extract_env
batch_env = support.batch_env
scenarios("u2/research.feature")


@given("홈페이지 없는 공개 신규 사례와 가짜 검색·추출 응답이 있다")
def prepared(batch_env):
    pass


@when("홈페이지 없는 사례 일괄 조사 명령을 실행한다", target_fixture="result")
def run():
    return CliRunner().invoke(app, ["research", "--missing-homepage"])


@then("홈페이지와 새 근거와 평가 이력이 실제 DB에 저장된다")
def stored(batch_env, result):
    assert result.exit_code == 0, result.output
    with session_scope() as session:
        assert session.get(Customer, batch_env[0].customer_id).research_source == "AI"
        assert session.scalar(select(Evidence).where(Evidence.is_llm_proposed.is_(True)))
        assert session.scalar(select(EvaluationRun))


@then("회사별 근거 수와 검색·추출 비용이 함께 출력된다")
def cost(result):
    assert "찾음 · 근거 1건 · 확인된 비용 $0.018000" in result.output


@given("공개 신규 사례 두 곳 중 첫 회사의 AI 응답이 끊긴다", target_fixture="second")
def failed_first(batch_env, tmp_path):
    second = support.add_case(tmp_path)
    openai_search._post_response.side_effect = [TimeoutError(), support._answer()]
    return second


@then("첫 회사의 실패를 알리고 다음 회사의 근거와 평가를 저장한다")
def continued(batch_env, second, result):
    assert result.exit_code == 2
    assert "저장·재평가 1건" in result.output and "실패 1건" in result.output
    assert "총비용 미확정" in result.output and "조사를 멈췄습니다" not in result.output
    with session_scope() as session:
        assert session.get(Customer, batch_env[0].customer_id).research_source != "AI"
        assert session.get(Customer, second.customer_id).research_source == "AI"
        assert session.scalar(select(EvaluationRun).where(EvaluationRun.opp_id == second.opp_id))


# ---------- #690: 기본 대상에 "주소는 있는데 조사가 안 된 회사" ----------


@given("홈페이지 주소는 있는데 조사 날짜와 근거가 없는 공개 신규 사례가 있다")
def unresearched(batch_env):
    support.give_address(batch_env[0], researched=False)


@given("홈페이지 주소가 있고 이미 조사된 공개 신규 사례가 있다")
def researched(batch_env):
    support.give_address(batch_env[0], researched=True)


@when("조건 없이 일괄 조사 명령을 실행한다", target_fixture="result")
def run_default():
    return CliRunner().invoke(app, ["research"])


@then("홈페이지 찾기 검색 없이 그 주소로 조사해 근거와 평가를 저장한다")
def researched_by_address(batch_env, result):
    case, extraction = batch_env
    assert result.exit_code == 0, result.output
    assert "저장·재평가 1건" in result.output
    assert extraction.call_count == 1
    assert [row.purpose for row in support.search_support.logs()] == ["EXTERNAL_AI"]
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert customer.researched_at is not None
        assert customer.homepage_url == support.extraction_support.URL
        assert session.scalar(select(Evidence).where(Evidence.is_llm_proposed.is_(True)))
        assert session.scalar(select(EvaluationRun))


@then("조사할 사례가 없다고 알리고 아무것도 부르지 않는다")
def nothing_to_do(batch_env, result):
    assert result.exit_code == 0, result.output
    assert "처리 0건" in result.output
    assert batch_env[1].call_count == 0 and not support.search_support.logs()
