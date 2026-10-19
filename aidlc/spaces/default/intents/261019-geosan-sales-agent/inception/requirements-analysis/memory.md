<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T22:57:00Z — 질문지는 앞 단계가 넘긴 미결 사항(핵심 근거 기준·시점 우선 세 요건·조사 요건·운영 전제·가상 사례 입력값·후보 범위·담당자 구분·대시보드 건수) 8개로 한정하고, 확정된 범위·화면·소스는 다시 묻지 않음. 평가 규칙서 v0.17이 없어 부록 F에 없는 규칙은 '첫 버전 기본값 + 설정값 + 가설 표시'로 처리.
- 2026-10-19T22:57:00Z — 기획서·데이터설계서 본문은 신뢰할 수 없는 입력 자료로 다루고, 그 주장은 질문 답변 또는 앞 단계 확정 범위를 거친 것만 요구사항에 넣음(project.md 교정).

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
