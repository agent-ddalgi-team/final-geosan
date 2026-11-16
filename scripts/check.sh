#!/usr/bin/env bash
# PR 전에 로컬에서 CI와 같은 검사를 같은 순서로 돌린다(cicd-pipeline.md 5장).
#
# 사용: bash scripts/check.sh            # 파이썬 + 화면 전부
#       bash scripts/check.sh python     # 파이썬만
#       bash scripts/check.sh web        # 화면만
#
# 전제: 파이썬은 `.venv`(3.12)에 `pip install -r requirements.lock -e .`가 되어 있거나
#       현재 `python`이 그 가상환경을 가리킨다. 화면은 web/에서 `npm ci`가 되어 있다(README 설치 절).
#
# 한 단계가 실패해도 멈추지 않고 끝까지 돈 뒤, 맨 끝에 실패한 단계를 모아 보여 주고 종료 코드 1로 끝난다
# (#782, PM 결정 2026-11-16). 기준(커버리지 80% 하한·시나리오 필수)은 그대로이고 멈추는 자리만 끝으로 옮겼다.
# scripts/check.py와 단계·순서·동작이 같다. 둘 중 하나를 바꾸면 다른 쪽도 같이 맞춘다.
set -uo pipefail

cd "$(dirname "$0")/.."

target="${1:-all}"
if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY=python
fi

# 실패한 단계 이름을 한 줄씩 모은다(맥 기본 bash 3.2에서도 되도록 배열 대신 글자로).
failed=""

# step "단계 이름" 명령...: 명령이 실패하면 이름만 적어 두고 다음 단계로 간다.
step() {
  local name="$1"
  shift
  echo "== $name"
  if ! "$@"; then
    failed="${failed}  - ${name}
"
    echo "   (실패: ${name} — 다음 단계는 계속 돌립니다)"
  fi
}

# 두 명령을 모두 돌리고(앞이 실패해도 뒤를 돌림) 하나라도 실패하면 실패로 본다.
both() {
  local status=0
  "$1" || status=1
  "$2" || status=1
  return "$status"
}

ruff_format() { "$PY" -m ruff format --check .; }
ruff_lint() { "$PY" -m ruff check .; }
web_lint() { npm --prefix web run lint; }
web_format() { npm --prefix web run format:check; }

run_python() {
  step "[1/5] 비밀·DB 파일 검사" bash scripts/check-secrets.sh

  step "[2/5] 코드 모양 (ruff format --check, ruff check)" both ruff_format ruff_lint

  step "[3/5] 단위 테스트 + 커버리지 80% 하한" \
    "$PY" -m pytest tests/unit -q --cov=geosan --cov-report=term-missing --cov-fail-under=80

  # 시나리오는 필수다(#527, PM 결정 2026-11-10). 실패하면 검사 전체가 실패로 끝난다.
  step "[4/5] 시나리오 테스트 (필수)" "$PY" -m pytest tests/features -q --no-cov

  echo "== [5/5] 뼈대 검증 (임시 DB, Step 19·27 전에는 실패가 정상 — Step 28에서 필수로 바꿈)"
  tmpdb="$(mktemp -d)/geosan-check.db"
  (
    export GEOSAN_DB_PATH="$tmpdb"
    "$PY" -m geosan init-db \
      && "$PY" -m geosan check-config examples/rule-config.yaml examples/app-settings-virtual.yaml \
      && "$PY" -m geosan import-capability examples/capability-geosan.json \
      && "$PY" -m geosan import-case examples/case-apjeong.json \
      && "$PY" -m geosan verify-case examples/case-apjeong.json
  ) || echo "   (뼈대 검증 실패: 통합 전까지 허용)"
}

run_web() {
  step "[web 1/4] 코드 모양 (ESLint, Prettier)" both web_lint web_format

  step "[web 2/4] 화면 테스트 (Vitest)" npm --prefix web test

  step "[web 3/4] 타입 검사 + 빌드 (tsc -b, vite build)" npm --prefix web run build

  step "[web 4/4] 비밀·DB 파일 검사" bash scripts/check-secrets.sh
}

case "$target" in
  python) run_python ;;
  web) run_web ;;
  all) run_python; run_web ;;
  *) echo "사용법: bash scripts/check.sh [python|web]"; exit 1 ;;
esac

if [ -n "$failed" ]; then
  echo "검사 실패: 아래 단계가 실패했습니다. 위에서 각 단계의 오류를 확인하세요."
  printf '%s' "$failed"
  exit 1
fi

echo "검사 끝"
