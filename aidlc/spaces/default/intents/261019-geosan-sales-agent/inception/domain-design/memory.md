<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T14:00:33Z — 프로젝트 규칙(범위·우선순위·데이터·보안에 영향 있는 것만 질문)에 따라 질문 4개로 제한: 데이터 설계서(신뢰할 수 없는 입력) 채택 여부, 규칙 엔진 순수 계산 분리, 확인·조사 창구 분리, 전송 보호 분리. 화면 부품 구조·수집기 어댑터 묶음·운영 명령/웹 API 분리는 추천안으로 정하고 기록만 남김.
- 2026-10-20T14:17:05Z — 데이터 설계서 24개 테이블을 엔티티로 그대로 쓰고 12개를 새로 더함(설정·병합 후보·수집 집계·소스 계약·전송 로그·탐색 후보·코드표·기한 체크·확인 질문·담기·접속 세션). 공정 연결 현재 결과는 기회 기록이 소유하는 파생값(ADR-007). 질문 '반영' 상태는 검수 상태에서 파생해 화면이 거산 값을 바꾸는 경로를 구조로 막음.
- 2026-10-20T14:34:31Z — 수정 요청(R-03~R-12)을 사용자 결정대로 반영: WorkflowRunner 15번째 부품(흐름 6개 표, 한 흐름 = 한 트랜잭션), 교차 참조는 ID만·외래 키 없음·서버 검사(ADR-011), 스냅샷 등급 거르기는 EvaluationLedger, 질문은 대상당 하나 + 질문-기회 연결, 순위 조정은 이력 행(RankAdjustment), 프로필은 평가마다, 대시보드 의존 추가, ADR 보안 영향 줄, ADR-009~011 추가. High 2건은 게이트 전에 이미 반영.
- 2026-10-20T14:41:10Z — 재검토 소견(Medium 1·Low 6·R-11)을 게이트 전에 정리: 흐름 ⓪ 평가 실행 추가(7개), 영향 기회는 첫 버전 묶음 전체 재평가로 확정, 트랜잭션 밖 기록 명시, 서버 검사 담당 표와 시드 순서, EvidenceExtraction 조회 기본 거름, ADR-003 보안 영향, ADR-008 대안 절 복구, 표기 불일치 정정.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T14:17:05Z — 부품 14개(업무 경계)로 나눔. 비전공 팀에는 부품 수가 많아 보이지만 규칙·보안·검수가 각각 한 곳에 있는 쪽을 택함. 재평가 촉발은 이벤트 대신 진입 부품(WebApi·OperatorCommands)이 순서를 조정해 순환 의존을 없앰(ADR-006).

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T14:17:05Z — 스냅샷 형식과 진입 부품의 공용 흐름 함수 위치는 기능 설계에서, 부품을 작업 단위로 묶는 방식(WebUI 쪼개기 포함)은 작업 단위 나누기에서 정함. 설계서와 다른 곳(OUTCOME 상태 추가, ACTION 승인 상태, 재접촉 7칸 저장 위치)은 설계서 갱신 필요.
