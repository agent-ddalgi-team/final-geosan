<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-21T01:28:11Z [unit u1-skeleton] — 뼈대 기간 인프라는 "팀 노트북 로컬 실행 + 검사만 하는 최소 CI"로 한정했다(PM 지시: 호스팅은 11월 U8). 최소 CI 워크플로는 3.7이 아니라 3.5 기본 틀에 먼저 넣기로 했다(10/23 팀원 PR부터 검사가 돌도록, Q2 추천안). AWS 지식 파일은 읽었으나 AWS 계정이 없어(CON-22) 적용하지 않았다.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
