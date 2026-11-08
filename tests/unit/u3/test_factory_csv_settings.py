"""#427: 승인된 CSV 경로 설정의 예전 파일 호환·DB 왕복·잘못된 값 거부."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from geosan.config.app_settings import (
    AppSettings,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)


@pytest.mark.parametrize("filename", ["app-settings.yaml", "app-settings-virtual.yaml"])
def test_examples_and_old_settings_keep_path_optional(filename):
    settings = load_app_settings(Path("examples") / filename)
    assert Path(settings.ingestion.factory_csv_path).name.endswith("20251231.csv")
    data = settings.model_dump(by_alias=True)
    del data["ingestion"]["factoryCsvPath"]
    assert AppSettings.model_validate(data).ingestion.factory_csv_path == ""
    schema = json.loads(Path("contracts/app-settings.schema.json").read_text(encoding="utf-8"))
    ingestion = schema["properties"]["ingestion"]
    assert "factoryCsvPath" not in ingestion["required"]
    assert ingestion["properties"]["factoryCsvPath"]["type"] == "string"


def test_operator_path_survives_file_and_database_roundtrip(tmp_db, tmp_path, app_settings_path):
    from geosan.storage.session import session_scope

    settings = load_app_settings(app_settings_path)
    expected = str(tmp_path / "20251231" / "factories.csv")
    settings.ingestion.factory_csv_path = expected
    path = tmp_path / "settings.json"
    path.write_text(settings.model_dump_json(by_alias=True), encoding="utf-8")
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(path))
    with session_scope() as session:
        assert read_app_settings(session).ingestion.factory_csv_path == expected


@pytest.mark.parametrize("value", [None, False, 12, [], {}])
def test_invalid_path_type_is_rejected(app_settings_path, value):
    data = load_app_settings(app_settings_path).model_dump(by_alias=True)
    data["ingestion"]["factoryCsvPath"] = value
    with pytest.raises(ValidationError):
        AppSettings.model_validate(data)
