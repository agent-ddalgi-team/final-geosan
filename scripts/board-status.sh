#!/usr/bin/env bash
# "거산 작업 보드"(조직 agent-ddalgi-team 프로젝트 #3)에서 이슈의 칸(Status)을 옮긴다 (#154).
#
# 사용: bash scripts/board-status.sh <이슈번호> <칸이름>
#   칸이름: "할 일" | "진행 중" | "리뷰 중" | "완료"
#   이슈가 아직 보드에 없으면 올린 뒤 옮긴다. 이미 그 칸이면 그대로 둔다.
#   권한: 보드를 쓸 수 있는 토큰이 필요하다. 사람 PC에서는 gh 로그인(project 권한)으로 되고,
#   GitHub Actions에서는 기본 토큰으로는 조직 보드를 못 건드리므로 저장소 비밀 PROJECT_TOKEN
#   (조직 Projects 읽기·쓰기 권한의 fine-grained PAT)을 GH_TOKEN으로 넘겨야 한다.
set -o pipefail

issue="${1:-}"
column="${2:-}"
if [[ -z "$issue" || -z "$column" ]]; then
  echo "사용법: bash scripts/board-status.sh <이슈번호> <할 일|진행 중|리뷰 중|완료>"
  exit 2
fi

# 보드 식별자(2026-10-27 기준). 보드를 새로 만들면 `gh project field-list 3 --owner agent-ddalgi-team`로 다시 채운다.
org="agent-ddalgi-team"
project_number=3
project_id="PVT_kwDOE67Ars4BoCM4"
status_field_id="PVTSSF_lADOE67Ars4BoCM4zhmkGIQ"
case "$column" in
  "할 일") option_id="6e639c5c" ;;
  "진행 중") option_id="a0c39f12" ;;
  "리뷰 중") option_id="57baf39a" ;;
  "완료") option_id="570ce56e" ;;
  *) echo "❌ 칸 이름은 할 일 / 진행 중 / 리뷰 중 / 완료 중 하나입니다: '$column'"; exit 2 ;;
esac

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
owner="${repo%%/*}"
name="${repo##*/}"

# 이슈의 보드 항목 찾기 (없으면 올림)
read -r issue_id item_id current < <(gh api graphql -f query="
{ repository(owner:\"$owner\", name:\"$name\") { issue(number: $issue) { id
    projectItems(first: 20) { nodes { id project { number }
      fieldValueByName(name: \"Status\") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }" \
  --jq ".data.repository.issue as \$i | (\$i.projectItems.nodes | map(select(.project.number == $project_number)) | .[0]) as \$it | \"\(\$i.id) \(\$it.id // \"-\") \(\$it.fieldValueByName.name // \"-\")\"" 2>/dev/null)

if [[ -z "$issue_id" ]]; then
  echo "❌ #$issue 이슈를 읽지 못했습니다(번호 또는 토큰 권한 확인)."
  exit 1
fi
if [[ "$item_id" == "-" ]]; then
  item_id="$(gh api graphql -f query="mutation { addProjectV2ItemById(input: {projectId: \"$project_id\", contentId: \"$issue_id\"}) { item { id } } }" --jq '.data.addProjectV2ItemById.item.id')" || { echo "❌ #$issue 를 보드에 올리지 못했습니다(PROJECT_TOKEN 권한 확인)."; exit 1; }
  echo "보드에 올림: #$issue"
fi
if [[ "$current" == "$column" ]]; then
  echo "그대로: #$issue 는 이미 '$column' 칸입니다."
  exit 0
fi
gh api graphql -f query="mutation { updateProjectV2ItemFieldValue(input: {projectId: \"$project_id\", itemId: \"$item_id\", fieldId: \"$status_field_id\", value: {singleSelectOptionId: \"$option_id\"}}) { projectV2Item { id } } }" >/dev/null \
  || { echo "❌ #$issue 칸을 옮기지 못했습니다(PROJECT_TOKEN 권한 확인)."; exit 1; }
echo "옮김: #$issue  '${current}' → '$column'"
