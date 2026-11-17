"""운영 명령으로 활성 묶음을 바꾸고 서버가 같은 묶음을 쓰는지 확인한다 (#99)."""

from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands import serve
from geosan.commands.app import app
from geosan.config.app_settings import SOURCE_FILE_KEY
from geosan.config.models import AppSetting
from geosan.storage.session import session_scope


def settings_copy():
    with session_scope() as session:
        return {row.setting_key: row.value for row in session.scalars(select(AppSetting))}


def test_change_bundle_survives_check_and_serve(tmp_db, monkeypatch):
    """Given 가상 묶음 / When 묶음 변경·설정 검사·서버 시작 / Then 선택과 다른 설정은 보존."""
    runner = CliRunner()
    before = settings_copy()
    assert before["activeDatasetKind"] == "VIRTUAL_REVIEWED" and before[SOURCE_FILE_KEY]
    result = runner.invoke(app, ["dataset-set", "COMPANY_CONFIRMED"])
    assert result.exit_code == 0, result.output
    assert "COMPANY_CONFIRMED" in result.output and "geosan evaluate" in result.output
    checked = runner.invoke(app, ["check-config"])
    assert checked.exit_code == 0 and "활성 묶음 COMPANY_CONFIRMED" in checked.output
    started_with = []
    monkeypatch.setattr(serve, "_run_server", lambda port, host: started_with.append((port, host)))
    started = runner.invoke(app, ["serve"])
    assert started.exit_code == 0 and "geosan dataset-set" in started.output
    assert "활성 묶음 COMPANY_CONFIRMED" in started.output
    assert started_with == [(8000, serve.HOST)]
    assert settings_copy() == {**before, "activeDatasetKind": "COMPANY_CONFIRMED"}


def test_invalid_bundle_leaves_settings_untouched(tmp_db):
    before = settings_copy()
    result = CliRunner().invoke(app, ["dataset-set", "잘못된값"])
    assert result.exit_code == 1
    assert all(
        name in result.output for name in ("VIRTUAL_REVIEWED", "BROCHURE", "COMPANY_CONFIRMED")
    )
    assert settings_copy() == before


def test_missing_db_is_reported_without_creating_it(tmp_path, monkeypatch):
    path = tmp_path / "missing.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(path))
    result = CliRunner().invoke(app, ["dataset-set", "BROCHURE"])
    assert result.exit_code == 1 and "geosan init-db" in result.output
    assert not path.exists()
