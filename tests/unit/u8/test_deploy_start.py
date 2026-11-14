"""#736: 배포 예행연습에서 찾은 "설정대로 올리면 안 뜨는" 문제를 막는 테스트 (계약 C7·C8).

- 배포 설정 파일(`railway.json`)의 설치·시작 명령
- 시작 때 DB 준비(`init-db`를 두 번 돌려도 안전)
- 바깥에 여는 모드에서 접속 보호가 꺼져 있으면 시작 거부, 보호를 켰는데 비밀번호가 없으면 시작 거부
- 서버가 꺼지라는 신호(SIGTERM)를 받아도 실행 중 표식을 지움, 컨테이너 pid 1의 남은 표식 처리

모든 데이터는 가상이다. 비밀번호는 가짜 값이다. 실제 DB·8000번 서버는 건드리지 않는다.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands import serving_marker
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


# ---------------------------------------------------------------- 3. 접속 보호 검사


def test_deploy_host_refuses_when_access_protection_is_off(tmp_db, started, monkeypatch):
    """Given 보호 꺼진 설정·비밀번호 있음 / When 0.0.0.0으로 시작 / Then 거부(종료 코드 2)."""
    monkeypatch.setenv("GEOSAN_PASSWORD", FAKE_PASSWORD)
    code, out = _run("serve", "--host", "0.0.0.0", "--port", "8670")
    assert code == 2, out
    assert "접속 보호가 꺼져 있어 배포 환경에서 서버를 시작하지 않습니다" in out
    assert "accessProtection.enabled" in out and "check-config" in out
    assert started == []
    assert not serving_marker.marker_path(tmp_db).exists()


def test_deploy_host_refuses_on_fresh_db_without_settings_copy(bare_db, started, monkeypatch):
    """Given init-db만 한 빈 볼륨 DB(예시 설정 = 보호 꺼짐) / When 0.0.0.0 / Then 거부."""
    monkeypatch.setenv("GEOSAN_PASSWORD", FAKE_PASSWORD)
    code, out = _run("serve", "--host", "0.0.0.0", "--port", "8670")
    assert code == 2, out
    assert "접속 보호가 꺼져 있어" in out
    assert started == []


def test_this_pc_still_starts_without_protection(tmp_db, started, monkeypatch):
    """Given 보호 꺼진 설정·비밀번호 없음 / When 127.0.0.1(팀 노트북) / Then 지금처럼 뜬다."""
    monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    code, out = _run("serve", "--port", "8670")
    assert code == 0, out
    assert started == ["127.0.0.1"]
    assert "접속 보호" not in out


@pytest.mark.parametrize("host", ["0.0.0.0", "127.0.0.1"])
@pytest.mark.parametrize("password", [None, "", "   "])
def test_protection_on_without_password_refuses(
    tmp_db, tmp_path, started, monkeypatch, host, password
):
    """Given 보호 켬·비밀번호 없음(빈 값 포함) / When 시작 / Then 로그인 500 대신 시작 거부."""
    _register_protection_on(tmp_path)
    if password is None:
        monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("GEOSAN_PASSWORD", password)
    code, out = _run("serve", "--host", host, "--port", "8670")
    assert code == 2, out
    assert "비밀번호(GEOSAN_PASSWORD)가 없어 서버를 시작하지 않습니다" in out
    assert started == []


def test_protection_on_with_password_starts_on_deploy_host(tmp_db, tmp_path, started, monkeypatch):
    """Given 보호 켬·비밀번호 있음 / When 0.0.0.0으로 시작 / Then 뜬다."""
    _register_protection_on(tmp_path)
    monkeypatch.setenv("GEOSAN_PASSWORD", FAKE_PASSWORD)
    code, out = _run("serve", "--host", "0.0.0.0", "--port", "8670")
    assert code == 0, out
    assert started == ["0.0.0.0"]


def test_unreadable_settings_copy_refuses_with_plain_message(tmp_db, started, monkeypatch):
    """Given DB의 앱 설정 사본을 읽지 못함 / When 시작 / Then 숨기지 않고 거부(종료 코드 2)."""
    from geosan.config import app_settings

    def _broken(session):
        raise ValueError("가상 읽기 오류")

    monkeypatch.setattr(app_settings, "read_app_settings", _broken)
    code, out = _run("serve", "--host", "0.0.0.0", "--port", "8670")
    assert code == 2, out
    assert "앱 설정 사본을 읽지 못해" in out
    assert started == []


# ---------------------------------------------------------------- 4. 꺼질 때 표식


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.mark.skipif(sys.platform == "win32", reason="SIGTERM은 Windows에 없다")
def test_real_server_removes_marker_on_sigterm(tmp_path):
    """Given 실제 uvicorn 서버 / When SIGTERM(배포 서비스가 끌 때) / Then 표식을 지우고 끝난다.

    uvicorn은 신호를 받아 정리한 뒤 같은 신호를 다시 일으킨다. 그 신호가 기본 처리로 가면
    프로세스가 바로 죽어 표식이 남았다(#736 예행연습).
    """
    db = tmp_path / "geosan.db"
    env = {**os.environ, "GEOSAN_DB_PATH": str(db)}
    env.pop("GEOSAN_PASSWORD", None)
    subprocess.run(
        [sys.executable, "-m", "geosan", "init-db"],
        cwd=REPO_ROOT,
        env=env,
        check=True,
        capture_output=True,
    )
    port = _free_port()
    process = subprocess.Popen(
        [sys.executable, "-m", "geosan", "serve", "--port", str(port)],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        marker = serving_marker.marker_path(db)
        deadline = time.monotonic() + 60
        listening = False
        while time.monotonic() < deadline and process.poll() is None:
            if marker.exists():
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                    listening = probe.connect_ex(("127.0.0.1", port)) == 0
                if listening:
                    break
            time.sleep(0.2)
        assert listening, "서버가 제때 뜨지 않았다"
        process.send_signal(signal.SIGTERM)
        output, _ = process.communicate(timeout=30)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
    text = output.decode("utf-8", errors="replace")
    assert process.returncode == 0, text
    assert "서버를 종료했습니다" in text
    assert not marker.exists()


def test_signal_during_server_run_still_cleans_marker(tmp_db, monkeypatch):
    """Given 서버 함수가 도는 중 SIGTERM / When serve / Then 정상 종료(0)이고 표식이 없다."""
    if sys.platform == "win32":
        return

    def _receive_sigterm(port: int, host: str) -> None:
        assert serving_marker.marker_path(tmp_db).exists()
        signal.raise_signal(signal.SIGTERM)

    before = signal.getsignal(signal.SIGTERM)
    monkeypatch.setattr(serve_module, "_run_server", _receive_sigterm)
    code, out = _run("serve", "--port", "8670")
    assert code == 0, out
    assert not serving_marker.marker_path(tmp_db).exists()
    # 끝나면 원래 신호 처리로 돌려 둔다(테스트 프로세스에 흔적을 남기지 않음).
    assert signal.getsignal(signal.SIGTERM) == before


def _write_pid1_marker(db: Path) -> None:
    serving_marker.marker_path(db).write_text(
        '{"pid": 1, "port": 8080, "host": "0.0.0.0"}', encoding="utf-8"
    )


def test_pid1_marker_is_stale_when_container_pid1_is_not_a_server(tmp_path, monkeypatch):
    """Given pid 1 표식·지금 pid 1은 점검용 sleep / When 켜진 서버 확인 / Then 없음(표식 지움)."""
    db = tmp_path / "geosan.db"
    _write_pid1_marker(db)
    monkeypatch.setattr(serving_marker, "process_command_line", lambda pid: ["sleep", "infinity"])
    assert serving_marker.running_server(db) is None
    assert not serving_marker.marker_path(db).exists()


@pytest.mark.parametrize(
    "argv",
    [
        ["/app/.geosan-venv/bin/python", "/app/.geosan-venv/bin/geosan", "serve", "--port", "1"],
        ["python", "-m", "geosan", "serve", "--host", "0.0.0.0"],
    ],
)
def test_pid1_marker_blocks_when_pid1_is_a_running_server(tmp_path, monkeypatch, argv):
    """Given pid 1 표식·pid 1이 geosan serve / When 켜진 서버 확인 / Then 켜져 있다(복원 거부)."""
    db = tmp_path / "geosan.db"
    _write_pid1_marker(db)
    monkeypatch.setattr(serving_marker, "process_command_line", lambda pid: argv)
    assert serving_marker.running_server(db) is not None
    assert serving_marker.marker_path(db).exists()


@pytest.mark.parametrize(
    "argv",
    [None, ["/bin/sh", "-c", "geosan init-db && exec geosan serve --host 0.0.0.0"]],
)
def test_pid1_marker_stays_safe_when_unknown_or_shell(tmp_path, monkeypatch, argv):
    """Given pid 1 명령줄을 모름 / 아직 serve로 바뀌기 전 셸 / Then 안전하게 켜져 있다고 본다."""
    db = tmp_path / "geosan.db"
    _write_pid1_marker(db)
    monkeypatch.setattr(serving_marker, "process_command_line", lambda pid: argv)
    assert serving_marker.running_server(db) is not None


def test_pid1_marker_does_not_block_restore_in_maintenance_mode(tmp_db, tmp_path, monkeypatch):
    """Given 점검 모드(pid 1 = sleep)·남은 pid 1 표식 / When restore(y) / Then 복원된다."""
    from geosan.storage.engine import dispose_engines

    code, out = _run("backup", "--to", tmp_path / "bk")
    assert code == 0, out
    backup_file = next((tmp_path / "bk").glob("geosan-*.db"))
    _write_pid1_marker(tmp_db)
    monkeypatch.setattr(serving_marker, "process_command_line", lambda pid: ["sleep", "infinity"])
    dispose_engines()
    code, out = _run("restore", backup_file, input_text="y\n")
    assert code == 0, out
    assert "복원 완료" in out
    assert not serving_marker.marker_path(tmp_db).exists()


def test_process_command_line_reads_linux_proc_only(monkeypatch, tmp_path):
    """Given /proc 없음 / When 명령줄 조회 / Then 모름(None). /proc가 있으면 내용을 나눈다."""
    monkeypatch.setattr(serving_marker, "PROC_ROOT", tmp_path / "no-proc")
    assert serving_marker.process_command_line(1) is None
    proc = tmp_path / "proc"
    (proc / "1").mkdir(parents=True)
    (proc / "1" / "cmdline").write_bytes(b"sleep\x00infinity\x00")
    monkeypatch.setattr(serving_marker, "PROC_ROOT", proc)
    assert serving_marker.process_command_line(1) == ["sleep", "infinity"]
    (proc / "1" / "cmdline").write_bytes(b"")
    assert serving_marker.process_command_line(1) is None
