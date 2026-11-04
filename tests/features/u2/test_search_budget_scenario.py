"""HTTP 경계만 대체하고 실제 검색 진입점·설정·SQLite 한도를 함께 검증한다."""

from decimal import Decimal

from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.evidence.homepage import find_case_homepage
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from tests.unit.u2 import test_search_limits as search_support
from tests.unit.u2.test_search_limits import change_setting, logs

search_env = search_support.search_env

scenarios("u2/search_limits.feature")


@given("외부 검색을 켜고 하루 한도를 1회로 등록했다")
def limited(search_env):
    change_setting("homepageDiscovery", dailyCallLimit=1)


@when("같은 회사를 두 번 검색한다", target_fixture="rejection")
def twice(search_env):
    case, _ = search_env
    find_case_homepage(case.opp_id)
    try:
        find_case_homepage(case.opp_id)
    except AppError as exc:
        return exc
    raise AssertionError("두 번째 요청이 거부되어야 합니다.")


@then("요청은 한 번만 전송되고 두 번째 요청은 오늘 검색 한도 초과로 거부된다")
def blocked(search_env, rejection):
    _, transport = search_env
    transport.assert_called_once()
    assert rejection.kind == "SEARCH_LIMIT"
    assert rejection.message == "오늘 검색 한도 초과"


@then("첫 결과와 호출 비용은 데이터베이스에 남는다")
def preserved(search_env):
    case, _ = search_env
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_status == "AI_FOUND"
    assert logs()[0].cost_usd == Decimal("0.014")
