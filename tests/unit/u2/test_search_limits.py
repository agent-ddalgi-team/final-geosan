"""실제 검색 진입점의 전송·정산·차단·재시도를 실제 SQLite로 검사한다."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from threading import Barrier
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.errors import AppError, InputError
from geosan.config.models import AppSetting
from geosan.evidence import openai_search, transfer
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.transfer import TransferLog, reserve_search
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope


def provider_reply():
    return {
        "status": "completed",
        "usage": {"input_tokens": 1000, "output_tokens": 200},
        "tool_usage": {"web_search": {"num_requests": 1}},
        "output": [
            {"type": "web_search_call", "status": "completed", "action": {"type": "search"}},
            {
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(
                            {
                                "url": "https://example.org/",
                                "confidence": 0.9,
                                "reason": "가상 검색 응답",
                            }
                        ),
                    }
                ],
            },
        ],
    }


@pytest.fixture
def search_env(tmp_db, app_settings_path, capability_file_path, apjeong_case_path, monkeypatch):
    settings = load_app_settings(app_settings_path)
    settings.llm.mode = "EXTERNAL"
    with session_scope() as session:
        sync_app_settings(session, settings)
    import_capability(capability_file_path)
    case = import_case(apjeong_case_path)
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    transport = Mock(side_effect=lambda *_: provider_reply())
    monkeypatch.setattr(openai_search, "_post_response", transport)
    return case, transport


def change_setting(section, **values):
    with session_scope() as session:
        row = session.get(AppSetting, section)
        row.value = {**row.value, **values}


def logs():
    with session_scope() as session:
        return session.scalars(select(TransferLog).order_by(TransferLog.occurred_at)).all()


def test_normal_entry_sends_only_identity_and_accounts_usage(search_env):
    case, transport = search_env
    result = find_case_homepage(case.opp_id)
    body, key = transport.call_args.args
    assert json.loads(body["input"]) == {"companyName": "A정밀", "address": "충남천안시(가상)"}
    assert body["model"] == "gpt-6.1-sol"
    assert body["store"] is False and body["max_tool_calls"] == 1
    assert body["tool_choice"] == "required"
    assert body["tools"] == [{"type": "web_search"}]
    assert key == "test-only-placeholder"
    (row,) = logs()
    assert (row.call_count, row.input_tokens, row.output_tokens, row.web_search_calls) == (
        1,
        1000,
        200,
        1,
    )
    assert row.cost_usd == Decimal("0.014")
    assert "A정밀" not in str(row.__dict__)
    assert "test-only-placeholder" not in str(row.__dict__)
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url == result.url


@pytest.mark.parametrize(
    ("section", "values", "kind"),
    [
        ("homepageDiscovery", {"dailyCallLimit": 1}, "SEARCH_LIMIT"),
        ("llm", {"monthlyCallLimit": 1}, "LLM_LIMIT"),
        ("llm", {"monthlyCostLimitUsd": 0.02}, "LLM_LIMIT"),
    ],
)
def test_limits_stop_next_request(search_env, section, values, kind):
    case, transport = search_env
    change_setting(section, **values)
    find_case_homepage(case.opp_id)
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == kind
    assert transport.call_count == 1
    assert [row.call_count for row in logs()] == [1, 0]


@pytest.mark.parametrize(
    ("section", "values"),
    [
        ("homepageDiscovery", {"enabled": False}),
        ("homepageDiscovery", {"dailyCallLimit": 0}),
        ("llm", {"mode": "NONE"}),
        ("llm", {"monthlyCallLimit": 0}),
        ("llm", {"monthlyCostLimitUsd": 0}),
        ("llm", {"inputCostPerMillionTokens": 0}),
        ("llm", {"allowedModels": []}),
    ],
)
def test_disabled_or_unconfigured_never_sends(search_env, section, values):
    case, transport = search_env
    change_setting(section, **values)
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    transport.assert_not_called()
    assert logs()[0].call_count == 0


def test_missing_key_and_contact_are_rejected_without_transmission(search_env, monkeypatch):
    case, transport = search_env
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    with session_scope() as session:
        session.get(Customer, case.customer_id).name = "가상 test@example.invalid"
    with pytest.raises(InputError):
        find_case_homepage(case.opp_id)
    transport.assert_not_called()
    assert len(logs()) == 2
    assert all("test@example.invalid" not in str(row.__dict__) for row in logs())


def test_retry_has_its_own_reservation(search_env):
    case, transport = search_env
    transport.side_effect = [openai_search._HttpError(429), provider_reply()]
    find_case_homepage(case.opp_id)
    assert transport.call_count == 2
    assert [row.cost_usd for row in logs()] == [Decimal(0), Decimal("0.014")]


def test_retry_is_stopped_at_daily_limit(search_env):
    case, transport = search_env
    change_setting("homepageDiscovery", dailyCallLimit=1)
    transport.side_effect = openai_search._HttpError(429)
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == "SEARCH_LIMIT"
    transport.assert_called_once()


def test_unknown_usage_blocks_later_attempts(search_env):
    case, transport = search_env
    transport.side_effect = TimeoutError("test-only-placeholder")
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert "test-only-placeholder" not in str(exc.value)
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == "USAGE_UNCONFIRMED"
    transport.assert_called_once()
    assert logs()[0].cost_usd is None


def test_monthly_limit_survives_restart_and_includes_extraction(search_env):
    case, transport = search_env
    change_setting("llm", monthlyCallLimit=1)
    find_case_homepage(case.opp_id)
    with session_scope() as session:
        session.scalar(select(TransferLog)).purpose = "EXTERNAL_AI"
    dispose_engines()
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == "LLM_LIMIT"
    transport.assert_called_once()


@pytest.mark.parametrize(
    "change",
    [
        {"usage": None},
        {"usage": {"input_tokens": -1, "output_tokens": 1}},
        {"tool_usage": {"web_search": {"num_requests": True}}},
    ],
)
def test_unreadable_usage_remains_pending(search_env, change):
    case, transport = search_env
    transport.side_effect = None
    transport.return_value = {**provider_reply(), **change}
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    assert logs()[0].cost_usd is None
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == "USAGE_UNCONFIRMED"
    transport.assert_called_once()


def test_invalid_answer_keeps_cost_and_previous_customer(search_env):
    case, transport = search_env
    find_case_homepage(case.opp_id)
    malformed = provider_reply()
    malformed["output"][1]["content"][0]["text"] = "invalid JSON"
    transport.side_effect = None
    transport.return_value = malformed
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    assert sum(row.cost_usd for row in logs()) == Decimal("0.028")
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url == "https://example.org/"


def test_failed_customer_save_does_not_undo_paid_usage(search_env):
    case, transport = search_env

    def confirm_while_waiting(*_):
        with session_scope() as session:
            customer = session.get(Customer, case.customer_id)
            customer.homepage_url = "https://confirmed.example.org/"
            customer.homepage_status = "CONFIRMED"
        return provider_reply()

    transport.side_effect = confirm_while_waiting
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.status == 409
    assert logs()[0].cost_usd == Decimal("0.014")


@pytest.mark.parametrize(("status", "cost"), [(401, Decimal(0)), (500, None), (302, None)])
def test_http_failure_never_retries_without_known_usage(search_env, status, cost):
    case, transport = search_env
    transport.side_effect = openai_search._HttpError(status)
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    transport.assert_called_once()
    assert logs()[0].cost_usd == cost


def test_legacy_search_usage_and_incomplete_response(search_env):
    case, transport = search_env
    reply = provider_reply()
    del reply["tool_usage"]
    reply["status"] = "incomplete"
    transport.side_effect = None
    transport.return_value = reply
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    assert logs()[0].web_search_calls == 1
    assert logs()[0].cost_usd == Decimal("0.014")


@pytest.mark.parametrize("action", ["search", "open_page", "find_in_page"])
def test_completed_search_accepts_only_unprocessed_calls_after_provider_limit(search_env, action):
    """Given 상한으로 추가 호출 무시 / When 완료 응답 / Then 주소·실제 사용량 저장."""
    case, transport = search_env
    reply = provider_reply()
    reply["max_tool_calls"] = 1
    reply["output"].insert(
        1, {"type": "web_search_call", "status": "searching", "action": {"type": action}}
    )
    transport.side_effect = None
    transport.return_value = reply

    result = find_case_homepage(case.opp_id)

    assert result.url == "https://example.org/"
    transport.assert_called_once()
    (row,) = logs()
    assert row.web_search_calls == 1
    assert row.cost_usd == Decimal("0.014")
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url == result.url


@pytest.mark.parametrize(
    ("limit", "count", "first_status", "extra_status", "response_status"),
    [
        (None, 1, "completed", "searching", "completed"),
        (True, 1, "completed", "searching", "completed"),
        (2, 1, "completed", "searching", "completed"),
        (1, 0, "completed", "searching", "completed"),
        (1, 2, "completed", "searching", "completed"),
        (1, 1, "searching", "searching", "completed"),
        (1, 1, "completed", "failed", "completed"),
        (1, 1, "completed", "in_progress", "completed"),
        (1, 1, "completed", "searching", "incomplete"),
    ],
)
def test_incomplete_search_is_not_mistaken_for_an_ignored_extra_call(
    search_env, limit, count, first_status, extra_status, response_status
):
    """Given 상한 무시로 확인할 수 없는 응답 / When 검색 / Then 실패하며 회사 값은 보존."""
    case, transport = search_env
    reply = provider_reply()
    reply["max_tool_calls"] = limit
    reply["status"] = response_status
    reply["tool_usage"]["web_search"]["num_requests"] = count
    reply["output"][0]["status"] = first_status
    reply["output"].insert(
        1, {"type": "web_search_call", "status": extra_status, "action": {"type": "search"}}
    )
    transport.side_effect = None
    transport.return_value = reply

    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)

    assert exc.value.kind == "LLM_FAILED"
    transport.assert_called_once()
    assert logs()[0].web_search_calls == count
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url is None


@pytest.mark.parametrize(
    "change", ["missing_usage", "error", "incomplete_details", "invalid_answer"]
)
def test_ignored_extra_call_does_not_bypass_other_response_checks(search_env, change):
    case, transport = search_env
    reply = provider_reply()
    reply["max_tool_calls"] = 1
    reply["output"].insert(
        1, {"type": "web_search_call", "status": "searching", "action": {"type": "search"}}
    )
    if change == "missing_usage":
        del reply["tool_usage"]
    elif change == "invalid_answer":
        reply["output"][-1]["content"][0]["text"] = "invalid JSON"
    else:
        reply[change] = {"reason": "실패한 응답"}
    transport.side_effect = None
    transport.return_value = reply

    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)

    row = logs()[0]
    assert row.cost_usd == (None if change == "missing_usage" else Decimal("0.014"))
    with session_scope() as session:
        assert session.get(Customer, case.customer_id).homepage_url is None


def test_concurrent_reservations_cannot_overdraw_last_call(search_env, tmp_db):
    case, _ = search_env
    change_setting("homepageDiscovery", dailyCallLimit=1)
    barrier = Barrier(2)

    def reserve():
        barrier.wait()
        try:
            reserve_search(case.opp_id, True, tmp_db)
            return "allowed"
        except AppError as exc:
            return exc.kind

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sorted(results) == ["SEARCH_LIMIT", "allowed"]
    assert sum(row.call_count for row in logs()) == 1


def test_korean_midnight_resets_daily_but_not_monthly_limit(search_env, monkeypatch):
    case, transport = search_env
    change_setting("homepageDiscovery", dailyCallLimit=1)
    change_setting("llm", monthlyCallLimit=2)
    clock = datetime.fromisoformat("2026-11-04T23:59:59+09:00")
    monkeypatch.setattr(transfer, "utcnow", lambda: clock)
    find_case_homepage(case.opp_id)
    clock = datetime.fromisoformat("2026-11-05T00:00:00+09:00")
    find_case_homepage(case.opp_id)
    clock = datetime.fromisoformat("2026-11-06T00:00:00+09:00")
    with pytest.raises(AppError) as exc:
        find_case_homepage(case.opp_id)
    assert exc.value.kind == "LLM_LIMIT"
    clock = datetime.fromisoformat("2026-12-01T00:00:00+09:00")
    find_case_homepage(case.opp_id)
    assert transport.call_count == 3
