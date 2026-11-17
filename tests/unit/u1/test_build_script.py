"""#213 빌드 실패 분기. npm은 대체하고 임시 폴더로 결과 파일을 검사한다."""

import subprocess

import pytest

from scripts import build


@pytest.fixture
def build_env(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "ROOT", tmp_path)
    monkeypatch.setattr(build.shutil, "which", lambda name: "npm-for-test")
    (tmp_path / "web").mkdir()
    return tmp_path


@pytest.mark.parametrize("failed_step,exit_code", [("ci", 17), ("build", 23)])
def test_failure_stops_even_when_old_output_exists(
    build_env, monkeypatch, capsys, failed_step, exit_code
):
    """Given 지난 빌드 파일 / When 설치 또는 빌드 실패 / Then 이전 파일로 성공을 꾸미지 않는다."""
    output = build_env / "web/dist/index.html"
    output.parent.mkdir()
    output.write_text("old build", encoding="utf-8")
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[-1] == failed_step:
            raise subprocess.CalledProcessError(exit_code, command)

    monkeypatch.setattr(build.subprocess, "run", run)
    assert build.main() == exit_code
    assert len(calls) == (1 if failed_step == "ci" else 2)
    assert "빌드 완료" not in capsys.readouterr().out
    assert output.read_text(encoding="utf-8") == "old build"


def test_missing_output_is_error_after_successful_commands(build_env, monkeypatch, capsys):
    """Given 명령 종료는 성공 / When 화면 파일 없음 / Then 배포 준비 완료로 보고하지 않는다."""
    monkeypatch.setattr(build.subprocess, "run", lambda *args, **kwargs: None)
    with pytest.raises(SystemExit, match="빌드 결과가 없습니다"):
        build.main()
    assert "빌드 완료" not in capsys.readouterr().out


def test_fixture_mode_is_disabled_for_children_without_changing_parent(
    build_env, monkeypatch, capsys
):
    """Given 개발용 가짜 응답 켜짐 / When 배포 빌드 / Then 자식 명령에는 끄기를 전달한다."""
    monkeypatch.setenv("VITE_USE_FIXTURES", "1")
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        if command[-1] == "build":
            output = build_env / "web/dist/index.html"
            output.parent.mkdir()
            output.write_text("new build", encoding="utf-8")

    monkeypatch.setattr(build.subprocess, "run", run)
    assert build.main() == 0
    assert [command[1:] for command, _ in calls] == [["ci"], ["run", "build"]]
    for _, options in calls:
        assert options["env"]["VITE_USE_FIXTURES"] == "0"
        assert options["cwd"] == build_env / "web"
        assert options["check"] is True
    assert build.os.environ["VITE_USE_FIXTURES"] == "1"
    assert "빌드 완료" in capsys.readouterr().out


def test_missing_npm_does_not_start_install(build_env, monkeypatch):
    """Given npm 없음 / When 실행 / Then 설치 안내 오류이며 명령을 실행하지 않는다."""
    monkeypatch.setattr(build.shutil, "which", lambda name: None)

    def unexpected(*args, **kwargs):
        pytest.fail("npm이 없으면 설치 명령을 실행하면 안 됩니다.")

    monkeypatch.setattr(build.subprocess, "run", unexpected)
    with pytest.raises(SystemExit, match="먼저 설치"):
        build.main()
