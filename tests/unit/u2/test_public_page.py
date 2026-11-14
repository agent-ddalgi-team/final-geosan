"""#511: 공식 홈페이지가 없는 회사의 공개 페이지.

설정, 버리기 규칙, 검색 요청·응답 모양, 약한 등급 상한을 본다.
"""

import json
from pathlib import Path

import pytest
import yaml

from geosan.config.app_settings import (
    check_app_settings_file,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.models import AppSetting
from geosan.evidence import openai_search
from geosan.evidence.extraction import Extraction
from geosan.evidence.homepage import (
    HomepageSearchResult,
    _apply_public_page_rule,
    unofficial_page_kind,
)
from geosan.evidence.models import Evidence
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from geosan.workflows.flow_extract import cap_to_weak
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

search_env = support.search_env
extract_env = support.extract_env
EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
BLOCKED = ["saramin.co.kr", "nicebizinfo.com"]


def _write(tmp_path, change):
    data = yaml.safe_load((EXAMPLES / "app-settings.yaml").read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "settings.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


def _found(url, kind=None, confidence=0.9):
    return HomepageSearchResult.model_validate(
        {
            "provider": "OPENAI_WEB_SEARCH",
            "url": url,
            "confidence": confidence,
            "reason": "가상 검색 응답",
            "fetchedAt": "2026-11-14T09:00:00+09:00",
            "pageKind": kind,
        }
    )


# ---------- 설정 ----------


@pytest.mark.parametrize("name", ["app-settings.yaml", "app-settings-virtual.yaml"])
def test_example_settings_start_switched_off(name):
    """Given 예시 설정 두 벌 / Then 공개 페이지 받기는 꺼져 있다(PM이 켠다)."""
    assert load_app_settings(EXAMPLES / name).research.allow_unofficial_page is False


def test_settings_without_research_section_stay_off(tmp_path):
    path = _write(tmp_path, lambda data: data.pop("research"))
    assert load_app_settings(path).research.allow_unofficial_page is False


@pytest.mark.parametrize("value", ["true", 1, None])
def test_switch_must_be_true_or_false(tmp_path, value):
    path = _write(tmp_path, lambda data: data["research"].update(allowUnofficialPage=value))
    result = check_app_settings_file(path)
    assert not result.ok
    assert any(error.path == "research.allowUnofficialPage" for error in result.errors)


def test_switch_cannot_be_on_without_blocked_sites(tmp_path):
    """막는 사이트 목록이 비어 있으면 채용·유료 사이트를 버릴 수 없으므로 켤 수 없다."""

    def change(data):
        data["research"]["allowUnofficialPage"] = True
        data["candidateWebSearch"]["blockedDomains"] = []

    result = check_app_settings_file(_write(tmp_path, change))
    assert not result.ok
    assert "blockedDomains" in " ".join(error.message for error in result.errors)


def test_switch_can_be_on_with_blocked_sites(tmp_path):
    path = _write(tmp_path, lambda data: data["research"].update(allowUnofficialPage=True))
    assert load_app_settings(path).research.allow_unofficial_page is True


def test_old_database_copy_without_the_key_reads_off(tmp_db, app_settings_path):
    """Given #511 전에 만든 설정 사본(칸 없음) / Then 꺼짐으로 읽고 다른 칸은 그대로다."""
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(app_settings_path))
        session.get(AppSetting, "research").value = {
            "staleAfterDays": 45,
            "autoOnBookmarkDailyCostUsd": 0.5,
            "suggestAgainAfterDays": 7,
        }
    with session_scope() as session:
        research = read_app_settings(session).research
    assert research.allow_unofficial_page is False
    assert (research.stale_after_days, research.suggest_again_after_days) == (45, 7)


# ---------- 받을지 버릴지 ----------


def test_off_keeps_official_result_and_drops_unofficial_page():
    official = _found("https://example.org/")
    assert _apply_public_page_rule(official, allow=False, blocked_domains=BLOCKED) is official
    dropped = _apply_public_page_rule(
        _found("https://blog.example.org/a", "BLOG"), allow=False, blocked_domains=BLOCKED
    )
    assert dropped.url is None and dropped.page_kind is None
    assert dropped.status(0.7) == "NOT_FOUND"


def test_off_does_not_start_blocking_official_results():
    """꺼져 있으면 전과 똑같다: 공식으로 온 주소는 이 기능이 건드리지 않는다."""
    result = _found("https://www.saramin.co.kr/company/1")
    assert _apply_public_page_rule(result, allow=False, blocked_domains=BLOCKED) is result


@pytest.mark.parametrize(
    "url",
    [
        "https://saramin.co.kr/zf_user/company/1",
        "https://m.saramin.co.kr/company/1",
        "https://WWW.NiceBizInfo.com/ep/1",
    ],
)
@pytest.mark.parametrize("kind", ["OFFICIAL", "BLOG", "SNS", "SHOP", "PUBLIC_PAGE", None])
def test_on_drops_blocked_sites_whatever_kind_is_claimed(url, kind):
    result = _apply_public_page_rule(_found(url, kind), allow=True, blocked_domains=BLOCKED)
    assert result.url is None and result.status(0.0) == "NOT_FOUND"
    assert url not in result.reason


def test_on_does_not_block_lookalike_domain():
    result = _found("https://notsaramin.co.kr/", "OFFICIAL")
    kept = _apply_public_page_rule(result, allow=True, blocked_domains=BLOCKED)
    assert kept.url == "https://notsaramin.co.kr/"


@pytest.mark.parametrize("kind", ["BLOG", "SNS", "SHOP", "PUBLIC_PAGE"])
def test_on_marks_unofficial_page_and_never_reports_found(kind):
    result = _apply_public_page_rule(
        _found("https://blog.example.org/company", kind, confidence=1.0),
        allow=True,
        blocked_domains=BLOCKED,
    )
    assert result.reason == f"[공식 아님:{kind}] 가상 검색 응답"
    assert result.status(0.7) == result.status(0.0) == "NEEDS_CONFIRMATION"
    assert unofficial_page_kind("NEEDS_CONFIRMATION", "AI", result.reason) == kind


@pytest.mark.parametrize(
    "url",
    [
        "https://blog.example.org/담당자-홍길동",
        "https://blog.example.org/post?tel=010-1234-5678",
        "https://user:pw@blog.example.org/",
    ],
)
def test_on_drops_unofficial_page_whose_address_has_person_or_contact(url):
    if "user:pw" in url:
        with pytest.raises(ValueError):
            _found(url, "BLOG")
        return
    result = _apply_public_page_rule(_found(url, "BLOG"), allow=True, blocked_domains=BLOCKED)
    assert result.url is None


def test_unknown_page_kind_is_rejected():
    """뉴스 기사·기업 정보 모음 같은 종류는 받는 값에 없다."""
    for kind in ("NEWS", "DIRECTORY", "JOB"):
        with pytest.raises(ValueError):
            _found("https://example.org/", kind)


@pytest.mark.parametrize(
    "status,source,reason,expected",
    [
        ("NEEDS_CONFIRMATION", "AI", "[공식 아님:SHOP] 스토어", "SHOP"),
        ("CONFIRMED", "STAFF", "[공식 아님:SHOP] 스토어", None),
        ("NEEDS_CONFIRMATION", "AI", "확신도가 낮은 공식 홈페이지", None),
        ("NEEDS_CONFIRMATION", "AI", "설명 [공식 아님:BLOG] 가운데", None),
        ("NEEDS_CONFIRMATION", "AI", "[공식 아님:NEWS] 기사", None),
        ("NEEDS_CONFIRMATION", "AI", None, None),
        ("AI_FOUND", "AI", "[공식 아님:BLOG] 글", None),
        ("NOT_FOUND", "AI", "[공식 아님:BLOG] 글", None),
    ],
)
def test_page_kind_is_read_only_from_our_own_mark(status, source, reason, expected):
    assert unofficial_page_kind(status, source, reason) == expected


# ---------- 검색 요청·응답 모양 ----------


def test_request_is_identical_when_switched_off():
    assert openai_search._request("m", "가상기업", "충남 천안시") == openai_search._request(
        "m", "가상기업", "충남 천안시", False
    )
    body = openai_search._request("m", "가상기업", "충남 천안시")
    assert "pageKind" not in json.dumps(body)


def test_request_when_on_adds_one_answer_field_and_no_extra_search():
    off = openai_search._request("m", "가상기업", "충남 천안시")
    on = openai_search._request("m", "가상기업", "충남 천안시", True)
    assert on["max_tool_calls"] == off["max_tool_calls"] == 1
    assert on["tools"] == off["tools"] and on["input"] == off["input"]
    schema = on["text"]["format"]["schema"]
    assert schema["required"] == ["url", "confidence", "reason", "pageKind"]
    assert schema["properties"]["pageKind"]["enum"] == [
        "OFFICIAL",
        "BLOG",
        "SNS",
        "SHOP",
        "PUBLIC_PAGE",
        None,
    ]
    for word in ("채용 사이트", "기업 신용·재무 정보", "모음 사이트", "뉴스 기사", "새로 검색하지"):
        assert word in on["instructions"]
    assert "사람 이름" in on["instructions"]


def _reply(answer):
    response = search_support.provider_reply()
    response["output"][-1]["content"][0]["text"] = json.dumps(answer, ensure_ascii=False)
    return response


def test_answer_with_page_kind_is_a_format_error_when_switched_off():
    answer = {"url": "https://b.example.org/", "confidence": 0.3, "reason": "글"}
    answer["pageKind"] = "BLOG"
    with pytest.raises(ValueError):
        openai_search._result(_reply(answer))
    assert openai_search._result(_reply(answer), True).page_kind == "BLOG"


@pytest.mark.parametrize(
    "answer",
    [
        {"url": "https://b.example.org/", "confidence": 0.3, "reason": "글"},
        {"url": "https://b.example.org/", "confidence": 0.3, "reason": "글", "pageKind": None},
        {"url": None, "confidence": 0.1, "reason": "없음", "pageKind": "BLOG"},
        {"url": "https://b.example.org/", "confidence": 0.3, "reason": "글", "pageKind": "NEWS"},
    ],
)
def test_on_rejects_answers_whose_kind_is_missing_or_unknown(answer):
    """종류 없는 주소를 공식으로 넘겨짚지 않는다."""
    with pytest.raises(ValueError):
        openai_search._result(_reply(answer), True)


# ---------- 약한 등급 상한 ----------


def _extraction(**changes):
    data = support.answer()
    data.update(changes)
    return Extraction.model_validate(data)


def test_cap_lowers_strong_and_confirmed_but_keeps_unknown():
    evidence = [
        {**support.answer()["evidence"][0], "certaintyProposed": level}
        for level in ("CONFIRMED", "STRONG", "UNKNOWN")
    ]
    proposals = [
        {
            "itemCode": "NEW_PRODUCT",
            "matchRateStep": "해당",
            "certaintyProposed": "STRONG",
            "factJudged": "정밀 볼트를 생산한다",
            "quote": "정밀 볼트를 생산합니다.",
        }
    ]
    original = _extraction(evidence=evidence, itemInputProposals=proposals)
    capped = cap_to_weak(original)
    assert [item.certainty_proposed.value for item in capped.evidence] == [
        "WEAK",
        "WEAK",
        "UNKNOWN",
    ]
    assert [item.certainty_proposed for item in capped.item_input_proposals] == ["WEAK"]
    # 인용문·일치도 단계 같은 나머지 값과 원본은 그대로다.
    assert capped.evidence[0].quote == original.evidence[0].quote
    assert capped.item_input_proposals[0].match_rate_step == "해당"
    assert original.evidence[0].certainty_proposed.value == "CONFIRMED"


def _mark_unofficial(case, url):
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.homepage_url = url
        customer.homepage_status = "NEEDS_CONFIRMATION"
        customer.homepage_source = "AI"
        customer.homepage_reason = "[공식 아님:BLOG] 가상"


def _certainties(case):
    with session_scope() as session:
        return {
            row.certainty_proposed
            for row in session.query(Evidence).filter(
                Evidence.opp_id == case.opp_id,
                Evidence.is_llm_proposed.is_(True),
                Evidence.superseded_at.is_(None),
            )
        }


def test_pasted_text_for_unofficial_page_is_capped_too(extract_env):
    """robots가 막아 담당자가 본문을 붙여 넣어도 그 페이지의 글이므로 약한 추정까지만이다."""
    case, _ = extract_env
    _mark_unofficial(case, support.URL)
    result = flow_extract.run_extract(case.opp_id, pasted_text=support.BODY)
    assert result.ok, result.error
    assert _certainties(case) == {"WEAK"}


def test_official_homepage_keeps_strong_evidence(extract_env):
    case, _ = extract_env
    result = flow_extract.run_extract(case.opp_id, support.URL)
    assert result.ok, result.error
    assert _certainties(case) == {"STRONG"}


# ---------- #719: [맞음]으로 확인한 뒤에도 표시가 남아 있으면 보호를 유지한다 ----------


@pytest.mark.parametrize(
    "status,source,reason,expected",
    [
        ("NEEDS_CONFIRMATION", "AI", "[공식 아님:SHOP] 스토어", "SHOP"),
        ("CONFIRMED", "STAFF", "[공식 아님:SHOP] 스토어", "SHOP"),  # [맞음]으로 확인한 공개 페이지
        ("CONFIRMED", "STAFF", None, None),  # 담당자가 주소를 고쳐 넣음(이유 글이 비워짐)
        ("CONFIRMED", "STAFF", "확신도가 낮은 공식 홈페이지", None),
        ("AI_FOUND", "AI", "[공식 아님:BLOG] 글", None),
        ("NOT_FOUND", "AI", "[공식 아님:BLOG] 글", None),
    ],
)
def test_protection_stays_after_staff_confirms_the_page(status, source, reason, expected):
    from geosan.evidence.homepage import protected_page_kind

    assert protected_page_kind(status, source, reason) == expected


def test_confirmed_public_page_is_still_capped_and_phone_is_not_taken(extract_env):
    """Given [맞음]으로 확인한 블로그 주소 / When 다시 조사 / Then 약한 추정까지, 번호 없음."""
    case, _ = extract_env
    _mark_unofficial(case, support.URL)
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        customer.homepage_status, customer.homepage_source = "CONFIRMED", "STAFF"
        customer.main_phone = None
    result = flow_extract.run_extract(
        case.opp_id, pasted_text="대표전화 041-555-1234\n" + support.BODY
    )
    assert result.ok, result.error
    assert _certainties(case) == {"WEAK"}
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).main_phone is None
