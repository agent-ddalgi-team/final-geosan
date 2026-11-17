"""#719(PM 결정 2026-11-14): git 정보가 없어도 평가가 저장되고 그 사실이 버전 값에 드러난다.

실제 임시 DB로 평가를 돌린다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
git 명령은 가짜로 바꿔 "git 정보 없음"·"git 명령 없음"을 만든다.
"""

import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select
from typer.testing import CliRunner

from geosan import __version__
from geosan.capability.importer import import_capability
from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.evaluation.models import EvaluationBatch
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def no_version_env(monkeypatch):
    for name in ("GEOSAN_CODE_VERSION", "RAILWAY_GIT_COMMIT_SHA"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def no_git(monkeypatch):
    """git 정보가 없는 폴더(저장소 사본·배포 서버)처럼: git 명령이 128로 끝난다."""

    def run(command, **_):
        raise subprocess.CalledProcessError(128, command)

    monkeypatch.setattr(flow_evaluate.subprocess, "run", run)


def _evaluate(tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    import_case(_write(tmp_path, "a.json", factories.apjeong_case()))
    result = flow_evaluate.run_evaluation()
    with session_scope() as session:
        versions = list(session.scalars(select(EvaluationBatch.code_version)))
    return result, versions


def test_evaluation_is_saved_without_git_and_the_version_says_so(tmp_db, tmp_path, no_git):
    """Given git 정보도 환경 변수도 없음 / When 평가 / Then 저장되고 버전에 nogit 표시."""
    result, versions = _evaluate(tmp_path)
    assert result.ok, result.error
    assert versions == [f"{__version__}+nogit"]


def test_missing_git_program_is_also_survived(monkeypatch):
    def run(command, **_):
        raise FileNotFoundError("git")

    monkeypatch.setattr(flow_evaluate.subprocess, "run", run)
    assert flow_evaluate.code_version() == f"{__version__}+nogit"


def test_git_commit_is_used_as_before_when_there_is_no_environment_value():
    """Given 저장소 안(환경 변수 없음) / Then 지금처럼 패키지 버전 + git 짧은 커밋 번호."""
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=REPO, capture_output=True, text=True
    ).stdout.strip()
    assert commit
    assert flow_evaluate.code_version() == f"{__version__}+{commit}"


def test_environment_value_wins_and_our_name_comes_first(tmp_db, tmp_path, monkeypatch, no_git):
    """Given 배포 서비스가 준 커밋 번호 / Then git을 보지 않고 그 값으로 적는다(우리 이름 먼저)."""
    assert flow_evaluate.CODE_VERSION_ENV_NAMES == ("GEOSAN_CODE_VERSION", "RAILWAY_GIT_COMMIT_SHA")
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "a" * 40)
    assert flow_evaluate.code_version() == f"{__version__}+{'a' * 40}"
    monkeypatch.setenv("GEOSAN_CODE_VERSION", " v2026.11.14-rc1 ")
    assert flow_evaluate.code_version() == f"{__version__}+v2026.11.14-rc1"
    result, versions = _evaluate(tmp_path)
    assert result.ok, result.error
    assert versions == [f"{__version__}+v2026.11.14-rc1"]


@pytest.mark.parametrize(
    "value", ["", "   ", "abc def", "abc\n123", "x" * 41, "커밋", "a;rm -rf", "../etc"]
)
def test_odd_environment_values_are_refused_not_stored(monkeypatch, no_git, value):
    """Given 공백·줄바꿈·너무 긴 값 / Then 그 값은 쓰지 않고 다음 방법으로 넘어간다."""
    monkeypatch.setenv("GEOSAN_CODE_VERSION", value)
    resolved = flow_evaluate.resolve_code_version()
    assert resolved.value == f"{__version__}+nogit"
    assert resolved.source == "FALLBACK"
    assert resolved.refused == (["GEOSAN_CODE_VERSION"] if value.strip() else [])
    # 이상한 우리 값은 건너뛰고 배포 서비스 값은 그대로 쓴다.
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "abc1234")
    assert flow_evaluate.code_version() == f"{__version__}+abc1234"


def test_version_always_fits_the_evaluation_record_column():
    limit = EvaluationBatch.__table__.c.code_version.type.length
    longest = f"{__version__}+{'a' * flow_evaluate.CODE_VERSION_MAX_LENGTH}"
    assert len(longest) <= limit


def _serve(monkeypatch):
    started = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: started.append(host))
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    result = CliRunner().invoke(app, ["serve", "--port", "18776"])
    assert result.exit_code == 0 and started == ["127.0.0.1"], result.output
    return result.output


def test_serve_warns_once_when_the_version_is_a_fallback(tmp_db, monkeypatch, no_git):
    """Given 대체 값이 쓰이는 환경 / When 서버 시작 / Then 시작 줄에 경고와 고치는 방법이 보인다."""
    output = _serve(monkeypatch)
    assert "코드 버전을 알 수 없어 패키지 버전으로 적습니다" in output
    assert "GEOSAN_CODE_VERSION" in output and f"{__version__}+nogit" in output


def test_serve_does_not_warn_when_the_version_is_known(tmp_db, monkeypatch, no_git):
    monkeypatch.setenv("GEOSAN_CODE_VERSION", "abc1234")
    assert "코드 버전을 알 수 없어" not in _serve(monkeypatch)
