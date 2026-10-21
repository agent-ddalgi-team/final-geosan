<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T18:00:56Z [unit u1-skeleton] — 뼈대 기능 설계 질문은 앞 단계가 넘긴 미결 4개(기한 체크 평가 ID, 시연 확인 질문, 규칙 설계 범위, 기준일 키)만 냈고, PM의 10월 말 부분 시연 변경 요청으로 4개(소개서 묶음 카드 참고 점수, ③ 안 정렬 가설·설정값, demoLabel 설정, check-case 명령)를 더했다. 답은 오전 팀 회의에서 받기로 해 질문을 열어 둔 채 문서 갱신·커밋을 먼저 했다.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T23:40:00Z [unit u1-skeleton] — 검토 2회 뒤 남은 지적 5건(거산 값 묶음을 (묶음, 코드)로 분리 저장·활성 묶음만 평가, 평가 묶음 FULL/PARTIAL로 목록 순위 보호, 신호↔항목 연결과 대표 신호 규칙, 재투입 시 자식 행 supersededAt 교체, 우대 요구 EXCLUDED는 필터 영향 없음)을 PM 지시로 설계에 바로 반영했다(가드 정책 off, 계약은 더하는 변경만). 공정 연결은 processId 대신 processCode 참조로 바꿨다.
- 2026-10-21T00:50:00Z [unit u1-skeleton] — PM 지시로 이 작업(U1)의 자동 검토와 요약 확인을 껐다(개발 착수 시급). 3.2~3.4는 질문 최소화·추천안 기록으로 진행하고, 코드 검토는 3.5 전에 다시 켜는 것을 권했다.
- 2026-10-20T23:40:00Z [unit u1-skeleton] — 규칙 수치는 하나도 새로 정하지 않고 요구사항·부록 A·계약을 번호(BR)로 옮겼다. 새로 정한 것은 OTHER 정렬(가설·설정값)과 표시 규칙(참고 점수·demoLabel)뿐이며 모두 설정값이다.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T18:00:56Z [unit u1-skeleton] — 부분 시연 변경은 소개서 묶음(FR4.14) 규칙을 그대로 쓰므로 기획서 부록 F 수치·A정밀 기대값에 영향이 없음을 확인했다. OTHER 그룹 정렬 변경(Q6)은 계약 설계가 더한 화면용 규칙의 변경이라 가설·설정값으로 둔다. 거산 방문 날짜(E-16)와 공정 1~2개 선정은 설계를 막지 않으나 사례 파일 작업 범위를 정한다.
