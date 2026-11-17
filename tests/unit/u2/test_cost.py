import pytest
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = support.extract_env


def test_cost_command_reports_both_tokens_and_alert(extract_env):
    """비용 $0.004가 한도 $0.0045의 약 89% — 알림 기준(예시 설정 llm.costAlertRatio 0.8,
    #799 PM 확인 2026-11-16)을 넘어 알림이 나온다."""
    case, _ = extract_env
    search_support.change_setting("llm", monthlyCostLimitUsd=0.0045)
    assert run_extract(case.opp_id, support.URL).ok
    result = CliRunner().invoke(app, ["cost"])
    assert result.exit_code == 0 and "입력 1000·출력 200" in result.stdout
    assert "$0.004000" in result.stdout and "알림" in result.stdout


def test_cost_command_has_no_alert_below_the_ratio(extract_env):
    """비용 $0.004가 한도 $0.006의 약 67% — 알림 기준 80% 밑이라 알림이 없다(#799)."""
    case, _ = extract_env
    search_support.change_setting("llm", monthlyCostLimitUsd=0.006)
    assert run_extract(case.opp_id, support.URL).ok
    result = CliRunner().invoke(app, ["cost"])
    assert result.exit_code == 0 and "$0.004000" in result.stdout
    assert "알림" not in result.stdout


@pytest.mark.parametrize("month", ["invalid", "2026-13", "2026-1"])
def test_cost_rejects_bad_month(tmp_db, month):
    assert CliRunner().invoke(app, ["cost", "--month", month]).exit_code == 1


def test_unknown_usage_is_not_reported_as_final(extract_env):
    case, transport = extract_env
    transport.side_effect = TimeoutError()
    assert not run_extract(case.opp_id, support.URL).ok
    cost = CliRunner().invoke(app, ["cost"])
    assert cost.exit_code == 2 and "실제 총비용은 미확인" in cost.stdout


def test_month_filter_uses_korean_calendar(extract_env, monkeypatch):
    from datetime import UTC, datetime

    from geosan.evidence import transfer

    monkeypatch.setattr(transfer, "utcnow", lambda: datetime(2026, 10, 31, 15, tzinfo=UTC))
    assert run_extract(extract_env[0].opp_id, support.URL).ok
    assert "입력 1000" in CliRunner().invoke(app, ["cost", "--month", "2026-11"]).stdout
    assert "입력 0·출력 0" in CliRunner().invoke(app, ["cost", "--month", "2026-10"]).stdout
