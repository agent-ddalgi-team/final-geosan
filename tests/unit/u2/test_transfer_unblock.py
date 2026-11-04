"""사용량 추측 없이 정산하고 한도·동시 저장·이전 DB 이력을 보존한다 (#218)."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Barrier

import pytest
from alembic import command
from sqlalchemy import event
from sqlalchemy.orm import Session
from typer.testing import CliRunner

from geosan.commands import transfer_unblock
from geosan.commands.app import app
from geosan.config.app_settings import DEFAULT_APP_SETTINGS_PATH, load_app_settings
from geosan.config.errors import AppError
from geosan.evidence import reconciliation, transfer
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.transfer import SearchTicket, TransferLog
from geosan.storage.migrate import alembic_config, upgrade_to_head
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as extraction_support
from tests.unit.u2 import test_search_limits as search_support

NOW = datetime(2026, 11, 4, 7, tzinfo=UTC)
search_env = search_support.search_env
extract_env = extraction_support.extract_env


@pytest.fixture
def fixed_clock(monkeypatch):
    for module in (transfer, reconciliation, transfer_unblock):
        monkeypatch.setattr(module, "utcnow", lambda: NOW)


def make_log(log_id="transfer-test", **overrides):
    values = dict(
        transfer_log_id=log_id,
        occurred_at=NOW - timedelta(minutes=20),
        opp_id="opp-test",
        purpose="EXTERNAL_SEARCH",
        kind="WEB_SEARCH",
        mode="EXTERNAL",
        model="gpt-6.1-sol",
        security_grade="PUBLIC",
        decision="ALLOWED",
        requested_by="system",
        call_count=1,
        created_by="system",
        created_at=NOW - timedelta(minutes=20),
    )
    with session_scope() as session:
        session.add(TransferLog(**{**values, **overrides}))
    return log_id


def read(log_id="transfer-test"):
    with session_scope() as session:
        row = session.get(TransferLog, log_id)
        return {column.name: getattr(row, column.name) for column in TransferLog.__table__.columns}


def database_rows(path):
    with sqlite3.connect(path) as connection:
        return tuple(connection.iterdump())


def settle(log_id="transfer-test", **overrides):
    values = {
        "--log-id": log_id,
        "--input-tokens": "1000",
        "--output-tokens": "200",
        "--web-search-calls": "1",
        "--cost-usd": "0.014",
        "--by": "choi-pm",
    }
    values.update(overrides)
    args = [part for key, value in values.items() for part in (key, str(value))]
    return CliRunner().invoke(app, ["transfer-unblock", *args])


def test_preview_is_read_only_and_uses_exact_age_boundary(tmp_db, fixed_clock):
    make_log("old", occurred_at=NOW - timedelta(minutes=10))
    make_log("recent", occurred_at=NOW - timedelta(minutes=10) + timedelta(microseconds=1))
    make_log("rejected", decision="REJECTED", call_count=0, reject_reason="검색어는 표시 안 함")
    make_log("settled", cost_usd=Decimal("0.01"))
    make_log("other", purpose="OUTPUT_EXPORT")
    make_log("extract", purpose="EXTERNAL_AI", kind="PUBLIC_TEXT")
    before = database_rows(tmp_db)
    result = CliRunner().invoke(app, ["transfer-unblock"])
    assert result.exit_code == 0 and "정리 대상 2건" in result.output
    assert "기록 old" in result.output and "기록 extract" in result.output
    assert all(
        word not in result.output
        for word in ["recent", "rejected", "settled", "other", "검색어", "opp-test"]
    )
    assert "KST" in result.output and "gpt-6.1-sol" in result.output
    assert database_rows(tmp_db) == before
    assert "대상 0건" in CliRunner().invoke(app, ["transfer-unblock", "--older-than", "30m"]).output
    assert database_rows(tmp_db) == before


@pytest.mark.parametrize("free", [False, True])
def test_reconciliation_preserves_call_and_audit_fields(tmp_db, fixed_clock, free):
    make_log(call_count=2, occurred_at=NOW - timedelta(minutes=10))
    before = read()
    options = (
        {
            "--input-tokens": "0",
            "--output-tokens": "0",
            "--web-search-calls": "0",
            "--cost-usd": "0",
        }
        if free
        else {}
    )
    result = settle(**options)
    assert result.exit_code == 0 and "막힌 기록 1건을 정리했습니다" in result.output
    changed = dict(
        input_tokens=0 if free else 1000,
        output_tokens=0 if free else 200,
        web_search_calls=0 if free else 1,
        cost_usd=Decimal(0) if free else Decimal("0.014"),
        reconciled_at=NOW,
        reconciled_by="choi-pm",
    )
    assert read() == {**before, **changed}
    confirmed = database_rows(tmp_db)
    assert settle().exit_code == 1
    assert database_rows(tmp_db) == confirmed


@pytest.mark.parametrize(
    "overrides",
    [
        {"--input-tokens": "-1"},
        {"--input-tokens": str(2**63)},
        {"--output-tokens": "1.5"},
        {"--web-search-calls": "nan"},
        {"--cost-usd": "nan"},
        {"--cost-usd": "Infinity"},
        {"--cost-usd": "-0.1"},
        {"--cost-usd": "text"},
        {"--cost-usd": "0.00000000001"},
        {"--cost-usd": "1e100"},
        {"--by": "viewer"},
        {"--by": "missing"},
        {"--by": " "},
        {"--older-than": "9m"},
        {"--older-than": "10.5m"},
        {"--older-than": "1h"},
        {"--older-than": "10000000000m"},
        {"--older-than": "999999999999999999999999999m"},
        {"--log-id": "missing"},
    ],
)
def test_invalid_inputs_leave_all_rows_unchanged(tmp_db, fixed_clock, overrides):
    make_log()
    before = database_rows(tmp_db)
    assert settle(**overrides).exit_code == 1
    assert database_rows(tmp_db) == before


@pytest.mark.parametrize(
    "args", [["--log-id", "transfer-test"], ["--by", "choi-pm"], ["--cost-usd", "0"]]
)
def test_incomplete_settlement_does_not_become_preview(tmp_db, args):
    before = database_rows(tmp_db)
    result = CliRunner().invoke(app, ["transfer-unblock", *args])
    assert result.exit_code == 1 and "모두 넣어" in result.output
    assert database_rows(tmp_db) == before


@pytest.mark.parametrize(
    "overrides",
    [
        {"occurred_at": NOW - timedelta(minutes=9)},
        {"call_count": 0},
        {"mode": "NONE"},
        {"decision": "REJECTED"},
        {"purpose": "EXTERNAL_GEOCODE"},
        {"cost_usd": Decimal(0)},
    ],
)
def test_ineligible_target_is_rejected(tmp_db, fixed_clock, overrides):
    make_log(**overrides)
    before = database_rows(tmp_db)
    assert settle().exit_code == 1
    assert database_rows(tmp_db) == before


def test_extraction_cannot_claim_web_search_usage(tmp_db, fixed_clock):
    make_log(purpose="EXTERNAL_AI", kind="PUBLIC_TEXT")
    before = database_rows(tmp_db)
    assert settle().exit_code == 1
    assert database_rows(tmp_db) == before
    assert settle(**{"--web-search-calls": "0"}).exit_code == 0


def test_write_failure_rolls_back_usage_and_operator(tmp_db, fixed_clock):
    make_log()
    before = database_rows(tmp_db)

    def fail_after_write(*_):
        raise RuntimeError("가상 저장 오류")

    event.listen(Session, "after_flush_postexec", fail_after_write)
    try:
        result = settle()
    finally:
        event.remove(Session, "after_flush_postexec", fail_after_write)
    assert result.exit_code == 2 and "1건을 정리했습니다" not in result.output
    assert database_rows(tmp_db) == before


def test_normal_response_and_manual_settlement_cannot_overwrite_each_other(tmp_db, fixed_clock):
    make_log()
    ticket = SearchTicket("transfer-test", load_app_settings(DEFAULT_APP_SETTINGS_PATH).llm)
    barrier = Barrier(2)

    def finish(normal):
        barrier.wait(timeout=5)
        try:
            if normal:
                transfer.finish_search(ticket, 10, 20, 1, None)
            else:
                reconciliation.reconcile_usage(
                    "transfer-test",
                    age=timedelta(minutes=10),
                    input_tokens=1000,
                    output_tokens=200,
                    web_search_calls=1,
                    cost_usd=Decimal("0.9"),
                    staff_key="choi-pm",
                )
            return True
        except AppError:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(finish, [True, False]))
    assert sorted(outcomes) == [False, True]
    row = read()
    if row["reconciled_by"]:
        assert (row["input_tokens"], row["output_tokens"], row["cost_usd"]) == (
            1000,
            200,
            Decimal("0.9"),
        )
    else:
        assert (row["input_tokens"], row["output_tokens"], row["cost_usd"]) == (
            10,
            20,
            Decimal("0.01022"),
        )
    before = database_rows(tmp_db)
    assert settle().exit_code == 1
    with pytest.raises(AppError):
        transfer.finish_search(ticket, 5, 5, 1, None)
    assert database_rows(tmp_db) == before


def test_manual_cost_keeps_original_month_and_does_not_refund_call_limits(search_env, fixed_clock):
    case, transport = search_env
    make_log(opp_id=case.opp_id, occurred_at=datetime(2026, 10, 31, 14, 59, tzinfo=UTC))
    assert settle().exit_code == 0
    runner = CliRunner()
    october = runner.invoke(app, ["cost", "--month", "2026-10"])
    november = runner.invoke(app, ["cost", "--month", "2026-11"])
    assert october.exit_code == november.exit_code == 0
    assert "호출 1/" in october.output and "$0.014000" in october.output
    assert "호출 0/" in november.output and "$0.000000" in november.output
    make_log("today", opp_id=case.opp_id)
    assert settle("today").exit_code == 0
    search_support.change_setting("homepageDiscovery", dailyCallLimit=1)
    with pytest.raises(AppError) as error:
        find_case_homepage(case.opp_id)
    assert error.value.kind == "SEARCH_LIMIT"
    transport.assert_not_called()
    search_support.change_setting("homepageDiscovery", dailyCallLimit=200)
    search_support.change_setting("llm", monthlyCallLimit=1)
    with pytest.raises(AppError) as error:
        find_case_homepage(case.opp_id)
    assert error.value.kind == "LLM_LIMIT"
    transport.assert_not_called()


def test_confirmed_usage_unblocks_search_and_extraction_without_resending_old_call(
    extract_env, search_env, fixed_clock
):
    case, extraction_transport = extract_env
    make_log(opp_id=case.opp_id)
    with pytest.raises(AppError):
        find_case_homepage(case.opp_id)
    assert not run_extract(case.opp_id, extraction_support.URL).ok
    search_env[1].assert_not_called()
    extraction_transport.assert_not_called()
    assert settle().exit_code == 0
    search_env[1].assert_not_called()
    extraction_transport.assert_not_called()
    assert find_case_homepage(case.opp_id).url == "https://example.org/"
    assert run_extract(case.opp_id, extraction_support.URL).ok
    assert search_env[1].call_count == extraction_transport.call_count == 1
    assert read()["call_count"] == 1


def test_old_database_upgrade_preserves_transfer_values(tmp_path):
    path = tmp_path / "old.db"
    command.upgrade(alembic_config(path), "tg_001")
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO tg_transfer_log (transfer_log_id, occurred_at, opp_id, purpose, kind, "
            "mode, security_grade, decision, requested_by, call_count, cost_usd, created_at, "
            "created_by, is_virtual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "old",
                NOW.isoformat(),
                "opp-old",
                "EXTERNAL_SEARCH",
                "WEB_SEARCH",
                "EXTERNAL",
                "PUBLIC",
                "ALLOWED",
                "system",
                2,
                0.125,
                NOW.isoformat(),
                "system",
                0,
            ),
        )
        before = connection.execute("SELECT * FROM tg_transfer_log").fetchone()
    assert upgrade_to_head(path) == ["tg_002"]
    assert upgrade_to_head(path) == ["tg_002"]
    with sqlite3.connect(path) as connection:
        after = connection.execute("SELECT * FROM tg_transfer_log").fetchone()
    assert after == (*before, None, None)


def test_missing_database_is_not_created(tmp_path, monkeypatch):
    path = tmp_path / "missing.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(path))
    result = CliRunner().invoke(app, ["transfer-unblock"])
    assert result.exit_code == 1 and "init-db" in result.output
    assert not path.exists()
