"""#393·#405: 예전 설정 호환·PM 기본값(보관 15일)·운영자가 고친 값의 DB 왕복."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from geosan.config.app_settings import (
    AppSettings,
    ComplexListSettings,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.storage.session import session_scope


def test_old_settings_and_both_examples_use_pm_defaults(app_settings_path):
    for filename in (app_settings_path, Path("examples/app-settings-virtual.yaml")):
        settings = load_app_settings(filename)
        assert settings.ingestion.complex_list.model_dump(by_alias=True) == {
            "enabled": False,
            "cacheDays": 15,
            "extraNames": [],
        }
        old = settings.model_dump(by_alias=True)
        del old["ingestion"]["complexList"]
        assert AppSettings.model_validate(old).ingestion.complex_list.cache_days == 15


def test_config_file_and_database_preserve_operator_values(tmp_db, tmp_path, app_settings_path):
    data = load_app_settings(app_settings_path).model_dump(by_alias=True)
    selected = {"enabled": True, "cacheDays": 3, "extraNames": ["가상새단지"]}
    data["ingestion"]["complexList"] = selected
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with session_scope(tmp_db) as session:
        sync_app_settings(session, load_app_settings(path))
    with session_scope(tmp_db) as session:
        actual = read_app_settings(session).ingestion.complex_list.model_dump(by_alias=True)
    assert actual == selected


@pytest.mark.parametrize(
    "settings",
    [
        {"cacheDays": 0},
        {"cacheDays": -1},
        {"cacheDays": 1.5},
        {"cacheDays": True},
        {"cacheDays": "7"},
        {"enabled": "false"},
        {"extraNames": "가상단지"},
        {"extraNames": [1]},
        {"unknown": True},
    ],
)
def test_invalid_complex_config_is_not_silently_coerced(settings):
    with pytest.raises(ValidationError):
        ComplexListSettings.model_validate(settings)
