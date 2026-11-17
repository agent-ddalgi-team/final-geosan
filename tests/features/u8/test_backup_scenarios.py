"""가상 기록·실제 임시 DB로 확인하는 백업·복원 사용자 시나리오 (#214)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from pytest_bdd import given, scenarios, then, when
from typer.testing import CliRunner

from geosan.commands import serving_marker
from geosan.commands.app import app

scenarios("u8/backup.feature")


def _add_note(db_path: Path, text: str) -> None:
    connection = sqlite3.connect(str(db_path))
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS t_scenario_note (text TEXT NOT NULL)")
        connection.execute("INSERT INTO t_scenario_note (text) VALUES (?)", (text,))
        connection.commit()
    finally:
        connection.close()


def _notes(db_path: Path) -> list[str]:
    connection = sqlite3.connect(str(db_path))
    try:
        return [row[0] for row in connection.execute("SELECT text FROM t_scenario_note")]
    finally:
        connection.close()


@given("기록이 들어 있는 가상 데이터베이스가 있다", target_fixture="ctx")
def database_with_records(tmp_db: Path, tmp_path: Path):
    _add_note(tmp_db, "가상 메모: 11/10 방문 예정")
    return {"db": tmp_db, "folder": tmp_path / "backups", "runner": CliRunner()}


@when("백업 명령을 실행한다")
def run_backup(ctx):
    ctx["result"] = ctx["runner"].invoke(app, ["backup", "--to", str(ctx["folder"])])


@then("백업 파일이 생긴다")
def backup_exists(ctx):
    assert ctx["result"].exit_code == 0, ctx["result"].output
    files = list(ctx["folder"].glob("geosan-*.db"))
    assert len(files) == 1
    ctx["backup"] = files[0]


@given("백업 파일이 있다")
def backup_file_present(ctx):
    run_backup(ctx)
    backup_exists(ctx)


@when("그 뒤 기록이 하나 더 쌓인다")
def one_more_record(ctx):
    _add_note(ctx["db"], "가상 메모: 백업 뒤에 적음")


@when("서버를 멈춘 상태에서 백업 파일로 복원한다")
def restore_with_server_stopped(ctx):
    assert serving_marker.running_server(ctx["db"]) is None
    ctx["result"] = ctx["runner"].invoke(app, ["restore", str(ctx["backup"])], input="y\n")


@then("데이터베이스가 백업 시점으로 돌아가고 복원 전 상태도 따로 보관된다")
def restored_and_kept(ctx):
    assert ctx["result"].exit_code == 0, ctx["result"].output
    assert _notes(ctx["db"]) == ["가상 메모: 11/10 방문 예정"]
    kept = list(ctx["folder"].glob("geosan-before-restore-*.db"))
    assert len(kept) == 1
    assert _notes(kept[0]) == ["가상 메모: 11/10 방문 예정", "가상 메모: 백업 뒤에 적음"]


@when("서버가 켜진 상태에서 복원한다")
def restore_while_serving(ctx):
    serving_marker.write_marker(ctx["db"], port=8000, host="127.0.0.1")
    ctx["result"] = ctx["runner"].invoke(app, ["restore", str(ctx["backup"])], input="y\n")


@then("복원이 거부되고 데이터베이스는 그대로다")
def refused(ctx):
    assert ctx["result"].exit_code == 2
    assert "서버가 켜져 있습니다" in ctx["result"].output
    assert _notes(ctx["db"]) == ["가상 메모: 11/10 방문 예정"]
    serving_marker.remove_marker(ctx["db"])
