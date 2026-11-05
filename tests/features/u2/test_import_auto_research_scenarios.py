from unittest.mock import Mock

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import func, select

from geosan.config.errors import AppError
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import openai_search
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_import_auto_research as support

search_env = support.search_env
extract_env = support.extract_env
import_env = support.import_env
scenarios("u2/import_auto_research.feature")


@given("자동 조사를 켠 공개 신규 사례 파일과 가짜 외부 응답이 있다")
def prepared(import_env):
    pass


@given("자동 조사를 끈다")
def disabled():
    support.search_support.change_setting("homepageDiscovery", autoResearch=False)


@given("홈페이지 본문을 읽을 수 없다")
def unreadable(monkeypatch):
    monkeypatch.setattr(
        flow_extract,
        "fetch",
        Mock(side_effect=AppError("본문 읽기 실패", "주소 확인", kind="UNREACHABLE")),
    )


@when("사례 투입 명령을 실행한다", target_fixture="result")
def run(import_env, tmp_path):
    return support.invoke_import(tmp_path, import_env[0])


@then("저장한 사례에 홈페이지와 근거와 평가 이력이 남는다")
def researched(result):
    assert result.exit_code == 0, result.output
    with session_scope() as session:
        opp = support.imported_opportunity(session)
        customer = session.get(Customer, opp.customer_id)
        assert customer.homepage_url == "https://example.org/"
        assert customer.research_source == "AI"
        assert session.scalar(select(Evidence).where(Evidence.is_llm_proposed.is_(True)))
        assert session.scalar(select(EvaluationRun).where(EvaluationRun.opp_id == opp.opp_id))


@then("조사 결과에 근거 수와 호출 비용이 표시된다")
def cost(result):
    assert "찾음 · 근거 1건 · 확인된 비용 $0.018000" in result.output


@then("외부 호출 없이 사례만 저장된다")
def saved_only(result, import_env):
    assert result.exit_code == 0, result.output
    assert "자동 조사가 꺼져" in result.output
    assert openai_search._post_response.call_count == import_env[1].call_count == 0
    assert not support.search_support.logs()
    with session_scope() as session:
        assert support.imported_opportunity(session)
        assert not session.scalar(select(EvaluationRun))


@then("조사 실패를 알리고 저장한 사례와 기존 근거를 보존한다")
def preserved(result, import_env):
    assert result.exit_code == 2, result.output
    assert "사례는 저장했습니다" in result.output
    assert "본문 읽기 실패" in result.output
    with session_scope() as session:
        opp = support.imported_opportunity(session)
        assert session.get(Customer, opp.customer_id).research_source == "CASE_FILE"
        assert session.scalar(
            select(func.count()).select_from(Evidence).where(Evidence.opp_id == opp.opp_id)
        ) == len(import_env[0]["evidence"])
        assert not session.scalar(select(EvaluationRun))
