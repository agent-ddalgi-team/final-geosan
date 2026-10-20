<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T15:23:16Z — 외부 공개 API가 없는 한 덩어리 시스템이라 경계를 4종(화면↔API HTTP, 부품 내부 함수, 공유 SQLite, 사람 투입 파일·명령)으로 보고 질문 4개(형식·주인/변경·오류/재시도·파일 형식)로 제한. 외부 LLM·외부 소스 API는 우리가 소비하는 쪽이라 어댑터 계약으로만 다룸.
- 2026-10-20T15:35:49Z — 계약 9개(C1 HTTP OpenAPI, C2 흐름 함수, C3 규칙 엔진 입출력, C4 전송 보호, C5 수집 어댑터, C6 공유 DB 접두사, C7 투입 파일 JSON/YAML + 예시 파일 + 줄·항목·이유 오류, C8 운영 명령, C9 바깥 서비스 어댑터). 필드·경로·명령 이름은 제안으로 표시. 사용자 보호 장치 ②는 .claude/CLAUDE.md에 한 절 추가, ③④는 전달 계획으로.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-20T15:47:52Z — 검토 NOT-READY(High 3·Medium 12·Low 3) 18건을 게이트 전에 모두 반영: 출력 검사 용도 분리와 422 거부, X-Staff-Key(영문 키)·viewer 예약 키, 기록 version·expectedVersion·낡은 평가 409, 오류 kind/fields, 세션 쿠키 속성·429·잔여 위험, rank 함수, 공통 코드표 C0와 표시 변환, 마이그레이션 접두사 파일, _설명 키·위치 로더·모르는 키 오류·연락처 검사, 재투입 규칙, init-db/serve/check-config, VACUUM INTO 백업, export-contracts 명시 실행, /homepage 60초 한도, 응답 조립 등록 방식, 3초/10초 구분, CLAUDE.md 순서 문구. 재검토는 반복 상한(1)으로 돌리지 않음.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T15:35:49Z — 동시 수정은 409 대신 200 + meta.previousValue(FR7.6 마지막 저장이 이김)로 정해 화면이 입력을 잃지 않게 함. 분류·상태 코드는 영문 enum을 DB·API·화면이 공유하고 쉬운 말은 /config/ui 코드표로 제공.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T15:35:49Z — 재접촉 카드 응답 형식, 대시보드 필터 값, ReadinessCheck 초기 evalId, 마이그레이션 도구, 명령 설치 방식은 기능 설계·코드 생성으로 넘김.
