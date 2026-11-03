# 외부 AI(LLM) 설정·약속 파일 추가 제안 — 결정 3 (2026-11-03)

> 상태: **PM "반영" 승인 2026-11-03. 약속 파일(C1·C4·C7·C8·C9·5장)·범위 문서 P1-5·발표 메모·#23·#72 댓글 반영 완료.** 설정 예시 파일·`.env.example`의 새 키는 모르는 키를 거부하는 검사(C7) 때문에 **U2 코드 PR에서 LlmSettings와 같이** 넣는다(1장이 그 PR의 사양). 결정 3(PM, 2026-11-03)과 결정 2 정정("①②③④ 전부 AI가 먼저 조사, 사람은 판단·확인·수정만")을 설정 예시 파일과 약속 파일(계약 요약)에 어떻게 더할지 적은 것이다. 순서는 팀 규칙대로 **약속 파일에 먼저 적고 → PR 체크리스트에 표시하고 → 코드(U2)를 만든다.** 아래는 모두 "더하는 변경"이고 깨는 변경은 없다(3장). PM이 이 제안서에 "반영"이라고 하면 `contract-summary.md`·`examples/app-settings.yaml`·`.env.example`을 고치고 커밋한다. `contracts/app-settings.schema.json`은 U2 코드에서 설정 모델을 고친 뒤 사람이 `geosan export-contracts`를 돌릴 때 갱신한다.

## 0. 결정 요약 (출처: PM 메모 2026-11-03, 이슈 #23)

| 항목 | 결정 | 확인한 근거 |
|---|---|---|
| 제공사 | OpenAI API. 키 발급(#23)을 가장 먼저 | #23 중간 결정 2026-10-24와 같음 |
| 모델 | `gpt-6.1-sol` 확정. 비용 비교용으로 `gpt-6-luna`로 바꿀 수 있게 설정값 | OpenAI 가격표·모델 목록(2026-11-03 확인): Sol 입력 $2 / 캐시 $0.10 / 출력 $10, Luna $0.10 / $0.01 / $0.50 (100만 토큰당) |
| 단가 | 입력 100만 토큰당 $2, 출력 $10 | 가격표와 일치 |
| 월 비용 상한 | $20. 50%($10)에 알림. OpenAI 콘솔 사용 한도도 $20 | 콘솔 한도는 PM이 키 발급 때 설정 |
| 월 호출 상한 | 1,000회 | 기존 설정 키 `monthlyCallLimit` 그대로 |
| 전송 보호 | 공개 홈페이지 본문만 전송(C4·C9)이 OpenAI 연결에도 그대로 적용 | C4는 제공사 이름 없이 "외부 AI" 용도로 묶여 있음. OpenAI API 입력은 기본적으로 학습에 안 쓰이고 남용 감시 기록 최대 30일 |
| 시험 | 처음 5곳으로 1곳당 토큰·비용을 재고 어림값과 다르면 쉬운 말로 보고 | 6장 |
| 결정 2 정정 | ①후보 수집 ②홈페이지 찾기 ③본문 읽기 ④근거 추출 전부 AI가 먼저. 사람은 판단·확인·수정만 | ②는 네이버 검색 API(2026-09-07 특약: 저장·AI 입력 금지)·구글 CSE(신규 중단) 불가 → **OpenAI 웹 검색 도구**로 함. $10/1,000회 + 검색 본문 토큰은 모델 단가 |

## 1. 설정 예시 파일 `examples/app-settings.yaml` — `llm`·`homepageDiscovery` 칸 제안

```yaml
# 외부 LLM (U2에서 쓴다). U1은 NONE이며 외부 호출 코드가 없다.
# mode를 EXTERNAL로 바꾸면 전송 보호(C4)를 통과한 공개 본문만 OpenAI로 나간다. 키는 환경 변수 OPENAI_API_KEY로만 읽는다.
llm:
  mode: NONE                        # U2 합치기 전까지 NONE. 실제 호출은 EXTERNAL
  provider: OPENAI                  # 지금은 OPENAI 하나. 어댑터 뒤에 가둔다(C9)
  model: gpt-6.1-sol                # PM 결정 2026-11-03. 비용 비교는 gpt-6-luna로 바꿔서 돌린다
  allowedModels: [gpt-6.1-sol, gpt-6-luna]   # 오타 방지. model은 이 목록 안이어야 check-config 통과
  monthlyCallLimit: 1000            # 월 호출 상한(회). 넘으면 거부(C4 LLM_LIMIT). 재시도도 1회로 센다
  inputCostPerMillionTokens: 2.0    # 입력 100만 토큰당 달러 (gpt-6.1-sol, OpenAI 가격표 2026-11-03)
  outputCostPerMillionTokens: 10.0  # 출력 100만 토큰당 달러
  monthlyCostLimitUsd: 20           # 월 비용 상한(달러). 넘으면 거부(C4 LLM_LIMIT). OpenAI 콘솔에도 같은 값을 건다
  costAlertRatio: 0.5               # 이 비율에 닿으면 화면 상단 띠·운영 명령에 "비용 절반 사용" 알림
  costPerThousandTokens: 0          # (기존 칸, 안 씀) 입력·출력 칸으로 대체. 다음 깨는 변경 때 제거
  webSearch:                        # ② 홈페이지 찾기용 OpenAI 웹 검색 도구
    enabled: true
    costPerCallUsd: 0.01            # 1,000회당 $10. 검색 본문 토큰은 위 입력 단가로 따로 센다

# 홈페이지 자동 탐색 (②, 결정 2 정정으로 AI가 먼저 함). 검색은 OpenAI 웹 검색 도구를 쓴다(llm.webSearch).
# 네이버 검색 API는 2026-09-07 특약으로 저장·AI 입력이 금지라 쓰지 않는다. termsConfirmed는 PM이 OpenAI 약관을 확인한 뒤 true.
homepageDiscovery:
  enabled: true
  termsConfirmed: false             # PM이 키 발급 때 OpenAI 이용약관 확인 뒤 true로. false면 ②는 "확인 필요"로만 남긴다
  minConfidence: 0.8                # 이 아래면 저장하지 않고 "확인 필요"로 표시해 담당자가 주소 확정(P1-5)
```

`.env.example`에는 변수 이름만 한 줄 더한다.

```bash
# 외부 LLM 키 (U2부터). 값은 .env에만, 저장소·설정 파일·로그에 절대 적지 않는다.
OPENAI_API_KEY=
```

## 2. 약속 파일(`contract-summary.md`) 추가 제안

| 계약 | 지금 | 더할 것 |
|---|---|---|
| C7 AppSettings `llm` | `{ mode, model, monthlyCallLimit, costPerThousandTokens }` | `provider: enum[OPENAI]`, `allowedModels: [string]`, `inputCostPerMillionTokens`, `outputCostPerMillionTokens`, `monthlyCostLimitUsd`, `costAlertRatio`, `webSearch: { enabled, costPerCallUsd }`. `costPerThousandTokens`는 "안 씀(deprecated)" 표시로 남김 |
| C7 AppSettings `homepageDiscovery` | `{ enabled, termsConfirmed }` | `minConfidence: number` 추가. 검색 수단은 C9 `HomepageFinder` |
| C4 `check_transfer` EXTERNAL_AI 규칙 | 월 호출 상한 초과 → 거부 (LLM_LIMIT) | **월 비용 상한 초과 → 거부 (kind LLM_LIMIT)** 한 줄 추가. 비용은 `TransferLog`의 토큰 수 × 단가로 월별 합산. 웹 검색 호출도 TransferLog 1행(종류 WEB_SEARCH, 질의는 회사명·주소뿐) |
| C4 `usage()` | `{ callCount, tokenCount, rejectedCount }` | `inputTokens, outputTokens, webSearchCalls, costUsd, costLimitUsd, alertReached: boolean` 추가 |
| C9 `LlmAdapter` | `mode: enum[EXTERNAL, NONE]`, `extract_evidence`, `generate_questions`, `draft_message` | `provider: OPENAI`, `model`(설정값). **보관 규칙** 추가: 대화·파일이 서버에 남는 기능(파일 업로드·대화 보관형 엔드포인트)은 쓰지 않고 한 번 보내고 끝나는 호출만 쓴다. 데이터 공유 동의는 켜지 않는다. 로그에는 시각·모드·모델·등급·입력/출력 토큰 수·비용만(본문 없음) |
| C9 `HomepageFinder` (새 항목, ②) | 없음(C9 열린 질문 "검색 방식·비용·약관") | `find_homepage(companyName, address) -> { url: string|null, confidence: 0~1, basis: string, candidates: [{ url, title }] }`. OpenAI 웹 검색 도구 1회. `confidence < homepageDiscovery.minConfidence`이면 저장 안 하고 "확인 필요". timeout 30s, retry 1. 질의에 연락처·내부 값 없음(회사명·주소만, TransferGuard 통과) |
| C1 | 알림 띠 자료 없음 | `GET /llm-usage` (읽기 전용) → C4 `usage()` 출력. 공통 틀 상단 띠가 `alertReached`이면 "이번 달 AI 비용 절반 사용(…달러)" 표시. 상한 초과 시 근거 추출 버튼은 503 `LLM_LIMIT` 안내 |
| C8 | `usage` 명령 없음 | `geosan llm-usage [--month YYYY-MM]`: 호출 수·토큰·비용·상한 대비 비율 출력. 안내서(U10)에 한 줄 |
| 5장 열린 질문 C9 | "홈페이지 자동 탐색의 검색 방식·비용·약관 — U9" | **답**: OpenAI 웹 검색 도구, $10/1,000회 + 본문 토큰, 네이버 검색 API 불가(2026-09-07 특약). ②는 U9가 아니라 **U2에서 같이** 한다(결정 2 정정) |

## 3. 깨는 변경인가

| 바꾸는 것 | 판단 |
|---|---|
| 설정 키 추가 7개 + `webSearch` 묶음 + `minConfidence` | 추가. 모르는 키를 거부하는 규칙(C7) 때문에 **코드(LlmSettings)와 같은 PR에서** 더해야 check-config가 통과 |
| `costPerThousandTokens` | 지우지 않고 "안 씀" 표시 → 깨지 않음. 제거는 다음 깨는 변경 묶음 때 |
| `homepageDiscovery.enabled` false → true | 값 변경. 코드 영향 없음(U1은 읽기만) |
| C4 규칙 한 줄, usage 칸, C9 HomepageFinder, C1 `/llm-usage`, C8 `llm-usage` | 모두 추가 |
| `contracts/app-settings.schema.json`·`contracts/openapi.json` | 코드 뒤 `geosan export-contracts`로 갱신(사람이 실행) |

## 4. 코드에 미치는 것 (U2 구현 때, 유동렬)

- `geosan/config/app_settings.py` `LlmSettings`·`HomepageDiscoverySettings`에 위 칸 추가. `model ∈ allowedModels` 검사, `costAlertRatio` 0~1 검사. `check-config`가 틀린 모델 이름을 줄 번호와 함께 거부.
- 의존성: 런타임에 HTTP 클라이언트·LLM SDK가 없다(`pyproject.toml` 12행 주석, 보안 설계 4장). U2 PR에서 **OpenAI 공식 SDK 하나**를 더하고 이유를 PR에 적는다(규칙 ⑥). `httpx`는 이미 개발 의존성이라 SDK가 끌고 와도 새 패키지가 하나뿐이다.
- 키는 `OPENAI_API_KEY` 환경 변수로만. `app_settings.py`의 비밀 키 이름 검사(`apiKey`·`token` 등)가 설정 파일에 키가 들어오는 것을 막는다(이미 있음).
- 전송 보호 부품(TransferGuard)·TransferLog·LLM 어댑터·HomepageFinder는 아직 코드가 없다. U2 완료 기준의 "전송 0건·거부 로그" 테스트와 함께 만든다. 테스트는 가짜 응답(mock)으로, 실제 호출은 6장 시험 1회뿐.
- 18곳 사례 파일의 근거 항목에 `isLlmProposed: false`가 이미 있어 AI 제안 근거가 들어갈 자리는 있다. AI 제안값은 사람이 확정하기 전까지 점수에 안 들어간다(U2 설계 원칙 유지).

## 5. 비용 어림값 (실측 전, Sol 기준)

1곳을 AI가 처음부터 끝까지 조사하면 호출이 2번이다(② 웹 검색 1회 + ④ 근거 추출 1회).

| 항목 | 토큰·횟수 어림 | 비용 어림 |
|---|---|---|
| ② 홈페이지 찾기 | 검색 1회 + 검색 본문 5,000~10,000토큰 | 1센트 + 1~2센트 |
| ④ 근거 추출 | 입력 3,000~6,000 / 출력 1,000~1,500토큰 | 1센트 + 1~1.5센트 |
| **1곳 합계** | 호출 2회 | **약 4~6센트** |
| 18곳 | 36회 | 약 $1 |
| 5곳 시험 | 10회 | 약 30센트 |
| 월 $20 | | 약 350~500곳 |
| 월 1,000회 | | 약 500곳 |

Luna로 바꾸면 모델 토큰 값은 20분의 1이지만 웹 검색 1센트는 그대로라 1곳 약 1.5센트다. 재시도가 붙은 호출은 2배로 센다.

## 6. 5곳 시험 절차 (U2 코드가 생긴 뒤)

1. 18곳 중 아노다이징 3곳·아연도금 2곳을 고른다(홈페이지가 있는 곳).
2. `llm.mode: EXTERNAL`, `model: gpt-6.1-sol`로 두고 ②→③→④를 1곳씩 돌린다. 각 호출의 TransferLog(입력·출력 토큰, 웹 검색 횟수)를 모은다.
3. `geosan llm-usage`로 1곳당 토큰·비용을 내고 OpenAI 콘솔 금액과 맞춘다.
4. 결과를 쉬운 말로 보고한다: "1곳당 ○센트, 어림값(4~6센트)과 같다/다르다". **어림값의 2배를 넘으면** 원인(본문 길이·재시도·검색 본문 토큰)을 적고 Luna 전환 또는 본문 길이 상한을 제안한다.
5. 같은 5곳을 `gpt-6-luna`로 한 번 더 돌려 근거 품질(인용 정확성·질문 적절성)과 비용을 나란히 보여 준다.

## 7. 반영 위치 (PM "반영" 뒤)

- `contract-summary.md` C1·C4·C7·C8·C9·5장 (이 문서 2장 표대로)
- `examples/app-settings.yaml` llm·homepageDiscovery 칸 (1장) — **U2 코드 PR과 같이** 올려야 check-config 통과
- `.env.example` 한 줄
- 이슈 #23 댓글(결정 3), #72(U2 준비) 댓글에 이 제안서 링크, 범위 문서 P1-5 "검색 방식 확인 필요" → "OpenAI 웹 검색, U2에서"
- `docs/presentation-notes.md` 결정과 이유: "네이버 검색 API 약관 확인 뒤 OpenAI 웹 검색으로 전환"
