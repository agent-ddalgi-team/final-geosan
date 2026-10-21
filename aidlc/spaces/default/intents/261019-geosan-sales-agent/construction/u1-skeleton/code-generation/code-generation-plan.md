# 코드 생성 계획 (Code Generation Plan) — U1 뼈대 (u1-skeleton)

## Summary

- Builds: A정밀 1건이 파일 투입 → 필터 → 점수 → 분류 → 추천 목록·근거 상세 → 의견 저장까지 한 덩어리로 도는 뼈대(FastAPI + React 정적 파일 + SQLite), 명령 9개, 최소 CI, 팀원용 사례 파일 틀·안내서·작업 지시서 3개. 기본 틀은 PM 세션이, 규칙 엔진·저장소/API/명령·화면은 팀원 셋이 나눠 만들고 PM 세션이 검토·통합한다
- Touches: 새로 만드는 `geosan/`(파이썬 패키지 12개 폴더), `migrations/`, `contracts/`, `examples/`, `tests/`, `web/`, `docs/work-orders/`(작업 지시서 3개), `docs/case-file-guide.md`, `.github/workflows/check.yml`, `pyproject.toml`, `README.md`, 역할 변경을 적는 `AGENTS.md`·`docs/team-start-guide.md`
- Tests: 시나리오 테스트 10개 파일(S01·S02·S04·S06·S07·S08·S10·A정밀·읽기 예시 2·소개서 묶음, 약 30개 시나리오)을 PM 세션이 먼저 쓰고, 각 담당이 자기 층 구현 뒤 단위 테스트(파이썬 약 85개, 화면 Vitest 약 25개). 줄 커버리지 80% 이상

## 이 계획을 승인하면 함께 확정되는 것 (PM 확인 사항)

1. **약속 파일(`contracts/`) 첫 생성**: 계약 C7의 네 파일(`case-file.schema.json`, `capability-file.schema.json`, `rule-config.schema.json`, `app-settings.schema.json`)과 `openapi.json`을 U1에서 처음 만든다. 이때 기능 설계가 "PM 확인 뒤 반영"으로 둔 **더하는 변경**을 함께 적는다: CaseFile `baseDate`·`signals[].relation`·`signals[].scheduledAt`·`signals[].announcedAt`·`itemInputs[].usedCapabilityRefs`·`itemInputs[].signalRefs`, 규칙 설정 `otherGroupSort`, 앱 설정 `brand.demoLabel`, 응답 `scoreDisplay`·`meta.notEvaluatedCount`, 명령 `check-case`, 공유 데이터의 `datasetKind` 식별 키·`eval_batch.scope`·`superseded_at`·`processCode`. 깨는 변경은 없다. 이 계획의 승인을 그 PM 확인으로 기록하고, PR 템플릿 "약속 파일을 바꿨나요?"에 "예"로 표시한다.
2. **코드 생성에서 확정하기로 남겼던 선택 3가지는 추천안으로 확정(PM 지시 2026-10-21)**: 명령줄은 Typer, 위치 정보 로더는 ruamel.yaml 하나로 JSON·YAML 모두 읽기, 화면 데이터 요청은 fetch + 작은 클라이언트 모듈.
3. **뼈대 분담 변경(PM 지시 2026-10-21)**: 팀 실천 방식·`AGENTS.md`의 "얇은 끝단 조각은 PM 세션 에이전트가 먼저 만든다"를 다음으로 바꾼다. 기본 틀(Part A·A-2)이 `main`에 합쳐지면 **유동렬 = 규칙 엔진(Part C)**, **이강욱 = 투입·평가·명령·API(Part D)**, **고선주 = 최소 화면, 가짜 응답으로 먼저(Part E)** 를 각자 AI 도구로 작업 지시서대로 만들어 PR을 올리고, **PM 세션 = 기본 틀·경계 코드·시나리오 테스트 틀·저장소 모델·검사기·끝단 확인·문서·PR 검토와 합치기(Part A·A-2·F)**. 이 변경은 Step 8에서 `AGENTS.md`·`docs/team-start-guide.md`·전달 계획 `team-allocation.md` 1장에 적는다.
4. **PR·커밋 규칙 추가(PM 지시)**: 테스트 통과 뒤에만 PR, PR 본문은 비전공자도 읽을 수 있게, 기능마다 쉬운 말 커밋. `AGENTS.md`에 이미 적었다(이 계획을 고치는 시점에 반영).
5. **기본 틀 먼저 올리기**: Part A가 끝나면 PM이 확인하고 PR로 `main`에 올린다(팀원 1명 빠른 확인 → 스쿼시). 커밋·푸시는 PM이 요청할 때만 한다.

## Testing Contract

```json
{
  "version": 1,
  "methodology": "custom",
  "source": "team",
  "ordering": "기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 작성한 뒤 그 시나리오가 통과하도록 각 층(규칙 계산 → API → 화면)을 구현하고, 세부 단위 테스트는 각 층 구현 뒤 같은 작업 묶음 안에서 작성·실행해 통과시킨다.",
  "scope": "mvp",
  "test_strategy": "standard",
  "project_type": "greenfield",
  "applicable_notes": [
    {
      "layer": "org",
      "text": "We treat tests as a first-class deliverable in every Bolt. The specific\nmethodology (TDD, BDD, ATDD, or classic test-after) is affirmed at\npractices-discovery and recorded in `team.md` under this heading with explicit\n`Methodology` and `Ordering` fields; Code Generation resolves those fields\nindependently from coverage, tooling, and scope notes.\n\nWhen no posture has been affirmed, our default per scope is:\n- **Methodology**: test-after\n- **Ordering**: implement each applicable testable layer, then write and run\n  that layer's tests.\n- `mvp`, `enterprise`, `feature`, `infra`, `classic` add an 80% line-coverage\n  floor and CI execution before merge.\n- `bugfix`, `security-patch` add a targeted regression for the specific\n  bug/vulnerability and require the existing suite to remain green.\n- `express` uses the Minimal strategy: requirement-driven unit tests (one per\n  requirement, with a happy-path floor per component); existing tests remain\n  green.\n- `poc`, `refactor`, `workshop` add no extra new-test floor and require the\n  existing suite to remain green.\n\nThe active `Test Strategy` still applies in every scope and determines test\nvolume/types. Scope floors are additive; they never reduce or replace the\nselected strategy.\n\nBuild and Test verifies defined coverage floors and affirmed quality targets;\nthey may not be weakened to make a step pass.\n\nAffirm a stricter posture in `team.md` if the team commits to one."
    },
    {
      "layer": "team",
      "text": "우리는 테스트를 모든 작업 묶음의 필수 산출물로 본다. 기획서의 시나리오 S01~S14가 이미 \"어떤 상황에서 무엇을 하면 어떤 결과가 나와야 하는지\"를 정해 두었으므로, 그 시나리오를 **\"주어진 상황 / 할 때 / 결과\"(Given/When/Then) 형식의 시나리오 테스트로 먼저 쓰고** 그 테스트가 통과하도록 구현한다. 함수 하나하나를 확인하는 세부 단위 테스트는 각 층을 구현한 뒤에 쓴다. (인터뷰 Q3: C)\n\n- **Methodology**: custom\n- **Methodology evidence**: 인터뷰 Q3에서 팀이 C를 골랐다. 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 구현 전에 쓰는 부분은 BDD 방식이고, 세부 단위 테스트를 구현 뒤에 쓰는 부분은 test-after 방식이다. 두 가지 순서가 섞여 있으므로 단일 값(bdd 또는 test-after)이 아니라 `custom`으로 기록한다. 조직 기본값(test-after)에서 바뀐 항목이다.\n- **Ordering**: 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 작성한 뒤 그 시나리오가 통과하도록 각 층(규칙 계산 → API → 화면)을 구현하고, 세부 단위 테스트는 각 층 구현 뒤 같은 작업 묶음 안에서 작성·실행해 통과시킨다.\n- 커버리지: `mvp` 범위의 조직 기본 하한인 **줄 커버리지 80%**(테스트가 실제로 실행한 코드 줄의 비율)를 지킨다. 부록 F 점수·11개 분류 분기 같은 규칙 계산은 시나리오 S01~S14와 A정밀 계산값(E 77 / P 95 / S 81.1 / R 82)을 그대로 기대값으로 쓴다. 하한은 통과를 위해 낮추지 않는다.\n- 도구: Python 쪽은 `pytest`(+ `pytest-cov`)를 기본으로 하고, Given/When/Then 시나리오를 돌리는 러너(`pytest-bdd` 같은 후보)는 코드 생성 단계에서 확정한다. React 쪽은 Vitest + React Testing Library 같은 표준 러너를 쓰되 상세 화면 설계·코드 생성 단계에서 확정한다.\n- 실행 시점: `main`에 합치기 전에 CI(자동 검사)에서 테스트를 돌리고, 실패하면 합치지 않는다.\n- 범위 메모: 외부 LLM 호출(P0-4)과 외부 API(CON-04)는 테스트에서 가짜 응답(mock)으로 대체해 비용과 변동을 없앤다. 활성 `Test Strategy`는 Standard이며 이 메모는 그 위에 더해질 뿐 줄이지 않는다."
    },
    {
      "layer": "project",
      "text": "- 테스트 방법은 test-after 대신 BDD 혼합(custom)이다. 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 쓰고, 세부 단위 테스트는 각 층 구현 뒤에 쓴다. 줄 커버리지 80% 하한은 유지한다. (learned 2026-10-19) \n\n- A정밀 가상 사례 기대값(E 77 / P 95 / S 81.1 / R 82)은 v0.15 F.1·F.7 규칙(고정 일치도 단계, 확실도, 0.5 올림 반올림)으로 역산 가능하며 추정 등급 항목이 없어야 R=82가 된다. 규칙 엔진 테스트 기대값으로 쓰되 '역산한 가정값, 규칙서 확인 전'으로 표시한다. (learned 2026-10-20)"
    }
  ],
  "obligations": {
    "strategy": "standard",
    "strategy_volume": [
      "Five to eight tests per component.",
      "Unit tests plus integration tests for key boundaries.",
      "Add E2E, performance, or security tests when requirements demand them."
    ],
    "scope_floor": [
      "Meet an 80% line-coverage floor.",
      "Run the selected tests in CI before merge."
    ],
    "combination_rule": "Apply every selected-strategy obligation and every scope-floor obligation; neither replaces the other, and a targeted scope regression may add the narrowest necessary test type beyond the strategy default."
  },
  "plan_profile": {
    "methodology": "custom",
    "runner_step": "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
    "runner_ready_before_first_test": true,
    "testable_layers": [
      "Data model / database behavior",
      "Repository / data access",
      "Business logic",
      "API / endpoint",
      "Frontend behavior"
    ],
    "steps": [
      "Project structure and production configuration skeleton.",
      "Bootstrap the minimal test runner/configuration and record the exact unit-scoped command.",
      "Custom ordering - 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 작성한 뒤 그 시나리오가 통과하도록 각 층(규칙 계산 → API → 화면)을 구현하고, 세부 단위 테스트는 각 층 구현 뒤 같은 작업 묶음 안에서 작성·실행해 통과시킨다.",
      "Implementation and tests - preserve that exact ordering; do not convert it to layer-local TDD.",
      "Environment/build configuration.",
      "Documentation and traceability."
    ]
  },
  "input_sha256": "sha256:515867fc2480ebd61a0fd852edc8058c9e23dad9706a4d650f4db8da8a255337",
  "contract_sha256": "sha256:799946f456f3fc4a7d6208bc4bbdd2143a817f30207bb7a65bf99ef58ac560cd"
}
```

## 순서의 뜻 (Testing Contract를 이 단위에 적용)

이 계약은 **custom**이다. 순서를 그대로 지킨다: ① 기본 틀·경계 코드 → ② 테스트 러너 준비 → ③ 시나리오 테스트 10개를 **먼저** 쓴다(이 시점에는 실패) → ④ 저장소 모델·검사기 → 그 단위 테스트 → ⑤ 규칙 계산 층(유동렬) → 그 단위 테스트 → ⑥ 투입·평가·명령·API 층(이강욱) → 그 단위 테스트 → ⑦ 화면 층(고선주, 가짜 응답 → 실제 연결) → 그 단위 테스트 → ⑧ 시나리오 전부 초록 확인 → ⑨ 환경·빌드 설정 → ⑩ 문서·추적. 층마다 "구현 → 단위 테스트"이고 TDD(한 함수씩 빨강→초록)로 바꾸지 않는다. ⑤·⑥·⑦은 서로 다른 사람이 **동시에** 진행하되 각자 안에서는 이 순서를 지킨다. 품질 목표(커버리지 80%, NFR 수치)는 낮추지 않는다.

## 진행 방식 (분담·PR·검토)

| Part | 담당 | 만드는 곳 | PR | 검토·합치기 |
|---|---|---|---|---|
| A 기본 틀·경계 코드 | PM 세션 | 전체 폴더 골격, `contracts/`, `examples/`, `docs/` | PR #1 (가지 `jiye/u1-base`) | 팀원 1명 빠른 확인(30분) → 스쿼시 |
| A-2 시나리오 테스트·저장소 모델·검사기 | PM 세션 | `tests/features/u1`, `tests/steps/u1`, `geosan/storage`, 각 부품 `models.py`, `migrations/`, `geosan/config` | PR #2 (`jiye/u1-foundation`) | 이강욱 확인 → 스쿼시 |
| C 규칙 엔진 | 유동렬 | `geosan/rules/` 안의 새 파일, `tests/unit/u1/test_rules_*.py` | 1~2개 (`dongryeol/u1-rules-*`) | PM 세션이 계약 C3·계획·A정밀 기대값 대조 → 스쿼시 |
| D 투입·평가·명령·API | 이강욱 | `geosan/capability·opportunity·evidence·questions·evaluation·workflows·commands·api/`의 새 파일, `tests/unit/u1/` 해당 파일 | 2~3개 (`kangwook/u1-import`, `u1-evaluate`, `u1-api-commands`) | PM 세션이 계약 C1·C2·C6·C7·C8 대조 → 스쿼시 |
| E 최소 화면 | 고선주 | `web/src/` 안의 새 파일, `web/src/**/__tests__` | 2개 (`seonju/u1-web-mock`, `u1-web-connect`) | PM 세션이 계약 C1·화면 설계 대조 → 스쿼시 |
| F 통합·끝단 확인·문서·추적 | PM 세션 | 시나리오 초록, CI 조이기, `contracts/` 생성, README, 추적 파일 | PR #3 (`jiye/u1-integrate`) | 팀원 1명 확인 → 스쿼시 |

- PM 세션은 Part A·A-2에서 **경계를 코드로 먼저 고정**한다(Step 3·10·11): 규칙 엔진 입력·출력 모델, API 응답 모델, 화면 타입과 가짜 응답, 저장소 모델. 세 트랙은 이 경계 파일을 **고치지 않고** 쓴다. 고쳐야 하면 PM에게 먼저 말한다(약속 파일 규칙과 같음).
- 팀원은 자기 작업 지시서(`docs/work-orders/`)의 "만들 파일" 목록 밖의 파일을 만들거나 고치지 않는다. 공통 파일(`labels/ko.ts`, 설정 키)은 추가만 한다.
- 각 PR은 `AGENTS.md`의 PR·커밋 규칙(테스트 통과 뒤에만 PR, 쉬운 말 본문·커밋)을 지킨다. PR 검사(CI)는 Part A에서 올라간다.
- AI-DLC 코드 생성 단계는 세 트랙의 PR이 모두 합쳐지고 Part F가 끝날 때까지 "진행 중"으로 남는다. 세션을 넘겨도 이어진다. 계획의 체크 표시는 PM 세션이 PR을 합칠 때 한다.
- **예비 조치**: 10/26(일) 저녁까지 합쳐지지 않은 트랙은 PM 세션이 남은 단계를 이어 만든다(그 팀원은 검토·테스트 보강으로 역할을 바꿈). 체크포인트 일정은 아래 "일정" 참조.

## 단계 (Steps)

각 단계 끝의 `→ US…`는 이 단계가 구현하는 이야기(`../../../inception/units-generation/unit-of-work-story-map.md`)다. 담당이 적힌 단계는 그 사람이 자기 AI 도구로 만들고 PR을 올린다.

### Part A. 기본 틀·경계 코드 (Step 1~8, 담당 PM 세션) — 끝나면 PR #1

- [ ] **Step 1. 파이썬 패키지 뼈대와 설정 파일**: `pyproject.toml`(패키지 `geosan`, 의존성 FastAPI·uvicorn·SQLAlchemy 2·Alembic·pydantic v2·ruamel.yaml·Typer, 개발 의존성 pytest·pytest-bdd·pytest-cov·httpx·ruff; Ruff 설정; `geosan` 콘솔 스크립트), `requirements.lock`, `.python-version`(3.12), `geosan/__init__.py`·`__main__.py`, 부품 폴더 12개(`config/ capability/ opportunity/ evidence/ rules/ evaluation/ questions/ records/ workflows/ commands/ api/ storage/`) 각각 `__init__.py`와 한 줄 설명 docstring, `.env.example`(`GEOSAN_DB_PATH`), `.gitignore`에 `data/ logs/ backups/ .env web/node_modules web/dist .venv __pycache__ .coverage` 추가. HTTP 클라이언트·LLM SDK 의존성은 넣지 않는다(보안 설계 4장). → US9.4(명령 틀), 인프라 명세 1장
- [ ] **Step 2. 예시 파일 5개와 약속 파일 폴더**: `examples/rule-config.yaml`(C7 RuleConfig: 신규 프로필 8항목 배점·단계값, 확실도, 감쇠, 기준점, 반올림, 핵심 근거, 시점 요건, 조사 요건 2시간, 분류 쉬운 말 11개, `otherGroupSort`, `hypothesisNote: "기업 승인 전 가설"`), `examples/app-settings.yaml`(담당자 4명 + viewer, `activeDatasetKind: VIRTUAL_REVIEWED`, brand(demoLabel null), accessProtection off, llm NONE), `examples/capability-geosan.json`(9종 공정·소재·태그, ISO 9001·AS9100D(4개 공정 범위)·한화시스템 승인서 UNCONFIRMED, 가상 검수 묶음 REVIEWED, 모든 값에 `_설명`과 "가상·거산 실제 사양 아님"), `examples/case-apjeong.json`(FR10.1 역산 입력 그대로: 8항목·요구 3개·신호 공고+증설·근거·접촉 이력 2024 견적(기회 연결 없음)·readinessCheck checked·baseDate·expected E77/P95/S81.1/R82/C87.5·PASS·MET·CONTACT_URGENT, notes "역산한 가정값, 규칙서 F.7 확인 전, 증설 신호는 가상 추가"), `examples/case-template.json`(실제 기업용 빈 틀, 칸마다 `_설명`에 뜻·허용 값, isVirtual false, datasetKind BROCHURE), `contracts/` 네 스키마(`*.schema.json`, "이 계획을 승인하면" 1항의 더하는 변경 포함)와 `contracts/openapi.json` 자리(Step 29에서 생성). → US1.1, US1.2, US5.1, C7
- [ ] **Step 3. 경계 코드(계약을 코드로 먼저 고정)**: `geosan/rules/codes.py`(C0 열거값·ClassificationCode 코드표 11개·순서·blocksApproval·isContactCandidate), `geosan/rules/models.py`(C3 EvaluationInput·EvaluationOutput·RankInput pydantic 모델, `itemInputs`·`signals[].relation` 포함; 함수 서명 `evaluate(input) -> EvaluationOutput`, `rank(outputs) -> list` 자리만), `geosan/api/schemas.py`(C1 Envelope·Error·RecordMeta·OpportunityCard·OpportunityDetail·RequirementCheckView·EvidenceView·Question·의견 요청/응답 pydantic 모델), `geosan/workflows/models.py`(FlowResult), `geosan/config/errors.py`(AppError: message·nextAction·ref·kind·fields), `web/src/api/types.ts`(C1 응답 타입), `web/src/test/fixtures/`(가짜 응답 JSON: `config-ui.json`, `opportunities-apjeong.json`(A정밀 카드 1건: 순위 1·CONTACT_URGENT·81·이유·막는 조건 "없음"), `opportunity-detail-apjeong.json`(상세: 요구 3개 PASS/LATER_STAGE/QUESTION_NEEDED, 질문 1개, 점수 E77/P95/S81.1/R82/C87.5), `opinion-saved.json`, `error-403.json`), `tests/factories.py` 골격. 세 트랙이 이 파일들을 고치지 않고 쓴다. → C1, C2, C3
- [ ] **Step 4. 화면 뼈대**: `web/`에 Vite 5 + React 18 + TypeScript + Ant Design 5 + Pretendard 프로젝트(`package.json`·`package-lock.json`·`.nvmrc` 20·`vite.config.ts`(빌드 결과 `web/dist`, 개발 시 `/api` 프록시, `VITE_USE_FIXTURES=1`이면 가짜 응답 사용)·`tsconfig.json`·ESLint 9·Prettier 설정), `src/theme/tokens.ts`·`src/config/brand.ts`(설정 한 곳), `src/labels/ko.ts`(쉬운 말 대응표: 분류 11개·검수 상태·판정 표시·의견 3값·띠 문구·오류 문구; 뒤 단위는 추가만), `src/api/client.ts`(fetch, Envelope·오류 형식, 10초 중단, X-Staff-Key; 가짜 응답 전환 지점), `src/pages/`·`src/components/` 빈 자리. → US10.1, US10.4
- [ ] **Step 5. 테스트 러너 준비(파이썬)**: `tests/conftest.py`(임시 SQLite 파일 DB 픽스처(init-db 적용), 네트워크 소켓 차단 픽스처(autouse), 고정 기준일 픽스처, 예시 파일 경로 픽스처, FastAPI TestClient 픽스처), `tests/features/u1/`·`tests/steps/u1/`·`tests/unit/u1/` 폴더, `pyproject.toml`의 pytest 설정(`testpaths`, `bdd_features_base_dir = tests/features`, 커버리지 `--cov=geosan --cov-fail-under=80`). 러너가 뜨는지 빈 테스트 1개로 확인하고 정확한 실행 명령을 `unit-test-instructions.md`에 적는다(이미 적음). → NFR9
- [ ] **Step 6. 테스트 러너 준비(화면)**: `web/vitest.config.ts`(jsdom, React Testing Library, `src/test/setup.ts`에 matchMedia 보완), `npm test` = `vitest run`, 빈 테스트 1개로 러너 확인. → NFR9
- [ ] **Step 7. 최소 CI와 로컬 검사 스크립트, 문서 초안**: `.github/workflows/check.yml`(병렬 두 작업: 파이썬 3.12 설치·잠금 설치·`ruff format --check`·`ruff check`·`pytest --cov-fail-under=80`·임시 DB에 init-db→import-capability→import-case→`verify-case examples/case-apjeong.json` / 노드 20·`npm ci`·lint·format:check·`vitest run`·`vite build`; 두 작업 모두 `*.db`·`.env`·비밀 패턴 커밋 검사), `scripts/check.sh`(같은 순서를 로컬에서; 인자로 `python`·`web`만 골라 돌리기 가능), `README.md` 초안(설치·명령·검사 방법·폴더 경계·팀원 폴더), `docs/case-file-guide.md` 초안(실제 기업 사례 파일 작성법: 근거 3종, 8항목 판정표(일치도 단계·확실도 등급 기준 BR4.2·BR4.3), 연락처 금지, check-case 사용). 트랙이 다 합쳐지기 전까지 CI의 시나리오·verify-case 단계는 실패가 정상이므로 그 두 단계만 `continue-on-error: true`로 두고 Step 28에서 푼다(한시적; 단위 테스트·커버리지 80% 하한·코드 모양 검사는 처음부터 막음). → 인프라 cicd-pipeline 2·5장, US9.4
- [ ] **Step 8. 역할표와 작업 지시서 3개, 규칙 문서 갱신**: `docs/work-orders/u1-rules-engine.md`(유동렬), `docs/work-orders/u1-import-evaluate-api.md`(이강욱), `docs/work-orders/u1-web.md`(고선주). 지시서마다 ① 만들 파일(정확한 경로)과 고치면 안 되는 파일 ② 단계 순서(이 계획의 자기 Part 단계 그대로, 구현 → 단위 테스트) ③ 완료 기준(돌려야 할 명령과 기대 출력, 커버리지, 시나리오 초록 여부) ④ A정밀 기대값과 읽기 예시 2 수치, 소개서 묶음 기대 분류 ⑤ 하지 말 것(수치 하드코딩, 약속 파일 변경, 경계 파일 수정, 연락처, 외부 호출, 거산 자료 AI 도구 입력) ⑥ 읽을 설계 문서(`rules.md`·`entities.md`·`functional-spec.md`·계약의 해당 절) ⑦ PR 올리는 법(가지 이름, 템플릿, 쉬운 말 커밋). `docs/team-start-guide.md` 1장·4장에 뼈대 분담 변경과 "기본 틀 올라간 뒤 할 일" 역할표(아래 표) 추가, `AGENTS.md` 도구 사용 규칙의 뼈대 기간 문장을 새 분담으로 고침, 전달 계획 `team-allocation.md` 1장 역할표 갱신(PM 지시). → US9.4

| 사람 | 기본 틀(PR #1·#2)이 올라간 뒤 할 일 | 지시서 |
|---|---|---|
| 유동렬 | Part C: 규칙 엔진 구현 → 단위 테스트 → PR | `docs/work-orders/u1-rules-engine.md` |
| 이강욱 | Part D: 투입 → 평가·흐름 → 명령·API 구현, 층마다 단위 테스트 → PR 2~3개 | `docs/work-orders/u1-import-evaluate-api.md` |
| 고선주 | Part E: 가짜 응답으로 화면 구현 → 단위 테스트 → PR, Part D 합쳐진 뒤 실제 API 연결 → PR | `docs/work-orders/u1-web.md` |
| 전원 | 틈틈이 실제 기업 사례 파일 각자 약 5곳(`team-start-guide.md` 4-1) | `docs/case-file-guide.md` |
| PM 세션 | Part A-2(시나리오·모델·검사기) → PR 검토·합치기 → Part F | 이 계획 |

### Part A-2. 시나리오 테스트 먼저, 저장소 모델·검사기 (Step 9~12, 담당 PM 세션) — 끝나면 PR #2

- [ ] **Step 9. 시나리오 10개 파일 작성(한국어 Given/When/Then, 이 시점에는 실패가 정상)**: `tests/features/u1/` 아래 `apjeong_skeleton.feature`(A정밀 끝단: 역량·사례 투입 → evaluate → verify-case 일치 → 목록 1건 순위 1·분류 CONTACT_URGENT·점수 81 → 상세 요구 표 ISO 9001 PASS·샘플 승인 LATER_STAGE·Nadcap QUESTION_NEEDED·질문 1개(Nadcap) → 의견 저장 → 목록에 의견 반영), `s01_capability.feature`(9종 등록·검수 상태 4값·소개서 묶음 PENDING·EQUIPMENT 판정 제외·범위 행·재투입 REVIEWED 유지 경고), `s02_opportunity_identity.feature`(같은 caseId 두 번·발견 경로 둘 → 기회 하나·자식 행 supersededAt·평가 이력 보존), `s04_interaction_isolation.feature`(같은 고객 다른 기회 이력 → 점수 변화 없음·hasLinkedInteraction false), `s06_relation_unconfirmed.feature`(UNCONFIRMED → 점수 계산·FILTER_PENDING·blocksApproval), `s07_requirement_level.feature`(reqLevel 비움 → UNKNOWN 저장·필터 영향 없음·질문 생성, PENDING 자격으로 PASS 없음), `s08_requirement_check.feature`(통과 7조건, 범위 안 맞음 EXCLUDED, 만료·정지 자격, LATER 단계, REQUIRED·UNKNOWN 단계 → PENDING_BLOCKS, 소재 불일치는 연결만 제외(S09 일부)), `s10_opinion.feature`(의견 3값·NOT_TARGET 사유 400·연락처 400·viewer 403·낡은 evalId 저장·버전 증가·previousValue·분류 불변), `reading_example2.feature`(E25/P25/S100/C12.5, 접촉 후보 아님), `brochure_dataset.feature`(BROCHURE 활성 묶음: 필수 요구 있으면 FILTER_PENDING·"참고 N"·띠·질문, 없으면 OPS_PENDING, 접촉 후보 없음, OTHER 정렬 E순; 가상 검수 묶음 값과 섞이지 않음). 단계 함수는 `tests/steps/u1/`에 파일별로 두고 실제 호출 코드(명령 함수·TestClient·임시 DB)로 작성해 구현 뒤 그대로 통과하게 한다. 규칙 엔진 단독 시나리오(`reading_example2`·점수 계산 부분)는 Step 3의 입력 모델로 직접 호출한다. → US1.1, US1.2, US3.2, US5.1, US5.2, US5.3, US6.1, US6.2, US7.1, US10.1
- [ ] **Step 10. 저장소와 모델·마이그레이션(`geosan/storage/`, 각 부품 `models.py`, `migrations/`)**: SQLAlchemy 2 엔진(WAL·busy_timeout 5000·외래 키 켬·`GEOSAN_DB_PATH`), 세션·트랜잭션 도우미(한 흐름 = 한 트랜잭션), 공통 열 기본 모델(created_at UTC·created_by·session_ref·dataset_kind·is_virtual, 자식 행 superseded_at), ID 생성(접두사+ULID), `entities.md`의 28개 엔티티를 접두사별 모델로(cfg_·cap_·opp_·ev_·eval_·q_·rec_), Alembic 설정과 첫 마이그레이션 파일 접두사별 7개(`cfg_001_init.py` … `rec_001_init.py`), `geosan db merge-heads` 도우미, `init-db` 명령의 바탕 함수. 세 트랙은 모델 열을 바꾸지 않는다(필요하면 PM에게). → US1.1, US3.2, US5.1, US7.1, C6
- [ ] **Step 11. 설정·검사기·로더(`geosan/config/`)**: `loader.py`(ruamel.yaml로 JSON·YAML 읽기, 경로→줄 번호, `_설명` 무시, UTF-8 BOM 허용, 그 밖 인코딩 오류), `validators.py`(연락처 패턴 검사기 한 곳: 이메일·국내 전화·+82; 모르는 키 오류; 허용 값 오류 문구 `<줄>번째 줄 <경로>: … 중 하나여야 하는데 '<값>'이 적혀 있습니다`), `rule_config.py`(pydantic 모델·버전·SHA-256 해시·`cfg_rule_config_version` 등록·FIXED 덮어쓰기 금지·단계 이름→숫자 변환표), `app_settings.py`(담당자 목록·activeDatasetKind·brand·비밀 키(`password`·`apiKey`·`token`) 있으면 오류), `schemas.py`(CaseFile·CapabilityFile pydantic 모델 → `contracts/*.schema.json` 생성 원본). → C7, BR2.1·BR2.2·BR7.6·BR11.3
- [ ] **Step 12. 저장소·검사기 단위 테스트(`tests/unit/u1/test_storage.py`, `test_config_loader_validators.py`)**: 저장소 6개(WAL·busy_timeout 설정 확인, 공통 열 자동 채움, 마이그레이션 적용·재실행, downgrade 1단계, 접두사별 테이블 존재, ID 접두사), 로더·검사기 8개(줄 번호 문구·모르는 키·`_설명`·연락처 3패턴·BOM·단계 이름 변환·비밀 키 오류·min>max). → NFR7, C7

### Part C. 규칙 계산 층 (Step 13~15, 담당 유동렬 — 지시서 `u1-rules-engine.md`)

- [ ] **Step 13. 규칙 엔진 구현(순수 계산, `geosan/rules/`; `codes.py`·`models.py`는 Step 3에서 고정됨)**: `requirements.py`(BR3.1~BR3.7·BR3.10: 자격 대조 7조건, 기술 조건 대조, 표시 변환 BR3.3, 필터 상태 BR3.4, 제외 범위 BR3.7), `items.py`(BR4.1~BR4.5: 대표 신호 선택·감쇠·HALF_UP·7상태·8행), `totals.py`(BR4.6 F/T/E/P/S/C/R·검증), `timing.py`(BR5.1~BR5.5·BR5.7 핵심 근거·시점 ①②③·운영 전제·조사 요건·기한 체크 초기화 판단 BR7.4), `classify.py`(BR6.1~BR6.3, BR5.6 소개서 묶음, 표시값 BR10.2·BR10.3·nextAction 문구), `rank.py`(BR6.4·BR6.5 sortKey·originalRank·otherGroupSort), `questions.py`(BR8.1 질문 후보), `engine.py`(`evaluate(input) -> EvaluationOutput`, `rank(outputs)` 본문; 현재 시각·난수·I/O 없음 BR4.8). 수치는 전부 설정에서 받고 코드 상수 없음(BR7.6). 완료 기준: A정밀 입력(Step 9 `reading_example2`와 `tests/data/apjeong-input.json`)으로 E77/P95/S81.1/R82/C87.5·PASS·MET·CONTACT_URGENT, 읽기 예시 2 E25/P25/S100/C12.5. → US5.1, US5.2, US5.3
- [ ] **Step 14. 규칙 엔진 단위 테스트(`tests/unit/u1/test_rules_*.py`)**: 요구 판정 8개(7조건 각 실패·LATER·TECHNICAL 범위·QUANTITY 고정 UNKNOWN), 항목 점수 8개(10.05→10, 81.05→81.1, 단계값 밖 거부, 대표 신호 선택, 예정 사건 미확보, 채용 종료 0, 공고 마감=기준일 1.0, 자격 validTo=기준일 유효), 합계 6개(P=0 S null, E≤P≤100 위반 실패, R 재계산), 분류 8개(11분기 순서·RECHECK 건너뜀·기준점 설정값·BROCHURE ②③), 정렬 6개(그룹 순서·URGENT validUntil·OTHER default/brochure·결정성 두 번 실행 동일), 질문 후보 5개(PENDING 자격·UNKNOWN 수준·단계 미확인·통과값 질문 없음·대상당 하나). `geosan/rules/` 커버리지 95% 이상. → US5.1~US5.3
- [ ] **Step 15. 규칙 PR 검토·합치기(PM 세션)**: 계약 C3 모델 그대로 썼는지, 수치가 설정에서 오는지, A정밀·읽기 예시 2 통과, 단위 테스트 수, 경계 파일 미수정을 확인하고 스쿼시 머지. → 진행 방식

### Part D. 투입·평가·명령·API 층 (Step 16~22, 담당 이강욱 — 지시서 `u1-import-evaluate-api.md`)

- [ ] **Step 16. 거산 역량 투입·조회(`geosan/capability/`)**: `importer.py`(W1: 검사 → 묶음 안 공정→역량·실적→자격→범위(processCode 존재 확인)→상태 이력 순 저장, 재투입 (datasetKind, 키) 덮어쓰기·FieldEvidence dataVersion 새 행·REVIEWED→PENDING 되돌림 금지 경고, reviewDefaults, 한 트랜잭션, 요약 한 줄), `queries.py`(모든 조회가 `datasetKind` 필수 인자, 검수 상태 원본 = 최근 FieldEvidence, 사본 불일치 로그·수정, 스냅샷용 읽기). → US1.1, US1.2
- [ ] **Step 17. 사례 투입·근거·조사 요건·기한 체크(`geosan/opportunity/`, `geosan/evidence/`, `geosan/questions/`, `geosan/evaluation/inputs.py`)**: `opportunity/importer.py`(W2: 공통 검사 + itemInputs 단계값·expected 형식·processCode·evidenceRefs/signalRefs 인덱스·SIG_* 대표 신호 relation 일치; `check_case`(저장 없음, 역량 파일 선택) / `import_case`(고객(bizNumber 또는 정규화 이름+주소 식별) → 기회(caseId·baseDate; 재투입 시 자식 행 supersededAt) → 발견 경로((sourceId, originKey) 중복 유지) → 공정 연결(processCode) → 근거(MANUAL 확정값) → 요구(수준·단계 파일 값 그대로, 비면 UNKNOWN)·신호(relation·날짜)·접촉 이력 → 8항목 판정 입력(없는 항목 UNAVAILABLE 행, refs → ID) → 조사 요건 → 기한 체크(evalIdAtCheck null) 순, 한 트랜잭션, 요약 한 줄), `opportunity/queries.py`, `evidence/queries.py`(FORBIDDEN 기본 제외, 스냅샷은 ID·사유만), `questions/store.py`(질문 upsert (targetKind, targetId)·연결 (questionId, oppId)·ResearchTask 저장), `evaluation/inputs.py`(ItemJudgmentInput·ReadinessCheck 저장·현재 행 조회). PR 1(`u1-import`) 경계. → US3.2, US5.1, US5.2
- [ ] **Step 18. 평가 원장과 흐름 ⓪(`geosan/evaluation/`, `geosan/workflows/`)**: `evaluation/snapshot.py`(W3 4단계: 활성 묶음 거산 값·기회·요구·신호·근거·8항목 입력·기한 체크·조사 요건을 C3 EvaluationInput으로, 해시, operationalReady 계산, 8행 없으면 건너뜀 사유), `evaluation/ledger.py`(W3 7~8단계: EvaluationBatch(scope FULL/PARTIAL·baseDate·ruleVersion·ruleHash·codeVersion·llmMode NONE·datasetKind·sortRule), EvaluationRun(CONFIRMED·previousEvalId·이전 SUPERSEDED·blocksApproval·scoreDisplay·blockerText·nextAction 저장)·ItemJudgment 8행·RequirementCheck·JudgmentEvidence·기한 체크 evalIdAtCheck 채움/초기화·OppProcessLink currentResult 갱신; 최신 FULL 묶음·기회별 최신 확정 평가 조회), `workflows/flow_evaluate.py`(`run_evaluation(oppIds, baseDate, requestedBy) -> FlowResult`: 설정→묶음→대상→스냅샷→엔진→순위→저장→파생 갱신→질문 후보, 한 트랜잭션, 실패 시 되돌리고 묶음만 FAILED·종료 코드 2; 검증 실패는 묶음 전체 실패; 기준일 BR2.8), `workflows/registry.py`(흐름 표 한 곳). 규칙 엔진(Part C)이 아직 없으면 Step 3 모델로 가짜 출력(A정밀 고정값)을 돌려주는 `tests/fakes/fake_engine.py`로 먼저 돌리고, Part C가 합쳐지면 진짜로 바꾼다. PR 2(`u1-evaluate`) 경계. → US5.1, US5.2, US5.3, US8.1(틀)
- [ ] **Step 19. 명령 9개(`geosan/commands/`)**: Typer 앱(`geosan`·`python -m geosan`, 한국어 `--help`, 종료 코드 0/1/2, 마지막 줄 쉬운 한국어 요약), 명령별 파일 `init_db.py`(마이그레이션 적용·재실행 안전), `serve.py`(설정 검사 뒤 uvicorn, 포트 사용 중 안내, `web/dist` 정적 파일), `check_config.py`, `import_capability.py`, `import_case.py`, `check_case.py`(DB 없이), `evaluate.py`(`--opp`·`--base-date`, 묶음 ID·기회 수·분류별 건수), `verify_case.py`(W4: caseId 기회 → PARTIAL 평가(같은 기준일·규칙·스냅샷 해시면 재사용) → expected 비교 표(E·P·R 정수, S·C 소수 1자리, filterState, coreEvidenceMet, classificationCode, requirementResults) → 0/2), `export_contracts.py`(OpenAPI + 4 스키마를 `contracts/`에 쓰기, `--check`는 3.7), `db_merge_heads.py`. 경로 인자는 절대 경로 정규화·`..`·심볼릭 링크 거부. → US9.4, US5.1, C8
- [ ] **Step 20. 웹 API(`geosan/api/`; `schemas.py`는 Step 3에서 고정됨)**: `app.py`(FastAPI, `/api/v1`, 정적 파일 마운트, JSON 로그 포매터(금지 필드 차단·ref)·요청 로그 `http.request` ms, 오류 변환(AppError → `{error:{message,nextAction,ref,kind?,fields?}}`, 500은 ref만), 본문 64KB 상한), `deps.py`(담당자 키 의존성: 없음/목록 밖/viewer → 403, U8 세션 자리), `routes/config.py`(GET /config/ui: 담당자 목록·brand(demoLabel)·코드표 쉬운 말·접속 보호 여부), `routes/opportunities.py`(GET /opportunities: 최신 FULL 묶음 순위 + 기회별 최신 평가 카드·reevaluated·meta total/updatedAt/hasVirtualData/datasetKind/notEvaluatedCount, 쪽 20·최대 50, `list_filters` 등록 자리; GET /opportunities/{oppId}: `detail_sections` 등록 방식으로 header→reasons(질문 3+나머지 BR8.3 정렬)→requirements→approvalEligibility→processLinks(sourceEvalId 불일치 재계산·로그)→evidence→scores→records.opinion→evalId/previousEvalId/reevaluated, 404), `routes/records.py`(POST /opportunities/{oppId}/opinions: W7 검사·expectedVersion·previousValue·새 행). PR 3(`u1-api-commands`) 경계. → US6.1, US6.2, US7.1, US10.1, US10.4
- [ ] **Step 21. 투입·평가·명령·API 단위 테스트(`tests/unit/u1/`)**: 역량 투입 7개(묶음 분리·재투입 경고·REVIEWED 유지·PROCESS 범위 processId 필수·상태 이력 최근 행·FieldEvidence dataVersion·사본 불일치 수정), 사례 투입 8개(식별 키·supersededAt·UNAVAILABLE 채움·refs→ID·SIG relation 불일치 오류·check-case DB 없음·processCode 활성 묶음 없음 경고·중복 요구 오류), 스냅샷·원장 8개(활성 묶음만·FORBIDDEN 제외·해시 결정성·SUPERSEDED 연결·FULL/PARTIAL·evalIdAtCheck 채움·마감일 변경 초기화·공정 연결 파생 갱신), 흐름 6개(트랜잭션 되돌림·묶음 FAILED·검증 실패·기준일 우선순위·8행 없음 건너뜀·질문 upsert), API 8개(목록 빈 상태·쪽 넘김·reevaluated·notEvaluatedCount·상세 404·403 세 경우·400 fields·오류 형식·ref), 명령 7개(종료 코드 0/1/2·요약 줄·verify-case 표·check-config 비밀 키·serve 포트 안내·init-db 재실행·export-contracts 파일 생성). 각 PR에 그 층의 테스트를 함께 넣는다. → US1.x~US7.1
- [ ] **Step 22. 투입·평가·명령·API PR 검토·합치기(PM 세션)**: PR마다 계약 C1·C2·C6·C7·C8 대조(경로·필드·명령 이름·오류 형식), 저장 함수가 자기 접두사 테이블만 쓰는지, 연락처 검사·외부 호출 없음, 단위 테스트 수, 경계 파일 미수정을 확인하고 스쿼시 머지. 세 PR이 다 합쳐지면 Step 18의 가짜 엔진을 걷어낸 것을 확인. → 진행 방식

### Part E. 화면 층 (Step 23~26, 담당 고선주 — 지시서 `u1-web.md`)

- [ ] **Step 23. 화면 구현, 가짜 응답으로 먼저(`web/src/`; `api/types.ts`·`api/client.ts`·`labels/ko.ts`·`theme`·`config`는 Step 3·4에서 고정, 대응표는 추가만)**: `components/frame/AppFrame.tsx`(로고 자리·메뉴 "추천 목록"·건너뛰기 링크·h1·담당자 Select(localStorage 기억)), `components/frame/StatusBanner.tsx`(내부용 항상·가상·거산 확인 전·demoLabel·갱신 시각, role=status), `components/common/FiveStates.tsx`(비어 있음·불러오는 중(5초 안내)·정상·오류+다시 시도·일부), `components/opinion/OpinionArea.tsx`(S3: 버튼 3개·'대상 아님' 사유 인라인·저장됨 HH:MM 3초→"의견: … (수정)"·실패 시 입력 유지·담당자 미선택 비활성·previousValue 안내, aria-live), `pages/OpportunityListPage.tsx`(S1: 카드(순위·제목·분류 쉬운 말·scoreDisplay·이유·막는 조건 (승인 막힘/승인은 막지 않음)·다음 할 일·재평가됨·가상 표시)·쪽 넘김·단수 문구), `pages/OpportunityDetailPage.tsx`(S2: 영역별 부품 `detail/HeaderSection`·`ReasonsSection`(질문 3+펼치기, 상태 글자)·`RequirementsTable`(머리글 행, 10개 이상 스크롤, 0개 문구)·`ApprovalEligibilityLine`·`ProcessLinksSection`·`EvidenceSection`(확인/추정 글자, FORBIDDEN 없음)·`ScoresCollapse`(E/P/S/R/C·항목표·규칙 버전·묶음·시각)·맨 아래 OpinionArea), 라우터(`/`, `/opportunities/:oppId`), 상호작용 요소마다 `data-testid`, 색·문구는 tokens·brand·labels에서만, 접근성 점검표(16px·대비·키보드·색+글자). 개발 중에는 `VITE_USE_FIXTURES=1`로 Step 3의 가짜 응답을 쓴다. PR 1(`u1-web-mock`) 경계. → US6.1, US6.2, US7.1, US10.1, US10.4
- [ ] **Step 24. 화면 단위 테스트(Vitest + RTL, `web/src/**/__tests__/`)**: StatusBanner 5개(내부용 항상·가상·거산 확인 전·demoLabel·시각), OpinionArea 7개(3값·사유 필수·저장됨→수정 전환·실패 유지·미선택 비활성·previousValue·aria-live), 목록 6개(빈 상태·불러오는 중·오류 다시 시도·카드 내용·참고 N·쪽 넘김), 상세 6개(영역 순서·질문 펼치기·요구 0개 문구·확인/추정 글자·점수 접힘·404), labels 2개(코드표 밖 코드 방어·11개 모두 문구). API 응답은 가짜(fetch mock, Step 3 fixtures). → US6.1, US6.2, US7.1, US10.4
- [ ] **Step 25. 실제 API 연결(Part D 합쳐진 뒤)**: `VITE_USE_FIXTURES` 없이 `geosan serve` + `npm run dev` 프록시로 A정밀 목록·상세·의견 저장이 실제로 도는지 확인하고 어긋난 필드를 고친다(필드 이름은 계약 C1 그대로, 화면이 서버에 맞춘다). `npm run build` → `web/dist`가 `geosan serve`에서 보이는지 확인. PR 2(`u1-web-connect`) 경계. → US6.1, US6.2, US7.1
- [ ] **Step 26. 화면 PR 검토·합치기(PM 세션)**: 계약 C1 필드 사용, 쉬운 말 대응표 밖 문구 없음, 색·글꼴 직접 지정 없음, `data-testid`, 접근성 점검표 항목, 단위 테스트 수를 확인하고 스쿼시 머지. → 진행 방식

### Part F. 통합·끝단 확인·환경·문서·추적 (Step 27~31, 담당 PM 세션) — 끝나면 PR #3

- [ ] **Step 27. 시나리오 전부 초록 확인(통합)**: 세 트랙이 합쳐진 `main`에서 Step 9의 10개 feature 파일을 실행해 모두 통과시킨다(어긋난 곳은 작은 수정 PR). 구현 검증 명령 `python -m pytest -q && python -m geosan verify-case examples/case-apjeong.json`을 임시 DB로 돌려 "검증 통과"와 종료 코드 0을 확인하고, 두 번 실행해 같은 결과(BR4.8)를 확인한다. 전체 커버리지 80% 미만이면 테스트를 더해 올린다(하한 조정 금지). → US5.1
- [ ] **Step 28. 환경·빌드 설정 마무리**: 한 덩어리 실행 확인(`npm run build` → `geosan serve`가 `web/dist`를 내보내고 `127.0.0.1:8000`만 듣기), `scripts/check.sh` 전체 통과, CI의 시나리오·verify-case 단계에서 Step 7의 한시적 `continue-on-error`를 제거, `logs/` 일 1회 회전 14일 설정, `.env.example`·README 최종. → 인프라 명세 1장, cicd 2·5장
- [ ] **Step 29. 약속 파일 생성**: `python -m geosan export-contracts`를 사람이(PM 세션) 실행해 `contracts/openapi.json`과 스키마 4개를 생성·확인하고, 생성본이 Step 2에서 적은 더하는 변경과 같은지 눈으로 대조한다. PR 템플릿 "약속 파일을 바꿨나요?"는 "예". → C7, 계약 2장
- [ ] **Step 30. 문서 완성**: `README.md`(설치 3명령·가상 사례 투입·평가·확인 3명령·검사·폴더 경계·팀원 폴더·환경 변수), `docs/case-file-guide.md` 완성(판정표·예시·check-case 오류 읽는 법·연락처 금지·공개 자료만), `docs/queries.md`(기록 테이블 조회 예시 3개), 작업 지시서 3개에 "완료" 표시와 다음 단위 안내, 코드 주석은 규칙 번호(BR x.y)를 함수 docstring에 적어 역추적. → US9.4, US10.4
- [ ] **Step 31. 추적·요약 파일**: `<code-generation-record>/traceability.json`(AC 55개(Deferred 3개 제외)·BR 72개·NFR 97개 → 구현/테스트 파일 경로), `source-manifest.json`(이 단위가 만든 모든 경로, 팀원 PR 포함), `code-summary.md`(파일 목록·담당·결정·커버리지 수치·계획과 다른 점). → 추적

## 일정 (분담 뒤, 추정)

| 구간 | 담당 | 날짜 | 비고 |
|---|---|---|---|
| Part A 기본 틀 → PR #1 합침 | PM 세션 + 팀원 1명 확인 | 10/21(화) | 에이전트 1~1.5시간 + 확인·PR 1시간 |
| Part A-2 시나리오·모델·검사기 → PR #2 합침 | PM 세션 + 이강욱 확인 | 10/22(수) 오전 | 에이전트 2~3시간. 팀원은 PR #1만 합쳐져도 지시서 읽기·환경 설치·사례 파일 시작 가능 |
| Part C·D·E 병렬 | 유동렬 / 이강욱 / 고선주 | 10/22(수) 오후 ~ 10/26(일) | C 약 6~8시간, D 약 12~16시간(PR 3개), E 약 8~10시간(PR 2개). 비전공자 + AI 도구 기준 |
| PR 검토·합치기 | PM 세션 | 들어오는 대로, 하루 1~2회 | PR당 30분~1시간 |
| 예비 조치 판단 | PM | 10/26(일) 저녁 | 안 합쳐진 트랙은 PM 세션이 이어 만듦 |
| Part F 통합·끝단 확인·문서 → PR #3 | PM 세션 | 10/27(월) ~ 10/28(화) | 에이전트 3~5시간 |
| 3.6 빌드와 테스트, 뼈대 체크포인트 | PM | 10/28(화) ~ 10/29(수) | 전달 계획 기한 10/28, 시연 10/30 |

## 단계 ↔ 이야기 대응표 (Story Traceability)

| 이야기 | 단계 |
|---|---|
| US1.1 공정 9종·거산 값 파일 등록 | 2, 9(s01), 10, 16, 21 |
| US1.2 회사소개서 값 '검수 대기' 투입 | 2, 9(s01·brochure), 16, 21 |
| US3.2 고객 관계·대응 목적 따로 기록 | 9(s04·s06), 10, 17, 21 |
| US5.1 평가 실행 → A정밀 기대값 | 2, 3, 9(apjeong·reading_example2), 13, 14, 18, 19, 21, 27 |
| US5.2 필수 요구 먼저, 모르는 것·안 되는 것 구분 | 9(s07·s08), 13, 14, 17, 18 |
| US5.3 분류 11가지와 정렬 | 9(brochure), 13, 14, 18 |
| US6.1 추천 목록 한눈에 | 3, 20, 21, 23, 24, 25 |
| US6.2 근거 상세 | 3, 20, 21, 23, 24, 25 |
| US7.1 두 번 클릭으로 의견 | 9(s10), 20, 21, 23, 24, 25 |
| US10.1 가상 데이터 표시 | 4, 20, 23, 24 |
| US10.4 쉬운 말·키보드·오류 안내 | 4, 20, 23, 24, 30 |
| US9.4 안내서만 보고 운영(명령 3개 이내, 틀) | 1, 7, 8, 19, 30 |

## 계획에서 뺀 것과 이유

- 홈페이지 읽기·LLM·전송 보호(U2), 자동 수집(U3), 질문 요청·회신(U4), 담기·승인·결과·기한 체크 화면(U5), 재접촉(U6), 대시보드(U7), 접속 보호·세션·백업 명령·호스팅(U8), 아연도금 사례(U10). 수용 기준 AC3.2.3·AC3.2.4·AC6.2.3은 각각 U5·U6·U2로 넘김(기능 설계 추적표와 같음).
- CI의 약속 파일 자동 비교·취약점 검사·`main` 보호 규칙·배포는 3.7 CI 파이프라인 단계(인프라 설계 Q2).
- 컨테이너·IaC 없음(인프라 설계 Q1).
