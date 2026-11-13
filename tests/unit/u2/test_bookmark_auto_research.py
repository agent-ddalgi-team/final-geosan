"""#690 단위 검사: 하루 건수 설정, robots.txt 응답 읽는 법, 읽기 실패 이유, 조사 상태 값.

실제 홈페이지 접속·AI 호출은 없다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import socket
import ssl
import time
from pathlib import Path
from unittest.mock import Mock

import pytest
import yaml

from geosan.api import auto_research
from geosan.api.ingest_views import research_state
from geosan.config.app_settings import (
    check_app_settings_file,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence import reader
from geosan.evidence.transfer import TransferLog, record_search_rejection
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract, research
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"

# ---------- 설정 research.autoOnBookmarkDailyCostUsd ----------


@pytest.mark.parametrize("name", ["app-settings.yaml", "app-settings-virtual.yaml"])
def test_example_settings_start_at_one_dollar_a_day(name):
    """Given 예시 설정 두 벌 / Then 관심 자동 조사 하루 금액의 초기값은 1.0달러다."""
    assert load_app_settings(EXAMPLES / name).research.auto_on_bookmark_daily_cost_usd == 1.0


def test_settings_file_without_research_section_keeps_the_feature_off(tmp_path):
    """Given research 묶음이 없는 설정 파일 / Then 0(꺼짐)으로 읽는다."""
    data = yaml.safe_load((EXAMPLES / "app-settings.yaml").read_text(encoding="utf-8"))
    data.pop("research")
    path = tmp_path / "no-research.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    assert load_app_settings(path).research.auto_on_bookmark_daily_cost_usd == 0


@pytest.mark.parametrize("value", [-0.1, "1.0", True, float("inf"), float("nan")])
def test_daily_cost_must_be_a_non_negative_finite_number(tmp_path, value):
    data = yaml.safe_load((EXAMPLES / "app-settings.yaml").read_text(encoding="utf-8"))
    data["research"]["autoOnBookmarkDailyCostUsd"] = value
    path = tmp_path / "invalid.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    result = check_app_settings_file(path)
    assert not result.ok
    assert any(error.path == "research.autoOnBookmarkDailyCostUsd" for error in result.errors)


@pytest.mark.parametrize("value", [0, 0.3, 2])
def test_daily_cost_accepts_zero_and_decimals(tmp_path, value):
    data = yaml.safe_load((EXAMPLES / "app-settings.yaml").read_text(encoding="utf-8"))
    data["research"]["autoOnBookmarkDailyCostUsd"] = value
    path = tmp_path / "valid.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    assert load_app_settings(path).research.auto_on_bookmark_daily_cost_usd == value


def test_old_database_copy_without_the_key_reads_the_example_value(tmp_db, app_settings_path):
    """Given #690 전에 만든 설정 사본(칸 없음) / Then 예시 파일 값으로 읽고 다른 칸은 그대로다."""
    settings = load_app_settings(app_settings_path)
    settings.research.stale_after_days = 45
    with session_scope() as session:
        sync_app_settings(session, settings)
        session.get(AppSetting, "research").value = {"staleAfterDays": 45}
    with session_scope() as session:
        research_settings = read_app_settings(session).research
    assert research_settings.stale_after_days == 45
    assert research_settings.auto_on_bookmark_daily_cost_usd == 1.0


# ---------- robots.txt 응답 ----------


@pytest.mark.parametrize("status", [400, 404, 405, 410, 418])
def test_missing_robots_file_means_no_restriction(status):
    assert reader._robots_missing(status)


@pytest.mark.parametrize("status", [200, 301, 401, 403, 429, 500, 503, 508])
def test_other_robots_answers_are_not_treated_as_missing(status):
    assert not reader._robots_missing(status)


def _site(monkeypatch, robots):
    calls = []

    def get(url, _):
        calls.append(url)
        if url in robots:
            return robots[url]
        return 200, {"content-type": "text/html"}, "<p>본문</p>"

    monkeypatch.setattr(reader, "_get", get)
    return calls


def test_wrong_robots_redirect_ending_in_400_is_read(monkeypatch):
    """Given robots.txt가 잘못된 주소로 옮겨져 400 / Then 금지가 아니라 "없음"으로 읽는다."""
    calls = _site(
        monkeypatch,
        {
            "https://example.org/robots.txt": (301, {"location": "/error?code=400"}, ""),
            "https://example.org/error?code=400": (400, {}, "Bad Request"),
        },
    )
    assert reader.fetch("https://example.org/", time.monotonic() + 30).text == "본문"
    assert calls[-1] == "https://example.org/"


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_refusing_or_broken_robots_answers_are_still_not_read(monkeypatch, status):
    calls = _site(monkeypatch, {"https://example.org/robots.txt": (status, {}, "")})
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 30)
    assert error.value.kind == "ROBOTS_DISALLOW"
    assert all(url.endswith("/robots.txt") for url in calls)


def test_robots_rules_after_a_redirect_are_still_kept(monkeypatch):
    """Given 옮겨 간 robots.txt가 정상으로 내려왔고 금지 / Then 읽지 않는다(규칙은 그대로)."""
    calls = _site(
        monkeypatch,
        {
            "https://example.org/robots.txt": (301, {"location": "/r.txt"}, ""),
            "https://example.org/r.txt": (200, {}, "User-agent: *\nDisallow: /"),
        },
    )
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 30)
    assert error.value.kind == "ROBOTS_DISALLOW"
    assert "https://example.org/" not in calls


# ---------- 읽기 실패 이유 ----------


@pytest.mark.parametrize(
    "raised,reason",
    [
        (ssl.SSLCertVerificationError("만료"), "인증서 문제"),
        (socket.gaierror(8, "nodename nor servname provided"), "주소를 찾을 수 없음"),
        (TimeoutError("timed out"), "시간 초과"),
        (ConnectionResetError("reset"), "그 밖"),
        (ValueError("본문이 너무 큼"), "그 밖"),
    ],
)
def test_unreachable_message_names_the_reason(monkeypatch, raised, reason):
    """Given 읽기 실패 / Then kind는 그대로 UNREACHABLE이고 이유가 문장에 구분돼 남는다."""

    def get(url, _):
        raise raised

    monkeypatch.setattr(reader, "_get", get)
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 30)
    assert error.value.kind == "UNREACHABLE"
    assert error.value.message == f"홈페이지를 읽을 수 없습니다. ({reason})"


def test_certificate_check_is_never_turned_off():
    """인증서 문제는 고치지 않는다: 읽기 코드에 검증을 끄는 설정이 없다."""
    source = Path(reader.__file__).read_text(encoding="utf-8")
    assert "CERT_NONE" not in source and "check_hostname = False" not in source
    assert "_create_unverified_context" not in source


# ---------- 조사 한 곳: 읽기 실패 기록, 홈페이지 찾기 끄기 ----------


def _logs(opp_id):
    with session_scope() as session:
        rows = session.scalars(
            select_logs(opp_id).order_by(TransferLog.occurred_at, TransferLog.transfer_log_id)
        ).all()
        return [(row.requested_by, row.decision, row.reject_reason, row.call_count) for row in rows]


def select_logs(opp_id):
    from sqlalchemy import select

    return select(TransferLog).where(TransferLog.opp_id == opp_id)


def test_read_failure_of_automatic_research_leaves_a_reason_row(homepage_env, monkeypatch):
    """Given 자동 조사가 홈페이지를 못 읽음 / Then 이유가 전송 기록 거부 1행으로 남는다."""
    _, case, transport = homepage_env

    def get(url, _):
        raise socket.gaierror(8, "nodename nor servname provided")

    monkeypatch.setattr(reader, "_get", get)
    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)
    result = research.research_one(case.opp_id)
    assert result.error is not None and result.error.kind == "UNREACHABLE"
    assert transport.call_count == 0
    assert _logs(case.opp_id) == [
        (
            "system",
            "REJECTED",
            "자동 조사 중단 · 홈페이지를 읽을 수 없습니다. (주소를 찾을 수 없음)",
            0,
        )
    ]


def test_research_without_address_can_skip_the_homepage_search(homepage_env, monkeypatch):
    """Given 주소 없는 회사 / When 찾기 없이 조사 / Then 검색도 AI도 부르지 않는다."""
    _, case, transport = homepage_env
    with session_scope() as session:
        session.get(Customer, case.customer_id).homepage_url = None
    search = Mock(side_effect=AssertionError("홈페이지 찾기 검색을 부르면 안 됩니다"))
    monkeypatch.setattr(research, "find_case_homepage", search)
    result = research.research_one(case.opp_id, find_homepage=False)
    assert result.error is None and result.evidence_count == 0
    assert search.call_count == 0 and transport.call_count == 0


# ---------- 조사 상태 ----------


@pytest.fixture
def found_company(homepage_env):
    """후보 찾기로 들어온, 홈페이지는 있고 조사 전인 회사 모양."""
    _, case, _ = homepage_env
    with session_scope() as session:
        session.get(Opportunity, case.opp_id).is_virtual = False
        customer = session.get(Customer, case.customer_id)
        customer.ingest_batch_id = "batch-690"
        customer.researched_at = None
    auto_research._started.clear()
    yield case
    auto_research._started.clear()


def _state(case):
    with session_scope() as session:
        return research_state(session.get(Customer, case.customer_id), None, scored=False)


def _skip(case, reason=auto_research.LIMIT_REASON):
    with session_scope() as session:
        opportunity = session.get(Opportunity, case.opp_id)
        session.add(auto_research._marker(opportunity, reject_reason=reason))


def test_unresearched_company_with_homepage_stays_read_failed(found_company):
    assert _state(found_company) == "READ_FAILED"


def test_company_skipped_by_the_daily_cost_shows_limit_skipped(found_company):
    """Given 하루 금액 한도 때문에 돌지 않음 / Then "읽기 실패"가 아니라 LIMIT_SKIPPED."""
    _skip(found_company)
    assert _state(found_company) == "LIMIT_SKIPPED"


def test_other_rejection_of_an_automatic_call_is_not_limit_skipped(found_company):
    """Given 자동 조사의 AI 호출이 다른 이유(월 한도 등)로 거부 / Then LIMIT_SKIPPED가 아니다."""
    _skip(found_company, "이번 달 비용 한도 초과")
    assert _state(found_company) == "READ_FAILED"


def test_spent_today_adds_only_automatic_calls_and_estimates_unconfirmed(found_company):
    """Given 오늘의 호출 행들 / Then 관심 자동 조사 것만, 사용량 미확정은 추정 비용으로 더한다."""
    from decimal import Decimal

    with session_scope() as session:
        opportunity = session.get(Opportunity, found_company.opp_id)
        llm = read_app_settings(session).llm
        for requester, cost, calls in [
            ("auto-bookmark", Decimal("0.02"), 1),
            ("auto-bookmark", None, 1),  # 사용량을 못 받은 호출
            ("auto-bookmark", None, 0),  # 시작 표시 행
            ("system", Decimal("5"), 1),  # 다른 조사
        ]:
            row = auto_research._marker(opportunity, reject_reason=None)
            row.requested_by, row.cost_usd, row.call_count = requester, cost, calls
            session.add(row)
        session.flush()
        expected = Decimal("0.02") + Decimal(str(llm.unconfirmed_call_cost_usd))
        assert auto_research.spent_today(session, llm) == expected


def test_later_research_attempt_replaces_limit_skipped(found_company):
    """Given 건너뛴 뒤 다른 조사가 읽기에서 멈춤 / Then 다시 "읽기 실패"로 보인다."""
    _skip(found_company)
    time.sleep(0.01)
    record_search_rejection(
        found_company.opp_id, "자동 조사 중단 · 가짜 이유", None, purpose="EXTERNAL_AI"
    )
    assert _state(found_company) == "READ_FAILED"


def test_company_being_researched_after_bookmark_is_running(found_company):
    """Given 관심으로 시작된 조사가 도는 중 / Then "조사 중", 끝나면 저장된 값대로."""
    auto_research._started[found_company.opp_id] = time.monotonic()
    assert _state(found_company) == "RUNNING"
    auto_research._started[found_company.opp_id] = (
        time.monotonic() - auto_research._RUNNING_SECONDS - 1
    )
    assert _state(found_company) == "READ_FAILED"
    assert not auto_research.any_running()


def test_queue_does_nothing_outside_a_request(found_company):
    """Given 요청 밖(명령·테스트)에서 관심 함수가 불림 / Then 기록도 예약도 없다."""
    with session_scope() as session:
        auto_research.queue_on_bookmark(session, session.get(Opportunity, found_company.opp_id))
    assert _logs(found_company.opp_id) == []
    assert not auto_research.is_running(found_company.opp_id)
