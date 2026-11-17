"""#690 시나리오: 실제 API·임시 DB와 가짜 홈페이지 읽기·가짜 AI 응답으로 확인한다.

실제 홈페이지 접속과 실제 AI 호출은 하지 않는다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import ssl
from unittest.mock import Mock

import pytest
from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.api import auto_research
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence import homepage, reader
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Bookmark
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract, research
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/bookmark_auto_research.feature")

STAFF = {"X-Staff-Key": "park-lee"}


def prepare(env, *, homepage_url=support.URL, researched=False):
    """시험용 회사를 "실제 자료·조사 전" 모양으로 바꾼다(근거 0건, 조사 날짜 없음)."""
    _, case, _ = env
    with session_scope() as session:
        session.get(Opportunity, case.opp_id).is_virtual = False
        customer = session.get(Customer, case.customer_id)
        customer.homepage_url = homepage_url
        customer.homepage_status = "AI_FOUND" if homepage_url else None
        if not researched:
            customer.researched_at = None
            for row in session.scalars(select(Evidence).where(Evidence.opp_id == case.opp_id)):
                row.superseded_at = utcnow()
    return env


def set_limit(value):
    with session_scope() as session:
        row = session.get(AppSetting, "research")
        row.value = {**row.value, "autoOnBookmarkDailyCostUsd": value}


def spend_today(env, cost):
    """다른 회사의 관심 자동 조사가 오늘 AI 호출로 이만큼 썼다."""
    from decimal import Decimal

    with session_scope() as session:
        opportunity = session.get(Opportunity, env[1].opp_id)
        row = auto_research._marker(opportunity, reject_reason=None)
        row.opp_id = new_id("opp")
        row.call_count = 1
        row.cost_usd = Decimal(cost)
        session.add(row)


def spent_today():
    with session_scope() as session:
        from geosan.config.app_settings import read_app_settings

        return auto_research.spent_today(session, read_app_settings(session).llm)


def live_evidence(case):
    with session_scope() as session:
        return len(
            session.scalars(
                select(Evidence.evidence_id).where(
                    Evidence.opp_id == case.opp_id, Evidence.superseded_at.is_(None)
                )
            ).all()
        )


def auto_rows(case):
    with session_scope() as session:
        rows = session.scalars(
            select(TransferLog)
            .where(TransferLog.opp_id == case.opp_id, TransferLog.call_count == 0)
            .order_by(TransferLog.occurred_at)
        ).all()
        return [(row.requested_by, row.decision, row.reject_reason) for row in rows]


@pytest.fixture(autouse=True)
def no_homepage_search(monkeypatch):
    """이 경로는 홈페이지 찾기 웹 검색을 하지 않는다. 부르면 바로 실패하게 한다."""
    search = Mock(side_effect=AssertionError("홈페이지 찾기 검색을 부르면 안 됩니다"))
    monkeypatch.setattr(research, "find_case_homepage", search)
    monkeypatch.setattr(homepage, "find_case_homepage", search)
    return search


@given("홈페이지 주소가 있고 아직 조사 전인 회사가 있다", target_fixture="env")
def unresearched(homepage_env):
    return prepare(homepage_env)


@given("홈페이지 주소가 없는 조사 전 회사가 있다", target_fixture="env")
def without_homepage(homepage_env):
    return prepare(homepage_env, homepage_url=None)


@given("홈페이지 주소가 있고 이미 조사된 회사가 있다", target_fixture="env")
def researched(homepage_env):
    return prepare(homepage_env, researched=True)


@given("오늘 관심 자동 조사가 이미 하루 금액만큼 썼다")
def limit_used(env):
    set_limit(0.5)
    spend_today(env, "0.5")


@given("오늘 관심 자동 조사가 하루 금액에 조금 못 미치게 썼다")
def limit_almost_used(env):
    set_limit(0.5)
    spend_today(env, "0.4999")


@given("하루 금액이 조사 한 곳 예상 비용과 같고 방금 다른 회사의 관심 자동 조사가 시작됐다")
def another_company_just_started(env):
    """#719: 아직 AI 호출 행이 없는 시작 표시 1행(다른 회사). 실제 비용은 아직 0이다."""
    from geosan.config.app_settings import read_app_settings

    with session_scope() as session:
        estimate = read_app_settings(session).ingestion.cost_estimate.research_usd_per_company
        opportunity = session.get(Opportunity, env[1].opp_id)
        row = auto_research._marker(opportunity, reject_reason=None)
        row.opp_id = new_id("opp")
        session.add(row)
    set_limit(estimate)


@given("관심 자동 조사 하루 금액 설정이 0이다")
def limit_zero(env):
    set_limit(0)


@given("자동 조사 스위치가 꺼져 있다")
def auto_research_off(env):
    """#719: 후보 찾기 뒤·`geosan research`의 자동 조사를 끄는 기존 스위치."""
    with session_scope() as session:
        row = session.get(AppSetting, "homepageDiscovery")
        row.value = {**row.value, "autoResearch": False}


@given("AI가 형식에 맞지 않는 응답을 준다")
def malformed_ai_reply(env):
    env[2].side_effect = lambda *_: {"가짜": "형식에 맞지 않는 응답"}


@then("관심은 저장되고 근거는 붙지 않는다")
def saved_without_evidence(env, response):
    _, case, _ = env
    assert response.status_code == 200, response.text
    assert bookmark_is_on(case) and live_evidence(case) == 0
    assert not auto_research.is_running(case.opp_id)


@given("그 홈페이지는 인증서 문제로 읽을 수 없다")
def bad_certificate(env, monkeypatch):
    def get(url, _):
        raise ssl.SSLCertVerificationError("가짜 인증서 오류")

    monkeypatch.setattr(reader, "_get", get)
    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)


@when("담당자가 그 회사의 관심을 켠다", target_fixture="response")
def bookmark_on(env):
    client, case, _ = env
    return client.put(
        f"/api/v1/opportunities/{case.opp_id}/bookmark", json={"active": True}, headers=STAFF
    )


@when("담당자가 그 회사에 메모를 저장한다", target_fixture="response")
def note_saved(env):
    client, case, _ = env
    return client.post(
        f"/api/v1/opportunities/{case.opp_id}/notes", json={"text": "가상 메모"}, headers=STAFF
    )


CLOSING = {
    "거절": {"status": "LOST", "lostReasonCode": "PRICE"},
    "보류": {"status": "ON_HOLD"},
}


def save_call(env, **extra):
    client, case, _ = env
    body = {"status": "IN_PROGRESS", "method": "CALL", "result": "REACHED", **extra}
    return client.post(f"/api/v1/opportunities/{case.opp_id}/outcomes", json=body, headers=STAFF)


@when(
    parsers.parse('담당자가 그 회사의 첫 통화를 "{stage}"로 마무리해 저장한다'),
    target_fixture="response",
)
def closing_call(env, stage):
    return save_call(env, **CLOSING[stage])


@when("담당자가 그 회사에 진행 중인 통화를 저장한다", target_fixture="response")
def open_call(env):
    return save_call(env)


@given("그 회사는 통화 없이 거절 단계로 저장된 뒤 관심이 꺼져 있다")
def closed_without_bookmark(env):
    """단계만 바꾼 저장도 관심을 켜므로, 준비 단계에서 관심 행을 꺼진 값으로 되돌려 둔다."""
    client, case, transport = env
    set_limit(0)
    response = client.post(
        f"/api/v1/opportunities/{case.opp_id}/outcomes",
        json={"status": "LOST", "lostReasonCode": "PRICE"},
        headers=STAFF,
    )
    assert response.status_code == 200, response.text
    with session_scope() as session:
        row = session.scalar(
            select(Bookmark).where(Bookmark.opp_id == case.opp_id).order_by(Bookmark.version.desc())
        )
        row.active = False
    set_limit(1.0)
    assert transport.call_count == 0


def bookmark_is_on(case):
    with session_scope() as session:
        row = session.scalar(
            select(Bookmark).where(Bookmark.opp_id == case.opp_id).order_by(Bookmark.version.desc())
        )
        return row is not None and row.active


@then("관심이 저장되고 조사가 한 번 돌아 근거가 붙는다")
def researched_once(env, response):
    _, case, transport = env
    assert response.status_code == 200, response.text
    assert bookmark_is_on(case)
    assert transport.call_count == 1
    assert live_evidence(case) == 1
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).researched_at is not None
    assert not auto_research.is_running(case.opp_id)
    # 한 번 더 눌러도(끄고 켜도) 이미 조사된 회사라 다시 돌지 않는다.
    client = env[0]
    url = f"/api/v1/opportunities/{case.opp_id}/bookmark"
    off = client.put(url, json={"active": False}, headers=STAFF)
    if off.status_code == 200:
        assert client.put(url, json={"active": True}, headers=STAFF).status_code == 200
    assert transport.call_count == 1


@then("전송 기록에 관심 자동 조사 시작 1행이 남는다")
def start_row(env):
    assert auto_rows(env[1]) == [("auto-bookmark", "ALLOWED", None)]


@then("관심만 저장되고 조사도 홈페이지 찾기 검색도 돌지 않는다")
def nothing_happens(env, response, no_homepage_search):
    _, case, transport = env
    assert response.status_code == 200, response.text
    assert bookmark_is_on(case)
    assert transport.call_count == 0 and no_homepage_search.call_count == 0
    assert auto_rows(case) == []
    assert not auto_research.is_running(case.opp_id)


@then("관심만 저장되고 조사는 돌지 않는다")
def not_researched(env, response):
    _, case, transport = env
    assert response.status_code == 200, response.text
    assert bookmark_is_on(case)
    assert transport.call_count == 0 and live_evidence(case) == 0
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).researched_at is None
    assert not auto_research.is_running(case.opp_id)


@then("그 조사의 AI 호출 행은 관심 자동 조사 것으로 남는다")
def call_row(env):
    with session_scope() as session:
        rows = session.scalars(
            select(TransferLog).where(
                TransferLog.opp_id == env[1].opp_id, TransferLog.call_count > 0
            )
        ).all()
        assert [(row.requested_by, row.decision) for row in rows] == [("auto-bookmark", "ALLOWED")]


@then("오늘 쓴 금액은 하루 금액을 넘는다")
def over_limit(env):
    from decimal import Decimal

    assert spent_today() > Decimal("0.5")


@then("전송 기록에 아무 행도 남지 않는다")
def no_rows(env):
    with session_scope() as session:
        assert session.scalars(select(TransferLog)).all() == []


@then("그 회사의 조사 상태는 자동 조사 한도로 조사 안 함이다")
def limit_state(env):
    from geosan.api.ingest_views import research_state

    with session_scope() as session:
        customer = session.get(Customer, env[1].customer_id)
        customer.ingest_batch_id = "batch-690"
        assert research_state(customer, None, scored=False) == "LIMIT_SKIPPED"
        session.rollback()


@then(parsers.parse('전송 기록에 "{reason}" 거부 1행이 남는다'))
def rejection_row(env, reason):
    rejected = [row for row in auto_rows(env[1]) if row[1] == "REJECTED"]
    assert [row[2] for row in rejected] == [reason]


# ---------- robots.txt ----------


@given(
    parsers.parse("robots.txt 요청에 {status:d} 응답을 주는 홈페이지가 있다"), target_fixture="site"
)
def robots_missing(monkeypatch, status):
    return fake_site(monkeypatch, (status, {}, "<html>없는 페이지</html>"))


@given("robots.txt가 정상으로 내려왔고 전체 금지라고 적힌 홈페이지가 있다", target_fixture="site")
def robots_denies(monkeypatch):
    return fake_site(monkeypatch, (200, {}, "User-agent: *\nDisallow: /"))


def fake_site(monkeypatch, robots_response):
    calls = []

    def get(url, _):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return robots_response
        return 200, {"content-type": "text/html"}, "<p>정밀 볼트를 생산합니다.</p>"

    monkeypatch.setattr(reader, "_get", get)
    return calls


@when("그 홈페이지를 읽는다", target_fixture="outcome")
def read_site(site):
    import time

    try:
        return reader.fetch("https://example.org/", time.monotonic() + 30)
    except AppError as error:
        return error


@then("본문을 읽는다")
def body_read(outcome):
    assert isinstance(outcome, reader.Page), outcome
    assert outcome.text == "정밀 볼트를 생산합니다."


@then("본문을 요청하지 않고 자동으로 읽을 수 없다고 알린다")
def body_not_requested(outcome, site):
    assert isinstance(outcome, AppError) and outcome.kind == "ROBOTS_DISALLOW"
    assert all(url.endswith("/robots.txt") for url in site)
