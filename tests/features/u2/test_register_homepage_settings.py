"""설정 검사 명령으로 등록한 값을 실제 SQLite에서 다시 읽는다."""

import json

from pytest_bdd import given, scenarios, then, when
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.app_settings import read_app_settings
from geosan.config.loader import load_document
from geosan.storage.session import session_scope

scenarios("u2/homepage_settings.feature")


def write_settings(app_settings_path, tmp_path, **overrides):
    data = load_document(app_settings_path).data
    data["homepageDiscovery"].update(overrides)
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


@given(
    "홈페이지 확신도 기준이 0.85이고 하루 검색 한도가 12회인 설정 파일이 있다",
    target_fixture="settings_file",
)
def valid_settings(app_settings_path, tmp_path):
    return write_settings(app_settings_path, tmp_path, minConfidence=0.85, dailyCallLimit=12)


@given("홈페이지 검색 한도가 음수인 설정 파일이 있다", target_fixture="settings_file")
def invalid_settings(app_settings_path, tmp_path):
    return write_settings(app_settings_path, tmp_path, dailyCallLimit=-1)


@when("운영자가 설정 검사 명령으로 파일을 등록한다", target_fixture="outcome")
def register(tmp_db, rule_config_path, settings_file):
    with session_scope(tmp_db) as session:
        previous = read_app_settings(session).homepage_discovery
    result = CliRunner().invoke(app, ["check-config", str(rule_config_path), str(settings_file)])
    with session_scope(tmp_db) as session:
        current = read_app_settings(session).homepage_discovery
    return result, previous, current


@then("DB에서 다시 읽은 홈페이지 설정은 확신도 0.85, 자동 조사 켜짐, 하루 12회다")
def stored_settings(outcome):
    result, _, current = outcome
    assert result.exit_code == 0, result.output
    assert current.enabled and current.auto_research
    assert current.min_confidence == 0.85
    assert current.daily_call_limit == 12


@then("하루 검색 한도 칸에서 실패하고 이전 홈페이지 설정이 보존된다")
def unchanged_settings(outcome):
    result, previous, current = outcome
    assert result.exit_code == 1
    assert "homepageDiscovery.dailyCallLimit" in result.output
    assert previous == current
