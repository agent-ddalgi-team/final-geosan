"""`geosan backup` / `geosan restore` 단위 테스트 (#214, 계약 C8).

실제 임시 SQLite 파일(WAL 모드)로 돌린다. 모든 데이터는 가상이다. 서버는 띄우지 않고
실행 중 표식 파일만 흉내 낸다.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from typer.testing import CliRunner

from geosan.commands import backup as backup_module
from geosan.commands import serve as serve_module
from geosan.commands import serving_marker
from geosan.commands.app import app

FIXED_NOW = datetime(2026, 11, 10, 18, 0, 0)


def _run(*args: str, input_text: str | None = None) -> tuple[int, str]:
    result = CliRunner().invoke(app, list(args), input=input_text, catch_exceptions=False)
    return result.exit_code, result.output


def _write_note(db_path: Path, text: str) -> None:
    """가상 기록 한 줄을 넣는다(WAL에만 남도록 체크포인트는 하지 않는다)."""
    connection = sqlite3.connect(str(db_path))
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE IF NOT EXISTS t_scenario_note (text TEXT NOT NULL)")
        connection.execute("INSERT INTO t_scenario_note (text) VALUES (?)", (text,))
        connection.commit()
    finally:
        connection.close()


def _notes(db_path: Path) -> list[str]:
    connection = sqlite3.connect(str(db_path))
    try:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 't_scenario_note'"
        ).fetchone()
        if exists is None:
            return []
        return [row[0] for row in connection.execute("SELECT text FROM t_scenario_note")]
    finally:
        connection.close()


# ---------------------------------------------------------------- backup


def test_backup_creates_consistent_copy_including_wal(tmp_db: Path, tmp_path: Path, monkeypatch):
    """Given WAL에만 있는 기록 / When backup --to / Then 그 기록까지 든 독립 파일이 생긴다."""
    monkeypatch.setattr(backup_module, "_now", lambda: FIXED_NOW)
    _write_note(tmp_db, "가상 메모 1")
    assert tmp_db.with_name(tmp_db.name + "-wal").exists()

    code, out = _run("backup", "--to", str(tmp_path / "bk"))
    assert code == 0, out
    target = tmp_path / "bk" / "geosan-2026-11-10-1800.db"
    assert target.exists() and "백업 저장" in out and str(target) in out
    assert _notes(target) == ["가상 메모 1"]
    assert backup_module.check_backup_file(target) is None
    assert not target.with_name(target.name + "-wal").exists()
    # 원본은 그대로
    assert _notes(tmp_db) == ["가상 메모 1"]


def test_backup_default_folder_is_backups_under_cwd(tmp_db: Path, tmp_path: Path, monkeypatch):
    """Given --to 없음 / When backup / Then 현재 폴더의 backups/에 저장한다."""
    monkeypatch.chdir(tmp_path)
    code, out = _run("backup")
    assert code == 0, out
    files = list((tmp_path / "backups").glob("geosan-*.db"))
    assert len(files) == 1


def test_backup_same_minute_gets_numbered_suffix(tmp_db: Path, tmp_path: Path, monkeypatch):
    """Given 같은 분에 두 번 / When backup 2회 / Then 두 번째는 -2가 붙고 덮어쓰지 않는다."""
    monkeypatch.setattr(backup_module, "_now", lambda: FIXED_NOW)
    folder = tmp_path / "bk"
    assert _run("backup", "--to", str(folder))[0] == 0
    assert _run("backup", "--to", str(folder))[0] == 0
    names = sorted(p.name for p in folder.iterdir())
    assert names == ["geosan-2026-11-10-1800-2.db", "geosan-2026-11-10-1800.db"]


def test_backup_without_database_is_input_error(tmp_path: Path, monkeypatch):
    """Given DB 파일 없음 / When backup / Then init-db를 안내하고 종료 코드 1."""
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "none.db"))
    code, out = _run("backup", "--to", str(tmp_path / "bk"))
    assert code == 1 and "init-db" in out
    assert not (tmp_path / "bk").exists()


def test_backup_reports_failure_instead_of_hiding_it(tmp_db: Path, tmp_path: Path, monkeypatch):
    """Given 쓸 수 없는 폴더(파일이 그 자리에 있음) / When backup / Then 오류와 종료 코드 2."""
    blocker = tmp_path / "blocked"
    blocker.write_text("not a folder", encoding="utf-8")
    code, out = _run("backup", "--to", str(blocker))
    assert code == 2 and "백업을 만들지 못했습니다" in out


def test_check_backup_file_rejects_bad_files(tmp_db: Path, tmp_path: Path):
    """Given SQLite 아님 / 거산 DB 아님 / When 검사 / Then 각각 이유를 돌려준다."""
    text = tmp_path / "a.db"
    text.write_text("hello", encoding="utf-8")
    assert "SQLite" in (backup_module.check_backup_file(text) or "")

    other = tmp_path / "other.db"
    connection = sqlite3.connect(str(other))
    connection.execute("CREATE TABLE x (a)")
    connection.commit()
    connection.close()
    assert "alembic_version" in (backup_module.check_backup_file(other) or "")

    assert backup_module.check_backup_file(tmp_path / "missing.db") is not None


# ---------------------------------------------------------------- restore


def _make_backup(tmp_db: Path, folder: Path) -> Path:
    return backup_module.create_backup(tmp_db, folder)


def test_restore_returns_db_to_backup_and_keeps_current(tmp_db: Path, tmp_path: Path):
    """Given 백업 뒤 기록 추가 / When restore(y) / Then 백업 시점으로 돌아가고 직전 DB 보관."""
    _write_note(tmp_db, "백업 전 메모")
    backup_file = _make_backup(tmp_db, tmp_path / "bk")
    _write_note(tmp_db, "백업 뒤 메모")
    assert _notes(tmp_db) == ["백업 전 메모", "백업 뒤 메모"]

    code, out = _run("restore", str(backup_file), input_text="y\n")
    assert code == 0, out
    assert "복원 완료" in out and "init-db" in out and "serve" in out
    assert _notes(tmp_db) == ["백업 전 메모"]
    kept = list((tmp_path / "bk").glob("geosan-before-restore-*.db"))
    assert len(kept) == 1 and _notes(kept[0]) == ["백업 전 메모", "백업 뒤 메모"]
    assert not tmp_db.with_name(tmp_db.name + "-wal").exists()
    assert not tmp_db.with_name(tmp_db.name + "-shm").exists()
    assert not tmp_db.with_name(tmp_db.name + ".restoring").exists()


def test_restore_declined_changes_nothing(tmp_db: Path, tmp_path: Path):
    """Given 백업 파일 / When restore에 n / Then 아무것도 바꾸지 않고 종료 코드 0."""
    backup_file = _make_backup(tmp_db, tmp_path / "bk")
    _write_note(tmp_db, "남아야 할 메모")
    code, out = _run("restore", str(backup_file), input_text="n\n")
    assert code == 0 and "복원하지 않았습니다" in out
    assert _notes(tmp_db) == ["남아야 할 메모"]
    assert list((tmp_path / "bk").glob("geosan-before-restore-*.db")) == []


def test_restore_refuses_while_server_runs(tmp_db: Path, tmp_path: Path):
    """Given 살아 있는 pid의 실행 중 표식 / When restore / Then 거부, 종료 코드 2, DB 그대로."""
    backup_file = _make_backup(tmp_db, tmp_path / "bk")
    _write_note(tmp_db, "서버 켜진 동안 메모")
    serving_marker.write_marker(tmp_db, port=8000, host="127.0.0.1")  # 이 테스트 프로세스의 pid
    code, out = _run("restore", str(backup_file), input_text="y\n")
    assert code == 2 and "서버가 켜져 있습니다" in out and "포트 8000" in out
    assert _notes(tmp_db) == ["서버 켜진 동안 메모"]
    assert serving_marker.marker_path(tmp_db).exists()


def test_restore_ignores_stale_marker_of_dead_process(tmp_db: Path, tmp_path: Path):
    """Given 죽은 pid의 표식 / When restore(y) / Then 오래된 표식으로 보고 지운 뒤 복원한다."""
    backup_file = _make_backup(tmp_db, tmp_path / "bk")
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    serving_marker.marker_path(tmp_db).write_text(
        f'{{"pid": {dead.pid}, "port": 8000, "host": "127.0.0.1"}}', encoding="utf-8"
    )
    code, out = _run("restore", str(backup_file), input_text="y\n")
    assert code == 0, out
    assert not serving_marker.marker_path(tmp_db).exists()


def test_restore_rejects_missing_or_invalid_file(tmp_db: Path, tmp_path: Path):
    """Given 없는 파일 / 텍스트 파일 / DB 자신 / When restore / Then 종료 코드 1, 바뀐 것 없음."""
    _write_note(tmp_db, "그대로")
    code, out = _run("restore", str(tmp_path / "nope.db"))
    assert code == 1 and "백업 파일이 없습니다" in out

    text = tmp_path / "text.db"
    text.write_text("hello", encoding="utf-8")
    code, out = _run("restore", str(text))
    assert code == 1 and "백업 파일로 쓸 수 없습니다" in out

    code, out = _run("restore", str(tmp_db))
    assert code == 1 and "자체" in out
    assert _notes(tmp_db) == ["그대로"]


def test_restore_when_db_missing_just_puts_backup_in_place(tmp_db: Path, tmp_path: Path):
    """Given DB 파일이 지워짐 / When restore(y) / Then 보관할 것 없이 백업을 제자리에 둔다."""
    _write_note(tmp_db, "복구될 메모")
    backup_file = _make_backup(tmp_db, tmp_path / "bk")
    from geosan.storage.engine import dispose_engines

    dispose_engines()
    tmp_db.unlink()
    for suffix in ("-wal", "-shm"):
        tmp_db.with_name(tmp_db.name + suffix).unlink(missing_ok=True)
    code, out = _run("restore", str(backup_file), input_text="y\n")
    assert code == 0, out
    assert "보관할 것이 없습니다" in out
    assert _notes(tmp_db) == ["복구될 메모"]
    assert list((tmp_path / "bk").glob("geosan-before-restore-*.db")) == []


def test_restore_reports_replace_failure(tmp_db: Path, tmp_path: Path, monkeypatch):
    """Given 바꿔 넣기 실패 / When restore(y) / Then 종료 코드 2와 보관본 위치를 알린다."""
    from geosan.commands import restore as restore_module

    backup_file = _make_backup(tmp_db, tmp_path / "bk")

    def _boom(db_path: Path, backup: Path) -> None:
        raise PermissionError("가상 권한 오류")

    monkeypatch.setattr(restore_module, "replace_database", _boom)
    code, out = _run("restore", str(backup_file), input_text="y\n")
    assert code == 2 and "바꿔 넣지 못했습니다" in out and "보관본" in out


# ---------------------------------------------------------------- 실행 중 표식


def test_serve_writes_marker_while_running_and_removes_after(tmp_db: Path, monkeypatch):
    """Given serve / When 서버가 도는 동안 / Then 표식이 있고, 끝나면 지워진다."""
    seen: list[dict | None] = []

    def _fake_server(port: int, host: str) -> None:
        seen.append(serving_marker.read_marker(tmp_db))

    monkeypatch.setattr(serve_module, "_run_server", _fake_server)
    code, out = _run("serve", "--port", "18766")
    assert code == 0, out
    assert seen and seen[0] is not None
    assert seen[0]["pid"] == os.getpid() and seen[0]["port"] == 18766
    assert not serving_marker.marker_path(tmp_db).exists()


def test_serve_removes_marker_even_when_server_crashes(tmp_db: Path, monkeypatch):
    """Given 서버가 예외로 멈춤 / When serve / Then 종료 코드 2이고 표식은 남지 않는다."""

    def _crash(port: int, host: str) -> None:
        raise RuntimeError("가상 서버 오류")

    monkeypatch.setattr(serve_module, "_run_server", _crash)
    code, out = _run("serve", "--port", "18767")
    assert code == 2 and "서버가 멈췄습니다" in out
    assert not serving_marker.marker_path(tmp_db).exists()


def test_marker_helpers_handle_missing_and_broken_files(tmp_path: Path):
    """Given 표식 없음 / 깨진 표식 / When 읽기 / Then None, running_server도 None."""
    db = tmp_path / "x.db"
    assert serving_marker.read_marker(db) is None
    serving_marker.marker_path(db).write_text("{broken", encoding="utf-8")
    assert serving_marker.read_marker(db) is None
    assert serving_marker.running_server(db) is None
    serving_marker.marker_path(db).write_text('{"pid": "no"}', encoding="utf-8")
    assert serving_marker.read_marker(db) is None


def test_pid_alive_distinguishes_live_and_dead():
    """Given 내 pid / 끝난 프로세스 pid / 0 / When pid_alive / Then 참 / 거짓 / 거짓."""
    assert serving_marker.pid_alive(os.getpid()) is True
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    assert serving_marker.pid_alive(dead.pid) is False
    assert serving_marker.pid_alive(0) is False


def test_pid_alive_treats_permission_error_as_alive(monkeypatch):
    """Given 권한 없음 / When pid_alive / Then 살아 있다고 본다(복원을 섣불리 허용하지 않음)."""
    if sys.platform == "win32":
        return

    def _deny(pid: int, sig: int) -> None:
        raise PermissionError

    monkeypatch.setattr(os, "kill", _deny)
    assert serving_marker.pid_alive(12345) is True
