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
| 처음 설치·실행 | `geosan init-db` → `geosan check-config examples/rule-config.yaml examples/app-settings.yaml` → 아래 소스 이용 확인 2회 → `geosan serve`. 공장등록 조회를 끈 환경은 조회 소스 확인을 생략합니다. |
| 활성 거산 값 묶음 변경 | `geosan dataset-set COMPANY_CONFIRMED` → `geosan evaluate`. 선택 가능한 묶음은 `VIRTUAL_REVIEWED`, `BROCHURE`, `COMPANY_CONFIRMED`입니다. 인자 없이 `geosan check-config`를 실행하면 현재 묶음을 확인할 수 있습니다. |
| 소개서 전체 확인·재평가 | 활성 묶음이 `BROCHURE`일 때 `geosan review-set --all REVIEWED --by 거산 --basis "10/29 방문, 영업 담당자 전체 확인"`. 원본을 남기고 `COMPANY_CONFIRMED` 묶음을 만들어 검수 대기 값만 확인 완료로 바꾼 뒤, 활성 묶음 전환과 전체 재평가를 함께 저장합니다. 재평가 실패 시 모두 취소하며, 확인 묶음이 이미 있으면 덮어쓰지 않습니다. `--no-evaluate`를 붙이면 재평가는 생략하므로 이어서 `geosan evaluate`를 실행해야 목록이 채워집니다. |
| 개별 값 확인·재확인 | `geosan review-set <대상 종류> <ID> REVIEWED --by <검수자> --basis <확인 근거>`. 대상 종류는 `PROCESS`(공정), `CAPABILITY`(세부 역량), `QUALIFICATION`(자격), `FIELD`(실적·범위)이며 현재 활성 묶음의 값만 받습니다. 검수 완료 값을 다시 확인해야 하면 상태에 `RECHECK`를 넣습니다. 이력 저장과 전체 재평가를 함께 실행하며 검수자·근거에 연락처는 넣지 않습니다. |
| 가상 사례 투입·평가·확인 | `geosan check-config examples/rule-config.yaml examples/app-settings-virtual.yaml`(가상 묶음으로 바꿈; 기본 파일은 시연용 소개서 묶음) → `geosan import-capability examples/capability-geosan.json` → `geosan import-case examples/case-apjeong.json` → `geosan evaluate` → `geosan verify-case examples/case-apjeong.json` |
| 실제 기업 사례 파일 검사(저장 없음, DB 불필요) | `geosan check-case <파일.json>` |
| 월별 AI 사용량 확인 | `geosan cost` 또는 `geosan cost --month 2026-11`. 검색과 추출의 호출·토큰·확인된 비용·추정 비용·한도 계산 비용을 보여 줍니다. 미확정 비용이 있으면 종료 코드 2이며, 호출은 추정 비용을 더한 월 한도 안에서 계속할 수 있습니다. |
| 조사 안 된 사례 일괄 조사 | `geosan research`. 현재 묶음의 공개된 실제 신규 사례 가운데 홈페이지가 없는 회사와, 주소는 있는데 아직 조사가 안 된 회사(조사 날짜 없음·근거 0건)를 검색·본문 읽기·근거 추출·재평가합니다(#690). 주소가 있는 회사는 홈페이지를 다시 찾지 않고 그 주소로 읽습니다. `--missing-homepage`를 붙이면 홈페이지 없는 회사만, `--limit 5`로 최대 건수를 정하고, `--all`은 이미 조사된 회사도 다시 읽습니다. |
| 공공자료에서 새 후보 찾기 | 승인된 소스와 `ingestion.factoryCsvPath`·`aiPick`·외부 AI 설정을 준비한 뒤 `geosan ingest kicox-factory-csv --process ZINC_PLATING --region 충남`을 실행합니다. `--industry`, `--max`, `--rejudge`를 선택할 수 있습니다. 파일명 끝 또는 바로 위 폴더의 기준일(YYYYMMDD)을 읽고, 선택한 새 회사만 등록·재평가·조사합니다. |
| 공공 소스 이용·저장 확인 | `geosan source-confirm <소스ID> --by <담당자 키> [--terms <약관 주소>] [--on YYYY-MM-DD]`. 소스는 `kicox-factory-csv`(공장현황 파일)·`kicox-production-api`(공장등록 조회)·`factoryon-xlsx`(팩토리온 공장조회)·`nier-water-csv`(수질 명단) 네 개이고, 뒤 두 개는 약관 주소 기본값이 없어 `--terms`를 꼭 넣습니다. 이름·허용 용도·저장 범위와 확인자·확인일을 기록합니다. 기존 기록은 덮어쓰지 않습니다. |
| 목록 회사에 공장 정보·수질 명단 붙이기 | `geosan source-load factoryon-xlsx <지역별 .xlsx>...` 또는 `geosan source-load nier-water-csv <수질 명단 .csv>`. 파일 이름에 기준일(YYYYMMDD)이 있어야 하고, 넣은 뒤 목록 회사에 원자재·종업원 수(추정)·공장 규모와 표면처리 표시를 다시 붙입니다. AI 비용 없음(#573). Numbers 파일은 CSV로 내보내 넣습니다. |
| 미확정 AI 사용 기록 정리(선택) | `geosan transfer-unblock`은 조회만 합니다. 필요할 때 제공사에서 기록별 사용량을 확인해 정산하면 추정 대신 실제 비용을 씁니다. 필요한 계정·서버 권한과 실행 순서는 [사용량 정산 안내](docs/transfer-unblock-guide.md)를 따릅니다. 기존 DB는 먼저 백업 후 `geosan init-db`로 갱신합니다. |
| 약속 파일 생성(사람이 명시적으로만) | `geosan export-contracts` |
| 시연 자료 출력(예비 경로, DB·화면 불필요) | `geosan demo-report --capability examples/capability-geosan-brochure.json --cases <사례 폴더> --out <결과 폴더> [--base-date 2026-10-27]` (실제 기업은 소개서 묶음 파일, A정밀 가상 사례는 `examples/capability-geosan.json`) → 순위표(`ranking.csv`·`ranking.html`), 기업별 근거(`companies/`), 사실표(`facts/`). 모든 파일 머리에 "시연용 초안·거산 확인 전" |
| 마이그레이션 머리 합치기 | `geosan db merge-heads` |
| 백업·되돌리기 | `geosan backup [--to <폴더>]`(서버 켜진 채로 가능, 기본 `backups/`) → 문제가 생기면 서버를 멈추고 `geosan restore <백업 파일>`(확인 질문 1회, 지금 DB는 자동 보관) → `geosan init-db` → `geosan serve`. 절차는 [백업·되돌리기 한 쪽](docs/backup-restore-guide.md) |

**처음 설치할 때 소스 이용 확인(#489)** — `init-db`·`check-config` 다음, `serve` 전에 운영자가 자료의 이용·저장 조건을 확인하고 아래 명령을 실행합니다.

```bash
geosan source-confirm kicox-factory-csv --by choi-pm
geosan source-confirm kicox-production-api --by choi-pm
```

`--by`에는 설정에 등록된 기록 담당자 키를 넣습니다. 보기 전용·모르는 담당자는 거부합니다.
`--on`을 생략하면 서울 기준 오늘이며, 미래 날짜는 거부합니다. 공장등록 조회를 끈 환경에서는 두 번째 명령을 생략합니다.
약관 주소 기본값은 [공장현황 파일 자료 페이지](https://www.data.go.kr/data/15105482/fileData.do)와 [공장등록 조회 자료 페이지](https://www.data.go.kr/data/15087611/openapi.do)입니다. 두 자료 모두 이용허락범위 제한 없음으로 PM이 확인했습니다(2026-11-09, #489). 다른 확인 주소는 `--terms`로 지정합니다.
`init-db`와 마찬가지로 실제 DB 볼륨이 붙은 실행 환경 안에서 실행해야 합니다. 다른 PC의 DB에 기록해도 서버 DB에는 반영되지 않습니다.
이 명령은 외부 사이트에 접속하거나 이용 조건을 자동으로 확인하지 않습니다. API 키도 필요하지 않습니다.

검수 전환은 거래 관계나 필수 요구의 확인 상태를 바꾸지 않습니다. 기존 점수 표시 약속에 따라
확인 묶음에서도 필수조건 확인 필요·운영 준비 중인 카드는 `--`로 보입니다.
묶음에 따른 ‘거산 확인 전’ 표시는 없어지지만 앱 설정의 고정 문구 `brand.demoLabel`은 그대로입니다.
기본 문구 ‘부분 시연·거산 확인 전’을 바꾸는 일은 PM이 운영 설정에서 따로 결정합니다.

홈페이지 검색 개발 경로는 `geosan.evidence.homepage.find_case_homepage(opp_id)`입니다.
`geosan init-db`로 DB를 갱신하고, 환경 변수 `OPENAI_API_KEY`를 설정한 뒤
앱 설정의 `llm.mode`를 `EXTERNAL`로 바꿔 `geosan check-config`로 등록하면 호출합니다.
예시 파일에는 허용 모델·단가·월 상한이 들어 있으며 기본 모드는 `NONE`입니다.
검색은 한국 시각 기준 하루 200회·월 1,000회와 월 비용 20달러를 호출 전에 검사합니다.
실제 비용은 응답의 사용량과 등록한 단가로 계산하므로 마지막 요청의 비용이 상한을 넘길 수 있습니다.
사용량을 받지 못한 호출이 있으면 후속 전송을 차단하며 제공사 사용량과 전송 기록을 확인해야 합니다.
HTTP 429는 한 번만 재시도하고 매번 횟수를 따로 셉니다.
본문 조사 내부 경로는 `geosan.workflows.flow_extract.run_extract(opp_id, url=None, pasted_text=None, requested_by="system")`입니다.
주소를 생략하면 고객의 저장된 홈페이지를 읽습니다. 본문을 붙여넣을 때도 공개 출처 주소가 필요합니다.
공개 신규 기회만 받고, 대표번호를 `mainPhone.allowedPrefixes`로 먼저 찾은 뒤 모든 연락처 패턴을 제거합니다.
홈페이지는 공개 IP만 접속하며 robots 제한·자동 수집 금지 표시·읽기 실패가 있으면 붙여넣기를 안내합니다.
페이지의 제한 표시를 검사하지만 별도 이용약관 문서의 법적 허용 여부를 자동 판정하지는 않습니다. 운영자는 해당 사이트의 이용 조건을 확인해야 합니다.
근거·질문·회사 요약과 재평가는 한 번에 저장하며, 실패하면 전부 되돌립니다. 실제 호출 비용은 별도로 남습니다.
재조사 전 근거는 이력으로 남기고, AI의 요구 후보는 PM 결정대로 ‘미확인 근거’로만 저장합니다.
`geosan research`는 `homepageDiscovery.autoResearch: true`와 외부 AI 설정을 등록한 뒤 실행합니다.
가상 사례·내부 자료·재접촉·다른 묶음은 대상에서 제외합니다. 기존 주소는 보존하고 그 주소로 추출합니다.
검색부터 저장까지 한 사례의 전체 한도는 60초이며, 홈페이지를 못 찾으면 추출을 건너뜁니다.
사이트 읽기·AI 응답 실패는 그 회사만 실패로 두고 다음 사례로 이어 갑니다. 사용량이 없으면 추정 비용을 월 한도에 더하며, 호출·비용 한도와 설정 오류일 때는 전체를 멈추고 남은 건수를 알립니다.
회사별 새 근거 수·이번 호출 비용을 표시하며, 미확정 비용은 0원으로 확정하지 않습니다.
실행 실패가 있으면 종료 코드 2, 잘못된 옵션·자동 조사 꺼짐은 1입니다. 못 찾음은 별도 집계합니다.
`geosan import-case <file.json>`도 저장을 마친 뒤 같은 설정에 따라 **투입한 한 곳만** 바로 조사합니다.
자동 조사가 꺼져 있거나 가상·비공개·재접촉·다른 묶음이면 저장만 합니다(종료 코드 0).
재투입도 한 번 조사하며 저장된 홈페이지 주소를 재사용합니다. 이전 근거·평가 이력은 보존합니다.
조사가 실패하면 사례 저장은 유지하고 실패 이유와 종료 코드 2를 알립니다. 파일을 다시 넣을 필요는 없습니다.
홈페이지를 못 찾은 경우에는 저장을 유지하고 추출·재평가를 건너뛰었다고 알립니다(종료 코드 0).
`POST /homepage` 화면 연결과 U3 수집 직후의 자동 시작은 별도 작업입니다.
화면 API 담당자는 `FlowResult.ok`와 PM이 확정한 `counts`(근거 전체·요구 후보·질문 수)로 성공을 표시해야 합니다.

뼈대 기본 틀(Part A) 시점에는 명령 이름만 등록되어 있고 본문은 "아직 구현되지 않았습니다(담당, Step)"를 내고 종료 코드 2로 끝납니다.
서버는 기본 `127.0.0.1:8000`에서 듣습니다. 배포할 때만 `--host 0.0.0.0 --port <포트>`를 지정합니다. 환경 변수는 `GEOSAN_DB_PATH`(기본 `./data/geosan.db`)와 접속 보호용 `GEOSAN_PASSWORD`이며 `.env.example`을 참고합니다.

로컬 예비 통합 빌드는 `python scripts/build.py`로 실행합니다. 잠금 파일대로 화면 의존성을 설치하고 `VITE_USE_FIXTURES=0`으로 빌드하며, 실패하면 중단합니다. 성공하면 기존 `geosan serve`가 화면과 API를 함께 제공합니다.

### Vercel + Railway 배포 준비 (#213, PM 2026-11-03 결정)

현재는 배포 준비 단계이며 로그인 서버 PR #225는 반영됐습니다. PM 계정 연결·Railway 주소 발급 뒤 실제 배포를 검증합니다. `GEOSAN_PASSWORD`만 설정하지 말고 아래 접속 보호 설정도 등록해야 합니다. 기존 `scripts/build.py`는 로컬 통합 실행·예비용으로 유지합니다.

- Railway: 저장소 루트, 배포 가지 `main`, 서비스 1개와 영구 볼륨 `/data`. 환경 변수 `GEOSAN_DB_PATH=/data/geosan.db`, `GEOSAN_PASSWORD`, `OPENAI_API_KEY`는 서비스 설정에만 넣습니다. `PORT`는 Railway가 제공하며 `railway.json`의 시작 명령이 `--port`로 전달합니다. 로컬 `geosan serve`는 `PORT`를 자동으로 읽지 않습니다.
- Python 의존성 설치는 저장소 루트에서 `pip install -r requirements.lock -e .`를 사용합니다. 화면 빌드는 Railway에서 필요하지 않습니다.
- 첫 실행·갱신 시에는 **볼륨이 마운트된 실행 환경 안에서** `geosan init-db`를 실행합니다. 이미 있는 DB에는 필요한 마이그레이션만 적용합니다. 볼륨이 없는 빌드 단계에서 실행하지 않습니다. 기존 DB 갱신 전에는 같은 자리에서 `geosan backup --to /data/backups`로 백업합니다([백업·되돌리기 한 쪽](docs/backup-restore-guide.md), #214).
- 이후 `geosan check-config examples/rule-config.yaml examples/app-settings.yaml`로 설정을 등록합니다. 공개 배포 전 운영용 앱 설정의 `accessProtection.enabled`를 켜고 검증해야 합니다. 실제 사례 투입·평가는 PM과 확인한 뒤 별도로 진행합니다.
- Vercel: Root Directory `web`, 배포 가지 `main`, 설치 `npm ci`, 빌드 `npm run build`, 출력 `dist`, 환경 변수 `VITE_USE_FIXTURES=0`. 서버 비밀번호·API 키를 Vercel의 `VITE_` 변수에 넣지 않습니다.

Railway 공개 HTTPS 주소는 아직 없습니다. 사용자 확인대로 실제 `web/vercel.json`은 주소가 나온 뒤 다음 예시의 `RAILWAY_HOST`를 바꾸어 추가합니다. 이 예시를 그대로 배포하지 않습니다. API 규칙을 먼저 두고, 화면 경로 fallback에서 API를 제외해 API 오류가 HTML 성공 응답으로 바뀌지 않도록 합니다.

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://RAILWAY_HOST/api/:path*" },
    { "source": "/((?!api(?:/|$)).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [{ "key": "x-vercel-enable-rewrite-caching", "value": "0" }]
    }
  ]
}
```

API 서버도 성공·오류 응답 모두에 `Cache-Control: no-store`와 `x-vercel-enable-rewrite-caching: 0`을 보냅니다. 실제 연결 후 로그인 쿠키·상세 주소 직접 열기·메모 저장 직후 새로고침 반영·재배포 후 DB 보존을 확인합니다. PR 미리보기가 운영 DB에 기록을 쓰지 않도록 연결 대상을 PM과 확인합니다.

공식 안내: [Vercel 외부 응답 캐시](https://vercel.com/changelog/vercels-cdn-now-respects-cache-control-headers-from-external-origins-by-default), [Railway 시작 명령](https://docs.railway.com/deployments/start-command).
접속 보호(#213): `geosan init-db`로 세션 테이블을 준비한 뒤, 사용하는 앱 설정의 `accessProtection.enabled`를 `true`로 바꾸고 기존 `geosan check-config` 명령으로 등록합니다. 비밀번호는 서버 환경 변수 `GEOSAN_PASSWORD`에만 넣습니다. 환경 변수가 없거나 비어 있으면 로그인이 실패하며 API는 열리지 않습니다. `.env`는 자동으로 읽지 않습니다.

화면에서 공용 비밀번호를 입력하면 12시간짜리 `HttpOnly; Secure; SameSite=Lax` 쿠키가 발급됩니다. 보호가 켜진 환경은 HTTPS가 필요합니다. 로컬 HTTP 시연은 기존 끄기 설정을 사용합니다. API를 사용해도 세션 만료 시각은 연장되지 않습니다. 로그인 실패 횟수는 공용 비밀번호 전체에 대해 DB에서 세며 5회 실패하면 모두 30초 동안 기다립니다. 새로고침·서버 재시작으로 이 횟수를 초기화하지 않습니다. 실제 Vercel·Railway 연결은 별도 PR에서 진행합니다.

### 후보 찾기용 공장현황 원본 준비 (#213, PM 2026-11-06 추가)

후보 찾기는 Git에 없는 공개 CSV 원본도 필요합니다. GitHub 연결 배포만으로는 이 파일이 서버로 따라가지 않습니다. 서버 연결이 준비되면 공개 원본을 서버에서 직접 받거나, 아래와 같이 확인한 로컬 파일을 복사하는 방법을 정합니다. **실제 서버 업로드·읽기 확인은 아직 남아 있습니다.**

1. [공공데이터포털의 전국등록공장현황](https://www.data.go.kr/data/15105482/fileData.do)에서 기준일 **2025-12-31** 원본을 받습니다. 2026-11-07 확인 당시 내려받는 파일은 ZIP이며, 압축 안에서 `한국산업단지공단_전국등록공장현황_등록공장현황자료_20251231.csv`만 꺼냅니다. 함께 들어 있는 데이터 설명 CSV와 혼동하지 않습니다. 로컬에서는 `data/sources/kicox-factory-csv/20251231/` 아래에 둡니다. 엑셀로 열어 다시 저장하거나 글자 저장 방식(CP949)을 바꾸지 않습니다.
2. 원본은 **22,414,740바이트·자료 220,705행**입니다. 파일 지문(SHA-256)은 `7b939f05759887245f7dcb59a63aa40c83f87a5f0f187e46103c233d6c1453f3`입니다. PowerShell에서는 아래 명령으로 확인합니다. 값이 다르면 덮어쓰거나 그대로 수집에 쓰지 말고 PM에게 기준 파일을 확인합니다.

   ```powershell
   $sourceFile = 'data/sources/kicox-factory-csv/20251231/한국산업단지공단_전국등록공장현황_등록공장현황자료_20251231.csv'
   (Get-Item -LiteralPath $sourceFile).Length
   Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256
   ```

3. 서버에서는 DB와 같은 **영구 볼륨 `/data`** 안의 `/data/sources/kicox-factory-csv/20251231/`에 원본을 둡니다. 저장소 기준 `./data/`나 빌드 작업 폴더에만 두면 영구 볼륨의 파일이 아닐 수 있습니다. 서버에 배치한 뒤에도 크기·지문과 실행 계정의 파일 읽기 권한을 확인하고, 재배포 후 같은 파일이 남는지 확인합니다.
4. 후보 찾기 설정이 반영된 버전(#221)에서 `ingestion.factoryCsvPath`가 **서버 볼륨 안 CSV의 전체 경로**를 가리키게 합니다. 이 설정 키와 예시 설정은 #221에서 반영하므로 먼저 임의로 추가하지 않습니다. 산단공 조회 키 `DATA_GO_KR_SERVICE_KEY`도 서버 환경변수에만 넣고, 화면의 `VITE_` 변수·이슈·저장소에는 넣지 않습니다.
5. CSV와 DB는 Git에 올리지 않습니다. 다시 받을 수 있는 공개 CSV는 백업 대상에서 제외하고, DB 백업은 #214 절차를 따릅니다. 원본 배치 확인을 위해 전체 후보 찾기나 유료 AI 호출을 실행하지 않습니다.

단지 조회 설정은 `ingestion.complexList`에 둡니다(#390, PM 결정 #393).
`enabled` 기본값은 `false`, `cacheDays`는 `15`(PM 결정 #405, 처음 7에서 올림), `extraNames`는 빈 목록입니다.
운영자가 값을 바꾸면 위의 `geosan check-config`로 등록합니다. 예전 설정에서 이 칸을
생략해도 같은 기본값을 씁니다. 단지 조회 내부 함수는 실제 HTTPS 호출·쪽 넘김·주소로 지역
거르기·파일 원문 우선 결합까지 연결돼 있습니다(#404). 실행 중 회차와 소스 이용 확인이
필요하며, 요청·재시도마다 하루 1,000회 한도를 검사합니다. 실패하면 받은 데까지의 행과
미완료 사유를 돌려주므로 호출자는 회차 요약에 이 사유를 반영해야 합니다.
조회 키는 실행 프로세스의 `DATA_GO_KR_SERVICE_KEY` 환경변수로 전달합니다. `.env`는
자동으로 읽지 않으며, 키를 설정 파일이나 저장소에 넣지 않습니다.
**조회 결과의 15일 보관·재사용도 내부 함수에 연결돼 있습니다(#437).** 파일 행을 먼저
저장한 뒤 `collect_complex_rows` → `store_complex_rows` 순서로 부릅니다. 모든 지역의 공개
행과 조회별 행 번호를 보관하고, 돌려줄 때만 이번 회차의 선택 지역으로 거릅니다.
같은 단지의 성공 기록이 보관 기간 안에 있으면 외부 요청 없이 재사용합니다. 성공한 빈 결과도
재사용하지만 일부 실패·만료·행 번호 누락은 다시 조회합니다. 같은 회사는 파일 원문을 우선하며,
재사용할 때 보관 기간을 늘리지 않습니다. 보관 일수는 위 `cacheDays` 설정을 따릅니다.
화면의 [찾기]·전체 실행 연결도 후속 작업입니다.

AI 후보 판단 내부 연결은 `ingestion.aiPick`에서 설정합니다(#425). 기본은 꺼짐(`enabled: false`),
한 번에 100행(`rowsPerCall`), 지시문은 저장소 기준 `examples/prompts/candidate-pick.md`
(`promptFile`)입니다. PM이 승인한 지시문을 바꿀 때는 파일의 버전·날짜도 함께 바꿉니다.
`surfaceTreatmentIndustryNames`는 PM이 정할 업종명 규칙 목록이며 아직 빈 목록입니다.
실제 호출에는 기존 `llm.mode: EXTERNAL`·허용 모델·단가·월 한도와 실행 프로세스의
`OPENAI_API_KEY`가 필요합니다. 설정 변경은 기존 `geosan check-config`로 등록합니다.
`pick_candidates`는 행 번호만 받고 공개 본문을 직접 읽습니다. 전체 공정·산업으로 한 번
판단하므로 선택 조건만 바꾸면 다시 부르지 않고, 생산품·업종명 또는 지시문·허용 목록·입력
칸이 바뀌면 다시 판단합니다. 사용량을 모르는 호출은 기존 비용 정리 절차 전까지 다음 호출을
막습니다. 전체 실행·회사 등록은 #427·#426에서 이어가며, 500행 실측과 전체 파일 AI 호출은
PM의 표본·비용 결정 뒤에 진행합니다.

## 3. 검사 (PR 전에 꼭)

목록의 산업군 선택지는 앱 설정의 `industries` 순서로 표시합니다. 사례 파일의
`customer.industries`에는 이 목록 안의 값을 최대 3개 적습니다. 생략하면 미확정입니다.
기존 DB는 `geosan init-db`로 산업군 보관 열을 추가한 뒤, 사용하는 앱 설정 파일에
`industries`를 넣고 위의 `geosan check-config` 명령으로 반영합니다. `check-case`는
DB 없이 기본 `examples/app-settings.yaml`의 선택지로 검사하며, 실제 투입은 DB에 반영한
앱 설정으로 다시 검사합니다.

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

**먼저 볼 곳: [`docs/map/`](docs/map/README.md)** — 지금 기준의 전체 기획과 현황을 그림과 쉬운 말로 정리한 지도입니다(기능 지도 · 구조 지도 · 기획 변경 기록). 아래 설계 문서는 그 지도의 근거 자료입니다.

`aidlc/spaces/default/intents/261019-geosan-sales-agent/` 아래에 있습니다. 구현 전에 자기 모듈의 기능 설계(`construction/u1-skeleton/functional-design/`의 `rules.md`·`entities.md`·`functional-spec.md`)와 계약(`inception/contract-design/contract-summary.md`)을 읽습니다. 코드 생성 계획과 단위 테스트 지침은 `construction/u1-skeleton/code-generation/`에 있습니다.

## 6. 회사 좌표와 거리 (#222)

`geosan geocode --missing-only`는 활성 묶음의 공개 실제 회사를 대상으로 이미 저장된 좌표를 재사용합니다. 대상은 목록과 같이 최신 확정 평가의 묶음으로 고릅니다(회사 원본 표시가 소개서로 남아 있어도 포함, #664).
없는 좌표는 **위치 CSV → 행안부 주소검색 후 같은 CSV 대조 → 좌표제공 API → 네이버 Geocoding** 순서로 확인합니다.
가상·비공개·연락처가 섞인 주소는 외부에 보내지 않습니다. 다른 건물·복수 위치·빈 좌표는 임의로 확정하지 않습니다.

- 앱 설정 `geocoding.locationCsvFiles`에 위치정보요약DB CSV 파일 목록, `locationCsvBaseDate`에 자료 기준일을 넣습니다. 상대 경로는 프로그램을 실행하는 폴더 기준입니다.
- `geosan serve`는 좌표 조회가 켜져 있으면 시작할 때 위치 CSV를 미리 읽습니다(대전·세종·충남 3개 기준 10초 남짓). 파일이 없으면 경고를 보이고 서버는 띄웁니다(#664).
- 외부 조회는 `geocoding.enabled`로 켜며 `dailyCallLimit`의 초기값은 10,000회입니다. 행안부·네이버·재시도를 모두 합산합니다. 조회 오류는 미확인과 구분해 실패로 보고합니다.
- 행안부 키는 `JUSO_SEARCH_KEY`·`JUSO_COORD_KEY` 환경변수에만 둡니다. 좌표계 변환과 거리 계산에는 별도 API가 필요 없습니다.
- 네이버는 `naverFallbackEnabled`와 서버 환경변수 `NCP_MAPS_KEY_ID`·`NCP_MAPS_KEY`가 준비됐을 때 사용합니다. 받은 결과는 해당 요청의 실시간 지도·거리 표시용이며 DB·파일·공용 캐시에 저장하지 않습니다. 명령의 실시간 확인 건수도 저장 건수와 구분됩니다.
- 거산 기준 주소·위도·경도는 `geosan.address`·`lat`·`lng`입니다. 기준 좌표가 없으면 거리 값은 비어 있습니다. 회사 좌표가 있어도 점수와 기본 추천 순위는 바뀌지 않습니다.

공공좌표는 DB에 출처·확인시각과 함께 저장하며 카드·상세 응답의 `distanceKm`에서 직선거리를 제공합니다.
키 교체는 서버 환경변수만 바꾸고 서버를 다시 실행합니다. 브라우저 사용자마다 등록하지 않습니다.
API 서버와 지도 화면은 별도 작업이며, 가까운 순·거리 필터 화면 및 대시보드 지도는 해당 담당 작업에서 연결합니다.

목록 서버는 `sort=distance`(가까운 순)와 `maxDistanceKm`(설정 `distanceFilterPresetsKm` 안의 값)을 지원합니다(#658).
기존 조건을 통과한 전체 회사의 거리를 확인한 뒤 거리 조건·정렬을 적용하고 페이지를 나눕니다.
거리 미확인은 가까운 순의 마지막에 두고, 거리 범위를 고르면 제외합니다. 같은 거리는 기존 추천 순입니다.
네이버 보완 결과와 그에 따른 목록은 요청 안에서만 쓰며 캐시하지 않습니다. 거리 조건의 엑셀 내보내기는 지원하지 않습니다.
기준 좌표가 없으면 거리 정렬·필터는 오류로 알리고, 기존 추천 목록은 계속 열립니다.

지도 데이터는 `GET /api/v1/dashboard/map`에서 읽습니다(#642). 기존 접속 보호를 거치며, 관심 켠 실제 공개 회사 가운데 관심·진행·올해 성공만 포함합니다. 거산 기준점·설정 반경·점·거리·좌표 없는 회사 수를 반환하고, 네이버 실시간 결과가 남지 않도록 응답을 캐시하지 않습니다. 거산 기준 좌표가 없으면 오류로 알립니다. 지도 그림은 #641 화면 작업에서 연결합니다.

대시보드 지도 바탕은 네이버 지도입니다(#671). `web/.env`에 `VITE_NCP_MAPS_CLIENT_ID=<Client ID>`를 적고 `npm --prefix web run build`로 화면을 다시 만듭니다. 네이버 클라우드 콘솔의 Maps 애플리케이션에서 **Dynamic Map**을 켜고 **Web 서비스 URL**에 접속 주소(예: `http://127.0.0.1:8000`)를 등록해야 합니다. 키가 없거나 인증에 실패하면 원과 점의 상대 위치만 보이는 자리표시로 돌아갑니다. 지도에는 좌표·원 반지름만 넘기고 회사 이름·단계·거리는 우리 말풍선으로만 그립니다.
