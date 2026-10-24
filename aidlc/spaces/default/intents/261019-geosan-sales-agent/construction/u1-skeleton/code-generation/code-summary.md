# 코드 요약 — U1 뼈대 (code-generation, 2026-10-23 기준)

뼈대(U1)는 "A정밀 가상 사례 1건이 파일 투입 → 필수 판정 → 점수 → 분류 → 추천 목록·근거 상세 화면 → 담당자 의견 저장"까지 한 번에 이어지는 최소 동작이다. 코드 생성 계획 34단계 중 이 문서를 쓰는 시점에 29단계가 끝났고, Step 25(화면 실제 연결 확인, 이슈 #12), Step 19 일부(`export-contracts`), Step 28·29·30(환경·빌드 마무리, 약속 파일 생성, 문서 완성)이 남았다. 남은 셋은 PM 결정(2026-10-23)으로 10/29 거산 방문 뒤에 진행한다.

## 1. 만든 파일과 담당

| 영역 | 폴더·파일 | 파일 수 | 담당 | PR |
|---|---|---|---|---|
| 기본 틀·경계 코드·저장소·설정 검사기 | `geosan/storage/`, `geosan/config/`, `geosan/rules/codes.py`·`models.py`, `geosan/api/schemas.py`, `geosan/workflows/models.py`, `examples/`, `contracts/*.schema.json`, `scripts/`, `.github/` | — | PM 세션 (Part A·A-2) | #24, #28 |
| 규칙 엔진 | `geosan/rules/` (`requirements.py`·`items.py`·`totals.py`·`timing.py`·`classify.py`·`rank.py`·`questions.py`·`engine.py`) | 10 | 유동렬 (Part C) | #32 |
| 투입·평가·명령·API | `geosan/capability/`, `opportunity/`, `evidence/`, `questions/`, `evaluation/`, `workflows/`, `records/`, `commands/`, `api/` | 40 | 이강욱 (Part D) + PM 세션(`evaluate`·`verify-case`·`demo-report`·`serve`) | #40, #41, #42, #48, #35, 이 PR |
| 화면 | `web/src/` (틀·띠·다섯 상태·의견 영역·목록·상세·라우터·대응표·테마·가짜 응답) | 45 | 고선주 (Part E) | #31, #36, #59 |
| 테스트 | `tests/features/u1/` 시나리오 10개(.feature), `tests/steps/u1/`, `tests/unit/u1/` 21개 파일, `web/src/**/__tests__/` 9개 파일 | 51 + 9 | 모듈 담당 각자 + PM 세션(시나리오) | 위와 같음 |
| 실제 기업 사례 파일 | `examples/cases/*.json` | 18 | 유동렬 6, 고선주 6, 이강욱 3, PM 3 | #51·#52, #53, #54, #61 |
| 문서 | `README.md`, `docs/case-file-guide.md`, `docs/demo-memo-guide.md`, `docs/team-start-guide.md`, `docs/work-orders/` 3개 | 7 | PM 세션 | #24, #35, #49 |

`geosan/` 76개, `tests/` 51개, `web/src/` 45개 파일. 전체 목록은 `source-manifest.json`(폴더 단위 소유 선언)에 있다.

## 2. 주요 구현 결정

- **규칙 숫자는 전부 설정 파일에서 읽는다.** 배점·단계값·확실도·감쇠·기준점은 `examples/rule-config.yaml`에 있고 코드에 상수가 없다(BR7.6). 규칙 설정은 버전·해시로 등록되며 해시가 다르면 새 버전으로만 등록된다.
- **규칙 엔진은 순수 계산이다.** 현재 시각·난수·I/O를 쓰지 않고 기준일은 입력으로 받는다(BR4.8). 같은 입력이면 결과가 같다는 것을 `verify-case` 두 번 실행으로 확인했다.
- **뼈대에는 외부 호출이 없다.** HTTP 클라이언트·LLM SDK를 의존성에 넣지 않았고(`pyproject.toml`), 테스트는 네트워크를 차단한 상태에서 돈다(`tests/conftest.py`). 외부 LLM·홈페이지 읽기·전송 보호는 U2다.
- **거산 값 묶음 분리.** 가상 검수 묶음(VIRTUAL_REVIEWED)과 회사소개서 묶음(BROCHURE)을 따로 저장하고 평가는 활성 묶음만 읽는다. 소개서 묶음은 전부 "검수 대기"라 참고 점수·분류 ②/③·승인 불가로만 나온다.
- **한 흐름 = 한 트랜잭션.** 투입 1파일, 평가 1묶음, 의견 1건은 각각 트랜잭션 하나이고 중간 실패 시 전부 되돌린다. SQLite WAL, 쓰기 잠금 대기 5초.
- **오류는 숨기지 않는다.** 명령은 종료 코드 0/1/2와 한국어 사유, API는 `{error: {message, nextAction, ref}}`, 로그는 한 줄 JSON에 ref만 남기고 본문·연락처·담당자 키는 넣지 않는다.
- **경계 파일은 PM 세션만 고친다.** 열거값·상태 코드는 `geosan/rules/codes.py` 한 곳에 영문으로 두고 DB·API·화면·파일이 같은 값을 쓴다. 화면 문구는 `web/src/labels/ko.ts`, 색·글꼴은 `web/src/theme/tokens.ts`에서만 읽는다.
- **`serve`는 설정 검사를 먼저 한다.** `check-config`와 같은 검사기를 돌려 오류면 시작을 거부하고, DB가 없으면 `init-db`를 안내하며, `127.0.0.1`에서만 듣고, 포트가 사용 중이면 "포트 N이 사용 중입니다. --port로 바꾸세요"를 내고 종료 코드 2로 끝난다. `web/dist`가 있으면 화면도 함께 내보내고, 화면 주소를 새로고침하면 `index.html`을 돌려준다(#59).

## 3. 테스트와 검사 결과 (2026-10-23, `develop` 3502f32 + serve)

| 검사 | 결과 |
|---|---|
| 파이썬 단위 테스트 | 442개 + serve 6개 = 448개 통과 |
| 줄 커버리지(파이썬) | 94.34% (하한 80%, serve 포함) |
| 시나리오 테스트 (Given/When/Then) | 47/47 통과 (A정밀 끝단, 읽기 예시 2, 소개서 묶음, S01·S02·S04·S06·S07·S08·S10) |
| 구현 검증 명령 `verify-case examples/case-apjeong.json` | 11항목 모두 기대값 일치: E 77 / P 95 / S 81.1 / R 82 / C 87.5, PASS, MET, CONTACT_URGENT. 두 번 실행해 결과 동일 |
| 화면 테스트 (Vitest + RTL) | 44개 통과, 타입 검사·빌드 통과 |
| 코드 모양 (Ruff, Prettier, ESLint), 비밀·DB 파일 검사 | 통과 |
| 실제 서버 확인 | 임시 DB에 A정밀 투입·평가 뒤 `geosan serve --port 18080`: `/` 200 HTML(제목 "거산 영업지원"), `/api/v1/config/ui`·`/api/v1/opportunities`·상세 200, 상세 주소 직접 열기 200 HTML, 없는 API 경로 404 오류 형식, 같은 포트 재실행 시 사용 중 안내. 확인 뒤 종료 |

검사 명령은 `bash scripts/check.sh`(윈도우 `python scripts/check.py`)이며 CI(`.github/workflows/check.yml`)가 PR마다 같은 순서로 돈다. 시나리오·verify-case 단계는 아직 `continue-on-error`라 Step 28에서 필수로 바꾼다.

## 4. 추적

`traceability.json`에 수용 기준(AC) 69개, 규칙(BR) 72개, 비기능 요구(NFR) 97개, 합계 238개를 구현·테스트 파일 경로에 연결했다. OK 221, Deferred 14, N/A 3이며 추적 센서 검사를 통과했다.

- Deferred 14: 뒤 단위 소속(U2 홈페이지 주소 입력·S11 재평가 보존, U5 접촉 승인 목적, U6 재접촉 안내, U7 순서 변경 기록, U8 비밀번호·HTTPS, U10 운영 안내서·백업/복원, G0 이후 담당자별 계정)과 10/29 뒤로 미룬 Step 28·30(로그 설정 키, 조회 예시 문서, 백업 한 줄, 팀 밖 검증자).
- N/A 3: 전송 로그·외부 전송 건수(U2부터, 뼈대는 외부 호출 없음)와 외부 노출 금지 팀 규칙.
- 성능 요구(NFR2.x)는 코드 경로를 연결했을 뿐 응답 시간을 재지는 않았다. 측정은 성능 검증 단계에서 한다.

## 5. 계획과 다른 점

1. **`verify-case`가 평가를 재사용하지 않는다.** 계획(Step 19)은 "같은 기준일·규칙·스냅샷 해시면 PARTIAL 평가를 재사용"이라고 적었으나, 지금은 실행할 때마다 평가 ID(`eval-…`)가 새로 생긴다. 점수·분류 결과는 두 번 실행해도 같아 뼈대 검증에는 문제가 없지만, 평가 기록 테이블에 검증용 행이 쌓인다. PM 결정(2026-10-24): 계획대로 재사용으로 고친다. 이슈 #73, 10/29 방문 뒤 진행.
2. **합치기 방식이 스쿼시에서 merge commit으로 바뀌었다.** 계획 Step 15·22·26은 "스쿼시 머지"였으나 2026-10-22 가지 규칙 변경으로 모두 merge commit으로 합쳤다. 저장소 설정에서 스쿼시·리베이스를 꺼 두었다.
3. **구현 순서가 계획보다 빨랐다.** 팀원 개발을 10/23~10/27로 잡았으나 규칙 엔진·백엔드 세 PR·화면 1단계가 10/22 하루에 합쳐졌다. 대신 얇은 조각을 PM 세션이 혼자 끝까지 만드는 방식은 쓰지 않았고(2026-10-21 분담 변경), 경계 코드·시나리오 테스트·저장소를 먼저 올리고 팀원이 그 위에 자기 Part를 올렸다.
4. **실제 기업 사례 파일이 계획(10~20곳)의 상한에 가깝다.** 18곳이 들어왔고 소개서 묶음으로 평가하면 전부 "거산 확인 전" 참고 순위로만 나온다.
5. **`serve`는 uvicorn 기본 로그를 끈다.** 계획에 없던 세부 결정으로, geosan 로거의 JSON 한 줄 로그와 겹치지 않게 `log_config=None, access_log=False`로 띄운다. 요청 로그는 `http.request` 이벤트로 이미 남는다.
6. **Step 28·29·30은 10/29 거산 방문 뒤로 미뤘다.** CI 필수화·`logs/` 설정·약속 파일 생성(`export-contracts`, 사람 실행)·문서 완성은 PM 결정(2026-10-23)이다. `export-contracts` 명령은 "아직 구현되지 않았습니다"(종료 코드 2)로 남아 있다.
7. **추적 상류에 AC 11개가 더 있었다.** 계획은 "AC 55개(Deferred 3개 제외)"였으나 추적 센서가 AC8.1.x·AC9.4.x·AC10.2.x 11개를 더 요구해 69개로 맞췄다. 그중 7개는 뒤 단위 소속으로 Deferred다.

## 6. 확인하지 못한 것

- 화면을 실제 서버에 붙여 **브라우저로** 목록 → 상세 → 의견 저장이 도는지는 고선주가 확인한다(#12). 이 요약의 서버 확인은 curl 응답까지다.
- 담당자 키 없는 의견 저장이 403인지는 단위 테스트(`tests/unit/u1/test_api_routes.py`)로만 확인했고 실제 서버에서는 경로를 잘못 쳐 보지 못했다.
- 윈도우에서 `serve`가 뜨는지는 확인하지 않았다(맥에서만 확인).
