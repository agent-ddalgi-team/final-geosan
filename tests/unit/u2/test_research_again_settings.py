"""#677: 다시 조사 제안 기간 설정 `research.suggestAgainAfterDays`."""

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
from geosan.storage.session import session_scope

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"


def _write(tmp_path, change):
    data = yaml.safe_load((EXAMPLES / "app-settings.yaml").read_text(encoding="utf-8"))
    change(data)
    path = tmp_path / "settings.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return path


@pytest.mark.parametrize("name", ["app-settings.yaml", "app-settings-virtual.yaml"])
def test_example_settings_start_at_thirty_days(name):
    """Given 예시 설정 두 벌 / Then 다시 조사 제안 기간의 초기값은 30일이다."""
    assert load_app_settings(EXAMPLES / name).research.suggest_again_after_days == 30


def test_settings_file_without_research_section_never_suggests(tmp_path):
    """Given research 묶음이 없는 설정 파일 / Then 0(제안 안 함)으로 읽는다."""
    path = _write(tmp_path, lambda data: data.pop("research"))
    assert load_app_settings(path).research.suggest_again_after_days == 0


@pytest.mark.parametrize("value", [-1, "30", 1.5, True])
def test_days_must_be_a_non_negative_whole_number(tmp_path, value):
    path = _write(tmp_path, lambda data: data["research"].update(suggestAgainAfterDays=value))
    result = check_app_settings_file(path)
    assert not result.ok
    assert any(error.path == "research.suggestAgainAfterDays" for error in result.errors)


@pytest.mark.parametrize("value", [0, 1, 45])
def test_days_accept_zero_and_whole_numbers(tmp_path, value):
    path = _write(tmp_path, lambda data: data["research"].update(suggestAgainAfterDays=value))
    assert load_app_settings(path).research.suggest_again_after_days == value


def test_old_database_copy_without_the_key_reads_the_example_value(tmp_db, app_settings_path):
    """Given #677 전에 만든 설정 사본(칸 없음) / Then 예시 파일 값으로 읽고 다른 칸은 그대로다."""
    settings = load_app_settings(app_settings_path)
    with session_scope() as session:
        sync_app_settings(session, settings)
        session.get(AppSetting, "research").value = {
            "staleAfterDays": 45,
            "autoOnBookmarkDailyCostUsd": 0.5,
        }
    with session_scope() as session:
        research = read_app_settings(session).research
    assert research.stale_after_days == 45
    assert research.auto_on_bookmark_daily_cost_usd == 0.5
    assert research.suggest_again_after_days == 30
