"""#493: 실제 SQLite 한도·비용과 가상 OpenAI 응답. 유료 호출은 하지 않는다."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Barrier

import pytest

from geosan.capability.models import Process
from geosan.config.app_settings import CandidateWebSearchSettings, load_app_settings
from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.config.models import AppSetting
from geosan.evidence import transfer
from geosan.evidence.openai_search import _HttpError
from geosan.evidence.transfer import finish_search, reserve_candidate_search, reserve_search
from geosan.opportunity import candidate_web as web
from geosan.opportunity.models import IngestBatch
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import BATCH, logs, prepare, response, settings


@pytest.fixture
def ready(tmp_db, app_settings_path, monkeypatch):
    prepare(app_settings_path)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    calls = []

    def send(body, key):
        assert key == "synthetic"
        calls.append(body)
        return response()

    monkeypatch.setattr(web, "_post_response", send)
    return calls


def test_enabled_search_sends_only_selected_names_and_accounts_usage(ready):
    result = web.search_candidates(BATCH)
    assert len(result.candidates) == 1 and result.dropped_count == 0
    assert result.expires_at - result.searched_at == timedelta(days=15)
    assert json.loads(ready[0]["input"]) == {"processNames": ["전기아연도금"], "regions": ["충남"]}
    assert "PRIVATE_INTERNAL_MARKER" not in json.dumps(ready)
    assert "ZN" not in ready[0]["input"]
    assert ready[0]["store"] is False and ready[0]["max_tool_calls"] == 1
    assert "jobkorea.co.kr" in ready[0]["tools"][0]["filters"]["blocked_domains"]
    (row,) = logs()
    assert (row.batch_id, row.opp_id, row.requested_by, row.cost_usd) == (
        BATCH,
        None,
        "park-lee",
        Decimal("0.014"),
    )
    assert (row.input_tokens, row.output_tokens, row.web_search_calls) == (1000, 200, 1)
    assert row.is_virtual and row.kind == "WEB_SEARCH"
    assert "가상볼트" not in repr(row.__dict__) and "전기아연도금" not in repr(row.__dict__)


def test_disabled_daily_limit_and_homepage_daily_budget_are_independent(ready):
    settings(enabled=False)
    skipped = web.search_candidates(BATCH)
    assert skipped.skipped_reason == "DISABLED" and skipped.expires_at == skipped.searched_at
    assert not logs() and not ready
    settings(enabled=True, dailySearchLimit=1)
    finish_search(reserve_search("opp-test", True, None), 0, 0, 1, None)
    assert web.search_candidates(BATCH).skipped_reason is None
    assert web.search_candidates(BATCH).skipped_reason == "DAILY_LIMIT"
    assert len(ready) == 1 and logs()[-1].call_count == 0
    settings("homepageDiscovery", dailyCallLimit=1)
    with pytest.raises(AppError) as error:
        reserve_search("opp-test", True, None)
    assert error.value.kind == "SEARCH_LIMIT"


def test_monthly_cost_and_call_limit_are_shared_with_homepage(ready):
    web.search_candidates(BATCH)
    settings("llm", monthlyCallLimit=1)
    for call in [
        lambda: web.search_candidates(BATCH),
        lambda: reserve_search("opp-test", True, None),
    ]:
        with pytest.raises(AppError) as error:
            call()
        assert error.value.kind == "LLM_LIMIT"
    settings("llm", monthlyCallLimit=1000, monthlyCostLimitUsd=0.02)
    with pytest.raises(AppError) as error:
        web.search_candidates(BATCH)
    assert error.value.kind == "LLM_LIMIT" and len(ready) == 1


def test_unknown_usage_is_not_success_or_retried(ready, monkeypatch):
    monkeypatch.setattr(web, "_post_response", lambda *_: {"status": "completed"})
    with pytest.raises(AppError) as error:
        web.search_candidates(BATCH)
    assert error.value.kind == "LLM_FAILED" and logs()[0].cost_usd is None
    with pytest.raises(AppError) as error:
        reserve_search("opp-test", True, None)
    assert error.value.kind == "USAGE_UNCONFIRMED"


def test_bad_answer_accounts_cost_before_failing(ready, monkeypatch):
    data = response()
    data["output"][1]["content"][0]["text"] = "invalid"
    monkeypatch.setattr(web, "_post_response", lambda *_: data)
    with pytest.raises(AppError) as error:
        web.search_candidates(BATCH)
    assert error.value.kind == "LLM_FAILED" and logs()[0].cost_usd == Decimal("0.014")


def test_429_retries_once_with_a_new_reservation_and_rechecks_limit(ready, monkeypatch):
    calls = []

    def limited(*_):
        calls.append(1)
        raise _HttpError(429)

    monkeypatch.setattr(web, "_post_response", limited)
    with pytest.raises(AppError):
        web.search_candidates(BATCH)
    assert len(calls) == 2 and [r.cost_usd for r in logs()] == [0, 0]
    settings(dailySearchLimit=3)
    assert web.search_candidates(BATCH).skipped_reason == "DAILY_LIMIT"
    assert len(calls) == 3


def test_transport_failure_is_pending_and_key_is_never_in_error(ready, monkeypatch):
    def fail(*_):
        raise TimeoutError("PRIVATE_TRANSPORT_MARKER")

    monkeypatch.setattr(web, "_post_response", fail)
    with pytest.raises(AppError) as error:
        web.search_candidates(BATCH)
    assert "PRIVATE_TRANSPORT_MARKER" not in str(error.value)
    assert logs()[0].cost_usd is None


def test_input_guard_rejects_extra_values_changed_dataset_and_inactive_batch(ready):
    with session_scope() as session:
        batch = session.get(IngestBatch, BATCH)
        original = batch.criteria
    for changes in [
        {"criteria": original | {"memo": "PRIVATE_MEMO"}},
        {"criteria": original | {"processCodes": ["unknown"]}},
        {"criteria": original | {"regions": ["서울"]}},
        {"criteria": original | {"industries": ["unknown"]}},
        {"criteria": original | {"regions": [["충남"]]}},
        {"criteria": original | {"regions": []}},
        {"max_candidates": 51},
        {"dataset_kind": "BROCHURE"},
        {"status": "DONE"},
    ]:
        with session_scope() as session:
            batch = session.get(IngestBatch, BATCH)
            for key, value in changes.items():
                setattr(batch, key, value)
        with pytest.raises(InputError):
            web.search_candidates(BATCH)
        with session_scope() as session:
            batch = session.get(IngestBatch, BATCH)
            batch.criteria, batch.max_candidates, batch.dataset_kind, batch.status = (
                original,
                10,
                "VIRTUAL_REVIEWED",
                "RUNNING",
            )
    assert not ready and not logs()
    with pytest.raises(NotFoundError):
        web.search_candidates("missing")


def test_context_hash_changes_with_source_policy_names_and_prompt(ready, tmp_path, monkeypatch):
    before = web.load_search_context(BATCH).criteria_hash
    settings(blockedDomains=["jobkorea.co.kr"])
    after = web.load_search_context(BATCH).criteria_hash
    assert before != after
    with session_scope() as session:
        session.get(Process, "web-process").name = "새 공정 이름"
    assert web.load_search_context(BATCH).criteria_hash != after
    prompt = tmp_path / "prompt.md"
    prompt.write_text("changed", encoding="utf-8")
    monkeypatch.setattr(web, "PROMPT_PATH", prompt)
    assert web.load_search_context(BATCH).criteria_hash != after
    prompt.write_text("", encoding="utf-8")
    with pytest.raises(InputError):
        web.search_candidates(BATCH)
    with session_scope() as session:
        session.get(Process, "web-process").name = "문의 a@example.com"
    with pytest.raises(InputError):
        web.search_candidates(BATCH)
    assert not ready


def test_daily_limit_resets_at_korean_midnight(ready, monkeypatch):
    now = datetime(2026, 11, 9, 14, 59, tzinfo=UTC)
    monkeypatch.setattr(transfer, "utcnow", lambda: now)
    settings(dailySearchLimit=1)
    web.search_candidates(BATCH)
    assert web.search_candidates(BATCH).skipped_reason == "DAILY_LIMIT"
    now += timedelta(minutes=1)
    assert web.search_candidates(BATCH).skipped_reason is None


def test_concurrent_reservations_cannot_exceed_daily_limit(ready):
    settings(dailySearchLimit=1)
    barrier = Barrier(2)

    def reserve(_):
        barrier.wait(timeout=10)
        try:
            return reserve_candidate_search(BATCH, True)
        except AppError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, range(2)))
    assert sum(isinstance(r, AppError) and r.kind == "SEARCH_LIMIT" for r in results) == 1
    assert sum(r.call_count for r in logs()) == 1


def test_settings_defaults_and_unsafe_domains(app_settings_path):
    assert not CandidateWebSearchSettings().enabled
    config = load_app_settings(app_settings_path).candidate_web_search
    assert (
        config.enabled,
        config.daily_search_limit,
        config.cache_days,
        len(config.blocked_domains),
    ) == (False, 20, 15, 12)
    for values in [
        {"enabled": True},
        {"dailySearchLimit": True},
        {"cacheDays": 0},
        {"blockedDomains": ["https://jobkorea.co.kr"]},
        {"blockedDomains": ["jobkorea.co.kr", "JOBKOREA.CO.KR"]},
    ]:
        with pytest.raises(ValueError):
            CandidateWebSearchSettings.model_validate(values)


def test_old_settings_without_web_section_stay_disabled(tmp_db):
    with session_scope() as session:
        row = session.get(AppSetting, "candidateWebSearch")
        if row:
            session.delete(row)
    from geosan.config.app_settings import read_app_settings

    with session_scope() as session:
        assert not read_app_settings(session).candidate_web_search.enabled


def test_zero_reported_search_usage_remains_pending(ready, monkeypatch):
    data = response()
    data["tool_usage"] = {"web_search": {"num_requests": 0}}
    monkeypatch.setattr(web, "_post_response", lambda *_: data)
    with pytest.raises(AppError):
        web.search_candidates(BATCH)
    assert logs()[0].cost_usd is None


def test_auth_failure_has_zero_usage_and_no_retry(ready, monkeypatch):
    def denied(*_):
        ready.append(1)
        raise _HttpError(401)

    monkeypatch.setattr(web, "_post_response", denied)
    with pytest.raises(AppError) as error:
        web.search_candidates(BATCH)
    assert error.value.kind == "LLM_NOT_CONFIGURED"
    assert len(ready) == 1 and logs()[0].cost_usd == 0


def test_industry_and_reordered_regions_use_same_cache_identity(ready):
    with session_scope() as session:
        session.get(IngestBatch, BATCH).criteria = {
            "processCodes": ["ZN"],
            "regions": ["충남", "대전"],
            "industries": ["자동차 부품"],
        }
    before = web.load_search_context(BATCH).criteria_hash
    with session_scope() as session:
        session.get(IngestBatch, BATCH).criteria = {
            "processCodes": ["ZN"],
            "regions": ["대전", "충남"],
            "industries": ["자동차 부품"],
        }
    assert web.load_search_context(BATCH).criteria_hash == before
    web.search_candidates(BATCH)
    assert json.loads(ready[0]["input"])["industries"] == ["자동차 부품"]


def test_settings_changed_before_retry_do_not_send_old_conditions(ready, monkeypatch):
    def change(*_):
        ready.append(1)
        settings(enabled=False)
        raise _HttpError(429)

    monkeypatch.setattr(web, "_post_response", change)
    with pytest.raises(InputError):
        web.search_candidates(BATCH)
    assert len(ready) == 1 and len(logs()) == 1
