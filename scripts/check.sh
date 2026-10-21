#!/usr/bin/env bash
# PR 전에 로컬에서 CI와 같은 검사를 같은 순서로 돌린다(cicd-pipeline.md 5장).
#
# 사용: bash scripts/check.sh            # 파이썬 + 화면 전부
#       bash scripts/check.sh python     # 파이썬만
#       bash scripts/check.sh web        # 화면만
#
# 전제: 파이썬은 `.venv`(3.12)에 `pip install -r requirements.lock -e .`가 되어 있거나
#       현재 `python`이 그 가상환경을 가리킨다. 화면은 web/에서 `npm ci`가 되어 있다(README 설치 절).
set -euo pipefail

cd "$(dirname "$0")/.."

target="${1:-all}"
if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY=python
fi

run_python() {
  echo "== [1/5] 비밀·DB 파일 검사"
  bash scripts/check-secrets.sh

  echo "== [2/5] 코드 모양 (ruff format --check, ruff check)"
  "$PY" -m ruff format --check .
  "$PY" -m ruff check .

  echo "== [3/5] 단위 테스트 + 커버리지 80% 하한"
  "$PY" -m pytest tests/unit -q --cov=geosan --cov-report=term-missing --cov-fail-under=80

  echo "== [4/5] 시나리오 테스트 (세 트랙 합쳐지기 전에는 실패가 정상 — Step 28에서 필수로 바꿈)"
  "$PY" -m pytest tests/features -q --no-cov || echo "   (시나리오 실패: 통합 전까지 허용)"

  echo "== [5/5] 뼈대 검증 (임시 DB, Step 19·27 전에는 실패가 정상 — Step 28에서 필수로 바꿈)"
  tmpdb="$(mktemp -d)/geosan-check.db"
  (
    export GEOSAN_DB_PATH="$tmpdb"
    "$PY" -m geosan init-db \
      && "$PY" -m geosan import-capability examples/capability-geosan.json \
      && "$PY" -m geosan import-case examples/case-apjeong.json \
      && "$PY" -m geosan verify-case examples/case-apjeong.json
  ) || echo "   (뼈대 검증 실패: 통합 전까지 허용)"
}

run_web() {
  echo "== [web 1/4] 코드 모양 (ESLint, Prettier)"
  npm --prefix web run lint
  npm --prefix web run format:check

  echo "== [web 2/4] 화면 테스트 (Vitest)"
  npm --prefix web test

  echo "== [web 3/4] 타입 검사 + 빌드 (tsc -b, vite build)"
  npm --prefix web run build

  echo "== [web 4/4] 비밀·DB 파일 검사"
  bash scripts/check-secrets.sh
}

case "$target" in
  python) run_python ;;
  web) run_web ;;
  all) run_python; run_web ;;
  *) echo "사용법: bash scripts/check.sh [python|web]"; exit 1 ;;
esac

echo "검사 끝"
