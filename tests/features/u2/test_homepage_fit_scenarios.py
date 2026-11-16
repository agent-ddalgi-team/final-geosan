"""#793 시나리오: 실제 API·임시 DB, 가짜 홈페이지·가짜 AI 응답(실제 접속·AI 호출 없음).

가상 사례만 쓴다(거산 실제 사양 아님).
"""

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.workflows import flow_extract
from tests.unit.u1 import test_homepage_api as support
from tests.unit.u2 import test_homepage_fit as fit

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/homepage_fit.feature")

LEVELS = {"상": "HIGH", "중": "MEDIUM", "하": "LOW"}


def _header(env):
    client, case, _ = env
    response = client.get(f"/api/v1/opportunities/{case.opp_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["header"]


@given(parsers.parse("생산품으로 적합도 {level}을 받은 찾은 회사가 있다"), target_fixture="env")
def found_company(homepage_env, level):
    fit.found_company(homepage_env[1], fit_level=LEVELS[level])
    return homepage_env


@given(parsers.parse("AI가 홈페이지 본문으로 적합도 {level}을 판단한다"))
def ai_judges(env, level):
    fit.ai_says(env[2], LEVELS[level])


@given("AI가 홈페이지 본문에서 판단할 문장을 찾지 못한다")
def ai_finds_nothing(env):
    fit.ai_says(env[2], None, reason="", quote=None)


@given("그 회사 홈페이지가 호스팅 만료로 닫혀 있다")
def closed(env, monkeypatch):
    monkeypatch.setattr(flow_extract, "fetch", fit.closed_fetch)


@when("담당자가 다시 조사를 누른다", target_fixture="response")
def research_again(env):
    env[2].reset_mock()
    return support.post(env, {})


@then(
    parsers.parse("상세에 적합도 {level}이 홈페이지 기준으로 보이고 처음엔 {first}이었다고 보인다")
)
def homepage_basis(env, response, level, first):
    assert response.status_code == 200, response.text
    header = _header(env)
    assert (header["fitLevel"], header["fitBasis"], header["previousFitLevel"]) == (
        LEVELS[level],
        "HOMEPAGE",
        LEVELS[first],
    )


@then(parsers.parse('고른 이유가 "{prefix}"으로 시작한다'))
def reason_prefix(env, prefix):
    assert _header(env)["pickReason"].startswith(prefix)


@then(parsers.parse("상세에 적합도 {level}이 생산품 기준으로 보인다"))
def product_basis(env, response, level):
    assert response.status_code == 200, response.text
    header = _header(env)
    assert (header["fitLevel"], header["fitBasis"], header["previousFitLevel"]) == (
        LEVELS[level],
        "PRODUCT",
        None,
    )


@then(parsers.parse('"{message}" 안내가 나오고 AI는 부르지 않는다'))
def closed_message(env, response, message):
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert (error["message"], error["kind"]) == (message, "SITE_CLOSED")
    assert env[2].call_count == 0


@then(parsers.parse('상세에 홈페이지 못 찾음과 닫힌 이유 "{reason}"가 보인다'))
def closed_header(env, reason):
    header = _header(env)
    assert (header["homepageStatus"], header["homepageClosedReason"]) == ("NOT_FOUND", reason)
    assert header["homepageUrl"] is None or header["homepageUrl"] != support.URL
