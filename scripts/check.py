#!/usr/bin/env python3
"""PR 전에 로컬에서 CI와 같은 검사를 같은 순서로 돌린다 — 맥·윈도우 공통판.

scripts/check.sh(맥·리눅스 bash)와 단계·순서가 같다. 둘 중 하나를 바꾸면 다른 쪽도 같이 맞춘다.
한 단계가 실패해도 멈추지 않고 끝까지 돈 뒤, 맨 끝에 실패한 단계를 모아 보여 주고
종료 코드 1로 끝난다(#782, PM 결정 2026-11-16). 기준(커버리지 80% 하한·시나리오 필수)은
그대로이고 멈추는 자리만 끝으로 옮겼다.
비밀·DB 파일 검사는 scripts/check-secrets.sh와 같은 규칙을 파이썬으로 옮긴 것이다.

사용 (저장소 어디서 실행해도 된다):
    python scripts/check.py            # 파이썬 + 화면 전부
    python scripts/check.py python     # 파이썬만
    python scripts/check.py web        # 화면만
윈도우 PowerShell:
    .venv\\Scripts\\python scripts\\check.py python

전제: 파이썬은 `.venv`(3.12)에 `pip install -r requirements.lock -e .`가 되어 있다.
      화면은 web/에서 `npm ci`가 되어 있다(README 설치 절).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_python() -> str:
    """check.sh와 같은 순서: .venv의 파이썬이 있으면 그것, 없으면 지금 실행 중인 파이썬."""
    for candidate in (ROOT / ".venv" / "Scripts" / "python.exe", ROOT / ".venv" / "bin" / "python"):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def find_npm() -> str:
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit(
            "npm을 찾을 수 없습니다. Node.js 20(web/.nvmrc)을 설치하고 터미널을 다시 엽니다."
        )
    return npm


class CheckFailed(Exception):
    """비밀·DB 파일 검사처럼 명령이 아닌 검사가 실패했다."""


def run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    """명령 하나를 돌리고 실패하면 CalledProcessError를 낸다(단계가 받아 실패로 적는다)."""
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, env=env, check=True)


def step(failed: list[str], name: str, *actions: Callable[[], None]) -> None:
    """단계 하나. 안의 일을 모두 돌리고(앞이 실패해도 뒤를 돌림) 하나라도 실패하면
    이름을 failed에 적어 두고 다음 단계로 간다(check.sh의 step과 같다)."""
    print(f"== {name}", flush=True)
    ok = True
    for action in actions:
        try:
            action()
        except (subprocess.CalledProcessError, CheckFailed):
            ok = False
    if not ok:
        failed.append(name)
        print(f"   (실패: {name} — 다음 단계는 계속 돌립니다)", flush=True)


def run_allowed_to_fail(
    cmds: list[list[str]], note: str, *, env: dict[str, str] | None = None
) -> None:
    """통합 전까지 실패를 허용하는 단계. 실패해도 멈추지 않고 안내만 낸다."""
    try:
        for cmd in cmds:
            run(cmd, env=env)
    except subprocess.CalledProcessError:
        print(f"   ({note})", flush=True)


# ---------- 비밀·DB 파일 검사 (scripts/check-secrets.sh와 같은 규칙) ----------

FORBIDDEN_FILE = re.compile(r"(^|/)(\.env|.*\.db|.*\.db-wal|.*\.db-shm)$")
SECRET_PATTERN = re.compile(
    r"(sk-[A-Za-z0-9]{20,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|sk-ant-[A-Za-z0-9-]{20,}"
    r"|(password|apiKey|api_key|token)\s*[:=]\s*[\"']?[A-Za-z0-9+/_-]{16,}[\"']?\s*$)"
)
SCAN_PATHS = [
    "geosan",
    "web/src",
    "web/package.json",
    "web/vite.config.ts",
    "web/vitest.config.ts",
    "tests",
    "examples",
    "contracts",
    "scripts",
    "docs",
    ".github",
    "pyproject.toml",
    "README.md",
    ".env.example",
    "AGENTS.md",
]
SKIP_IN_SCAN = re.compile(r"(^docs/input/|\.png$|\.jpg$|\.woff2?$)")
SELF_FILES = {"scripts/check-secrets.sh", "scripts/check.py"}


def git_ls_files(paths: list[str]) -> list[str]:
    out = subprocess.run(
        ["git", "-c", "core.quotepath=false", "ls-files", "-z", "--", *paths],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout
    return [p.decode("utf-8") for p in out.split(b"\0") if p]


def check_secrets() -> None:
    status = 0

    bad_files = [p for p in git_ls_files([]) if FORBIDDEN_FILE.search(p)]
    if bad_files:
        print("커밋하면 안 되는 파일이 있습니다(.env, *.db):")
        print("\n".join(bad_files))
        status = 1

    existing = [p for p in SCAN_PATHS if (ROOT / p).exists()]
    hits: list[str] = []
    for path in git_ls_files(existing):
        if SKIP_IN_SCAN.search(path) or path in SELF_FILES:
            continue
        try:
            text = (ROOT / path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if SECRET_PATTERN.search(line):
                hits.append(f"{path}:{lineno}:{line}")
    if hits:
        print("비밀 값처럼 보이는 문자열이 있습니다. 환경 변수로 옮겨 주세요:")
        print("\n".join(hits))
        status = 1

    if status != 0:
        raise CheckFailed("비밀·DB 파일 검사 실패")
    print("비밀·DB 파일 검사 통과")


# ---------- 파이썬 ----------


def run_python(failed: list[str]) -> None:
    py = find_python()

    step(failed, "[1/5] 비밀·DB 파일 검사", check_secrets)

    step(
        failed,
        "[2/5] 코드 모양 (ruff format --check, ruff check)",
        lambda: run([py, "-m", "ruff", "format", "--check", "."]),
        lambda: run([py, "-m", "ruff", "check", "."]),
    )

    step(
        failed,
        "[3/5] 단위 테스트 + 커버리지 80% 하한",
        lambda: run(
            [
                py,
                "-m",
                "pytest",
                "tests/unit",
                "-q",
                "--cov=geosan",
                "--cov-report=term-missing",
                "--cov-fail-under=80",
            ]
        ),
    )

    # 시나리오는 필수다(#527, PM 결정 2026-11-10). 실패하면 검사 전체가 실패로 끝난다.
    step(
        failed,
        "[4/5] 시나리오 테스트 (필수)",
        lambda: run([py, "-m", "pytest", "tests/features", "-q", "--no-cov"]),
    )

    print("== [5/5] 뼈대 검증 (임시 DB, Step 19·27 전에는 실패가 정상 — Step 28에서 필수로 바꿈)")
    tmpdb = os.path.join(tempfile.mkdtemp(), "geosan-check.db")
    env = dict(os.environ, GEOSAN_DB_PATH=tmpdb)
    run_allowed_to_fail(
        [
            [py, "-m", "geosan", "init-db"],
            [
                py,
                "-m",
                "geosan",
                "check-config",
                "examples/rule-config.yaml",
                "examples/app-settings-virtual.yaml",
            ],
            [py, "-m", "geosan", "import-capability", "examples/capability-geosan.json"],
            [py, "-m", "geosan", "import-case", "examples/case-apjeong.json"],
            [py, "-m", "geosan", "verify-case", "examples/case-apjeong.json"],
        ],
        "뼈대 검증 실패: 통합 전까지 허용",
        env=env,
    )


# ---------- 화면 ----------


def run_web(failed: list[str]) -> None:
    npm = find_npm()

    step(
        failed,
        "[web 1/4] 코드 모양 (ESLint, Prettier)",
        lambda: run([npm, "--prefix", "web", "run", "lint"]),
        lambda: run([npm, "--prefix", "web", "run", "format:check"]),
    )

    step(failed, "[web 2/4] 화면 테스트 (Vitest)", lambda: run([npm, "--prefix", "web", "test"]))

    step(
        failed,
        "[web 3/4] 타입 검사 + 빌드 (tsc -b, vite build)",
        lambda: run([npm, "--prefix", "web", "run", "build"]),
    )

    step(failed, "[web 4/4] 비밀·DB 파일 검사", check_secrets)


def main(argv: list[str]) -> int:
    target = argv[1] if len(argv) > 1 else "all"
    # 윈도우(CP949)에서도 모든 하위 명령이 파일·출력을 UTF-8로 다루게 한다(2026-10-22, 이슈 #33).
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    failed: list[str] = []
    if target == "python":
        run_python(failed)
    elif target == "web":
        run_web(failed)
    elif target == "all":
        run_python(failed)
        run_web(failed)
    else:
        print("사용법: python scripts/check.py [python|web]")
        return 1
    if failed:
        print("검사 실패: 아래 단계가 실패했습니다. 위에서 각 단계의 오류를 확인하세요.")
        for name in failed:
            print(f"  - {name}")
        return 1
    print("검사 끝")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
