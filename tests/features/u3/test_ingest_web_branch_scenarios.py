"""#688: 웹 검색 갈래 연결 시나리오. 바깥 통신만 가상이다."""

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.candidate_registry import RegistryLookupResult
from geosan.workflows import flow_ingest as flow
from tests.unit.u3.conftest import factory_file as factory_file
from tests.unit.u3.test_flow_ingest import ingest_env as ingest_env
from tests.unit.u3.test_flow_ingest import new_batch, saved
from tests.unit.u3.test_ingest_web_branch import customers, web_company, web_rows
from tests.unit.u3.test_ingest_web_branch import web_env as web_env

scenarios("u3/ingest_web_branch.feature")


@given("웹 검색이 켜져 있고 웹에서 등록 확인되는 회사 1곳이 나온다", target_fixture="state")
def found_company(web_env):
    return web_env


@given("웹 검색이 켜져 있고 공장현황 파일의 회사가 웹에서도 나온다", target_fixture="state")
def same_company(web_env):
    web_env.found = [web_company("가상 볼트사", "충청남도 당진시 가상길 1")]
    return web_env


@given("웹 검색이 켜져 있고 웹 회사의 공장등록 조회가 한도에 걸린다", target_fixture="state")
def limited_lookup(web_env):
    web_env.answers["가상 웹볼트사"] = RegistryLookupResult(skipped_reason="DAILY_LIMIT")
    return web_env


@when("후보 찾기를 실행한다")
def run(state):
    state.batch_id = new_batch()
    flow.run_ingest(state.batch_id)


@then("공공자료 회사와 웹 회사가 모두 목록에 있고 웹 회사의 출처는 웹 검색이다")
def both_listed(state):
    listed = customers()
    assert listed["가상 볼트사"][0] == "FACTORY_FILE"
    assert listed["가상 웹볼트사"] == ("WEB_SEARCH", "https://web.example/products", "FOUND")
    batch = saved(state.batch_id)
    assert (batch.status, batch.new_count, batch.web_search_used) == ("DONE", 2, True)


@then("새 회사는 생기지 않고 그 회사의 출처는 공장현황 파일 그대로다")
def source_kept(state):
    assert customers() == {"가상 볼트사": ("FACTORY_FILE", None, None)}
    assert saved(state.batch_id).new_count == 1


@then("그 회사는 목록에 없고 조회 대기로 남는다")
def kept_pending(state):
    assert set(customers()) == {"가상 볼트사"}
    assert web_rows() == {"가상 웹볼트사": ("PENDING", None)}
    assert saved(state.batch_id).status == "DONE"


@then("같은 조건으로 다시 찾으면 검색 없이 조회만 이어져 목록에 들어온다")
def resumed(state):
    state.answers.clear()
    flow.run_ingest(new_batch())
    assert state.searches == 1 and "가상 웹볼트사" in customers()
    assert web_rows() == {"가상 웹볼트사": ("FOUND", None)}
