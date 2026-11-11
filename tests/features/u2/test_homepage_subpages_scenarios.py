"""#557 시나리오: 실제 API·임시 DB·읽기 코드와 가짜 HTTP·OpenAI 응답으로 확인한다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.evidence import reader
from geosan.evidence.models import Evidence
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/homepage_subpages.feature")

HOME_URL = support.URL
INNER_URL = "https://example.org/about/company.html"
HOME = "<p>정밀 볼트를 생산합니다.</p><a href='/about/company.html'>회사소개</a>"
INNER = "<p>SCM440 소재 볼트를 두산에 납품합니다.</p>"
INNER_QUOTE = "SCM440 소재 볼트를 두산에 납품합니다."


@given("첫 화면에 회사소개 링크가 있는 공개 기회가 있다", target_fixture="site")
def site(homepage_env, monkeypatch):
    pages = {HOME_URL: HOME, INNER_URL: INNER}
    robots = {"rules": "User-agent: *\nAllow: /"}

    def get(url, _):
        if url.endswith("/robots.txt"):
            return 200, {}, robots["rules"]
        if url in pages:
            return 200, {"content-type": "text/html"}, pages[url]
        return 404, {}, ""

    monkeypatch.setattr(reader, "_get", get)
    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)
    answer = support.support.answer()
    answer["evidence"].append(
        {
            "quote": INNER_QUOTE,
            "subject": "PRODUCT",
            "occurredAtCandidate": None,
            "sourceGradeProposed": "B",
            "certaintyProposed": "STRONG",
        }
    )
    homepage_env[2].side_effect = lambda *_: support.support.reply(answer)
    return robots


@given("회사소개 페이지가 자동 읽기를 막았다")
def blocked(homepage_env, site):
    site["rules"] = "User-agent: *\nDisallow: /about/"
    homepage_env[2].side_effect = lambda *_: support.support.reply()


@when("담당자가 상세에서 AI 조사를 요청한다", target_fixture="response")
def research(homepage_env):
    return support.post(homepage_env, {})


def _sources(homepage_env):
    with session_scope() as session:
        rows = session.scalars(
            select(Evidence).where(
                Evidence.opp_id == homepage_env[1].opp_id,
                Evidence.is_llm_proposed.is_(True),
                Evidence.superseded_at.is_(None),
            )
        ).all()
        return {row.quote: row.source_ref for row in rows}


@then("AI는 한 번만 불리고 두 페이지 본문을 모두 받는다")
def once(homepage_env, response):
    assert response.status_code == 200, response.text
    assert homepage_env[2].call_count == 1
    sent = homepage_env[2].call_args.args[0]["input"]
    assert "정밀 볼트를 생산합니다." in sent and INNER_QUOTE in sent


@then("회사소개에서 나온 근거의 출처는 회사소개 페이지 주소다")
def cited(homepage_env):
    sources = _sources(homepage_env)
    assert sources[INNER_QUOTE] == INNER_URL
    assert sources["정밀 볼트를 생산합니다."] == HOME_URL


@then("첫 화면 본문만으로 조사가 끝나고 근거가 저장된다")
def first_only(homepage_env, response):
    assert response.status_code == 200, response.text
    assert response.json()["data"]["evidenceCount"] == 1
    sent = homepage_env[2].call_args.args[0]["input"]
    assert INNER_QUOTE not in sent
    assert _sources(homepage_env) == {"정밀 볼트를 생산합니다.": HOME_URL}
