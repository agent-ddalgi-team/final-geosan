"""#677 시나리오: 한 달 지난 관심 회사에 다시 조사를 제안한다(실제 API·임시 DB, 가짜 AI 응답).

실제 홈페이지 접속과 실제 AI 호출은 하지 않는다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import timedelta

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.config.models import AppSetting
from geosan.opportunity.models import Customer
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/research_again.feature")

STAFF = {"X-Staff-Key": "park-lee"}


def _researched(env, days, *, source="AI", bookmark=True):
    """기간은 예시 설정 값(30일)을 그대로 쓴다. 시험 환경이 예시 설정을 DB에 넣어 둔다."""
    client, case, _ = env
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.researched_at = utcnow() - timedelta(days=days)
        customer.research_source = source
    if bookmark:
        response = client.put(
            f"/api/v1/opportunities/{case.opp_id}/bookmark", json={"active": True}, headers=STAFF
        )
        assert response.status_code == 200, response.text
    return env


def _header(env):
    client, case, _ = env
    response = client.get(f"/api/v1/opportunities/{case.opp_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["header"]


@given(parsers.parse("AI가 조사한 지 {days:d}일 된 관심 회사가 있다"), target_fixture="env")
def bookmarked_company(homepage_env, days):
    return _researched(homepage_env, days)


@given("AI가 조사한 지 31일 됐고 관심이 꺼진 회사가 있다", target_fixture="env")
def not_bookmarked_company(homepage_env):
    return _researched(homepage_env, 31, bookmark=False)


@given("사례 파일로 들어온 지 31일 된 관심 회사가 있다", target_fixture="env")
def case_file_company(homepage_env):
    return _researched(homepage_env, 31, source="CASE_FILE")


@given("다시 조사 제안 기간 설정이 0이다")
def suggestion_off(env):
    with session_scope() as session:
        row = session.get(AppSetting, "research")
        row.value = {**row.value, "suggestAgainAfterDays": 0}


@when("그 회사 상세를 연다", target_fixture="header")
def open_detail(env):
    env[2].reset_mock()
    return _header(env)


@then("다시 조사 제안이 보인다")
def suggested(header):
    assert header["researchSuggestAgain"] is True


@then("다시 조사 제안이 보이지 않는다")
def not_suggested(header):
    assert header["researchSuggestAgain"] is False


@then("상세를 여는 것만으로는 조사가 돌지 않는다")
def detail_never_researches(env):
    _, case, transport = env
    assert transport.call_count == 0
    with session_scope() as session:
        researched_at = session.get(Customer, case.customer_id).researched_at
    assert utcnow() - researched_at > timedelta(days=30)


@when("담당자가 다시 조사를 누른다", target_fixture="response")
def rerun(env):
    env[2].reset_mock()
    return support.post(env, {})


@then("조사가 한 번 돌고 다시 조사 제안이 사라진다")
def researched_once(env, response):
    assert response.status_code == 200, response.text
    assert env[2].call_count == 1
    assert _header(env)["researchSuggestAgain"] is False
