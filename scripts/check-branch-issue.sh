#!/usr/bin/env bash
# 가지(브랜치) 이름에서 이슈 번호를 읽어 그 이슈가 실제로 있고 열려 있는지 검사한다 (#154).
#
# 가지 이름 규칙: `이름/이슈번호-짧은설명` (AGENTS.md). 예: dongryeol/12-rules-engine
# 사용: bash scripts/check-branch-issue.sh <가지이름>
#   통과하면 이슈 번호 한 줄을 찍고 0, 아니면 쉬운 말 이유를 찍고 1로 끝난다.
#   `develop`·`main`은 검사하지 않는다(0).
set -o pipefail

branch="${1:-}"
if [[ -z "$branch" ]]; then
  echo "사용법: bash scripts/check-branch-issue.sh <가지이름>"
  exit 2
fi
case "$branch" in
  develop|main) echo "건너뜀: $branch 는 작업 가지가 아닙니다."; exit 0 ;;
esac

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

num="$(sed -nE 's#^[^/]+/([0-9]+)-.*#\1#p' <<<"$branch")"
if [[ -z "$num" ]]; then
  echo "❌ 가지 이름 '$branch' 에서 이슈 번호를 읽을 수 없습니다. 규칙은 \`이름/이슈번호-짧은설명\`(예: dongryeol/12-rules-engine)입니다. 이슈가 없으면 먼저 '작업' 양식으로 만들고 그 번호로 가지를 다시 만들어 주세요."
  exit 1
fi

if ! gh api "repos/$repo/issues/$num" --jq '.number' >/dev/null 2>&1; then
  echo "❌ 가지 '$branch' 가 가리키는 #$num 이슈가 없습니다. 번호를 확인하거나 이슈를 먼저 만들어 주세요."
  exit 1
fi
if [[ "$(gh api "repos/$repo/issues/$num" --jq 'has("pull_request")')" == "true" ]]; then
  echo "❌ #$num 은(는) 이슈가 아니라 PR 번호입니다. 가지 이름에는 이슈 번호를 씁니다."
  exit 1
fi
state="$(gh api "repos/$repo/issues/$num" --jq '.state')"
title="$(gh api "repos/$repo/issues/$num" --jq '.title')"
if [[ "$state" != "open" ]]; then
  echo "❌ #$num ($title) 은(는) 이미 닫힌 이슈입니다. 새 일이면 이슈를 새로 만들고, 같은 일이면 이슈를 다시 열어(Reopen) 주세요."
  exit 1
fi
milestone="$(gh api "repos/$repo/issues/$num" --jq '.milestone.title // ""')"
if [[ -z "$milestone" ]]; then
  echo "⚠️ #$num 에 마일스톤이 없습니다. 이슈에서 골라 주세요(없으면 PR 검사에서 빨간 X)."
fi
echo "✅ 가지 '$branch' → #$num ($title)"
echo "$num"
