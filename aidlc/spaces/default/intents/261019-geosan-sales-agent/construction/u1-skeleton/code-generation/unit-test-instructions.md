# 단위 테스트 지침 (Unit Test Instructions) — U1 뼈대 (u1-skeleton)

이 단위의 테스트는 Testing Contract(custom)대로 **시나리오 테스트를 먼저 쓰고, 층마다 구현 뒤 단위 테스트**를 쓴다. 전략은 Standard(부품마다 5~8개 + 경계 통합 테스트), 범위 하한은 줄 커버리지 80%와 합치기 전 CI 실행이다. 두 의무는 서로 대신하지 않는다.

담당(PM 지시 2026-10-21): 시나리오 테스트·저장소·검사기 테스트는 PM 세션, 규칙 엔진 테스트는 유동렬, 투입·평가·명령·API 테스트는 이강욱, 화면 테스트는 고선주가 자기 구현 PR에 함께 넣는다. 각 PR은 테스트가 통과한 뒤에만 올린다(`AGENTS.md` PR·커밋 규칙). 아래 3장 표의 "담당" 열이 기준이다.

## 1. 도구와 설정

| 층 | 러너 | 설정 파일 | 비고 |
|---|---|---|---|
| 파이썬 시나리오 | pytest-bdd 7 | `pyproject.toml` `[tool.pytest.ini_options]` (`bdd_features_base_dir = "tests/features"`) | 한국어 `.feature`, 단계 함수는 `tests/steps/u1/` |
| 파이썬 단위·통합 | pytest 8, pytest-cov 5, httpx(TestClient) | 같은 파일 (`--cov=geosan --cov-fail-under=80`) | 커버리지 제공자 coverage.py(줄 기준) |
| 화면 | Vitest 2 + React Testing Library 16, jsdom | `web/vitest.config.ts`, `web/src/test/setup.ts` | fetch는 `vi.fn`으로 가짜 응답 |

공통 픽스처(`tests/conftest.py`):
- `tmp_db`: 임시 폴더의 SQLite 파일에 `init-db`를 적용하고 `GEOSAN_DB_PATH`를 그 경로로 바꾼다. 테스트마다 새 파일.
- `no_network`(autouse): 소켓 연결을 막아 외부 호출이 생기면 실패한다(NFR4.3).
- `base_date`: 고정 기준일 `2026-10-20`(A정밀 파일의 baseDate와 같음). 현재 시각에 의존하는 테스트를 두지 않는다(NFR12).
- `examples_dir`: `examples/` 경로. `rule_config`·`app_settings`·`capability_file`·`apjeong_case`가 예시 파일을 그대로 쓴다.
- `client`: FastAPI TestClient(임시 DB·예시 설정). 담당자 키 헤더는 `staff_headers("park-lee")` 도우미로.
- 가짜 데이터는 `tests/factories.py`의 작은 생성 함수(기회·요구·신호·거산 값)로 만들고 공유 가변 픽스처를 두지 않는다.

## 2. 이 단위의 테스트만 돌리는 명령 (정확한 명령)

러너 준비(Step 4·5)가 끝나면 이 명령이 먼저 돌아가야 하고, 그 뒤의 모든 단계는 같은 명령으로 확인한다.

```bash
# 파이썬: 이 단위의 시나리오 + 단위 테스트 + 커버리지
python -m pytest tests/features/u1 tests/unit/u1 -q --cov=geosan --cov-report=term-missing --cov-fail-under=80

# 파이썬: 시나리오만 (Step 7 직후에는 실패가 정상, Step 20에서 전부 초록)
python -m pytest tests/features/u1 -q

# 파이썬: 규칙 엔진 단위 테스트만 (Step 14, 유동렬)
python -m pytest tests/unit/u1/test_rules_requirements.py tests/unit/u1/test_rules_items.py tests/unit/u1/test_rules_totals.py tests/unit/u1/test_rules_classify.py tests/unit/u1/test_rules_rank.py tests/unit/u1/test_rules_questions.py -q --cov=geosan/rules

# 파이썬: 투입·평가·명령·API 단위 테스트만 (Step 21, 이강욱)
python -m pytest tests/unit/u1/test_capability_import.py tests/unit/u1/test_case_import.py tests/unit/u1/test_snapshot_ledger.py tests/unit/u1/test_flow_evaluate.py tests/unit/u1/test_api_routes.py tests/unit/u1/test_commands.py -q

# 파이썬: 저장소·검사기 단위 테스트만 (Step 12, PM 세션)
python -m pytest tests/unit/u1/test_storage.py tests/unit/u1/test_config_loader_validators.py -q

# 화면: 이 단위의 화면 테스트
npm --prefix web run test -- --run src

# 끝단 검증 명령(뼈대 체크포인트, PM 세션): 임시 DB에 투입 뒤
python -m pytest -q && python -m geosan verify-case examples/case-apjeong.json
```

뒤 단위는 `tests/features/u2` 같은 자기 폴더를 쓰므로 위 경로는 이 단위만 가리킨다.

## 3. 범위와 개수 (Standard + mvp 하한)

| 부품(폴더) | 단위 테스트 파일 | 개수 | 담당 | 핵심 검사 |
|---|---|---|---|---|
| rules/ | `test_rules_requirements.py` | 8 | 유동렬 | 통과 7조건 각각 실패 시 UNKNOWN/EXCLUDED, LATER 단계, TECHNICAL 범위, QUANTITY 고정 UNKNOWN |
| rules/ | `test_rules_items.py` | 8 | 유동렬 | 10.05→10, 단계값 밖 거부, 대표 신호 선택, 예정 사건·채용 종료·마감=기준일·validTo=기준일 |
| rules/ | `test_rules_totals.py` | 6 | 유동렬 | 81.05→81.1(HALF_UP), P=0 S null, 검증 실패, R 재계산, C 소수 1자리 |
| rules/ | `test_rules_classify.py` | 8 | 유동렬 | 11분기 순서, RECHECK 건너뜀, 기준점은 설정값, BROCHURE ②/③, scoreDisplay·blocksApproval |
| rules/ | `test_rules_rank.py` | 6 | 유동렬 | 그룹 순서, URGENT validUntil 오름, OTHER default/brochure, 두 번 실행 동일 |
| rules/ | `test_rules_questions.py` | 5 | 유동렬 | PENDING 자격·UNKNOWN 수준·단계 미확인 질문, 통과값 질문 없음, 대상당 하나 |
| storage/ | `test_storage.py` | 6 | PM 세션 | WAL·busy_timeout, 공통 열 자동 채움, 마이그레이션 적용·재실행, downgrade, 접두사 테이블, ID 접두사 |
| config/ | `test_config_loader_validators.py` | 8 | PM 세션 | 줄 번호 문구, 모르는 키, `_설명` 무시, 연락처 3패턴, BOM, 단계 이름→숫자, 비밀 키 오류, min>max |
| capability/ | `test_capability_import.py` | 7 | 이강욱 | 묶음 분리, 재투입 경고, REVIEWED 유지, PROCESS 범위 processId 필수, 상태 최근 행, dataVersion, 사본 불일치 수정 |
| opportunity/·evidence/·questions/ | `test_case_import.py` | 8 | 이강욱 | 식별 키, supersededAt, UNAVAILABLE 채움, refs→ID, SIG relation 불일치 오류, check-case DB 없음, processCode 경고, 중복 요구 오류 |
| evaluation/ | `test_snapshot_ledger.py` | 8 | 이강욱 | 활성 묶음만, FORBIDDEN 제외, 해시 결정성, SUPERSEDED, FULL/PARTIAL, evalIdAtCheck 채움, 마감일 변경 초기화, 공정 연결 갱신 |
| workflows/ | `test_flow_evaluate.py` | 6 | 이강욱 | 되돌림, 묶음 FAILED, 검증 실패, 기준일 우선순위, 8행 없음 건너뜀, 질문 upsert |
| api/ | `test_api_routes.py` | 8 | 이강욱 | 빈 목록, 쪽 넘김, reevaluated, notEvaluatedCount, 404, 403 세 경우, 400 fields, 오류 형식·ref |
| commands/ | `test_commands.py` | 7 | 이강욱 | 종료 코드 0/1/2, 요약 줄, verify-case 표, check-config 비밀 키, serve 포트 안내, init-db 재실행, export-contracts |
| web/ | `StatusBanner.test.tsx` | 5 | 고선주 | 내부용 항상, 가상, 거산 확인 전, demoLabel, 시각 |
| web/ | `OpinionArea.test.tsx` | 7 | 고선주 | 3값, 사유 필수, 저장됨→수정, 실패 유지, 미선택 비활성, previousValue, aria-live |
| web/ | `OpportunityListPage.test.tsx` | 6 | 고선주 | 빈·불러오는 중·오류, 카드 내용, 참고 N, 쪽 넘김 |
| web/ | `OpportunityDetailPage.test.tsx` | 6 | 고선주 | 영역 순서, 질문 펼치기, 요구 0개, 확인/추정 글자, 점수 접힘, 404 |
| web/ | `labels.test.ts` | 2 | 고선주 | 코드표 밖 코드 방어, 11개 문구 |

시나리오 테스트(`tests/features/u1/*.feature`, 10개 파일 약 30개 시나리오, PM 세션 작성)는 위와 별도이며 끝단(명령 함수·TestClient·임시 DB)으로 검사한다. 세 트랙이 다 합쳐지기 전에는 실패하는 것이 정상이며, 각 팀원은 자기 PR에서 **자기 단위 테스트만** 초록이면 된다(CI의 시나리오·verify-case 단계는 통합 전까지 실패 허용). 통합 경계(파일 → DB, 흐름 → DB, API → DB)는 시나리오와 `test_flow_evaluate.py`·`test_api_routes.py`가 맡는다.

이강욱 트랙이 규칙 엔진(유동렬)보다 먼저 평가 흐름에 닿으면 `tests/fakes/fake_engine.py`(A정밀 고정 출력, Step 3 모델 사용)로 먼저 돌리고, 규칙 PR이 합쳐지면 진짜 엔진으로 바꾼다. 고선주 트랙은 `web/src/test/fixtures/`의 가짜 응답으로 먼저 만든다.

## 4. 커버리지 목표

- 줄 커버리지 **80% 이상**(`--cov-fail-under=80`). 목표: `geosan/rules/` 95% 이상, 나머지 80% 이상.
- 제외: 없음. `# pragma: no cover`는 쓰지 않는다. 커버리지가 모자라면 테스트를 더한다. 하한·설정값을 내리지 않는다.
- 화면은 Vitest 커버리지(v8)를 켜되 하한은 두지 않고 숫자만 `code-summary.md`에 적는다(파이썬 80% 하한은 서버 코드 기준).

## 5. 가짜 응답(mock)·격리

- 외부 호출은 U1에 없다. 혹시 생기면 `no_network` 픽스처가 실패시킨다(가짜로 대체하지 않고 제거한다).
- 시각은 고정 기준일·고정 `now` 픽스처로 넣는다. 규칙 엔진은 입력만 받으므로 mock이 필요 없다.
- 화면 테스트는 fetch를 `vi.fn`으로 바꾸고 응답은 C1 Envelope 형식의 고정 JSON(`web/src/test/fixtures/`).
- DB는 테스트마다 새 임시 파일. 메모리 DB를 쓰지 않는다(WAL·파일 동작을 그대로 검사).

## 6. 테스트 데이터

- 기준 데이터는 `examples/`의 예시 파일 그대로(가상 검수 묶음 역량 파일, A정밀 사례). 변형이 필요하면 `tests/factories.py`로 복사해 한 값만 바꾼다(예: `apjeong_case(relationStatus="UNCONFIRMED")`).
- 읽기 예시 2는 `tests/data/reading_example2.json`(25점 한 항목만 확인, 나머지 UNAVAILABLE).
- 소개서 묶음 시나리오는 `tests/data/capability-brochure.json`(같은 9종, reviewStatus PENDING, datasetKind BROCHURE).
- 모든 테스트 데이터는 가상이며 연락처를 포함하지 않는다. 테스트 하나가 DB 전체를 훑어 이메일·전화 패턴 0건을 확인한다.
