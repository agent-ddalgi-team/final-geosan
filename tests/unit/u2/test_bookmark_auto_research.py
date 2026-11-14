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
    """Given 자동 조사가 한도가 아닌 이유(설정 미완료 등)로 거부 / Then LIMIT_SKIPPED가 아니다.

    (바뀜 #719) 예전에는 월 한도 거부도 여기서 "읽기 실패"로 고정했다. 월 한도는 아래 검사로 옮겼다.
    """
    _skip(found_company, "가짜 거부 이유(한도 아님)")
    assert _state(found_company) == "READ_FAILED"


@pytest.mark.parametrize("reason", ["이번 달 비용 한도 초과", "이번 달 호출 한도 초과"])
@pytest.mark.parametrize("requester", ["auto-bookmark", "system", "park-lee"])
def test_monthly_limit_rejection_shows_limit_not_read_failure(found_company, reason, requester):
    """Given 조사가 월 한도로 거부됨 / Then "읽기 실패"가 아니라 한도로 조사 안 함 (#719)."""
    from geosan.evidence import transfer

    assert reason in transfer.MONTHLY_LIMIT_REASONS
    with session_scope() as session:
        row = auto_research._marker(
            session.get(Opportunity, found_company.opp_id), reject_reason=reason
        )
        row.requested_by = requester
        session.add(row)
    assert _state(found_company) == "LIMIT_SKIPPED"


def test_daily_limit_reason_from_another_requester_is_not_limit_skipped(found_company):
    """하루 금액 한도 문구는 관심 자동 조사가 남긴 행일 때만 한도로 본다(그대로)."""
    with session_scope() as session:
        row = auto_research._marker(
            session.get(Opportunity, found_company.opp_id),
            reject_reason=auto_research.LIMIT_REASON,
        )
        row.requested_by = "system"
        session.add(row)
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


# ---------- #719: 방금 시작한 조사도 하루 금액에 예상 비용으로 센다 ----------


def _start_marker(session, opportunity, *, opp_id=None, seconds_ago=0):
    from datetime import timedelta

    row = auto_research._marker(opportunity, reject_reason=None)
    row.opp_id = opp_id or opportunity.opp_id
    row.occurred_at = row.occurred_at - timedelta(seconds=seconds_ago)
    session.add(row)
    return row


def _spent(session):
    return auto_research.used_today(session, read_app_settings(session))


def test_just_started_research_counts_as_the_estimated_cost(found_company):
    """Given 시작 표시만 있고 AI 호출 행이 아직 없는 조사 2곳 / Then 예상 비용 2곳만큼 센다."""
    from decimal import Decimal

    with session_scope() as session:
        opportunity = session.get(Opportunity, found_company.opp_id)
        settings = read_app_settings(session)
        estimate = Decimal(str(settings.ingestion.cost_estimate.research_usd_per_company))
        _start_marker(session, opportunity, opp_id="opp-719-a")
        _start_marker(session, opportunity, opp_id="opp-719-b")
        session.flush()
        assert _spent(session) == estimate * 2


def test_started_research_is_not_counted_twice_once_its_call_row_exists(found_company):
    """Given 시작 표시 뒤 그 회사의 AI 호출 행이 생김 / Then 실제 비용만 센다(예상 비용은 뺀다)."""
    from datetime import timedelta
    from decimal import Decimal

    with session_scope() as session:
        opportunity = session.get(Opportunity, found_company.opp_id)
        marker = _start_marker(session, opportunity, seconds_ago=5)
        call = auto_research._marker(opportunity, reject_reason=None)
        call.call_count, call.cost_usd = 1, Decimal("0.03")
        call.occurred_at = marker.occurred_at + timedelta(seconds=3)
        session.add(call)
        session.flush()
        assert _spent(session) == Decimal("0.03")


def test_started_research_that_ended_with_a_rejection_is_not_counted(found_company):
    """Given 시작 표시 뒤 읽기 실패 거부 행 / Then 끝난 조사라 예상 비용을 세지 않는다."""
    with session_scope() as session:
        _start_marker(session, session.get(Opportunity, found_company.opp_id), seconds_ago=5)
    record_search_rejection(
        found_company.opp_id, "자동 조사 중단 · 가짜 이유", None, purpose="EXTERNAL_AI"
    )
    with session_scope() as session:
        assert _spent(session) == 0


def test_start_marker_older_than_one_research_is_not_counted(found_company):
    """Given 조사 한 곳 최대 시간보다 오래된 시작 표시 / Then 세지 않는다(서버가 꺼졌던 경우)."""
    with session_scope() as session:
        opportunity = session.get(Opportunity, found_company.opp_id)
        _start_marker(session, opportunity, seconds_ago=auto_research._RUNNING_SECONDS + 5)
        session.flush()
        assert _spent(session) == 0


# ---------- #719: 관심 자동 조사는 어떤 이유로 실패해도 이유 1행을 남긴다 ----------

SECRET = "가짜 본문 https://example.org/private 010-1234-5678 hong@example.org"


def _drop_evidence(case):
    """조사 전 모양: 살아 있는 근거 0건."""
    from sqlalchemy import update

    from geosan.evidence.models import Evidence
    from geosan.storage.base import utcnow

    with session_scope() as session:
        session.execute(
            update(Evidence).where(Evidence.opp_id == case.opp_id).values(superseded_at=utcnow())
        )


def _fail_with(monkeypatch, error, *, before=None):
    def fake(opp_id, **_):
        if before is not None:
            before(opp_id)
        if isinstance(error, Exception) and not isinstance(error, AppError):
            raise error
        return research.ResearchResult(error=error)

    monkeypatch.setattr(auto_research, "research_one", fake)


@pytest.mark.parametrize(
    "error,label",
    [
        (AppError(SECRET, "다시 조사해 주세요.", status=503, kind="LLM_FAILED"), "LLM_FAILED"),
        (
            AppError(SECRET, "현재 기회를 확인해 주세요.", status=409, kind="STALE_VALUE"),
            "STALE_VALUE",
        ),
        (research.RunFailedError(SECRET), "RUN_FAILED"),
        (RuntimeError(SECRET), "RUN_FAILED"),
    ],
)
def test_any_failure_of_bookmark_research_leaves_one_reason_row(
    found_company, monkeypatch, error, label
):
    """Given 읽기 실패가 아닌 실패 / Then 정해진 문구와 오류 종류만 든 거부 1행이 남는다."""
    _fail_with(monkeypatch, error)
    auto_research.run_auto_research(found_company.opp_id)
    assert _logs(found_company.opp_id) == [
        ("system", "REJECTED", f"자동 조사 중단 · 조사를 끝내지 못했습니다 ({label})", 0)
    ]
    assert not auto_research.is_running(found_company.opp_id)


def test_failure_already_recorded_by_the_research_is_not_recorded_twice(found_company, monkeypatch):
    """Given 조사가 이미 거부 행(읽기 실패·월 한도)을 남김 / Then 한 행을 더 쓰지 않는다."""
    error = AppError(
        "홈페이지를 읽을 수 없습니다. (그 밖)", "나중에", status=502, kind="UNREACHABLE"
    )
    _fail_with(
        monkeypatch,
        error,
        before=lambda opp_id: record_search_rejection(
            opp_id,
            "자동 조사 중단 · 홈페이지를 읽을 수 없습니다. (그 밖)",
            None,
            purpose="EXTERNAL_AI",
        ),
    )
    auto_research.run_auto_research(found_company.opp_id)
    assert [row[2] for row in _logs(found_company.opp_id)] == [
        "자동 조사 중단 · 홈페이지를 읽을 수 없습니다. (그 밖)"
    ]


def test_successful_bookmark_research_leaves_no_reason_row(found_company, monkeypatch):
    monkeypatch.setattr(auto_research, "research_one", lambda *_, **__: research.ResearchResult())
    auto_research.run_auto_research(found_company.opp_id)
    assert _logs(found_company.opp_id) == []


def test_running_mark_is_set_only_when_the_research_really_starts(found_company, monkeypatch):
    """Given 관심 저장이 조사를 예약한 뒤 저장이 되돌려짐 / Then "조사 중" 표시가 남지 않는다.

    표시는 응답 뒤 조사가 실제로 시작될 때 켜지고 끝나면 꺼진다.
    """
    from fastapi import BackgroundTasks

    _drop_evidence(found_company)
    tasks = BackgroundTasks()
    token = auto_research._tasks.set(tasks)
    try:
        with session_scope() as session:
            auto_research.queue_on_bookmark(session, session.get(Opportunity, found_company.opp_id))
            session.rollback()
    finally:
        auto_research._tasks.reset(token)
    assert len(tasks.tasks) == 1
    assert not auto_research.is_running(found_company.opp_id)
    seen = []
    monkeypatch.setattr(
        auto_research,
        "research_one",
        lambda opp_id, **_: (
            seen.append(auto_research.is_running(opp_id)) or research.ResearchResult()
        ),
    )
    auto_research.run_auto_research(found_company.opp_id)
    assert seen == [True]
    assert not auto_research.is_running(found_company.opp_id)


# ---------- #719 품질 검토: 안전장치마다 그 줄을 지우면 실패하는 검사 ----------


def _queue(case):
    """요청 안에서 관심이 켜진 것처럼 예약 함수를 부른다. 예약된 조사 수를 돌려준다."""
    from fastapi import BackgroundTasks

    tasks = BackgroundTasks()
    token = auto_research._tasks.set(tasks)
    try:
        with session_scope() as session:
            auto_research.queue_on_bookmark(session, session.get(Opportunity, case.opp_id))
    finally:
        auto_research._tasks.reset(token)
    return len(tasks.tasks)


@pytest.fixture
def unresearched(found_company):
    """관심을 켜면 조사가 예약되는 모양(실제 자료 · 공개 등급 · 홈페이지 있음 · 근거 0건)."""
    _drop_evidence(found_company)
    return found_company


def test_ready_company_is_queued_once_with_a_start_row(unresearched):
    """아래 검사들의 기준: 조건을 다 갖춘 회사는 예약되고 시작 표시 1행이 남는다."""
    assert _queue(unresearched) == 1
    assert _logs(unresearched.opp_id) == [("auto-bookmark", "ALLOWED", None, 0)]


def test_virtual_company_is_never_queued(unresearched):
    """Given 가상 회사 / When 관심이 켜짐 / Then 조사도 기록도 없다(가상 자료는 밖으로 안 나감)."""
    with session_scope() as session:
        session.get(Opportunity, unresearched.opp_id).is_virtual = True
    assert _queue(unresearched) == 0
    assert _logs(unresearched.opp_id) == []


def test_opportunity_that_is_not_a_new_proposal_is_never_queued(unresearched):
    """Given 신규 제안이 아닌 건(재접촉) / Then 조사도 기록도 없다."""
    with session_scope() as session:
        session.get(Opportunity, unresearched.opp_id).purpose = "REORDER_CHECK"
    assert _queue(unresearched) == 0
    assert _logs(unresearched.opp_id) == []


def test_company_that_is_not_public_grade_is_never_queued(unresearched):
    """Given 공개 등급이 아닌 회사 / Then 조사도 기록도 없다."""
    with session_scope() as session:
        session.get(Customer, unresearched.customer_id).security_grade = "INTERNAL_ONLY"
    assert _queue(unresearched) == 0
    assert _logs(unresearched.opp_id) == []


def test_yesterdays_spend_does_not_count_against_today(unresearched):
    """Given 어제(한국 시간 자정 전) 하루 금액을 넘게 씀 / Then 오늘은 0원이고 조사가 예약된다."""
    from datetime import timedelta
    from decimal import Decimal

    with session_scope() as session:
        opportunity = session.get(Opportunity, unresearched.opp_id)
        row = auto_research._marker(opportunity, reject_reason=None)
        row.opp_id, row.call_count, row.cost_usd = "opp-719-yesterday", 1, Decimal("50")
        row.occurred_at = auto_research._day_start() - timedelta(minutes=1)
        session.add(row)
        session.flush()
        assert auto_research.spent_today(session, read_app_settings(session).llm) == 0
    assert _queue(unresearched) == 1


def test_same_company_is_not_queued_twice_while_its_research_is_pending(unresearched):
    """Given 예약만 되고 아직 끝나지 않은 조사 / When 관심을 껐다 켜 다시 예약 / Then 1번만."""
    assert _queue(unresearched) == 1
    assert _queue(unresearched) == 0
    assert _logs(unresearched.opp_id) == [("auto-bookmark", "ALLOWED", None, 0)]


def test_company_whose_research_is_running_is_not_queued_again(unresearched):
    """Given 이 서버에서 조사가 도는 중(시작 표시는 오래돼 안 보임) / Then 다시 예약하지 않는다."""
    auto_research._started[unresearched.opp_id] = time.monotonic()
    assert _queue(unresearched) == 0
    assert _logs(unresearched.opp_id) == []
