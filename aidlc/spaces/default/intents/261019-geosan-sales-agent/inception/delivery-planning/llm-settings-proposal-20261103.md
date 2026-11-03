# 외부 AI(LLM)·네이버 검색 설정·약속 파일 추가 제안 — 결정 2·3 (2026-11-03)

> 상태: **PM "반영" 승인 2026-11-03, 같은 날 정정 2차 반영 완료.** 약속 파일(C1·C4·C7·C8·C9·5장)·범위 문서 P1-5·발표 메모·#23·#72 댓글에 반영했다. 설정 예시 파일·`.env.example`의 새 키는 모르는 키를 거부하는 검사(C7) 때문에 **U2 코드 PR에서 LlmSettings와 같이** 넣는다(1장이 그 PR의 사양). 순서는 팀 규칙대로 **약속 파일에 먼저 적고 → PR 체크리스트에 표시하고 → 코드(U2)를 만든다.** 아래는 모두 "더하는 변경"이고 깨는 변경은 없다(3장). `contracts/app-settings.schema.json`은 U2 코드에서 설정 모델을 고친 뒤 사람이 `geosan export-contracts`를 돌릴 때 갱신한다.
>
> **정정 기록**: 처음 초안(11/3 오전)은 ② 홈페이지 찾기를 OpenAI 웹 검색 도구로 적었다. PM 정정(11/3)으로 **네이버 검색 API(웹 문서)** 로 바꾸되, 네이버 검색 API 특약(2026-09-07 시행, 결과 저장·가공·AI 입력 금지)을 지키기 위해 "결과를 네이버 검색결과 그대로 보여 주고 담당자가 확정한 주소 하나만 저장"하는 방식으로 정했다. OpenAI는 근거 추출(③④)에만 쓴다.

## 0. 결정 요약 (출처: PM 메모 2026-11-03, 이슈 #23·#72)

| 항목 | 결정 | 확인한 근거 |
|---|---|---|
| 제공사 | 근거 추출(③④) = OpenAI API. 홈페이지 찾기(②) = 네이버 검색 API(웹 문서). 키는 2개 | #23 중간 결정 2026-10-24 + 11/3 정정 |
| 모델 | `gpt-6.1-sol` 확정. 비용 비교용으로 `gpt-6-luna`로 바꿀 수 있게 설정값 | OpenAI 가격표·모델 목록(2026-11-03 확인): Sol 입력 $2 / 캐시 $0.10 / 출력 $10, Luna $0.10 / $0.01 / $0.50 (100만 토큰당) |
| 단가 | 입력 100만 토큰당 $2, 출력 $10 | 가격표와 일치 |
| 월 비용 상한 | $20, **OpenAI에만**. 50%($10)에 알림. OpenAI 콘솔 사용 한도도 $20 | 콘솔 한도는 PM이 키 발급 때 설정 |
| 월 호출 상한 | OpenAI 1,000회. 네이버는 하루 25,000회 한도 안에서 하루 호출 상한(기본 500회)만 | 네이버 개발자센터 지역·웹문서 검색 문서(2026-11-03 확인): 하루 25,000회, display 최대 100 |
| 전송 보호 | OpenAI로는 공개 홈페이지 본문만(C4 EXTERNAL_AI). 네이버로는 회사명·주소만(C4 EXTERNAL_SEARCH, 11/3 추가) | C4는 제공사 이름 없이 용도로 묶여 있음. OpenAI API 입력은 기본적으로 학습에 안 쓰이고 남용 감시 기록 최대 30일 |
| 시험 | 처음 5곳으로 1곳당 토큰·비용을 재고 어림값과 다르면 쉬운 말로 보고 | 6장 |
| 결정 2 (정정 2차) | ①후보 수집 ②홈페이지 찾기 ③본문 읽기 ④근거 추출 전부 AI·도구가 먼저. 사람은 판단·확인·수정만. **②는 네이버가 찾아 결과를 그대로 보여 주고 담당자가 확정** | 네이버 검색 API 특약(2026-09-07) 2.1 결과 제공 목적만, 2.2 가공 금지, 2.3 저장·캐시·AI 입력 금지. 이 방식은 그 안에 있음. 구글 Custom Search는 신규 중단 |

## 1. 설정 예시 파일 `examples/app-settings.yaml` — `llm`·`naverSearch`·`homepageDiscovery` 칸 제안 (U2 코드 PR에서 넣음)

```yaml
# 외부 LLM (U2에서 쓴다, 근거 추출 ③④에만). U1은 NONE이며 외부 호출 코드가 없다.
# mode를 EXTERNAL로 바꾸면 전송 보호(C4)를 통과한 공개 본문만 OpenAI로 나간다. 키는 환경 변수 OPENAI_API_KEY로만 읽는다.
llm:
  mode: NONE                        # U2 합치기 전까지 NONE. 실제 호출은 EXTERNAL
  provider: OPENAI                  # 지금은 OPENAI 하나. 어댑터 뒤에 가둔다(C9)
  model: gpt-6.1-sol                # PM 결정 2026-11-03. 비용 비교는 gpt-6-luna로 바꿔서 돌린다
  allowedModels: [gpt-6.1-sol, gpt-6-luna]   # 오타 방지. model은 이 목록 안이어야 check-config 통과
  monthlyCallLimit: 1000            # 월 호출 상한(회). 넘으면 거부(C4 LLM_LIMIT). 재시도도 1회로 센다
  inputCostPerMillionTokens: 2.0    # 입력 100만 토큰당 달러 (gpt-6.1-sol, OpenAI 가격표 2026-11-03)
  outputCostPerMillionTokens: 10.0  # 출력 100만 토큰당 달러
  monthlyCostLimitUsd: 20           # 월 비용 상한(달러), OpenAI에만. 넘으면 거부(C4 LLM_LIMIT). OpenAI 콘솔에도 같은 값을 건다
  costAlertRatio: 0.5               # 이 비율에 닿으면 화면 상단 띠·cost 명령에 "비용 절반 사용" 알림
  costPerThousandTokens: 0          # (기존 칸, 안 씀) 입력·출력 칸으로 대체. 다음 깨는 변경 때 제거

# ② 홈페이지 찾기용 네이버 검색 API(웹 문서). 키는 환경 변수 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET로만 읽는다.
# 결과는 네이버가 준 모양 그대로 "네이버 검색결과"로 보여 주고, 담당자가 확정한 주소 하나만 저장한다. 결과 목록은 저장·캐시하지 않는다(특약 2.3).
naverSearch:
  enabled: true
  dailyCallLimit: 500               # 하루 호출 상한(회). 네이버 자체 한도는 25,000. 넘으면 "오늘 검색 한도 초과"
  display: 5                        # 한 번에 보여 줄 결과 수(네이버 최대 100)

# 홈페이지 자동 탐색 (②). 검색은 naverSearch, 확정은 담당자. termsConfirmed는 PM이 네이버 API 허브 신청 때 이 쓰임새로 확인한 뒤 true.
homepageDiscovery:
  enabled: true
  termsConfirmed: false             # false면 ②는 "확인 필요"로만 남기고 검색을 호출하지 않는다
```

`.env.example`에는 변수 이름만 세 줄 더한다.

```bash
# 외부 LLM 키 (U2부터, 근거 추출에만). 값은 .env에만, 저장소·설정 파일·로그에 절대 적지 않는다.
OPENAI_API_KEY=
# 네이버 검색 API 키 (U2부터, 홈페이지 찾기에만). 네이버 API 허브에서 발급.
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
```

## 2. 약속 파일(`contract-summary.md`) 추가 — 반영 완료

| 계약 | 지금 | 더한 것 |
|---|---|---|
| C7 AppSettings `llm` | `{ mode, model, monthlyCallLimit, costPerThousandTokens }` | `provider`, `allowedModels`, `inputCostPerMillionTokens`, `outputCostPerMillionTokens`, `monthlyCostLimitUsd`, `costAlertRatio`. `costPerThousandTokens`는 "안 씀" 표시 |
| C7 AppSettings `naverSearch` (새 묶음) | 없음 | `{ enabled, dailyCallLimit, display }` |
| C7 AppSettings `homepageDiscovery` | `{ enabled, termsConfirmed }` | 뜻을 "네이버 결과 표시 + 담당자 확정"으로 설명 추가. 키 변화 없음 |
| C4 `check_transfer` EXTERNAL_AI | 월 호출 상한 초과 → 거부 | **월 비용 상한 초과 → 거부 (LLM_LIMIT)**, OpenAI에만 |
| C4 `check_transfer` **EXTERNAL_SEARCH** (새 용도) | 없음 | 허용 kind는 CUSTOMER_NAME·CUSTOMER_ADDRESS(PUBLIC)만. 메모·내부 이력·거산 값·연락처가 섞이면 전체 거부. 하루 상한 초과 → SEARCH_LIMIT. TransferLog 1행(검색어 본문 없음). 결과는 저장·캐시 안 함 |
| C4 `usage()` | `{ callCount, tokenCount, rejectedCount }` | `inputTokens, outputTokens, webSearchCalls(네이버 건수), costUsd, costLimitUsd, callLimit, alertReached` |
| C9 `LlmAdapter` | `mode`, `extract_evidence`, `generate_questions`, `draft_message` | `provider: OPENAI`, 보관 규칙(한 번 보내고 끝나는 호출만, 파일 업로드·대화 보관형 기능 안 씀, 데이터 공유 동의 끄기), `usageGuard` |
| C9 `HomepageFinder` (새 항목, ②) | 없음 | `search_candidates(회사명, 주소)` → 네이버 응답 그대로 `{ provider: NAVER, items[{ title, link, description }] }`. `confirm(oppId, url, 확정자)` → 주소 하나만 저장. 키·한도·약관 조항 명시 |
| C1 | 없음 | `GET /opportunities/{oppId}/homepage-candidates`(네이버 결과 그대로, 저장 안 함), `GET /llm-usage`. 확정은 기존 `POST /homepage`(url) |
| C8 | `geosan cost` (U10) | U2로 앞당김. OpenAI 비용·상한 비율 + 네이버 건수 |
| 5장 열린 질문 C9 | "검색 방식·비용·약관 — U9" | 답: 네이버 검색 API, 결과 그대로 표시 + 담당자 확정, U2에서 |

## 3. 깨는 변경인가

| 바꾸는 것 | 판단 |
|---|---|
| 설정 키 추가(llm 6개, naverSearch 묶음) | 추가. 모르는 키를 거부하는 규칙(C7) 때문에 **코드(LlmSettings)와 같은 PR에서** 더해야 check-config 통과 |
| `costPerThousandTokens` | 지우지 않고 "안 씀" 표시 → 깨지 않음 |
| `homepageDiscovery.enabled` false → true | 값 변경. 코드 영향 없음(U1은 읽기만). U2 PR에서 |
| C4 규칙·용도, usage 칸, C9 항목, C1 경로 2개, C8 설명 | 모두 추가 |
| `contracts/app-settings.schema.json`·`contracts/openapi.json` | 코드 뒤 `geosan export-contracts`로 갱신(사람이 실행) |

## 4. 코드에 미치는 것 (U2 구현 때, 유동렬)

- `geosan/config/app_settings.py` `LlmSettings`에 위 칸 추가, `NaverSearchSettings` 새로. `model ∈ allowedModels` 검사, `costAlertRatio` 0~1 검사. `check-config`가 틀린 모델 이름을 줄 번호와 함께 거부.
- 의존성: 런타임에 HTTP 클라이언트·LLM SDK가 없다(`pyproject.toml` 12행 주석, 보안 설계 4장). U2 PR에서 **OpenAI 공식 SDK 하나**를 더하고 이유를 PR에 적는다(규칙 ⑥). 네이버 검색은 단순 GET이라 `httpx`(이미 개발 의존성)를 런타임으로 올리면 된다. 새 패키지는 최대 2개.
- 키 3개는 환경 변수로만. `app_settings.py`의 비밀 키 이름 검사(`apiKey`·`secret`·`token` 등)가 설정 파일에 키가 들어오는 것을 막는다(이미 있음).
- 전송 보호 부품(TransferGuard, 용도 2개)·TransferLog·LLM 어댑터·HomepageFinder는 아직 코드가 없다. U2 완료 기준의 "전송 0건·거부 로그" 테스트와 함께 만든다. 테스트는 가짜 응답(mock)으로, 실제 호출은 6장 시험 1회뿐.
- 화면: 상세에 "홈페이지 찾기" 버튼 → 네이버 결과 5건을 받은 순서·제목·설명 그대로 "네이버 검색결과" 표시와 원문 링크로 보이고, 각 줄에 [이 주소로 확정]. 확정하면 기존 `/homepage` 흐름(본문 읽기 → 근거 추출 → 재평가).
- 18곳 사례 파일의 근거 항목에 `isLlmProposed: false`가 이미 있어 AI 제안 근거가 들어갈 자리는 있다. AI 제안값은 사람이 확정하기 전까지 점수에 안 들어간다.

## 5. 비용 어림값 (실측 전, Sol 기준)

1곳을 끝까지 조사하면 네이버 검색 1회(무료) + OpenAI 근거 추출 1회다.

| 항목 | 토큰·횟수 어림 | 비용 어림 |
|---|---|---|
| ② 홈페이지 찾기 (네이버) | 검색 1회 | 0원 (하루 상한 500회 안) |
| ④ 근거 추출 (OpenAI) | 입력 3,000~6,000 / 출력 1,000~1,500토큰 | 1센트 + 1~1.5센트 |
| **1곳 합계** | | **약 2~3센트** |
| 18곳 | | 약 50센트 |
| 5곳 시험 | | 약 15센트 |
| 월 $20 | | 약 700~1,000곳 |
| 월 1,000회 | | 약 1,000곳 |

Luna로 바꾸면 20분의 1(1곳 약 0.1~0.2센트). 재시도가 붙은 호출은 2배로 센다.

## 6. 5곳 시험 절차 (U2 코드가 생긴 뒤)

1. 18곳 중 아노다이징 3곳·아연도금 2곳을 고른다.
2. `llm.mode: EXTERNAL`, `model: gpt-6.1-sol`, `naverSearch.enabled: true`로 두고 ②(검색 → 담당자 확정)→③→④를 1곳씩 돌린다. 각 호출의 TransferLog(입력·출력 토큰, 네이버 호출 수)를 모은다.
3. `geosan cost`로 1곳당 토큰·비용을 내고 OpenAI 콘솔 금액과 맞춘다.
4. 결과를 쉬운 말로 보고한다: "1곳당 ○센트, 어림값(2~3센트)과 같다/다르다". **어림값의 2배를 넘으면** 원인(본문 길이·재시도)을 적고 Luna 전환 또는 본문 길이 상한을 제안한다.
5. 같은 5곳을 `gpt-6-luna`로 한 번 더 돌려 근거 품질(인용 정확성·질문 적절성)과 비용을 나란히 보여 준다.
6. 네이버 결과 5건 중 실제 홈페이지가 몇 번째에 나오는지도 세어 `display` 값을 조정한다.

## 7. 반영한 곳 (2026-11-03)

- `contract-summary.md` C1·C4·C7·C8·C9·5장 ✅
- `scope-document.md` P1-5·7장 가정 ✅
- `docs/presentation-notes.md` 결정과 이유 한 줄 ✅
- 이슈 #23(결정 3)·#72(U2 시작 조건) 댓글 + 정정 댓글 ✅
- `examples/app-settings.yaml`·`.env.example` → U2 코드 PR에서(1장)
- PM 할 일: OpenAI 키 발급 + 콘솔 한도 $20 + 데이터 공유 동의 끄기, 네이버 API 허브 신청(쓰임새: "검색 결과를 그대로 표시하고 담당자가 홈페이지 주소를 확정") 뒤 `termsConfirmed: true`
