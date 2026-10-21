<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-21T01:20:18Z [unit u1-skeleton] — NFR 목표치는 요구사항 NFR1~12·계약 3장을 세분(NFRx.y 97개)해 옮겼고 새로 정한 것은 pytest-bdd·Alembic 두 도구뿐(PM 지시로 추천안 기록). NFR6(LLM 비용)은 뼈대에 외부 호출이 없어 N/A. 요약 확인·검토는 PM 지시로 이 작업에서 꺼짐.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
