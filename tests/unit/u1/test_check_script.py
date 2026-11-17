"""#782 PR 전 검사(scripts/check.py)는 한 단계가 실패해도 끝까지 돌고
끝에 실패한 단계를 모아 알린다.

명령은 실제로 돌리지 않고 가짜로 바꿔, 어떤 명령이 어떤 순서로 불렸는지와 종료 코드만 본다.
"""

import subprocess

import pytest

from scripts import check


@pytest.fixture
def fake_env(monkeypatch):
    """명령을 가짜로 바꾼다. fail_when에 넣은 글자가 명령에 있으면 그 명령은 실패한다."""
    calls: list[list[str]] = []
    fail_when: list[str] = []
    secrets = {"fail": False, "calls": 0}

    def run(command, **kwargs):
        calls.append(command)
        if any(word in " ".join(command) for word in fail_when):
            raise subprocess.CalledProcessError(1, command)

    def check_secrets():
        secrets["calls"] += 1
        if secrets["fail"]:
            raise check.CheckFailed("가짜 비밀 검사 실패")

    monkeypatch.setattr(check.subprocess, "run", run)
    monkeypatch.setattr(check, "check_secrets", check_secrets)
    monkeypatch.setattr(check.shutil, "which", lambda name: "npm")
    monkeypatch.setattr(check, "find_python", lambda: "py")
    return calls, fail_when, secrets


def joined(calls):
    return [" ".join(command) for command in calls]


def test_all_pass_ends_with_done_and_zero(fake_env, capsys):
    """Given 모든 명령 통과 / When 전부 검사 / Then "검사 끝"과 종료 코드 0."""
    calls, _fail_when, secrets = fake_env
    assert check.main(["check.py"]) == 0
    out = capsys.readouterr().out
    assert out.rstrip().endswith("검사 끝")
    assert "검사 실패" not in out
    assert "npm --prefix web run build" in joined(calls)
    assert secrets["calls"] == 2  # 파이썬 첫 단계 + 화면 끝 단계


def test_unit_test_failure_keeps_going_to_scenarios_and_web(fake_env, capsys):
    """Given 단위 시험이 실패(예: 8000번 포트) / When 전부 검사 /
    Then 시나리오·화면 검사까지 돌고, 끝에 그 단계 이름을 보여 주며 종료 코드 1."""
    calls, fail_when, _secrets = fake_env
    fail_when.append("tests/unit")
    assert check.main(["check.py"]) == 1
    commands = joined(calls)
    assert any("tests/features" in c for c in commands)
    assert "npm --prefix web test" in commands
    assert "npm --prefix web run build" in commands
    out = capsys.readouterr().out
    summary = out.split("검사 실패")[1]
    assert "[3/5] 단위 테스트 + 커버리지 80% 하한" in summary
    assert "시나리오" not in summary
    assert "검사 끝" not in out


def test_both_commands_in_one_step_run_and_step_listed_once(fake_env, capsys):
    """Given 모양 검사의 앞 명령(format)이 실패 / When 파이썬만 검사 /
    Then 뒤 명령(ruff check)도 돌고, 실패 목록에는 그 단계가 한 번만 나온다."""
    calls, fail_when, _secrets = fake_env
    fail_when.append("ruff format")
    assert check.main(["check.py", "python"]) == 1
    assert "py -m ruff check ." in joined(calls)
    summary = capsys.readouterr().out.split("검사 실패")[1]
    assert summary.count("[2/5] 코드 모양") == 1


def test_secret_check_failure_is_listed_and_next_steps_run(fake_env, capsys):
    """Given 비밀·DB 파일 검사 실패 / When 화면만 검사 /
    Then 화면 검사는 다 돌고 끝에 비밀 검사 단계가 실패로 나온다."""
    calls, _fail_when, secrets = fake_env
    secrets["fail"] = True
    assert check.main(["check.py", "web"]) == 1
    assert "npm --prefix web run build" in joined(calls)
    summary = capsys.readouterr().out.split("검사 실패")[1]
    assert "[web 4/4] 비밀·DB 파일 검사" in summary


def test_skeleton_failure_is_still_allowed(fake_env, capsys):
    """Given 뼈대 검증 명령 실패 / When 파이썬만 검사 /
    Then 지금처럼 허용 안내만 내고 검사는 통과한다(기준을 바꾸지 않음)."""
    _calls, fail_when, _secrets = fake_env
    fail_when.append("verify-case")
    assert check.main(["check.py", "python"]) == 0
    out = capsys.readouterr().out
    assert "뼈대 검증 실패: 통합 전까지 허용" in out
    assert out.rstrip().endswith("검사 끝")


def test_fast_runs_only_changed_unit_tests_without_coverage(fake_env, capsys, monkeypatch):
    """Given 이 가지에서 바뀐 단위 시험 1개 + 직접 적은 경로 1개 / When fast 검사(#830)
    / Then 단위 시험은 그 두 파일만 커버리지 없이, 시나리오·화면은 전부 돌고 "빠른 검사 끝"."""
    calls, _fail_when, _secrets = fake_env
    monkeypatch.setattr(check, "changed_unit_tests", lambda: ["tests/unit/u7/test_a.py"])
    assert check.main(["check.py", "fast", "tests/unit/u3/test_b.py"]) == 0
    out = capsys.readouterr().out
    commands = joined(calls)
    unit = [c for c in commands if "pytest" in c and "tests/unit" in c]
    assert unit == ["py -m pytest tests/unit/u3/test_b.py tests/unit/u7/test_a.py -q --no-cov"]
    assert not any("--cov=geosan" in c for c in commands)
    assert "py -m pytest tests/features -q --no-cov" in commands
    assert "npm --prefix web test" in commands
    assert "빠른 검사 끝" in out


def test_fast_without_changed_unit_tests_skips_unit_step(fake_env, capsys, monkeypatch):
    """Given 바뀐 단위 시험이 없음 / When fast 검사
    / Then 단위 시험 명령 없이 안내만, 나머지는 돈다."""
    calls, _fail_when, _secrets = fake_env
    monkeypatch.setattr(check, "changed_unit_tests", lambda: [])
    assert check.main(["check.py", "fast"]) == 0
    out = capsys.readouterr().out
    assert not any("tests/unit" in c for c in joined(calls))
    assert "바뀐 단위 시험 파일이 없습니다" in out
    assert "py -m pytest tests/features -q --no-cov" in joined(calls)
