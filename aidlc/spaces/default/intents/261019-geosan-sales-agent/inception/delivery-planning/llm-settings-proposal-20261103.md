# 외부 AI(LLM)·홈페이지 찾기 설정·약속 파일 추가 제안 — 결정 2(B)·3 (2026-11-03)

> 상태: **PM "반영" 승인 2026-11-03, 같은 날 저녁 결정 B 확정으로 다시 반영 완료.** 약속 파일(C1·C4·C7·C8·C9·5장)·범위 문서 P1-5·발표 메모·#23·#72·#218·#219 댓글에 반영했다. 설정 예시 파일·`.env.example`의 새 키는 모르는 키를 거부하는 검사(C7) 때문에 **U2 코드 PR에서 LlmSettings와 같이** 넣는다(1장이 그 PR의 사양). 순서는 팀 규칙대로 **약속 파일에 먼저 적고 → PR 체크리스트에 표시하고 → 코드(U2)를 만든다.** 아래는 모두 "더하는 변경"이고 깨는 변경은 없다(3장). `contracts/app-settings.schema.json`은 `geosan export-contracts`가 만들지 않는다(그 명령은 `openapi.json`만 만든다). U2 코드 PR에서 설정 모델과 함께 사람이 직접 세 칸(minConfidence·autoResearch·dailyCallLimit)을 더해 올린다(2026-11-03 #218 유동렬 질문으로 바로잡음).
>
> **결정 경과(같은 날 세 번)**: 오전 초안은 ② 홈페이지 찾기를 OpenAI 웹 검색으로 적었다 → 낮에 네이버 검색 API로 정정했으나, 네이버 검색 API 특약(2026-09-07, 결과 저장·가공·AI 입력 금지)을 지키려면 "결과만 보여 주고 담당자가 먼저 확정"하는 단계가 필요했다 → **저녁에 PM이 결정 B로 확정**: OpenAI 웹 검색이 찾아 바로 저장하고 근거 추출까지 자동으로 잇는다. 사람은 상세 화면에서 확인·수정만 한다. 네이버 검색 API는 쓰지 않는다.

## 0. 결정 요약 (출처: PM 메모 2026-11-03 저녁, 이슈 #23·#72·#218)

| 항목 | 결정 | 확인한 근거 |
|---|---|---|
| 제공사 | 홈페이지 찾기(②)·근거 추출(③④) 모두 OpenAI API. 키는 1개 | #23 중간 결정 2026-10-24 + 11/3 결정 B |
| 모델 | `gpt-6.1-sol` 확정. 비용 비교용으로 `gpt-6-luna`로 바꿀 수 있게 설정값 | OpenAI 가격표·모델 목록(2026-11-03 확인): Sol 입력 $2 / 캐시 $0.10 / 출력 $10, Luna $0.10 / $0.01 / $0.50 (100만 토큰당) |
| 단가 | 입력 100만 토큰당 $2, 출력 $10. 웹 검색 도구 1,000회당 $10 | 가격표와 일치 |
| 월 비용 상한 | $20, OpenAI 전체(웹 검색 포함). 50%($10)에 알림. OpenAI 콘솔 사용 한도도 $20 | 콘솔 한도는 PM이 키 발급 때 설정 |
| 월 호출 상한 | 1,000회(웹 검색 호출 포함). 홈페이지 찾기는 하루 200회 상한 따로 | 설정값 |
| 전송 보호 | OpenAI로 나가는 것은 공개 홈페이지 본문(C4 EXTERNAL_AI)과 회사명·주소(C4 EXTERNAL_SEARCH)뿐 | C4는 제공사 이름 없이 용도로 묶여 있음. OpenAI API 입력은 기본적으로 학습에 안 쓰이고 남용 감시 기록 최대 30일 |
| 시험 | 처음 5곳으로 1곳당 토큰·비용을 재고 어림값과 다르면 쉬운 말로 보고 | 6장 |
| **결정 B** | ①후보 수집 ②홈페이지 찾기 ③본문 읽기 ④근거 추출 전부 AI가 먼저. **회사가 목록에 들어오면 ②→③→④→재평가가 자동으로 이어진다.** 사람은 자세히 보기에서 홈페이지가 맞는지 확인·수정만. 확신도가 낮으면 상세 맨 위 "홈페이지 확인 필요" 띠. 주소를 고치면 다시 추출·재평가 | OpenAI 웹 검색 출력은 저장·가공 가능. 네이버 특약 같은 제약이 없어 담당자 확정을 먼저 받을 이유가 없음 |

## 1. 설정 예시 파일 `examples/app-settings.yaml` — `llm`·`homepageDiscovery` 칸 제안 (U2 코드 PR에서 넣음)

```yaml
# 외부 LLM (U2에서 쓴다: 홈페이지 찾기 ②와 근거 추출 ③④). U1은 NONE이며 외부 호출 코드가 없다.
# mode를 EXTERNAL로 바꾸면 전송 보호(C4)를 통과한 공개 본문·회사명·주소만 OpenAI로 나간다. 키는 환경 변수 OPENAI_API_KEY로만 읽는다.
llm:
  mode: NONE                        # U2 합치기 전까지 NONE. 실제 호출은 EXTERNAL
  provider: OPENAI                  # 지금은 OPENAI 하나. 어댑터 뒤에 가둔다(C9)
  model: gpt-6.1-sol                # PM 결정 2026-11-03. 비용 비교는 gpt-6-luna로 바꿔서 돌린다
  allowedModels: [gpt-6.1-sol, gpt-6-luna]   # 오타 방지. model은 이 목록 안이어야 check-config 통과
  monthlyCallLimit: 1000            # 월 호출 상한(회), 웹 검색 호출 포함. 넘으면 거부(C4 LLM_LIMIT). 재시도도 1회로 센다
  inputCostPerMillionTokens: 2.0    # 입력 100만 토큰당 달러 (gpt-6.1-sol, OpenAI 가격표 2026-11-03)
  outputCostPerMillionTokens: 10.0  # 출력 100만 토큰당 달러
  webSearchCostPerThousandCalls: 10.0   # 웹 검색 도구 1,000회당 달러
  monthlyCostLimitUsd: 20           # 월 비용 상한(달러), OpenAI 전체. 넘으면 거부(C4 LLM_LIMIT). OpenAI 콘솔에도 같은 값을 건다
  costAlertRatio: 0.5               # 이 비율에 닿으면 화면 상단 띠·cost 명령에 "비용 절반 사용" 알림
  costPerThousandTokens: 0          # (기존 칸, 안 씀) 입력·출력 칸으로 대체. 다음 깨는 변경 때 제거

# (안 씀, 결정 B) 네이버 검색 API는 쓰지 않는다. 칸 이름만 호환용으로 남기며 코드는 읽지 않는다.
naverSearch:
  enabled: false

# ② 홈페이지 찾기 (결정 B). OpenAI 웹 검색이 회사명+주소로 공식 홈페이지 주소·확신도를 찾아 바로 저장한다.
homepageDiscovery:
  enabled: true                     # false면 ②를 건너뛰고 "직접 입력"으로만 남긴다(키 받기 전)
  autoResearch: true                # 회사가 목록에 들어올 때 ②→③→④→재평가를 자동으로 잇는다. false면 [다시 조사]·research 명령으로만
  minConfidence: 0.7                # 이 값 아래면 "홈페이지 확인 필요" 띠(근거 추출은 진행)
  dailyCallLimit: 200               # 하루 웹 검색 상한(회). 넘으면 "오늘 검색 한도 초과", 다음 날 research 명령으로 이어서
  termsConfirmed: false             # (안 씀) 네이버 안에서 쓰던 칸. 호환용
```

`.env.example`에는 변수 이름만 한 줄 더한다.

```bash
# 외부 LLM 키 (U2부터: 홈페이지 찾기·근거 추출). 값은 .env에만, 저장소·설정 파일·로그에 절대 적지 않는다.
OPENAI_API_KEY=
```

## 2. 약속 파일(`contract-summary.md`) 추가 — 반영 완료 (결정 B 기준)

| 계약 | 지금 | 더한 것 |
|---|---|---|
| C7 AppSettings `llm` | `{ mode, model, monthlyCallLimit, costPerThousandTokens }` | `provider`, `allowedModels`, `inputCostPerMillionTokens`, `outputCostPerMillionTokens`, `monthlyCostLimitUsd`, `costAlertRatio`. `costPerThousandTokens`는 "안 씀" 표시 |
| C7 AppSettings `naverSearch` | (낮에 더함) | **"안 씀"** 표시. 키 이름만 남김 |
| C7 AppSettings `homepageDiscovery` | `{ enabled, termsConfirmed }` | `minConfidence`, `autoResearch`, `dailyCallLimit` 추가. `termsConfirmed`는 "안 씀" |
| C4 `check_transfer` EXTERNAL_AI | 월 호출 상한 초과 → 거부 | **월 비용 상한 초과 → 거부 (LLM_LIMIT)** |
| C4 `check_transfer` **EXTERNAL_SEARCH** | (낮에 더함, 네이버) | 검색 도구를 OpenAI 웹 검색으로. 허용 kind는 CUSTOMER_NAME·CUSTOMER_ADDRESS(PUBLIC)만(그대로). 하루 상한·월 비용 상한 모두 적용. AI가 고른 주소·확신도는 저장 |
| C4 `usage()` | `{ callCount, tokenCount, rejectedCount }` | `inputTokens, outputTokens, webSearchCalls(OpenAI 웹 검색 건수, 비용 포함), costUsd, costLimitUsd, callLimit, alertReached` |
| C9 `LlmAdapter` | `mode`, `extract_evidence`, `generate_questions`, `draft_message` | `provider: OPENAI`, 보관 규칙(한 번 보내고 끝나는 호출만, 파일 업로드·대화 보관형 기능 안 씀, 데이터 공유 동의 끄기), `usageGuard`, 결과에 `companySummary`·`companyMainPhone` |
| C9 `HomepageFinder` (②) | (낮에 더함, 네이버 search_candidates) | `find(회사명, 주소)` → `{ url|null, confidence, reason }`, `save` → 상태(AI_FOUND / NEEDS_CONFIRMATION / NOT_FOUND) + autoResearch면 흐름 ①로 연결, `confirm(…, confirmOnly)` → [맞음]은 상태만, 주소 고치면 다시 추출 |
| C1 상세 머리 | `homepageUrl` | `homepageStatus`(4가지)·`homepageConfidence`·`homepageSource`(AI / STAFF / CASE_FILE) |
| C1 `POST /homepage` | `{ url, pastedText }` | `confirmOnly: boolean` |
| C1 `/homepage-candidates` | (낮에 더함) | **"안 씀"**. `GET /llm-usage`는 그대로 |
| C8 | `geosan cost` (U10) | U2로 앞당김(웹 검색 횟수 포함). **`geosan research [--missing-homepage|--all]`** 새 명령: 18곳 일괄 ②→③→④ |
| 5장 열린 질문 C9 | "검색 방식·비용·약관 — U9" | 답: OpenAI 웹 검색, 자동 저장 + 상세에서 확인·수정, U2에서 |

## 3. 깨는 변경인가

| 바꾸는 것 | 판단 |
|---|---|
| 설정 키 추가(llm 7개, homepageDiscovery 3개) | 추가. 모르는 키를 거부하는 규칙(C7) 때문에 **코드(LlmSettings)와 같은 PR에서** 더해야 check-config 통과 |
| `costPerThousandTokens`, `naverSearch`, `termsConfirmed`, `/homepage-candidates` | 지우지 않고 "안 씀" 표시 → 깨지 않음 |
| `homepageDiscovery.enabled` false → true | 값 변경. 코드 영향 없음(U1은 읽기만). U2 PR에서 |
| C4 규칙, usage 칸, C9 항목, C1 머리 3칸·confirmOnly, C8 명령 | 모두 추가 |
| `contracts/openapi.json` | 코드 뒤 `geosan export-contracts`로 갱신(사람이 실행) |
| `contracts/app-settings.schema.json` | 명령이 만들지 않는다. U2 코드 PR에서 사람이 직접 세 칸을 더한다(더하는 변경, PR 체크리스트에 표시) |

## 4. 코드에 미치는 것 (U2 구현 때, 유동렬)

- `geosan/config/app_settings.py` `LlmSettings`에 위 칸 추가, `HomepageDiscoverySettings` 칸 3개 추가. `model ∈ allowedModels` 검사, `costAlertRatio`·`minConfidence` 0~1 검사. `check-config`가 틀린 모델 이름을 줄 번호와 함께 거부.
- 의존성: 런타임에 HTTP 클라이언트·LLM SDK가 없다(`pyproject.toml` 12행 주석, 보안 설계 4장). U2 PR에서 **OpenAI 공식 SDK 하나**를 더하고 이유를 PR에 적는다(규칙 ⑥). 홈페이지 본문 읽기는 `httpx`(이미 의존성)로. 새 패키지는 1개.
- 키 1개(OPENAI_API_KEY)는 환경 변수로만. `app_settings.py`의 비밀 키 이름 검사가 설정 파일에 키가 들어오는 것을 막는다(이미 있음).
- 전송 보호 부품(TransferGuard, 용도 EXTERNAL_AI·EXTERNAL_SEARCH)·TransferLog·LLM 어댑터·HomepageFinder·자동 연쇄(ResearchRunner)는 아직 코드가 없다. U2 완료 기준의 "전송 0건·거부 로그" 테스트와 함께 만든다. 테스트는 가짜 응답(mock)으로, 실제 호출은 6장 시험뿐.
- 자동 연쇄 진입점 4곳: 사례 파일 투입(`import-case`), U3 수집(`collect`, 11/17~), 상세 [다시 조사](`POST /homepage`), `geosan research`. 모두 같은 함수를 부른다. 한 회사 60초 한도, 실패하면 그 회사만 "확인 필요"로 남기고 다음 회사로.
- 화면(#210 고선주 또는 #218): 상세 맨 위 띠 2종("홈페이지 확인 필요" / "홈페이지 못 찾음 — 직접 입력"), 머리의 홈페이지 링크 옆 [맞음] [고치기](인라인 입력, 모달 없음). 네이버 결과 목록 화면은 없다.
- 18곳 사례 파일의 근거 항목에 `isLlmProposed: false`가 이미 있어 AI 제안 근거가 들어갈 자리는 있다. AI 제안값은 사람이 확정하기 전까지 점수에 안 들어간다.

## 5. 비용 어림값 (실측 전, Sol 기준)

1곳을 끝까지 조사하면 OpenAI 웹 검색 1회 + 근거 추출 1회다.

| 항목 | 토큰·횟수 어림 | 비용 어림 |
|---|---|---|
| ② 홈페이지 찾기 (OpenAI 웹 검색) | 검색 1회 + 검색 본문 2,000~5,000토큰 | 1센트 + 0.5~1센트 |
| ④ 근거 추출 (OpenAI) | 입력 3,000~6,000 / 출력 1,000~1,500토큰 | 1센트 + 1~1.5센트 |
| **1곳 합계** | | **약 4~6센트** |
| 18곳 | | 약 $1 |
| 5곳 시험 | | 약 30센트 |
| U3로 50곳 추가 | | 약 $2.5 |
| 월 $20 | | 약 350~500곳 |

Luna로 바꾸면 추출 쪽은 20분의 1(웹 검색 호출비 1센트는 그대로). 재시도가 붙은 호출은 2배로 센다. 상한을 넘으면 자동 연쇄는 멈추고 남은 회사는 "확인 필요"로 남는다.

## 6. 5곳 시험 절차 (U2 코드가 생긴 뒤)

1. 18곳 중 아노다이징 3곳·아연도금 2곳을 고른다.
2. `llm.mode: EXTERNAL`, `model: gpt-6.1-sol`, `homepageDiscovery.enabled: true`로 두고 `geosan research --limit 5`로 ②→③→④를 돌린다. 각 호출의 TransferLog(입력·출력 토큰, 웹 검색 횟수)를 모은다.
3. `geosan cost`로 1곳당 토큰·비용을 내고 OpenAI 콘솔 금액과 맞춘다.
4. 결과를 쉬운 말로 보고한다: "1곳당 ○센트, 어림값(4~6센트)과 같다/다르다". **어림값의 2배를 넘으면** 원인(본문 길이·재시도)을 적고 Luna 전환 또는 본문 길이 상한을 제안한다.
5. 같은 5곳을 `gpt-6-luna`로 한 번 더 돌려 근거 품질(인용 정확성·질문 적절성)과 비용을 나란히 보여 준다.
6. 5곳 중 AI가 찾은 홈페이지가 실제로 맞은 수, 확신도 값, "확인 필요"로 남은 수를 세어 `minConfidence`를 조정한다. 이 숫자는 2차 에이전트 전환(#224)의 비교 기준이 된다.

## 7. 반영한 곳 (2026-11-03)

- `contract-summary.md` C1·C4·C7·C8·C9·5장 ✅ (낮 네이버 → 저녁 결정 B로 다시)
- `scope-document.md` P1-5·7장 가정 ✅
- `docs/presentation-notes.md` 결정과 이유 한 줄 ✅ (결정 경과 포함)
- 이슈 #23(결정 3 + B 정정 댓글)·#72·#218(본문 다시 씀)·#219·#208·#210·#213 ✅
- `examples/app-settings.yaml`·`.env.example` → U2 코드 PR에서(1장)
- PM 할 일: OpenAI 키 발급 + 콘솔 한도 $20 + 데이터 공유 동의 끄기. **네이버 API 허브 신청은 필요 없음.**
