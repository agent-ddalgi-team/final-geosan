"""#793: 조사가 홈페이지를 읽으면 적합도를 다시 정하고, 닫힌 홈페이지는 '홈페이지 못 찾음'으로 둔다.

실제 SQLite·규칙 엔진과 가짜 홈페이지·가짜 OpenAI 응답만 쓴다(실제 접속·AI 호출 없음).
가상 사례만 쓴다(거산 실제 사양 아님).
"""

import json
import time

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.errors import AppError
from geosan.evidence import reader
from geosan.evidence.extraction import Extraction, FitReview, _checked_fit
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.queries import closed_homepage_reason
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_extraction as support

search_env = support.search_env
extract_env = support.extract_env
URL = support.URL
BODY = support.BODY
PICK = "생산품 정보로 본 이유 · 자동차 부품 생산"


def found_company(case, *, fit_level="MEDIUM", homepage=True):
    """후보 찾기로 들어온 회사 모양(회차 번호·적합도·고른 이유·같은 카드 문장)."""
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.ingest_batch_id = "batch-test"
        customer.discovery_source = "FACTORY_FILE"
        customer.fit_level = fit_level
        customer.pick_reason = PICK
        if homepage:
            customer.homepage_url = URL
            customer.homepage_status = "AI_FOUND"
            customer.homepage_source = "AI"
        session.get(Opportunity, case.opp_id).card_reason = PICK


def ai_says(
    transport, fit_level, reason="볼트를 직접 생산", quote="정밀 볼트를 생산합니다.", basis=None
):
    data = support.answer()
    data["fitReview"] = {
        "fitLevel": fit_level,
        "reason": reason,
        "quote": quote,
        "downgradeBasis": basis,
    }
    transport.side_effect = lambda *_: support.reply(data)


def company(case):
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        opportunity = session.get(Opportunity, case.opp_id)
        session.expunge(customer)
        session.expunge(opportunity)
        return customer, opportunity


def sent_instructions(transport):
    return transport.call_args.args[0]["instructions"]


# ---------- 적합도 다시 보기 ----------


@pytest.mark.parametrize(
    ("before", "after"),
    [("MEDIUM", "HIGH"), ("HIGH", "LOW"), ("MEDIUM", "MEDIUM")],
    ids=["올라감", "내려감", "같음"],
)
def test_homepage_fit_moves_to_card_with_reason_and_first_level(extract_env, before, after):
    """Given 생산품 기준 적합도 회사 / When 조사가 홈페이지로 다시 판단
    / Then 적합도·이유가 홈페이지 기준으로 바뀌고 처음 적합도가 남는다.
    (#810: 내려갈 때는 반대 근거 종류가 함께 와야 옮긴다 — 여기서는 조립만 하는 회사.)"""
    case, transport = extract_env
    found_company(case, fit_level=before)
    ai_says(transport, after, basis="ASSEMBLY_ONLY" if after == "LOW" else None)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    customer, opportunity = company(case)
    assert (customer.fit_level, customer.fit_basis, customer.previous_fit_level) == (
        after,
        "HOMEPAGE",
        before,
    )
    assert customer.pick_reason == "홈페이지 기준 · 볼트를 직접 생산"
    assert opportunity.card_reason == customer.pick_reason
    assert "적합도 다시 보기" in sent_instructions(transport)


def test_no_sentence_to_judge_keeps_product_fit(extract_env):
    """Given 홈페이지에 판단할 문장이 없음(AI null) / Then 생산품 기준 그대로다."""
    case, transport = extract_env
    found_company(case)
    ai_says(transport, None, reason="", quote=None)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, opportunity = company(case)
    assert (customer.fit_level, customer.fit_basis, customer.previous_fit_level) == (
        "MEDIUM",
        None,
        None,
    )
    assert customer.pick_reason == PICK and opportunity.card_reason == PICK


def test_second_research_keeps_first_product_level(extract_env):
    """Given 홈페이지로 한 번 올라간 회사 / When 다시 조사해 또 바뀜
    / Then '처음엔 생산품 기준'은 맨 처음 값 그대로다."""
    case, transport = extract_env
    found_company(case, fit_level="MEDIUM")
    ai_says(transport, "HIGH")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    ai_says(
        transport,
        "LOW",
        reason="부품을 사 와 조립",
        quote="납품 전 검사가 필요합니다.",
        basis="ASSEMBLY_ONLY",
    )
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, opportunity = company(case)
    assert (customer.fit_level, customer.previous_fit_level) == ("LOW", "MEDIUM")
    assert customer.pick_reason == "홈페이지 기준 · 부품을 사 와 조립"
    assert opportunity.card_reason == customer.pick_reason


# ---------- #810 '적혀 있지 않음'만으로는 내리지 않는다 ----------


@pytest.mark.parametrize(("before", "after"), [("HIGH", "MEDIUM"), ("MEDIUM", "LOW")])
def test_lower_fit_without_counter_evidence_keeps_product_fit(extract_env, before, after):
    """Given 생산품 기준 적합도 회사 / When AI가 반대 근거 종류 없이 낮게 판단
    ('도금을 명시하지 않음' 같은 이유) / Then 그 판단만 버리고 적합도·이유·카드 문장은 그대로."""
    case, transport = extract_env
    found_company(case, fit_level=before)
    ai_says(transport, after, reason="도금 공정은 명시하지 않음", quote="정밀 볼트를 생산합니다.")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, opportunity = company(case)
    assert (customer.fit_level, customer.fit_basis, customer.previous_fit_level) == (
        before,
        None,
        None,
    )
    assert customer.pick_reason == PICK and opportunity.card_reason == PICK


@pytest.mark.parametrize("basis", ["NON_MANUFACTURER", "ASSEMBLY_ONLY", "OWN_PLATING"])
def test_lower_fit_with_counter_evidence_moves(extract_env, basis):
    """Given 상 회사 / When AI가 반대 근거 종류와 함께 낮게 판단 / Then 홈페이지 기준으로 내린다."""
    case, transport = extract_env
    found_company(case, fit_level="HIGH")
    ai_says(transport, "LOW", reason="설계 용역 위주", basis=basis)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.fit_level, customer.fit_basis, customer.previous_fit_level) == (
        "LOW",
        "HOMEPAGE",
        "HIGH",
    )


def test_homepage_raised_fit_can_return_to_product_level_without_basis(extract_env):
    """Given 홈페이지로 상까지 올라간 회사(생산품 기준 중) / When 다시 조사에서 근거 없이 중
    / Then 생산품 기준(중)보다 낮지 않으니 옮긴다. 중보다 낮은 하는 근거 없이 버린다."""
    case, transport = extract_env
    found_company(case, fit_level="MEDIUM")
    ai_says(transport, "HIGH")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    ai_says(transport, "MEDIUM", reason="부품 생산은 넓게 적힘")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.fit_level, customer.previous_fit_level) == ("MEDIUM", "MEDIUM")
    ai_says(transport, "LOW", reason="도금 공정은 명시하지 않음")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert customer.fit_level == "MEDIUM"
    assert customer.pick_reason == "홈페이지 기준 · 부품 생산은 넓게 적힘"


def test_fit_instructions_forbid_lowering_on_absence(extract_env):
    """지시문이 '적혀 있지 않다는 이유만으로는 내리지 않는다'와 반대 근거 종류를 말한다."""
    case, transport = extract_env
    found_company(case)
    ai_says(transport, None, reason="", quote=None)
    assert flow_extract.run_extract(case.opp_id, URL).ok
    sent = sent_instructions(transport)
    assert "적혀 있지 않다는 이유만으로는" in sent
    for kind in ("NON_MANUFACTURER", "ASSEMBLY_ONLY", "OWN_PLATING"):
        assert kind in sent


def test_hand_written_card_sentence_is_kept(extract_env):
    """Given 담당자가 고친 카드 문장 / Then 적합도·이유는 바뀌어도 카드 문장은 그대로다."""
    case, transport = extract_env
    found_company(case)
    with session_scope() as session:
        session.get(Opportunity, case.opp_id).card_reason = "담당자가 고친 문장"
    ai_says(transport, "HIGH")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, opportunity = company(case)
    assert customer.fit_level == "HIGH" and opportunity.card_reason == "담당자가 고친 문장"


def test_case_file_company_is_not_rejudged_or_asked(extract_env):
    """Given 사례 파일 회사(적합도 없음) / Then AI에 적합도를 묻지 않고 값도 그대로다."""
    case, transport = extract_env
    ai_says(transport, "HIGH")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.fit_level, customer.fit_basis) == (None, None)
    assert "적합도 다시 보기" not in sent_instructions(transport)
    assert "fitReview는 fitLevel null" in sent_instructions(transport)


def test_ai_sends_fit_schema_field(extract_env):
    """요청 스키마가 fitReview를 필수 칸으로 담는다(엄격 형식이라 빠지면 AI가 못 채움)."""
    case, transport = extract_env
    found_company(case)
    flow_extract.run_extract(case.opp_id, URL)
    schema = transport.call_args.args[0]["text"]["format"]["schema"]
    assert "fitReview" in schema["required"]


def _extraction(fit_level, reason, quote, basis=None):
    data = support.answer()
    data["fitReview"] = {
        "fitLevel": fit_level,
        "reason": reason,
        "quote": quote,
        "downgradeBasis": basis,
    }
    return Extraction.model_validate(data)


@pytest.mark.parametrize(
    ("reason", "quote"),
    [("볼트 생산", "본문에 없는 문장"), ("  ", "정밀 볼트를 생산합니다."), ("볼트 생산", None)],
    ids=["인용이 본문에 없음", "이유가 빔", "인용 없음"],
)
def test_unbacked_fit_is_dropped_without_failing_research(reason, quote):
    """인용이 본문에 없거나 이유가 비면 그 판단만 버린다(조사 전체는 실패시키지 않음)."""
    checked = _checked_fit(_extraction("HIGH", reason, quote), BODY)
    assert checked.fit_review == FitReview(
        fit_level=None, reason="", quote=None, downgrade_basis=None
    )


def test_backed_fit_is_kept():
    checked = _checked_fit(_extraction("HIGH", "볼트 생산", "정밀 볼트를 생산합니다."), BODY)
    assert checked.fit_review.fit_level == "HIGH"


def test_unbacked_fit_from_ai_keeps_card(extract_env):
    case, transport = extract_env
    found_company(case)
    ai_says(transport, "HIGH", quote="홈페이지에 없는 문장")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    customer, _ = company(case)
    assert (customer.fit_level, customer.fit_basis) == ("MEDIUM", None)


# ---------- 닫힌 홈페이지 ----------


def _site(pages):
    """주소 → (상태, 머리, 본문). 없는 주소는 404."""

    def get(url, _):
        return pages.get(url, (404, {}, ""))

    return get


EXPIRED = "https://hostinfo.example.net/serviceExpire/expiration.html?domain=x"


def test_empty_body_is_closed_empty_page(monkeypatch):
    calls = []
    pages = {"https://example.org/": (200, {"content-type": "text/html"}, "  \n")}
    monkeypatch.setattr(reader, "_get", lambda url, d: calls.append(url) or _site(pages)(url, d))
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "SITE_CLOSED" and error.value.reason == "빈 페이지"
    assert error.value.message == "홈페이지가 닫혀 있습니다(빈 페이지)."


def test_robots_moved_to_expiry_notice_and_empty_body_is_hosting_expired(monkeypatch):
    """삼진볼트 모양(2026-11-16 확인): robots.txt는 만료 안내로 이동, 첫 화면은 200·0바이트."""
    pages = {
        "http://example.org/robots.txt": (302, {"location": EXPIRED}, ""),
        EXPIRED: (200, {"content-type": "text/html"}, "<p>서비스 기간이 만료되었습니다</p>"),
        "http://example.org/": (200, {"content-type": "text/html"}, ""),
    }
    monkeypatch.setattr(reader, "_get", _site(pages))
    with pytest.raises(AppError) as error:
        reader.fetch("http://example.org/", time.monotonic() + 60)
    assert error.value.kind == "SITE_CLOSED" and error.value.reason == "호스팅 만료"


def test_page_moved_to_expiry_notice_is_closed_and_notice_is_not_read(monkeypatch):
    calls = []
    pages = {
        "https://example.org/": (302, {"location": EXPIRED}, ""),
        EXPIRED: (200, {"content-type": "text/html"}, "<p>서비스 기간이 만료되었습니다</p>"),
    }
    monkeypatch.setattr(reader, "_get", lambda url, d: calls.append(url) or _site(pages)(url, d))
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "SITE_CLOSED" and error.value.reason == "호스팅 만료"
    assert EXPIRED not in calls


def test_same_site_page_named_expired_is_read_normally(monkeypatch):
    """같은 사이트 안의 이동은 주소에 expir가 있어도 닫힌 것으로 보지 않는다."""
    pages = {
        "https://example.org/": (302, {"location": "/expired-stock"}, ""),
        "https://example.org/expired-stock": (
            200,
            {"content-type": "text/html"},
            "<p>재고 정리 볼트를 판매합니다.</p>",
        ),
    }
    monkeypatch.setattr(reader, "_get", _site(pages))
    page = reader.fetch("https://example.org/", time.monotonic() + 60)
    assert page.text == "재고 정리 볼트를 판매합니다."


def closed_fetch(url, deadline):
    raise reader._site_closed("호스팅 만료")


def test_closed_homepage_becomes_not_found_without_ai(extract_env, monkeypatch):
    """Given AI가 찾은 주소가 닫혀 있음 / When 조사 / Then AI를 부르지 않고 '홈페이지 못 찾음',
    주소는 비우고 이전 주소를 이유 글에 남긴다."""
    case, transport = extract_env
    found_company(case)
    monkeypatch.setattr(flow_extract, "fetch", closed_fetch)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "SITE_CLOSED"
    assert transport.call_count == 0
    customer, _ = company(case)
    assert (customer.homepage_status, customer.homepage_url) == ("NOT_FOUND", None)
    assert customer.homepage_reason == f"[닫힘] 호스팅 만료 · 이전 주소 {URL}"
    assert closed_homepage_reason(customer.homepage_status, customer.homepage_reason) == (
        "호스팅 만료"
    )
    assert customer.fit_level == "MEDIUM"


def test_staff_confirmed_closed_homepage_is_kept(extract_env, monkeypatch):
    """Given 담당자가 확정한 주소 / Then 닫혀 있어도 주소·상태는 그대로이고 오류만 낸다."""
    case, _ = extract_env
    found_company(case)
    with session_scope() as session:
        session.get(Customer, case.customer_id).homepage_status = "CONFIRMED"
    monkeypatch.setattr(flow_extract, "fetch", closed_fetch)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "SITE_CLOSED"
    customer, _ = company(case)
    assert (customer.homepage_status, customer.homepage_url) == ("CONFIRMED", URL)


def test_other_address_closed_does_not_touch_saved_homepage(extract_env, monkeypatch):
    """다른 주소를 읽다 닫혀 있으면 저장된 주소는 건드리지 않는다."""
    case, _ = extract_env
    found_company(case)
    monkeypatch.setattr(flow_extract, "fetch", closed_fetch)
    result = flow_extract.run_extract(case.opp_id, "https://other.example.org/")
    assert not result.ok
    customer, _ = company(case)
    assert (customer.homepage_status, customer.homepage_url) == ("AI_FOUND", URL)


@pytest.mark.parametrize(
    ("status", "reason", "expected"),
    [
        ("NOT_FOUND", "[닫힘] 빈 페이지 · 이전 주소 http://a.example", "빈 페이지"),
        ("NOT_FOUND", "검색 결과 없음", None),
        ("AI_FOUND", "[닫힘] 호스팅 만료 · 이전 주소 x", None),
        ("NOT_FOUND", None, None),
    ],
)
def test_closed_reason_reads_only_our_mark(status, reason, expected):
    assert closed_homepage_reason(status, reason) == expected


# ---------- 화면이 받는 칸 ----------


def test_detail_header_carries_fit_basis_and_closed_reason(extract_env, monkeypatch):
    case, transport = extract_env
    found_company(case, fit_level="MEDIUM")
    ai_says(transport, "HIGH")
    assert flow_extract.run_extract(case.opp_id, URL).ok
    with TestClient(create_app()) as client:
        header = client.get(f"/api/v1/opportunities/{case.opp_id}").json()["data"]["header"]
        assert (header["fitLevel"], header["fitBasis"], header["previousFitLevel"]) == (
            "HIGH",
            "HOMEPAGE",
            "MEDIUM",
        )
        assert header["homepageClosedReason"] is None
        monkeypatch.setattr(flow_extract, "fetch", closed_fetch)
        with session_scope() as session:
            customer = session.get(Customer, case.customer_id)
            customer.homepage_url, customer.homepage_status = URL, "AI_FOUND"
        assert not flow_extract.run_extract(case.opp_id, URL).ok
        header = client.get(f"/api/v1/opportunities/{case.opp_id}").json()["data"]["header"]
        assert header["homepageClosedReason"] == "호스팅 만료"
        assert header["homepageStatus"] == "NOT_FOUND"


def test_old_found_company_reads_as_product_basis(extract_env):
    case, _ = extract_env
    found_company(case)
    with TestClient(create_app()) as client:
        header = client.get(f"/api/v1/opportunities/{case.opp_id}").json()["data"]["header"]
    assert (header["fitBasis"], header["previousFitLevel"]) == ("PRODUCT", None)


def test_answer_fixture_round_trips():
    """시험용 AI 답 모양이 새 칸까지 그대로 읽힌다."""
    assert Extraction.model_validate_json(json.dumps(support.answer())).fit_review.fit_level is None
