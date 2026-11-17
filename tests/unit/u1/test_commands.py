"""투입 명령의 저장·오류 경계와 서버 시작 시 기존 앱 설정 보존을 검사한다."""

from __future__ import annotations

import json
import socket
from copy import deepcopy
from types import SimpleNamespace

from sqlalchemy import func, select
from typer.testing import CliRunner

from geosan.capability.models import Process
from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.config.app_settings import SOURCE_FILE_KEY, load_app_settings
from geosan.config.errors import InputError
from geosan.config.models import AppSetting
from geosan.config.registry import DEFAULT_APP_SETTINGS_PATH, DEFAULT_RULE_CONFIG_PATH
from geosan.opportunity.models import Opportunity
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


def test_import_capability_command_stores_real_rows(tmp_db, tmp_path):
    """Given 역량 파일 / When 명령 실행 / Then 공정 9건을 저장하고 요약을 출력한다."""
    path = _write(tmp_path, "cap.json", factories.capability_file())
    result = CliRunner().invoke(app, ["import-capability", str(path)])
    assert result.exit_code == 0 and "공정 9건" in result.output
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Process)) == 9


def test_import_case_command_stores_real_rows(tmp_db, tmp_path):
    """Given 역량·사례 파일 / When 두 명령 실행 / Then 기회 한 건을 저장한다."""
    runner = CliRunner()
    cap = _write(tmp_path, "cap.json", factories.capability_file())
    case = _write(tmp_path, "case.json", factories.apjeong_case())
    assert runner.invoke(app, ["import-capability", str(cap)]).exit_code == 0
    result = runner.invoke(app, ["import-case", str(case)])
    assert result.exit_code == 0 and "평가하려면 geosan evaluate" in result.output
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Opportunity)) == 1


def test_both_commands_reject_parent_and_missing_paths(tmp_path):
    """Given 상위 폴더·없는 파일 / When 투입 / Then 입력 오류 1로 끝난다."""
    for command in ("import-capability", "import-case"):
        for path in (tmp_path / ".." / "missing.json", tmp_path / "missing.json"):
            result = CliRunner().invoke(app, [command, str(path)])
            assert result.exit_code == 1 and "문의 시 이 번호" in result.output


def test_capability_contact_is_rejected_before_database(tmp_path):
    """Given 연락처가 든 역량 / When 투입 / Then 줄·항목을 알리고 저장하지 않는다."""
    data = factories.capability_file()
    data["processes"][0]["name"] = "가상 문의 sales@example.invalid"
    path = _write(tmp_path, "contact.json", data)
    result = CliRunner().invoke(app, ["import-capability", str(path)])
    assert result.exit_code == 1 and "연락처는 저장하지 않습니다" in result.output
    assert "processes[0].name" in result.output


def test_execution_failure_never_prints_exception_body(tmp_path, monkeypatch):
    """Given 가상 저장 실패 / When 명령 오류 처리 / Then 본문을 숨기고 종료 코드 2를 낸다."""
    import geosan.commands.import_case as command

    def failing_store(path):
        raise RuntimeError("출력하면 안 되는 가상 오류 내용")

    monkeypatch.setattr(command, "import_case", failing_store)
    path = _write(tmp_path, "case.json", factories.apjeong_case())
    result = CliRunner().invoke(app, ["import-case", str(path)])
    assert result.exit_code == 2 and "출력하면 안 되는" not in result.output
    assert "저장하지 못했습니다" in result.output


def test_warnings_precede_summary_and_storage_is_called_once(tmp_path, monkeypatch):
    """Given 가짜 저장 함수 / When 출력 경계 검사 / Then 한 번만 부르고 마지막 줄에 요약한다."""
    import geosan.commands.import_capability as command

    calls = []

    def fake_store(path):
        calls.append(path)
        return SimpleNamespace(warnings=["가상 경고"], summary="가상 저장 요약")

    monkeypatch.setattr(command, "import_capability", fake_store)
    path = _write(tmp_path, "cap.json", factories.capability_file())
    result = CliRunner().invoke(app, ["import-capability", str(path)])
    assert result.exit_code == 0 and calls == [path.resolve()]
    assert "가상 경고" in result.output and "가상 저장 요약" in result.output.splitlines()[-1]


def test_case_validation_error_does_not_become_success(tmp_path, monkeypatch):
    """Given 가짜 입력 오류 / When 명령 오류 처리 / Then 입력 오류 1을 유지한다."""
    import geosan.commands.import_case as command

    def invalid(path):
        raise InputError("가상 입력 오류")

    monkeypatch.setattr(command, "import_case", invalid)
    path = _write(tmp_path, "case.json", factories.apjeong_case())
    result = CliRunner().invoke(app, ["import-case", str(path)])
    assert result.exit_code == 1 and "가상 입력 오류" in result.output


def _app_setting_values():
    with session_scope() as session:
        return {row.setting_key: deepcopy(row.value) for row in session.scalars(select(AppSetting))}


def _register_brochure_app_settings(tmp_path):
    """정식 check-config 명령으로 사용자 지정 파일과 소개서 묶음을 등록한다."""
    folder = tmp_path / "한글 경로 확인"
    folder.mkdir()
    settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH).model_dump(by_alias=True, mode="json")
    settings["activeDatasetKind"] = "BROCHURE"
    settings["brand"]["demoLabel"] = "서버 설정 보존 검사 (가상)"
    path = _write(folder, "소개서 앱 설정.json", settings)
    result = CliRunner().invoke(
        app, ["check-config", str(DEFAULT_RULE_CONFIG_PATH), str(path)], catch_exceptions=False
    )
    assert result.exit_code == 0, result.output
    before = _app_setting_values()
    assert before["activeDatasetKind"] == "BROCHURE"
    assert before[SOURCE_FILE_KEY] == str(path.resolve())
    return before


def test_serve_start_preserves_registered_app_settings(tmp_db, tmp_path, monkeypatch):
    """Given 소개서 묶음·지정 설정 / When 서버 시작 / Then 시작 시점과 종료 뒤 설정이 같다."""
    before = _register_brochure_app_settings(tmp_path)
    started = []

    def record_start(port, host):
        # 서버 실행만 대체하며 설정 검사·등록과 DB 읽기는 실제 코드를 사용한다.
        assert host == "127.0.0.1"
        started.append((port, _app_setting_values()))

    monkeypatch.setattr(serve_module, "_run_server", record_start)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    result = CliRunner().invoke(app, ["serve", "--port", str(port)], catch_exceptions=False)

    assert result.exit_code == 0, result.output
    assert [item[0] for item in started] == [port]
    assert started[0][1] == before
    assert _app_setting_values() == before


def test_serve_port_conflict_preserves_registered_app_settings(tmp_db, tmp_path, monkeypatch):
    """Given 지정 설정·점유된 포트 / When 서버 시작 실패 / Then 설정 보존·종료 코드 2다."""
    before = _register_brochure_app_settings(tmp_path)
    started = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: started.append(port))
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]
        result = CliRunner().invoke(app, ["serve", "--port", str(port)], catch_exceptions=False)

    assert result.exit_code == 2, result.output
    assert f"포트 {port}이 사용 중입니다" in result.output
    assert started == []
    assert _app_setting_values() == before


# --- export-contracts (Step 29, 약속 파일) ---


def test_export_contracts_writes_openapi_from_code(tmp_path, monkeypatch):
    """Given 빈 contracts 폴더 / When export-contracts / Then 코드 경로·필드가 든 파일이 생긴다."""
    from geosan.commands import export_contracts as module

    monkeypatch.setattr(module, "CONTRACTS_DIR", tmp_path)
    result = CliRunner().invoke(app, ["export-contracts"])
    assert result.exit_code == 0, result.output
    assert "openapi.json 갱신" in result.output and "손으로 관리" in result.output
    document = json.loads((tmp_path / "openapi.json").read_text(encoding="utf-8"))
    assert "/api/v1/opportunities/{oppId}" in document["paths"]
    assert "scoreDisplay" in document["components"]["schemas"]["OpportunityCard"]["properties"]
    # 두 번 실행해도 같은 글자(결정성). 두 번째는 "변경 없음".
    again = CliRunner().invoke(app, ["export-contracts"])
    assert again.exit_code == 0 and "변경 없음" in again.output


def test_export_contracts_check_passes_only_when_committed_file_matches(tmp_path, monkeypatch):
    """Given 생성 직후 / When --check / Then 0. 손으로 바꾸면 1이고 덮어쓰지 않는다."""
    from geosan.commands import export_contracts as module

    monkeypatch.setattr(module, "CONTRACTS_DIR", tmp_path)
    runner = CliRunner()
    assert runner.invoke(app, ["export-contracts"]).exit_code == 0
    same = runner.invoke(app, ["export-contracts", "--check"])
    assert same.exit_code == 0 and "같음" in same.output
    target = tmp_path / "openapi.json"
    target.write_text(target.read_text(encoding="utf-8") + "\n// 손으로 고침", encoding="utf-8")
    differ = runner.invoke(app, ["export-contracts", "--check"])
    assert differ.exit_code == 1 and "다름" in differ.output
    assert "손으로 고침" in target.read_text(encoding="utf-8")


def test_export_contracts_check_reports_missing_file_without_writing(tmp_path, monkeypatch):
    """Given openapi.json 없음 / When --check / Then 1로 끝나고 파일을 만들지 않는다."""
    from geosan.commands import export_contracts as module

    monkeypatch.setattr(module, "CONTRACTS_DIR", tmp_path)
    result = CliRunner().invoke(app, ["export-contracts", "--check"])
    assert result.exit_code == 1 and "파일이 없습니다" in result.output
    assert not (tmp_path / "openapi.json").exists()


def test_export_contracts_fails_loudly_when_app_cannot_be_built(tmp_path, monkeypatch):
    """Given 앱 생성 실패 / When export-contracts / Then 성공처럼 보이지 않고 2로 끝난다."""
    from geosan.commands import export_contracts as module

    monkeypatch.setattr(module, "CONTRACTS_DIR", tmp_path)

    def broken() -> dict:
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "build_openapi", broken)
    result = CliRunner().invoke(app, ["export-contracts"])
    assert result.exit_code == 2 and "만들지 못했습니다" in result.output
    assert not (tmp_path / "openapi.json").exists()
