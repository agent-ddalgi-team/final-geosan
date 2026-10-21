# 작업 지시서 — U1 투입·평가·명령·API (Part D, 담당: 이강욱)

이 문서는 AI 도구(Claude Code·Codex)에 그대로 붙여 넣어도 되게 썼습니다. 이슈 **#8**(투입, Step 16·17), **#9**(평가 흐름, Step 18), **#10**(명령·API, Step 19·20)의 일이며 단위 테스트(Step 21)는 각 PR에 함께 넣습니다. 공통 규칙은 `AGENTS.md`, 시작 절차는 `docs/team-start-guide.md`입니다.

전제: PM 세션의 Part A-2(PR #2: 저장소 모델 `geosan/storage/`·각 부품 `models.py`·`migrations/`·설정 검사기 `geosan/config/`)가 `main`에 합쳐진 뒤 시작한다. 그 전에는 설계 문서 읽기와 `examples/case-template.json` 검토를 한다.

## 0. 한 줄 요약

파일 투입(역량·사례) → 평가 흐름 ⓪(스냅샷 → 규칙 엔진 → 순위 → 저장) → 명령 9개 → 웹 API 3개(목록·상세·의견)를 만들어, `init-db → import-capability → import-case → evaluate → verify-case`가 "검증 통과"를 내고 화면이 목록·상세·의견 저장을 할 수 있게 한다.

## 1. 만들 파일 / 고치면 안 되는 파일

**PR 1 `kangwook/8-import` (Step 16·17)**

| 파일 | 하는 일 | 규칙 |
|---|---|---|
| `geosan/capability/importer.py` | W1 역량 파일 투입: 검사 → 공정→역량·실적→자격→범위→상태 이력 저장, 재투입(묶음+키) 덮어쓰기·FieldEvidence dataVersion 새 행·REVIEWED→PENDING 되돌림 금지 경고, reviewDefaults, 한 트랜잭션, 요약 한 줄 | BR1.1~BR1.7, BR2.1~BR2.3 |
| `geosan/capability/queries.py` | 모든 조회에 `dataset_kind` 필수 인자, 검수 상태 원본 = 최근 FieldEvidence, 사본 불일치 로그·수정, 스냅샷용 읽기 | BR1.3, 보안 설계 5장 |
| `geosan/opportunity/importer.py` | W2 `check_case`(저장 없음, DB 없음) / `import_case`(고객→기회→발견 경로→공정 연결→근거→요구·신호·접촉 이력→8항목 입력(없는 항목 UNAVAILABLE)→조사 요건→기한 체크, 재투입 supersededAt, 한 트랜잭션) | BR2.1~BR2.9, BR4.2, BR7.4 |
| `geosan/opportunity/queries.py`, `geosan/evidence/queries.py`(FORBIDDEN 기본 제외), `geosan/questions/store.py`(질문 upsert·연결·ResearchTask), `geosan/evaluation/inputs.py`(ItemJudgmentInput·ReadinessCheck 저장·현재 행 조회) | 조회·저장 함수 | BR7.3, BR8.2 |
| `tests/unit/u1/test_capability_import.py`(7), `tests/unit/u1/test_case_import.py`(8) | 단위 테스트 | — |

- (PM 세션 추가 2026-10-21, Step 11 선행 연결) 파일 검사기는 이미 있다: `check_case`는 `geosan.config.file_checks.check_case_file(path, capability_path)`를, 역량 파일 검사는 `check_capability_file(path)`를 그대로 부르면 된다(둘 다 `CheckReport`를 돌려주고 통과하면 `.case`/`.capability`에 pydantic 모델, `.match_rates`에 숫자 일치도가 있다). `geosan check-case`·`check-config`·`init-db`·`db merge-heads` 명령은 PM 세션이 `app.py`에 먼저 연결했으므로 PR 3에서는 `commands/check_case.py`·`check_config.py`·`init_db.py`·`db_merge_heads.py`를 새로 만들지 않는다. 규칙 설정·앱 설정(활성 묶음·담당자 목록·brand)은 파일을 직접 읽지 말고 `geosan.config.registry.load_runtime_config(session)`로 읽는다(규칙 버전 등록·해시 검사·앱 설정 사본을 그 함수가 처리한다; `tests/steps/u1/_support.py` 머리에 기대 경로가 적혀 있다).

**PR 2 `kangwook/9-evaluate` (Step 18)**

| 파일 | 하는 일 | 규칙 |
|---|---|---|
| `geosan/evaluation/snapshot.py` | W3 4단계: 활성 묶음 거산 값·기회·요구·신호·근거(FORBIDDEN은 ID·사유만)·8항목 입력·기한 체크·조사 요건을 `EvaluationInput`으로, 해시, operationalReady 계산, 8행 없으면 건너뜀 사유 | BR5.5, BR7.2, BR7.3 |
| `geosan/evaluation/ledger.py` | W3 7~8단계: EvaluationBatch(scope FULL/PARTIAL 등)·EvaluationRun(CONFIRMED·previousEvalId·이전 SUPERSEDED·표시값 저장)·ItemJudgment 8행·RequirementCheck·JudgmentEvidence·기한 체크 evalIdAtCheck 채움/초기화·OppProcessLink 파생 갱신; 최신 FULL 묶음·기회별 최신 확정 평가 조회 | BR7.1, BR7.2, BR7.4, BR2.5 |
| `geosan/workflows/flow_evaluate.py` | `run_evaluation(opp_ids, base_date, requested_by) -> FlowResult`: 설정→묶음→대상→스냅샷→엔진→순위→저장→파생 갱신→질문 후보, 한 트랜잭션, 실패 시 되돌리고 묶음만 FAILED, 기준일 BR2.8 | BR7.5, BR2.8, C2 |
| `geosan/workflows/registry.py` | 흐름 표 한 곳 | U1 확장 지점 규칙 |
| `tests/fakes/fake_engine.py` | 규칙 엔진(Part C)이 아직 없을 때 A정밀 고정 출력(`EvaluationOutput`)을 돌려주는 개발용 가짜. **Part C가 합쳐지면 걷어낸다**(AGENTS.md ③ 예외) | — |
| `tests/unit/u1/test_snapshot_ledger.py`(8), `tests/unit/u1/test_flow_evaluate.py`(6) | 단위 테스트 | — |

**PR 3 `kangwook/10-api-commands` (Step 19·20)**

| 파일 | 하는 일 | 규칙 |
|---|---|---|
| `geosan/commands/init_db.py`, `serve.py`, `check_config.py`, `import_capability.py`, `import_case.py`, `check_case.py`, `evaluate.py`, `verify_case.py`, `export_contracts.py`, `db_merge_heads.py` | 명령별 본문. `geosan/commands/app.py`의 각 명령은 `not_implemented_yet(...)` 대신 이 파일의 함수를 부르게 **그 줄만** 바꾼다. 종료 코드 0/1/2, 마지막 줄 쉬운 한국어 요약, 경로 인자는 절대 경로 정규화·`..`·심볼릭 링크 거부 | BR11.1~BR11.3, C8 |
| `geosan/api/app.py` | FastAPI `/api/v1`, 정적 파일(`web/dist`) 마운트, JSON 로그 포매터(금지 필드 차단·ref)·요청 로그, 오류 변환(AppError → 계약 3장 형식, 500은 ref만), 본문 64KB 상한 | NFR10, 보안 설계 2·4겹 |
| `geosan/api/deps.py` | 담당자 키 의존성: 없음/목록 밖/viewer → 403 | BR9.3 |
| `geosan/api/routes/config.py`, `routes/opportunities.py`(`list_filters`·`detail_sections` 등록 방식), `routes/records.py`(W7 의견 저장) | 경로 묶음 3개 | BR10.1~BR10.5, BR9.1~BR9.5 |
| `tests/unit/u1/test_api_routes.py`(8), `tests/unit/u1/test_commands.py`(7) | 단위 테스트 | — |

**고치면 안 되는 파일(경계 파일, 고치려면 PM에게 먼저 말한다)**

- `geosan/api/schemas.py`(응답·요청 모델), `geosan/rules/codes.py`·`models.py`, `geosan/workflows/models.py`(FlowResult), `geosan/config/errors.py`(오류 형식), `geosan/storage/`와 각 부품 `models.py`의 **열**(PM 세션이 만든 저장소 모델; 열이 모자라면 PM에게), `migrations/`(새 마이그레이션이 필요하면 PM에게), `examples/`·`contracts/`(약속 파일), `web/`, `tests/conftest.py`(픽스처 추가는 PM과 상의).
- `geosan/commands/app.py`는 "`not_implemented_yet` 호출을 명령 함수 호출로 바꾸는 줄"만 고친다. 명령 이름·인자를 바꾸지 않는다.

## 2. 단계 순서 (구현 → 단위 테스트, PR 단위로)

1. 읽기(5장). 특히 `functional-spec.md` W1~W7·W9와 `entities.md`, 계약 C1·C2·C6·C7·C8, 3장 오류 규칙.
2. PR 1: `capability/importer.py`·`queries.py` → `opportunity/importer.py`·`queries.py` → `evidence/queries.py` → `questions/store.py` → `evaluation/inputs.py` 순으로 구현 → 단위 테스트 15개 → 검사 → PR.
3. PR 2: `evaluation/snapshot.py` → `ledger.py` → `workflows/flow_evaluate.py`·`registry.py` 구현. 규칙 엔진이 아직 `main`에 없으면 `tests/fakes/fake_engine.py`로 돌리고, 합쳐지면 `from geosan.rules.engine import evaluate, rank`로 바꾼다(`geosan/rules/models.py`의 같은 이름 함수는 서명만 보여 주는 자리라 부르지 않는다) → 단위 테스트 14개 → PR.
4. PR 3: 명령 10개 파일 → `api/app.py`·`deps.py`·`routes/*` 구현 → 단위 테스트 15개 → `verify-case`가 임시 DB에서 "검증 통과"를 내는지 확인(3장) → PR.
5. 각 PR 전에 `ruff format .`·`ruff check .`·단위 테스트 통과.

## 3. 완료 기준 (돌려야 할 명령과 기대 출력)

```bash
source .venv/bin/activate
python -m pytest tests/unit/u1/test_capability_import.py tests/unit/u1/test_case_import.py tests/unit/u1/test_snapshot_ledger.py tests/unit/u1/test_flow_evaluate.py tests/unit/u1/test_api_routes.py tests/unit/u1/test_commands.py -q
# 기대: 44 passed (PR마다 자기 파일만 초록이면 됨)
ruff format --check . && ruff check .

# PR 3 뒤 끝단 확인(임시 DB)
export GEOSAN_DB_PATH=/tmp/geosan-check.db
python -m geosan init-db
python -m geosan import-capability examples/capability-geosan.json      # "공정 9건, 역량 N건, 자격 3건 저장. 검수 대기 0건", 종료 0
python -m geosan import-case examples/case-apjeong.json                 # "고객 1·기회 1·근거 5·요구 3·신호 2 저장. 평가하려면 geosan evaluate", 종료 0
python -m geosan evaluate                                               # 묶음 ID, 기회 1건, "지금 바로 연락 검토 1", 종료 0
python -m geosan verify-case examples/case-apjeong.json                 # 항목별 일치 표 + "검증 통과", 종료 0
python -m geosan verify-case examples/case-apjeong.json                 # 두 번째도 같은 결과(BR4.8)
python -m geosan check-case examples/case-template.json; echo $?        # 빈 칸 때문에 오류 목록 + 종료 1 (정상)
```

A정밀 기대값(verify-case 표): E 77 / P 95 / S 81.1 / R 82 / C 87.5, filterState PASS, coreEvidenceMet MET, classificationCode CONTACT_URGENT, requirementResults ISO 9001 PASS · 품질팀 샘플 승인 LATER_STAGE · Nadcap QUESTION_NEEDED.

API(TestClient): `GET /api/v1/opportunities` → 카드 1건(rank 1, CONTACT_URGENT, scoreDisplay "81", blocker.blocksApproval false, meta.total 1); `GET /api/v1/opportunities/{oppId}` → requirements 3행·questions 1개(Nadcap)·scores E77; `POST …/opinions`(X-Staff-Key: park-lee) → 200 version 1; 키 없음/목록 밖/viewer → 403; NOT_TARGET에 reason 없음 → 400 fields[reason]; memo에 전화번호 → 400. 응답 모양은 `web/src/test/fixtures/*.json`과 같아야 한다(화면이 그 가짜 응답으로 먼저 만들어진다).

소개서 묶음(BROCHURE) 역량 파일과 실제 기업 파일을 넣고 `activeDatasetKind: BROCHURE`로 평가하면 분류가 FILTER_PENDING(필수 요구 있음) 또는 OPS_PENDING(없음), scoreDisplay "참고 N", blocksApproval true여야 한다(BR5.6).

## 4. 하지 말 것

- 약속에 없는 경로·필드·명령·테이블을 만들지 않는다. 필요하면 PM에게 먼저 묻는다.
- 다른 접두사 테이블에 쓰지 않는다(각 부품 함수로만). 평가·의견·검수 기록은 UPDATE 없이 새 행.
- 연락처 패턴을 저장하지 않는다(검사기 `geosan/config/validators.py`를 재사용). 외부 호출(HTTP·LLM)을 넣지 않는다.
- 오류를 빈 결과·기본값으로 숨기지 않는다. 실패는 되돌리고 종료 코드 2 / 500 + ref.
- 가짜 엔진(`tests/fakes/fake_engine.py`)을 Part C가 합쳐진 뒤에도 남기지 않는다.
- 규칙 숫자·기준점을 코드에 적지 않는다(엔진과 설정이 담당).
- 비밀번호·API 키를 인자·코드·로그에 넣지 않는다. 환경 변수는 `GEOSAN_DB_PATH`뿐.
- 거산 역량 파일(실제 소개서 값)·거산 내부 자료를 AI 도구에 넣지 않는다.

## 5. 읽을 설계 문서

- `construction/u1-skeleton/functional-design/functional-spec.md` — W1~W7·W9, 3장 상태 기계, 7장 모서리 조건
- `construction/u1-skeleton/functional-design/entities.md` — 28개 엔티티·식별 키·supersededAt
- `construction/u1-skeleton/functional-design/rules.md` — BR1·BR2·BR7·BR9·BR10·BR11
- `inception/contract-design/contract-summary.md` — C1(경로·응답), C2(흐름), C6(테이블 소유), C7(파일), C8(명령), 3장 오류·동시 수정
- `construction/u1-skeleton/nfr-design/security-design.md`(경계 검증·담당자 키·외부 호출 없음), `observability-design.md`(JSON 로그·ref)
- `construction/u1-skeleton/code-generation/code-generation-plan.md` Step 16~22, `unit-test-instructions.md` 3장

(모두 `aidlc/spaces/default/intents/261019-geosan-sales-agent/` 아래)

## 6. PR 올리는 법

1. `git switch main && git pull` → `git switch -c kangwook/8-import` (PR 2는 `kangwook/9-evaluate`, PR 3은 `kangwook/10-api-commands`)
2. 기능 하나마다 쉬운 한국어 커밋(예: `A정밀 사례 투입 명령 추가: 연락처가 있으면 저장을 거부한다`).
3. 3장 명령 통과 뒤에만 PR. PR 본문은 템플릿을 모두 채우고 `Closes #8`(또는 #9, #10). 약속 파일을 바꿨나요? → "아니오"(바꿔야 할 일이 생기면 먼저 PM).
4. 이슈에 쉬운 말 요약 댓글, 보드 '리뷰 중'. PM 세션이 계약 C1·C2·C6·C7·C8 대조·접두사 소유·연락처 검사·경계 파일 미수정을 확인한 뒤 스쿼시 머지한다(Step 22).
