"""투입 명령 2개의 실제 저장과 입력·실행 오류 경계를 검사한다."""

from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import func, select
from typer.testing import CliRunner

from geosan.capability.models import Process
from geosan.commands.app import app
from geosan.config.errors import InputError
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
