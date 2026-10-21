# 기술 묶음 결정 (Tech Stack Decisions) — U1 뼈대 (u1-skeleton)

제약(CON-01: Python, FastAPI + React, SQLAlchemy, SQLite), 상세 화면 설계(Ant Design 5, Pretendard), 팀 실천 방식(Ruff, Prettier + ESLint, pytest, 시나리오 먼저)에서 이미 정해진 것을 한 표에 모으고, 앞 단계가 "코드 생성에서 확정"으로 넘긴 두 가지(시나리오 테스트 러너, 마이그레이션 도구)를 확인된 답변(`nfr-requirements-questions.md` Q1·Q2, PM 지시로 추천안)으로 정했습니다. 선택 기준은 비전공 4인이 AI 도구로 만들고 12/11 뒤 거산 운영자가 이어받을 수 있을 것입니다. 설정 분리(NFR11)도 여기서 정합니다.

## 1. 결정 표

| 영역 | 선택 | 버전(고정) | 이유 | 기각한 대안 | 출처 |
|---|---|---|---|---|---|
| 언어(서버) | Python | 3.12 | 제약, AI 도구 생성 품질, 팀 경험 | — | CON-01 |
| 웹 API | FastAPI | 0.115대 | 제약. OpenAPI 자동 생성(약속 파일 `contracts/openapi.json` 내보내기에 그대로 씀), pydantic 검증 | Flask(검증·문서 자동화 부족), Django(한 덩어리·명령 구조에 과함) | CON-01, C1 |
| 데이터 검증·설정 모델 | pydantic | v2 | FastAPI와 한 묶음. 파일·설정 검사기(C7)의 허용 값·필수·범위 검사를 선언으로 | 수동 검사 코드 | C7, NFR4.11 |
| 저장소 접근 | SQLAlchemy | 2.x | 제약. 접두사별 모델, 트랜잭션 경계(한 흐름 = 한 트랜잭션) | 순수 SQL(이식·검증 어려움) | CON-01, C6 |
| 데이터베이스 | SQLite | 내장(3.40+) | 제약. 한 파일, WAL, busy_timeout 5000ms, 외래 키 검사 켬 | PostgreSQL(운영 부담, 범위 밖) | CON-02, C6 |
| **마이그레이션 (Q2)** | **Alembic** | 1.13대 | SQLAlchemy 공식. 접두사별 파일 이름 규칙(`migrations/<접두사>_<번호>_<설명>.py`), merge 기능을 `geosan db merge-heads`로 감쌈, downgrade로 되돌리기(NFR7.6) | 자체 SQL 스크립트(되돌리기·머리 합치기 없음), 도구 없이 create-all(열 변경 위험) | C6, Q2 |
| 명령줄 | Typer(또는 argparse) | — | `geosan <명령>`과 `python -m geosan` 둘 다 제공, 한국어 `--help`, 종료 코드 0/1/2 | click 단독(차이 작음, 코드 생성에서 둘 중 하나로 확정) | C8 |
| 설정 파일 읽기 | ruamel.yaml(YAML, 줄 번호 제공), 표준 json + 줄 번호 보조 로더(JSON) | — | 오류를 "몇 번째 줄 어느 항목이 왜"로 보이려면 위치 정보가 필요(C7). JSON은 표준 모듈로 읽고 경로→줄 번호 대응은 작은 보조 함수(코드 생성에서 작성 또는 json-source-map 계열 라이브러리) | PyYAML(줄 번호 없음) | C7, BR2.2 |
| **시나리오 테스트 (Q1)** | **pytest-bdd** | 7.x | 기획서 시나리오를 한국어 `.feature`(Given/When/Then)로 적고 문장마다 작은 함수를 붙임. 모듈 담당이 문장을 먼저 쓰는 분업과 맞고 pytest·커버리지·CI를 그대로 씀 | 순수 pytest(문장이 코드 안에 묻힘), behave(러너가 둘) | 팀 실천 방식, Q1 |
| 단위 테스트·커버리지 | pytest, pytest-cov | 8.x / 5.x | 팀 실천 방식. 줄 커버리지 80% 하한 | — | NFR9 |
| 코드 모양(서버) | Ruff(포매터 + 린터) | 0.6대 | 팀 실천 방식: 도구 하나. `pyproject.toml`에 설정, 저장 시 자동 | Black + Ruff | team.md Code Style |
| 패키징·의존성 | `pyproject.toml` + `pip` + `venv`, 잠금은 `requirements.lock`(pip-tools 또는 uv export) | — | 표준이라 AI 도구·팀원 모두 익숙. `uv`를 쓰고 싶은 사람은 같은 `pyproject.toml`로 쓸 수 있음(선택) | poetry(별도 도구 학습) | NFR4.16 |
| 언어(화면) | TypeScript | 5.x | 부품 속성 오류를 저장 시 잡음. AI 도구 생성 품질 | JavaScript | 상세 화면 설계 |
| 화면 빌드 | Vite | 5.x | 빠르고 설정이 적음. 빌드 결과를 FastAPI가 정적 파일로 내보냄(한 덩어리) | CRA(유지 중단), Next.js(서버 렌더링 불필요) | U1 한 덩어리 실행 |
| 화면 라이브러리 | React | 18.x | 제약 | — | CON-01 |
| 부품 라이브러리·글꼴 | Ant Design 5, Pretendard | 5.2x | 상세 화면 설계 결정. 테마 토큰 한 곳(`src/theme/tokens.ts`, `src/config/brand.ts`) | MUI, Chakra | refined-mockups Q1 |
| 데이터 요청 | fetch + 작은 API 클라이언트 모듈(코드 생성에서 TanStack Query 채택 여부 결정) | — | 뼈대 요청이 3개뿐. 상태 캐시 라이브러리는 U5·U7에서 필요하면 | axios | C1 |
| 화면 테스트 | Vitest + React Testing Library | 2.x / 16.x | 팀 실천 방식 후보. Vite와 같은 설정 | Jest(설정 중복) | NFR9 |
| 코드 모양(화면) | ESLint + Prettier | 9.x / 3.x | 팀 실천 방식. 저장 시 자동 | — | team.md |
| 노드 | Node.js | 20 LTS | 장기 지원, Vite 5 요구 | 22(아직 LTS 초기) | — |
| 시각·시간대 | 파이썬 `zoneinfo`(Asia/Seoul), 화면 `Intl.DateTimeFormat` | 내장 | 추가 의존성 없이 시간대 처리(NFR12) | dayjs(필요 시 U5 일정에서) | NFR12 |
| 로그 | 파이썬 `logging` + JSON 한 줄 포매터 | 내장 | NFR10 형식. 외부 로그 서비스 없음 | structlog(추가 의존성) | NFR10.1 |
| CI | GitHub Actions(3.7에서 작성) | — | 팀 실천 방식(GitHub 연결만으로) | — | team.md Deployment |

## 2. 저장소 구조 (코드 생성의 기본 틀, 팀원 폴더 경계)

```
geosan/                 파이썬 패키지 (python -m geosan)
  config/               ConfigRegistry: 규칙 설정·앱 설정 읽기·검증·버전
  capability/           CapabilityCatalog: cap_ 모델·투입·조회
  opportunity/          OpportunityRegistry: opp_ 모델·투입·조회
  evidence/             EvidenceExtraction 최소형: ev_ 모델
  rules/                RuleEngine: 순수 계산 (유동렬)
  evaluation/           EvaluationLedger: eval_ 모델·스냅샷·저장
  questions/            ConfirmationDesk 최소형: q_ 모델
  records/              SalesRecords 최소형: rec_ 모델
  workflows/            WorkflowRunner: flow_evaluate.py (흐름 하나 = 파일 하나)
  commands/             OperatorCommands: 명령별 파일 (이강욱)
  api/                  WebApi: routes/opportunities.py, records.py, config.py, 공통 틀 (이강욱)
  storage/              DB 연결·세션·마이그레이션 실행 (이강욱)
migrations/             Alembic, <접두사>_<번호>_<설명>.py
contracts/              약속 파일 (openapi.json, *.schema.json) — PM 확인 뒤에만
examples/               case-apjeong.json, case-template.json, capability-geosan.json, rule-config.yaml, app-settings.yaml
tests/
  features/             .feature 시나리오 (S01…, 한국어)
  steps/                pytest-bdd 단계 함수
  unit/                 단위 테스트
web/                    Vite + React + TS (고선주)
  src/theme/ src/config/ src/labels/ src/pages/ src/components/
docs/                   team-start-guide.md, case-file-guide.md, 운영 안내서(U10)
```

폴더 경계가 곧 PR 경계다: 규칙(`rules/`) ↔ 저장소·API·명령(`storage/`, `api/`, `commands/`, 각 부품 모델) ↔ 화면(`web/`). 같이 고치는 곳은 `contracts/`(PM 확인)와 `web/src/labels/`(추가만).

## 3. 설정 분리 (NFR11)

| ID | 요구 |
|---|---|
| NFR11.1 | 규칙 기준점·확실도·감쇠·핵심 근거·조사 요건·배점·단계값·OTHER 정렬·쉬운 말 문구는 `rule-config.yaml`(버전·해시 기록)에, 담당자 목록·활성 묶음·브랜드(로고·강조색·demoLabel)·수집 범위·LLM 모드는 `app-settings.yaml`에 둔다. 코드에 수치를 적지 않는다 |
| NFR11.2 | 환경별로 다른 것(DB 경로, 비밀번호·API 키)은 환경 변수로만. `.env.example`은 두되 실제 `.env`는 커밋하지 않는다 |
| NFR11.3 | 설정이 없거나 틀리면 시작·명령을 거부하고 키와 이유를 보인다(BR7.6). 기본값으로 조용히 대체하지 않는다 |
| NFR11.4 | 화면의 테마·브랜드·대응표는 `web/src/theme`·`config`·`labels` 세 파일에서만 읽고 부품 코드에 색·글꼴·문구를 직접 적지 않는다 |
| NFR11.5 | 버전 고정: 파이썬·노드 의존성은 잠금 파일로, 언어·노드 버전은 `.python-version`·`.nvmrc`(또는 `engines`)로 적어 세 사람 컴퓨터와 CI가 같은 버전을 쓴다 |

## 4. 결정 기록 (ADR 요약)

- **ADR-U1-01 시나리오 러너 = pytest-bdd** (Q1 A). 맥락: 팀이 시나리오를 먼저 쓰고, 모듈 담당이 자기 시나리오를 쓴다. 결정: 한국어 .feature + pytest. 결과: 문장과 코드가 분리돼 비전공자가 문장을 고칠 수 있음(+), 단계 함수 작성이 한 단계 더 생김(−). 대안: 순수 pytest, behave. 상태: 채택(기업 승인과 무관한 팀 내부 결정).
- **ADR-U1-02 마이그레이션 = Alembic** (Q2 A). 맥락: 접두사별 파일·머리 합치기·되돌리기 요구(C6, NFR7.6). 결정: Alembic을 `geosan init-db`·`db merge-heads`로 감쌈. 결과: downgrade 가능(+), 팀원이 Alembic 파일 형식을 익혀야 함(−, AI 도구가 생성). 대안: create-all, 자체 SQL. 상태: 채택.
- 그 밖의 항목은 제약·상위 설계에서 온 것이라 새 결정이 아니다. 코드 생성에서 확정할 남은 선택: 명령줄 라이브러리(Typer/argparse), JSON 줄 번호 보조 로더 방식, 화면 데이터 요청 라이브러리 채택 여부.

## 상류 문서와의 연결

- 요구사항 4장 제약(CON-01·02), NFR9·NFR11·NFR12, 미결 사항(러너·화면 테스트 러너·부품 라이브러리 → 여기서 확정).
- 팀 실천 방식 team.md(Testing Posture 도구, Code Style, Deployment), 상세 화면 설계 `design-system-mapping.md`(토큰 파일 위치).
- 계약 C6(마이그레이션 규칙), C7(위치 정보 로더), C8(명령·`python -m`), 작업 단위 U1 확장 지점 규칙(흐름 파일·경로 묶음 파일·상세 영역 부품).
