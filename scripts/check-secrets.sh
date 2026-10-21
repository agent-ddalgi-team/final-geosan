#!/usr/bin/env bash
# 커밋된 파일에 DB 파일·.env·비밀 패턴이 없는지 검사한다(CI 8단계, 보안 설계 3장).
# 사용: bash scripts/check-secrets.sh   (저장소 루트에서, git 추적 파일만 본다)
# 검사 대상은 우리 코드·설정·문서 폴더다. 프레임워크 폴더(.claude, .codex, .agents, aidlc)와
# 원본 자료(docs/input)는 우리가 고치지 않으므로 제외한다.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

# 1) 커밋하면 안 되는 파일 이름 (저장소 전체)
bad_files=$(git ls-files | grep -E '(^|/)(\.env|.*\.db|.*\.db-wal|.*\.db-shm)$' || true)
if [ -n "$bad_files" ]; then
  echo "커밋하면 안 되는 파일이 있습니다(.env, *.db):"
  echo "$bad_files"
  status=1
fi

# 2) 비밀 값처럼 보이는 문자열. 실제 키 모양(sk-…, AKIA…, sk-ant-…)과
#    'password/apiKey/token = 16자 이상의 값' 형태만 잡는다(변수 이름·설명 문장은 제외).
secret_pattern='(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9-]{20,}|(password|apiKey|api_key|token)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9+/_-]{16,}["'"'"']?[[:space:]]*$)'
scan_paths=(geosan web/src web/package.json web/vite.config.ts web/vitest.config.ts tests examples contracts scripts docs .github pyproject.toml README.md .env.example AGENTS.md)
existing_paths=()
for p in "${scan_paths[@]}"; do
  [ -e "$p" ] && existing_paths+=("$p")
done
hits=$(git ls-files -z -- "${existing_paths[@]}" \
  | grep -zvE '(^docs/input/|\.png$|\.jpg$|\.woff2?$)' \
  | xargs -0 grep -nE "$secret_pattern" -- 2>/dev/null \
  | grep -vE 'check-secrets\.sh' || true)
if [ -n "$hits" ]; then
  echo "비밀 값처럼 보이는 문자열이 있습니다. 환경 변수로 옮겨 주세요:"
  echo "$hits"
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "비밀·DB 파일 검사 통과"
fi
exit "$status"
