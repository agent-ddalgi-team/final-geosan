<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T16:28:33Z — 작업 단위 나누기가 넘긴 조건(P1 4명 11/15 계산)을 질문 전에 평일·여력 표로 계산해 제시(여력 20 vs 필요 27.5). 질문은 순서 기준·Bolt 크기·축소안·걱정 4개. 팀 구성 단계가 건너뛰어져 Bolt는 모두 개발자 에이전트(이 세션)가 만들고 4인은 2명씩 검토·승인 짝으로 둠.
- 2026-10-20T16:39:33Z — 사용자 조건으로 재계산(평일 8h·주말 4h·4명·PM 50%·80% 변형): 뼈대 뒤 22.8/18.2 짝하루 vs 필요 27.5 → 축소안 적용 시 100% 충분·80% 약 20h 부족. 몰림은 시간이 아닌 순서·상한 문제라 U2 앞당기기+축소안+11/9 주 비충돌 단위 3개째 허용을 추천. 단위별 '겹치지 않는 작은 일', PM 역할, 뼈대 기간 PM 파일 작성 날짜(10/23·10/24·10/28)를 계획 문서에 반영하기로.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T16:51:19Z — Bolt 13개(B1 뼈대 ~ B13 인계), 순서는 뼈대→이정표→WSJF 참고. 담기는 검색을 유지했으므로 줄이는 순서상 함께 유지. 11/9 주 3개째는 U10(안내서·백업)만. U6 기본 동작에 S05·문안 템플릿·전송 0건을 포함해 '구현 완료(mock)' 문구 조건을 채움. 뼈대 중간 확인 지점 5개와 PM 파일 날짜를 B1에 둠.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T16:51:19Z — 구현 검증 명령은 코드가 없는 그린필드라 제안값(pytest + verify-case)으로 두고 사람 승인에 맡김. 팀원 3명 시간 합의(E-1)가 계획 전제. 호스팅(E-4)은 인프라 설계에서.
