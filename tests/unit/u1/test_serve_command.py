"""`geosan serve` 명령 단위 테스트 (Step 19 나머지, W9·NFR7.3·NFR11.3).

실제 uvicorn은 띄우지 않고 `_run_server`를 가짜로 바꾼다. 설정 검사·DB 확인·포트 확인·정상 시작
네 경로를 본다. 모든 데이터는 가상이다.
"""

from __future__ import annotations

import socket
from pathlib import Path

from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.config.app_settings import read_app_settings
from geosan.config.registry import set_active_dataset_kind
from geosan.storage.session import session_scope


def _run(*args: str) -> tuple[int, str]:
    result = CliRunner().invoke(app, list(args), catch_exceptions=False)
    return result.exit_code, result.output


def test_serve_starts_on_loopback_with_given_port(tmp_db: Path, monkeypatch) -> None:
    """Given 설정·DB 준비 / When serve --port / Then 127.0.0.1과 그 포트로 서버를 한 번 띄운다."""
    calls: list[int] = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port: calls.append(port))
    code, out = _run("serve", "--port", "18765")
    assert code == 0, out
    assert calls == [18765]
    assert "http://127.0.0.1:18765" in out and "서버를 종료했습니다" in out


def test_serve_refuses_when_config_check_fails(tmp_db: Path, monkeypatch) -> None:
    """Given 설정 검사 실패 / When serve / Then 서버를 띄우지 않고 종료 코드 1로 끝난다."""
    started: list[int] = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port: started.append(port))
    monkeypatch.setattr(serve_module, "run_check_config", lambda rule, settings, **_kw: 1)
    code, out = _run("serve")
    assert code == 1 and "서버를 시작하지 않았습니다" in out
    assert started == []


def test_serve_refuses_without_database(tmp_path: Path, monkeypatch) -> None:
    """Given DB 파일 없음 / When serve / Then init-db를 안내하고 종료 코드 1로 끝난다."""
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "missing" / "geosan.db"))
    monkeypatch.setattr(serve_module, "_run_server", lambda port: None)
    code, out = _run("serve")
    assert code == 1 and "init-db" in out


def test_serve_reports_port_in_use(tmp_db: Path, monkeypatch) -> None:
    """Given 이미 열린 포트 / When serve --port 그 포트 / Then 쉬운 말 안내와 종료 코드 2."""
    started: list[int] = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port: started.append(port))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]
        code, out = _run("serve", "--port", str(port))
    assert code == 2
    assert f"포트 {port}이 사용 중입니다. --port로 바꾸세요." in out
    assert started == []


def test_serve_rejects_out_of_range_port(tmp_db: Path, monkeypatch) -> None:
    """Given 포트 70000 / When serve / Then 입력 오류 1로 끝난다."""
    monkeypatch.setattr(serve_module, "_run_server", lambda port: None)
    code, out = _run("serve", "--port", "70000")
    assert code == 1 and "1~65535" in out


def test_serve_hides_exception_body_when_server_dies(tmp_db: Path, monkeypatch) -> None:
    """Given 서버 함수가 예외 / When serve / Then 예외 본문 없이 종류만 보이고 종료 코드 2."""

    def boom(port: int) -> None:
        raise RuntimeError("secret detail must not leak")

    monkeypatch.setattr(serve_module, "_run_server", boom)
    code, out = _run("serve", "--port", "18766")
    assert code == 2 and "RuntimeError" in out and "secret detail" not in out


def _choose_brochure(tmp_db: Path) -> None:
    with session_scope(tmp_db) as session:
        set_active_dataset_kind(session, "BROCHURE")


def _active_kind(tmp_db: Path) -> str:
    with session_scope(tmp_db) as session:
        settings = read_app_settings(session)
    assert settings is not None
    return settings.active_dataset_kind


def test_serve_keeps_chosen_dataset_kind_on_start(tmp_db: Path, monkeypatch) -> None:
    """Given 소개서 묶음을 골라 둠 / When serve / Then 예시 설정으로 되돌리지 않는다(#91)."""
    _choose_brochure(tmp_db)
    monkeypatch.setattr(serve_module, "_run_server", lambda port: None)
    code, out = _run("serve", "--port", "18767")
    assert code == 0, out
    assert _active_kind(tmp_db) == "BROCHURE"
    assert "활성 묶음 BROCHURE" in out and "바꾸지 않았습니다" in out


def test_serve_port_conflict_does_not_touch_settings(tmp_db: Path, monkeypatch) -> None:
    """Given 소개서 묶음 선택·포트 사용 중 / When serve 그 포트 / Then 실패해도 설정 그대로(#91)."""
    _choose_brochure(tmp_db)
    monkeypatch.setattr(serve_module, "_run_server", lambda port: None)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        code, _out = _run("serve", "--port", str(holder.getsockname()[1]))
    assert code == 2
    assert _active_kind(tmp_db) == "BROCHURE"
