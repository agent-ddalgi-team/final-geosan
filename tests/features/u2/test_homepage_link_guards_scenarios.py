"""#557 후속: 실제 API·임시 DB에서 실패한 안쪽 페이지와 정상 첫 화면을 구분한다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.evaluation.models import EvaluationRun
from geosan.evidence import public_items, reader
from geosan.evidence.models import Evidence
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/homepage_link_guards.feature")

INNER = "https://example.org/about"
OTHER = "https://other.example.org/product"
QUOTE = "정밀 볼트를 생산합니다."
HTML = {"content-type": "text/html"}


def _site(homepage_env, monkeypatch, href):
    calls = []
    pages = {
        support.URL: (200, HTML, f'<p>{QUOTE}</p><a href="{href}">회사소개</a>'),
        INNER: (302, {"location": OTHER}, ""),
        OTHER: (200, HTML, "<p>다른 회사의 제품</p>"),
    }

    def get(url, _):
        calls.append(url)
        return pages.get(url, (404, {}, ""))

    monkeypatch.setattr(reader, "_get", get)
    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)
    homepage_env[2].side_effect = lambda *_: support.support.reply()
    return calls


@given("정상 첫 화면과 잘못된 회사소개 링크가 있는 공개 기회가 있다", target_fixture="calls")
def malformed(homepage_env, monkeypatch):
    return _site(homepage_env, monkeypatch, "https://[broken")


@given("회사소개 링크가 다른 사이트로 이동하는 공개 기회가 있다", target_fixture="calls")
def redirected(homepage_env, monkeypatch):
    return _site(homepage_env, monkeypatch, INNER)


@when("담당자가 홈페이지 조사를 요청한다", target_fixture="response")
def research(homepage_env):
    return support.post(homepage_env, {})


@then("첫 화면만 AI에 한 번 보내 근거와 재평가를 저장한다")
def stored(homepage_env, response):
    assert response.status_code == 200, response.text
    assert response.json()["data"]["evidenceCount"] == 1
    transport = homepage_env[2]
    assert transport.call_count == 1
    sent = transport.call_args.args[0]["input"]
    assert QUOTE in sent and "다른 회사의 제품" not in sent
    with session_scope() as session:
        evidence = session.scalars(
            select(Evidence).where(
                Evidence.opp_id == homepage_env[1].opp_id,
                Evidence.is_llm_proposed.is_(True),
                Evidence.superseded_at.is_(None),
            )
        ).all()
        assert {row.quote: row.source_ref for row in evidence} == {QUOTE: support.URL}
        assert session.scalar(
            select(EvaluationRun.eval_id).where(EvaluationRun.opp_id == homepage_env[1].opp_id)
        )
    assert not public_items._items


@then("다른 사이트의 주소에는 요청하지 않는다")
def no_other_site(calls):
    assert INNER in calls
    assert not any("other.example.org" in url for url in calls)
