from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

extract_env = support.extract_env
search_env = search_support.search_env
scenarios("u2/extraction.feature")


@given("공개 신규 기회와 가짜 OpenAI 추출 응답이 준비되었다")
def public(extract_env):
    pass


@given("내부 자료인 기회가 준비되었다")
def private(extract_env):
    case, _ = extract_env
    with session_scope() as session:
        session.get(Customer, case.customer_id).security_grade = "INTERNAL_ONLY"


@when("홈페이지 본문 조사를 실행한다", target_fixture="result")
def run(extract_env):
    return run_extract(extract_env[0].opp_id, support.URL)


@then("새 근거와 질문과 실제 재평가가 함께 저장된다")
def stored(result):
    assert result.ok and len(result.new_eval_ids) == 1
    assert "근거 1건·질문 1건 저장" in result.summary


@then("OpenAI 전송 없이 거부 기록만 남는다")
def rejected(extract_env, result):
    assert not result.ok and extract_env[1].call_count == 0
    assert search_support.logs()[0].decision == "REJECTED"
