"""#511: 공식 홈페이지가 없는 회사의 공개 페이지 1개.

외부 검색·AI·홈페이지 읽기는 모두 가짜 응답이다.

조사 흐름·전송 보호·저장·재평가·상세 조회는 실제 코드와 임시 DB를 쓴다.
"""

import json
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.routes.opportunities import _score_state
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.evaluation.inputs import has_ai_pending_inputs
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evidence import openai_search
from geosan.evidence.models import Evidence
from geosan.evidence.reader import Page
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from geosan.workflows.research import research_one
from tests.unit.u2 import test_item_proposals as proposal_support
from tests.unit.u2 import test_research_command as support

search_env = support.search_env
extract_env = support.extract_env
scenarios("u2/public_page.feature")

BLOG_URL = "https://blog.example.org/hangyeol"
OFFICIAL_URL = "https://example.org/"
BODY = "대표전화 041-555-1234\n" + support.extraction_support.BODY


def _search_answer(url, kind, confidence=0.9, *, with_kind=True):
    answer = {"url": url, "confidence": confidence, "reason": "가상 검색 응답"}
    if with_kind:
        answer["pageKind"] = kind
    response = support.search_support.provider_reply()
    response["output"][-1]["content"][0]["text"] = json.dumps(answer, ensure_ascii=False)
    return response


def _customer(env):
    with session_scope() as session:
        customer = session.get(Customer, env["case"].customer_id)
        session.expunge(customer)
        return customer


def _ai_evidence(env, *, live_only=True):
    with session_scope() as session:
        query = select(Evidence).where(
            Evidence.opp_id == env["case"].opp_id, Evidence.is_llm_proposed.is_(True)
        )
        if live_only:
            query = query.where(Evidence.superseded_at.is_(None))
        rows = session.scalars(query).all()
        session.expunge_all()
        return rows


def _header(env):
    with TestClient(create_app()) as client:
        response = client.get(f"/api/v1/opportunities/{env['case'].opp_id}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["header"]


def _prepare(extract_env, monkeypatch, *, allow):
    case, extraction = extract_env
    support._real(case)
    proposal_support.as_ingested(case)
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.research.allow_unofficial_page = allow
        sync_app_settings(session, settings)
        extra_pages = settings.homepage_discovery.extra_pages
    fetch = Mock(side_effect=lambda url, deadline: Page(url, BODY))
    more = Mock(return_value=[])
    monkeypatch.setattr(flow_extract, "fetch", fetch)
    monkeypatch.setattr(flow_extract, "fetch_more", more)
    return {
        "case": case,
        "extraction": extraction,
        "search": openai_search._post_response,
        "fetch": fetch,
        "more": more,
        "extra_pages": extra_pages,
    }


@given("홈페이지가 없는 수집 회사가 있고 공개 페이지 받기 설정은 꺼져 있다", target_fixture="env")
def setting_off(extract_env, monkeypatch):
    return _prepare(extract_env, monkeypatch, allow=False)


@given("홈페이지가 없는 수집 회사가 있고 공개 페이지 받기 설정은 켜져 있다", target_fixture="env")
def setting_on(extract_env, monkeypatch):
    return _prepare(extract_env, monkeypatch, allow=True)


@given("검색이 공식 홈페이지를 못 찾았다고 답한다")
def search_finds_nothing(env):
    env["search"].side_effect = lambda *_: _search_answer(None, None, 0.1, with_kind=False)


@given("검색이 공식 홈페이지 대신 회사 블로그 주소를 높은 확신도로 답한다")
def search_finds_blog(env):
    env["url"] = BLOG_URL
    env["search"].side_effect = lambda *_: _search_answer(BLOG_URL, "BLOG", 0.95)


@given("검색이 공식 홈페이지를 높은 확신도로 답한다")
def search_finds_official(env):
    env["url"] = OFFICIAL_URL
    env["search"].side_effect = lambda *_: _search_answer(OFFICIAL_URL, "OFFICIAL", 0.95)


@given(parsers.parse("검색이 {kind} 종류로 {url} 주소를 답한다"))
def search_finds_blocked(env, kind, url):
    env["url"] = url
    env["search"].side_effect = lambda *_: _search_answer(url, kind, 0.95)


@given("근거 추출 AI가 강한 추정 근거와 강한 추정 점수 제안을 낸다")
def strong_extraction(env):
    data = proposal_support.proposals()
    assert data["evidence"][0]["certaintyProposed"] == "STRONG"
    assert data["itemInputProposals"][0]["certaintyProposed"] == "STRONG"
    proposal_support.use(env["extraction"], data)


@given("그 페이지는 robots가 자동 읽기를 막는다")
def robots_blocks(env):
    env["fetch"].side_effect = AppError(
        "자동 읽기 금지", "붙여넣기", status=422, kind="ROBOTS_DISALLOW"
    )


@given("그 회사를 한 번 조사해 약한 근거가 저장돼 있다")
def researched_once(env):
    result = research_one(env["case"].opp_id)
    assert result.error is None, result.error
    assert {row.certainty_proposed for row in _ai_evidence(env)} == {"WEAK"}


@when("그 회사를 조사한다")
def research(env):
    env["result"] = research_one(env["case"].opp_id)


@when("담당자가 그 주소를 맞음으로 확인하고 다시 조사한다")
def confirm_and_research_again(env):
    path = f"/api/v1/opportunities/{env['case'].opp_id}/homepage"
    headers = {"X-Staff-Key": "park-lee"}
    with TestClient(create_app()) as client:
        confirmed = client.post(path, json={"confirmOnly": True}, headers=headers)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["data"]["homepageStatus"] == "CONFIRMED"
        again = client.post(path, json={}, headers=headers)
        assert again.status_code == 200, again.text


@then("검색 요청은 전과 같은 지시문과 응답 칸으로 한 번만 나간다")
def request_unchanged(env):
    env["search"].assert_called_once()
    body = env["search"].call_args.args[0]
    assert "디렉터리·블로그·채용 사이트는 제외합니다" in body["instructions"]
    schema = body["text"]["format"]["schema"]
    assert set(schema["properties"]) == {"url", "confidence", "reason"}
    assert schema["required"] == ["url", "confidence", "reason"]
    assert body["max_tool_calls"] == 1


@then("홈페이지는 못 찾음으로 저장되고 근거는 없다")
def not_found(env):
    customer = _customer(env)
    assert customer.homepage_status == "NOT_FOUND" and customer.homepage_url is None
    assert env["result"].evidence_count == 0 and not _ai_evidence(env, live_only=False)
    assert env["extraction"].call_count == 0


@then("상세의 공개 페이지 종류는 비어 있다")
def page_kind_empty(env):
    assert _header(env).get("homepagePageKind") is None


@then("그 주소는 확인 필요로 저장되고 이유 글 앞에 공식 아님 표시가 붙는다")
def saved_as_needs_confirmation(env):
    customer = _customer(env)
    assert customer.homepage_url == BLOG_URL
    assert customer.homepage_status == "NEEDS_CONFIRMATION"
    assert customer.homepage_source == "AI"
    # 확신도가 기준(0.7)보다 높아도 공식이 아니면 "찾음"이 되지 않는다.
    assert customer.homepage_confidence == pytest.approx(0.95)
    assert customer.homepage_reason == "[공식 아님:BLOG] 가상 검색 응답"


@then("상세의 공개 페이지 종류는 회사 블로그다")
def page_kind_blog(env):
    header = _header(env)
    assert header["homepagePageKind"] == "BLOG"
    assert header["homepageStatus"] == "NEEDS_CONFIRMATION"
    assert header["homepageUrl"] == BLOG_URL
    # AI가 쓴 이유 글은 응답에 싣지 않는다.
    assert "homepageReason" not in header


@then("검색은 한 번만 나갔고 요청의 검색 횟수 상한도 전과 같다")
def searched_once(env):
    env["search"].assert_called_once()
    body = env["search"].call_args.args[0]
    assert body["max_tool_calls"] == 1 and body["tools"] == [{"type": "web_search"}]
    assert "pageKind" in body["text"]["format"]["schema"]["required"]
    # 검색어로 나가는 것은 전과 같이 회사 이름과 주소뿐이다.
    assert set(json.loads(body["input"])) == {"companyName", "address"}
    searches = [row for row in support.search_support.logs() if row.purpose == "EXTERNAL_SEARCH"]
    assert len(searches) == 1 and searches[0].web_search_calls == 1


@then("그 페이지 1장만 읽었고 대표번호는 저장되지 않았다")
def one_page_no_phone(env):
    env["fetch"].assert_called_once()
    assert env["fetch"].call_args.args[0] == BLOG_URL
    assert env["more"].call_args.kwargs["extra_pages"] == 0
    assert _customer(env).main_phone is None


@then("저장된 AI 근거와 점수 제안의 확실도는 모두 약한 추정 이하다")
def weak_only(env):
    assert env["result"].error is None, env["result"].error
    evidence = _ai_evidence(env)
    assert evidence and {row.certainty_proposed for row in evidence} <= {"WEAK", "UNKNOWN"}
    rows = proposal_support.inputs(env["case"].opp_id)
    assert rows["NEW_PRODUCT"].proposed_by == "AI"
    assert rows["NEW_PRODUCT"].state == "WEAK" and rows["NEW_RECORD"].state == "WEAK"
    assert not {row.state for row in rows.values()} & {"STRONG", "CONFIRMED"}


@then("그 회사의 점수는 AI 제안 · 확인 전으로 흐리게 보인다")
def score_is_dim(env):
    with session_scope() as session:
        run = latest_confirmed_evaluation(session, env["case"].opp_id)
        pending = has_ai_pending_inputs(session, env["case"].opp_id)
        assert run.score_s is not None and pending is True
        assert _score_state(run, ai_pending=pending) == "PENDING"
    assert _header(env)["scoreState"] == "PENDING"


@then("그 주소는 어디에도 저장되지 않고 본문도 읽지 않았다")
def blocked_url_dropped(env):
    customer = _customer(env)
    assert env["url"] not in (customer.homepage_reason or "")
    assert customer.homepage_reason.startswith("막는 사이트")
    assert env["fetch"].call_count == 0
    assert _header(env).get("homepageUrl") is None
    env["search"].assert_called_once()


@then("조사는 읽기 거부로 멈추고 AI 근거는 한 건도 없다")
def stopped_by_robots(env):
    assert env["result"].error is not None and env["result"].error.kind == "ROBOTS_DISALLOW"
    assert not _ai_evidence(env, live_only=False)
    assert env["extraction"].call_count == 0
    env["fetch"].assert_called_once()


@then("홈페이지는 찾음으로 저장되고 이유 글에 표시가 없다")
def official_found(env):
    customer = _customer(env)
    assert customer.homepage_url == OFFICIAL_URL and customer.homepage_status == "AI_FOUND"
    assert customer.homepage_reason == "가상 검색 응답"


@then("강한 추정 근거와 점수 제안이 그대로 저장되고 안쪽 페이지 읽기도 전과 같다")
def official_untouched(env):
    assert env["result"].error is None, env["result"].error
    assert "STRONG" in {row.certainty_proposed for row in _ai_evidence(env)}
    assert proposal_support.inputs(env["case"].opp_id)["NEW_PRODUCT"].state == "STRONG"
    assert env["more"].call_args.kwargs["extra_pages"] == env["extra_pages"] > 0
    assert _customer(env).main_phone == "041-555-1234"


@then("새로 저장된 AI 근거와 점수 제안은 강한 추정이다")
def strong_after_confirmation(env):
    assert "STRONG" in {row.certainty_proposed for row in _ai_evidence(env)}
    assert proposal_support.inputs(env["case"].opp_id)["NEW_PRODUCT"].state == "STRONG"
    customer = _customer(env)
    assert customer.homepage_status == "CONFIRMED" and customer.homepage_source == "STAFF"
