"""#538: 응답이 없는 호출도 추정 비용으로 합산하고 상한 안에서 계속 쓴다."""

import json
from decimal import Decimal
from unittest.mock import Mock

import pytest
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.app_settings import (
    check_app_settings_file,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence import extraction
from geosan.evidence.transfer import finish_search, reserve_extraction, reserve_search
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = support.extract_env


def test_failed_extraction_can_be_repeated_and_cost_includes_estimate(extract_env):
    case, transport = extract_env
    transport.side_effect = [TimeoutError(), support.reply()]
    first = run_extract(case.opp_id, support.URL)
    assert not first.ok and first.error.kind == "LLM_FAILED"
    second = run_extract(case.opp_id, support.URL)
    assert second.ok, second.error
    assert transport.call_count == 2
    assert [row.cost_usd for row in search_support.logs()] == [None, Decimal("0.004")]
    result = CliRunner().invoke(app, ["cost"])
    assert result.exit_code == 2  # 실제 사용량 미확인 안내는 유지한다.
    assert "추정 비용 $0.100000" in result.stdout
    assert "한도 계산 비용 $0.104000" in result.stdout


@pytest.mark.parametrize("purpose", ["search", "extract"])
def test_estimate_uses_config_and_stops_at_monthly_limit(search_env, purpose):
    case, _ = search_env
    search_support.change_setting("llm", unconfirmedCallCostUsd=0.25, monthlyCostLimitUsd=0.5)

    def reserve():
        if purpose == "search":
            return reserve_search(case.opp_id, True, None)
        return reserve_extraction(case.opp_id, True, None, "system")

    reserve()
    reserve()
    with pytest.raises(AppError) as error:
        reserve()
    assert error.value.kind == "LLM_LIMIT"
    assert [row.call_count for row in search_support.logs()] == [1, 1, 0]
    result = CliRunner().invoke(app, ["cost"])
    assert "추정 비용 $0.500000" in result.stdout
    assert "2건" in result.stdout
    assert "알림" in result.stdout


@pytest.mark.parametrize("value", [None, "0.10", True, 0, -0.1, float("inf"), float("nan")])
def test_estimate_setting_is_required_positive_finite_number(app_settings_path, tmp_path, value):
    import yaml

    data = yaml.safe_load(app_settings_path.read_text(encoding="utf-8"))
    if value is None:
        data["llm"].pop("unconfirmedCallCostUsd", None)
    else:
        data["llm"]["unconfirmedCallCostUsd"] = value
    path = tmp_path / "invalid.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    result = check_app_settings_file(path)
    assert not result.ok
    assert any(error.path == "llm.unconfirmedCallCostUsd" for error in result.errors)


def test_estimate_setting_round_trips_to_database(tmp_db, app_settings_path):
    settings = load_app_settings(app_settings_path)
    settings.llm.unconfirmed_call_cost_usd = 0.25
    with session_scope() as session:
        sync_app_settings(session, settings)
    with session_scope() as session:
        assert read_app_settings(session).llm.unconfirmed_call_cost_usd == 0.25


def test_check_config_updates_old_database_copy_without_losing_selected_settings(
    tmp_db, app_settings_path, tmp_path
):
    settings = load_app_settings(app_settings_path)
    settings.llm.unconfirmed_call_cost_usd = 0.25
    settings.llm.mode = "EXTERNAL"
    settings.llm.monthly_call_limit = 123
    with session_scope() as session:
        sync_app_settings(session, settings)
        row = session.get(AppSetting, "llm")
        row.value = {
            key: value for key, value in row.value.items() if key != "unconfirmedCallCostUsd"
        }
    path = tmp_path / "operating-settings.json"
    path.write_text(settings.model_dump_json(by_alias=True), encoding="utf-8")
    result = CliRunner().invoke(app, ["check-config", "examples/rule-config.yaml", str(path)])
    assert result.exit_code == 0, result.output
    with session_scope() as session:
        assert read_app_settings(session) == settings
    data = json.loads(path.read_text(encoding="utf-8"))
    data["llm"].pop("unconfirmedCallCostUsd")
    path.write_text(json.dumps(data), encoding="utf-8")
    result = CliRunner().invoke(app, ["check-config", "examples/rule-config.yaml", str(path)])
    assert result.exit_code == 1 and "unconfirmedCallCostUsd" in result.output
    with session_scope() as session:
        assert read_app_settings(session) == settings


def test_confirmed_zero_replaces_estimate_and_is_not_charged_again(search_env):
    case, _ = search_env
    search_support.change_setting("llm", monthlyCostLimitUsd=0.1)
    ticket = reserve_extraction(case.opp_id, True, None, "system")
    finish_search(ticket, 0, 0, 0, None)
    reserve_extraction(case.opp_id, True, None, "system")
    result = CliRunner().invoke(app, ["cost"])
    assert "추정 비용 $0.100000 (사용량 미확정 1건)" in result.output
    assert "한도 계산 비용 $0.100000" in result.output


def test_ai_transport_uses_remaining_deadline_without_twenty_second_cap(monkeypatch):
    connection = Mock()
    response = connection.getresponse.return_value
    response.status = 200
    response.read1.side_effect = [b"{}", b""]
    factory = Mock(return_value=connection)
    monkeypatch.setattr(extraction.http.client, "HTTPSConnection", factory)
    # 연결 전 55초, 연결 뒤 50초, 읽기 중 45초가 남은 상황.
    monkeypatch.setattr(extraction, "remaining", Mock(side_effect=[55, 50, 49, 45, 44, 43, 42, 41]))
    timer = Mock()
    interrupt = Mock(return_value=timer)
    monkeypatch.setattr(extraction, "interrupt_at", interrupt)
    assert extraction._post({}, "test-only-placeholder", 100) == {}
    assert factory.call_args.kwargs["timeout"] == 55
    assert connection.sock.settimeout.call_args_list[0].args == (50,)
    assert all(call.args[0] > 20 for call in connection.sock.settimeout.call_args_list)
    interrupt.assert_called_once_with(connection.sock, 100)
    timer.cancel.assert_called_once()
    connection.close.assert_called_once()
