#!/usr/bin/env python3
"""PR 전에 로컬에서 CI와 같은 검사를 같은 순서로 돌린다 — 맥·윈도우 공통판.

scripts/check.sh(맥·리눅스 bash)와 단계·순서가 같다. 둘 중 하나를 바꾸면 다른 쪽도 같이 맞춘다.
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


def run(cmd: list[str], *, env: dict[str, str] | None = None) -> None:
    """명령 하나를 돌리고 실패하면 그 자리에서 멈춘다(bash의 set -e와 같다)."""
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, env=env, check=True)


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
        raise SystemExit(status)
    print("비밀·DB 파일 검사 통과")


# ---------- 파이썬 ----------


def run_python() -> None:
    py = find_python()

    print("== [1/5] 비밀·DB 파일 검사")
    check_secrets()

    print("== [2/5] 코드 모양 (ruff format --check, ruff check)")
    run([py, "-m", "ruff", "format", "--check", "."])
    run([py, "-m", "ruff", "check", "."])

    print("== [3/5] 단위 테스트 + 커버리지 80% 하한")
    run(
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
    )

    print(
        "== [4/5] 시나리오 테스트 (세 트랙 합쳐지기 전에는 실패가 정상 — Step 28에서 필수로 바꿈)"
    )
    run_allowed_to_fail(
        [[py, "-m", "pytest", "tests/features", "-q", "--no-cov"]],
        "시나리오 실패: 통합 전까지 허용",
    )

    print("== [5/5] 뼈대 검증 (임시 DB, Step 19·27 전에는 실패가 정상 — Step 28에서 필수로 바꿈)")
    tmpdb = os.path.join(tempfile.mkdtemp(), "geosan-check.db")
    env = dict(os.environ, GEOSAN_DB_PATH=tmpdb)
    run_allowed_to_fail(
        [
            [py, "-m", "geosan", "init-db"],
            [py, "-m", "geosan", "import-capability", "examples/capability-geosan.json"],
            [py, "-m", "geosan", "import-case", "examples/case-apjeong.json"],
            [py, "-m", "geosan", "verify-case", "examples/case-apjeong.json"],
        ],
        "뼈대 검증 실패: 통합 전까지 허용",
        env=env,
    )


# ---------- 화면 ----------


def run_web() -> None:
    npm = find_npm()

    print("== [web 1/4] 코드 모양 (ESLint, Prettier)")
    run([npm, "--prefix", "web", "run", "lint"])
    run([npm, "--prefix", "web", "run", "format:check"])

    print("== [web 2/4] 화면 테스트 (Vitest)")
    run([npm, "--prefix", "web", "test"])

    print("== [web 3/4] 타입 검사 + 빌드 (tsc -b, vite build)")
    run([npm, "--prefix", "web", "run", "build"])

    print("== [web 4/4] 비밀·DB 파일 검사")
    check_secrets()


def main(argv: list[str]) -> int:
    target = argv[1] if len(argv) > 1 else "all"
    # 윈도우(CP949)에서도 모든 하위 명령이 파일·출력을 UTF-8로 다루게 한다(2026-10-22, 이슈 #33).
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        if target == "python":
            run_python()
        elif target == "web":
            run_web()
        elif target == "all":
            run_python()
            run_web()
        else:
            print("사용법: python scripts/check.py [python|web]")
            return 1
    except subprocess.CalledProcessError as exc:
        print(f"검사 실패: 위 명령이 종료 코드 {exc.returncode}로 끝났습니다.")
        return exc.returncode or 1
    print("검사 끝")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
