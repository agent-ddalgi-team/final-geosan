"""#736: 배포 예행연습에서 찾은 "설정대로 올리면 안 뜨는" 문제를 막는 테스트 (계약 C7·C8).

- 배포 설정 파일(`railway.json`)의 설치·시작 명령
- 시작 때 DB 준비(`init-db`를 두 번 돌려도 안전)
- 바깥에 여는 모드에서 접속 보호가 꺼져 있으면 시작 거부, 보호를 켰는데 비밀번호가 없으면 시작 거부
- 서버가 꺼지라는 신호(SIGTERM)를 받아도 실행 중 표식을 지움, 컨테이너 pid 1의 남은 표식 처리

모든 데이터는 가상이다. 비밀번호는 가짜 값이다. 실제 DB·8000번 서버는 건드리지 않는다.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands.app import app
from tests.conftest import EXAMPLES_DIR

REPO_ROOT = Path(__file__).resolve().parents[3]
RAILWAY_JSON = REPO_ROOT / "railway.json"
VIRTUAL_SETTINGS = EXAMPLES_DIR / "app-settings-virtual.yaml"
RULE_CONFIG = EXAMPLES_DIR / "rule-config.yaml"
FAKE_PASSWORD = "virtual-test-only-passphrase"
PROTECTION_OFF = "accessProtection:\n  enabled: false"
PROTECTION_ON = "accessProtection:\n  enabled: true"


def _run(*args: object, input_text: str | None = None) -> tuple[int, str]:
    result = CliRunner().invoke(
        app, [str(arg) for arg in args], input=input_text, catch_exceptions=False
    )
    return result.exit_code, result.output


def _register_protection_on(tmp_path: Path) -> None:
    """가상 설정에서 접속 보호만 켠 파일을 기존 check-config 등록 흐름으로 등록한다."""
    text = VIRTUAL_SETTINGS.read_text(encoding="utf-8")
    assert text.count(PROTECTION_OFF) == 1
    settings = tmp_path / "app-settings-protected.yaml"
    settings.write_text(text.replace(PROTECTION_OFF, PROTECTION_ON), encoding="utf-8")
    code, out = _run("check-config", RULE_CONFIG, settings)
    assert code == 0, out


@pytest.fixture
def started(monkeypatch) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: calls.append(host))
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    return calls


# ---------------------------------------------------------------- 1·2. 배포 설정 파일


def test_railway_config_installs_lock_file_as_editable_install():
    """Given railway.json / When 설치(빌드) 명령을 읽음 / Then 잠금 파일 + 편집 설치를 한다."""
    config = json.loads(RAILWAY_JSON.read_text(encoding="utf-8"))
    build = config["build"]
    assert build["builder"] == "RAILPACK"
    command = build["buildCommand"]
    assert "pip install -r requirements.lock -e ." in command


def test_railway_start_command_prepares_db_before_serving():
    """Given railway.json / When 시작 명령을 읽음 / Then init-db가 성공해야 serve를 띄운다."""
    command = json.loads(RAILWAY_JSON.read_text(encoding="utf-8"))["deploy"]["startCommand"]
    assert "geosan init-db && exec geosan serve --host 0.0.0.0 --port" in command
    assert '"${PORT:?Railway PORT is required}"' in command


def test_init_db_twice_keeps_data_and_changes_nothing(tmp_path, monkeypatch):
    """Given 기록이 든 DB / When 시작 때마다 init-db를 다시 돌림 / Then '이미 최신', 기록 그대로."""
    db = tmp_path / "volume" / "geosan.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(db))
    code, out = _run("init-db")
    assert code == 0 and "준비 완료" in out
    connection = sqlite3.connect(str(db))
    try:
        connection.execute("CREATE TABLE t_virtual_note (text TEXT NOT NULL)")
        connection.execute("INSERT INTO t_virtual_note VALUES ('가상 메모')")
        connection.commit()
    finally:
        connection.close()
    for _ in range(2):
        code, out = _run("init-db")
        assert code == 0 and "이미 최신" in out and "바뀐 것 없음" in out
    connection = sqlite3.connect(str(db))
    try:
        assert connection.execute("SELECT text FROM t_virtual_note").fetchall() == [("가상 메모",)]
    finally:
        connection.close()
