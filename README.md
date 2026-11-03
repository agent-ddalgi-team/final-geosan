# final-geosan — 거산케미칼 AI 영업지원 에이전트 2차 (잠재고객 추천)

AI-DLC로 만드는 거산케미칼 영업지원 도구입니다. 한 덩어리(FastAPI + React 정적 파일 + SQLite)로 돌며,
가상 사례 1건(A정밀)이 파일 투입 → 필수조건 필터 → 점수 → 분류 → 추천 목록·근거 상세 → 담당자 의견 저장까지
이어지는 뼈대(U1)를 먼저 만듭니다. 팀 공통 규칙은 `AGENTS.md`, 팀원 시작 절차는 `docs/team-start-guide.md`입니다.

> 이 저장소의 가상 데이터(A정밀 사례, 가상 검수 역량 파일)는 모두 **가상·거산 실제 사양 아님**입니다.

## 1. 설치 (한 번만)

파이썬 3.12와 Node.js 20이 필요합니다(`.python-version`, `web/.nvmrc`). 세 사람 컴퓨터와 CI가 같은 잠금 파일을 씁니다.

```bash
# 파이썬: 가상환경을 만들고 잠금 파일대로 설치한다 (uv가 있으면 uv venv / uv pip install 로 해도 같다)
python3.12 -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1 (막히면 docs/team-start-guide.md 2-1장)
pip install -r requirements.lock -e .

# 화면
cd web && npm ci && cd ..
```

아래 명령은 모두 `.venv`가 활성화되어 `python`이 3.12 가상환경을 가리킨다는 전제입니다(활성화하지 않으면 `.venv/bin/python -m …`).

## 2. 명령 (운영 안내서의 기준, 계약 C8)

`geosan <명령>` 또는 `python -m geosan <명령>`. 모든 명령은 끝에 쉬운 한국어 요약 한 줄과 종료 코드(0 성공, 1 입력 오류, 2 실행 실패)를 냅니다. `--help`는 한국어입니다.

| 할 일 | 명령 |
|---|---|
| 처음 설치·실행 | `geosan init-db` → `geosan check-config examples/rule-config.yaml examples/app-settings.yaml` → `geosan serve` |
| 활성 거산 값 묶음 변경 | `geosan dataset-set COMPANY_CONFIRMED` → `geosan evaluate`. 선택 가능한 묶음은 `VIRTUAL_REVIEWED`, `BROCHURE`, `COMPANY_CONFIRMED`입니다. 인자 없이 `geosan check-config`를 실행하면 현재 묶음을 확인할 수 있습니다. |
| 가상 사례 투입·평가·확인 | `geosan check-config examples/rule-config.yaml examples/app-settings-virtual.yaml`(가상 묶음으로 바꿈; 기본 파일은 시연용 소개서 묶음) → `geosan import-capability examples/capability-geosan.json` → `geosan import-case examples/case-apjeong.json` → `geosan evaluate` → `geosan verify-case examples/case-apjeong.json` |
| 실제 기업 사례 파일 검사(저장 없음, DB 불필요) | `geosan check-case <파일.json>` |
| 약속 파일 생성(사람이 명시적으로만) | `geosan export-contracts` |
| 시연 자료 출력(예비 경로, DB·화면 불필요) | `geosan demo-report --capability examples/capability-geosan-brochure.json --cases <사례 폴더> --out <결과 폴더> [--base-date 2026-10-27]` (실제 기업은 소개서 묶음 파일, A정밀 가상 사례는 `examples/capability-geosan.json`) → 순위표(`ranking.csv`·`ranking.html`), 기업별 근거(`companies/`), 사실표(`facts/`). 모든 파일 머리에 "시연용 초안·거산 확인 전" |
| 마이그레이션 머리 합치기 | `geosan db merge-heads` |

뼈대 기본 틀(Part A) 시점에는 명령 이름만 등록되어 있고 본문은 "아직 구현되지 않았습니다(담당, Step)"를 내고 종료 코드 2로 끝납니다.
서버는 `127.0.0.1:8000`만 듣습니다. 환경 변수는 `GEOSAN_DB_PATH`(기본 `./data/geosan.db`)와 접속 보호용 `GEOSAN_PASSWORD`이며 `.env.example`을 참고합니다.

접속 보호(#213): `geosan init-db`로 세션 테이블을 준비한 뒤, 사용하는 앱 설정의 `accessProtection.enabled`를 `true`로 바꾸고 기존 `geosan check-config` 명령으로 등록합니다. 비밀번호는 서버 환경 변수 `GEOSAN_PASSWORD`에만 넣습니다. 환경 변수가 없거나 비어 있으면 로그인이 실패하며 API는 열리지 않습니다. `.env`는 자동으로 읽지 않습니다.

화면에서 공용 비밀번호를 입력하면 12시간짜리 `HttpOnly; Secure; SameSite=Lax` 쿠키가 발급됩니다. 보호가 켜진 환경은 HTTPS가 필요합니다. 로컬 HTTP 시연은 기존 끄기 설정을 사용합니다. API를 사용해도 세션 만료 시각은 연장되지 않습니다. 로그인 실패 횟수는 공용 비밀번호 전체에 대해 DB에서 세며 5회 실패하면 모두 30초 동안 기다립니다. 새로고침·서버 재시작으로 이 횟수를 초기화하지 않습니다. 실제 Vercel·Railway 연결은 별도 PR에서 진행합니다.

## 3. 검사 (PR 전에 꼭)

```bash
bash scripts/check.sh            # 파이썬 + 화면 전부 (CI와 같은 순서)
bash scripts/check.sh python     # Ruff → 단위 테스트(커버리지 80% 하한) → 시나리오 → 뼈대 검증
bash scripts/check.sh web        # ESLint·Prettier → Vitest → tsc·Vite 빌드
```

윈도우(PowerShell)는 같은 검사를 파이썬판으로 돌립니다(단계·순서 동일):

```powershell
.venv\Scripts\python scripts\check.py            # 전부
.venv\Scripts\python scripts\check.py python     # 파이썬만
.venv\Scripts\python scripts\check.py web        # 화면만
```

낱개 명령(단위 테스트 지침 2장):

```bash
python -m pytest tests/unit/u1 -q                                   # 파이썬 단위 테스트만
python -m pytest tests/features/u1 tests/unit/u1 -q --cov=geosan --cov-report=term-missing --cov-fail-under=80
npm --prefix web test                                               # 화면 테스트
ruff format --check . && ruff check .                               # 파이썬 코드 모양
npm --prefix web run lint && npm --prefix web run format:check      # 화면 코드 모양
```

세 트랙(규칙 엔진·투입/API·화면)이 다 합쳐지기 전에는 시나리오 테스트와 뼈대 검증(`verify-case`)이 실패하는 것이 정상이며, CI에서도 그 두 단계만 실패를 허용합니다(Step 28에서 필수로 바꿈). 커버리지 80% 하한은 처음부터 적용되고 낮추지 않습니다.

## 4. 폴더와 경계 (누가 어디를 고치는가)

```
geosan/                 파이썬 패키지 (python -m geosan)
  config/               설정 읽기·검사기·오류 형식           ← PM 세션
  capability/           거산 역량 투입·조회 (cap_)           ← 이강욱
  opportunity/          고객·기회·요구·신호 (opp_)           ← 이강욱
  evidence/             근거 자료 최소형 (ev_)               ← 이강욱
  rules/                규칙 엔진 (순수 계산)                 ← 유동렬   ※ codes.py·models.py는 경계 파일
  evaluation/           평가 원장·스냅샷 (eval_)             ← 이강욱
  questions/            확인 질문 후보·조사 요건 (q_)         ← 이강욱
  records/              담당자 의견 (rec_)                   ← 이강욱
  workflows/            흐름 ⓪ flow_evaluate (한 흐름 = 한 트랜잭션) ← 이강욱   ※ models.py는 경계 파일
  commands/             운영 명령 9개 (Typer)                ← 이강욱
  api/                  FastAPI /api/v1                     ← 이강욱   ※ schemas.py는 경계 파일
  storage/              SQLite 연결·세션·마이그레이션 실행    ← PM 세션
migrations/             Alembic, <접두사>_<번호>_<설명>.py   ← PM 세션(첫 파일), 각 단위가 자기 접두사만 추가
contracts/              약속 파일 (openapi.json, *.schema.json) — PM 확인 뒤에만
examples/               예시 파일 5개 (사례·역량·규칙 설정·앱 설정·실제 기업 틀)
tests/                  features/(시나리오 .feature) · steps/ · unit/ · conftest.py · factories.py
web/                    Vite + React + TS + Ant Design       ← 고선주   ※ src/api/types.ts·client.ts·labels/ko.ts·theme·config는 경계(대응표는 추가만)
docs/                   team-start-guide.md · case-file-guide.md · work-orders/(작업 지시서 3개)
scripts/                check.sh · check-secrets.sh (맥·리눅스) · check.py (맥·윈도우 공통, 같은 단계)
```

- **경계 파일**(머리에 "경계 파일: 고치려면 PM에게 먼저 말한다")은 세 트랙이 고치지 않고 씁니다.
- 약속 파일(`contracts/`, `contract-summary.md`)에 없는 API 경로·응답 필드·명령·테이블·파일 항목은 만들지 말고 PM에게 먼저 묻습니다.
- 규칙 숫자(배점·기준점·단계값)는 코드에 적지 않고 `examples/rule-config.yaml`에서 읽습니다.
- 담당자 이름·이메일·전화 같은 연락처는 어디에도 저장하지 않습니다.

## 5. 설계 문서

`aidlc/spaces/default/intents/261019-geosan-sales-agent/` 아래에 있습니다. 구현 전에 자기 모듈의 기능 설계(`construction/u1-skeleton/functional-design/`의 `rules.md`·`entities.md`·`functional-spec.md`)와 계약(`inception/contract-design/contract-summary.md`)을 읽습니다. 코드 생성 계획과 단위 테스트 지침은 `construction/u1-skeleton/code-generation/`에 있습니다.
