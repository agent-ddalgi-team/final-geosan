<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T14:44:54Z — 질문 4개로 제한(기준·크기, 뼈대 범위, 배포 묶음, 병렬). 구현 순서·핵심 경로는 전달 계획 몫이라 묻지 않음. 뼈대 범위는 팀 실천 방식(A정밀 1건 끝까지)과 도메인 설계의 뼈대 문단(부품 10개 최소형)을 그대로 보기 A로 제시.
- 2026-10-20T15:06:39Z — 사용자 확인 후 추가 4건 반영: 나라장터는 승인 문서 출처(범위 P2-2·5절, B-14, FR9.4, US2.3) 모두 P2라 유지; 엑셀 P1/PDF P2는 사용자 지시로 분리하고 요구사항 갱신 필요 표시; 시점 우선 ③ 체크는 뼈대에서 가상 사례 파일 값(FR10.1)으로, 화면 체크는 U5; 전달 계획 조건(U3 11/6, U8 접속 보호 11/6 전, P1 4명 11/15 계산)을 unit-of-work 4장에 기록.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-20T15:14:03Z — 검토 NOT-READY(High 2·Medium 5·Low 2)를 게이트 전에 반영: U1에 Evidence 최소형(파일 투입·조회, 추출 없음)과 조사 요건 파일 값·확인 질문 읽기 전용 영역 포함(Q2 '근거 추출·전송 보호 제외'와 충돌 없음), 의존 선 추가(u4·u6·u7→u2, u10→u2·u3·u4, u11→u6·u8) 쪽을 택함(TransferGuard를 뼈대로 앞당기는 대안은 Q2와 충돌해 택하지 않음), 백업/복원 최소형을 U8로, 확장 지점 분할 규칙·충돌 쌍, 상류 갱신 항목 표, ReadinessCheck 투입 시점 질문. 재검토는 반복 상한(1)으로 돌리지 않고 게이트에서 사람이 판단.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T15:06:39Z — 접속 보호를 운영 단위에서 분리해 11개 단위(U8 접속 보호·배포 준비 / U10 운영 인계 packaging). 단위가 하나 늘지만 11/6 전 접속 보호를 전달 계획에서 따로 배치할 수 있음. 순서·핵심 경로는 적지 않고 위상·병렬 묶음만 기록.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T15:06:39Z — 계획 승인 답이 같은 사람 턴에서 두 번째 기록으로는 들어가지 않아 한 번 더 물음(엔진은 사람 답 하나에 기록 하나). 다음부터 요약 확인과 계획 승인을 같은 질문 묶음에 넣지 않거나 한 번의 log answer로 합쳐 기록.
