<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T18:00:56Z [unit u1-skeleton] — 뼈대 기능 설계 질문은 앞 단계가 넘긴 미결 4개(기한 체크 평가 ID, 시연 확인 질문, 규칙 설계 범위, 기준일 키)만 냈고, PM의 10월 말 부분 시연 변경 요청으로 4개(소개서 묶음 카드 참고 점수, ③ 안 정렬 가설·설정값, demoLabel 설정, check-case 명령)를 더했다. 답은 오전 팀 회의에서 받기로 해 질문을 열어 둔 채 문서 갱신·커밋을 먼저 했다.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T18:00:56Z [unit u1-skeleton] — 부분 시연 변경은 소개서 묶음(FR4.14) 규칙을 그대로 쓰므로 기획서 부록 F 수치·A정밀 기대값에 영향이 없음을 확인했다. OTHER 그룹 정렬 변경(Q6)은 계약 설계가 더한 화면용 규칙의 변경이라 가설·설정값으로 둔다. 거산 방문 날짜(E-16)와 공정 1~2개 선정은 설계를 막지 않으나 사례 파일 작업 범위를 정한다.
