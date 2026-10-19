<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T06:21:44Z — 질문지를 "아직 안 정해진 것"에만 맞춤: 실현 가능성 단계가 넘긴 P0~P3 초안 확정, 10/30 최소 범위, 11/15 이전 피드백 경로(I-03), 수동 명단(A-05), 홈페이지·채용 소스(A-04), 미정 9개 항목(A-01), 1차 MVP 판단 시점. 의도·실현 가능성에서 이미 확정된 제외 범위·소스 3개는 다시 묻지 않음.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-19T07:02:55Z — 요약 확인 중 사용자가 아연도금 가상 사례(P1)를 추가 요청함; 기존 답변을 바꾸지 않고 Q1 답변에 "요약 확인 후 추가"로 덧붙여 기록하고 요약을 다시 확인받음. 요약 확인은 새 범위를 받아들이는 자리로도 쓰였음.
- 2026-10-19T07:02:55Z — 거산 접속 환경 준비를 백로그 B-13(P1)으로 넣되 방식은 G0·인프라 설계에서 정한다고 못 박음; 구상 단계에서 배포 기술을 정하지 않는 규칙과 11/15 실사용 목표를 함께 지키려는 선택.
- 2026-10-19T07:02:55Z — 백로그 완료 기준을 기획서 시나리오 번호(S01, S02, S05, S10, S12)와 A정밀 계산값(E 77 등)에 연결함; 측정 가능한 기준을 요구하는 구상 단계 규칙을 지키면서 요구사항 단계의 추적성을 미리 확보.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-19T07:02:55Z — 아연도금 가상 사례의 입력값(고객 요구·공정 사양·시점 신호)을 누가 설계하는지와 부록 F만으로 기대 결과를 계산할 수 있는지는 요구사항 분석에서 확인 필요.
- 2026-10-19T07:02:55Z — 홈페이지 자동 탐색(B-11)에 쓸 검색 방식의 비용·약관 미확인.
