<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T05:16:25Z — 이 단계는 조건부이지만 실행함; 외부 LLM 전송 제약, 외부 데이터 소스 미선정, 11/15 일정 대비 4인 투입량이라는 실질적 기술·조직 불확실성이 있어 "사소한 변경"이 아님. 지원 전문가(AWS·컴플라이언스)는 collaborators off라 부르지 않고 건축가 관점에서 함께 다룸.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-19T06:03:07Z — 사용자가 배포 방식 제안을 요청했지만 구상 단계 규칙(구현 세부 금지)에 따라 구체 서비스명 대신 "로컬 / 저비용 호스팅 / 거산 설치" 세 선택지와 조건만 비교하고 결정은 G0·인프라 설계로 넘김.
- 2026-10-19T06:03:07Z — 추가 소스 후보(뿌리기술 전문기업·방산업체 명단)는 기획서의 "자동 소스 3개 이내" 제한을 지키려고 자동 수집이 아닌 수동 명단 후보로 분류해 범위 정의로 넘김.
- 2026-10-19T06:03:07Z — P0~P3 우선순위 초안을 실현 가능성 평가서에 넣음; 사용자가 자료상태메모 7장에서 명시적으로 요청했고, 범위 정의에서 확정한다는 단서를 달아 구상 단계 범위를 넘지 않도록 함.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-19T06:03:07Z — 외부 소스 3개의 data.go.kr 이용허락 범위와 API 운영 계정 필요 여부를 수집 구현 전에 확인해야 함.
- 2026-10-19T06:03:07Z — Q7 "4인 전일"과 Q8 "두 방식 병행으로 인력 분산"이 함께 답변됨; 실제 투입 시간은 주간 점검에서 측정해야 일정 판단이 정확해짐.
