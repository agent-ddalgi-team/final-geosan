#!/usr/bin/env bash
# PR·이슈 연결 검사 (AGENTS.md "GitHub 이슈·보드 규칙", 2026-10-27 PM 결정, #154).
#
# 무엇을 보나
#   1. PR 본문에 `Closes #번호`(또는 Fixes/Resolves)가 하나 이상 있는가.
#   2. 그 번호가 PR이 아닌 "이슈"이고, 아직 열려 있는가.
#   3. 그 이슈에 마일스톤이 붙어 있는가.
#   4. PR 제목에 `#번호`가 들어 있는가(목록에서 한눈에 연결이 보이게).
#   5. PR의 마일스톤이 연결 이슈와 같은가. `--fix`를 주면 이슈의 마일스톤을 PR에 복사한다(CI가 씀).
#   6. (경고만) 담당자가 2명 이상인 공동 이슈를 Closes 하면 다른 사람 몫까지 닫히므로
#      상위 이슈 + 사람별 하위 이슈로 나누라고 알린다.
#
# 사용: bash scripts/check-pr-link.sh <PR번호> [--fix]
#   gh 로그인이 되어 있어야 한다(jq는 필요 없다). 저장소는 GITHUB_REPOSITORY가 있으면 그것,
#   없으면 현재 폴더의 저장소. 결과는 쉬운 말로 찍고, 통과면 0, 아니면 1로 끝난다.
set -o pipefail

pr="${1:-}"
fix=0
[[ "${2:-}" == "--fix" ]] && fix=1
if [[ -z "$pr" ]]; then
  echo "사용법: bash scripts/check-pr-link.sh <PR번호> [--fix]"
  exit 2
fi

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
api="repos/$repo"

if ! gh api "$api/pulls/$pr" --jq '.number' >/dev/null 2>&1; then
  echo "❌ PR #$pr 를 읽지 못했습니다. 번호와 gh 로그인을 확인해 주세요."
  exit 1
fi
if [[ "$(gh api "$api/pulls/$pr" --jq '.merged')" == "true" ]]; then
  echo "건너뜀: PR #$pr 는 이미 합쳐졌습니다. 합쳐진 PR은 검사하지 않습니다."
  exit 0
fi
title="$(gh api "$api/pulls/$pr" --jq '.title')"
body="$(gh api "$api/pulls/$pr" --jq '.body // ""')"
pr_milestone="$(gh api "$api/pulls/$pr" --jq '.milestone.number // ""')"
pr_milestone_title="$(gh api "$api/pulls/$pr" --jq '.milestone.title // ""')"

fail=0
ok() { echo "✅ $*"; }
bad() { echo "❌ $*"; fail=1; }
warn() { echo "⚠️ $*"; }

# 1. Closes #번호 (여러 개면 전부, 번호 순)
closes="$(grep -oiE '(closes|closed|fixes|fixed|resolves|resolved) +#[0-9]+' <<<"$body" | grep -oE '[0-9]+' | sort -un | tr '\n' ' ')"
closes="${closes% }"

if [[ -z "$closes" ]]; then
  bad "PR 본문에 \`Closes #이슈번호\`가 없습니다. 이 PR이 끝내는 이슈를 '연결 이슈' 줄에 적어 주세요. 공동 이슈(담당자 여러 명)는 내 몫의 하위 이슈를 만들어 그 번호를 적습니다. 같이 보는 이슈는 \`관련 #번호\`로 적습니다."
else
  ok "Closes 이슈: $(sed 's/\([0-9][0-9]*\)/#\1/g' <<<"$closes")"
fi

# 2~3. 이슈 상태·마일스톤
issue_milestone=""
issue_milestone_title=""
first_issue=""
for n in $closes; do
  [[ -z "$first_issue" ]] && first_issue="$n"
  if ! gh api "$api/issues/$n" --jq '.number' >/dev/null 2>&1; then
    bad "#$n 이슈를 찾을 수 없습니다. 번호를 확인해 주세요."
    continue
  fi
  if [[ "$(gh api "$api/issues/$n" --jq 'has("pull_request")')" == "true" ]]; then
    bad "#$n 은(는) 이슈가 아니라 PR입니다. Closes 에는 이슈 번호를 적습니다."
    continue
  fi
  state="$(gh api "$api/issues/$n" --jq '.state')"
  ms_num="$(gh api "$api/issues/$n" --jq '.milestone.number // ""')"
  ms_title="$(gh api "$api/issues/$n" --jq '.milestone.title // ""')"
  assignees="$(gh api "$api/issues/$n" --jq '.assignees | length')"
  issue_title="$(gh api "$api/issues/$n" --jq '.title')"

  if [[ "$state" != "open" ]]; then
    bad "#$n ($issue_title) 은(는) 이미 닫힌 이슈입니다. 열린 이슈에 연결하거나 새 이슈를 만들어 주세요."
  else
    ok "#$n ($issue_title) 열려 있음"
  fi

  if [[ -z "$ms_num" ]]; then
    bad "#$n 에 마일스톤이 없습니다. 이슈 오른쪽에서 '뼈대(10/28)' / '10월 말 부분 시연' / '11/15 거산 전달' 중 하나를 골라 주세요."
  else
    ok "#$n 마일스톤: $ms_title"
    if [[ -z "$issue_milestone" ]]; then
      issue_milestone="$ms_num"
      issue_milestone_title="$ms_title"
    elif [[ "$issue_milestone" != "$ms_num" ]]; then
      warn "Closes 이슈들의 마일스톤이 서로 다릅니다($issue_milestone_title / $ms_title). PR에는 첫 번째를 복사합니다."
    fi
  fi

  if [[ "$assignees" -ge 2 ]]; then
    warn "#$n 은(는) 담당자가 ${assignees}명인 공동 이슈입니다. 이 PR이 합쳐지면 다른 사람 몫까지 닫힙니다. 내 몫만 끝내는 PR이면 하위 이슈(sub-issue)를 만들어 그 번호를 Closes 하고, 공동 이슈는 \`관련 #$n\`으로 적어 주세요."
  fi
done

# 4. 제목에 #번호
if [[ -n "$closes" ]]; then
  title_has=0
  for n in $closes; do
    if grep -qE "#${n}([^0-9]|$)" <<<"$title"; then title_has=1; fi
  done
  if [[ $title_has -eq 1 ]]; then
    ok "제목에 이슈 번호가 있습니다."
  else
    bad "PR 제목에 \`(#${first_issue})\`처럼 이슈 번호를 넣어 주세요. 목록에서 어떤 이슈의 PR인지 바로 보이게 하기 위해서입니다."
  fi
fi

# 5. 마일스톤 복사
if [[ -n "$issue_milestone" ]]; then
  if [[ "$pr_milestone" == "$issue_milestone" ]]; then
    ok "PR 마일스톤이 이슈와 같습니다: $issue_milestone_title"
  elif [[ $fix -eq 1 ]]; then
    if gh api -X PATCH "$api/issues/$pr" -F milestone="$issue_milestone" >/dev/null; then
      ok "PR 마일스톤을 이슈와 같게 맞췄습니다: $issue_milestone_title"
    else
      bad "PR 마일스톤을 바꾸지 못했습니다. PR 오른쪽에서 '$issue_milestone_title'을 직접 골라 주세요."
    fi
  else
    warn "PR 마일스톤(${pr_milestone_title:-없음})이 이슈($issue_milestone_title)와 다릅니다. CI가 자동으로 맞춥니다. 직접 하려면 \`bash scripts/check-pr-link.sh $pr --fix\`."
  fi
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "통과: PR #$pr 는 이슈·마일스톤 연결 규칙을 지켰습니다."
else
  echo "실패: 위의 ❌ 항목을 고친 뒤(본문·제목을 고쳐 저장하면 검사가 다시 돕니다) 합칩니다. 빨간 X 상태로는 합치지 않습니다."
fi
exit $fail
