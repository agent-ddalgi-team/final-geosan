# 시연·거산 환경 호스팅 결정 — 화면은 Vercel, 서버는 Railway (2026-11-03)

> 상태: **PM 결정(2026-11-03).** #23의 "11/4까지 호스팅 결정"을 하루 앞당겨 정했다. 이 문서는 결정 내용, 왜 두 곳으로 나누는지, #213(이강욱)에서 무엇이 달라지는지, 비용과 조건 확인 결과를 적는다. 인프라 설계서(`construction/u1-skeleton/infrastructure-design/infrastructure-specification.md`) 4장의 "호스팅 서비스: 미정"을 이 문서가 채운다. 설계서 본문은 다음 AI-DLC 게이트에서 갱신한다.

## 0. 한 줄 결론

- **화면(React 빌드)은 Vercel, 서버(FastAPI + SQLite)는 Railway.** 둘 다 GitHub 저장소를 연결하면 `main`에 합칠 때 자동으로 올라간다(팀 실천 방식 Deployment "GitHub 연결만으로").
- 화면이 서버를 부르는 길은 **Vercel의 주소 바꿔 보내기(rewrite)** 로 `/api/*`를 Railway 주소로 넘긴다. 브라우저 입장에서는 같은 주소라 **CORS 설정도, 쿠키 설정 변경도 필요 없고, 화면 코드(`API_BASE = '/api/v1'`)는 그대로**다.
- SQLite 파일은 Railway **볼륨(지워지지 않는 디스크)** 에 두고 `GEOSAN_DB_PATH`를 그 경로로 준다. 볼륨 없이 올리면 다시 배포할 때마다 DB가 사라진다.
- 비용 어림: Railway Hobby 월 $5(사용량 $5 포함) + 볼륨 1GB 미만 $0.15 ≈ **월 7,000원대**. Vercel Hobby는 무료. 12/11 뒤 둘 다 삭제하면 비용이 멈춘다(CON-15).

## 1. 조건 대조 (#23 완료 기준)

| 조건(#23) | Vercel(화면) | Railway(서버) |
|---|---|---|
| GitHub 연결만으로 자동 배포 | 됨. 저장소 연결 후 Root Directory `web`, production branch `main` | 됨. 저장소 연결 후 Root Directory 저장소 루트, deploy branch `main` |
| SQLite 영구 저장 | 해당 없음(화면만) | 볼륨을 서비스에 붙이고 마운트 경로(예 `/data`)를 `GEOSAN_DB_PATH=/data/geosan.db`로 |
| HTTPS | 기본 제공 | 기본 제공(`*.up.railway.app`) |
| 무료~월 수천 원 | Hobby 무료 | Hobby $5/월(사용량 $5 포함), 볼륨 $0.15/GB/월 |
| 12/11 뒤 비용 중단 | 프로젝트 삭제 | 프로젝트 삭제(볼륨 포함) |

## 2. 왜 두 곳으로 나누나 (한 덩어리 배포와 비교)

| | 한 덩어리(FastAPI가 화면 파일까지 제공, 11/3 전 설계) | 화면 Vercel + 서버 Railway(결정) |
|---|---|---|
| 배포 설정 | 한 곳 | 두 곳(각각 GitHub 연결) |
| 화면만 고쳤을 때 | 서버까지 다시 빌드·재시작 | Vercel만 다시 빌드(서버 무정지) |
| 고선주 화면 작업 확인 | 로컬에서만 | PR마다 Vercel 미리보기 주소가 자동으로 생겨 PM·고선주가 바로 봄 |
| 기존 작업(#213 빌드 스크립트) | 그대로 씀 | 로컬 한 덩어리 실행·예비용으로 남김. 버리지 않음 |
| 주의점 | 없음 | 아래 3장 두 가지(rewrite 캐시, 볼륨) |

PM이 Vercel·Railway를 고른 이유: 비전공 팀이 가장 많이 쓰는 조합이라 막혔을 때 찾을 자료가 많고, 화면과 서버를 따로 올려 서로 영향을 안 준다.

## 3. #213(이강욱)에서 달라지는 것

1. **`web/vercel.json` 추가** (화면 담당 폴더 `web/` 안): `/api/:path*` → `https://<railway 주소>/api/:path*` rewrite 한 줄 + 상세 주소(`/opportunities/…`)를 직접 열어도 `index.html`을 주는 fallback 한 줄. Railway 주소는 비밀이 아니므로 파일에 적어도 된다.
2. **rewrite 캐시 끄기(중요)**: Vercel은 2026-04-06부터 외부 rewrite 응답을 기본으로 캐시한다. API 응답이 캐시되면 메모를 저장했는데 옛 목록이 보이는 문제가 난다. FastAPI 응답에 `Cache-Control: no-store`를 붙이고, Vercel 쪽 끄기 헤더(`x-vercel-enable-rewrite-caching: 0`)도 함께 붙인다. 완료 기준에 "메모 저장 직후 목록 새로고침에 반영" 확인을 넣는다.
3. **Railway 서비스 1개**: 시작 명령 `geosan serve --host 0.0.0.0 --port $PORT`(serve가 PORT 환경 변수를 못 읽으면 옵션 추가), 볼륨 마운트 `/data`, 환경 변수 `GEOSAN_DB_PATH`·`GEOSAN_PASSWORD`·`OPENAI_API_KEY`(결정 B로 네이버 키 없음. 키 값은 PM이 1:1로 전달, 이슈·파일에 안 적음). 처음 올릴 때 `geosan init-db`·마이그레이션을 한 번 돌리는 절차를 README에 적는다.
4. **설정 파일**: Railway는 Python 프로젝트를 자동 감지하지만, 시작 명령을 저장소에 두려면 `railway.json` 또는 `Procfile` 한 줄. 어느 쪽이든 저장소 루트 파일 하나.
5. **접속 보호 흐름은 그대로**: rewrite 덕분에 쿠키가 같은 주소에서 오가므로 세션 쿠키 설정(SameSite 등)을 바꾸지 않는다. 다만 접속 보호는 **서버(API) 쪽에서 막아야** 한다. Vercel에 올라간 화면 파일 자체는 누구나 받을 수 있고, 데이터는 API를 통해서만 나오므로 그것으로 충분하다.
6. **한 덩어리 빌드(`scripts/build.py`)는 유지**: 로컬 실행·시연 예비 경로. 시연 환경 배포 단계에서는 쓰지 않는다.
7. **백업(#214, PM)**: DB가 Railway 볼륨에 있으므로 `backup` 명령은 서버 안에서 돌리고(`railway run`/SSH), 결과 파일을 내려받는 절차를 적는다.

작업 시간 영향: 한 덩어리 배포 대비 **+2시간**(vercel.json·캐시 헤더·두 곳 연결). #213 어림 20h → 22h.

## 4. 확인해야 할 조건 한 가지

Vercel Hobby 요금제는 "비상업적 개인 용도"만 허용한다. 이 프로그램은 돈을 받지 않는 과제 산출물이지만 거산이 업무에 쓰므로 Vercel이 상업 사용으로 볼 여지가 있다. **1차(11/15 전달·12/11 발표)까지는 Hobby로 올리고, 거산이 계속 쓰기로 하면 Pro(월 $20)로 올리거나 화면도 Railway의 두 번째 서비스로 옮긴다.** 화면 코드는 어느 쪽이든 바뀌지 않는다.

## 5. 2차에 미루는 것

- 커스텀 도메인(거산용 주소): 거산이 원할 때.
- Railway Pro·Vercel Pro 전환: 위 4장 조건이 생길 때.

<details><summary>기술 메모 (출처)</summary>

- Railway 요금: Trial 1회 $5 크레딧, Hobby $5/월(사용량 $5 포함), 볼륨 $0.15/GB/월 — docs.railway.com/pricing/plans (2026-11-03 검색 결과, 공식 페이지에서 재확인 권장)
- Vercel Hobby 비상업 조건 — vercel.com/docs/limits/fair-use-guidelines
- Vercel 외부 rewrite 예시(`"source": "/api/:path*", "destination": "https://api.example.com/:path*"`)와 2026-04-06 이후 캐시 기본 켜짐·끄기 헤더 `x-vercel-enable-rewrite-caching: 0` — vercel.com/docs/rewrites
- 현재 코드: `web/src/api/client.ts` `API_BASE = '/api/v1'`(상대 주소), `web/vite.config.ts` 개발용 proxy, `geosan/api/app.py` `ScreenFiles` 정적 제공(한 덩어리), `geosan/storage/engine.py` `GEOSAN_DB_PATH`.
</details>
