# Code Generation Plan Approval

AI-DLC writes this file when it asks you to approve the plan. To answer here
instead of in chat, write your answer after `[Answer]:` and say done.

## Plan Approval

Approve the code plan for u1-skeleton?

- Builds: A정밀 1건이 파일 투입 → 필터 → 점수 → 분류 → 추천 목록·근거 상세 → 의견 저장까지 한 덩어리로 도는 뼈대(FastAPI + React 정적 파일 + SQLite), 명령 9개, 최소 CI, 팀원용 사례 파일 틀·안내서·작업 지시서 3개. 기본 틀은 PM 세션이, 규칙 엔진·저장소/API/명령·화면은 팀원 셋이 나눠 만들고 P...
- Touches: 새로 만드는 `geosan/`(파이썬 패키지 12개 폴더), `migrations/`, `contracts/`, `examples/`, `tests/`, `web/`, `docs/work-orders/`(작업 지시서 3개), `docs/case-file-guide.md`, `.github/workflows/check.yml`, `pyp...
- Tests: 시나리오 테스트 10개 파일(S01·S02·S04·S06·S07·S08·S10·A정밀·읽기 예시 2·소개서 묶음, 약 30개 시나리오)을 PM 세션이 먼저 쓰고, 각 담당이 자기 층 구현 뒤 단위 테스트(파이썬 약 85개, 화면 Vitest 약 25개). 줄 커버리지 80% 이상

Full plan: aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/code-generation/code-generation-plan.md
Test instructions: aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/code-generation/unit-test-instructions.md

[Approval Fingerprint]: sha256:v3:f02d3e32a161fc9c81fb022bb5e083a8a36edf9fb5cfc306f70dd4a3f804dc94
[Planned Source]: d40a2f9f8d7e8fd7fffbbbcd61719714f1c57527fd285595dcf3bf5686c0b106

- A. Approve Plan
- B. Request Changes
- C. I'll edit the files

[Answer]: A. Approve Plan
