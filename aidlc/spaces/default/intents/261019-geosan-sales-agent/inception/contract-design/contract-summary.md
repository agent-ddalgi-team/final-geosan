# 계약 요약 (Contract Summary) — 거산케미칼 AI 영업지원 에이전트 2차

이 문서는 작업 단위(`../units-generation/unit-of-work.md`)와 의존 그래프(`../units-generation/unit-of-work-dependency.md`)의 경계마다 "무엇이 어떤 모양으로 건너고 잘못되면 어떻게 되는가"를 적은 약속(계약)입니다. 부품과 엔티티 이름은 도메인 설계(`../domain-design/components.md`)를, 성능·오류 규칙은 요구사항(NFR2·NFR7·NFR10, FR7.6)을 따릅니다. 확인된 답변은 `contract-design-questions.md` Q1~Q4입니다. 시스템은 한 덩어리(FastAPI + React 정적 파일 + SQLite)라 **밖에 공개하는 API는 없습니다**. 외부 LLM·외부 소스 API는 우리가 쓰는 쪽이므로 어댑터 계약(C9)으로만 다룹니다.

필드 이름·경로·명령 이름은 **제안**이며 기능 설계와 코드 생성에서 그대로 쓰거나 같은 뜻으로 고칩니다. 깨는 변경은 2장 규칙을 따릅니다. 검토(review-01)의 소견 18건을 반영한 판입니다.

**계약 요약 버전: v4 (2026-11-10, PM 결정 #536)** — 깨는 변경 1건: "검토 대상 제외"로 저장한 회사는 관심 기업에서 빠진다. ① C1 `/opinions`가 NOT_TARGET이면 같은 저장 안에서 관심을 끄고, 제외인 회사는 `/notes`·`/outcomes` 저장으로 관심이 다시 켜지지 않으며, `/bookmark` 켜기는 422 `BOOKMARK_EXCLUDED`로 거부 ② C1 `GET /dashboard` `counts`에서 `NOT_TARGET` 키 삭제(9칸), 목록 `filter` 값에서 `NOT_TARGET` 삭제 ③ C6 지금 "관심 + 제외"인 회사의 관심을 끄는 마이그레이션 `rec_011`. 제외한 회사는 목록 `?opinion=NOT_TARGET`(관심 조건 없이)으로 따로 본다 — 응답 모양 그대로. 아직 거산에 전달하기 전이라 실제 기록 영향 0. 아래는 v3 때 적은 내용 → **계약 요약 버전: v3 (2026-11-06, PM 결정 #356)** — 깨는 변경 2건을 한 번에: ① C0 `outcomeStatus`에서 `INTERESTED`(관심) 삭제 — 관심은 영업 단계가 아니라 따로 켜고 끄는 표시(`/bookmark`)가 된다. ② C1 `GET /dashboard` `counts`를 관심 기업 기준으로 다시 정함(`INTERESTED` 키 삭제, `NOT_CONTACTED` 뜻 바뀜). 아직 거산에 전달하기 전이라 실제 기록 영향 0. 같이 더한 것: `/bookmark` 다시 씀, 목록 `bookmarked`·`opinion`, `filter` 값 9개, C6 `rec_bookmark`. 아래는 v2 때 적은 내용 → **계약 요약 버전: v2 (2026-11-03, PM 결정)** — (같은 날 PM 지시 추가: 영업 메모에 연락처 허용, 회사 대표번호 자동 표시. 근거 `../delivery-planning/contact-policy-change-20261103.md`) 깨는 변경 1건: C1 `GET /dashboard` 건수 이름·응답 모양 재정의(아직 코드 없음, 영향 0). 같은 날 더한 것: C0 `INTERESTED`·`contactMethod`·`contactResult`, C1 `stage` 조건·`/notes`·`/outcomes` 칸, C6 `rec_note`, C7 `records`, 재접촉(U6) 항목 "보류" 표시. **(2026-11-03 밤 PM "반영", 상세 화면 5영역)** C0 `noteKind`·`reviewItemKind`·`reviewItemSource`, C1 머리 대표번호 출처·확인 3칸·`POST /main-phone/confirm`·`/notes kind`·`records.contactCount`·카드 `contactCount`·`reviewItems`·`POST /review-items/{itemId}/check`, C4 EXTERNAL_AI 추출 단계·`extract_main_phone`, C6 `opp_customer` 3열·`rec_note.kind`·`rec_review_check`, C7 `mainPhone`, C9 `companyMainPhone` 안 씀 — 모두 더하는 변경. 근거 `../delivery-planning/detail-screen-layout-20261103.md` 4·7장. **(같은 날 밤, 공정별 구분)** C1 `process=`·`meta.processCounts`·카드 `processCodes` 더함(`../delivery-planning/process-tabs-20261103.md`). **(같은 밤, 지역·산업 선택)** C1 `region=`·`industry=`·`meta.regionCounts`·`meta.industryCounts`·카드 `region`·`industries`, `industriesSource`에 CASE_FILE, C7 `listFilters.regionPresets`(`../delivery-planning/list-filters-region-industry-20261103.md`). 근거: `../delivery-planning/scope-change-proposal-20261102.md` 4장 답. **(2026-11-04 PM 결정)** 검토사항 [답 적기]: C0 `noteKind REPLY`, C1 `reviewItems` 답 3칸·`Question.repliedBy`·`/questions/{id}/reply` 대기 허용, C4 답·활동 이력 내부 전용, C6 `q_question` 회신 3열·`rec_note` REPLY 행(`../delivery-planning/review-answer-inline-20261104.md`). 분석용 코드값 칸: C0 `lostReasonCode`, C1 `/outcomes`·상세 `records.outcome`, C6 `rec_outcome.lost_reason_code`. 모두 더하는 변경.

## 1. 계약 목록

| # | Provider Unit | Consumer | Mechanism | Owner |
|---|---|---|---|---|
| C1 | U1 WebApi (U2·U4·U5·U6·U7·U8이 경로 묶음 추가) | WebUI (브라우저, 같은 덩어리) | 동기 HTTP JSON REST `/api/v1`, OpenAPI 자동 생성 | WebApi (U1) |
| C2 | U1 WorkflowRunner (U2·U3·U4·U5·U6이 흐름 추가) | WebApi, OperatorCommands | 내부 함수(흐름 함수, 한 흐름 = 한 트랜잭션) | WorkflowRunner |
| C3 | U1 RuleEngine (U6이 재접촉 프로필 추가) | EvaluationLedger | 내부 함수(입력 스냅샷 → 결과 구조체 + 순위 함수, 순수 계산) | RuleEngine |
| C4 | U2 TransferGuard | EvidenceExtraction, ConfirmationDesk(U4), DashboardReporting(U7), U6 테스트, OperatorCommands(U10) | 내부 함수(전송 요청 → 판정, 연락처 제거, 집계) | TransferGuard (U2) |
| C5 | U3 SourceIngestion (U9가 어댑터 추가) | WorkflowRunner ⑥, OperatorCommands | 내부 함수(어댑터 인터페이스) + 소스 계약표 | SourceIngestion (U3) |
| C6 | U1이 만든 공유 SQLite 스키마 (뒤 단위가 자기 테이블 추가) | 모든 단위 | 공유 데이터(테이블 접두사로 소유, 교차 참조는 ID만) | 각 테이블의 소유 부품 |
| C7 | 사람(PM·운영자·거산 담당자)이 넣는 파일 | OperatorCommands(U1·U4·U10), ConfigRegistry | 파일 형식(가상 사례 JSON, 거산 역량 JSON, 규칙 설정 YAML, 앱 설정 YAML) + 예시 파일 | OperatorCommands·ConfigRegistry (U1, U10) |
| C8 | U1 OperatorCommands (U3·U4·U8·U10이 명령 추가) | 사람(운영자, 운영 안내서) | 명령줄(명령 이름·인자·출력 형식) | OperatorCommands (U1) |
| C9 | External: 외부 LLM API, 기업 홈페이지, 산단공·공장등록·수질·나라장터 | EvidenceExtraction(U2), SourceIngestion(U3·U9) | 우리가 소비하는 바깥 서비스를 가두는 어댑터 인터페이스 | EvidenceExtraction·SourceIngestion |
| C0 | 공통 코드표(모든 계약이 가리킴) | C1·C3·C6·C7 | 열거값 한 곳 정의 | RuleEngine(분류)·각 소유 부품 |

## 2. 계약 주인과 바꾸는 규칙 (Q2)

- **주인**: 제공하는 쪽이 명세를 소유한다. HTTP API는 WebApi(U1이 뼈대 경로를 만들고 뒤 단위는 자기 경로 묶음 파일만 추가), 내부 함수는 해당 부품, 공유 데이터는 테이블 접두사가 가리키는 부품.
- **추가 변경(새 필드·경로·명령·테이블·열 추가)**: 주인 단위가 하되, **코드보다 먼저 약속 파일에 적고 PR 체크리스트에 표시한다**. 받는 쪽은 모르는 필드를 무시한다(React 화면·명령 출력). 단, 사람이 넣는 파일(C7)에서는 모르는 키를 오류로 본다(오타가 조용히 사라지지 않게).
- **깨는 변경(기존 필드·열 삭제, 의미·형식 변경, 경로·명령 삭제)**: `/api/v2`처럼 버전을 올리거나(HTTP), 규칙 설정 버전을 올리거나(규칙 설정 파일), 깨는 마이그레이션으로 표시하고(공유 데이터) PM 확인 뒤 한 번에 바꾼다. 이전 버전은 다음 합치기까지만 유지한다. 새 테이블·새 열을 더하는 마이그레이션은 추가 변경이다.
- **약속 파일(사용자가 더한 보호 장치 ①②④, 가장 단순한 방법)**:
  1. 약속 파일 = 저장소 `contracts/` 폴더(`openapi.json`, `case-file.schema.json`, `capability-file.schema.json`, `rule-config.schema.json`, `app-settings.schema.json`)와 이 문서. `contracts/`는 U1에서 처음 만든다. `openapi.json`은 **사람이 `geosan export-contracts`를 명시적으로 실행할 때만** 갱신하며 서버 시작 시 자동 생성은 하지 않는다(코드가 기준이 되어 버리는 것을 막음). `*.schema.json` 4개는 이 명령이 만들지 않고 사람이 손으로 고친다(2026-11-03 바로잡음, #218).
  2. `.claude/CLAUDE.md`에 "약속에 없는 항목은 만들지 말고 물어볼 것, 약속 파일은 PM 확인 없이 고치지 말 것, 더하는 것도 약속 파일에 먼저 적을 것"을 적었다(아래 8장).
  3. 코드와 약속 파일이 같은지 확인하는 검사(서버가 만든 OpenAPI ↔ `contracts/openapi.json`, 검사기 스키마 ↔ `contracts/*.schema.json` 네 개)는 기존 자동 검사(CI)에 한 단계로 붙이되, 만드는 시점은 전달 계획에서 정한다. C6 테이블·C8 명령은 자동 비교 없이 PR 체크리스트로만 보호한다(한계 명시).
  4. PR 체크리스트에 "약속 파일을 바꿨나요?" 한 줄을 넣고, 바꿨으면 PM 확인 후 합친다. 새 도구·새 서비스는 쓰지 않는다.
- **마이그레이션 동시 작업 규칙(U1 규칙)**: 단위마다 자기 접두사 테이블만 만들고 파일 이름을 `migrations/<접두사>_<번호>_<설명>.py`(예: `rec_001_bookmark.py`)로 두어 다른 단위와 번호가 겹치지 않게 한다. 합칠 때 도구가 "머리가 둘"이라고 하면 합치는 사람이 `geosan db merge-heads` 한 번으로 합치고 PR에 표시한다(도구는 코드 생성에서, Alembic 후보).

## 3. 경계 공통 오류·타임아웃·재시도 규칙 (Q3)

| 항목 | 규칙 | 출처 |
|---|---|---|
| 오류 응답 | HTTP는 `{ "error": { "message", "nextAction", "ref", "kind"?, "fields"? } }` 하나의 형식. `message`·`nextAction`은 쉬운 한국어, `ref`는 로그 대조용 짧은 식별자(화면에 작게). `kind`는 화면이 분기할 때만 쓰는 값(예: `ROBOTS_DISALLOW`, `UNREACHABLE`, `STALE_EVALUATION`)으로 화면에 보이지 않음. `fields`는 칸별 오류 목록 `[{ path, message }]`(재접촉 입력·투입 파일처럼 "몇 번째 칸이 왜"가 필요할 때). 오류 코드·스택은 로그에만 | NFR10, 상호작용 명세 2.8·2.15 |
| HTTP 상태 | 200 성공, 400 입력 검증 실패(`fields`), 401 접속 보호 거부, 403 담당자 키 없음·목록에 없음·보기 전용, 404 없는 ID, 409 낡은 평가 기준 요청(`kind: STALE_EVALUATION`, 승인·기한 체크), 422 규칙상 불가(승인 조건 미충족, 자동 읽기 불가, 출력 거부 등 — 이유 포함), 429 비밀번호 연속 실패 대기, 500 저장 실패(흐름 되돌림, `ref`), 503 외부 호출 실패·상한 초과 | NFR10 |
| 응답 시간 | 성능 목표(NFR2): 목록·상세 3초, 평가 1건 1초, 근거 추출 1건 60초. 요청 중단 한도(상호작용 명세): 목록·상세·대시보드 10초, `/homepage` 전체 60초(홈페이지 읽기 + LLM 합산, 남은 시간 안에서만 재시도), 외부 소스 API 30초, 수집 전체는 한도 없음(진행 출력). 두 값은 다른 것(목표 vs 중단) | NFR2, 상호작용 명세 1장 |
| 재시도 | 외부 읽기(홈페이지 HTTP·소스 API)만 1회, 같은 요청을 다시 보내도 부작용이 없을 때. LLM 호출 재시도도 1회이되 **집계와 TransferLog에는 호출마다 1행**(2회면 2행, 비용도 2회). DB 저장은 재시도하지 않고 흐름 전체를 되돌림(ADR-009). SQLite 쓰기 잠금 대기는 5초, 넘으면 500 + 되돌림 | NFR7, ADR-009 |
| 동시 수정 | 모든 기록(의견·담기·승인·결과)은 응답에 `version`·`updatedBy`·`updatedAt`을 싣고, 기록 요청은 `expectedVersion`을 보낸다. 서버가 더 새 `version`을 가지면 **저장은 하되 200에 `meta.previousValue`**를 실어 "다른 담당자가 방금 바꿨습니다"를 보이게 한다(FR7.6 마지막 저장이 이김). 409는 동시 수정에 쓰지 않고 "낡은 평가 기준"에만 쓴다 | FR7.6 |
| 낡은 평가 | 접촉 승인과 기한 체크는 요청의 `evalId`가 그 기회의 **최신 확정 평가**와 다르면 409(`kind: STALE_EVALUATION`, "다시 평가되었습니다. 새 평가를 확인해 주세요")로 거부하고 저장하지 않는다. 승인 가능 검사는 항상 최신 평가 기준이다. 의견은 낡은 evalId여도 저장한다(본 평가 기록이 목적) | FR7.1, FR7.4 |
| 부분 실패 | 수집·출력에서 일부 소스가 실패하면 성공분과 실패분을 분리해 돌려주고 합계를 완전한 것처럼 보이지 않는다. 전송 보호가 `allowed=false`면 부분 전송 없이 전체 중단 | NFR10, C4 |
| 로그 | 모든 오류는 `ref`와 함께 서버 로그에. 본문·비밀번호·API 키·금지 원문은 로그에 남기지 않는다 | NFR4·NFR5 |

## 4. 계약별 명세

### C0. 공통 코드표 (DB·API·화면·파일이 같은 값, FR4.10)

```yaml
# shared-schema: 열거값. 저장·전송은 영문 코드, 화면은 /config/ui 코드표로 쉬운 말.
classificationCode: [FILTER_EXCLUDED, FILTER_PENDING, OPS_PENDING, NOT_EVALUATED, CONTACT_URGENT, CONTACT_PLANNED, CONTACT_REVIEW, RESEARCH, CONDITIONAL_WAIT, WATCH, LOW]   # + displayFlags.coreEvidenceRecheck
datasetKind: [VIRTUAL_REVIEWED, BROCHURE, COMPANY_CONFIRMED]
reviewStatus: [UNAVAILABLE, PENDING, REVIEWED, RECHECK]            # 미확보 / 검수 대기 / 검수 완료 / 재확인
relationStatus: [NEW_CONFIRMED, EXISTING_CONFIRMED, UNCONFIRMED]
purpose: [NEW_PROPOSAL, FOLLOW_UP_PROPOSAL, REORDER_CHECK]         # 대응 목적
interactionKind: [TRADE, QUOTE, CONSULT, PROPOSAL, MEMO]            # 재접촉 입력(C1 /recontact)은 MEMO 제외 — 재접촉 용도는 보류(2026-11-03, U6 보류). 고객 관계 표시(FR2.7·S04)용으로는 그대로 씀
pathKind: [PROCESS_DEMAND, CERTIFICATION, HISTORY]
reqKind: [CERTIFICATION, APPROVAL, TECHNICAL, QUANTITY_DELIVERY]
reqLevel: [REQUIRED, PREFERRED, NOT_REQUIRED, UNKNOWN]
neededStage: [NOW, LATER, UNKNOWN]
scopeKind: [OPPORTUNITY, PROCESS_LINK]
signalKind: [EXPANSION, NEW_ORDER, BID, HIRING, REORDER_CYCLE, NEXT_CONTACT]
certainty: [CONFIRMED, STRONG, WEAK, UNKNOWN]                       # 확인 / 강한 추정 / 약한 추정 / 미확인
securityGrade: [PUBLIC, EXTERNAL_AI_OK, INTERNAL_ONLY, FORBIDDEN, UNKNOWN]
sourceGrade: [A, B, C, D]
itemState: [CONFIRMED, STRONG, WEAK, MISMATCH, NO_BONUS, NO_SIGNAL, UNAVAILABLE]
checkResult: [PASS, UNKNOWN, EXCLUDED]                              # 규칙 엔진 판정
checkDisplay: [PASS, LATER_STAGE, QUESTION_NEEDED, PENDING_BLOCKS, EXCLUDED]   # 화면 표시(변환 규칙은 C3)
filterState: [PASS, PENDING, EXCLUDED]
opinion: [WORTH_REVIEW, NEED_CHECK, NOT_TARGET]
approvalStatus: [UNDECIDED, APPROVED, REJECTED, CANCELLED]
approvalPurpose: [CONFIRM_REQUIREMENT, INTRODUCE_REVIEWED_CAPABILITY, FOLLOW_UP_PREVIOUS_PROPOSAL, SCHEDULE_RESPONSE]
outcomeStatus: [NOT_EXECUTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST]   # (갱신 2026-11-03, PM 결정 Q2) INTERESTED "관심" 추가(미접촉 다음). 쉬운 말: 미접촉 / 관심 / 접촉 / 견적·샘플 / 보류 / 성사 / 거절. 담기 대신 씀 **(바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356)** `INTERESTED`를 지운다. 쉬운 말: 미접촉 / 접촉 / 견적·샘플 / 보류 / 성사 / 거절. 관심은 단계가 아니라 C1 `/bookmark`의 켜고 끄는 표시다. 저장돼 있던 `INTERESTED` 행은 마이그레이션이 `NOT_EXECUTED`로 바꾸고 그 기회를 관심으로 켠다
contactMethod: [CALL, EMAIL, VISIT]                                 # (추가 2026-11-03, U5 메모 4장) 접촉 방법: 전화 / 메일 / 방문
contactResult: [REACHED, ABSENT, DECLINED]                          # (추가 2026-11-03, U5 메모 4장) 접촉 결과: 연결됨 / 부재 / 거절
judgmentCheck: [MATCHED, MISMATCHED, UNKNOWN]                      # (추가 2026-11-09 PM 결정 #531) 접촉 때 AI 판단이 맞았나: 맞음 / 다름 / 모름. 영업 성과와 별개다. 이미 외주처가 있어 거절해도 사실 판단이 맞으면 맞음
salesStep: [NOT_REACHED, REACHED, DEMAND_CONFIRMED, MATERIAL_QUOTE, VISIT_SAMPLE]   # (추가 2026-11-12 PM 결정 #607) 영업 세부 단계: 연결 전 / 연결됨 / 수요 확인 / 자료·견적 / 방문·샘플. 큰 단계(outcomeStatus) 안의 단계다: 앞 셋은 IN_PROGRESS(접촉), 뒤 둘은 SAMPLE_OR_REGISTRATION_APPROVED(견적·샘플). 성사·거절·보류는 세부 단계 없이 outcomeStatus만 쓴다. 접촉 횟수가 아니라 꼬리 질문 답으로 알아낸 사실로 정한다(C1 /outcomes)
noteKind: [MEMO, RESEARCH, REPLY]                                   # (추가 2026-11-03 밤, 상세 화면 (5)) 영업 메모 종류: 메모 / 자료 조사. 접촉 횟수에는 안 셈. (추가 2026-11-04 PM 결정) REPLY = 질문 답 이력: 검토사항에서 답을 저장할 때마다 rec_note에 새 행(새 표 없이 이력 보존). 화면 메모 입력에서는 고를 수 없음
lostReasonCode: [PRICE, LEAD_TIME, INCUMBENT_SUPPLIER, NO_DEMAND, QUALITY_CERT, OTHER]   # (추가 2026-11-04 PM 결정, 분석용 코드값 칸 1개) 거절 이유: 가격 / 납기 / 기존 거래처 유지 / 수요 없음 / 품질·인증 요건 / 기타. 영업 단계 LOST 저장 때 필수, OTHER면 기존 자유 글 reason 필수. 쉬운 말은 web/src/labels/ko.ts
contactBucket: [NOW, CHECK, LATER]   # (추가 2026-11-13 #610 — PM 확인 필요) 추천 목록의 세 묶음: 지금 연락할 곳 / 확인 필요 / 나중. 저장하지 않고 목록을 읽을 때마다 계산한다(DB 변경 없음). 부록 F 점수·분류(classificationCode)·기존 순위(original_rank)는 바꾸지 않는다
bucketBasis: [EXCLUDED_OPINION, REQUIRED_FAILED, EXISTING_CUSTOMER, CLOSED_OR_HOLD, IN_PROGRESS, NEED_CHECK_OPINION, REQUIRED_PENDING, OWN_PLATING, NOT_EVALUATED_HIGH_FIT, NOT_EVALUATED_LOWER_FIT, EVIDENCE_RECHECK, REQUIRED_PASSED, MONITOR]   # (추가 2026-11-13 #610 — PM 확인 필요) 그 묶음에 든 이유(카드 꼬리표). 위에서부터 처음 맞는 줄 하나: 최신 검토 의견 NOT_TARGET → LATER·EXCLUDED_OPINION / 분류 FILTER_EXCLUDED → LATER·REQUIRED_FAILED / relationStatus EXISTING_CONFIRMED → LATER·EXISTING_CUSTOMER / 최신 영업 단계 WON·LOST·ON_HOLD → LATER·CLOSED_OR_HOLD / 최신 영업 단계 IN_PROGRESS·SAMPLE_OR_REGISTRATION_APPROVED → NOW·IN_PROGRESS / 최신 검토 의견 NEED_CHECK → CHECK·NEED_CHECK_OPINION / 분류 FILTER_PENDING·OPS_PENDING → CHECK·REQUIRED_PENDING / 평가 전(분류 NOT_EVALUATED 또는 점수 없음) + 표면처리 직접 표시 → CHECK(묶음 맨 뒤)·OWN_PLATING / 평가 전 + 적합도 HIGH → CHECK·NOT_EVALUATED_HIGH_FIT(설정 contactList.unscoredHighFitToNow가 true면 NOW) / 평가 전 + 적합도 MEDIUM·LOW·없음 → LATER·NOT_EVALUATED_LOWER_FIT / 핵심 근거 재확인 표시(coreEvidenceRecheck) 또는 분류 CONTACT_REVIEW → CHECK·EVIDENCE_RECHECK / 점수가 있는데 표면처리 직접 표시 → CHECK·OWN_PLATING / 막는 조건 없음(blocker.blocksApproval false) + 분류가 설정 contactList.nowClassifications 안 → NOW·REQUIRED_PASSED / 그 밖 → LATER·MONITOR. 필수 판정을 우회하지 않는다: 필수 탈락·제외 의견·거래 중은 설정과 무관하게 NOW에 들지 않는다
reviewItemKind: [QUESTION, DATA_NOT_FOUND, DATA_INSUFFICIENT]       # (추가 2026-11-03 밤, 상세 화면 (3) 검토사항) AI 확인 질문 / 자료 못 찾음 / 자료 부족
#   (추가 2026-11-05 저녁 PM 반영, AI 점수 제안 1차 최소 범위 #286) reviewItemKind에 ITEM_INPUT_PROPOSAL(AI가 제안한 점수 입력 항목)·PROCESS_LINK_PROPOSAL(AI가 제안한 공정 연결)을 더한다. 출처는 reviewItemSource AI
#   (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) 코드표에 더하는 것: discoverySource: [CASE_FILE, FACTORY_FILE, WEB_SEARCH](회사가 목록에 들어온 길), fitLevel: [HIGH, MEDIUM, LOW](AI가 본 공정 적합도 — 점수 전 회사를 줄 세우는 데만 쓴다), reviewItemKind에 REGISTRY_NOT_FOUND(웹에서 찾았지만 공공 등록 자료에서 못 찾은 회사, 출처 RULE)
#   (추가 2026-11-06 PM 결정, 표면처리를 직접 하는 회사 표시 #319) reviewItemKind에 OWN_PLATING_LINE_SUSPECTED(표면처리를 직접 하는 회사일 수 있음, 출처 AI 또는 RULE)를 더한다. C5 소스 표시 코드의 같은 이름과 뜻이 같다
#   (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) discoverySource에 FACTORY_API(공장현황 파일에는 없고 공장등록 조회의 단지 입주 목록에만 있던 회사)를 더한다. 파일과 조회 양쪽에 있는 회사는 FACTORY_FILE 그대로
reviewItemSource: [AI, CASE_FILE, RULE]                             # 검토사항 항목 출처: AI 조사 / 사례 파일 / 평가 규칙에서 파생
questionStatus: [WAITING, REQUESTED, REPLIED, APPLIED]
questionTargetKind: [QUALIFICATION, PROCESS, CAPABILITY, FIELD, REQUIREMENT, OPPORTUNITY]
transferPurpose: [EXTERNAL_AI, OUTPUT_EXPORT, EXTERNAL_SEARCH, EXTERNAL_GEOCODE]   # EXTERNAL_GEOCODE 추가 2026-11-03(PM 결정, 거리 기능 #222): 주소→좌표 변환 호출
transferItemKind: [PUBLIC_TEXT, EVIDENCE, OPPORTUNITY_INFO, QUESTION, CAPABILITY_VALUE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION]
staffKey: 영문·숫자·하이픈(예: park-lee), 예약 키 viewer(보기 전용)
```

### C1. 화면 ↔ 웹 API (HTTP JSON REST, OpenAPI)

공통: 모든 기록 요청에 **담당자 키 헤더 `X-Staff-Key`**(C0 `staffKey`, 영문·숫자만이라 브라우저 헤더에 안전). 서버는 앱 설정의 담당자 목록에 있는 키만 받고 없으면 403, `viewer`면 기록 요청 403. 화면 표시 이름은 `/config/ui`의 담당자 목록(키 ↔ 표시 이름)에서 가져온다. 접속 보호가 켜진 환경에서는 세션 쿠키 필수(없으면 401). 성공 응답은 `{ "data": …, "meta": { "updatedAt", "hasVirtualData", "datasetKind", "previousValue"?, "reevaluated"?, "evaluatedAsNew"? } }`. 목록은 쪽당 20건(`page`, `pageSize` 최대 50). 시각은 ISO 8601 + 시간대. 분류·상태 값은 C0 코드로 보내고 화면이 코드표로 바꾼다.

**보안 경계**: 세션 쿠키는 `HttpOnly; Secure; SameSite=Lax`, 만료 12시간(AccessSession.expiresAt), 화면과 API가 같은 출처라 CORS를 열지 않는다. 비밀번호 5회 연속 실패 시 서버가 30초 동안 429(`retryAfterSeconds: 30`)를 돌려준다(서버가 센다, 화면 안내는 보조). 모든 기록 행에 세션 식별자(또는 접속 기록 ID)를 함께 남겨 추적한다. **알려진 잔여 위험**: 담당자 키는 인증되지 않은 값이라 세션 안에서 다른 담당자 키를 보낼 수 있다. 계정 없는 첫 버전의 한계이며 실제 거래처 입력 전 담당자별 계정(FR14.3, G0 이후)으로 닫는다.

**응답 조립 규칙(동시 작업 충돌 방지)**: 근거 상세는 영역별 구성 함수를 **등록**하는 방식(`detail_sections` 목록에 단위별 파일이 자기 영역 함수를 추가)으로 조립하고, 목록은 단위별 **필터 함수 등록**(`list_filters`: `bookmarked`는 U5, `tab=recontact`는 U6, `q`·`filter`는 U7)으로 처리해 `opportunities.py`를 여러 단위가 고치지 않게 한다.

```yaml
openapi: 3.1.0
info:
  title: 거산 영업지원 API
  version: 1.0.0
  description: 화면(React)이 쓰는 내부 API. 밖에 공개하지 않음. 뒤 단위가 경로 묶음을 추가하며 깨는 변경은 /api/v2.
servers:
  - url: /api/v1
components:
  securitySchemes:
    session:
      type: apiKey
      in: cookie
      name: geosan_session
  parameters:
    staffKey:
      name: X-Staff-Key
      in: header
      required: false
      schema: { type: string, pattern: '^[a-z0-9-]{1,32}$' }
      description: 담당자 키. 기록 요청에는 필수. 목록에 없으면 403, viewer면 기록 거부(403)
    page: { name: page, in: query, schema: { type: integer, default: 1, minimum: 1 } }
    pageSize: { name: pageSize, in: query, schema: { type: integer, default: 20, maximum: 50 } }
  schemas:
    Envelope:
      type: object
      required: [data, meta]
      properties:
        data: {}
        meta:
          type: object
          properties:
            updatedAt: { type: string, format: date-time }
            hasVirtualData: { type: boolean }
            datasetKind: { type: string }
            previousValue: { description: 동시 수정 때 이전 값(기록 종류별 객체) }
            reevaluated: { type: boolean }
            evaluatedAsNew: { type: boolean }
            total: { type: integer }
    Error:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [message, nextAction, ref]
          properties:
            message: { type: string, description: 쉬운 한국어 }
            nextAction: { type: string }
            ref: { type: string, description: 로그 대조용 }
            kind: { type: string, description: '화면 분기용(비노출): ROBOTS_DISALLOW, TERMS_DISALLOW, UNREACHABLE, STALE_EVALUATION, STALE_VALUE, EXPORT_REJECTED, LLM_LIMIT, SEARCH_LIMIT, USAGE_UNCONFIRMED, LLM_NOT_CONFIGURED, TIMEOUT, LLM_FAILED(2026-11-04 추가, /homepage 실패 구분), HOMEPAGE_NOT_FOUND(2026-11-12 추가 #596, /homepage 홈페이지 다시 찾기 실패), …' }
            fields: { type: array, items: { type: object, properties: { path: { type: string }, message: { type: string } } } }
            retryAfterSeconds: { type: integer }
            rejectedItems: { type: array, items: { type: object, properties: { refId: { type: string }, reason: { type: string } } } }
    RecordMeta:
      type: object
      description: 기록마다 붙는 동시 수정 정보
      properties:
        version: { type: integer }
        updatedBy: { type: string, description: staffKey }
        updatedAt: { type: string, format: date-time }
    OpportunityCard:
      type: object
      required: [oppId, rank, title, classificationCode, blocker, reason, nextAction, isVirtual, isRecontact, evalId, records]
      properties:
        oppId: { type: string }
        rank: { type: integer, description: '(갱신 2026-11-03 밤) process 조건이 있으면 그 공정 안 순위, 없으면 전체 순위' }
        processCodes: { type: array, items: { type: string }, description: '(추가 2026-11-03 밤 PM 결정, 공정별 구분) 이 기회에 연결된 거산 공정 코드(processLinks). 카드 꼬리표 "전기아연도금"은 역량 파일 이름으로' }
        confirmedProcessCodes: { type: array, items: { type: string }, description: '(추가 2026-11-13 #659 — PM 결정 2026-11-13) processCodes 가운데 확정된 공정 연결(C6 opp_process_link state CONFIRMED: 사례 파일 또는 담당자 확정)만, 역량 파일 순서. 카드 공정 꼬리표는 이 값만 보인다. AI가 제안만 하고 아직 확인 안 된 공정(state PENDING)은 들어가지 않는다. processCodes의 뜻(확정 + 제안, 공정 선택란·묶음 순서·process= 거르기가 씀)은 그대로' }
        proposedProcessCount: { type: integer, description: '(추가 2026-11-13 #659 — PM 결정 2026-11-13) processCodes 가운데 아직 확정되지 않은(AI 제안) 공정 수 = processCodes 수 − confirmedProcessCodes 수. confirmedProcessCodes가 비어 있고 이 값이 1 이상이면 화면이 카드 "검토사항" 줄 뒤에 "맞는 공정이 아직 확인 전 · AI 제안 5개"를 덧붙인다(서버의 blocker.text는 바꾸지 않는다, 새 검토사항 종류 없음)' }
        region: { type: string, nullable: true, description: '(추가 2026-11-03 밤 PM 결정, 지역 선택) 회사 주소에서 뽑은 시·군 이름. 규칙: 첫 어절이 "○○광역시"·"○○특별시"·"세종특별자치시"면 그 이름(대전, 세종), 아니면 둘째 어절(천안시, 아산시, 당진시). 주소 없으면 null("지역 미확인")' }
        industries: { type: array, items: { type: string }, description: '(추가 2026-11-03 밤 PM 결정, 산업 선택) 회사 산업군(설정 industries 안 값, ≤3). 카드 꼬리표. 상세 머리 industries와 같은 값' }
        title: { type: string, description: 기업 · 기회 이름 }
        ingestBatchId: { type: string, nullable: true, description: '(추가 2026-11-04 PM 결정 ①, #221) 이 회사가 들어온 수집 회차. 사례 파일 투입은 null' }
        ingestedAt: { type: string, nullable: true, description: '(추가 2026-11-04 PM 결정 ①) 들어온 시각. 카드 꼬리표 "11/20 들어옴" (바뀜 2026-11-09 PM 결정 #516) 들어온 회사의 꼬리표는 이 날짜 하나뿐이다("이번에 들어옴"은 없앰). 정렬 sort=recent의 기준' }
        isNewInLatestBatch: { type: boolean, description: '(추가 2026-11-04 PM 결정 ①) 마지막 수집 회차에 들어온 회사면 true → 카드 꼬리표 "이번에 들어옴" (바뀜 2026-11-09 PM 결정 #516) 값은 계속 주되 화면은 쓰지 않는다. 꼬리표는 ingestedAt으로만 단다' }
        distanceKm: { type: number, nullable: true, description: '(추가 2026-11-03 PM 결정, 거리 #222) 거산 기준 주소(설정 geosan.address)에서의 직선거리 km. 좌표 없으면 null(화면 "거리 미확인"), 가상 사례는 null("가상·거리 없음")' }
        classificationCode: { type: string }
        coreEvidenceRecheck: { type: boolean }
        scoreS: { type: number, nullable: true }
        scoreDisplay: { type: string, description: "카드 점수 문자열(BR10.2). '<E>점 · <n>/<전체>'(E 확인된 점수, n 미확보가 아닌 항목 수, 전체 신규 8·재접촉 7; 예 '77점 · 7/8'), 판정 0개면 '--', 소개서 묶음이고 분류가 기다리는 중·준비 중이면 '참고 ' 접두(예 '참고 50점 · 3/8'), ~~소개서 묶음이 아닌데 그 분류면 '--'~~ (2026-11-04 PM 결정 #212 ①: 소개서 묶음이 아니어도 점수가 있으면 '<E>점 · n/전체' 그대로 보내고 scoreState PENDING으로 표시. 화면이 흐리게 + relationStatus UNCONFIRMED면 꼬리표 \"거래 확인 전\"). 더하는 변경(값 형식만): 2026-10-21 PM '정수 / -- / 참고 N' → 2026-10-28 PM #180 → 2026-11-04 PM #212" }
        scoreState: { type: string, enum: [CONFIRMED, PENDING, NONE], description: '(추가 2026-11-04 PM 결정 #212 ①) CONFIRMED = 점수 그대로 진하게 / PENDING = 분류가 FILTER_PENDING·OPS_PENDING인데 점수가 있음 → 화면이 흐리게 / NONE = 점수 없음(scoreDisplay --). 정렬은 바꾸지 않음(계산 점수 E 기준 그대로)' }, researchState: { type: string, nullable: true, enum: [RUNNING, NOT_FOUND, READ_FAILED, NOT_TRIED, NO_SCORE_EVIDENCE], description: '(추가 2026-11-12 PM 결정 #596) 점수가 아직 없는(scoreS null) 후보 찾기 회사의 조사 상태. 카드는 RUNNING이면 "조사 중", 나머지는 모두 "조사 중단"만 보이고, 상세 머리(같은 칸 header.researchState)가 이유를 "조사 중단 · 홈페이지 못 찾음"처럼 보인다. RUNNING = 들어온 찾기 회차가 아직 찾거나 조사하는 중 / NO_SCORE_EVIDENCE = 조사는 끝났지만 점수 항목에 들어갈 근거가 없음 / NOT_FOUND = 홈페이지를 못 찾음 / READ_FAILED = 홈페이지는 찾았지만 조사가 끝나지 않음(읽기 실패 등) / NOT_TRIED = 조사를 시도하지 않음. 점수가 있거나 사례 파일 회사면 null. 더하는 변경' }
        relationStatus: { type: string, enum: [NEW_CONFIRMED, EXISTING_CONFIRMED, UNCONFIRMED], description: '(추가 2026-11-04 PM 결정 #212 ①) 상세 머리와 같은 값. UNCONFIRMED → 점수 옆 꼬리표 "거래 확인 전", EXISTING_CONFIRMED → 꼬리표 "기존 거래처"' }
        reason: { type: string }
        blocker: { type: object, properties: { text: { type: string }, blocksApproval: { type: boolean } } }
        contactCount: { type: integer, description: '(추가 2026-11-03 밤 PM 반영, 상세 화면 (5)) 전화·메일·방문 접촉 시도 수. 상세 records.contactCount.total과 같음' }   # (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) 취소된 행은 세지 않는다
        salesStep: { type: string, nullable: true, enum: [NOT_REACHED, REACHED, DEMAND_CONFIRMED, MATERIAL_QUOTE, VISIT_SAMPLE], description: '(추가 2026-11-12 PM 결정 #607) 세부 단계(C0 salesStep). 접촉 시도 행이 없거나 큰 단계가 ON_HOLD·WON·LOST면 null. 상세 records.salesStep.code와 같음' }
        nextAction: { type: string }
        records: { type: object, properties: { opinion: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { opinion: { type: string, nullable: true } } } ] }, bookmark: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { active: { type: boolean } } } ] }, outcome: { type: object, nullable: true, description: '(추가 2026-11-04 PM 결정 #242) 이 기회의 최신 영업 단계. 상세 records.outcome.status와 같은 값. 기록이 없으면 null. 기존 stage(숫자)는 바꾸지 않음', required: [status], properties: { status: { type: string, enum: [NOT_EXECUTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST] } } } } }   # (바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356) `bookmark`를 다시 쓴다: 관심 표시의 최신 값(RecordMeta + active). 한 번도 켠 적이 없으면 null. 상세 `records.bookmark`도 같은 모양. `outcome.status`에서 INTERESTED 삭제 (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) `outcome`은 취소된 행을 뺀 최신 행으로 정한다(취소하면 그 전 기록으로 돌아가고, 남은 행이 없으면 null)
        stage: { type: integer, minimum: 1, maximum: 6, nullable: true }
        isVirtual: { type: boolean }
        isRecontact: { type: boolean }
        recontact: { type: object, nullable: true, description: '재접촉 카드 전용(U6): pastTrade, reasonToRecontact, hasEstimated' }
        evalId: { type: string, description: 카드가 보여 주는 최신 확정 평가 ID }
        reevaluated: { type: boolean, description: '카드의 evalId(최신 확정 평가)가 순위를 정한 FULL 묶음의 평가와 다르면 true (기능 명세 W5; 2026-10-22 PM 확인, 이슈 #33)' }
        bucket: { type: string, enum: [NOW, CHECK, LATER], description: '(추가 2026-11-13 #610 — PM 확인 필요) C0 contactBucket. 모든 정렬(sort)에서 준다' }
        bucketBasis: { type: string, description: '(추가 2026-11-13 #610 — PM 확인 필요) C0 bucketBasis. 그 묶음에 든 이유 하나. 카드 꼬리표(예: "필수조건 통과", "평가 전 · 적합도 상"). 모든 정렬에서 준다' }
        rankAdjust: { type: object, nullable: true, description: '(추가 2026-11-13 #610 — PM 확인 필요) 영업 결과로 묶음 안 순서를 올리거나 내린 근거. 카드의 공정 × 산업군 쌍마다 이 회사를 뺀 같은 쌍 회사들의 최근 windowDays 안 성사·거절을 회사 수로 센다(세는 방법은 영업 분석표 /sales-analysis와 같음: 접촉 시도가 있는 회사만, 결과 기록 시각 기준, 가상·실제는 섞지 않음). 거절은 설정 contactList.adjust.lostReasonsCounted 안 이유만 센다. 표본(성사 + 센 거절)이 가장 많은 쌍 하나만 쓴다(동수면 역량 파일 공정 순 → 설정 산업 순). 표본이 minClosedCount 미만이거나 공정·산업군이 없으면 null(카드 줄 없음). level = min(maxUp, 성사 ÷ wonPerStep 내림) − min(maxDown, 센 거절 ÷ lostPerStep 내림). 저장하지 않는다. 약속 C6에 이름만 있는 eval_rank_adjustment(사람이 순위를 고치는 표)와 뜻이 다르다 — 이것은 사람이 고친 값이 아니라 읽을 때 계산한 값이다. 모든 정렬에서 준다', properties: { level: { type: integer }, processCode: { type: string }, processName: { type: string }, industry: { type: string }, wonCount: { type: integer }, lostCount: { type: integer, description: 센 거절 수 }, countedLostReasons: { type: array, items: { type: string }, description: '센 거절에 실제로 나온 이유 코드(C0 lostReasonCode, 코드표 순서)' }, windowDays: { type: integer } } }
    OpportunityDetail:
      type: object
      description: 근거 상세 S2. 영역별 구성 함수가 조립
      properties:
        header: { type: object, properties: { title: {}, relationStatus: { description: '(명시 2026-11-04) relationStatus 코드값. 담당자가 POST /relation으로 바꿀 수 있음(1차). relationConfirmedAt·relationConfirmedBy(nullable)도 같이 보냄' }, relationConfirmedAt: { type: string, nullable: true }, relationConfirmedBy: { type: string, nullable: true }, scoreState: { type: string, enum: [CONFIRMED, PENDING, NONE], description: '(추가 2026-11-04 PM 결정 #212 ①) 카드와 같은 규칙. 상세 머리 점수 줄 흐리게 + 꼬리표' }, researchState: { type: string, nullable: true, description: '(추가 2026-11-12 PM 결정 #596) 카드 researchState와 같은 값. 상세 머리 점수 줄 옆에 "조사 중" 또는 "조사 중단 · 이유" 꼬리표. 상세의 "홈페이지 확인 필요"·"홈페이지 못 찾음" 띠는 쓰지 않음' }, purpose: {}, owner: {}, isVirtual: {}, datasetKind: {}, isRecontact: {}, homepageUrl: { type: string, nullable: true, description: '근거 출처 주소의 공통 뿌리(scheme+host). 주소 있는 근거가 없으면 null. 더하는 변경 2026-10-27 PM, #176' }, homepageStatus: { type: string, nullable: true, enum: [AI_FOUND, NEEDS_CONFIRMATION, CONFIRMED, NOT_FOUND], description: '(추가 2026-11-03 PM 결정 B) AI_FOUND = OpenAI 웹 검색이 찾음(확신도 기준 이상) / NEEDS_CONFIRMATION = 찾았지만 확신도 낮음(상세 맨 위 "홈페이지 확인 필요" 띠) / CONFIRMED = 담당자가 [맞음] 또는 주소 고침 / NOT_FOUND = 못 찾음("직접 입력" 띠, 근거 추출 건너뜀). 사례 파일로 들어온 주소는 CONFIRMED·source CASE_FILE' }, homepageConfidence: { type: number, nullable: true, description: '0~1. AI가 찾았을 때만' }, homepageSource: { type: string, nullable: true, enum: [AI, STAFF, CASE_FILE] }, industries: { type: array, items: { type: string }, description: '(추가 2026-11-03 PM 결정, 대시보드 산업군) 설정 industries 목록 안 값만, 최대 3개. AI 조사(U2)가 제안하고 담당자가 상세 머리 칩 [확정][고치기]로 정함' }, industriesSource: { type: string, nullable: true, enum: [AI, STAFF, CASE_FILE], description: '(갱신 2026-11-03 밤) CASE_FILE = 사례 파일에 사람이 적은 값(1차). AI 제안은 2차 #229' }, mainPhone: { type: string, nullable: true, description: '(추가 2026-11-03 PM 지시) 회사 대표번호. 공개 홈페이지 본문(U2 근거 추출)이나 산단공 CSV(U3)에서 자동으로 채움, 사람 입력 칸 없음. 사람 이름이 붙은 번호(담당자 휴대폰)는 채우지 않음' }, mainPhoneSource: { type: string, nullable: true, enum: [HOMEPAGE, CSV] }, mainPhoneSourceUrl: { type: string, nullable: true, description: '(추가 2026-11-03 밤 PM 반영, 상세 화면 (1)) 번호를 뽑은 페이지 주소(화면에 "출처" 링크). CSV 출처면 null' }, mainPhoneConfirmedAt: { type: string, format: date-time, nullable: true, description: '담당자가 [맞음]을 누른 시각. null이면 "담당자 확인 전"' }, mainPhoneConfirmedBy: { type: string, nullable: true, description: 'staffKey' }, address: { type: string }, distanceKm: { type: number, nullable: true, description: '(추가 2026-11-03 PM 지시) 거산 기준 주소(설정 geosan.address, PM이 정함)에서의 직선거리 km. 거리 기능(#222) 전까지 null' }, summaryLine: { type: string, nullable: true, description: '(추가 2026-11-03 PM 지시) 회사 한 줄 소개. AI 조사(U2)가 공개 본문에서 생성. 조사 전에는 사례 파일 cardReason' }, highlights: { type: array, maxItems: 3, items: { type: string }, description: '주요 특징 최대 3개(품목·공정·규모·주요 고객 같은 공개 사실만). AI 조사 전에는 빈 배열' }, researchedAt: { type: string, format: date-time, nullable: true, description: '마지막 조사 시각(AI 조사 완료 시각, 사례 파일 투입분은 투입 시각)' }, researchSource: { type: string, nullable: true, enum: [AI, CASE_FILE] }, researchStale: { type: boolean, description: '설정 research.staleAfterDays(기본 90일)보다 오래됐으면 true → 화면 "오래됨" 표시' }, scoreDisplay: { type: string, description: '카드와 같은 문자열(OpportunityCard.scoreDisplay 참고), 2026-10-28 PM #180' } } }
        stage: { type: object, properties: { current: { type: integer }, badge: { type: string, nullable: true } } }
        reasons: { type: object, properties: { reason: { type: string }, nextAction: { type: string }, questions: { type: array, items: { $ref: '#/components/schemas/Question' } } } }
        reviewItems: { type: array, description: '(추가 2026-11-03 밤 PM 반영, 상세 화면 (3) 검토사항) 저장 없이 평가 결과에서 파생한 목록 + 담당자 체크 상태. itemId는 안정 ID(예 Q:<questionId>, GAP:HOMEPAGE, GAP:EVIDENCE, GAP:ITEM:<itemCode>, GAP:REQ:<reqId>, FLAG:OWN_PLATING_LINE_SUSPECTED — 추가 2026-11-07 #363·#386). kind QUESTION = reasons.questions의 질문(targetLabel: questionTargetKind OPPORTUNITY·REQUIREMENT → "상대 회사", 나머지 → "거산"), DATA_NOT_FOUND = homepageStatus NOT_FOUND 또는 근거 0건, DATA_INSUFFICIENT = 점수 항목 itemState NO_SIGNAL·UNAVAILABLE, 요구 판정 QUESTION_NEEDED. checked는 rec_review_check의 그 itemId 마지막 행', items: { type: object, properties: { itemId: { type: string }, kind: { type: string, description: reviewItemKind }, source: { type: string, description: reviewItemSource }, text: { type: string }, targetLabel: { type: string, nullable: true, enum: ['상대 회사', '거산'] }, checked: { type: boolean }, checkedBy: { type: string, nullable: true }, checkedAt: { type: string, nullable: true }, replyText: { type: string, nullable: true, description: '(추가 2026-11-04 PM 결정, 검토사항 [답 적기]) kind QUESTION에만. q_question 회신 칸의 최신 답. 답은 영업 메모와 같은 취급(내부 전용, 외부 AI 금지, 엑셀·질문 목록 내보내기 제외)' }, repliedAt: { type: string, nullable: true }, repliedBy: { type: string, nullable: true }, note: { type: object, nullable: true, description: '(추가 2026-11-12 PM 지시 #594, 자료 줄 메모 #259·#260) kind DATA_NOT_FOUND·DATA_INSUFFICIENT 줄에만. 그 줄 번호로 저장한 자료 조사 메모 가운데 취소되지 않은 최신 하나. 없으면 null, 다른 종류의 줄은 언제나 null. 이전 메모는 활동 이력에 남는다. 영업 메모와 같은 취급(내부 전용, C4)', properties: { text: { type: string }, by: { type: string, description: staffKey }, at: { type: string, format: date-time } } } } } }
        requirements: { type: array, items: { $ref: '#/components/schemas/RequirementCheckView' } }
        approvalEligibility: { type: object, properties: { eligible: { type: boolean }, reason: { type: string }, readinessChecked: { type: boolean }, readinessNeedsRecheck: { type: boolean }, allowedPurposes: { type: array, items: { type: string } } } }
        processLinks: { type: array, items: { type: object, properties: { linkId: {}, processCode: {}, processName: {}, appliedMaterial: {}, result: {}, reason: {} } } }
        evidence: { type: array, items: { $ref: '#/components/schemas/EvidenceView' } }
        homepageNeedsConfirm: { type: boolean }
        scores: { type: object, description: '점수 키 E/P/S/R/C는 대문자 그대로(camelCase 변환 대상 아님; 2026-10-22 PM 확인, 이슈 #33)', properties: { E: { type: integer }, P: { type: integer }, S: { type: number, nullable: true }, R: { type: integer }, C: { type: number }, items: { type: array, items: { type: object, description: 'itemCode, label, state, weight, matchRate, certainty, decay, score, factJudged, summary(#139), evidenceIds: [string] (이 항목 판정에 쓴 evidence[].evidenceId, 정렬; 더하는 변경 2026-10-27 PM, #176)' } }, ruleVersion: { type: string }, datasetKind: { type: string }, evaluatedAt: { type: string } } }
        records: { type: object, properties: { contactCount: { type: object, description: '(추가 2026-11-03 밤 PM 반영, 상세 화면 (5)) 접촉 시도 행(ActivityItem CONTACT_ATTEMPT) 수. 저장 없이 셈. 메모·자료 조사는 안 셈', properties: { total: { type: integer }, call: { type: integer }, email: { type: integer }, visit: { type: integer } } }, opinion: { $ref: '#/components/schemas/RecordMeta' }, bookmark: { $ref: '#/components/schemas/RecordMeta' }, approval: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { status: { type: string }, purpose: { type: string, nullable: true }, evalId: { type: string }, basedOnPreviousEval: { type: boolean } } } ] }, outcome: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { status: { type: string, nullable: true }, lostReasonCode: { type: string, nullable: true, description: '(추가 2026-11-04 PM 결정) 최신 단계가 LOST면 거절 이유 코드(lostReasonCode), 아니면 null' }, nextScheduleAt: { type: string, nullable: true }, nextScheduleNote: { type: string, nullable: true, description: '(추가 2026-11-03 밤, PM 결정 #209) 다음 일정의 할 일 한 줄. /outcomes 저장 칸·대시보드 schedule.note와 같은 값' } } } ] } } }   # (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) contactCount와 outcome(단계·거절 이유·다음 일정·할 일)은 취소된 행을 빼고 계산한다. 최신 행을 취소하면 그 전 행의 값으로 돌아간다   # (추가 2026-11-12 PM 결정 #607) records에 salesStep을 더한다: { code: salesStep | null, since: date | null(이 세부 단계가 된 접촉 날짜), overridden: boolean(담당자가 [단계 고치기]로 정한 값이면 true), known: [{ questionId, question: string, answerId, answer: string, at: date, by: staffKey }](질문마다 취소 안 된 최신 답, 질문 파일 순서), openQuestions: [questionId](지금 세부 단계에서 아직 답이 없고 보일 조건을 채운 질문) }. 큰 단계가 ON_HOLD·WON·LOST이거나 접촉 시도가 없으면 code·since null(known은 그대로 보임). 취소된 행은 빼고 계산한다   # (추가 2026-11-13 #652 — PM 결정 2026-11-13) 여러 값을 고르는 질문(C7 choices)은 known에 고른 값마다 한 항목(같은 questionId, 그 질문에 답한 가장 최근 접촉의 값들)으로 싣는다. answer는 공정 이름·산업군 이름(목록에서 빠진 값은 "예전 보기")
        recontact: { type: object, nullable: true, description: '재접촉 상세 영역(U6): 7칸 값·확인/추정·다시 연락할 이유·후속 일정' }
        evalId: { type: string }
        previousEvalId: { type: string, nullable: true }
        reevaluated: { type: boolean, description: 'previousEvalId가 있고, 이 기회에 마지막으로 저장된 담당자 의견이 적은 evalId(의견 요청 본문의 evalId)가 현재 evalId와 다르면 true. 의견이 하나도 없으면 previousEvalId가 있는 것만으로 true. 마지막 조회 시각은 저장 항목이 없어 쓰지 않는다 (2026-10-22 PM 결정, 이슈 #33; 기능 명세 W6과 같음)' }
    RequirementCheckView:
      type: object
      properties:
        reqId: { type: string }
        name: { type: string }
        reqLevel: { type: string }
        neededStage: { type: string }
        dueAt: { type: string, nullable: true }
        capabilityStatus: { type: string, description: reviewStatus 코드 }
        result: { type: string, description: checkDisplay 코드 }
        reason: { type: string }
    EvidenceView:
      type: object
      properties:
        evidenceId: { type: string }
        sourceGrade: { type: string }
        certainty: { type: string }
        isLlmProposed: { type: boolean }
        quote: { type: string }
        sourceRef: { type: string }
        occurredAt: { type: string, nullable: true }
    Question:
      type: object
      properties:
        questionId: { type: string }
        text: { type: string }
        targetKind: { type: string }
        targetId: { type: string }
        currentValue: { type: string }
        effectIfAnswered: { type: string }
        status: { type: string }
        requestedBy: { type: string, nullable: true }
        requestedAt: { type: string, nullable: true }
        dueAt: { type: string, nullable: true }
        overdue: { type: boolean }
        replyText: { type: string, nullable: true }
        repliedAt: { type: string, nullable: true }
        repliedBy: { type: string, nullable: true, description: '(추가 2026-11-04 PM 결정) 답을 적은 담당자 키. 검토사항 [답 적기]와 질문 목록 화면이 같은 칸을 봄' }
        linkedOppIds: { type: array, items: { type: string } }
        isUserAdded: { type: boolean }
    ActivityItem:
      type: object
      properties:
        at: { type: string, format: date-time }
        actor: { type: string, description: staffKey 또는 system }
        kind: { type: string, enum: [CLASSIFICATION, OPINION, BOOKMARK, APPROVAL, CONTACT_ATTEMPT, REPLY, OUTCOME, EVIDENCE_GRADE_CONFIRMED, NOTE, RELATION_CONFIRMED, RECORD_CANCELLED] }   # (갱신 2026-11-03) NOTE 영업 메모 추가. BOOKMARK는 담기 제거로 안 씀(값은 남김). (추가 2026-11-04 PM 결정) RELATION_CONFIRMED = 거래 관계 변경 "거래 관계: 확인 전 → 거래 중 · 박 이사 · 11/20"(previousValue에 이전 코드) (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) RECORD_CANCELLED = 기록을 잘못 입력으로 표시한 행위 한 줄 "취소 · 박 이사 · 11/06"(actor는 취소한 담당자, 이유가 있으면 summary 뒤에 붙임)
        summary: { type: string }
        previousValue: { type: string, nullable: true }
        evalId: { type: string, nullable: true }
        recordId: { type: string, nullable: true, description: '(추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) 이 줄을 만든 저장 행의 번호: 메모·자료 조사·질문 답 이력은 rec_note의 번호(note…), 접촉 시도·영업 단계·다음 일정은 rec_outcome의 번호(outcome…). 그 밖의 줄(분류·의견·관심·거래 관계·취소 줄)은 null. 화면은 이 값으로 /records/{recordId}/cancel을 부른다' }
        recordKind: { type: string, nullable: true, enum: [NOTE, OUTCOME], description: 'recordId가 있을 때만. NOTE = rec_note 행, OUTCOME = rec_outcome 행' }
        cancelled: { type: boolean, description: '잘못 입력으로 표시된 줄이면 true. 줄은 지우지 않고 그대로 보낸다(화면이 줄을 긋는다). 취소된 NOTE 줄의 summary는 "(취소된 메모)"이고 본문은 보내지 않는다' }
        cancelledBy: { type: string, nullable: true, description: '취소한 담당자(staffKey). 취소되지 않았으면 null' }
        cancelledAt: { type: string, format: date-time, nullable: true }
    RecordRequest:
      type: object
      description: 의견·담기·승인·결과 공통 입력
      properties:
        evalId: { type: string, description: 실제로 본 평가 ID (의견·승인·기한 체크 필수) }
        expectedVersion: { type: integer, nullable: true, description: 화면이 받은 records.*.version }
        memo: { type: string, maxLength: 200 }
paths:
  /session:
    post:
      summary: 공용 비밀번호로 세션 만들기 (U8, 접속 보호 켜진 환경)
      requestBody: { content: { application/json: { schema: { type: object, properties: { password: { type: string } } } } } }
      responses: { '200': { description: 세션 쿠키 발급(HttpOnly·Secure·SameSite=Lax, 12시간) }, '401': { description: 비밀번호가 맞지 않습니다 }, '429': { description: '5회 연속 실패, retryAfterSeconds 30' } }
  /config/ui:
    get:
      summary: 담당자 목록(키·표시 이름)·브랜드·쉬운 말 코드표·접속 보호 여부 (U1). (추가 2026-11-03 밤, PM 결정 #209) 응답 `records: { approvalEnabled: boolean, noteMaxLength: integer }` — 설정 C7 `records` 값을 그대로. 화면은 approvalEnabled false면 승인 버튼·칸을 숨기고, noteMaxLength로 메모 글자 상한을 보여 준다 (추가 2026-11-08 PM 결정, 후보 가져오기 선택지 #424·#316) 응답 `ingestOptions: { processes: [{ code: processCode, name: string }], regions: [string], industries: [string] }` — [영업 후보 목록 › 후보 가져오기 줄] 조건 칸의 선택지. 값은 활성 묶음 역량 파일의 공정 전부(9종, 역량 파일 순서 그대로, 기회 0건인 공정도 포함), 설정 `ingestion.regions`, 설정 `industries`를 그대로 싣는다. 목록 응답의 `meta.processCounts`·`regionCounts`·`industryCounts`는 이미 들어온 회사의 건수라 아직 회사가 없는 공정을 찾는 조건 칸에는 쓰지 않는다. 화면은 이 값으로만 조건 칸을 그리고 코드에 값을 직접 적지 않는다. 선택지를 주는 새 경로는 두지 않는다. 더하는 변경 (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) 응답 `records`에 `cancelByAnyStaff: boolean`(설정 C7 `records.cancelByAnyStaff` 그대로). 화면은 false면 활동 이력의 내 기록 줄에만, true면 모든 담당자의 줄에 [잘못 입력]을 보인다. 더하는 변경 (추가 2026-11-13 #217 — PM 결정 2026-11-13) 응답 `export: { xlsxEnabled: boolean }`(설정 C7 `export.xlsxEnabled` 그대로). 화면은 true일 때만 [영업 후보 목록]에 [엑셀 내려받기] 단추를 보이고, false이거나 이 칸이 없으면 숨긴다. 스위치를 알려 주는 새 경로는 두지 않는다. 더하는 변경
      responses: { '200': { description: Envelope } }
  /opportunities:
    get:
      summary: 추천 목록 (U1 신규 탭; U6 재접촉 탭, U5 담기 토글, U7 검색·대시보드 필터는 필터 함수 등록으로 추가)
      parameters:
        - { name: tab, in: query, schema: { type: string, enum: [new, recontact], default: new } }   # recontact는 보류(U6)
        - { name: process, in: query, schema: { type: string, enum: [ZINC_PLATING, ANODIZING, BLACK_OXIDE, CHROMATE, ELECTROPOLISHING, CHROME_PLATING, ELECTROLESS_NICKEL, PHOSPHATE_COATING, PASSIVATION] }, description: '(추가 2026-11-03 밤 PM 결정, 공정별 구분) 거산 공정 코드(역량 파일 processes[].code 9종)로 거르기. 그 공정에 연결(processLinks)된 기회만. 주면 카드 rank는 **그 공정 안 순위**(1, 2, 3…), 안 주면 전체 순위. 점수·분류 계산은 바뀌지 않음(정렬 뒤 번호만). 화면 추천 목록은 공정 탭으로 보여 준다 — 재접촉 탭 자리' }
        - { name: q, in: query, schema: { type: string }, description: 고객명·기회명 부분 일치 (U7). (갱신 2026-11-03 밤) 산업군 이름도 부분 일치 } (바뀜 2026-11-06 PM 결정, 목록 머리 선택란 #361) 검색 칸을 목록 머리에도 둔다. 화면은 검색어가 있으면 process·region·industry를 보내지 않아 **전체 후보에서** 찾고 결과 위에 "전체 후보에서 찾은 결과"를 보인다. 검색어를 지우면 고른 조건으로 돌아간다. 서버의 AND 규칙은 그대로
        - { name: region, in: query, schema: { type: string }, description: '(추가 2026-11-03 밤 PM 결정, 지역 선택) 시·군 이름(예 천안시) 또는 설정 listFilters.regionPresets의 묶음 이름(예 "천안 인근" = 천안시·아산시). 회사 주소에서 뽑은 시·군(regionLabel 규칙은 카드 region 설명)과 일치하는 기회만. 좌표·API 없이 주소 글자로. km 거리(maxDistanceKm, #222)는 2차 그대로' }
        - { name: industry, in: query, schema: { type: string }, description: '(추가 2026-11-03 밤 PM 결정, 산업 선택) 설정 industries 안 값 하나. 회사 industries에 포함된 기회만. 1차는 사례 파일에 사람이 적은 값(industriesSource CASE_FILE), AI 제안(#229)은 2차. process·region·industry·stage는 모두 AND' }
        - { name: bookmarked, in: query, schema: { type: boolean } }   # (갱신 2026-11-03, PM 결정 Q2) 안 씀(담기 제거). 경로 호환을 위해 남김 **(바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356)** 다시 쓴다. true면 관심으로 켜 둔 기회만(화면 "관심 기업" 목록). false·없음은 거르지 않음
        - { name: opinion, in: query, schema: { type: string, enum: [WORTH_REVIEW, NEED_CHECK, NOT_TARGET, NONE] }, description: '(추가 2026-11-06 PM 결정 #356) 최신 검토 의견으로 거르기. NONE = 세 의견 중 아무것도 고르지 않은 기회(화면 "기타"). 관심 기업 목록의 거르기: 전체 보기(없음) / 검토 권고 / 추가 확인 필요 / 제외 기업 / 기타. bookmarked·process·region·industry·stage와 모두 AND' }   # (바뀜 2026-11-10 PM 결정 #536) 제외한 회사는 관심 기업에 들지 않으므로 관심 기업 목록의 거르기는 전체 보기 / 검토 권고 / 추가 확인 필요 / 기타 넷이다. 화면 "제외한 회사" 보기는 bookmarked 없이 opinion=NOT_TARGET을 보낸다(공정·지역·산업과 AND). 값 목록은 그대로
        - { name: stage, in: query, schema: { type: string, enum: [NOT_EXECUTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST] }, description: (추가 2026-11-03, Q2) 영업 단계(outcomeStatus 최신 값)로 거르기. 대시보드 건수를 누르면 이 조건으로 열림 (U5·U7) } (바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356) INTERESTED 삭제
        - { name: filter, in: query, schema: { type: string, enum: [TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY] }, description: 대시보드 건수 조건 (U7) — (갱신 2026-11-03) 건수 재정의로 SCHEDULE_DUE만 씀, 나머지 값은 남기되 안 씀 } (추가 2026-11-06 PM 결정 #356) 대시보드 건수 키 9개를 값으로 더한다: BOOKMARKED, NO_OPINION, NEED_CHECK, NOT_TARGET, NOT_CONTACTED, IN_CONTACT, QUOTE_SAMPLE, ON_HOLD, DONE. 대시보드 칸을 누르면 `?filter=<키>`로 열리고, 목록은 대시보드와 같은 한 곳의 분류 규칙을 써서 건수가 늘 같다 (바뀜 2026-11-10 PM 결정 #536, 깨는 변경 v4) 대시보드 칸에서 NOT_TARGET이 빠져 값은 8개(BOOKMARKED, NO_OPINION, NEED_CHECK, NOT_CONTACTED, IN_CONTACT, QUOTE_SAMPLE, ON_HOLD, DONE). `filter=NOT_TARGET`은 400
        - { name: sort, in: query, schema: { type: string, enum: [rank, recent, distance], default: rank }, description: (추가 2026-11-03 PM 결정, 거리 #222) distance = 거산 기준 주소에서 가까운 순. 점수·순위 계산은 바뀌지 않음 (추가 2026-11-09 PM 결정 #516) recent = 들어온 시각(ingestedAt) 최신 순. 시각이 없는 사례 파일 회사는 뒤에 추천 순 그대로, 같은 시각끼리도 추천 순. 카드 rank는 그 순서 번호. 화면 정렬에 "최근 들어온 순"을 보이고 고르면 `sort=recent`를 보낸다(추천 순은 안 보냄, 주소 `?sort=recent`). #658에서 distance 서버 연결(미확인 뒤·같은 거리는 추천 순) } (바뀜 2026-11-06 PM 결정, 목록 머리 선택란 #361) 화면 목록 머리에 정렬 "추천 순 / 가까운 순 (준비 중)"을 보인다. 가까운 순 화면은 별도 연결 전까지 흐리게 보이고 서버로 `sort`를 보내지 않는다(서버는 #658에서 지원)
        #   (추가 2026-11-13 #610 — PM 확인 필요) sort 값에 contact를 더한다(enum [rank, recent, distance, contact]): 세 묶음 순(NOW → CHECK → LATER), 묶음 안은 접촉 분류(부록 F 순서 그대로: CONTACT_URGENT → CONTACT_PLANNED → CONTACT_REVIEW → 그 밖) → 공정 적합도(HIGH → MEDIUM → LOW, 없으면 설정 contactList.nullFitLevelAs) → 조정 단계(rankAdjust.level 큰 값이 위) → 시점 신호(유효 기한 가까운 순, 기한 없는 곳은 뒤 → 시점 조건 충족 수 → T 점수) → 추천 순(sort=rank의 순서). 카드 `rank`는 묶음 안 순서 번호(묶음마다 1부터). 화면 '추천 순'은 이 값을 보낸다. `sort=rank`는 그대로(기본값도 rank 그대로, 순서·번호 뜻 변화 없음). 조정은 묶음을 넘지 않고 E·P·S·R·분류·original_rank를 바꾸지 않는다
        - { name: maxDistanceKm, in: query, schema: { type: number }, description: (추가 2026-11-03 PM 결정, 거리 #222) 이 거리 안의 회사만. 선택지는 설정 distanceFilterPresetsKm(기본 30/50/100). #658에서 서버 연결: 기존 조건을 통과한 전체 회사에 페이지 나누기 전에 적용하며 경계 거리 포함·미확인 제외. 설정에 없는 값은 400. distance 정렬은 미확인 뒤·같은 거리는 기존 추천 순 유지. 점수와 기본 추천 순은 바꾸지 않음 }
        - { name: batch, in: query, schema: { type: string }, description: '(추가 2026-11-04 PM 결정 ①, 새 후보 가져오기 #221) 수집 회차 ID 또는 latest. 그 회차에 들어온 회사만(화면 "이번 수집만 / 전체" 전환). 없으면 전체 — 기존 회사는 수집해도 사라지지 않고 늘어나기만 한다 (바뀜 2026-11-09 PM 결정 #516) 화면의 "이번 수집만 / 전체" 전환은 없앴다(같은 조건을 다시 돌리거나 회차가 실패하면 비어 버림). 조건 자체는 두되 화면이 보내지 않는다. 대신 sort=recent' }
        - { $ref: '#/components/parameters/page' }
        - { $ref: '#/components/parameters/pageSize' }
      responses: { '200': { description: 'Envelope(data: OpportunityCard[], meta.total, meta.latestIngest: { batchId, sourceId, startedAt, finishedAt|null, newCount, mergeCandidateCount, researchDoneCount, status: enum[RUNNING, DONE, FAILED] } | null — (추가 2026-11-04 PM 결정 ①) 마지막 수집 회차 요약, 목록 머리 "새 후보 7곳 들어옴 · 조사 3/7 · 확인 필요 2곳"용; meta.processCounts: [{ processCode, processName, count }] — (추가 2026-11-03 밤) 탭 머리 "전기아연도금 (9)"용. 역량 파일 순서, 기회 0건인 공정은 빼고 보냄, 현재 process 조건과 무관하게 전체 건수; meta.regionCounts: [{ region, count }] 묶음 먼저(설정 순서) 그다음 시·군(건수 순); meta.industryCounts: [{ industry, count }] 설정 industries 순서, 0건 제외 — 둘 다 지역·산업 선택지 "(n)"용, 현재 process 탭 안 건수)' } }   # (바뀜 2026-11-06 PM 결정, 목록 머리 선택란 #361) `meta.processCounts`에 **기회 0건인 공정도 count 0으로 싣는다**(활성 묶음의 거산 공정 전부, 역량 파일 순서 그대로). 화면은 공정을 탭이 아니라 선택란으로 보이고 9종을 모두 보인다. "전체"는 두지 않아 항상 공정 하나가 골라져 있고(처음은 첫 공정), 순위 번호는 지금처럼 그 공정 안 순위다. 0건인 공정을 고르면 빈 목록과 안내 "이 공정의 후보가 아직 없습니다. 후보 찾기로 회사를 찾으면 여기에 나타납니다". 관심 기업 목록·대시보드 칸으로 넘어온 목록은 지금처럼 공정 구분 없이 전체이고 공정 선택란을 숨긴다 (바뀜 2026-11-06 PM 결정, 공정을 고르기 전에는 비움 #368) 위의 "항상 공정 하나가 골라져 있고(처음은 첫 공정)"을 바꾼다. 화면은 **공정을 고르기 전에는 목록을 비워 둔다**: 주소에 공정이 없으면 공정 선택란 맨 위에 "공정을 고르세요"를 보이고, 카드·쪽 넘김·지역·산업 선택란 없이 안내 "공정을 고르면 그 공정의 후보가 나타납니다"만 보인다. 꼭 골라야 하는 것은 공정 하나이고 지역·산업만으로는 목록을 보이지 않는다("전체"를 두지 않는 것과 같은 이유). **마지막으로 본 공정은 그 브라우저에 기억해**, 공정 없이 목록을 열면 그 공정으로 바로 연다. 기억한 공정이나 주소의 공정이 `meta.processCounts`에 없는 값이면 고르기 전 상태로 돌아간다. 회사 이름 검색, 관심 기업 목록, 대시보드 칸으로 넘어온 목록은 공정을 고르지 않아도 지금처럼 나온다. 서버 응답과 요청 모양은 바뀌지 않는다(화면 규칙만) (추가 2026-11-06 PM 결정, 같은 이슈) 화면은 **공정 하나를 고른 목록에서만 카드의 순위 번호를 보인다**. 검색 결과·관심 기업 목록·대시보드 칸(`filter=`·`stage=`)으로 넘어온 목록은 공정이 섞여 있어 번호를 숨긴다(서로 다른 공정을 한 줄 순위로 보이지 않는다는 11/3 결정 그대로). 서버의 `rank` 값은 그대로 준다 **(바뀜 2026-11-07 PM 결정, 공정별 묶음 보기 #383)** #361의 "전체는 두지 않는다"와 #368의 "고르기 전에는 카드·지역·산업 선택란이 보이지 않는다"를 바꾼다: 공정 선택란 맨 위가 **"전체(공정별로 묶음)"** 이고, 그 상태에서는 화면이 공정마다 `?process=<코드>`(+ 같은 region·industry)로 따로 불러 **공정별 묶음**으로 보인다. 묶음 머리는 "<공정 이름> · <지역/산업 조건> n곳", 묶음 안 번호는 서버의 공정 안 순위 그대로(1, 2, 3). 회사가 0곳인 묶음은 숨긴다. 한 회사가 두 공정에 걸리면 두 묶음에 모두 나온다. 서로 다른 공정을 한 줄 순위로 섞어 보이지 않는다는 11/3 결정은 그대로다. 지역·산업 선택란은 공정을 고르기 전에도 보이고 고를 수 있다. 처음 열면 묶음 보기이고, 지난번에 본 선택(공정 하나 또는 묶음 보기)을 브라우저가 기억해 그것으로 연다. 공정 하나를 고른 보기·검색·관심 기업 보기·대시보드 칸 목록은 그대로. 서버 응답은 바뀌지 않는다 (바뀜 2026-11-09 PM 결정, 관심 기업 보기·전체 보기 #516) 위의 "관심 기업 목록은 공정 구분 없이 전체이고 공정 선택란을 숨긴다"를 바꾼다. 관심 기업 목록(`bookmarked=true`)에도 공정 선택란을 두고 맨 위는 "전체"이며 묶지 않는다. `process=`를 함께 주면 관심 기업 안에서 그 공정만 남는다. 이때 `meta.processCounts`·`regionCounts`·`industryCounts`의 건수는 **관심 기업 안에서만** 센다(공정 9종은 0건도 그대로 싣는다). 대시보드 칸으로 넘어온 목록은 지금처럼 공정 선택란이 없다. 위의 "'전체'는 두지 않는다"도 바꾼다: 평소 목록의 정렬 줄 끝에 "전체 보기"(화면 주소 `?view=all`, 서버로는 보내지 않음)를 두어 공정 조건 없는 응답의 카드를 한 줄로 보인다. 서로 다른 공정을 한 줄 순위로 섞지 않는다는 11/3 결정의 취지는 지키도록 이 보기에서는 화면이 순위 번호를 숨긴다 (추가 2026-11-13, 걸러 본 목록의 지역·산업 곳 수 #370 — PM 확인 필요) `meta.regionCounts`·`industryCounts`는 **지금 걸러 본 목록 안의 건수**다: `process`·`batch`·`bookmarked`에 더해 `opinion`·`stage`·`filter`(대시보드 칸) 조건을 모두 적용한 뒤에 센다. 예: 관심 기업 3곳 가운데 2곳이 추가 확인 필요이고 둘 다 천안시면 `?bookmarked=true&opinion=NEED_CHECK`의 지역 곳 수는 "천안시 2"(전에는 관심 3곳 기준 3). 지금 코드가 하던 방식은 그대로 둔다: 지역·산업·검색어(`region`·`industry`·`q`) 조건은 지역 곳 수에도 산업 곳 수에도 적용하지 않고(지역을 골라도 다른 지역 선택지의 곳 수가 그대로 보인다), 0곳인 지역·산업 선택지는 싣지 않는다. `meta.processCounts`는 바꾸지 않는다(`batch`·`bookmarked`만 적용, 9종 모두 실음). 응답 칸 이름·모양은 그대로이고 뜻만 맞춘다
      #   (추가 2026-11-13 #610 — PM 확인 필요) meta.bucketCounts: { NOW: integer, CHECK: integer, LATER: integer } — 거른 조건(공정·지역·산업·검색·관심·단계·의견·filter) 안의 묶음별 건수(쪽 넘김과 무관, 합 = meta.total). 모든 정렬에서 준다. 화면은 묶음이 바뀌는 자리에 제목 + 건수("지금 연락할 곳 9곳")를 보인다. 2단계로 미룸: bucket= 거르기·묶음별 쪽 넘김, 대시보드·엑셀 반영, 상세 화면의 조정 이유
  /opportunities/{oppId}:
    get:
      summary: 근거 상세 (U1; U2·U4·U5·U6이 영역 구성 함수 등록)
      responses: { '200': { description: 'Envelope(OpportunityDetail)' }, '404': { description: 없는 기회 } }
  /opportunities/{oppId}/opinions:
    post:
      summary: 내 의견 저장 (U1). NOT_TARGET은 reason 필수. 낡은 evalId여도 저장
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [opinion, evalId], properties: { opinion: { type: string }, reason: { type: string } } } ] } } } }
      responses: { '200': { description: '저장됨 (data: RecordMeta + opinion, meta.previousValue 가능)' }, '400': { description: 사유 필요(fields) }, '403': { description: 담당자 키 없음·목록에 없음·보기 전용 } }
  /opportunities/{oppId}/notes:
    post:
      summary: (추가 2026-11-03, PM 결정 U5 메모 4장) 영업 메모 저장 (U5). 덧붙이기만, 수정·삭제 없음(Q5). 담당자명·시각 자동. 저장 뒤 ActivityItem NOTE. (추가 2026-11-08 PM 결정 #451) 요청의 evalId(선택)를 rec_note.eval_id에 저장한다. 규칙은 /outcomes와 같다(낡은 번호 허용, 다른 기회 번호 400, 없으면 비움). (추가 2026-11-12 PM 지시 #594, 자료 줄 메모 #259·#260) 요청의 itemId(선택)는 검토사항 자료 줄 번호(예 GAP:REQ:req-3)이고 rec_note.item_id에 저장한다. itemId가 있으면 kind는 RESEARCH여야 하고(아니면 400), 질문 줄(Q:로 시작)이면 400("질문 줄은 [답 적기]로 적어 주세요"), 현재 reviewItems에 없는 줄이면 404. 글자 상한은 500자(검토사항 [답 적기]와 같은 값). 같은 줄에 다시 저장하면 새 행이 쌓이고 상세에는 최신만 보인다. 점수·분류·재평가에는 영향 없음. 활동 이력 요약은 앞에 줄 글을 붙여 "자료 조사 · [자료 부족] 납품 실적 근거 없음 · 홈페이지 연혁에 2023 납품 기재 https://…"
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [text], properties: { text: { type: string, description: '상한은 설정 records.noteMaxLength(기본 200자)' }, itemId: { type: string, nullable: true, description: '(추가 2026-11-12 PM 지시 #594, 자료 줄 메모 #259·#260) 검토사항 자료 줄 번호. 없으면 지금과 같은 일반 메모' }, kind: { type: string, enum: [MEMO, RESEARCH], default: MEMO, description: '(추가 2026-11-03 밤 PM 반영) 메모 / 자료 조사. 전화·메일·방문은 /outcomes 접촉 시도 행으로(화면은 한 입력칸에서 종류를 고른다)' } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + noteId)' }, '400': { description: '글자 수 초과 (fields). (변경 2026-11-03 PM 지시) 연락처 패턴은 거부하지 않는다 — 메모는 거산 담당자의 내부 메모장이라 상대 회사 담당자 전화·이메일을 적어도 된다. 대신 메모(NOTE)는 외부 AI·검색·엑셀·질문 목록 어디에도 나가지 않는다(C4)' }, '403': { description: 담당자 키 없음·보기 전용 }, '404': { description: '(추가 2026-11-12 PM 지시 #594) itemId가 현재 reviewItems에 없음' } }
  /opportunities/{oppId}/records/{recordId}/cancel:
    post:
      summary: (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254 — PM 결정 2026-11-04 A안) 잘못 저장한 기록을 "잘못 입력"으로 표시 (U5, 2차). 행은 지우지 않고 취소한 사람·시각·이유를 그 행에 남긴다(되돌리기·내용 고치기 없음: 잘못 적었으면 취소하고 새로 적는다). 대상은 rec_note 행(메모·자료 조사·질문 답 이력)과 rec_outcome 행(접촉 시도·영업 단계·다음 일정)이고, 종류는 recordId 앞 글자(note·outcome)로 가린다. X-Staff-Key 필수. 기본은 본인이 저장한 기록만(설정 records.cancelByAnyStaff true면 누구 기록이든). 취소 뒤 현재 단계·다음 일정·거절 이유·접촉 횟수·카드 꼬리표·대시보드 건수는 취소된 행을 빼고 다시 계산되고, 활동 이력에 RECORD_CANCELLED 한 줄이 더해진다. 재평가는 하지 않는다(기록은 점수 입력값이 아님). 질문 답 이력 행을 취소해도 q_question의 최신 답 칸은 바뀌지 않는다(답은 [답 다시 적기]로 고친다). 검토 의견·관심·거래 관계·검토사항 체크는 대상이 아니다
      requestBody: { content: { application/json: { schema: { type: object, properties: { reason: { type: string, nullable: true, maxLength: 200, description: '이유(선택). rec_*.cancel_reason에 저장' }, evalId: { type: string, nullable: true, description: '화면이 보고 있던 평가 번호(선택). 다른 기회의 번호면 400' } } } } } }
      responses: { '200': { description: '취소됨 (recordId, recordKind, cancelledBy, cancelledAt)' }, '400': { description: '이유 글자 수 초과 (fields)' }, '403': { description: '담당자 키 없음·보기 전용, 또는 본인 기록이 아님("다른 담당자의 기록은 표시할 수 없습니다")' }, '404': { description: '이 기회에 그 기록이 없음' }, '409': { description: '이미 취소된 기록("이미 잘못 입력으로 표시된 기록입니다")' } }
  /opportunities/{oppId}/main-phone/confirm:
    post:
      summary: (추가 2026-11-03 밤 PM 반영, 상세 화면 (1)) 담당자가 회사 대표번호 [맞음] (U5). 번호 자체는 못 고침(사람 입력 칸 없음 유지). mainPhoneConfirmedAt·By 저장, ActivityItem 없음
      requestBody: { content: { application/json: { schema: { type: object, properties: { expectedPhone: { type: string, description: '화면이 보고 있던 번호. 서버 값과 다르면 409' } } } } } }
      responses: { '200': { description: '저장됨 (mainPhone, mainPhoneConfirmedAt, mainPhoneConfirmedBy)' }, '404': { description: '대표번호 없음' }, '409': { description: '번호가 그 사이 바뀜 (kind STALE_VALUE)' } }
  /opportunities/{oppId}/relation:
    post:
      summary: (추가 2026-11-04 PM 결정, 1차) 담당자가 거래 관계를 직접 입력·되돌림 (U5). 거산이 전달 뒤 쓰면서 알려 주는 값. 저장 뒤 그 기회를 재평가(기존 평가 진입점, 한 트랜잭션). 바꿀 때마다 opp_relation_history 1행 + ActivityItem RELATION_CONFIRMED. 같은 값으로 다시 보내면 400. X-Staff-Key 필수(viewer 403). 외부 AI·검색에는 안 나감(C4 CUSTOMER_RELATION)
      requestBody: { content: { application/json: { schema: { type: object, required: [relationStatus, evalId], properties: { relationStatus: { type: string, enum: [NEW_CONFIRMED, EXISTING_CONFIRMED, UNCONFIRMED], description: '거래 없음(신규) / 거래 중(기존) / 확인 전(되돌리기)' }, evalId: { type: string } } } } } }
      responses: { '200': { description: 'Envelope({ relationStatus, relationConfirmedAt, relationConfirmedBy, evalId: 새 평가 ID }, meta.reevaluated true)' }, '400': { description: '지금 값과 같음' }, '403': { description: 담당자 키 없음·보기 전용 }, '409': { description: 'evalId가 최신 평가가 아님 (kind STALE_EVALUATION)' } }
  /opportunities/{oppId}/review-items/{itemId}/check:
    post:
      summary: (추가 2026-11-03 밤 PM 반영, 상세 화면 (3) 검토사항) 담당자 체크·해제 (U5). 체크·해제 모두 rec_review_check 새 행(Q5 지우기 없음), 담당자명·시각 자동
      # (추가 2026-11-09 PM 승인, #497 댓글) AI 점수 제안 II:<itemCode>는 checked:true로 확정. stepLabel을 더하면 해당 항목 matchRateSteps의 단계 이름으로 고침. 공정 제안 PL:<processCode>는 확정만 허용. 제안 줄 checked:false, PL·일반 줄의 stepLabel 값은 400. 저장·재평가·활동 이력을 한 트랜잭션으로 처리하며 사람 값은 AI가 덮지 않음
      # 상세 reviewItems의 II: 줄에 stepOptions: [string]을 추가(설정 단계 이름 순서), 다른 줄은 null. 제안의 근거 인용을 보이며 기존 질문·확인 줄은 그대로 유지. C6의 기존 열로 출처·확정 정보를 표현(#286)
      requestBody: { content: { application/json: { schema: { type: object, required: [checked, evalId], properties: { checked: { type: boolean }, evalId: { type: string }, stepLabel: { type: string, nullable: true, description: '선택. AI 점수 입력 제안의 고칠 단계 이름. 생략·null이면 제안값 그대로 확정' } } } } } }
      responses: { '200': { description: '저장됨 (itemId, checked, checkedBy, checkedAt)' }, '404': { description: 'itemId가 현재 reviewItems에 없음' }, '403': { description: 담당자 키 없음·보기 전용 } }
  /opportunities/{oppId}/bookmark:
    put:
      summary: 담기 켜고 끄기 (U5) — (갱신 2026-11-03, PM 결정 Q2) **안 씀.** 담기 대신 영업 단계 INTERESTED(관심)를 /outcomes로 기록. 경로는 지우지 않고 남김(깨는 변경 아님) **(바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356) 다시 쓴다.** 화면 이름은 "관심". X-Staff-Key 필수(viewer 403). 켜고 끌 때마다 새 행을 쌓고 마지막 행이 현재 값(팀이 함께 씀, 누가 언제 바꿨는지 남음). 이미 같은 값이면 새 행 없이 지금 값을 돌려준다. **끄기 거부**: 그 기회에 메모·영업 단계(접촉·일정 포함)·검토 의견 기록이 하나라도 있으면 422 kind BOOKMARK_HAS_RECORDS("기록이 있는 회사는 관심에서 뺄 수 없습니다" / "빼려면 검토 의견을 '검토 대상 제외'로 저장해 주세요"). **자동 관심**: 관심이 꺼져 있는 기회에 `/notes`·`/outcomes`·`/opinions`를 저장하면 같은 저장 안에서 관심을 켠다(source AUTO_RECORD). (명시 2026-11-07 PM 결정 #380) 담당자가 이 세 창구로 직접 저장한 것만이다. 프로그램이 스스로 남기는 메모 행 — `POST /homepage`의 주소 변경 기록(kind RESEARCH), `POST /questions/{id}/reply`의 답 이력(kind REPLY) — 은 관심을 켜지 않는다. 그런 행만 있는 기회는 관심 기업 수에 들지 않지만, 관심을 켠 뒤 끄기는 거부된다(기록이 있으므로) 평가 evalId는 받지 않는다(관심은 평가와 무관) **(바뀜 2026-11-10 PM 결정 #536, 깨는 변경 v4) 제외한 회사는 관심 기업이 아니다.** ① `/opinions`에 NOT_TARGET을 저장하면 같은 저장 안에서 관심을 끈다(켜져 있을 때만 새 행 active false·source AUTO_RECORD. 메모·영업 기록은 그대로 남음) ② 최신 검토 의견이 NOT_TARGET인 기회는 `/notes`·`/outcomes`를 저장해도 관심을 켜지 않는다 ③ 최신 의견이 NOT_TARGET인 기회에 `PUT /bookmark` active true는 422 kind BOOKMARK_EXCLUDED("검토 대상 제외로 저장한 회사입니다" / "관심 기업에 다시 담으려면 검토 의견을 검토 권고나 추가 확인 필요로 바꿔 주세요") ④ 의견을 WORTH_REVIEW·NEED_CHECK로 바꾸면 기존 자동 관심대로 다시 켜진다. 그래서 관심 기업 가운데 최신 의견이 NOT_TARGET인 회사는 없다. 끄기 거부 안내("빼려면 검토 의견을 '검토 대상 제외'로 저장해 주세요")는 그대로이고 이제 그대로 하면 빠진다
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [active], properties: { active: { type: boolean } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + active)' } }
  /opportunities/{oppId}/approvals:
    post:
      summary: 접촉 승인·거절·취소 (U5). 승인 가능 검사는 항상 최신 평가 기준 — (갱신 2026-11-03, PM 결정 Q1 B) 설정 `records.approvalEnabled: false`(기본)면 화면에서 숨김. 경로·테이블은 유지(거산이 원하면 설정만 켬)
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [decision, evalId], properties: { decision: { type: string, enum: [APPROVE, REJECT, CANCEL] }, purpose: { type: string }, reason: { type: string } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status·purpose)' }, '409': { description: 'evalId가 최신 확정 평가가 아님 (kind STALE_EVALUATION)' }, '422': { description: '승인할 수 없는 이유(message): 필수 요구 미통과, 관계·중복 미확인, 소개서 묶음, 목적 불가' } }
  /opportunities/{oppId}/outcomes:
    post:
      summary: 영업 결과(영업 단계)·접촉 시도·회신·다음 일정 (U5). LOST는 reason 필수. (갱신 2026-11-03, Q5) 단계·일정 변경은 새 행으로 남기고 이전 행은 이력(수정·삭제 경로 없음). (추가 2026-11-08 PM 결정 #451) 요청의 evalId(선택)를 rec_outcome.eval_id에 저장한다. 의견과 같은 쪽: 낡은 번호여도 저장, 다른 기회의 번호만 400("이 기회에서 본 평가 ID를 넣어 주세요"), 없으면 비움. (추가 2026-11-09 PM 결정 #531) 요청의 judgmentCheck(선택, C0)를 rec_outcome.judgment_check에 저장한다. method가 없는 요청에 넣으면 400. 없으면 비움. 저장만 하고 1차에서는 점수에 쓰지 않는다. (추가 2026-11-12 PM 결정 #607) 꼬리 질문 답 answers(선택)와 [단계 고치기] stepOverride(선택)를 더한다. answers는 method가 있고 result가 REACHED인 요청에만(아니면 400 "연결된 접촉에서만 답을 고를 수 있습니다."), 질문 파일(C7 sales-questions.yaml)에 없는 질문·보기거나 같은 질문이 두 번이면 400(fields[].path answers[n]), 최대 20개. 답은 rec_outcome_answer에 행마다 저장(같은 질문을 다시 답하면 새 행, 최신이 현재 값). 첫 접촉 시도부터 세부 단계는 NOT_REACHED에서 시작하고, 고른 보기에 reaches가 있으면 그 단계까지 앞으로만 간다(뒤로는 stepOverride로만). stepOverride는 담당자가 정한 세부 단계로, 그 행부터 그 값에서 다시 센다. 큰 단계는 같은 저장 안에서 세부 단계를 따라 앞으로만 바뀐다: 요청 status가 NOT_EXECUTED이고 접촉 시도면 IN_PROGRESS로, 세부 단계가 MATERIAL_QUOTE 이상이고 status가 NOT_EXECUTED·IN_PROGRESS면 SAMPLE_OR_REGISTRATION_APPROVED로 저장한다. ON_HOLD·WON·LOST는 담당자가 고른 그대로 두고 바꾸지 않는다(#643부터 꼬리 질문 답으로도 정해진다). 한 줄 메모는 기존 memo 칸(연락처 검사 그대로, 설정 records.memoLineMaxLength 초기 100자) (추가 2026-11-13 #643 — PM 결정 2026-11-13) 꼬리 질문 답으로 큰 단계를 끝낸다: 이번 요청의 answers 가운데 보기에 closes(WON·LOST·ON_HOLD, C7)가 있으면 요청 status 대신 그 값을 큰 단계로 저장한다. closes가 LOST면 같은 요청의 lostReason 보기 답의 코드를 lostReasonCode로 저장하고, 그 답이 없으면 400(fields[].path lostReasonCode, "거절 이유를 골라 주세요." — 요청의 lostReasonCode 칸으로 대신하지 않는다). 그 코드가 OTHER면 기존 규칙 그대로 reason(자유 글)이 필수다(화면은 한 줄 메모를 reason에도 실어 보낸다). closes가 WON·ON_HOLD면 요청에 딸려 온 lostReasonCode·reason은 저장하지 않는다. closes·lostReason 보기 답은 그 질문의 showWhen 조건을 이번 요청의 답이 채울 때만 받는다(아니면 400 fields[].path answers[n], "앞 질문의 답과 맞지 않는 답입니다. 화면을 새로 고쳐 주세요."). answers는 result가 DECLINED인 접촉에도 받되 step이 ALL인 질문만 받는다(다른 질문이면 400 answers[n] "거절로 끝난 접촉에서는 모든 단계 질문만 답할 수 있습니다."). ABSENT·method 없는 요청은 그대로 400. closes 답이 없으면 지금 동작 그대로(앞으로만)이고, 요청 status로 단계를 직접 바꾸는 경로와 stepOverride도 그대로다. 응답·저장 표는 그대로(답은 rec_outcome_answer, 단계·거절 이유는 rec_outcome) (추가 2026-11-13 #652 — PM 결정 2026-11-13) 꼬리 질문으로 공정·산업을 확정한다: 질문 파일(C7)에서 choices가 있는 질문(PROCESS·INDUSTRY)은 여러 값을 고를 수 있어 answers에 같은 questionId를 값마다 한 개씩 보낸다(answerId = 공정 코드 또는 산업군 이름. 같은 값이 두 번이면 400 answers[n] "같은 보기를 두 번 골랐습니다."). 공정 코드는 활성 묶음의 거산 공정 목록에, 산업군은 설정 industries에 있어야 하고(아니면 400 answers[n] "질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요."), 산업군은 기존 규칙대로 3개까지다(넘으면 400 answers[n] "산업군은 3개까지 고를 수 있습니다."). "아직 모름"은 화면 전용 보기라 답을 보내지 않는다(아무것도 바뀌지 않고, 답이 없으니 다음 접촉에서 다시 묻는다). 답은 rec_outcome_answer에 고른 값마다 한 행으로 남긴다(표 그대로). 같은 저장(한 트랜잭션) 안에서 ① PROCESS: 고른 공정의 AI 제안 연결(source AI·state PENDING)은 /review-items/{itemId}/check의 공정 제안 확정과 같은 방식으로 확정한다(AI 행은 superseded로 남기고 source STAFF·state CONFIRMED·confirmedBy·confirmedAt 새 행). 연결이 없던 공정은 source STAFF·CONFIRMED 새 연결을 만들고, 이미 확정된 연결(사례 파일·담당자)은 그대로 둔다. 안 고른 AI 제안 연결은 지우지 않고 superseded로 바꿔 이 회사에서 뺀다. 안 고른 확정 연결(사례 파일·담당자)은 빼지 않는다(꼬리 질문에는 확정을 빼는 길을 두지 않는다) ② INDUSTRY: opp_customer.industries를 고른 값(설정 순서)으로 바꾸고 industriesSource STAFF, industriesConfirmedAt을 저장한다 ③ 공정 연결이 바뀌었으면 그 기회를 다시 평가하고(/relation·제안 확정과 같은 호출, 실패하면 500 RUN_FAILED로 접촉 기록까지 전부 취소), 공정이나 산업군이 바뀌었으면 활동 이력 한 줄(rec_note kind MEMO, 예 "꼬리 질문으로 공정 확정 · 아연도금 · AI 제안 4개 뺌")을 남긴다. 응답 모양은 그대로이고 다시 평가했으면 meta.reevaluated true
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [status], properties: { status: { type: string }, replyReceived: { type: boolean }, nextScheduleAt: { type: string, format: date }, nextScheduleNote: { type: string, description: '(추가 2026-11-03) 다음 일정 할 일 한 줄' }, reason: { type: string }, lostReasonCode: { type: string, enum: [PRICE, LEAD_TIME, INCUMBENT_SUPPLIER, NO_DEMAND, QUALITY_CERT, OTHER], description: '(추가 2026-11-04 PM 결정, 분석용 코드값 칸) status LOST면 필수, 다른 status면 넣지 않음(넣으면 400). OTHER면 reason(자유 글) 필수, 그 외는 reason 선택. (추가 2026-11-04 PM 결정 #250, 고선주 #257 질문 답) status LOST이고 최신 거절 행과 lostReasonCode가 같으면 reason이 비어 있어도 이전 거절 행의 reason을 이어받아 저장한다(거절 상태에서 일정·접촉만 저장할 때 이유를 다시 요구하지 않음). 코드가 바뀌거나 처음 거절일 때만 OTHER+reason 필수' }, actionId: { type: string, nullable: true }, method: { type: string, enum: [CALL, EMAIL, VISIT], description: '(추가 2026-11-03) 접촉 방법, 접촉 시도 행에만' }, result: { type: string, enum: [REACHED, ABSENT, DECLINED], description: '(추가 2026-11-03) 접촉 결과' }, attemptedAt: { type: string, format: date, description: '(추가 2026-11-03) 접촉 시도 날짜. (추가 2026-11-08 PM 결정 #432) 오늘(KST, today_in_seoul)까지만 — 뒤 날짜면 400(기존 입력 오류 형식, fields[].path attemptedAt, "앞으로 할 일은 다음 일정에 적어 주세요. 접촉 날짜는 오늘까지입니다."). 접촉 기록은 한 일이고 앞일은 nextScheduleAt에 적는다. 날짜 없는 요청·단계만 바꾸는 요청은 그대로' }, answers: { type: array, maxItems: 20, items: { type: object, required: [questionId, answerId], properties: { questionId: { type: string }, answerId: { type: string } } }, description: '(추가 2026-11-12 PM 결정 #607) 꼬리 질문 답(코드). 문구는 저장하지 않는다' }, stepOverride: { type: string, nullable: true, enum: [NOT_REACHED, REACHED, DEMAND_CONFIRMED, MATERIAL_QUOTE, VISIT_SAMPLE], description: '(추가 2026-11-12 PM 결정 #607) [단계 고치기]. method 없이도 보낼 수 있다' } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status)' }, '400': { description: 사유 필요 } }
  /sales-questions:
    get:
      summary: (추가 2026-11-12 PM 결정 #607) 꼬리 질문 묶음 (U5, 2차). 질문 파일(C7 sales-questions.yaml)을 읽어 화면에 준다. 외부 호출 없음, 저장 없음, 보기 전용도 조회
      responses: { '200': { description: 'Envelope({ version: integer, steps: [{ code: salesStep, label: string, stage: outcomeStatus }], questions: [{ questionId, text: string, step: salesStep, showWhen: { answers: { <questionId>: [answerId] } } | null, answers: [{ answerId, label: string, reaches: salesStep | null }] }] })' }, '500': { description: '질문 파일을 읽지 못함 (kind CONFIG_INVALID, 문의 번호)' } }   # (추가 2026-11-13 #643 — PM 결정 2026-11-13) answers[] 항목에 closes: 'WON' | 'LOST' | 'ON_HOLD' | null, lostReason: lostReasonCode | null 두 칸을 더한다(질문 파일 그대로, 없으면 null)   # (추가 2026-11-13 #652 — PM 결정 2026-11-13) questions[] 항목에 choices: 'PROCESS' | 'INDUSTRY' | null 한 칸을 더한다(질문 파일 그대로, 없으면 null). choices가 있는 질문은 여러 개를 고르는 질문이고 answers는 서버가 채운다: PROCESS면 활성 묶음의 거산 공정 목록(역량 파일 순서, answerId = 공정 코드, label = 공정 이름), INDUSTRY면 설정 industries(그 순서, answerId = label = 산업군 이름). 이 보기의 reaches·closes·lostReason은 null. 그 회사의 AI 제안·확정 표시는 새 칸 없이 상세 응답(reviewItems의 공정 연결 제안 줄 itemId PL:<공정 코드>, processLinks, header.industries·industriesSource)으로 화면이 붙인다
  /opportunities/{oppId}/readiness-check:
    post:
      summary: 기한 내 대응 가능 체크 → 새 평가 (U5, 흐름 ③)
      requestBody: { content: { application/json: { schema: { type: object, required: [checked, evalId], properties: { checked: { type: boolean }, evalId: { type: string } } } } } }
      responses: { '200': { description: '새 평가 ID·분류 (meta.reevaluated=true)' }, '409': { description: 낡은 평가 기준 } }
  /opportunities/{oppId}/homepage:
    post:
      summary: 홈페이지 주소 확정 또는 본문 붙여넣기 → 근거 추출 → 재평가 (U2, 흐름 ①). 전체 60초 한도. (추가 2026-11-03 PM 지시) 상세 머리 [다시 조사] 단추도 이 경로(확정된 url 그대로)를 부른다 — 주기 자동 조사는 두지 않고 담당자가 누를 때만. **(추가 2026-11-12 PM 결정 #596)** url·pastedText 없이 부르고 회사에 저장된 홈페이지 주소도 없으면 홈페이지 찾기(C9 HomepageFinder, 회사 파일·후보 찾기 회사만)부터 하고 찾은 주소로 이어서 추출·재평가한다(같은 60초 안). 못 찾으면 422 kind HOMEPAGE_NOT_FOUND("홈페이지를 찾지 못했습니다" / "회사 이름·주소를 확인한 뒤 나중에 다시 조사해 주세요"), 찾기 결과(NOT_FOUND)는 저장된다. 화면의 [맞음]·[고치기] 단추와 "홈페이지 확인 필요"·"홈페이지 못 찾음" 띠는 쓰지 않지만 confirmOnly·url은 지우지 않고 남김(깨는 변경 아님). 성공 시 header.summaryLine·highlights·mainPhone·researchedAt 갱신
      requestBody: { content: { application/json: { schema: { type: object, properties: { url: { type: string, format: uri }, pastedText: { type: string }, confirmOnly: { type: boolean, default: false, description: '(추가 2026-11-03 PM 결정 B) true면 담당자 [맞음]: homepageStatus를 CONFIRMED로만 바꾸고 근거 추출·재평가는 하지 않음. url을 고쳐 보내면(false) 그 주소로 다시 추출·재평가' } } } } } }
      responses: { '200': { description: '근거 수·질문 수·새 평가 ID (meta.reevaluated). confirmOnly면 상태만. 모양은 아래 (2026-11-04 PM 확정, 이강욱 제안 #219)', content: { application/json: { schema: { oneOf: [ { title: 조사 실행 응답(confirmOnly false), type: object, required: [data, meta], properties: { data: { type: object, required: [evidenceCount, requirementCandidateCount, questionCount, evalId], properties: { evidenceCount: { type: integer, description: '이번 조사로 새로 저장한 AI 근거 수 전체(요구 후보 포함). 이전 조사 근거는 이력으로 남고 여기 안 셈' }, requirementCandidateCount: { type: integer, description: '(PM 결정 2026-11-04) evidenceCount 가운데 "요구 후보(미확인)" 수. 점수에 안 들어가는 추정이라 따로 센다. 화면 문구: "근거 3건(확인 필요 1건 포함)·질문 1건 저장, 재평가 완료"' }, questionCount: { type: integer, description: '이번 조사로 새로 만든 확인 질문 수(0 또는 1). 이미 요청·회신된 질문은 덮지 않으므로 0일 수 있음' }, evalId: { type: string, description: '재평가로 생긴 새 평가 ID. 화면은 이 값으로 상세를 다시 불러 "재평가됨" 띠를 보임' } } }, meta: { type: object, properties: { reevaluated: { type: boolean, description: '항상 true. 저장·재평가가 한 트랜잭션으로 끝났다는 뜻' }, updatedAt: { type: string } } } } }, { title: 주소 확인만 응답(confirmOnly true), type: object, required: [data, meta], properties: { data: { type: object, required: [homepageUrl, homepageStatus, homepageSource], properties: { homepageUrl: { type: string, description: '확정된 홈페이지 주소(바꾸지 않음)' }, homepageStatus: { type: string, enum: [CONFIRMED], description: '담당자 [맞음] 뒤 항상 CONFIRMED' }, homepageSource: { type: string, enum: [STAFF], description: '확정한 주체. [맞음]이면 STAFF' } } }, meta: { type: object, properties: { reevaluated: { type: boolean, description: '항상 false. 외부 호출·근거 저장·재평가 없음' }, updatedAt: { type: string } } } } } ] } } } }, '400': { description: 'confirmOnly true와 pastedText를 같이 보냄 — 둘 중 하나만 (2026-11-04)' }, '409': { description: '조사하는 동안 회사·기회 정보가 바뀜 (kind STALE_VALUE). 상세를 다시 불러 확인' }, '422': { description: 'kind ROBOTS_DISALLOW / TERMS_DISALLOW (붙여넣기 요청) 또는 UNREACHABLE (주소를 열 수 없음)' }, '503': { description: '(2026-11-04 PM 확정, 실패 종류 구분) kind LLM_LIMIT = 이번 달 호출·비용 한도 초과 / SEARCH_LIMIT = 오늘 검색 한도 초과 / USAGE_UNCONFIRMED = 앞선 호출의 사용량이 빈 행이 있어 멈춤(#218 "막힌 전송 기록 풀기" 명령으로 품) / LLM_NOT_CONFIGURED = 키 없음·외부 호출 꺼짐·허용 모델/단가 설정 없음·키/모델 거부(401·403·404) — 담당자가 다시 눌러도 안 풀림(2026-11-04 PM, LLM_FAILED에서 분리) / TIMEOUT = 60초 초과 / LLM_FAILED = AI 응답 없음·형식 오류·일시 거부(429 재시도 뒤) — 다시 시도 가능. 본문은 공통 오류 형식(message·nextAction 쉬운 말)' } }
      # (2026-11-04 PM 확정) 내부 흐름 C2 run_extract의 FlowResult counts(evidenceCount·requirementCandidateCount·questionCount)를 API가 그대로 응답에 넣는다(문장 분석 없음, 이강욱 제안). 담당자 검사를 마친 DB 세션은 외부 호출 전에 닫고 내부 흐름은 한 번만 부른다.
      # (2026-11-04 PM 확정) 실패 때 화면 동작 — 문구는 서버 message·nextAction을 그대로 보이고(약속 3장 오류 규칙), kind로는 모양만 가른다:
      #   ROBOTS_DISALLOW·TERMS_DISALLOW → 인라인 안내 + 본문 붙여넣기 칸 열기("이 사이트는 자동으로 읽을 수 없습니다. 내용을 직접 붙여 넣어 주세요", 러프 화면 S2 오류 행)
      #   UNREACHABLE → 인라인 안내 + 주소 고치기 칸 그대로("근거를 가져오지 못했습니다. 주소를 확인하거나 나중에 다시 시도")
      #   LLM_LIMIT·SEARCH_LIMIT → 인라인 안내만, [다시 조사] 단추 잠금(이번 달/오늘은 더 못 함). 예: "이번 달 비용 한도 초과 — 다음 달 다시 조사해 주세요"
      #   USAGE_UNCONFIRMED → 인라인 안내 "AI 사용 기록에 문제가 있어 조사를 멈췄습니다 — 문의 번호와 함께 운영자에게 알려 주세요", 단추 잠금 (운영자가 '막힌 전송 기록 풀기' 명령으로 품) **(바뀜 2026-11-10 PM 결정 #538) 서버가 더는 내지 않는다**(C4: 사용량이 빈 기록은 추정 비용으로 치고 막지 않음). 화면의 분기는 남겨 둬도 된다. 응답을 못 받은 호출은 LLM_FAILED(다시 시도 가능)로 끝난다
      #   LLM_NOT_CONFIGURED → 인라인 안내 "AI 조사 설정이 아직 되어 있지 않습니다 — 문의 번호와 함께 운영자에게 알려 주세요", 단추 잠금 (다시 눌러도 안 풀리는 오류: 키·모드·모델·단가 설정)
      #   TIMEOUT·LLM_FAILED → 인라인 안내 + [다시 조사] 단추 그대로(다시 시도 가능)
      #   STALE_VALUE → 인라인 안내 "조사하는 동안 회사 정보가 바뀌었습니다" + 상세를 다시 불러온 뒤 단추 그대로
      #   모두 ref(문의 번호)를 작게 같이 보임. 모달 없음. "운영자"가 거산 쪽 누구인지는 #208 거산 질문(2026-11-04)
  /opportunities/{oppId}/industries:
    post:
      summary: (추가 2026-11-03 PM 결정, 대시보드 산업군) 담당자가 산업군을 확정·수정 (U7). 설정 industries 목록 안 값만, 최대 3개, 출처 STAFF로 저장. 빈 배열이면 "미확정"
      requestBody: { content: { application/json: { schema: { type: object, properties: { industries: { type: array, maxItems: 3, items: { type: string } } } } } } }
      responses: { '200': { description: '저장됨 (industries, industriesSource STAFF, industriesConfirmedAt)' }, '400': { description: '목록에 없는 값 (fields)' } }
  /opportunities/{oppId}/evaluations:
    get:
      summary: 현재·이전 평가 쌍 (U2 "이전 평가 보기")
      responses: { '200': { description: 'Envelope(current, previous)' } }
  /opportunities/{oppId}/activity:
    get:
      summary: 활동 이력 (U5). (명시 2026-11-04 PM 결정) 저장 표(rec_note·rec_outcome·rec_review_opinion)에서 읽을 때 만들고 따로 저장하지 않음. 메모·답 글이 그대로 들어가므로 영업 메모와 같은 취급(내부 전용: 접속 보호 뒤 화면에서만, 외부 AI·엑셀·질문 목록·대시보드 요약으로 안 나감). rec_note kind REPLY 행은 ActivityItem kind REPLY "답 기록"으로. (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) 메모·영업 기록 줄에는 recordId·recordKind·cancelled·cancelledBy·cancelledAt을 싣는다. 취소된 줄도 빼지 않고 보내며, 취소 행위는 RECORD_CANCELLED 줄로 따로 보인다. 취소된 메모의 본문은 보내지 않는다(DB에만 남음)
      parameters: [ { name: limit, in: query, schema: { type: integer, default: 20, maximum: 100 } } ]
      responses: { '200': { description: 'Envelope(ActivityItem[])' } }
  /opportunities/{oppId}/peers:
    get:
      summary: (추가 2026-11-12 PM 지시 #594, 비슷한 회사 참고 #268·#269 — PM 결정 2026-11-04 A안) 같은 공정 또는 같은 산업군의 다른 회사 최대 5곳과 요약 (U5, 2차). 저장 없이 읽을 때 계산. 고르는 순서는 같은 공정 코드 → 같은 산업군 → 영업 단계가 앞선 순 → 최근 기록 순. 이 회사는 빼고, 가상 회사와 실제 회사는 섞지 않는다(같은 묶음 종류끼리). 취소된 기록은 단계·접촉·메모·건수 어디에도 넣지 않는다. 읽기라 보기 전용(viewer)도 볼 수 있다. 응답에 메모 글이 들어가므로 영업 메모와 같은 취급(C4: 접속 보호 뒤 화면 전용)
      responses: { '200': { description: 'Envelope({ summary: { processCount: integer(같은 공정 회사 수), industryCount: integer(같은 산업군 회사 수), stageCounts: { <outcomeStatus>: integer }, topLostReasons: [{ code: lostReasonCode, count: integer }](많은 순 최대 3), contactReach: { CALL: { reached: integer, tried: integer }, EMAIL: { reached, tried }, VISIT: { reached, tried } } }, companies: [{ oppId, name, processCodes: [processCode], industries: [string], outcomeStatus: string | null, lostReasonCode: string | null, lastContactAt: date-time | null, lastContactMethod: contactMethod | null, lastNote: { text(120자에서 자름), by: staffKey, at: date-time } | null, sameProcess: boolean, sameIndustry: boolean }](최대 5) }). summary는 건수만 싣고 메모 글은 넣지 않는다. lastNote는 메모·자료 조사·질문 답 이력 가운데 최신 하나. 비슷한 회사가 없으면 companies는 빈 배열, 건수는 0' }, '404': { description: 기회 없음 } }
  /opportunities/{oppId}/questions/{questionId}/request:
    post:
      summary: 거산 확인 요청 (U4). 대기 → 요청
      requestBody: { content: { application/json: { schema: { type: object, required: [dueAt], properties: { dueAt: { type: string, format: date }, memo: { type: string } } } } } }
      responses: { '200': { description: 요청됨 }, '422': { description: 이미 요청된 질문 } }
  /recontact:
    post:
      summary: 재접촉 7칸 저장 → 평가 (U6, 흐름 ④). 이력 없음이면 meta.evaluatedAsNew=true — **보류(2026-11-03, PM 결정: U6 재접촉 보류, 거산 요청. 경로는 지우지 않음)**
      requestBody: { content: { application/json: { schema: { type: object, required: [customerId, oppTitle, fields], properties: { customerId: { type: string }, oppId: { type: string, nullable: true }, oppTitle: { type: string }, fields: { type: array, minItems: 7, maxItems: 7, items: { type: object, required: [key, value, certainty, confirmedAt], properties: { key: { type: string, enum: [PAST_PROCESS_ITEM, ORDER_HISTORY, REQUIREMENT_MET, LOSS_REASON, LAST_DELIVERY_CYCLE, RECENT_SIGNAL, NEXT_APPOINTMENT] }, value: {}, certainty: { type: string, enum: [CONFIRMED, STRONG] }, confirmedAt: { type: string, format: date }, interactionKind: { type: string, enum: [TRADE, QUOTE, CONSULT, PROPOSAL], nullable: true } } } } } } } } }
      responses: { '200': { description: '새 기회·평가 ID' }, '400': { description: '칸별 오류 fields[]' } }
  /questions:
    get:
      summary: 질문 목록 (U4)
      parameters: [ { name: status, in: query, schema: { type: string, enum: [ALL, WAITING, REQUESTED, REPLIED, APPLIED] } }, { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/pageSize' } ]
      responses: { '200': { description: 'Envelope(Question[], meta.overdueCount, meta.total)' } }
    post:
      summary: 질문 직접 추가 (U4). 처음부터 REQUESTED
      requestBody: { content: { application/json: { schema: { type: object, required: [text, oppId, dueAt], properties: { text: { type: string, maxLength: 200 }, oppId: { type: string }, dueAt: { type: string, format: date } } } } } }
      responses: { '200': { description: 추가됨 } }
  /questions/{questionId}/reply:
    post:
      summary: 회신 기록 (U4). 요청 → 회신. 거산 값은 바꾸지 않음. (갱신 2026-11-04 PM 결정, 검토사항 [답 적기] #248·#249) 대기 → 회신도 허용(거산에 요청하기 전 담당자가 전화로 들은 답). X-Staff-Key 필수(viewer 403), repliedBy는 서버가 채움. 이미 답이 있으면 최신으로 덮어쓰고, 저장할 때마다 연결된 기회마다 rec_note(kind REPLY, text "Q:<questionId> 답: <replyText>") 새 행을 남겨 활동 이력에 이력 보존. 답은 영업 메모와 같은 취급(C4)
      requestBody: { content: { application/json: { schema: { type: object, required: [replyText, repliedAt], properties: { replyText: { type: string, maxLength: 500 }, repliedAt: { type: string, format: date } } } } } }
      responses: { '200': { description: '기록됨 (questionId, replyText, repliedAt, repliedBy)' }, '403': { description: 담당자 키 없음·보기 전용 }, '404': { description: 질문 없음 } }
  /questions/export:
    get:
      summary: 질문 목록 텍스트 (복사·파일, U4). TransferGuard OUTPUT_EXPORT 검사 뒤. 거부면 전체 중단
      parameters: [ { name: format, in: query, schema: { type: string, enum: [text, file] } } ]
      responses: { '200': { description: 'text/plain (대기·요청 질문, 번호·질문·예/아니요·대상)' }, '422': { description: 'kind EXPORT_REJECTED, rejectedItems[]' } }
  /questions/mark-requested:
    post:
      summary: 내보낸 '대기' 질문 N건을 요청 상태로 표시 (U4)
      requestBody: { content: { application/json: { schema: { type: object, required: [questionIds, dueAt], properties: { questionIds: { type: array, items: { type: string } }, dueAt: { type: string, format: date } } } } } }
      responses: { '200': { description: 표시됨 } }
  /ingest:   # (추가 2026-11-04 PM 결정 ①, 새 후보 가져오기 #221 — U3) 추천 목록 머리 [새 후보 가져오기] 단추. 명령 `geosan ingest`와 같은 함수(C8)
    post:
      summary: 설정 범위(ingestion.regions·productKeywords)로 공개 소스에서 후보를 모아 목록에 더한다. X-Staff-Key 필수(viewer 403). 이미 RUNNING인 회차가 있으면 409 INGEST_RUNNING("지금 가져오는 중입니다"). 한 번에 최대 ingestion.maxCandidates(50)
      requestBody: { content: { application/json: { schema: { type: object, properties: { sourceId: { type: string, description: '자동 수집 소스 3개 안(CON-04). 기본 산단공 공장현황 CSV' }, max: { type: integer } } } } } }
      responses: { '200': { description: 'Envelope(data: { batchId, newCount, mergeCandidateCount, skippedCount }). 응답 시점까지 하는 것: 읽기 → 정규화·병합(같은 회사면 건너뜀, 이름이 비슷하면 opp_merge_candidate "확인 필요") → 새 회사 삽입(ingestBatchId·ingestedAt) → 규칙 평가(외부 호출 없음). 그 뒤 새 회사만 자동 조사(②→③→④→재평가, C7 autoResearch)를 서버 백그라운드로 1곳씩(1곳 60초, 실패는 그 회사만 "확인 필요"로 남기고 다음). 진행은 GET /opportunities meta.latestIngest.researchDoneCount. 외부 전송은 TransferGuard EXTERNAL_SEARCH·EXTERNAL_AI 규칙과 월 상한 그대로' }, '409': { description: INGEST_RUNNING }, '503': { description: 소스 읽기 실패(사유 한 줄) } }
      # (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) 담당자가 고른 조건으로 찾는다. 본문에 더하는 칸: processCodes: [processCode](조건 찾기에 필수, 1개 이상, 역량 파일 공정 안), regions: [string](설정 ingestion.regions 안, 없으면 설정 전체), industries: [string](설정 industries 안, 선택). 설정 밖 값은 400
      #   조건 찾기는 AI 판단 때문에 시간이 걸리므로 회차를 만든 직후 바로 응답한다(data.batchId, 건수는 그 시점 값). 진행과 결과는 GET /opportunities meta.latestIngest로 본다 — 더하는 칸: criteria, scannedCount(파일에서 지역으로 추린 회사 수), judgedCount(AI가 판단을 끝낸 수), pickedCount(고른 수), judgePendingCount(AI 한도에 걸려 남은 수). 409 INGEST_RUNNING 그대로
      #   흐름: 파일 행에서 주소로 지역 추림 → 저장된 판단이 없거나 낡은 행만 AI 고르기(제조업이 아닌 회사는 뺌) → 고른 회사만 공장등록 조회로 정보 채움 → 병합(같은 회사면 건너뜀) → 새 회사 삽입 → 규칙 평가 → 새 회사만 자동 조사(기존). AI 한도에 걸리면 그때까지 고른 회사만 더하고 judgePendingCount를 남긴다(부분 결과를 완전한 것처럼 보이지 않음, NFR10)
      #   (추가 2026-11-05 저녁 PM 반영, AI 점수 제안 1차 최소 범위 #286) 카드·상세 점수는 AI 제안으로 계산됐으면 scoreState PENDING(흐리게 + 꼬리표 "AI 제안 · 확인 전", 2026-11-04 #212 ① 표시 재사용). 상세 검토사항에 제안 줄을 보인다 — 코드표 reviewItemKind에 ITEM_INPUT_PROPOSAL·PROCESS_LINK_PROPOSAL을 더하고, 기존 POST /review-items/{itemId}/check로 [확정]·[고치기]하면 출처 STAFF·상태 CONFIRMED로 바뀌고 재평가
      #   (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) 웹 검색 갈래: 설정 candidateWebSearch.enabled가 true면 같은 조건으로 AI 웹 검색도 돌려 같은 회차에 합친다. 웹에서 나온 회사는 공장등록 조회로 등록 여부를 확인한다. 확인되면 공공자료 갈래와 똑같이 넣는다. 확인이 안 되면 ① 공식 홈페이지가 확인되고 ② 실제 검색 결과나 페이지에 적힌 회사이며(출처 주소 없는 이름은 버림) ③ 출처 주소를 저장한 경우에만 넣는다
      #   카드·상세에 더하는 칸: discoverySource, discoverySourceUrl|null, registryStatus: enum[FOUND, NOT_FOUND]|null, fitLevel|null, pickReason|null(AI가 고른 이유 한 줄). registryStatus NOT_FOUND인 회사는 꼬리표 "등록 자료에서 못 찾음 · 확인 필요"가 붙고 검토사항에 REGISTRY_NOT_FOUND 줄이 생기며, 담당자가 그 줄을 확인(기존 POST /review-items/{itemId}/check)하기 전까지 점수는 흐리게(scoreState PENDING) 보인다
      #   (추가 2026-11-12·11-13 PM 결정, 웹 검색 갈래 남은 기준 #314·#639) 위 "① 공식 홈페이지가 확인되고"의 기준: 홈페이지 찾기(C9 HomepageFinder.find)의 확신도가 homepageDiscovery.minConfidence 이상이고, 출처 주소(sourceUrl)의 페이지나 검색 결과 글에 그 회사 이름이 실제로 적혀 있을 때만 통과한다. 이름 확인은 AI 판단이 아니라 우리 코드가 글자 일치로 한다. 둘 중 하나라도 아니면 목록에 넣지 않고 src_web_candidate.droppedReason에 이유를 남긴다. 예: 확신도 0.9인데 출처 페이지에 회사 이름이 없으면 넣지 않음. 새 기준 숫자는 만들지 않는다. 등록 주소 불일치(PM 결정 2026-11-13): 공장등록 조회에서 이름은 같은데 주소가 다르게 나온 후보는 다른 회사일 수 있으므로 목록에 넣지 않고 droppedReason에 "등록 주소 불일치"로 남긴다(새 상태 값을 만들지 않음). 안 고른 방법: "확인 필요" 꼬리표로 넣기(다른 지역 회사가 섞여 들어옴). 조회가 끝나지 않은 후보는 C6의 PENDING(조회 대기)으로 보관만 한다
      #   점수 전 목록 순서: 점수 입력 제안(#286)이 아직 없는 찾은 회사는 scoreState NONE("점수 전")으로 보이고, 점수가 있는 회사 뒤에 공정 탭 안에서 fitLevel 높은 순(같으면 들어온 순)으로 선다. 사례 파일 18곳과 점수가 있는 회사의 순서 규칙은 그대로다
      #   (추가 2026-11-06 PM 결정, 표면처리를 직접 하는 회사 표시 #319) AI 고르기나 공장등록 조회의 업종명에서 표면처리(도금·아노다이징·피막 처리 등)를 직접 하는 회사로 보이면 카드·상세에 ownPlatingLineSuspected: boolean, ownPlatingLineBasis: string|null(근거 한 줄. 예: 생산품 "알루미늄 아노다이징")을 돌려준다. **자동으로 빼지 않는다**(FR9.3). 꼬리표 "표면처리를 직접 하는 회사일 수 있음 · 확인 필요"를 붙이고 검토사항에 OWN_PLATING_LINE_SUSPECTED 줄을 만든다. 목록에서 빼는 것은 담당자가 기존 담당자 검토 의견 "검토 대상 제외"(이유 필수)로 한다 **(추가 2026-11-07 PM 결정, 확인 줄 규격 #363·#386)** 이 확인 줄은 기회마다 고정 하나로 itemId `FLAG:OWN_PLATING_LINE_SUSPECTED`(GAP:HOMEPAGE처럼 근거 문장·평가가 바뀌어도 번호가 흔들리지 않음), kind `OWN_PLATING_LINE_SUSPECTED`, source는 표시가 온 곳대로(`opp_customer.ownPlatingLineSource` `AI` → `AI`, `INDUSTRY_NAME` → `RULE`; 기존 회사 조회에서 읽고 새 응답 칸은 만들지 않음), targetLabel null, text는 "표면처리를 직접 하는 회사일 수 있음: <ownPlatingLineBasis>"이고 근거가 없으면 앞 문장만. 기존 검토사항 줄 뒤에 붙이며 다른 줄의 순서·점수·분류·거래 관계는 바꾸지 않는다. 체크는 기존 `POST /review-items/{itemId}/check`·`rec_review_check` 그대로이고, ~~평가가 아직 없는 점수 전 회사는 지금 규칙대로 체크를 저장하지 않는다(가짜 evalId를 만들지 않음~~ **(바뀜 2026-11-08 PM 결정 B안 #440)** 점수 전 회사에도 "평가 전" 기록(C3 흐름 ⑥)이 생겨 evalId가 있으므로 체크는 기존 규칙대로 저장된다. 이 저장을 허용으로 둘지는 2차 #441에서 결정하고, 1차에서는 막는 코드를 두지 않는다(원문: 평가가 아직 없는 점수 전 회사는 체크를 저장하지 않는다 — 가짜 evalId를 만들지 않음. 점수 제안 #286으로 평가가 생기면 체크할 수 있게 됨). 표시가 없는 회사와 사례 파일 18곳의 검토사항은 그대로
      #   순서: 점수 전 회사들 안에서는 이 표시가 붙은 회사를 표시가 없는 회사 뒤에 둔다(같은 쪽 안에서는 fitLevel 순). 점수가 있는 회사의 점수·분류·순서 규칙은 바꾸지 않는다. 이 표시는 후보를 확인하라는 표시일 뿐이고, 가격·사업모델 같은 경쟁사 비교는 만들지 않는다(CON-23 그대로)
      #   (추가 2026-11-11 PM 승인 #573, 공장 등록 정보) 카드·상세 머리에 factoryProfile: { rawMaterials: string|null, employeeCount: int|null, scale: string|null, fileDate: date } | null을 더한다. 팩토리온 공장조회(C5 factoryon-xlsx)에서 이 회사에 붙은 행의 값이다. employeeCount는 공장 등록 때 적은 인원이라 갱신되지 않은 경우가 있어 **언제나 추정**이고 화면은 "종업원 약 N명(추정)"으로 보인다(PM 지시). 0·빈 값은 null, 붙은 행이 없으면 factoryProfile null. 순서·점수·분류에는 쓰지 않는다(종업원 기준은 거산 확인 뒤 #275). ownPlatingLineSuspected 표시가 붙는 곳을 둘 더한다: 팩토리온 업종번호가 설정 surfaceTreatmentIndustryCodes에 있으면(근거 예: "공장등록 업종번호 25922"), 수질 명단(C5 nier-water-csv)에 같은 회사가 있으면(근거 "특정수질유해물질 배출 사업장 명단에 있음(국립환경과학원, 공공누리 제1유형)" — **(바뀜 2026-11-11 PM 결정 #583)** 공공누리 제1유형 출처표시. 화면의 공장 정보 줄 끝에도 "(한국산업단지공단 팩토리온 MM/DD 기준, 가공)"을 보인다). 자동으로 빼지 않는 규칙과 순서 규칙은 위 줄 그대로
      #   (추가 2026-11-12 PM 결정 #617, 공장 등록 업종명) factoryProfile에 industryName: string|null을 더한다. 팩토리온 공장조회의 업종명 그대로(예: "절삭가공 및 유사처리업")이고 AI가 고른 이유(pickReason)와 달리 등록 사실이다. 화면은 공장 정보 줄 맨 앞에 "업종 …"으로 보인다. 연락처 모양 값은 저장하지 않고(기존 규칙), 붙은 행에 업종명이 없으면 null. 순서·점수·분류에는 쓰지 않는다
      #   meta.latestIngest에 더하는 칸: webSearchUsed: boolean, webCandidateCount, webDroppedCount(채용·유료 사이트 결과, 출처 없음, 홈페이지 미확인으로 버린 수), webFromCache: boolean. 하루 한도에 걸리면 웹 갈래만 건너뛰고 공공자료 갈래 결과는 그대로 더한다
      #   (추가 2026-11-06 PM 결정, #313) 하루 한도에 걸려 웹 갈래를 건너뛰면 meta.latestIngest.webSkippedReason: enum[DAILY_LIMIT, DISABLED]|null을 돌려주고, 화면은 목록 머리의 수집 요약 줄 옆에 작게 "오늘 웹 검색 한도 도달"을 보인다(DAILY_LIMIT일 때만). 공공자료 갈래 결과는 그대로 보인다
      #   (추가 2026-11-06 PM 결정, 두 갈래의 순서와 합치는 규칙 #345·#314) 순서: 공공자료 갈래를 먼저 돌리고 그다음 웹 검색 갈래를 돌린다(동시에 돌리지 않는다). 웹 검색 갈래는 공공자료 갈래의 새 회사 삽입·규칙 평가가 끝난 직후 시작하고, 새 회사 자동 조사(②→③→④→재평가)는 두 갈래의 회사가 모두 들어온 뒤에 한 줄로 1곳씩 돌린다(자동 조사는 1곳 최대 60초라, 그것까지 기다리면 웹 검색이 너무 늦게 시작한다)
      #   출처는 먼저 들어온 길: 웹에서 나온 회사가 이미 목록에 있으면(사례 파일·이전 회차·이번 회차의 공공자료 갈래) 새로 넣지 않고 그 회사의 discoverySource·discoverySourceUrl·registryStatus도 바꾸지 않는다. 그래서 두 갈래에서 모두 나온 회사는 공공자료 갈래의 출처(FACTORY_FILE 또는 FACTORY_API) 그대로 남고, 사례 파일 18곳의 출처·순서·점수도 그대로다. 웹에서 찾은 출처 주소는 웹 검색 결과 기록(src_web_candidate)에 남는다
      #   같은 회사 가리기: C5 "같은 회사 가리기"를 웹 갈래에도 그대로 쓴다(이름만으로 합치지 않고 주소를 같이 본다). 웹 결과는 주소가 없을 수 있으므로, 애매하면 합치지 않고 opp_merge_candidate "확인 필요"로 남긴다
      #   공공자료 갈래가 실패했을 때: 공공자료 갈래가 아예 실패해 회차가 FAILED이면 웹 검색 갈래를 돌리지 않는다(webSearchUsed false, webSkippedReason null, 사유는 회차의 failureReason 그대로 — 새 코드값을 만들지 않는다). 한도·조회 실패로 일부만 된 경우(judgePendingCount, complexListSkippedReason)는 받은 데까지로 웹 검색 갈래를 계속한다. 이유: 웹에서 나온 회사의 등록 확인은 공공 등록 자료에 기대므로, 공공자료 갈래가 실패한 상태에서 웹만 돌리면 등록된 회사에도 "등록 자료에서 못 찾음"이 잘못 붙을 수 있다
      #   이 묶음은 규칙을 밝혀 적은 것이고 새 응답 칸·코드값·표는 없다(더하는 변경)
      #   (추가 2026-11-06 PM 결정, 찾기 실패 사유 #347) meta.latestIngest에 더하는 칸: failureReason: string|null — 회차가 FAILED일 때의 사유 한 줄(C6 opp_ingest_batch.failureReason 그대로), 실패가 아니면 null. 화면은 목록 머리의 수집 요약 줄에 이 한 줄을 보인다. 쉬운 말 한 줄만 싣고 내부 경로·키·연락처·오류 원문은 싣지 않는다. 더하는 변경
      #   (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) 설정 ingestion.complexList.enabled가 true면 흐름의 첫 단계가 둘로 늘어난다: 파일 행에서 주소로 지역 추림 + 그 지역 단지 이름마다 공장등록 조회로 입주 목록을 받아 주소로 다시 추림. 같은 회사는 한 줄로 합친다. 그 뒤(AI 고르기 → 정보 채움 → 병합 → …)는 그대로이고 scannedCount는 합친 뒤의 회사 수다. 조회를 다 못 불렀으면(하루 한도·조회 실패) 받은 데까지만 쓰고 나머지는 파일 목록으로 계속하며 meta.latestIngest.complexListSkippedReason: enum[DAILY_LIMIT, SOURCE_ERROR, DISABLED]|null을 돌려준다. 화면은 목록 머리의 수집 요약 줄 옆에 작게 "산단공 조회를 다 못 불러옴 · 파일 목록으로 찾음"을 보인다(DAILY_LIMIT·SOURCE_ERROR일 때만). 파일 자체를 못 읽는 것은 지금처럼 503
  /ingest/preview:   # (추가 2026-11-10 PM 결정 #549 ①②③, 더하는 변경) [영업 후보 목록 › 후보 가져오기 줄] 조건을 고르면 바로 보이는 "맞는 공장 수" 줄과, [영업 후보로 더하기 💰]를 누르기 전 확인 줄의 예상 금액. 외부 호출 0건(저장된 판단·회사·전송 기록만 읽음)
    get:
      summary: 고른 조건(query processCodes·regions·industries — POST /ingest 본문과 같은 값·같은 검사, 설정 밖 값은 400)에서 저장된 최신 판단(C6 src_candidate_judgment 중 criteriaVersion이 지금 기준과 같고 productHash가 같은 것)을 세고, 지금 누르면 들 비용을 추정한다. 담당자 키 없이 읽을 수 있다(viewer 포함, 0원). AI·웹 검색·공장등록 조회를 부르지 않는다. 조건 없이 부르면 month만 채우고 나머지는 null(아래 [다시 조사]·[붙여넣고 조사]용)
      responses: { '200': { description: 'Envelope(data: { matchedCount(맞는 공장 수 — 제조업이고 고른 공정에 맞는 판단), fitCounts: { HIGH, MEDIUM, LOW }, registeredCount(그중 이미 영업 후보로 들어온 곳, C5 같은 회사 가리기 기준), addableCount(아직 안 들어온 곳), addableHighCount, unjudgedCount(고른 지역의 공장 행 중 판단이 없거나 낡은 곳), addCount(지금 누르면 더할 최대 곳 수 = min(ingestion.maxCandidates, addableCount), 단 unjudgedCount > 0이면 판단 뒤 늘 수 있어 maxCandidates), estimate: { judgeRows, judgeCalls, judgeUsd, researchCount, researchCalls, researchUsd, webSearchUsd, totalUsd }, month: { usedUsd, limitUsd, usedCalls, limitCalls }, blocked: { kind: enum[OVER_COST, OVER_CALLS], judgeableRows } | null })' }, '400': { description: 조건 값 오류(POST /ingest와 같음) } }
      #   계산(숫자는 설정에서 읽고 코드에 적지 않는다): judgeRows = unjudgedCount, judgeCalls = ⌈judgeRows ÷ ingestion.aiPick.rowsPerCall⌉, judgeUsd = judgeRows × ingestion.costEstimate.judgeUsdPerRow, researchCount = addCount(homepageDiscovery.autoResearch가 꺼져 있으면 0), researchCalls = researchCount × costEstimate.researchCallsPerCompany, researchUsd = researchCount × costEstimate.researchUsdPerCompany, webSearchUsd = candidateWebSearch.enabled이고 같은 조건의 저장 결과가 없으면 costEstimate.webSearchUsdPerBatch, 아니면 0. month는 TransferGuard 월 합(C4)과 같은 계산이다(사용량 빈 기록은 llm.unconfirmedCallCostUsd로 침)
      #   잠금(결정 ②): month.usedUsd + totalUsd > limitUsd이면 blocked.kind OVER_COST, month.usedCalls + judgeCalls + researchCalls(+ 웹 검색 1) > limitCalls이면 OVER_CALLS. judgeableRows = 조사·웹 검색 몫을 먼저 뺀 남은 금액·호출로 판단할 수 있는 공장 수(0 아래면 0). 화면은 판단 전 공장이 있으면 숫자 줄에 "아직 AI 판단 전 <unjudgedCount>곳 · 판단에 약 $<judgeUsd>"를 덧붙이고, blocked이면 [영업 후보로 더하기 💰]를 잠그고 "이번 달 남은 금액으로 약 <judgeableRows>곳까지 판단할 수 있습니다 · 시·군을 골라 나눠 진행해 주세요"를 보인다(시·군 고르기는 #521)
      #   POST /ingest도 회차를 만들기 전에 같은 계산을 다시 해서 넘으면 회차를 만들지 않고 422 INGEST_OVER_BUDGET(쉬운 말 "이번 달 남은 AI 금액을 넘습니다", 다음 행동 "시·군을 골라 나눠 진행해 주세요")로 거부한다 — 화면 잠금만 믿지 않는다. 명령 geosan ingest(C8)도 같은 검사(우회 인자 없음). 예상은 추정이므로 실행 중 실제 한도에 닿으면 지금처럼 judgePendingCount를 남긴다(C4 그대로)
      #   기록: 접수 때 estimate.totalUsd를 회차 opp_ingest_batch.estimatedUsd(C6)에 남기고, GET /opportunities meta.latestIngest에 estimatedUsd|null·actualUsd를 더한다. actualUsd = 그 회차 batchId가 붙은 전송 기록 + 그 회차로 들어온 회사(ingestBatchId)의 자동 조사 전송 기록의 비용 합(빈 기록은 unconfirmedCallCostUsd). 화면 끝 줄 예: "20곳을 더했습니다 · 실제 $0.74"
      #   이름(결정 ③): 1차는 단추 하나 그대로 두고 이름만 [새 후보 가져오기] → [영업 후보로 더하기 💰]. AI가 판단만 한 것은 "공장", 목록에 들어와 조사된 것은 "영업 후보". 돈이 드는 단추([영업 후보로 더하기]·[다시 조사]·[붙여넣고 조사])는 모두 같은 💰 표시와 누르기 전 예상 금액 + 이번 달 사용액을 보인다. [다시 조사]·[붙여넣고 조사]의 예상은 costEstimate.researchUsdPerCompany 1곳분이고 이번 달 사용액은 조건 없는 이 경로의 month를 쓴다(새 경로 없음). 단추를 둘로 나누기와 운영 담당 [공장 자료 새로 판단하기 💰]는 2차(#549)
  /dashboard:
    get:
      summary: 대시보드 건수 5개·일정·최근 내 기록 (U7, 기록에만 기대는 최소형). **깨는 변경(2026-11-03, PM 확인): 계약 버전 v2로 올림.** 화면은 이 모양의 가짜 숫자(고정값 파일)로 먼저 만들고 집계 API 완성 뒤 갈아 끼움. (추가 2026-11-12 PM 지시 #594, 기록 취소 #253·#254) 건수·일정·최근 내 기록은 취소된 행을 빼고 계산한다(지도 /dashboard/map·활동 요약 /dashboard/activity-summary도 같음)
      # ~~옛 모양(v1): Envelope(counts{TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY}, schedule[], pipeline, recentActivity[])~~ → 바뀐 뒤(v2) 아래. pipeline(업무 흐름 줄)은 뺌(메모 5장). 검색은 /opportunities?q= 그대로
      responses:
        '200':
          description: >-
            Envelope(
              # (바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356) 아래 counts 줄을 다음으로 바꾼다(2차의 WON_LAST_12M·LOST_LAST_12M·분석 줄은 그대로 2차). counts{ BOOKMARKED: int, NO_OPINION: int, NEED_CHECK: int, NOT_TARGET: int, NOT_CONTACTED: int, IN_CONTACT: int, QUOTE_SAMPLE: int, ON_HOLD: int, DONE: int, SCHEDULE_DUE: int }. 세는 대상은 **관심으로 켜 둔 기회뿐**이다(추천 목록과 같은 최근 확정 평가 안에서). 관심이 아닌 기회는 어느 칸에도 세지 않는다. 기회 하나는 아래 순서로 처음 맞는 칸 하나에만 든다: ① 최신 검토 의견이 NOT_TARGET → NOT_TARGET(제외) ② 최신 영업 단계가 IN_PROGRESS → IN_CONTACT(접촉 중) / SAMPLE_OR_REGISTRATION_APPROVED → QUOTE_SAMPLE(견적·샘플) / ON_HOLD → ON_HOLD(보류) / WON·LOST → DONE(완료) ③ 단계 기록이 없거나 NOT_EXECUTED이고 의견이 WORTH_REVIEW → NOT_CONTACTED(미접촉 = 검토 권고를 받았는데 아직 접촉 전) / NEED_CHECK → NEED_CHECK(추가 확인 필요) / 의견 없음 → NO_OPINION(의견 전). 그래서 NO_OPINION + NEED_CHECK + NOT_TARGET + NOT_CONTACTED + IN_CONTACT + QUOTE_SAMPLE + ON_HOLD + DONE = BOOKMARKED. 화면은 두 구역으로 보인다: "관심 기업"(BOOKMARKED, NO_OPINION, NEED_CHECK, NOT_TARGET)을 먼저, "영업 진행"(NOT_CONTACTED, IN_CONTACT, QUOTE_SAMPLE, ON_HOLD, DONE)을 그 아래. BOOKMARKED를 누르면 /opportunities?bookmarked=true(관심 기업 목록), 나머지 칸은 ?filter=<키>. SCHEDULE_DUE는 그대로 **(바뀜 2026-11-10 PM 결정 #536, 깨는 변경 v4)** 제외한 회사는 관심 기업에서 빠지므로(`/bookmark` 줄) counts에서 `NOT_TARGET` 키를 지우고 ①을 없앤다: counts{ BOOKMARKED, NO_OPINION, NEED_CHECK, NOT_CONTACTED, IN_CONTACT, QUOTE_SAMPLE, ON_HOLD, DONE, SCHEDULE_DUE }. NO_OPINION + NEED_CHECK + NOT_CONTACTED + IN_CONTACT + QUOTE_SAMPLE + ON_HOLD + DONE = BOOKMARKED. "관심 기업" 구역은 BOOKMARKED, NO_OPINION, NEED_CHECK 세 칸
              counts{ NOT_CONTACTED: int, INTERESTED: int, IN_CONTACT: int, QUOTE_SAMPLE: int, SCHEDULE_DUE: int, WON_LAST_12M: int, LOST_LAST_12M: int },   # 미접촉 / 관심 / 접촉 중 / 견적·샘플 / 이번 주 일정(오늘 이전~7일). 누르면 /opportunities?stage=… (SCHEDULE_DUE는 ?filter=SCHEDULE_DUE). (추가 2026-11-04 PM 결정 #229, 2차) 성사·거절 = 최신 단계가 WON·LOST이고 그 기록 시각이 오늘부터 365일 안. 누르면 ?stage=WON·LOST 목록(목록은 전체, 분석 줄에 "최근 12개월 n건"). 분석 줄 meta.analysis{ sampleCount, avgContacts, contactReach{CALL,EMAIL,VISIT:{reached,tried}}, avgDaysToOutcome, topIndustries[], topProcesses[], lostReasons[](LOST만) } — 표본 10건 미만이면 화면은 비율 없이 건수만
              schedule[ { oppId, customerName, oppTitle, dueAt: date, note: string, overdue: boolean, staffKey } ],   # 기한 지남(overdue) 맨 위, 그다음 날짜순. 출처: /outcomes의 nextScheduleAt·nextScheduleNote. (추가 2026-11-05 PM 결정, #279) 최신 단계가 성사·거절(WON·LOST)로 끝난 영업에 남은 다음 일정은 앞으로 할 일이 아니므로 일정과 SCHEDULE_DUE 건수에서 뺀다
              recentActivity[ { at: datetime, oppId, customerName, kind: enum[NOTE, STAGE, CONTACT_ATTEMPT, SCHEDULE, OPINION], summary: string } ],   # 최근 내가 한 기록 10건(요청의 담당자 키로 거름, Q4)
              asOf: datetime,
              breakdown?: {   # (추가 2026-11-03 PM 결정, 대시보드 집계) 없으면 화면은 공정·산업군 막대 줄을 숨긴다 — 실제 집계(#216)가 붙기 전 거산 전달본에 가짜 숫자가 보이면 안 되므로. 가짜 숫자 모드(VITE_USE_FIXTURES)에서만 고정값으로 채움
                basis: { statuses: [INTERESTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, WON_LAST_12M], total: int },   # "대시보드 대상": 관심 / 진행 중 / 최근 12개월 성공(WON이고 outcomeAt이 오늘부터 365일 안. 2026-11-04 PM 결정: ~~WON_THIS_YEAR 올해 성공~~ → 연도 기준은 1월에 0이 되므로 최근 12개월로. 코드 없음·화면 가짜 숫자 파일 이름 1곳만). 미접촉·보류·거절·12개월 이전 성공·가상 사례 제외
                byProcess: [{ processCode, processName, count: int, ratio: number }],   # 9종 전부(0 포함), 역량 파일 순서. 한 회사가 여러 공정이면 각각 셈. ratio = count ÷ total 소수 2자리(합이 1을 넘을 수 있음)
                byIndustry: [{ industry: string, count: int, ratio: number, includesProposed: boolean }]   # 설정 industries 순서 + 맨 끝 "미확정". AI 제안 포함(PM 결정, 막대 옆 "AI 제안 포함" 표시). dashboard.countProposedIndustries false면 확정(STAFF)만
              }
            )
  /dashboard/map:
    get:
      summary: (추가 2026-11-03 PM 결정, 2차 #222 지도 하위) 대시보드 지도용 점 목록. 접속 보호 뒤에만. 응답에 메모·연락처·대표번호 없음. 좌표는 CSV·행안부 공공좌표를 우선 재사용하고, 없는 주소는 승인한 4단계 조회로 보완한다. 네이버 결과는 이 응답 안에서만 사용하며 저장·재사용하지 않는다(2026-11-13 이강욱 확인, #651·#642)
      responses: { '200': { description: 'Envelope(center{ lat, lng }(설정 geosan), ringsKm: [30, 50, 100](설정 distanceFilterPresetsKm), points[{ oppId, customerName, lat, lng, group: enum[INTERESTED, IN_PROGRESS, WON_THIS_YEAR], distanceKm }], missingCoordinates: int, asOf)' } }
      # 2026-11-13 이강욱 확인 #642: 성공 범위는 한국 시간 올해 1월 1일~현재, 최초 성사 전환 시각 기준(이후 메모로 작년 성사가 올해로 바뀌지 않음). 대시보드 막대의 최근 12개월과 구분. 관심·진행·견적/샘플·올해 성사 중 관심 켠 실제 공개 회사만, 최신 확정 평가와 활성 평가 묶음 기준. 취소한 기록은 제외. 좌표 없음은 missingCoordinates에만 세고, 원본 주소·메모·연락처는 응답하지 않음. 거산 기준 좌표 미설정은 공통 오류로 알림. 응답은 Cache-Control: no-store.
  /opportunities/{oppId}/homepage-candidates:
    get:
      summary: (안 씀 — 2026-11-03 저녁 PM 결정 B) 네이버 결과 목록을 보여 주던 경로. ② 홈페이지 찾기는 OpenAI 웹 검색이 자동으로 하고 결과는 상세 머리(homepageStatus·homepageUrl)로 보이므로 이 경로는 만들지 않는다. 경로 호환을 위해 이름만 남김
      responses: { '200': { description: '(안 씀)' } }
  /llm-usage:
    get:
      summary: (추가 2026-11-03, PM 결정 3) 이번 달 외부 AI 사용량·비용·상한 대비 비율 (U2). 공통 틀 상단 띠가 alertReached이면 "이번 달 AI 비용 절반 사용" 표시. webSearchCalls는 OpenAI 웹 검색 호출 수(비용에 포함: 1,000회당 $10 + 검색 본문 토큰, 2026-11-03 결정 B)
      parameters: [ { name: month, in: query, schema: { type: string, pattern: '^\d{4}-\d{2}$' } } ]
      responses: { '200': { description: 'Envelope(C4 usage 출력: callCount, inputTokens, outputTokens, webSearchCalls, rejectedCount, costUsd, costLimitUsd, callLimit, alertReached)' } }
  /dashboard/activity-summary:
    get:
      summary: 활동 요약 (U7, P2)
      parameters: [ { name: period, in: query, schema: { type: string, enum: [WEEK, MONTH, CUSTOM] } }, { name: from, in: query, schema: { type: string, format: date } }, { name: to, in: query, schema: { type: string, format: date } } ]
      responses: { '200': { description: Envelope } }
  /export/xlsx:
    get:
      summary: 엑셀 출력 (U7, P1 사용자 지시). TransferGuard OUTPUT_EXPORT 검사 뒤, 가상·내부용 표시 포함. 거부면 전체 중단
      responses: { '200': { description: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, '422': { description: 'kind EXPORT_REJECTED, rejectedItems[]' } }
      #   (추가 2026-11-13 #217 — PM 결정 2026-11-13) 걸러 보기 조건: 목록 조회(GET /opportunities)와 같은 조건을 같은 이름·같은 뜻으로 받는다 — tab(new만), stage, bookmarked, opinion, process, industry, region, q, batch, sort, filter(대시보드 칸). page·pageSize는 받지 않고 쪽 나눔 없이 조건에 맞는 회사를 전부 담는다(행 순서 = 목록의 그 정렬 순서). 목록이 400으로 거부하는 조건은 여기서도 400이다. 화면은 목록을 부를 때 쓴 조건을 그대로 보낸다
      #   (추가 2026-11-13 #217 — PM 결정 2026-11-13) 설정 스위치: 설정 C7 `export.xlsxEnabled`(초기값 false = 꺼짐)가 false면 목록을 읽기 전에 422 kind EXPORT_DISABLED("엑셀 내려받기가 꺼져 있습니다.")로 막고 파일을 주지 않는다(빈 파일을 성공처럼 주지 않음). 화면은 `/config/ui`의 `export.xlsxEnabled`가 true일 때만 단추를 보인다. 접속 보호가 켜져 있으면 401이 먼저다. 만들어 두고 꺼 두며, 거산이 필요하다고 하면 설정만 켠다(2026-11-03 결정 "거산이 필요하다고 하면 그때" 유지)
      #   (추가 2026-11-13 #217 — PM 결정 2026-11-13) 파일 내용: 첫 줄 "내부용·고객 제출용 아님"(가상 회사가 있으면 "· 가상 데이터 포함"), 열은 회사·공정·점수·단계·다음 일정 다섯 개. 다음 일정은 날짜만 싣고 일정 내용(nextScheduleNote)은 싣지 않는다(자유 글이라 사람 이름이 섞일 수 있음). 읽기라서 보기 전용(viewer)·담당자 키 없음도 내려받을 수 있다(다른 목록 읽기와 같음). 내려받은 기록 1행은 아래 C4 OUTPUT_EXPORT 줄을 따른다
  /sales-analysis:
    get:
      summary: (추가 2026-11-13 #608 — PM 확인 필요) 영업 분석표 (U7, 2차, #561 결정 2 · PM 결정 2026-11-12 따로 "영업 분석" 화면). 담당자가 남긴 영업 기록(rec_outcome의 접촉 시도·영업 단계·거절 이유)만으로 공정별·회사별 표를 계산한다. AI 없음, 외부 호출 0, 저장 없음(읽을 때마다 계산), 읽기라 보기 전용(viewer)도 조회, 접속 보호 뒤. 대시보드(/dashboard)는 후보 수를, 이 경로는 영업이 어떻게 됐는지를 센다. 세는 대상 = 활성 묶음에 속하고 최신 확정 평가가 있는 기회(추천 목록과 같은 기준) 가운데 접촉 시도 행이 1건 이상인 회사. 관심(찜) 여부는 보지 않는다(제외로 저장해 관심이 꺼진 회사의 거절도 분석 재료). 가상 회사와 실제 회사는 섞지 않는다(활성 묶음 종류끼리, 가상 묶음이면 meta.hasVirtualData true로 화면 띠에 가상 표시). 최신 단계가 성사·거절인 회사는 그 결과 기록 시각(성사·거절로 처음 바뀐 행의 저장 시각)이 설정 salesAnalysis.closedWindowDays(초기값 365 = #229의 "최근 12개월") 안일 때만 세고, 밖이면 두 표 모두에서 빼고 basis.olderClosedExcluded에 건수만 싣는다. 취소된 기록(#253)은 접촉·단계·거절 이유 어디에도 세지 않는다. 한 회사가 공정·산업군이 여러 개면 각각 센다(대시보드 막대와 같은 원칙, 그래서 줄의 합이 회사 수보다 클 수 있다)(#652부터 확정된 공정·산업군만 센다. 확인 전 회사는 '확인 전' 한 줄). 숫자의 뜻은 성사·거절 목록 분석 줄(meta.analysis)·비슷한 회사(/peers)와 같다: 접촉 수 = 접촉 시도 행 수(상세 records.contactCount), contactReach = 방법별 시도 행 수(tried)와 그중 결과가 REACHED인 수(reached), 평균 접촉 수 = 회사별 접촉 수의 평균. 응답에는 코드값·건수·날짜·회사 이름만 싣고 메모 글·질문 답 글·사람 이름(담당자 키 포함)·연락처·대표번호는 싣지 않는다 (추가 2026-11-13 #652 — PM 결정 2026-11-13) 세는 기준을 바꾼다(뜻이 바뀜, 칸 이름·모양은 그대로): 공정은 확정된 연결(state CONFIRMED = 사례 파일 확정 + 담당자 확정, superseded 제외)만 센다. 확정된 연결이 하나도 없는 회사(AI 제안뿐이거나 연결 없음)는 processCode null 한 줄에만 세고 그 줄 이름은 "공정 확인 전"이다(전에는 "공정 미확정"). 산업군은 industriesSource가 CASE_FILE·STAFF인 값만 세고, AI 제안뿐이거나 산업군이 없는 회사는 byIndustry 맨 끝 "산업 확인 전" 한 줄에 센다(전에는 "미확정"). companies[].processCodes·industries도 같은 확정 값만 싣는다(확인 전이면 빈 배열). 확정된 공정·산업군이 여러 개인 회사는 전처럼 각각 센다
      responses: { '200': { description: '(추가 2026-11-13 #608 — PM 확인 필요) Envelope({ asOf: date-time(계산 기준 시각), basis: { minSampleForRatio: integer(설정 값 그대로), closedWindowDays: integer(설정 값 그대로), companyCount: integer(표에 든 회사 수), olderClosedExcluded: integer(결과가 기간 밖이라 뺀 회사 수) }, byProcess: [{ processCode: processCode | null(공정 연결이 없는 회사는 null 한 줄 "공정 미확정", 맨 끝), processName: string, <집계 칸>, byIndustry: [{ industry: string(설정 industries 순서, 산업군이 없는 회사는 맨 끝 "미확정"), <집계 칸> }] }](역량 파일 공정 순서, 접촉한 회사가 0곳인 공정·산업군 줄은 싣지 않는다), companies: [{ oppId, name: string(회사 이름), processCodes: [processCode], industries: [string], contactCount: { total, call, email, visit }(상세 records.contactCount와 같음), outcomeStatus: outcomeStatus(최신 큰 단계), salesStep: salesStep | null(카드 salesStep과 같음), lostReasonCode: lostReasonCode | null(LOST일 때만), firstContactAt: date, lastContactAt: date(접촉 날짜 = attemptedAt, 없으면 저장한 날 KST), daysSinceFirstContact: integer(asOf의 KST 날짜 − firstContactAt), outcomeAt: date | null(성사·거절로 바뀐 날 KST, 그 밖의 단계는 null), daysToOutcome: integer | null(outcomeAt − firstContactAt, 음수면 0) }](마지막 접촉이 최근인 순, 같으면 회사 이름순) }). <집계 칸> = contactedCount: integer(접촉한 곳 수 = 표본 수), inProgressCount: integer(최신 단계 NOT_EXECUTED·IN_PROGRESS·SAMPLE_OR_REGISTRATION_APPROVED), onHoldCount: integer, wonCount: integer, lostCount: integer(넷의 합 = contactedCount), avgContactsToWon: number | null(성사한 회사들의 접촉 수 평균, 소수 1자리 0.5 올림, 성사 0곳이면 null — 0으로 나누지 않는다), contactReach: { CALL: { reached: integer, tried: integer }, EMAIL: { reached, tried }, VISIT: { reached, tried } }, lostReasons: [{ code: lostReasonCode, count: integer }](많은 순, 같으면 코드표 순서, 0건은 싣지 않음), ratios: { won: number(wonCount ÷ contactedCount), reach: { CALL: number | null, EMAIL: number | null, VISIT: number | null }(reached ÷ tried, tried 0이면 null) } | null. ratios는 소수 2자리(0.5 올림)이고 contactedCount가 설정 salesAnalysis.minSampleForRatio(초기값 10, #229와 같은 기준) 미만이면 null — 화면은 비율 없이 건수와 "표본 n건"만 보인다(docs/kpi-plan.md 0장). 접촉 기록이 하나도 없으면 byProcess·companies는 빈 배열, 건수는 0' } }   # (추가 2026-11-13 #652 — PM 결정 2026-11-13) processCode null 줄의 processName은 "공정 확인 전", 산업군 맨 끝 줄의 industry는 "산업 확인 전"으로 바뀐다. processCodes·industries·줄 나누기는 확정된 값만(위 summary)
```

경로 묶음과 단위: `/session`(U8), `/config/ui`·`/opportunities` 조회·`/opinions`(U1), `/bookmark`·`/approvals`·`/outcomes`·`/readiness-check`·`/activity`·`/records/{recordId}/cancel`·`/peers`(U5), `/homepage`·`/evaluations`(U2), `/questions/*`(U4), `/recontact`(U6), `/dashboard*`·`/export/*`(U7). 파일은 `api/routes/opportunities.py`, `records.py`, `evidence.py`, `questions.py`, `recontact.py`, `dashboard.py`, `session.py`로 묶음별 분리(U1 확장 지점 규칙). 추가조사 기록(ResearchTask, P2) 경로는 기능 설계에서 정한다(5장).

(추가 2026-11-13 #608 — PM 확인 필요) 경로 묶음 `/sales-analysis`(U7)를 더한다. 파일은 `api/routes/sales_analysis.py`(창구)와 `dashboard/sales_analysis.py`(계산). 대시보드와 다른 화면이라 `/dashboard*` 아래에 두지 않는다.

**요구 판정 표시 변환(C3 → C1, RuleEngine이 `displayResult`로 함께 냄)**: `checkResult=EXCLUDED` → `EXCLUDED`; `PASS` → `PASS`; `UNKNOWN`이고 `reqLevel=UNKNOWN` → `QUESTION_NEEDED`(승인 안 막음); `UNKNOWN`이고 `neededStage=LATER` → `LATER_STAGE`; `UNKNOWN`이고 `reqLevel=REQUIRED`이고 `neededStage ∈ {NOW, UNKNOWN}` → `PENDING_BLOCKS`(승인 막음); 그 밖의 `UNKNOWN`(우대·비요구) → `QUESTION_NEEDED`.

### C2. 흐름 부품 함수 (내부 함수, 한 흐름 = 한 트랜잭션)

```yaml
# shared-schema: WorkflowRunner 흐름 함수 계약
flows:
  common:
    returns: FlowResult
    FlowResult:
      ok: boolean
      affectedOppIds: [string]
      newEvalIds: [string]
      error: { message: string, nextAction: string, ref: string, kind: string | null, fields: [...] | null } | null
      counts: { evidenceCount: int, requirementCandidateCount: int, questionCount: int } | null   # (2026-11-04 PM 확정 — 이강욱 제안 #219) run_extract만 채움. 이번 조사로 새로 저장한 근거 수 전체(요구 후보 포함)·그중 요구 후보 수·새 질문 수. API /homepage가 문장(summary)을 분석하지 않고 이 숫자를 그대로 응답에 넣는다. 다른 흐름은 null
    transaction: 한 흐름 = SQLite 트랜잭션 하나(쓰기 잠금 대기 5초). 외부 호출(LLM·HTTP·파일/API 읽기)은 트랜잭션 밖에서 먼저.
    outsideTransactionRecords: [TransferLog, 호출/토큰 집계, IngestionRun 실패 사유·건너뛴 행]
    existenceCheck: 교차 부품 참조 ID는 저장 전에 소유 부품 조회로 확인, 없으면 거부 (ADR-011)
    staleEvaluationCheck: run_readiness_check·승인은 evalId가 최신 확정 평가와 다르면 STALE_EVALUATION으로 거부
  run_evaluation:            # ⓪ 평가 실행 (U1)
    input: { oppIds: [string] | null, baseDate: date | null, requestedBy: staffKey }
    steps: [ConfigRegistry 규칙 설정·묶음, 스냅샷 생성(CapabilityCatalog·OpportunityRegistry·EvidenceExtraction), RuleEngine evaluate + rank, EvaluationLedger 저장, OpportunityRegistry 공정 연결 갱신, ConfirmationDesk 질문 후보]
  run_extract:               # ① 근거 추출 (U2), 전체 60초 한도
    input: { oppId: string, url: string | null, pastedText: string | null, requestedBy: staffKey }
    outside: [robots 확인, HTTP 읽기(재시도 1회, 남은 시간 안), TransferGuard 검사·연락처 제거, LLM 어댑터(검사 통과 항목 ID만 받아 본문 직접 조회)]
    then: [EvidenceExtraction 저장, 요구 후보 저장, run_evaluation([oppId])]
  run_review_transition:     # ② 검수 전환 (U4)
    input: { targetKind: questionTargetKind, targetId: string, newStatus: enum[REVIEWED, RECHECK], reviewer: string, basis: string, reviewedAt: date }
    then: [CapabilityCatalog 전환(새 FieldEvidence 행), EvaluationLedger 영향 기회(첫 버전: 묶음 전체), run_evaluation]
  run_readiness_check:       # ③ 기한 체크 (U5)
    input: { oppId: string, checked: boolean, staffKey: string, evalId: string }
    then: [staleEvaluationCheck, EvaluationLedger ReadinessCheck 저장, run_evaluation([oppId])]
  run_recontact_save:        # ④ 재접촉 저장 (U6) — 보류(2026-11-03, PM 결정: U6 재접촉 보류)
    input: RecontactPayload (C1 /recontact 본문과 같음) + { enteredBy: staffKey }
    then: [존재 확인, 연락처 패턴 검사(있으면 fields 오류), OpportunityRegistry 저장(Interaction ①~⑤, Signal ⑥⑦), 이력 없음 판단, run_evaluation([oppId])]
    returnsExtra: { evaluatedAsNew: boolean }
  run_merge_confirm:         # ⑤ 병합 확정 (U3)
    input: { mergeCandidateId: string, keepCustomerId: string, decidedBy: string }
    then: [OpportunityRegistry 병합, 영향 기회, run_evaluation]
  run_ingest:                # ⑥ 수집 (U3·U9)
    input: { sourceId: string, scopeOverride: object | null, requestedBy: string }
    # (갱신 2026-11-06 PM 결정, #342 — 윗줄을 바꿈) input: { batchId: string }. 창구(POST /ingest)나 명령(geosan ingest)이 회차(opp_ingest_batch)를 먼저 만들고 회차 번호만 넘긴다. 소스·조건(criteria)·최대 건수(maxCandidates)·다시 판단 여부(rejudge)·요청자(requestedBy)는 실행 함수가 회차에서 읽는다(C6 #327 줄과 같음). 함수가 아직 없어 깨지는 코드는 없다
    #   AI 판단 다시 쓰기(PM 결정 2026-11-06, #221): 거산 전체 공정·산업 목록으로 한 번 판단해 저장하고(탈락 판단도 저장), 담당자가 조건을 바꾸면 저장된 판단에서 거르기만 한다. criteriaVersion에 담당자가 고른 공정·산업을 넣지 않는다(C6 src_candidate_judgment 줄 그대로). fitLevel·pickReason은 회사당 하나이고 거산 공정 가운데 가장 잘 맞는 공정 기준이다(공정별 등급은 1차에 없음)
    #   (추가 2026-11-12 PM 결정, #615) 다시 판단한 결과는 이미 목록에 있는 회사에도 옮긴다: AI가 찾아 올린 회사(opp_customer.ingestBatchId 있음)의 fitLevel·pickReason을 최신 판단으로 바꾸고, 카드 문장(opp_opportunity.cardReason)은 옛 pickReason과 같을 때만 바꾼 뒤 그 회사만 재평가한다. 사례 파일 회사, 담당자가 정한 값(거래 관계·산업군·출처·공정 연결), "제조업 아님"으로 바뀐 판단은 건드리지 않는다. 새 칸·새 명령·새 조사 비용 없음
    outside: [SourceIngestion 어댑터 읽기(파일·API, 재시도 1회)]
    then: [정규화·병합 후보, OpportunityRegistry 등록, IngestionRun 집계, run_evaluation(새 기회)]
    #   (추가 2026-11-08 PM 결정 B안, 점수 전 회사 목록 표시 #440·#427) run_evaluation(새 기회)에서 **찾은 회사(opp_customer.ingestBatchId 있음)가 항목 입력(eval_item_input)이 하나도 없으면 건너뛰지 않고 "평가 전" 기록을 남긴다**: eval_run 1행, score null, classificationCode `NOT_EVALUATED`(기획서 11분기 코드, 쉬운 말 "평가 전"), reason = 카드 pickReason, blockerText "점수 입력 전 · 거래 관계·필수조건 확인 전", nextAction "AI 조사 결과 확인 뒤 점수 입력". 목록은 이 기록으로 카드를 만들고(scoreState NONE, scoreDisplay --) 점수 전 순서 규칙(fitLevel 순)을 그대로 적용한다. 사례 파일 회사의 "항목 입력 없음" 건너뜀은 바뀌지 않는다. 점수 제안(#286)이나 담당자 입력으로 항목이 생기면 보통 재평가가 이 기록을 대체한다. 이유: 목록·정렬·상세 코드가 평가 기록을 전제로 짜여 있어 한 곳만 고치면 되고, 기획서 분류를 그대로 씀. 안 고른 방법: 목록이 평가 없는 회사도 보이게 카드 필수 칸을 선택 칸으로 바꾸기(서버·화면·약속이 모두 커짐)
```

### C3. 규칙 엔진 입력·출력 (내부 함수, 순수 계산)

```yaml
# shared-schema: RuleEngine 계약. 같은 입력 → 같은 출력(NFR1). DB·파일·네트워크 없음.
EvaluationInput:
  baseDate: date                       # 감쇠·기한 기준일 (수집일 아님, NFR12)
  profile: enum[NEW, RECONTACT]
  ruleConfig: RuleConfig               # C7 규칙 설정 + version + hash
  datasetKind: datasetKind
  opportunity: { oppId, customerId, relationStatus, purpose, companyFilterStatus, hasLinkedInteraction: boolean, linkedInteractionKinds: [interactionKind], cardReason: string|null }   # cardReason: 사례 파일 문장 그대로, 있으면 카드 추천 이유(더하는 변경 2026-10-26 PM, #139)
  processLinks: [{ linkId, processId, appliedMaterial }]
  requirements: [{ reqId, linkId|null, reqKind, name, content, reqLevel, scopeKind, neededStage, dueAt, certainty, requiredValue, unit, edition, holder|null, site|null }]
  signals: [{ signalId, signalKind, occurredAt, announcedAt, scheduledAt, deadlineAt, progressStatus, agreedWindow, certainty, evidenceIds }]
  interactions: [{ interactionId, kind, occurredAt, linkedToOpportunity, pastProcessItem, orderCount, sampleApproved, requirementMet, lossReason, lossResolved, lastDeliveryAt, orderCycle, certainty }]
  evidence: [{ evidenceId, sourceGrade, certainty, isLlmProposed, subject, occurredAt, securityGrade }]   # 처리 금지·철회 자료는 Ledger가 미리 제외
  capability:
    processes: [{ processId, code, name: string|null, materialCodes, performanceTags, reviewStatus, datasetKind }]   # name: 역량 파일 공정 이름 그대로, 카드 막는 조건 문장용(더하는 변경 2026-10-27 PM, #161)
    capabilities: [{ capabilityId, processId, capKind, numericMin, numericMax, unit, isDescriptiveOnly, reviewStatus }]
    deliveryRecords: [{ recordId, processId, industry, partType, reviewStatus }]
    qualifications: [{ qualId, kind, officialName, number, edition, holder, site, validFrom, validTo, reviewStatus, currentStatus }]
    qualificationScopes: [{ scopeId, qualId, scopeKind, processId, customerId, oppId, applicability, reviewStatus }]
  readinessCheck: { checked: boolean, checkedAt, evalIdAtCheck|null } | null
  researchReadiness: { hasGradedEvidence, hasQuestionSet, hasChannelAndOwner, questionCanChangeClass, estimatedHours, maxHours, questionSet } | null   # questionSet: 사례 파일 문장 그대로(더하는 변경 2026-10-26 PM, #139 카드 '다음 할 일')
  operationalReady: boolean            # 모든 거산 값 검수 완료 + 근거 사용 허용 (Ledger가 계산해 넘김)
EvaluationOutput:
  requirementChecks: [{ reqId, result: checkResult, displayResult: checkDisplay, stageJudged, scopeJudged, reason, comparedValue, qualId|null, linkId|null, followUpCondition }]
  filterState: filterState
  exclusionScope: enum[COMPANY, OPPORTUNITY, LINK] | null
  processLinkResults: [{ linkId, result: filterState, reason }]
  items: [{ itemCode, state: itemState, weight, matchRate, certainty, decay, score: int|null, factJudged, summary: string|null, reasoning, evidenceIds, usedCapabilityIds }]   # summary: 상세용 쉬운 요약, 입력에서 그대로 복사(더하는 변경 2026-10-26 PM, #139)
  totals: { E: int, F: int, T: int, P: int, R: int, S: number|null, C: number }
  coreEvidenceMet: enum[MET, RECHECK]
  timing: { directSignal: boolean, agreedWindow: boolean, readiness: boolean }
  researchReady: boolean
  classificationCode: classificationCode
  scoreState: enum[CONFIRMED, PENDING, NONE]  # (추가 2026-11-04 PM 승인, #262) totals.S가 null이면 NONE, 점수가 있고 FILTER_PENDING·OPS_PENDING이면 PENDING, 나머지는 CONFIRMED. 0점도 점수 있음
  displayFlags: { coreEvidenceRecheck: boolean, brochureDataset: boolean }
  sortKey: { group: enum[URGENT, PLANNED, REVIEW, OTHER], validUntil, E, F, directConfirmedWeight, P, oppId, relationStatus: relationStatus }  # #262: 평가 입력의 거래 관계를 정렬까지 전달. 예전 정렬 키에 없으면 UNCONFIRMED
  questionCandidates: [{ targetKind, targetId, text, currentValue, effectIfAnswered }]
rank:                                   # 순위도 RuleEngine 책임(도메인 설계 "정렬 키를 적용해 원래 순위를 매김")
  input: [{ oppId, profile, sortKey }]  # 같은 묶음(같은 프로필)의 출력들
  output: [{ oppId, originalRank }]
  rules:
    - 신규와 재접촉은 섞지 않음(묶음이 프로필별)
    - 그룹 순서 URGENT → PLANNED → REVIEW → OTHER
    - URGENT 안: validUntil 오름차순 → E 내림 → F 내림 → directConfirmedWeight 내림 → P 내림 → oppId
    - PLANNED 안: E → F → directConfirmedWeight → P → oppId
    - REVIEW 안: E → F → directConfirmedWeight → P → validUntil → oppId
    - OTHER 안(접촉 후보가 아닌 분류, 화면 정렬용): **모든 거산 값 묶음에서 E 내림 → P(판정한 배점) 내림 → oppId** (설정 `otherGroupSort` v0.17-c, 가설·설정값, PM 결정 2026-10-25 #63 원칙 2 "동점이면 더 많이 확인한 회사를 앞에"). 가능 점수 R은 정렬에 쓰지 않는다
    - (추가 2026-11-04 PM 기본안, #212 ① 거래 관계 입력) **거래 중(relationStatus EXISTING_CONFIRMED)인 기회는 같은 목록(공정 탭·전체) 맨 아래**로 보낸다: 접촉 후보 그룹·그 밖 그룹을 먼저 모두 정렬한 뒤 거래 중만 뒤로 빼고, 그 안에서는 위 규칙 순. 설정 `existingCustomerPlacement: BOTTOM | INLINE`(기본 BOTTOM, `examples/rule-config.yaml`). 카드 꼬리표 "기존 거래처". 분류·점수는 바꾸지 않는다(기존 거래처도 똑같이 평가). INLINE이면 지금처럼 섞어 정렬. 가상 사례 A정밀(EXISTING_CONFIRMED)은 단독 목록이라 기대값 11항목 영향 없음
    - (추가 2026-11-11 PM 결정, #567 거래 관계 확인 보류) 설정 `relationCheck: BLOCK | IGNORE`(생략 시 BLOCK = 이전 동작, 예시 파일은 IGNORE). IGNORE면 거래 관계 확인 전(UNCONFIRMED)을 필터 대기·막는 조건("거래 관계 확인 전"·"거래 여부")으로 쓰지 않는다. 신규 잠재고객만 찾으므로 거래 관계 확인은 기획에서 보류. 거래 중 정렬(`existingCustomerPlacement`)·점수 계산은 그대로. S06은 BLOCK 동작으로 유지
    - 이력: 처음에는 default R 내림 → E → oppId, 2026-10-21 갱신(기능 설계 Q6)으로 소개서 묶음만 E → R → oppId, 2026-10-25 v0.17-b로 소개서 E → P, v0.17-c로 default도 E → P. 부록 F.10은 접촉 분류 3가지의 순서만 정하므로 기획서 규칙·A정밀 기대값은 바뀌지 않는다(뜻·형식이 바뀌는 변경 아님, 버전 유지)
expectedValues:
  apjeongCase: { E: 77, P: 95, S: 81.1, R: 82, filterState: PASS, coreEvidenceMet: MET, classificationCode: CONTACT_URGENT }
  readingExample2: { E: 25, P: 25, S: 100, C: 12.5, contactCandidate: false }
```

### C4. 전송 보호 (내부 함수)

```yaml
# shared-schema: TransferGuard 계약. 호출자 표기 실수가 방어선을 뚫지 못하도록 기본 거부.
check_transfer:
  input:
    purpose: transferPurpose
    items: [{ kind: transferItemKind, securityGrade: securityGrade, refId: string }]
    requestedBy: staffKey | system
  rules:
    EXTERNAL_AI:
      - kind ∈ {NOTE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION, CAPABILITY_VALUE} 하나라도 → 전체 거부   # NOTE 명시: 2026-11-03 PM 지시로 메모에 연락처가 들어갈 수 있으므로 메모는 어떤 외부 호출에도 못 나감
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - securityGrade ∈ {PUBLIC, EXTERNAL_AI_OK}만 허용
      - (추가 2026-11-03 밤 PM 반영, 상세 화면 (1)) 홈페이지 본문은 **extract_main_phone → scrub_contacts** 순서를 지난 뒤에만 보낸다. 회사 대표번호는 우리 코드가 먼저 뽑아 저장하고(mainPhone·mainPhoneSourceUrl, 출처 HOMEPAGE), 그다음 모든 전화·이메일을 지운다. 번호는 어떤 외부 호출에도 나가지 않는다(C9 LlmAdapter는 번호를 뽑지 않음)
      - 월 호출 상한 초과 → 거부 (kind LLM_LIMIT)
      - (추가 2026-11-03, PM 결정 3) 월 비용 상한(`llm.monthlyCostLimitUsd`) 초과 → 거부 (kind LLM_LIMIT). 비용 = TransferLog의 입력·출력 토큰 × 단가(`llm.inputCostPerMillionTokens`·`outputCostPerMillionTokens`), 월별 합산. **OpenAI 호출에만** 적용
      - (2026-11-04 PM 확정) 사용량(토큰·비용)이 비어 있는 전송 기록 행이 1건이라도 있으면 → 거부 (kind USAGE_UNCONFIRMED, 쉬운 말 "AI 사용 기록에 문제가 있어 조사를 멈췄습니다 — 문의 번호와 함께 운영자에게 알려 주세요"). EXTERNAL_SEARCH도 같음. 지금 코드는 LLM_LIMIT으로 내므로 #218 풀기 명령 PR에서 kind·문구를 바꾼다. 키 없음·외부 호출 꺼짐·허용 모델/단가 설정 없음·키/모델 거부(401·403·404)는 kind LLM_NOT_CONFIGURED("AI 조사 설정이 아직 되어 있지 않습니다 — 문의 번호와 함께 운영자에게 알려 주세요", 다시 눌러도 안 풀림), 60초 초과는 kind TIMEOUT, AI 응답 없음·형식 오류·429 반복은 kind LLM_FAILED(다시 시도 가능). 지금 코드는 kind 없음, 같은 PR(또는 kind만 먼저 넣는 작은 PR)에서 붙임 **(바뀜 2026-11-10 PM 결정 #538) 사용량이 빈 기록으로 막지 않는다.** 사용량(비용)이 빈 EXTERNAL_AI·EXTERNAL_SEARCH 기록은 1건마다 `llm.unconfirmedCallCostUsd`(C7)로 쳐서 그달 비용 합에 더하고, 그 합으로 월 비용 상한(LLM_LIMIT)만 본다. 그래서 USAGE_UNCONFIRMED는 내지 않는다(코드값은 남김, 안 씀). 수동 정산으로 실제 값이 들어오면 추정 대신 실제 값을 쓴다. 이유: 12/11 뒤 운영자가 없어 잠금이 걸리면 풀 사람이 없다(11/10 실제 확인: 응답 대기 21초에 끊긴 호출 1건으로 그달 조사·후보 찾기가 모두 잠김). 추정값을 실제 평균(1회 약 $0.015~0.04)보다 크게 잡아 상한은 실제보다 일찍 닿는 쪽으로 안전하다. AI 응답 대기는 `/homepage` 전체 60초 한도 안에서 남은 시간만큼이다(HomepageReader의 20초는 홈페이지 읽기 값이고 AI 응답에는 쓰지 않는다)
      - (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) AI 고르기(C9 pick_candidates)로 나가는 것은 공개 소스 행(kind PUBLIC_TEXT, securityGrade PUBLIC, refId = src_factory_row 행 ID)의 회사명·단지명·생산품·공장주소뿐이다 **(추가 2026-11-08 PM 결정, 고르기 지시문 pick-v1 #221·#425)** 여기에 **업종명(있으면)** 을 더한다. 공장현황 파일 행은 업종명이 없어 비어 있고 공장등록 조회 행(src_factory_row.industryName)만 값이 있다. 업종명도 판단 입력이므로 행 지문(productHash)과 판단 기준 버전(criteriaVersion)에 입력 칸 목록과 함께 포함해 업종명만 바뀐 행도 다시 판단한다. 공장등록 조회로 받은 회사 전화번호·홈페이지 주소는 보내지 않는다. 대표자 이름·팩스번호는 받는 즉시 버려 저장도 전송도 하지 않는다. 월 호출·비용 상한과 USAGE_UNCONFIRMED 규칙은 그대로 적용 **(추가 2026-11-11 PM 승인 #570, 원자재)** 공장 행(sourceKind FACTORY)은 팩토리온 공장조회(C5 factoryon-xlsx, src_factory_profile)에서 #573과 같은 규칙(회사명 + 주소, 주소 표기만 다르면 같은 시·군에 그 이름의 공장이 하나일 때)으로 붙은 행의 **원자재(rawMaterials, 없으면 null)** 를 더해 보낸다. 공장 행의 업종명이 비어 있으면 붙은 팩토리온 행의 업종명을 대신 보낸다. 웹 후보는 붙이지 않는다. 원자재가 있는 행의 행 지문(productHash)은 [생산품, 보낸 업종명, 원자재]로 만들고, 원자재가 없으면 예전과 같은 [생산품, 업종명]이다. 입력 칸 목록에 rawMaterials가 더해져 판단 기준 버전(criteriaVersion)이 바뀌므로 저장된 판단은 다음 후보 찾기에서 한 번 다시 판단한다(비용은 지역별로 PM 확인 뒤 실행). 맞는 공장 수 줄(GET /ingest/preview)도 같은 지문으로 센다. 팩토리온 전화·홈페이지 칸은 표에 없어 보낼 수 없다
      - (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) 조회의 단지 입주 목록에서 온 행도 같은 규칙으로 나간다. 이 행은 업종명도 같이 나간다(공개 자료, 제조업인지 가리는 데 씀). 대표자 이름·팩스번호·회사 전화번호·홈페이지 주소는 목록 단계에서 읽지 않고 버린다
    EXTERNAL_SEARCH:   # (2026-11-03 저녁 PM 결정 B로 갱신) ② 홈페이지 찾기 — OpenAI 웹 검색 도구로 나가는 검색어. (처음 네이버 검색 API로 적었다가 B로 바꿈: 네이버 특약은 결과 저장·AI 입력 금지라 담당자 확정 단계가 필요했음)
      - 허용 kind: CUSTOMER_NAME, CUSTOMER_ADDRESS (둘 다 산단공 공개 CSV·사례 파일 출처, securityGrade PUBLIC)만. 그 밖의 kind(NOTE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION, CAPABILITY_VALUE, 연락처)가 하나라도 → 전체 거부
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - 하루 호출 상한(`homepageDiscovery.dailyCallLimit`) 초과 → 거부 (kind SEARCH_LIMIT, 쉬운 말 "오늘 검색 한도 초과")
      - 월 비용 상한(`llm.monthlyCostLimitUsd`)·월 호출 상한 초과 → 거부 (kind LLM_LIMIT). 웹 검색 비용(1,000회당 $10 + 토큰)도 OpenAI 비용이므로 같은 $20 안에서 센다
      - sideEffect: TransferLog 1행(kind WEB_SEARCH, 시각·기회 ID·호출 수·토큰만, 검색어 본문 없음). AI가 고른 주소 하나와 확신도·이유는 opp_customer/기회에 저장한다(OpenAI 약관상 결과 저장 가능)
      - (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) 후보 찾기 웹 검색의 검색어에는 담당자가 고른 조건의 이름(코드표의 공정 이름·지역 이름·산업 이름)만 넣는다. 거산 역량 값(CAPABILITY_VALUE)·내부 이력·거래 관계·메모·이미 목록에 있는 회사의 기록이 하나라도 있으면 전체 거부. 결과 가운데 채용 사이트·유료 기업 정보 사이트(candidateWebSearch.blockedDomains)에서 나온 것은 버리고, 사람 이름·전화·이메일은 저장하지 않는다. 하루 검색 횟수 한도와 월 호출·비용 상한, USAGE_UNCONFIRMED 규칙을 모두 적용
      - (추가 2026-11-12 PM 결정, 웹 검색 갈래 남은 기준 #314·#639) 아직 목록에 없는 웹 후보도 홈페이지 찾기(C9 HomepageFinder.find)를 부를 수 있다. 검색어로 나가는 것은 그 후보의 공개 회사명·주소뿐이다(src_web_candidate 행, kind PUBLIC_TEXT, securityGrade PUBLIC, refId = 후보 행 ID — 행 ID 범위로 승인). 전송 기록(tg_transfer_log)은 oppId 없이 그 후보 찾기 회차의 batchId로 남기고, 비용과 하루·월 한도·USAGE_UNCONFIRMED 규칙도 같은 회차에 합산해 적용한다. 검색 결과 요약 글(snippet)·고른 조건·거산 내부 값(역량 값·내부 이력·거래 관계·메모)은 넣지 않는다
      - (추가 2026-11-05 밤 PM 결정, 채용 공고 근거 #313·#315 — 만들기는 후보 찾기 다음) 찾은 회사의 채용 공고를 찾는 검색어는 기존 허용 kind(CUSTOMER_NAME, CUSTOMER_ADDRESS)만 쓴다. 채용 사이트 페이지를 우리가 직접 읽어 오지 않고 AI 웹 검색이 돌려준 요지와 출처 주소만 받는다. 인사 담당자 이름·연락처는 저장하지 않는다
    EXTERNAL_GEOCODE:   # (추가 2026-11-03, 갱신 2026-11-13 이강욱 확인 #222) 회사 주소만 전송. 위치 CSV → 주소검색·CSV 재대조 → 좌표제공 → 네이버 실시간 보완
      - 허용 kind: CUSTOMER_ADDRESS(산단공 공개 CSV 출처, securityGrade PUBLIC)만. 회사명·메모·내부 값·연락처가 섞이면 전체 거부
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - 하루 호출 상한(`geocoding.dailyCallLimit`) 초과 → 거부 (kind GEOCODE_LIMIT, 쉬운 말 "오늘 좌표 변환 한도 초과")
      - sideEffect: TransferLog 1행(kind GEOCODE, 시각·고객 ID·호출 수·성공 여부만, 주소 본문 없음). 받은 좌표는 opp_customer에 저장(약관상 저장 금지 문구 없음, 신청서 용도란에 저장 용도 명시)
      - (2026-11-13 확인) 위 저장 대상은 CSV·행안부 공공좌표뿐이다. 네이버 응답·좌표·파생 거리·개별 주소 결과는 DB·파일·프로세스 공용 캐시에 저장하지 않고 한 요청의 거리 표시에서만 사용한다. 전송 기록에도 좌표·주소·키·응답 본문은 없다. 호출 한도는 행안부 검색·좌표·네이버 및 재시도 합계이며 하루 10,000회(설정 값), 실패도 센다. 빈 응답과 통신·설정 오류는 구분한다.
    OUTPUT_EXPORT:   # 질문 목록(거산에 보내는 것)·엑셀(내부용)
      - securityGrade = FORBIDDEN 또는 UNKNOWN → 전체 거부
      - kind 없음 → 전체 거부
      - 허용 kind: PUBLIC_TEXT, EVIDENCE, OPPORTUNITY_INFO, QUESTION, CAPABILITY_VALUE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION (내부용 출력이므로 허용하되 파일에 "내부용·고객 제출용 아님"과 가상 표시를 넣는다)
      - (추가 2026-11-03 PM 지시) kind NOTE(영업 메모)와 회사 대표번호(mainPhone)는 엑셀·질문 목록에 넣지 않는다. (추가 2026-11-04 PM 결정) 질문 답(q_question 회신 칸·rec_note kind REPLY)과 활동 이력(/activity)도 NOTE와 같은 취급: 엑셀·질문 목록에 넣지 않고 EXTERNAL_AI·EXTERNAL_SEARCH에서 거부. 거절 이유 코드(lostReasonCode)는 코드값이라 엑셀에 나가도 됨. 남은 자유 문장에는 scrub_contacts를 적용한다(연락처는 파일로 나가지 않음). (추가 2026-11-12 PM 지시 #594) 검토사항 자료 줄에 붙은 메모(reviewItems[].note)와 비슷한 회사 응답(GET /peers)도 NOTE와 같은 취급이다: 화면 전용, 엑셀·질문 목록에 넣지 않고 EXTERNAL_AI·EXTERNAL_SEARCH에서 거부. 취소된 메모의 본문은 상세·활동 이력·비슷한 회사 응답에도 싣지 않는다(DB에만). 영업 전략 초안 생성(#27)에 넣을 수 있는 것은 /peers의 summary(건수)뿐이고, 그것도 #247 결정이 난 뒤에만이다. [붙여넣고 조사]의 본문은 기존 EXTERNAL_AI 규칙(공개 자료만·연락처 제거) 그대로 (추가 2026-11-12 PM 결정 #607) 꼬리 질문 답(rec_outcome_answer)과 세부 단계도 영업 기록이라 NOTE와 같은 취급이다(엑셀·질문 목록·외부 AI에 안 넣음). 예외는 배포 전 시험 기간 에이전트 전송(#561 결정 3, #609)뿐이다. 분석표(#608)는 내부 화면이라 코드값 건수로 쓴다
      - (추가 2026-11-13 #217 — PM 결정 2026-11-13) 엑셀 내려받기(C1 GET /export/xlsx)의 내려받은 기록 1행(TransferLog — 누가 언제 몇 건을 내려받았는지, 본문 없음)은 **지금 만들지 않는다. 설정 `export.xlsxEnabled`를 켜기 전에 반드시 만든다**(기록이 생기기 전에는 예시 설정·배포 설정에서 켜지 않는다). 지금은 스위치가 꺼져 있어 파일이 나가지 않으므로 남길 전송이 없다. 자유 문장 칸의 연락처는 칸 전체를 지우지 않고 그 부분만 "[연락처 제거]"로 바꾼다(scrub_contacts 그대로). 기록이 만들어지기 전에는 `export.xlsxEnabled: true`인 설정을 설정 검사가 거부한다(설정 파일 읽기·check-config 등록·DB 사본 읽기 모두, 오류 칸 `export.xlsxEnabled`, "엑셀 내려받기는 아직 켤 수 없습니다. 누가 언제 내려받았는지 남기는 기록을 만들기 전에는 켤 수 없으니 false로 두어 주세요.")
      - (추가 2026-11-13 #608 — PM 확인 필요) 영업 분석표(GET /sales-analysis)도 영업 기록에서 나온 내부 전용 화면이다: 접속 보호 뒤 화면에서만 보이고 엑셀·질문 목록에 넣지 않으며 EXTERNAL_AI·EXTERNAL_SEARCH로 보내지 않는다. 응답 자체에 메모 글·질문 답 글·사람 이름·연락처·대표번호가 없다(코드값·건수·날짜·회사 이름만). 에이전트(#609)가 이 숫자를 쓸지는 #609에서 따로 정한다
      - 예외: 출력물이 외부 제출용으로 표시된 경우(이번 범위 없음)는 INTERNAL_ONLY 이상을 거부
  screenMapRule:   # (추가 2026-11-03 PM 결정, 대시보드 지도 — TransferGuard 용도가 아니라 화면 규칙) 네이버클라우드 Maps 웹 지도(Dynamic Map)에 거산 내부 정보가 나가지 않게
    - 지도 SDK에 넘기는 값은 마커 위치 좌표와 원의 중심·반지름뿐. 회사 이름·영업 단계·거리·메모는 SDK 함수 인자로 넘기지 않고 우리 쪽 HTML 요소(말풍선)로 그린다
    - 네이버 서버로 가는 것은 지도 조각(타일) 요청(화면 중심·확대 단계)과 클라이언트 ID·페이지 주소뿐. 마커는 브라우저 안에서 그려지며 서버로 전송되지 않는다
    - naver.maps.Service(검색·지오코딩·길찾기)는 호출하지 않는다. 검사: 화면 테스트에서 SDK 가짜 객체를 두고 Service.* 호출이 0건인지 확인(Vitest)
    - 지도용 데이터(GET /dashboard/map)는 접속 보호 뒤에만, 응답에 메모·연락처·대표번호 없음. 클라이언트 ID는 콘솔에서 허용 서비스 URL을 등록
  output: { allowed: boolean, rejectedItems: [{ refId, reason }], logId: string }
  noPartialSend: allowed=false면 호출자는 아무것도 보내지 않는다(걸러서 다시 보내지 않음)
  sideEffect: TransferLog 1행 (본문 없음, 트랜잭션 밖). LLM 재시도는 호출마다 1행
  #   (추가 2026-11-06 PM 결정, #327) 후보 찾기 AI 고르기(C9 pick_candidates)의 TransferLog 행은 기회 ID 대신 회차 ID(batchId)를 적는다(C6 tg_*). 한도 검사·사용량 확정 규칙은 그대로
exportColumnKinds:          # 내보내기 항목에 붙는 kind (호출자가 임의로 적지 않고 소유 부품 속성에서 유도)
  questionList: { 질문 문장: QUESTION, 대상·현재 값: CAPABILITY_VALUE, 기회 이름: OPPORTUNITY_INFO }
  xlsx: { 후보·분류·점수: OPPORTUNITY_INFO, 근거 인용: EVIDENCE(각자 securityGrade), 의견·승인·결과: INTERNAL_HISTORY, 재접촉 행: RECONTACT_INPUT, 거래처 관계: CUSTOMER_RELATION }   # (추가 2026-11-13 #217 — PM 결정 2026-11-13) 지금 파일은 회사·공정·점수·단계·다음 일정 다섯 열만 담는다. 나머지 열(근거 인용·승인·재접촉 행·거래처 관계 등)은 설정을 켤 때 PM이 정한다
scrub_contacts:
  input: { text: string }
  output: { text: string, removedCount: int }     # 이메일·전화번호 패턴 제거. 홈페이지 본문·파일 투입 자유 문장 모두에 적용
extract_main_phone:          # (추가 2026-11-03 밤 PM 반영, 상세 화면 (1)) 홈페이지 본문에서 회사 대표번호 1개를 코드가 뽑는다. scrub_contacts보다 먼저 돈다
  input: { text: string, pageUrl: string }
  output: { phone: string|null, sourceUrl: string|null }   # 설정 mainPhone.allowedPrefixes(지역번호 02·031~064) 안의 번호 패턴만 후보. 010 휴대폰·전국대표번호(15xx·16xx·18xx)·이메일은 후보 아님(전국대표번호는 설정에 더하면 허용). 후보가 여럿이면 본문에서 먼저 나오는 것. 사람 이름이 같은 줄에 붙은 번호(예 "김○○ 010-…")는 제외
usage:
  input: { period: enum[MONTH, WEEK], from?: date }
  output: { callCount: int, tokenCount: int, rejectedCount: int, inputTokens: int, outputTokens: int, webSearchCalls: int, costUsd: number, costLimitUsd: number, callLimit: int, alertReached: boolean }   # (추가 2026-11-03) inputTokens 이후 칸. alertReached = costUsd ≥ costLimitUsd × llm.costAlertRatio
```

**수동 사용량 정산 (추가 2026-11-04 PM 승인, #218)** **(바뀜 2026-11-10 PM 결정 #538: 필요할 때만 하는 선택 작업. 정산 전에는 추정 비용 `llm.unconfirmedCallCostUsd`로 치고 막지 않는다)**: 응답 사용량이 없는 EXTERNAL_SEARCH / EXTERNAL_AI의 실제 호출은 운영자가 제공사에서 확인한 입력·출력 토큰·웹 검색 횟수·실제 USD 비용을 기록 번호별로 입력해 정산한다. 정상 응답의 자동 정산·단가 계산은 그대로다. 원래 호출 시각·회사 연결·허용 판정·요청자·call_count는 유지하고 월 귀속과 하루·월 호출 횟수를 돌려주지 않는다. 수동 정산 시각(UTC)·처리자만 추가 기록한다. 정상 응답과 수동 정산이 겹치면 쓰기 잠금 안에서 미확정 상태를 다시 확인해 먼저 확정된 값을 보존하며, 실패하면 전부 되돌린다. 오래됐다는 이유로 사용량을 0으로 만드는 자동 처리는 없다. 본문·검색어·연락처·키·자유 메모는 받지 않고 외부 요청을 보내지 않는다.

### C5. 외부 소스 어댑터 (내부 함수 + 소스 계약표)

```yaml
# shared-schema: SourceIngestion 어댑터 인터페이스. 소스 하나 = 어댑터 하나. 소스 계약표 행이 있어야 실행.
SourceAdapter:
  sourceId: string                       # 예: kicox-factory-csv, kicox-production-api, nier-water-csv, g2b-bid-api, manual-list
  read(config): RawRecord[]              # 트랜잭션 밖. CSV: 인코딩(UTF-8/CP949) 판별, 필수 열 검사(없으면 어떤 열이 없는지 알리고 멈춤)
  normalize(raw): { customer: { name, normalizedName, bizNumber|null, normalizedAddress, identityBasis }, opportunity: { item, project, distinctionBasis } | null, discoveryPath: { pathKind, originKey }, signal: Signal | null, flags: [enum[OWN_PLATING_LINE_SUSPECTED, COMPETITOR_LIST, DEFENSE_SEED]] }
  summary(): IngestionRun { rawCount, customerCount, oppCount, filterSummary, skippedRows: [{ rowNo, reason }], status }
SourceContract:
  { sourceId, sourceName, allowedUse, allowedStorage, termsRef, confirmedBy, confirmedAt }
  rule: confirmedAt 없는 소스는 run_ingest가 거부
scope:
  { regions: [string], productKeywords: [string], maxCandidates: int }   # ConfigRegistry 앱 설정
# (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) — 2026-11-05 실제 파일·조회로 확인
#   kicox-factory-csv = 산단공 전국등록공장현황 파일(공공데이터포털 15105482, 기준일 2025-12-31, 220,705행, CP949, 1년에 한 번 갱신). 열 5개: 순번·회사명·단지명·생산품·공장주소. 단지명이 빈 행(61%)은 산업단지 밖 공장. 순번은 그 파일 안에서만 쓰는 번호라 식별에 쓰지 않고 회사명+공장주소로 맞춘다. **후보 목록은 이 파일에서 얻는다**(사례 파일 18곳 중 17곳이 들어 있음).
#   kicox-production-api = 공장등록생산정보조회(15087611). 목록 뽑기가 아니라 고른 회사의 정보 채우기에만 쓴다(C9). **(바뀜 2026-11-06 PM 결정 #323: 산업단지명 조회를 목록에도 쓴다 — 아래 "목록 출발점 둘" 줄)**
#   지역 거르기: 지역은 공장주소 글자로 추린다. 단지 이름 글자로 추리지 않는다(예: "아산"에 전북 고창아산농공단지가 섞임).
#   같은 회사 가리기: 파일의 등록 이름이 실제 이름과 다를 수 있어(같은 주소에 짧은 이름으로 올라간 회사가 있었음) 이름만으로 판단하지 않고 주소를 같이 본다. 애매하면 opp_merge_candidate "확인 필요".
# (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) — 2026-11-06 실제 파일·조회로 확인
#   목록 출발점 둘: ① 공장현황 파일(단지 안팎 모두, 1년에 한 번 갱신) ② 공장등록 조회의 산업단지명 조회(단지 안, 지금 입주한 회사). 파일은 그대로 두고 조회를 더한다. 확인: 천안제3일반산업단지가 파일 100행·조회 266행이고, 조회에만 있는 회사 151곳 가운데 제조업 14곳(나머지는 지식산업센터의 비제조 입주 회사가 많음). 조회는 단지 이름으로만 목록을 주므로 단지 밖 공장(파일의 61%)은 파일에서만 나온다.
#   부를 단지 이름: 고른 지역의 파일 행에 적힌 단지명을 그대로 쓴다(2025-12-31 파일 기준 충남 148개·대전 10개·세종 15개). 파일에 한 줄도 없는 새 단지는 설정 ingestion.complexList.extraNames에 운영자가 더한다.
#   거르기·합치기: 조회 결과도 공장주소로 지역을 다시 추린다(단지 이름 조회는 부분 일치라 다른 지역 단지가 섞임). 파일 행과 같은 회사(회사명+공장주소, 위 "같은 회사 가리기")면 파일 행을 그대로 쓰고 조회 행은 더하지 않는다. 조회에만 있는 회사는 src_factory_row에 sourceId kicox-production-api 행으로 더한다. 그 뒤 AI 고르기부터는 파일 행과 똑같이 간다(제조업이 아닌 회사는 AI가 뺌).
#   다시 쓰기·한도: 단지별 조회 결과는 ingestion.complexList.cacheDays 동안 다시 쓴다(그 안에는 다시 부르지 않음). 한 번 찾기에 드는 호출은 단지 수만큼이고(1000건이 넘는 단지만 더 부름), 하루 호출 한도(C9 dailyLimitGuard)를 넘기지 않는다. 한도에 걸리거나 조회가 실패하면 받은 데까지만 쓰고 나머지는 파일 목록으로 계속하며 회차에 complexListSkippedReason을 남긴다(부분 결과를 완전한 것처럼 보이지 않음, NFR10).
# (추가 2026-11-11 PM 승인 #573, 보조 자료 2개 — 후보 목록의 출발점이 아니라 이미 목록에 있는 회사에 붙이는 자료)
#   factoryon-xlsx = 산단공 팩토리온 공장조회를 지역별로 내려받은 엑셀(.xlsx, 여러 파일). 열 20개 가운데 회사명·산업단지명·생산품·공장주소(도로명, 비면 지번)·원자재·종업원수(총인원)·업종번호·업종명·공장규모만 읽고, 전화번호·홈페이지·지목·용도지역·면적·관할기관·순번·대표업종·설립구분은 읽는 즉시 버린다. 2026-11-11 파일 대전 4,774·세종 1,399·충남 12,631행, 이름+주소가 맞는 목록 회사 125/178(이름만 156)
#   nier-water-csv = 국립환경과학원 특정수질유해물질 배출량조사시스템 업체정보(CSV. Numbers 파일은 CSV로 내보내 씀). 열: 사업장명·관할기관·사업장소재지(도로명주소)·폐수처리형태. 같은 사업장이 처리형태마다 한 줄씩이라 사업장명+주소로 하나로 합친다. 전국 1,989행 중 충청권 148곳
#   공통: 설정 ingestion.regions의 시·도 행만 저장한다. 기준일은 파일 이름의 YYYYMMDD(앞이나 끝)이고, 저장된 것보다 오래된 파일은 거부한다. 새 파일을 넣으면 그 소스의 행을 통째로 바꾼다(원본 파일로 다시 만들 수 있는 보조 자료라 이력을 두지 않음). 소스 확인(SourceContract) 기록이 없으면 거부. AI·외부 전송 없음. 공개 칸에 연락처 형식이 있는 값은 저장하지 않는다
#   회사 붙이기: 실제 회사(가상 제외)의 정규화한 회사명+주소가 같은 행을 붙인다. 없으면 회사명이 같고 같은 시·군인 행이 꼭 하나일 때만 붙인다(주소 표기 차이). 수질 명단은 사업장명이 회사명과 같거나 회사명으로 시작하고(예: "○○ 제2공장") 같은 시·군일 때 붙인다. **(바뀜 2026-11-12 PM 확인 #613)** 같은 시·군 대신 **도로명과 건물번호까지 같을 때만** 붙인다. 괄호 안 동 이름·"외 19필지" 같은 표기 차이는 빼고 견주며, 도로명이 없는 지번 주소는 견줄 수 없어 붙이지 않는다(같은 이름의 다른 공장이 섞이지 않게). 애매하면 붙이지 않는다. 불러오기 명령(C8 source-load)과 후보 등록 때 같은 규칙으로 붙인다
criteria:
  { processCodes: [processCode], regions: [string], industries: [string] }   # 담당자가 고른 찾기 조건(C1 POST /ingest 본문과 같은 모양)
```

### C6. 공유 데이터 (SQLite 하나, 테이블 접두사로 소유)

```yaml
# shared-schema: 테이블 소유와 교차 참조 규칙 (ADR-011). 세부 열은 기능 설계 데이터 사전에서.
ownership:
  cfg_*:   ConfigRegistry        # cfg_rule_config_version, cfg_app_setting
  cap_*:   CapabilityCatalog     # cap_process, cap_process_capability, cap_delivery_record, cap_qualification, cap_qualification_scope, cap_qualification_status, cap_field_evidence
  opp_*:   OpportunityRegistry   # opp_customer, opp_relation_history(추가 2026-11-04 PM 결정: customerId, oppId, fromStatus, toStatus, staffKey, changedAt — 거래 관계 변경 이력, 덧붙이기만. 활동 이력 RELATION_CONFIRMED의 원천), opp_merge_candidate, opp_interaction, opp_opportunity, opp_discovery_path, opp_process_link, opp_requirement, opp_signal, opp_ingest_batch(batchId, sourceId, requestedBy: staffKey|SYSTEM, startedAt, finishedAt|null, newCount, mergeCandidateCount, researchDoneCount, status: RUNNING|DONE|FAILED — 추가 2026-11-04 PM 결정 ①, #221. 회차는 지우지 않음)
  src_*:   SourceIngestion       # src_ingestion_run, src_source_contract
  #   (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) src_factory_row(rowId, sourceId, fileDate, companyName, complexName|null, product, address, region, productHash, loadedAt, missingSince|null — 공장현황 파일을 읽어 둔 행. 새 파일에서 사라진 행은 지우지 않고 missingSince만 채운다. 대표자·전화 열 없음), src_candidate_judgment(rowId, criteriaVersion, productHash, isManufacturer, processCodes: json, industries: json, reason, judgedAt, model — "언제, 어떤 생산품 글과 기준을 보고 내린 판단" 메모. productHash(생산품 글)나 criteriaVersion(거산 공정·산업 목록·지시문)이 달라지면 낡은 판단으로 보고 다시 판단한다. 영구 정답 아님). opp_ingest_batch에 더하는 열: criteria: json(processCodes·regions·industries), scannedCount, judgedCount, pickedCount, judgePendingCount
  #   (추가 2026-11-05 저녁 PM 반영, AI 점수 제안 1차 최소 범위 #286) eval_item_input·opp_process_link에 더하는 열: source: enum[CASE_FILE, AI, STAFF], state: enum[PENDING, CONFIRMED], confirmedAt|null, confirmedBy|null, evidenceRef|null (더하는 마이그레이션, 기존 행은 CASE_FILE·CONFIRMED). 평가는 AI 제안(PENDING)을 입력으로 쓰되 사례 파일·담당자 값이 있으면 그 값을 쓴다
  #   (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) src_web_search_run(runId, criteria: json, criteriaHash, searchedAt, expiresAt, resultCount, droppedCount, requestedBy — 같은 조건의 검색 결과를 expiresAt까지 다시 씀), src_web_candidate(candidateId, runId, companyName, address|null, sourceUrl, sourceDomain, registryStatus, homepageUrl|null, droppedReason|null — 사람 이름·연락처 열 없음). opp_customer에 더하는 열: discoverySource, discoverySourceUrl|null, registryStatus|null. src_candidate_judgment에 더하는 열: fitLevel
  #   (추가 2026-11-09 PM 결정, 웹 후보 찾기 착수 #314·#487 — 유동렬 질문 답) src_web_candidate에 더하는 열: snippet|null(검색 결과에 적힌 공개 생산품 요약 한 줄. 예 "알루미늄 브라켓 제조". 저장 전 연락처 검사를 거치고 사람 이름·전화·이메일이 있으면 저장 거부. 공공자료 갈래의 product 칸과 같은 구실로 AI 판단의 입력이 되고, cacheDays 안 같은 조건에서는 검색도 판단도 다시 부르지 않는 재료다). src_candidate_judgment에 더하는 열: webCandidateId|null(src_web_candidate 외래키). 규칙: rowId(src_factory_row)와 webCandidateId 가운데 **꼭 하나만** 채운다(DB 제약, rowId는 빈 값 허용으로 바꾸되 기존 행은 모두 값이 있어 영향 없음). 판단 승인·저장·재사용 부품은 채워진 쪽을 따라가고, 전송 승인은 두 소스 모두 행 ID 범위로 한다. 웹 후보의 productHash는 snippet으로 만든다. 안 고른 방법: 웹 후보를 src_factory_row에 끼워 넣기(산단공 자료와 웹 자료의 출처가 섞임), 판단 기록 없이 바로 등록(왜 들어왔는지 근거가 안 남아 출처 저장 규칙 위반).
  #   (추가 2026-11-12 PM 결정, 웹 검색 갈래 남은 기준 #314·#639) src_web_candidate.registryStatus 값에 PENDING(조회 대기)을 더한다(FOUND·NOT_FOUND·PENDING): 공장등록 조회를 아직 안 했거나 한도·조회 실패로 끝내지 못한 후보. PENDING 후보는 목록(opp_customer)에 넣지 않고 보관만 하며, 같은 조건으로 다시 찾을 때 검색은 다시 하지 않고 조회만 이어서 한다. NOT_FOUND는 조회가 끝났고 정말 없을 때만 쓴다. opp_customer.registryStatus와 카드·상세의 registryStatus는 지금처럼 FOUND·NOT_FOUND|null뿐이다(PENDING은 화면에 나가지 않음 — C1 응답 변경 없음). src_web_candidate에 더하는 열: homepageConfidence|null, homepageReason|null(등록 전 홈페이지 찾기 결과 보관용, C9). 사람 이름·연락처 열은 여전히 없다
  #   (추가 2026-11-06 PM 결정, 표면처리를 직접 하는 회사 표시 #319) src_candidate_judgment에 더하는 열: ownPlatingLineSuspected, ownPlatingLineBasis|null. opp_customer에 더하는 열: ownPlatingLineSuspected, ownPlatingLineBasis|null, ownPlatingLineSource: enum[AI, INDUSTRY_NAME]|null
  #   (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) src_factory_row에 더하는 열: industryName|null(조회의 업종명), factoryManageNo|null(조회의 공장관리번호 — 같은 공장을 다시 받았을 때 맞추는 데 씀), fetchedAt|null(조회로 받은 시각). 조회에서 온 행은 sourceId kicox-production-api이고 fileDate 대신 fetchedAt을 채운다(fileDate는 빈 값 허용 — 아직 만들지 않은 표라 기존 행 없음). 대표자·팩스·전화 열 없음(그대로). src_complex_fetch(complexName, fetchedAt, expiresAt, rowCount, status: enum[OK, FAILED] — 단지별로 언제 받았는지. expiresAt까지 다시 부르지 않는다**(추가 2026-11-08 PM 결정, #405 유동렬 질문 답)** rowIds: json[string] — 이 조회가 받은 src_factory_row 행 번호 목록(기본 빈 목록). 조회 결과는 고른 지역과 상관없이 받은 행을 전부 저장하고 다시 쓸 때 주소의 지역으로 거른다(범위는 따로 적지 않음). 다시 쓰기 조건은 status OK이고 expiresAt 전인 조회의 rowIds뿐이다 — 쪽을 하나라도 못 받으면 FAILED로 적되 받은 행은 버리지 않고 그 회차에서만 쓰고, 0건으로 끝난 성공은 OK라 다시 쓴다. rowCount > 0인데 rowIds가 비어 있는 옛 기록은 빈 성공으로 다시 쓰지 않는다. 같은 공장을 다른 조회가 또 받아도 각 조회의 rowIds는 그대로 남고 행 내용은 최신 값을 쓴다. 안 고른 방법: 행에 fetchId 열(나중 조회가 앞 연결을 덮음), 조회마다 응답 사본 저장(자료 두 벌·연락처 제거 중복), 상태값 PARTIAL 추가(하는 일이 FAILED와 같음)). opp_ingest_batch에 더하는 열: complexListSkippedReason|null
  #   (추가 2026-11-11 PM 승인 #573, 보조 자료) src_factory_profile(profileId, sourceId=factoryon-xlsx, fileDate, companyName, normalizedName, address, normalizedAddress, region, rawMaterials|null, employeeCount|null, industryCodes: json, industryName|null, scale|null, loadedAt — 전화·홈페이지 열 없음), src_water_site(siteId, sourceId=nier-water-csv, fileDate, siteName, normalizedName, address, normalizedAddress, region, agency|null, treatmentTypes: json, loadedAt). opp_customer에 더하는 열: factoryRawMaterials|null, factoryEmployeeCount|null, factoryScale|null, factoryProfileDate|null(붙인 팩토리온 행의 값을 옮겨 둠 — 목록을 빨리 그리려고). ownPlatingLineSource 값에 INDUSTRY_CODE·WATER_LIST를 더한다(검토사항 확인 줄의 source는 둘 다 RULE)
  #   (추가 2026-11-12 PM 결정 #617) opp_customer에 더하는 열: factoryIndustryName|null(붙은 팩토리온 행의 업종명. 다른 공장 정보 열과 같이 불러오기 때 다시 붙임)
  #   (추가 2026-11-06 PM 결정, 후보 찾기 저장 표 #327 — 코드에 꼭 필요한데 약속에 없던 칸) opp_ingest_batch에 더하는 열: maxCandidates|null(요청한 최대 건수), rejudge: boolean(저장된 AI 판단을 무시하고 다시 판단하는 회차인지, C8 --rejudge. 실행 함수는 회차 ID만 받고 이 칸을 읽는다), skippedCount(같은 회사라 건너뛴 수, C1 POST /ingest 응답), failureReason|null(status FAILED일 때 사유 한 줄), webSearchUsed, webCandidateCount, webDroppedCount, webFromCache, webSkippedReason|null(C1 meta.latestIngest와 같은 이름·뜻). 실행 중(RUNNING) 회차는 DB가 하나만 허용한다(C1 409 INGEST_RUNNING의 바탕). opp_customer에 더하는 열: fitLevel|null, pickReason|null(C1 카드 칸과 같은 뜻 — 회사를 목록에 넣을 때 AI 판단을 옮겨 적는다). ingestBatchId·ingestedAt(C7 customer에 이미 있음)도 이 묶음에서 만든다. 기존 회사는 discoverySource CASE_FILE. opp_merge_candidate(mergeCandidateId, customerIdA, customerIdB, matchBasis, status(처음 값 PENDING), batchId|null, decidedBy|null, decidedAt|null — C2 run_merge_confirm 입력과 맞춤). src_ingestion_run(runId, batchId|null + C5 IngestionRun 칸), src_source_contract(C5 SourceContract 칸 그대로). 식별 열: src_candidate_judgment.judgmentId, src_complex_fetch.fetchId. 대표자 이름·팩스·전화·사람 연락처 열은 어느 표에도 없다(검사로 확인). eval_item_input의 출처·상태 열(#286)은 이 묶음에 넣지 않았다(점수 제안 작업 때)
  #   (추가 2026-11-10 PM 결정 #549) opp_ingest_batch에 더하는 열: estimatedUsd: number|null(접수 때 예상 금액, C1 `GET /ingest/preview` estimate.totalUsd. 옛 회차는 null). 실제 금액은 열을 두지 않고 전송 기록에서 센다(C1 같은 줄의 actualUsd). 더하는 마이그레이션
  tg_*:    TransferGuard         # tg_transfer_log. (추가 2026-11-04 PM 승인, #218) nullable reconciled_at(UTC 시각)·reconciled_by(설정 staffKey, viewer 제외): 수동 사용량 정산 시각·처리자. 기존 요청자·허용/거부 이력 보존 **(바뀜 2026-11-06 PM 결정, #327·#221)** oppId를 빈 값 허용으로 바꾸고 batchId|null(회차 번호)을 더한다 — 후보 찾기의 AI 고르기는 회사가 목록에 들어오기 전에 돌아 영업기회 번호가 없다. oppId·batchId 둘 중 하나는 꼭 있어야 하고(DB 검사), 없는 기회 번호를 지어내 적지 않는다. 월 호출·비용 한도는 지금처럼 이 표 하나에서 합산한다. 기존 열의 형식을 바꾸는 변경(2장)이지만 넓히는 쪽이라 기존 행·기존 코드는 그대로 동작한다. 회차로만 남긴 기록이 있으면 이 변경은 되돌리지 않고 멈춘다(비용 기록을 지우지 않음) **(추가 2026-11-07 PM 결정, #393·#221·#390 — 산단공 조회의 하루 호출 기록)** 공장등록 조회(단지명 조회·회사명 조회 모두)의 HTTP 호출마다 이 표에 1행을 남긴다(쪽 넘김·재시도도 각각 1행). 값: purpose `PUBLIC_SOURCE`, kind `FACTORY_REGISTRY`(둘 다 새 코드값, 코드표에 더함), mode `NONE`, model null, securityGrade `PUBLIC`, decision `ALLOW`/`REJECT`(한도에 걸려 안 부른 것은 REJECT + rejectReason `DAILY_LIMIT`), callCount 1, 토큰·webSearchCalls null, costUsd 0(공공 조회는 무료), batchId = 후보 찾기 회차(목록 단계·정보 채움 단계 모두), 회차 밖에서 부르면(조사 단계의 회사명 조회) oppId. 단지명·회사명·주소 같은 본문은 적지 않는다. **하루 한도(C9 dailyLimitGuard 1000)는 이 표에서 KST 오늘 0시 이후 purpose PUBLIC_SOURCE·decision ALLOW 행의 callCount 합으로 센다.** 월 OpenAI 호출·비용 상한 집계(purpose EXTERNAL_SEARCH·EXTERNAL_AI)에는 들어가지 않고 `geosan cost`에도 나오지 않는다. 호출 기록을 따로 두는 새 표는 만들지 않는다(같은 뜻의 표가 둘이 됨)
  ev_*:    EvidenceExtraction    # ev_evidence, ev_homepage_candidate
  eval_*:  EvaluationLedger      # eval_batch, eval_run, eval_item_judgment, eval_requirement_check, eval_judgment_evidence, eval_readiness_check, eval_rank_adjustment
  q_*:     ConfirmationDesk      # q_question, q_question_opportunity_link, q_research_task. (추가 2026-11-04 PM 결정) q_question에 reply_text(Text)·replied_at(date)·replied_by(String 32) 열 — 최신 답 하나, 덮어쓰기. 이력은 rec_note kind REPLY 행. 모델 파일은 PM 세션 표시: 이강욱 PR에서 더하고 PM이 확인
  rec_*:   SalesRecords          # rec_review_opinion, rec_bookmark, rec_action, rec_outcome, rec_note(추가 2026-11-03: oppId, staffKey, text, createdAt — 덮어쓰기 없음, 메모마다 새 행; 2026-11-03 밤 추가 kind: noteKind 기본 MEMO), rec_review_check(추가 2026-11-03 밤 PM 반영, 상세 화면 (3): oppId, itemId, checked, staffKey, evalId, createdAt — 체크·해제 모두 새 행, 마지막 행이 현재 값). rec_bookmark는 담기 제거로 안 만듦(Q2). 단계·일정(rec_outcome)도 새 행 원칙(Q5): 이전 행은 이력. (추가 2026-11-04 PM 결정) rec_outcome.lost_reason_code(String 32, LOST 행에만, lostReasonCode) · rec_note.kind에 REPLY(질문 답 이력: 답을 저장할 때마다 연결된 기회마다 text "Q:<questionId> 답: <답 글>" 새 행, staffKey는 답한 담당자) **(바뀜 2026-11-06 PM 결정, 관심을 찜으로 분리 #356)** rec_bookmark를 만든다: rec_bookmark(bookmarkId, oppId, active: boolean, staffKey, source: enum[MANUAL, AUTO_RECORD, MIGRATED], version, createdAt — 켜고 끌 때마다 새 행, 마지막 행이 현재 값). 마이그레이션: 메모·영업 기록·검토 의견이 하나라도 있던 기회는 active true·source MIGRATED 한 행으로 채우고, rec_outcome.status INTERESTED는 NOT_EXECUTED로 바꾼다(되돌려도 INTERESTED로 복구하지 않음) **(추가 2026-11-10 PM 결정 #536, 데이터 마이그레이션 rec_011)** 마지막 관심 행이 켬이고 최신 검토 의견이 NOT_TARGET인 기회마다 rec_bookmark에 active false·source AUTO_RECORD·staffKey와 createdBy는 그 최신 의견을 저장한 담당자·version +1 행을 하나 더한다(표·열 변경 없음, 기존 행은 그대로). 되돌리면(downgrade) 이 마이그레이션이 더한 행만 지운다 **(추가 2026-11-09 PM 결정 #531)** rec_outcome에 `judgment_check`(String 16, nullable, C0 judgmentCheck) — 기존 행은 비움. 활동 이력·엑셀·대시보드로 내보내지 않음. **(추가 2026-11-08 PM 결정, 그때 본 평가 번호 #451·#450)** rec_outcome·rec_note에 `eval_id`(String 40, nullable, evalId) — 저장할 때 화면이 보여 주던 평가 번호. 검토 의견(rec_review_opinion.eval_id)과 같은 검사: 그 기회의 평가(기회 번호 일치, 확정·대체된 평가, 묶음 확정)가 아니면 400, **낡은(대체된) 번호여도 저장**(본 평가 기록이 목적, 409 아님), 없으면 비움. 기존 행은 비움 그대로(시각으로 거꾸로 채우지 않음). 활동 이력·엑셀·대시보드로 내보내지 않음. 2차 "기록이 순위에 돌아오는 되먹임"(#268·#269)과 KPI(처음 순위별 성사율)의 재료 **(추가 2026-11-12 PM 지시 #594, 기록 취소 #253)** rec_note·rec_outcome에 `cancelled_at`(UTC, nullable)·`cancelled_by`(String 32, staffKey, nullable)·`cancel_reason`(String 200, nullable) — 취소해도 행은 지우지 않고 이 세 칸만 채운다. 기존 행은 비움. **(추가 2026-11-12 PM 지시 #594, 자료 줄 메모 #259)** rec_note에 `item_id`(String 64, nullable) — 검토사항 자료 줄 번호. 기존 행은 비움 (추가 2026-11-12 PM 결정 #607) rec_outcome_answer(answer_row_id, outcome_id → rec_outcome, opp_id, question_id String 40, answer_id String 40, 공통 열 — 답마다 새 행, 수정·삭제 없음, outcome 행을 취소하면 그 답도 계산에서 빠짐)와 rec_outcome.step_override(String 24, nullable, salesStep)를 더한다. 마이그레이션 rec_012. 옛 행은 비워 둔다
  web_*:   WebApi                # web_access_session
rules:
  - 다른 접두사의 테이블은 읽기만. 쓰기는 소유 부품의 함수로만.
  - 교차 참조는 ID 열만 저장, 외래 키 없음, 저장 전 서버 검사(담당은 unit-of-work.md 서버 검사 담당 표). 같은 접두사 안은 외래 키.
  - 모든 업무 테이블에 created_at(시간대 포함), created_by(staffKey|system), session_ref, dataset_kind, is_virtual. 기록 테이블은 version 열. 이력 테이블은 덮어쓰지 않고 새 행.
  - 상태·분류 값은 C0 코드 문자열 그대로 저장(DB·API·화면 같은 코드표, FR4.10).
  - 새 테이블·새 열 추가 = 추가 변경(접두사별 마이그레이션 파일). 기존 열 삭제·의미·형식 변경 = 깨는 변경(2장 규칙).
  - SQLite 연결마다 외래 키 검사 켜기, busy_timeout 5000ms, WAL 모드.
```

### C7. 사람이 넣는 파일 (JSON 묶음·YAML, 예시 파일 동봉)

공통 규칙(Q4): 파일마다 설명이 달린 예시 파일을 `examples/` 폴더에 둔다(`case-apjeong.json`, `capability-geosan.json`, `rule-config.yaml`, `app-settings.yaml`). **설명은 `_설명` 키**에 적는다(JSON에는 주석이 없으므로 어느 객체에든 `_설명` 키를 허용하고 검사기는 이 키를 무시한다; YAML은 `#` 주석도 가능). 예시 파일은 들여쓴(한 항목 한 줄) 형태로 두고 투입 명령은 **위치 정보를 주는 로더**(줄·열을 돌려주는 JSON/YAML 파서)로 읽어 오류를 "**몇 번째 줄 어느 항목이 왜 틀렸는지**"로 보인다(예: `12번째 줄 requirements[1].reqLevel: 'REQUIRED', 'PREFERRED', 'NOT_REQUIRED', 'UNKNOWN' 중 하나여야 하는데 '필수요'가 적혀 있습니다`). `_설명` 외의 **모르는 키는 오류**다(오타가 조용히 사라지지 않게). 자유 문장 칸(quote, notes, allowedSummary, basis 등)에 이메일·전화 패턴이 있으면 **오류로 거부**한다(파일은 저장소(git)에 올라가므로 연락처를 적지 않음. 2026-11-03 PM 지시 뒤에도 유지 — 연락처는 프로그램 안 영업 메모에만, 파일에는 안 됨). 한 항목이라도 틀리면 아무것도 저장하지 않는다. 형식 설명서는 `contracts/*.schema.json` 네 개(약속 파일). 12/11 인계 뒤 거산 운영 담당자가 고치는 것을 전제로 한다.

**재투입 규칙**: 식별 키는 CaseFile `caseId`, Process `code`, Qualification `officialName + number`, Customer `bizNumber`(없으면 정규화 상호명+주소). 같은 키를 다시 넣으면 **값은 덮어쓰되 이력(FieldEvidence·QualificationStatus·평가)은 보존**하고, **이미 `REVIEWED`(검수 완료)인 값은 파일의 `PENDING`으로 되돌리지 않는다**(파일 값이 다르면 경고 줄을 내고 기존 검수 상태 유지; 되돌리려면 `geosan review-set … RECHECK`). 투입 뒤 평가는 자동으로 돌지 않고 `geosan evaluate`로 한다(안내서에 명시). (추가 2026-11-04 PM 결정) 담당자가 화면(`POST /relation`)에서 바꾼 거래 관계(`relationConfirmedBy`가 있는 값)는 사례 파일을 다시 넣어도 파일 값으로 되돌리지 않는다. 파일 값이 다르면 경고 줄을 내고 화면 값 유지.

```yaml
# shared-schema: 가상 사례 파일 (JSON 1개 = 사례 1건)
CaseFile:
  _설명: string                         # 어느 객체에든 허용
  caseId: string                        # 예: apjeong-valve-anodizing (재투입 식별 키)
  baseDate: date | null                 # (갱신 제안 2026-10-21, 기능 설계 Q4 답 확정 후 적용) 평가 기준일. verify-case가 이 날짜로 평가, 없으면 오늘
  description: string
  isVirtual: true
  datasetKind: datasetKind
  notes: [string]                       # 예: "역산한 가정값, 규칙서 F.7 확인 전, 증설 신호는 가상 추가"
  customer: { name, bizNumber|null, address, normalizedAddress, identityBasis, relationStatus, relationConfirmedAt, relationConfirmedBy|null(추가 2026-11-04: 화면 입력 담당자 키, 사례 파일은 null), securityGrade, mainPhone|null, mainPhoneSource: enum[HOMEPAGE, CSV]|null, mainPhoneSourceUrl|null, mainPhoneConfirmedAt|null, mainPhoneConfirmedBy|null, summaryLine|null, highlights: json|null, researchedAt|null, researchSource: enum[AI, CASE_FILE]|null, lat|null, lng|null, geocodedAt|null, geocodeSource: enum[JUSO, CSV, MANUAL]|null, industries: json|null, industriesSource: enum[AI, STAFF]|null, industriesConfirmedAt|null, ingestBatchId|null, ingestedAt|null }   # ingestBatchId·ingestedAt는 추가 2026-11-04(PM 결정 ①, #221): 들어온 수집 회차·시각, 사례 파일 투입은 null(더하는 마이그레이션). industries 3열은 추가 2026-11-03(PM 결정, 대시보드 산업군 — 설정 목록 안 값 ≤3, AI 제안 뒤 담당자 확정). lat·lng·geocodedAt·geocodeSource는 추가 2026-11-03(PM 결정, 거리 #222, 더하는 마이그레이션). mainPhone·mainPhoneSource·summaryLine·highlights·researchedAt·researchSource는 추가 2026-11-03(PM 지시, 상세 머리 기업 요약·다시 조사): 회사 대표번호만, 개인 연락처 열은 여전히 없음(opp_customer 더하는 마이그레이션). address = 사례 파일·CSV의 원본 주소 글자 그대로(지역 시·군 추출·2차 좌표 변환에 씀), normalizedAddress = 공백 제거·소문자 비교용. (2026-11-03 밤 확인, #209) 코드는 그동안 normalizedAddress만 저장했으므로 원본 address 열을 더하는 마이그레이션으로 맞춘다. 약속 변경 아님 (추가 2026-11-06 PM 결정, #190·#332) 사례 파일 customer에 homepageUrl: string|null(선택, http·https만, @·빈칸 거부)을 더한다. 투입하면 opp_customer.homepageUrl에 homepageStatus CONFIRMED·homepageSource CASE_FILE로 저장한다(C1 상세 머리 풀이와 같음). 비우면 지금 주소를 그대로 둔다(다시 투입해도 AI·담당자 주소를 지우지 않음). 담당자가 화면에서 고친 주소(source STAFF)가 있으면 그 값을 남기고 경고 한 줄을 낸다(거래 관계와 같은 규칙)
  interactions: [{ kind: interactionKind, occurredAt, allowedSummary, linkedToOpportunity: boolean, certainty }]
  opportunity: { item, project, purpose, owner, cardReason: string|null }   # cardReason: 카드 추천 이유 한 문장, 출처 제외 80자 안 권장(넘으면 경고만; 더하는 변경 2026-10-26 PM, #139)
  discoveryPaths: [{ pathKind, sourceId, originKey, discoveredAt }]
  processLinks: [{ processCode, appliedMaterial }]
  requirements: [{ reqKind, name, content, reqLevel, scopeKind, linkProcessCode|null, neededStage, dueAt, certainty, basis, question, requiredValue, unit, edition }]
  signals: [{ signalKind, occurredAt, deadlineAt, progressStatus, agreedWindow, certainty }]
  evidence: [{ sourceGrade, certainty, isLlmProposed, subject, quote, sourceRef, occurredAt, securityGrade, externalAiAllowed }]
  itemInputs: [{ itemCode, matchRate, certainty, state, factJudged, summary: string|null, evidenceRefs: [int] }]   # 역산 입력. summary: 상세 화면용 쉬운 요약(원문 factJudged는 그대로; 더하는 변경 2026-10-26 PM, #139)
  readinessCheck: { checked: boolean, staffKey, checkedAt } | null     # evalIdAtCheck는 투입 시 비어 있고 첫 평가가 채움(기능 설계 확인)
  researchReadiness: { ... } | null
  expected: { E, P, S, R, C, filterState, coreEvidenceMet, classificationCode, requirementResults: { <name>: checkDisplay } }
# shared-schema: 거산 역량 파일 (JSON 1개)
CapabilityFile:
  _설명: string
  datasetKind: datasetKind
  sourceNote: string                    # 예: "회사소개서 2026-09-21판"
  processes: [{ code, name, category, materialCodes, performanceTags, registryStatus, reviewStatus, capabilities: [{ capKind, name, displayValue, numericMin, numericMax, unit, standardRef, isDescriptiveOnly, reviewStatus }], deliveryRecords: [{ industry, partType, period, allowedBasis, reviewStatus }] }]
  qualifications: [{ kind, officialName, number, edition, holder, site, validFrom, validTo, reviewStatus, scopes: [{ scopeKind, processCode|null, customerRef|null, applicability, basis, reviewStatus }]   # scopeKind는 PROCESS 또는 CUSTOMER만 받는다. OPPORTUNITY(특정 기회에만 쓰는 자격)는 파일 투입에서 거부하고 U4 검수 명령으로 DB에 등록한다(기회 ID 항목을 파일에 두지 않음, PM 결정 2026-10-22, 이슈 #38). CUSTOMER면 customerRef = 고객 상호명(사례 파일 customer.name과 같은 정규화 규칙), statuses: [{ status, occurredAt, confirmedAt, confirmedBy, reason }] }]
  reviewDefaults: { reviewer, reviewedAt, basis }
# shared-schema: 규칙 설정 파일 (YAML 1개, 버전·해시 기록)
RuleConfig:
  version: string                       # 예: v0.17-a
  hypothesisNote: "기업 승인 전 가설"
  newProfileItems: [{ itemCode, weight, matchRateSteps: { <label>: number }, decay: enum[NONE, GENERAL, BID_EXCEPTION, HIRE] }]      # A.1
  recontactProfileItems: [{ itemCode, weight, matchRateSteps, decay }]                                                           # A.2
  certainty: { CONFIRMED: 1.0, STRONG: 0.65, WEAK: 0.25 }
  generalDecay: [{ maxDays: 30, factor: 1.0 }, { maxDays: 90, factor: 0.5 }, { maxDays: null, factor: 0 }]
  recontactDates: { reorderCycle: [...], nextContact: [...] }
  thresholds: { urgentE: 75, plannedE: 75, reviewE: 60, reviewP: 70, researchR: 60, watchRMin: 40 }
  rounding: { itemScore: HALF_UP_INT, display: ONE_DECIMAL }
  coreEvidence: { new: {...}, recontact: {...} }
  timingRequirements: { agreedWindowRequired: true }
  researchRequirements: { maxHoursDefault: 2 }
  classificationLabels: { <classificationCode>: <쉬운 말> }
  datasetKinds: [VIRTUAL_REVIEWED, BROCHURE, COMPANY_CONFIRMED]
# shared-schema: 앱 설정 파일 (YAML 1개)
AppSettings:
  staff: [{ key: staffKey, displayName: string }] + { key: viewer, displayName: "보기 전용" }
  activeDatasetKind: datasetKind
  ingestion: { regions: [...], productKeywords: [...], maxCandidates: 50 }
  #   (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) ingestion에 더하는 키: factoryCsvPath: string(공장현황 파일 자리. 예: ./data/sources/kicox-factory-csv/20251231/ 아래 파일. 전국분을 통째로 두고 Git에는 올리지 않음), aiPick: { enabled: boolean(기본 false), rowsPerCall: int } **(추가 2026-11-08 PM 결정, 지시문 파일 #430·#425)** aiPick에 `promptFile: string`(기본 `examples/prompts/candidate-pick.md`, 저장소 기준 경로)을 더한다 — AI 고르기 지시문(pick-v1, #221)을 담은 글 파일. PM이 이 파일을 고쳐 지시문을 바꿔 끼우며, 파일 내용은 판단 기준 버전(C6 criteriaVersion)에 들어가 바뀌면 낡은 판단으로 보고 다시 판단한다. 지시문을 설정 YAML 안에 긴 글로 넣거나 코드에 직접 적지 않는다. 여는 지역은 regions 그대로(지역을 늘리려면 운영자가 regions에 한 줄 더함). productKeywords는 조건 있는 찾기에서는 쓰지 않는다(AI 고르기가 대신함). 공장등록 조회 인증키는 환경 변수 DATA_GO_KR_SERVICE_KEY. 예시 설정·.env.example의 새 키는 모르는 키 거부 규칙 때문에 코드 PR과 같이 넣는다
  #   (추가 2026-11-06 PM 결정, 표면처리를 직접 하는 회사 표시 #319) ingestion.aiPick에 더하는 키: surfaceTreatmentIndustryNames: [string] — 공장등록 조회의 업종명에 이 글자가 들어 있으면 같은 표시를 붙인다(예: 도금업, 피막처리업). 값은 설정 파일에 두고 PM이 정한다
  #   (추가 2026-11-11 PM 승인 #573) ingestion.aiPick에 더하는 키: surfaceTreatmentIndustryCodes: [string](기본 빈 목록) — 팩토리온 업종번호(표준산업분류 5자리) 가운데 하나라도 이 목록에 있으면 표면처리 표시를 붙인다. 예시 설정 값은 25922(도금업)·25923(도장 및 기타 피막처리업). 25921 열처리·25924 절삭가공·25929 그 밖의 금속가공은 표면처리를 직접 한다는 뜻이 아니라 넣지 않는다
  #   (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) ingestion에 더하는 키: complexList: { enabled: boolean(기본 false — 설정으로 켜고 끔), cacheDays: int(단지별 조회 결과를 다시 쓰는 날 수), extraNames: [string](파일에 없는 단지 이름, 기본 빈 목록) }. 숫자는 설정값이며 PM이 정한다. 2차 묶음에 적은 ingestion.complexes(매달 자동 수집용 단지 목록)와 겹치므로 2차 설계 때 하나로 합친다. 예시 설정의 새 키는 코드 PR과 같이 넣는다 **(값 확정 2026-11-07 PM 결정, #393·#221)** `cacheDays` 기본값과 예시 설정 값은 ~~**7**~~ **15**이다 **(바뀜 2026-11-08 PM 결정, #405: 7 → 15)**(단지별 조회 결과를 15일 동안 다시 쓰고, 그 안에는 같은 단지를 다시 부르지 않는다 — src_complex_fetch.expiresAt = fetchedAt + 15일). 공장 등록은 월 단위로 바뀌는 자료라 7일은 뜻이 작았고, 15일은 2차의 한 달 자동 수집보다 짧으면서 하루 호출 한도를 덜 쓴다(충남·대전·세종 173단지 한 바퀴 ≈ 180회). 바꾸려면 설정 파일에서만 바꾼다
  #   (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) candidateWebSearch: { enabled: boolean(기본 false — 설정으로 켜고 끔), dailySearchLimit: int(하루 검색 횟수 한도), cacheDays: int(같은 조건 결과를 다시 쓰는 날 수), blockedDomains: [string](채용 사이트·유료 기업 정보 사이트) }. 숫자는 설정값이며 첫 실행 비용을 보고 PM이 정한다. 예시 설정의 새 키는 코드 PR과 같이 넣는다
  #   (추가 2026-11-09 PM 결정, #314·#487) candidateWebSearch 초기값: dailySearchLimit 20(검색 1회 약 3~4센트 = 검색 도구 1센트 + 결과 글 토큰. 월 20달러 상한을 홈페이지 찾기·근거 뽑기와 나눠 쓰므로 작게 시작하고 첫 달 비용을 보고 올린다), cacheDays 15(단지 조회와 같은 값. 지역·공정별 회사 분포는 날마다 바뀌지 않고 공장 등록도 월 단위), blockedDomains 초기 목록 12곳 — 채용 사이트: saramin.co.kr, jobkorea.co.kr, wanted.co.kr, incruit.com, work24.go.kr, work.go.kr, jobplanet.co.kr, catch.co.kr / 유료 기업 정보: nicebizinfo.com, cretop.com, kreditjob.com, thevc.kr. 하위 도메인도 같이 막는다. 목록은 설정 파일에 두고 PM이 더한다. enabled 기본 false 그대로(키·첫 비용 확인 뒤 켠다). 예시 설정의 새 키는 #314 코드 PR과 같이 넣는다
  #   (추가 2026-11-05 밤 PM 결정, 채용 공고 근거 #313·#315 — 만들기는 후보 찾기 다음) research.hiringSignal: { enabled: boolean(기본 false) } — 찾은 회사를 조사할 때 최근 채용 공고를 찾아 시점 신호로 붙일지
  #   (추가 2026-11-10 PM 결정 #549) ingestion에 더하는 키: costEstimate: { judgeUsdPerRow: number(초기 0.002 — #506 500행 $0.874·11/9 이 PC 304회 $8.90 실측, 1행 약 $0.0015~0.0018), researchUsdPerCompany: number(초기 0.04 — 11/9~10 조사 117곳 평균 $0.038), researchCallsPerCompany: int(초기 2 — 같은 117곳 평균 1.15회), webSearchUsdPerBatch: number(초기 0.04 — #518 1회 $0.0405) } — 모두 0보다 큼, 필수(check-config). C1 `GET /ingest/preview`의 예상 금액·잠금 계산에만 쓰고, 실제 한도 검사(C4)는 그대로 실제 전송 기록으로 한다. PM이 실측을 보고 고친다
  llm: { mode: enum[EXTERNAL, NONE], model: string, monthlyCallLimit: int, costPerThousandTokens: number }
  # (추가 2026-11-03, PM 결정 3 — 결정값: provider OPENAI, model gpt-6.1-sol, allowedModels [gpt-6.1-sol, gpt-6-luna], monthlyCallLimit 1000, 입력 $2 / 출력 $10 per 1M, monthlyCostLimitUsd 20, costAlertRatio 0.5. OpenAI는 근거 추출(③④)에만)
  #   llm에 더하는 키: provider: enum[OPENAI], allowedModels: [string] (model은 이 안이어야 check-config 통과), inputCostPerMillionTokens: number, outputCostPerMillionTokens: number,
  #   monthlyCostLimitUsd: number, costAlertRatio: number(0~1). costPerThousandTokens는 안 씀(deprecated), 다음 깨는 변경 때 제거.
  #   (추가 2026-11-10 PM 결정 #538) unconfirmedCallCostUsd: number(0보다 큼, 필수, 초기값 0.10) — 응답 사용량을 못 받은 AI·웹 검색 호출 1건을 이 금액으로 쳐서 월 비용 합에 더한다(C4). 수동 정산되면 실제 값으로 바뀐다
  #   예시 파일(examples/app-settings.yaml)의 새 키는 모르는 키 거부 규칙 때문에 U2 코드 PR(LlmSettings)과 같이 넣는다. 키는 환경 변수 OPENAI_API_KEY로만.
  naverSearch: { enabled: boolean, dailyCallLimit: int, display: int }   # (안 씀 — 2026-11-03 저녁 PM 결정 B) 네이버 검색 API는 쓰지 않는다. 키 이름만 호환용으로 남김. 코드는 읽지 않는다
  homepageDiscovery: { enabled: boolean, termsConfirmed: boolean, minConfidence: number, autoResearch: boolean, dailyCallLimit: int }
  # (2026-11-03 저녁, PM 결정 B) ② 홈페이지 찾기는 **OpenAI 웹 검색 도구**가 회사명+주소로 찾아 주소 하나·확신도(0~1)·이유를 돌려주고 바로 저장한다(C9 HomepageFinder.find). 회사가 목록에 들어올 때(사례 파일 투입·U3 수집·[다시 조사]·`geosan research`) autoResearch가 true면 ②→③ 본문 읽기→④ 근거 추출→재평가까지 사람 손 없이 이어진다.
  #   확신도가 minConfidence(기본 0.7) 아래면 homepageStatus NEEDS_CONFIRMATION(상세 맨 위 "홈페이지 확인 필요" 띠)로 두되 근거 추출은 진행한다. 못 찾으면 NOT_FOUND("직접 입력" 띠), 추출 건너뜀. 담당자가 상세에서 [맞음](confirmOnly) 또는 주소를 고치면(다시 추출·재평가) CONFIRMED.
  #   키는 OPENAI_API_KEY 하나. termsConfirmed는 안 씀(OpenAI 웹 검색 결과는 저장 가능). dailyCallLimit 기본 200. enabled 기본 false(키 받기 전), U2 PR에서 true.
  #   (추가 2026-11-11 PM 결정 #557, 안쪽 페이지 읽기) homepageDiscovery에 더하는 키: extraPages: int(첫 화면 말고 더 읽는 같은 사이트 페이지 수, 기본 3, 0이면 지금처럼 첫 화면만), extraPageHints: [string](링크 글자·주소에 이 말이 있는 링크만 고름. 초안 ["회사소개", "회사 소개", "인사말", "연혁", "제품", "사업", "설비", "인증", "실적", "납품", "about", "company", "product", "business", "history", "facility"]), extraPageMaxChars: int(안쪽 페이지 1장에서 AI에 보내는 글자 상한, 기본 6000). 숫자·말은 설정에서 읽고 코드에 적지 않는다(규칙 ⑩). 모르는 키 거부 때문에 #557 코드 PR에서 예시 파일과 같이 넣는다
  records: { approvalEnabled: boolean, noteMaxLength: int, cancelByAnyStaff: boolean, salesQuestionsFile: string, memoLineMaxLength: int }   # (추가 2026-11-03, PM 결정 Q1·U5) approvalEnabled 기본 false = 접촉 승인을 화면에서 숨김(경로·테이블은 유지). noteMaxLength 기본 200 = 영업 메모 글자 상한. 첫 화면은 대시보드로 고정(Q3 A)이라 ui.homeScreen 키는 두지 않음 (추가 2026-11-12 PM 지시 #594, 기록 취소 #253) cancelByAnyStaff 기본 false = 본인 기록만 취소. true면 모든 담당자가 남의 기록도 취소할 수 있다(PM이 정할 때만 켬). 생략하면 false (추가 2026-11-12 PM 결정 #607) salesQuestionsFile 기본 "examples/sales-questions.yaml" = 꼬리 질문 파일 위치. memoLineMaxLength 기본 100 = 접촉 기록 한 줄 메모 글자 상한. 둘 다 생략하면 기본값
  listFilters: { regionPresets: [{ label: string, cities: [string] }] }   # (추가 2026-11-03 밤 PM 결정, 지역 선택) 초안 [{ label: "천안 인근", cities: ["천안시", "아산시"] }]. 묶음은 선택지 맨 앞, 그 뒤에 주소에서 뽑은 시·군이 자동으로. 코드에 적지 않음(규칙 ⑩). 모르는 키 거부 때문에 #209 코드 PR에서 예시 파일과 같이
  mainPhone: { allowedPrefixes: [string] }   # (추가 2026-11-03 밤 PM 반영, 상세 화면 (1)) 회사 대표번호로 인정하는 앞자리. 초안 ["02", "031", "032", "033", "041", "042", "043", "044", "051", "052", "053", "054", "055", "061", "062", "063", "064"](지역번호만, PM 결정). 전국대표번호를 쓰려면 여기에 더한다. 코드에 적지 않음(규칙 ⑩). 모르는 키 거부 때문에 #219 코드 PR에서 예시 파일과 같이
  research: { staleAfterDays: 90 }
  geosan: { address: string, lat: number, lng: number }   # (추가 2026-11-03 PM 결정, 거리 #222) 거산 기준 주소와 좌표. PM이 한 번 적음(좌표는 지도에서 읽어 넣음). 거리는 모두 이 점에서 잰다
  geocoding: { provider: JUSO, enabled: boolean, dailyCallLimit: int, locationCsvFiles: [string], locationCsvBaseDate: date|null, naverFallbackEnabled: boolean }   # (2026-11-13 이강욱 확인 #222) 기본 enabled false·dailyCallLimit 10000·locationCsvFiles []·locationCsvBaseDate null·naverFallbackEnabled false. CSV 파일은 받은 위치정보요약DB의 18열 UTF-8 CSV, X·Y는 EPSG:5179. 파일 목록이 있으면 자료 기준일 필수. 네이버 켜기는 enabled true일 때만. 옛 설정은 이 기본값으로 읽는다. 키는 JUSO_SEARCH_KEY·JUSO_COORD_KEY·NCP_MAPS_KEY_ID·NCP_MAPS_KEY 환경 변수뿐. geosan.lat·lng는 좌표 설정 전 함께 null 허용, 없으면 거리 null
  distanceFilterPresetsKm: [30, 50, 100]   # (추가 2026-11-03 PM 결정) 목록 거리 필터 선택지. 대시보드 지도 원 반지름에도 씀
  industries: [string]   # (추가 2026-11-03 PM 결정, 대시보드 산업군) 초안 11개(2026-11-04 PM, #230에서 "건설·건축자재" 더함): 방위산업, 반도체, 반도체 장비, 자동차 부품, 항공우주, 밸브·유체기기, 조선·해양, 전기·전자, 기계·설비, 건설·건축자재, 기타 — 거산 확인 뒤 확정(#208 질문, "자동화 설비" 칸 필요 여부도 질문). 뜻은 "그 회사가 주로 납품하는 산업"(2026-11-04 PM). 코드에 적지 않고 여기서만
  dashboard: { countProposedIndustries: true }   # (추가 2026-11-03 PM 결정) 산업군 집계에 AI 제안 포함(true, 막대 옆 "AI 제안 포함" 표시)
  export: { xlsxEnabled: boolean }   # (추가 2026-11-13 #217 — PM 결정 2026-11-13) 엑셀 내려받기(C1 /export/xlsx) 스위치. 초기값 false(만들어 두고 꺼 둠). false면 내려받기 창구가 422 kind EXPORT_DISABLED로 막히고 화면 단추가 보이지 않는다. 거산이 필요하다고 하면 true로 바꾼다 — 그 전에 내려받은 기록 1행(C4)을 먼저 만든다. 이 묶음이 없는 옛 설정 파일은 꺼짐으로, 옛 DB 사본은 예시 파일(examples/app-settings.yaml) 값으로 읽는다. 기록이 만들어지기 전에는 `export.xlsxEnabled: true`인 설정을 설정 검사가 거부한다(설정 파일 읽기·check-config 등록·DB 사본 읽기 모두, 오류 칸 `export.xlsxEnabled`, "엑셀 내려받기는 아직 켤 수 없습니다. 누가 언제 내려받았는지 남기는 기록을 만들기 전에는 켤 수 없으니 false로 두어 주세요.")
  salesAnalysis: { minSampleForRatio: int, closedWindowDays: int }   # (추가 2026-11-13 #608 — PM 확인 필요) 영업 분석표(C1 /sales-analysis) 기준 숫자. minSampleForRatio 초기값 10 = 표본(접촉한 곳 수)이 이보다 적으면 비율 없이 건수와 "표본 n건"만. closedWindowDays 초기값 365 = 성사·거절은 결과 기록이 이 일수 안인 것만 셈(#229 "최근 12개월"과 같은 값, 거산 사용 뒤 재조정). 둘 다 1 이상. 코드에 적지 않고 여기서만(규칙 ⑩). 예시 파일 두 개에 같이 넣고, 이 키가 없는 옛 설정 파일·DB 사본은 예시 파일(examples/app-settings.yaml) 값으로 읽는다(#591과 같은 방식)
  contactList: { nowClassifications: [classificationCode], unscoredHighFitToNow: boolean, nullFitLevelAs: fitLevel, adjust: { windowDays: int, minClosedCount: int, wonPerStep: int, maxUp: int, lostPerStep: int, maxDown: int, lostReasonsCounted: [lostReasonCode] } }   # (추가 2026-11-13 #610 — PM 확인 필요) 추천 목록 세 묶음(C1 sort=contact·카드 bucket·rankAdjust) 기준. 초기값: nowClassifications [CONTACT_URGENT, CONTACT_PLANNED, RESEARCH, CONDITIONAL_WAIT](막는 조건이 없을 때 "지금 연락할 곳"에 드는 분류), unscoredHighFitToNow false(평가 전 + 적합도 상을 "지금 연락"에 넣는 스위치, 꺼 둠), nullFitLevelAs HIGH(적합도가 없는 사례 파일 회사를 묶음 안 순서에서 어느 적합도로 볼지), adjust.windowDays 365, minClosedCount 5(표본이 이보다 적으면 조정 없음), wonPerStep 2·maxUp 2(성사 2곳마다 한 단계 위, 최대 두 단계), lostPerStep 3·maxDown 1(센 거절 3곳마다 한 단계 아래, 최대 한 단계), lostReasonsCounted [NO_DEMAND, QUALITY_CERT]. 규칙 설정(rule-config)이 아니라 앱 설정에 둔다(규칙 버전·부록 F 점수는 그대로). 코드에 적지 않고 여기서만(규칙 ⑩). 예시 파일 두 개에 같이 넣고, 이 키가 없는 옛 설정 파일·DB 사본은 예시 파일(examples/app-settings.yaml) 값으로 읽는다(salesAnalysis와 같은 방식)
  map: { provider: NAVER_CLOUD, enabled: boolean }   # (추가 2026-11-03 PM 결정, 2차) 대시보드 지도. 클라이언트 ID는 화면 빌드 환경 변수 VITE_NCP_MAPS_CLIENT_ID(비밀 아님, 콘솔 허용 URL로 보호). 지오코딩에는 쓰지 않음(거리 제안서 8장)   # (추가 2026-11-03 PM 지시) 마지막 조사가 이 일수보다 오래되면 상세 머리에 "오래됨" 표시
  brand: { logoUrl, brandName, colorPrimary, demoLabel: string | null }   # demoLabel: (갱신 제안 2026-10-21, 기능 설계 Q7 답 확정 후 적용) 띠에 함께 보이는 문구, 예: "부분 시연·거산 확인 전"
  accessProtection: { enabled: boolean }      # 비밀번호 자체는 환경 변수 GEOSAN_PASSWORD
```

**(추가 2026-11-12 PM 결정 #607) 꼬리 질문 파일 `examples/sales-questions.yaml`** — 영업 기록의 꼬리 질문 문구·보기·갈라지는 조건을 코드 대신 이 파일 하나에 둔다(문구는 거산 확인 #275 뒤 바뀔 수 있음). 서버가 읽을 때마다 검사하고, 답은 코드(questionId·answerId)로만 저장하므로 문구를 바꿔도 지난 기록과 분석이 이어진다. 지운 보기의 지난 답은 화면에 "예전 보기"로 보인다.
```yaml
_설명: 영업 기록 꼬리 질문. id는 한 번 쓰면 바꾸지 않는다(지난 답이 이 id로 저장됨). 문구(text·label)는 바꿔도 된다.
version: 1
steps:                       # 세부 단계 순서와 큰 단계 짝(C0 salesStep·outcomeStatus). 5개 모두, 이 순서
  - { code: NOT_REACHED, label: 연결 전, stage: IN_PROGRESS }
  - { code: REACHED, label: 연결됨, stage: IN_PROGRESS }
  - { code: DEMAND_CONFIRMED, label: 수요 확인, stage: IN_PROGRESS }
  - { code: MATERIAL_QUOTE, label: 자료·견적, stage: SAMPLE_OR_REGISTRATION_APPROVED }
  - { code: VISIT_SAMPLE, label: 방문·샘플, stage: SAMPLE_OR_REGISTRATION_APPROVED }
questions:
  - id: PLATING_NOW          # 영문 대문자·숫자·밑줄, 파일 안에서 하나
    step: REACHED            # 이 세부 단계일 때 보인다(ALL이면 모든 세부 단계)
    text: 지금 도금은 어떻게 하나요?
    showWhen: null           # 또는 { answers: { <questionId>: [answerId, ...] } } — 앞 답이 이 중 하나일 때만 보임(꼬리)
    answers:
      - { id: IN_HOUSE, label: 직접 함 }
      - { id: OUTSOURCED, label: 외주 줌, reaches: DEMAND_CONFIRMED }   # reaches: 이 답이면 그 세부 단계로 앞으로 감
      - { id: UNKNOWN, label: 모름 }
```
검사(check-config, C7 오류 형식 줄·항목·이유): steps 5개·순서·짝, id 형식과 겹침, step은 salesStep 값 또는 ALL, reaches는 salesStep 값, showWhen이 가리키는 질문·보기가 있고 자기 자신이 아님, 보기 2~8개, 문구 100자 이하, 모르는 키 거부, 연락처 검사. 첫 초안 질문은 #607 본문(연결 전 "누구와 이야기했나", 연결됨 "지금 도금은?"·"관심 정도", 수요 확인 "바꿀 생각?"·"무엇이 있으면 관심이 커지나?", 자료·견적 "보낸 것"·"답이 왔나", 방문·샘플 "샘플 결과", 모든 단계 "다음 할 일")이다. 날짜는 질문이 아니라 기존 nextScheduleAt 칸을 쓴다.

**(추가 2026-11-13 #643 — PM 결정 2026-11-13) 마무리 답 칸 `closes`·`lostReason`** — 답 보기에 두 칸을 더한다(둘 다 선택). `closes: WON | LOST | ON_HOLD`는 "이 답이면 큰 단계를 그 값으로 끝낸다", `lostReason: <lostReasonCode>`는 "이 답이 거절 이유 코드다"라는 뜻이다(저장 규칙은 C1 /outcomes).
```yaml
  - id: CLOSE_RESULT         # "다음 할 일은?"에서 "끝"을 골랐을 때만 보인다
    step: ALL
    text: 어떻게 끝났나요?
    showWhen: { answers: { NEXT_ACTION: [END] } }
    answers:
      - { id: WON, label: 성사, closes: WON }
      - { id: LOST, label: 거절, closes: LOST }
      - { id: ON_HOLD, label: 보류 · 나중에 다시, closes: ON_HOLD }
  - id: LOST_REASON          # 위에서 "거절"을 골랐을 때만 보인다. 보기 = 거절 이유 코드표(C0 lostReasonCode) 6개
    step: ALL
    text: 거절 이유는?
    showWhen: { answers: { CLOSE_RESULT: [LOST] } }
    answers:
      - { id: PRICE, label: 가격, lostReason: PRICE }
      # … LEAD_TIME(납기), INCUMBENT_SUPPLIER(기존 거래처 유지), NO_DEMAND(수요 없음), QUALITY_CERT(품질·인증 요건), OTHER(기타)
```
검사(check-config, 줄·항목·이유)에 더하는 것: closes는 WON·LOST·ON_HOLD 중 하나, lostReason은 lostReasonCode 값, 한 보기에 reaches와 closes를 같이 쓰지 않음, closes 보기가 있는 질문과 lostReason 보기가 있는 질문은 파일에 각각 하나뿐, closes LOST 보기가 있으면 lostReason 질문이 반드시 있고 그 질문의 showWhen이 바로 그 LOST 보기만 가리킴, lostReason 질문은 모든 보기에 lostReason이 있고 코드가 겹치지 않음, closes LOST 보기가 없는데 lostReason 보기가 있으면 거부. 마무리 질문 2개(`CLOSE_RESULT`·`LOST_REASON`)의 문구는 거산 확인(#275) 전 초안이고, 거절 이유 보기 문구는 화면의 거절 이유 쉬운 말과 같게 둔다. 화면은 접촉 결과가 "거절"(DECLINED)일 때도 step ALL 질문과 그 꼬리를 보인다(부재는 그대로 질문 없음).

**(추가 2026-11-13 #652 — PM 결정 2026-11-13) 회사 값에서 보기를 가져오는 질문 칸 `choices`** — 질문에 `choices: PROCESS | INDUSTRY`를 적으면 보기를 파일에 적지 않고 서버가 채운다: PROCESS = 거산 공정 목록(역량 파일 순서), INDUSTRY = 설정 industries. 여러 개를 고를 수 있는 질문이다(저장 규칙은 C1 /outcomes). 화면은 그 회사에 AI가 제안했거나 확정된 값을 먼저 보이고 "AI 제안"·"사례 파일"·"확정됨" 표시를 붙이되, AI 제안을 미리 골라 두지 않는다(담당자가 직접 고른다). 이미 확정된 공정은 고른 것으로 보이고 꼬리 질문에서는 뺄 수 없다. "아직 모름"은 화면 전용 보기다(답을 보내지 않음). (보완 2026-11-13 #652 — PM 지시 2026-11-13) choices 질문은 확인될 때까지 묻는다: 세부 단계가 그 질문의 step 이상인 모든 세부 단계에서, 아직 답이 없을 때만 보인다(상세 records.salesStep.openQuestions도 같은 기준). 답이 있으면 다시 묻지 않는다(접촉마다 다시 묻는 step ALL 방식이 아니다). 이미 확정된 값(공정 = 확정된 연결, 산업 = industriesSource가 CASE_FILE·STAFF인 값)이 있는 회사에서는 화면이 "지금 확정된 것이 맞음" 보기를 하나 더 보인다. 담당자가 그것을 고르고 저장하면 확정된 값들이 그대로 답으로 실려 질문이 닫히고, 저장 규칙대로 남은 AI 공정 제안은 빠진다(사례 파일 산업군은 출처가 STAFF로 바뀐다). 아무것도 고르지 않고 접촉만 저장하면 답을 보내지 않으므로 AI 제안은 그대로 남는다.
```yaml
  - id: CONFIRM_PROCESS      # 세부 단계 "연결됨"부터, 답할 때까지 보인다
    step: REACHED
    text: 어떤 공정을 맡길 수 있나요?
    choices: PROCESS         # answers는 적지 않는다
  - id: CONFIRM_INDUSTRY
    step: REACHED
    text: 어느 산업인가요?
    choices: INDUSTRY
```
검사(check-config, 줄·항목·이유)에 더하는 것: 질문마다 answers와 choices 가운데 하나만 쓴다(둘 다 쓰거나 둘 다 없으면 거부), choices는 PROCESS·INDUSTRY 중 하나, 같은 choices 값의 질문은 파일에 하나뿐, 다른 질문의 showWhen이 choices 질문을 가리키면 거부(보기가 파일에 없어 조건을 검사할 수 없다), (보완 2026-11-13 #652) choices 질문의 step은 ALL일 수 없다(시작 세부 단계를 적는다). 질문 2개의 문구는 거산 확인(#275) 전 초안이다.

### C8. 운영 명령 (명령줄, 운영 안내서의 기준)

```yaml
# shared-schema: OperatorCommands 명령 계약. 이름은 제안. 모든 명령은 끝에 쉬운 한국어 요약 한 줄과 종료 코드(0 성공, 1 입력 오류, 2 실행 실패)를 낸다. --help는 한국어.
commands:
  geosan init-db                                 # U1. 데이터베이스 만들기·마이그레이션 적용(처음·갱신 모두)
  geosan serve [--port N] [--host 127.0.0.1|0.0.0.0] # U1. 서버 실행, 기본은 내 PC 전용. 배포 주소 선택은 #213 PM 지시(2026-11-03). (추가 2026-11-04 PM 결정, 사고 방지 #274) 배포 설정(--host 0.0.0.0 또는 GEOSAN_PASSWORD 설정)에서 DB 파일 이름이 geosan-demo.db이거나 DB 안에 시연 표시(앱 설정 사본 demo 플래그)가 있으면 "시연용 DB는 배포 환경에서 쓸 수 없습니다"를 내고 종료 코드 2로 시작하지 않는다. 로컬(127.0.0.1, 비밀번호 없음)에서는 시연 DB 허용. 2차 #274에서 구현
  geosan check-config [rule-config.yaml] [app-settings.yaml]   # U1. 설정 파일 형식 검사(오류는 C7 형식: 줄·항목·이유) (추가 2026-11-12 PM 결정 #607) 설정의 records.salesQuestionsFile이 가리키는 꼬리 질문 파일도 함께 검사한다(인자는 그대로)
  geosan source-confirm <sourceId> --by <staffKey> [--terms <url>] [--on <YYYY-MM-DD>]   # (추가 2026-11-09 PM 승인, #489) kicox-factory-csv·kicox-production-api 이용·저장 확인을 C5 SourceContract에 기록. 소스 이름·허용 용도·저장 범위·약관 기본 주소는 명령 코드의 소스별 표, 확인자는 설정에 등록된 기록 담당자만(보기 전용 거부). 확인일 기본은 서울 오늘, 미래 날짜·모르는 소스·기존 기록은 거부. created_by는 확인자, is_virtual=false, dataset_kind는 비움. 출력은 소스 이름·확인일·저장 완료 한 줄. 종료 0 성공, 1 입력 오류, 2 DB 처리 실패. --terms 기본값은 https://www.data.go.kr/data/15105482/fileData.do (파일)·https://www.data.go.kr/data/15087611/openapi.do (조회), 두 자료 모두 이용허락범위 제한 없음(PM 직접 확인 2026-11-09 #489 댓글). 공공누리 유형은 지어 넣지 않음
geosan source-load <sourceId> <파일>...   # (추가 2026-11-11 PM 승인 #573) factoryon-xlsx(엑셀 여러 개)·nier-water-csv(CSV 하나)를 보조 자료 표(C6)에 넣고 목록 회사에 붙여 공장 정보와 표면처리 표시를 다시 계산한다. 표면처리 표시는 출처가 INDUSTRY_CODE·WATER_LIST인 것만 다시 계산하고(붙거나 풀림) AI·업종명 표시는 건드리지 않는다. 출력: 읽은 행·저장한 행·건너뛴 행 수, 붙은 회사 수, 표시가 새로 붙은·풀린 회사 수. 한 저장 묶음이고 실패하면 전부 되돌린다. 종료 0 성공, 1 입력 오류, 2 DB 처리 실패. source-confirm이 받는 소스에 두 소스를 더하되 약관 주소 기본값이 없어 --terms를 꼭 넣는다
  geosan import-capability <file.json>           # U1. 형식·연락처 검사 → 저장(재투입 규칙 적용)
  geosan import-case <file.json>                 # U1. 가상 사례 묶음 투입(투입 순서 자동). 실제 기업도 같은 형식(isVirtual: false)
  geosan check-case <file.json>                  # U1. (갱신 제안 2026-10-21, 기능 설계 Q8 답 확정 후 적용) 저장 없이 형식·허용 값·연락처 패턴만 검사. DB 없이 팀원 컴퓨터에서 실행. (PM 지시 2026-10-21) 코드 생성 Part A-2(Step 11)에서 먼저 연결해 팀원이 10/22부터 쓴다
  geosan evaluate [--opp <id>...] [--base-date YYYY-MM-DD]   # U1. 흐름 ⓪. 출력: 묶음 ID, 기회 수, 분류 요약
  geosan verify-case <file.json>                 # U1. 평가 뒤 expected와 비교. 출력: 항목별 일치/불일치 표
  geosan export-contracts                        # U1. contracts/openapi.json 생성(사람이 명시적으로만 실행). *.schema.json 4개는 이 명령이 만들지 않고 손으로 고친다(2026-11-03 바로잡음, #218)
  geosan demo-report --capability <file.json> --cases <dir> --out <dir> [--base-date YYYY-MM-DD]   # U1 예비 경로(PM 승인 2026-10-21, 10/29 부분 시연 대비). DB·API·화면 없이 역량 파일 + 사례 파일 폴더를 읽어 규칙 엔진으로 평가하고 순위표(CSV + 인쇄용 HTML), 기업별 근거(md), 기업별 사실표(md, 메모 재료)를 <out>에 쓴다. 저장하지 않는다. 모든 출력 머리에 "시연용 초안·거산 확인 전". 소개서 묶음이면 참고 점수·접촉 후보 없음(BR5.6). 연락처 패턴이 있으면 쓰지 않고 실패(종료 코드 1)
  geosan ingest <sourceId> [--max N]             # U3·U9. 흐름 ⑥ — (갱신 2026-11-04 PM 결정 ①) 화면 [새 후보 가져오기](C1 POST /ingest)와 같은 함수. 회차(opp_ingest_batch) 기록, requestedBy SYSTEM. 명령은 자동 조사를 백그라운드가 아니라 바로 이어서 1곳씩 돌리고 결과 줄 출력
  #   (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) 더하는 인자: geosan ingest kicox-factory-csv --process <processCode>... --region <지역>... [--industry <산업>...] [--max N] [--rejudge]   # 화면 [찾기](C1 POST /ingest)와 같은 함수. 공장현황 파일이 읽어 둔 것보다 새로우면 먼저 src_factory_row에 읽어 들이고 새 행·바뀐 행·사라진 행 수를 출력. --rejudge는 저장된 AI 판단을 무시하고 그 조건을 다시 판단(비용 발생, 운영자만. 화면 단추는 2차)
  geosan merge-list                              # U3. 확인 필요 후보 목록
  geosan merge-confirm <candidateId> --keep <customerId>   # U3. 흐름 ⑤
  geosan review-set <targetKind> <targetId> <REVIEWED|RECHECK> --by <name> --basis <text>   # U4. 흐름 ② — (갱신 2026-11-03, PM 결정 Q8·Q9·Q10) U4 중 이 명령만 먼저, U2 줄 첫 작업(유동렬, 12h). 방문 확인된 공정만 REVIEWED로 바꾸고 18곳 재평가(방문 확인 기록은 PM이 채우면 실행)
  geosan review-set --all REVIEWED --by <name> --basis <text> [--no-evaluate]   # (추가 2026-11-04, PM 결정 A — #212 유동렬 질문 답) 전체 전환. 범위: 활성 묶음(BROCHURE)의 거산 값 전부(공정·세부 역량·실적·자격·범위, 상태 PENDING인 것만. UNAVAILABLE·이미 REVIEWED는 건드리지 않음). 방식: 소개서 값은 그대로 두고 **COMPANY_CONFIRMED 묶음으로 복사**하며 복사본마다 reviewStatus REVIEWED + FieldEvidence 1행(reviewer·reviewedAt·basis·dataset_kind COMPANY_CONFIRMED). 복사 뒤 activeDatasetKind를 COMPANY_CONFIRMED로 바꾸고(dataset-set과 같은 저장) 18곳 재평가(evaluate)까지 **한 트랜잭션**: 재평가가 실패하면 복사·묶음 전환도 함께 취소. 두 번 실행하면 "이미 COMPANY_CONFIRMED 묶음이 있습니다"로 거부(덮어쓰지 않음). 출력: 복사 건수(종류별)·묶음 전환·재평가 결과 줄, 공정 탭별(ZINC_PLATING / ANODIZING) 순위 비교는 #212 댓글로. 평가 진입점(검수+평가 같은 트랜잭션)은 #212 안에서 유동렬이 `geosan/evaluation/`에 더하고 이강욱이 PR에서 검토
  geosan dataset-set <datasetKind>               # U4. 거산 값 묶음 전환(설정 변경 + 재평가 안내)
  geosan backup [--to <dir>]                     # U8 최소형 → U10. SQLite 온라인 백업(VACUUM INTO, 서버가 켜져 있어도 일관된 사본, WAL 포함). (갱신 2026-11-03, Q10) 담당 PM(최지예), U8에 묶음, 10h
  geosan restore <backup-file>                   # U8 최소형 → U10. 서버가 멈춘 상태에서만 허용(켜져 있으면 거부), 복원 전 현재 DB를 자동으로 따로 보관, 확인 질문 1회. (갱신 2026-11-03, Q10) 담당 PM, U8에 묶음
  geosan geocode [--missing-only]                # (2026-11-13 이강욱 확인 #222) 활성 묶음의 공개 실제 회사에 CSV→행안부 검색·CSV→좌표 API→네이버 순서. 공공좌표만 저장하며 기존 좌표는 재사용. 네이버 결과는 이번 실행의 확인 건수로만 보고하고 저장하지 않는다. 저장·재사용·실시간 확인·미확인·실패 건수만 출력. 가상·비공개·주소 없음은 제외. 한도·통신·설정 실패는 종료 코드 2, 미확인은 오류 아님
  geosan db merge-heads                          # U1. 마이그레이션 머리가 둘일 때 합치기
  geosan cost [--month YYYY-MM]                  # U10. TransferGuard 집계 × 단가. (추가 2026-11-03) U2로 앞당김: OpenAI 호출 수·입력/출력 토큰·웹 검색 횟수·비용·상한($20, 1,000회) 대비 비율을 내고 50% 넘으면 "알림" 줄. 5곳 시험의 1곳당 비용 측정에 쓴다
  geosan transfer-unblock [--older-than 10m]     # (추가 2026-11-04 PM 승인, #218) 기본은 조회만. 10분 이상 지난 EXTERNAL_SEARCH / EXTERNAL_AI 미확정 실제 호출의 기록 번호·용도·경과 시간·호출 시각·모델 표시. 본문·검색어 없음, DB 변경·외부 요청 없음. older-than은 분 단위이며 최소 10m
  geosan transfer-unblock --log-id <ID> --input-tokens <N> --output-tokens <N> --web-search-calls <N> --cost-usd <USD> --by <staffKey> [--older-than 10m]   # 확인한 사용량을 기록 1건에 정산. 모든 항목 필수, 토큰·검색 횟수는 0 이상 정수, 비용은 유한한 0 이상 숫자. EXTERNAL_AI 웹 검색 횟수는 0. 보기 전용·설정에 없는 처리자, 아직 기준 시간이 안 지난 건, 실제 호출이 아닌 거부 행, 이미 확정된 행은 변경 없이 오류. 실제 사용량 0으로 확인한 건만 명시적으로 0 입력. 쓰기 잠금 안에서 재검사·저장, 중복 정산 거부, 실패 시 전체 취소. 출력 "막힌 기록 1건을 정리했습니다". 종료 0 조회/정리 성공(0건 포함), 1 입력·대상·확인자 오류, 2 DB 처리 실패. 자세한 순서·필요 권한은 docs/transfer-unblock-guide.md
  geosan research [--missing-homepage | --all] [--limit N]   # (추가 2026-11-03 저녁, PM 결정 B) 이미 들어와 있는 회사(18곳)에 ②→③→④→재평가를 일괄로 돌린다. 기본은 홈페이지 없는 회사만. 1곳마다 결과 줄(찾음/확인 필요/못 찾음, 근거 수, 비용) 출력. 상한에 걸리면 멈추고 남은 건수 안내
guideTasks:   # 운영 안내서 작업별 명령 수(3개 이내, US9.4)
  처음 설치·실행: [init-db, check-config, serve]                     # 3
  공공 소스 이용 확인: [source-confirm(공장현황 파일), source-confirm(공장등록 조회)]   # #489, 설정 등록 뒤 serve 전에 실행. 조회를 끈 환경은 두 번째 생략
  가상 사례 투입·평가·확인: [import-case, evaluate, verify-case]     # 3
  거산 값 투입: [import-capability, evaluate]                         # 2
  후보 수집: [ingest, merge-list / merge-confirm]                     # 2~3
  검수 상태 전환: [review-set, evaluate(자동 포함)]                   # 1~2
  거산 값 묶음 전환: [dataset-set, evaluate]                          # 2
  백업·복원: [backup] / [restore, serve]                              # 1 / 2
  비용 확인: [cost]                                                   # 1
  사용량 미확정 기록 정리: [transfer-unblock(조회), 제공사 확인, transfer-unblock(정산), cost]   # #218, PM 2026-11-04
  시연 자료 출력(예비 경로): [demo-report]                            # 1 (PM 승인 2026-10-21)
rules:
  - 비밀번호·API 키는 인자로 받지 않고 환경 변수에서만
```

### C9. 바깥 서비스 어댑터 (우리가 소비하는 쪽)

```yaml
# shared-schema: 외부 LLM·홈페이지·외부 소스는 우리 계약이 아니라 어댑터 뒤에 가둔다. 모드가 달라도 출력 형식은 같다(FR5.5).
LlmAdapter:
  mode: enum[EXTERNAL, NONE]              # 신규 기회 기본 EXTERNAL, 재접촉 기본 NONE
  extract_evidence(approvedItemIds, context) -> { evidence: [{ quote, subject, occurredAtCandidate, sourceGradeProposed, certaintyProposed }], questions: [{ text, targetKind }], requirementCandidates: [{ name, reqLevelProposed: enum[REQUIRED_STRONG, UNKNOWN], quote }] }
  generate_questions(approvedItemIds, context) -> [{ text, targetKind, targetId }]
  draft_message(template, placeholders) -> string     # NONE 모드: 자리표시자 치환만. EXTERNAL이어도 재접촉은 NONE 강제
  bodyBinding: 어댑터는 TransferGuard가 허용한 항목 ID(approvedItemIds)만 받아 본문을 직접 조회해 보낸다. 호출자가 본문 문자열을 넘기는 경로는 없다(CON-09 구조적 보장)
  timeout: 60s 전체(run_extract 한도 안), retry: 1 (남은 시간이 있을 때만, 집계·TransferLog는 호출마다 1행)
  pick_candidates(approvedRowIds, criteria: { processCodes, industries }) -> [{ rowId, isManufacturer: boolean, processCodes: [processCode], industries: [string], reason: string }]   # (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) 공개 소스 행의 회사명·단지명·생산품·공장주소를 읽고 "제조업인지, 거산의 어느 공정이 필요할 만한지"를 판단. processCodes는 역량 파일 공정 안, industries는 설정 industries 안 값만. bodyBinding 그대로(허용된 행 ID만 받고 본문은 어댑터가 조회). 결과는 src_candidate_judgment에 저장하고, 같은 행·같은 생산품 글·같은 기준이면 다시 부르지 않는다. 판단한 공정은 새 회사의 공정 연결(출처 AI·확인 전)로 그대로 저장한다
  #   (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) pick_candidates 결과에 fitLevel: enum[HIGH, MEDIUM, LOW]을 더한다(AI가 본 공정 적합도). reason과 함께 저장해 카드의 "고른 이유"와 점수 전 목록 순서에 쓴다. 점수 계산에는 넣지 않는다
  #   (추가 2026-11-06 PM 결정, 표면처리를 직접 하는 회사 표시 #319) pick_candidates 결과에 ownPlatingLineSuspected: boolean, ownPlatingLineBasis: string|null(근거 한 줄)을 더한다. 생산품 글이 "표면처리를 받아야 하는 제품"이 아니라 "표면처리 자체를 하는 일"(도금, 아노다이징, 피막 처리, 표면처리 가공)을 말하면 true. true여도 isManufacturer·processCodes·fitLevel 판단은 그대로 한다. CandidateSearcher(웹 갈래)로 찾은 회사에도 같은 판단을 적용한다
  #   (추가 2026-11-05 저녁 PM 반영, AI 점수 제안 1차 최소 범위 #286) extract_evidence 출력에 더하는 칸: itemInputProposals: [{ itemCode, matchRateProposed, certaintyProposed, factJudged, quote, evidenceRef }](점수 8항목 중 근거가 있는 항목만), processLinkProposals: [{ processCode, basis, quote, evidenceRef }](≤3, 역량 파일 공정 안). 저장은 출처 AI·상태 PENDING. 사례 파일·담당자 값이 있는 항목에는 제안을 저장하지 않는다(사람 값 우선). 거래 관계·내부 이력은 제안 대상이 아니다
  log: TransferLog (시각·모드·모델·등급·토큰 수, 본문 없음)
  provider: enum[OPENAI]                  # (추가 2026-11-03, PM 결정 3) 설정 llm.provider. 모델은 llm.model(gpt-6.1-sol, 비교용 gpt-6-luna)
  retention:                              # (추가 2026-11-03) 보관 규칙. 한 번 보내고 끝나는 호출만 쓴다. 대화·파일이 제공사 서버에 남는 기능(파일 업로드·대화 보관형 엔드포인트)은 쓰지 않는다. 데이터 공유(학습 제공) 동의는 켜지 않는다. 로그에는 시각·모드·모델·등급·입력/출력 토큰 수·비용만(본문 없음)
  usageGuard: 호출 전 C4 월 호출 상한·월 비용 상한을 함께 검사. 초과면 호출하지 않고 503 LLM_LIMIT
HomepageFinder:                           # (2026-11-03 저녁, PM 결정 B로 갱신) ② 홈페이지 찾기 = OpenAI 웹 검색 도구가 찾고 바로 저장, 담당자는 상세에서 확인·수정. C9 열린 질문 "검색 방식·비용·약관"의 답. (낮의 네이버 안은 특약 때문에 담당자 확정이 먼저 필요해 버림)
  find(companyName, address) -> { provider: OPENAI_WEB_SEARCH, url: string|null, confidence: 0~1, reason: string, fetchedAt }   # 모델에 "이 회사의 공식 홈페이지 주소 하나와 확신도·이유"를 구조화 출력으로 요구. 공식 홈페이지가 아닌 디렉터리·블로그·채용 사이트는 제외하라고 지시. 못 찾으면 url null
  # (추가 2026-11-03 PM 지시) LlmAdapter 근거 추출 결과에 companySummary: { line: string, highlights: [string ≤3] }, ~~companyMainPhone: string|null~~ 을 더한다. 공개 본문의 사실만, 담당자 개인 연락처는 뽑지 않는다. **(2026-11-03 밤 PM 반영) `companyMainPhone`은 안 씀(코드 없음, 영향 0)**: 대표번호는 C4 `extract_main_phone`이 OpenAI로 보내기 전에 코드로 뽑고, 지시문에는 "전화번호·이메일은 출력하지 않는다"를 넣는다. (추가 2026-11-03 PM 결정, 대시보드 산업군) companySummary.industries: [string ≤3] — 설정 industries 목록 안 값만(목록을 프롬프트에 넣어 고르게), 없으면 빈 배열, 출처 AI
  save(oppId, result) -> homepageUrl·homepageConfidence·homepageSource AI·homepageStatus(AI_FOUND | NEEDS_CONFIRMATION(confidence < homepageDiscovery.minConfidence) | NOT_FOUND). 저장 뒤 autoResearch면 흐름 ①(C1 POST /homepage 와 같은 내부 호출: 본문 읽기 → 근거 추출 → 재평가). NOT_FOUND면 건너뜀
  confirm(oppId, url|null, confirmedBy, confirmOnly) -> [맞음]은 상태만 CONFIRMED(source STAFF). 주소를 고치면 새 url로 흐름 ① 다시(이전 AI 근거는 이력으로 남김)
  query: 회사명 + 주소(둘 다 공개 CSV·사례 파일 출처). TransferGuard EXTERNAL_SEARCH 통과 뒤에만 호출(C4). 검색어에 메모·내부 값·연락처가 섞이면 호출 안 함
  # (추가 2026-11-12 PM 결정, 웹 검색 갈래 남은 기준 #314·#639) 등록 전 웹 후보: find(companyName, address)는 그대로 쓰고(입력은 src_web_candidate의 공개 회사명·주소), 결과는 src_web_candidate의 homepageUrl·homepageConfidence·homepageReason에 저장한다(회사 번호가 없어 save(oppId, …)를 쓰지 않음). 그 후보가 목록에 들어갈 때 저장된 주소·확신도·이유를 회사에 옮기고(homepageSource AI, homepageStatus는 위 save 규칙 그대로) 홈페이지 찾기를 다시 부르지 않는다. 그 뒤 근거 조사는 기존 자동 조사 그대로다
  keys: 환경 변수 OPENAI_API_KEY 하나(근거 추출과 같은 키). 설정 파일·코드·로그에 적지 않음
  limits: homepageDiscovery.dailyCallLimit(기본 200). timeout 20s, retry 1 (TransferLog 호출마다 1행, kind WEB_SEARCH, 검색어 본문 없음). 월 $20·1,000회 상한에 포함
  cost: 웹 검색 도구 1,000회당 $10 + 검색 본문 토큰(1곳 약 1~3센트). 1곳 끝까지(②~④) 약 4~6센트. 5곳 시험에서 실측
  terms: OpenAI API 출력은 저장·가공 가능(사용 약관), 입력은 기본적으로 학습에 안 씀. 따라서 담당자 확정을 먼저 받을 이유가 없어 자동 저장한다
GeocodeAdapter:                           # (2026-11-13 이강욱 확인 #222) CSV 직접→행안부 주소검색·동일 CSV→좌표 API→네이버. 찾았으면 다음 단계 생략
  geocode(address) -> { lat, lng, source: CSV|JUSO|NAVER, matchedAddress } | null   # NAVER는 요청 안에서만 사용하는 내부 결과. CSV·행안부만 고객 좌표 열에 저장. 못 찾으면 null, 실제 오류는 예외. EXTERNAL_GEOCODE 통과 뒤 외부 호출
  keys: 환경 변수 JUSO_SEARCH_KEY·JUSO_COORD_KEY (승인키가 서로 달라 바꿔 쓰면 거부됨). 설정 파일·코드·로그에 적지 않음
  limits: geocoding.dailyCallLimit. timeout 10s, retry 1. 좌표계 변환(entX/entY → 위경도)은 공식을 코드로 둠(패키지 추가 없음, 직선거리 용도라 수십 m 오차 허용)
  distance: 두 위경도 사이 직선거리(구면 공식) km 소수 1자리. 점수·순위에는 쓰지 않는다
  # (기존 2026-11-03 결정은 2026-11-13 확인으로 대체) 네이버는 마지막 실시간 보완에 사용하고 저장·재사용하지 않는다. 서버 REST API로만 주소를 보내며 브라우저 SDK Service.* 금지는 유지. 지도 조각 표시와 지오코딩은 별개다
  # 주소 검증: 시도·시군구·도로명/지번·본번·부번·지하/산 여부 대조. 복수 주소·복수 위치·빈 좌표는 미확인. 이름/연락처/메모는 보내지 않는다. 고객 원본 주소는 바꾸지 않는다
  # 카드·상세: 저장 공공좌표가 있으면 로컬 계산. 없을 때 naverFallbackEnabled인 경우만 네이버 실시간 주소 검증·거리 계산. 가상·비공개·기준 좌표 없음은 null. 결과를 평가·기본 추천 순위에 넣지 않는다
RouteAdapter:                             # (2차 후보, 2026-11-03 저녁 PM 결정 — 자리만) 좌표 2점 → 차로 가는 거리·시간. 공급자 네이버클라우드 Maps Directions 5(월 60,000건 무료). 결과는 저장하지 않고 화면에 1회 표시만(약관 제7조 ⑪). 지금은 만들지 않는다
  route(fromLatLng, toLatLng) -> { distanceKm, durationMin, fetchedAt } | null   # 저장 금지. 키 NCP_MAPS_KEY_ID·NCP_MAPS_KEY(2차에서)
HomepageReader:
  fetch(url) -> { allowed: boolean, reason: enum[OK, ROBOTS_DISALLOW, TERMS_DISALLOW, UNREACHABLE], text|null }
  timeout: 20s, retry: 1 (전체 60초 한도 안)
  # (추가 2026-11-11 PM 결정 #557) fetchSite(url) -> { pages: [{ url, text }] }: 첫 화면을 fetch로 읽은 뒤, 첫 화면 링크 가운데 같은 사이트(호스트가 같고 www. 차이만 허용) 주소이면서 링크 글자나 주소에 extraPageHints 말이 있는 것을 처음 나온 순서대로 extraPages장까지 더 읽는다. 장마다 robots·약관 차단 검사를 그대로 하고, 막히거나 못 읽은 안쪽 페이지는 건너뛴다(첫 화면이 실패할 때만 조사 실패). 안쪽 페이지 본문은 extraPageMaxChars에서 자른다. 전체 60초 한도는 첫 화면과 같이 쓴다
  # 근거 추출(LlmAdapter)에는 페이지마다 공개 본문 항목 하나로 넘겨 AI를 **한 번만** 부른다(대표번호 뽑기 → 연락처 지우기 순서는 페이지마다 그대로). 근거의 출처 주소(ev_evidence.sourceRef)는 인용문이 그대로 들어 있는 페이지 주소를 코드가 찾아 붙인다(못 찾으면 첫 화면 주소)
ExternalSourceApi (공장등록·나라장터):
  timeout: 30s, retry: 1, dailyLimitGuard: 1000 (공장등록)
  contractRow: SourceContract 필수
  # (추가 2026-11-05 저녁 PM 반영, 후보 찾기 1차 #221) 공장등록 조회 3종 중 **회사명 조회만** 쓴다(AI가 고른 회사의 업종명·주생산품·홈페이지·회사 전화번호 채우기). 산업단지명 조회는 목록에 쓰지 않는다 — 산업단지 밖 공장을 못 잡음(2026-11-05 확인: 사례 파일 18곳 중 5곳만 나옴). **(바뀜 2026-11-06 PM 결정 #323: 파일은 그대로 두고 산업단지명 조회를 목록에 더한다 — 바로 아래 줄)** 응답은 항상 XML, 한 번에 1000건까지 읽힘. 인증키는 환경 변수 DATA_GO_KR_SERVICE_KEY로만. 대표자 이름·팩스번호 열은 읽는 단계에서 버린다(저장·로그·전송 없음, CON-11). 조회에 안 나오는 회사는 지우지 않고 "등록 자료에서 안 보임"으로만 표시
  # (추가 2026-11-06 PM 결정, 목록에 조회의 단지 입주 목록을 더함 #323) 공장등록 조회 3종 중 **산업단지명 조회도** 쓴다(목록 더하기, C5 "목록 출발점 둘"). 목록 단계에서 읽는 열은 회사명·단지명·주생산품·업종명·공장주소·공장관리번호뿐이고, 대표자 이름·팩스번호·회사 전화번호·홈페이지 주소는 읽는 단계에서 버린다(저장·로그·전송 없음. 전화번호·홈페이지는 고른 회사에 한해 회사명 조회로 채움 — 그대로). 하루 호출 한도 dailyLimitGuard는 회사명 조회와 합쳐서 센다
  # (추가 2026-11-07 PM 결정, #393·#221·#390 — 하루 한도를 세는 법) dailyLimitGuard 1000은 HTTP 호출 수 기준이다(단지명 조회·회사명 조회·쪽 넘김·재시도 모두 1회씩). 호출마다 tg_transfer_log에 1행(purpose PUBLIC_SOURCE, kind FACTORY_REGISTRY, C6 줄)을 남기고, 부르기 전에 KST 오늘 0시 이후 ALLOW 행의 callCount 합이 1000 이상이면 부르지 않고 REJECT 행을 남긴 뒤 받은 데까지만 쓴다(회차 complexListSkippedReason DAILY_LIMIT, C1 화면 문구 그대로). 단지별 결과는 ingestion.complexList.cacheDays(=15, 2026-11-08 #405로 7에서 올림) 동안 src_complex_fetch로 다시 쓰므로 같은 단지는 15일에 한 번만 센다. C4 전송 검사(외부 AI용)는 거치지 않는다 — 보내는 것이 단지명·회사명뿐이고 공공 조회이기 때문
CandidateSearcher:                        # (추가 2026-11-05 밤 PM 결정, 후보 찾기 웹 검색 #313·#314) 후보 찾기 웹 검색 = OpenAI 웹 검색 도구(홈페이지 찾기와 같은 제공사·키)
  search(criteria: { processCodes, regions, industries }) -> [{ companyName, address|null, sourceUrl, snippet }]   # 검색어는 조건의 이름만(C4). 실제 검색 결과나 페이지에 적힌 회사만 돌려준다 — sourceUrl이 없는 항목은 어댑터가 버린다(AI가 만든 이름만으로는 넣지 않음). candidateWebSearch.blockedDomains(채용 사이트·유료 기업 정보)에서 나온 결과는 버린다. 사람 이름·전화·이메일은 출력하지 않게 지시하고, 와도 저장 전에 지운다
  cache: 같은 criteria는 candidateWebSearch.cacheDays 동안 저장된 결과(src_web_search_run)를 다시 쓴다. timeout·retry·사용량 기록은 HomepageFinder와 같음. 하루 검색 횟수는 candidateWebSearch.dailySearchLimit까지
  store: (추가 2026-11-09 PM 결정, #314·#487) search 결과의 snippet을 src_web_candidate.snippet에 그대로 저장한다(C6, 저장 전 연락처 검사). AI 판단(pick_candidates)은 웹 후보에도 공공자료 행과 같은 입력 칸 모양(회사명·생산품 글=snippet·업종명 없음·주소)으로 돌리고, 결과는 src_candidate_judgment.webCandidateId에 연결한다(C6 "둘 중 하나" 규칙). 웹 후보가 공장등록 조회로 등록 자료에서 확인되면 그 뒤부터는 공공자료 갈래와 똑같이 다룬다(판단 기록은 웹 후보 번호에 남긴 채 둔다).
  order: (2026-11-09 PM 결정) #314의 독립 부품(검색 부르기, 출처 주소 없는 것·막는 사이트 결과 버리기, 같은 조건 다시 쓰기 판정, 하루 한도)은 #480·#316 병합을 기다리지 않고 먼저 만들어도 된다. 판단 기록·회사 등록에 연결하는 부분만 이 줄(C6·C7 2026-11-09)이 합쳐진 뒤 한다.
HiringSignalFinder:                       # (추가 2026-11-05 밤 PM 결정, 채용 공고 근거 #313·#315 — 만들기는 후보 찾기 다음)
  find(companyName, address) -> [{ postedAt: date|null, roleSummary: string, sourceUrl }]   # 찾은 회사를 조사할 때(② 홈페이지 찾기 옆) 최근 채용 공고를 찾는다. 결과는 시점 신호 HIRING 제안(출처 AI·상태 PENDING, 출처 등급 B)으로 저장. postedAt이 없으면 미확보로 두어 점수에 넣지 않는다(FR4.3 감쇠 그대로). 채용 사이트 페이지를 우리가 직접 읽어 오지 않고, 인사 담당자 이름·연락처는 출력·저장하지 않는다. 사례 파일·담당자가 적은 채용 신호는 덮지 않는다
```

## 5. 열린 질문

| Contract | Question | Blocks |
|---|---|---|
| C1 | 재접촉 카드·상세 영역(`recontact` 객체)의 세부 필드 | ~~U6 (기능 설계)~~ 보류(2026-11-03, U6 재접촉 보류) |
| C0·C1·C6·C7 | (2026-11-03, PM 결정 Q1~Q10 반영) `INTERESTED`·`contactMethod`·`contactResult`·ActivityItem NOTE 추가, `/opportunities?stage=`, `POST /notes`, `/outcomes` 칸 4개, `/bookmark` 안 씀, `/approvals` 설정으로 숨김, `/dashboard` 새 모양(깨는 변경, v2), `rec_note`, `records` 설정. 코드는 U5(이강욱 서버·고선주 화면)·U7(고선주)에서 | U5·U7 (코드 PR과 같이) |
| C1 | 추가조사 기록(ResearchTask, P2)의 경로와 본문 | U4 (기능 설계, P2) |
| C3 | ReadinessCheck의 `evalIdAtCheck`가 파일 투입 시 비어 있을 때 첫 평가가 채우는지 | U1 (기능 설계) |
| C3 | 재접촉 프로필 입력 ①~⑦ 값과 일치도 단계 값 매핑 | ~~U6 (기능 설계)~~ 보류(2026-11-03, U6 재접촉 보류) |
| C6 | 마이그레이션 도구(Alembic 후보)와 첫 마이그레이션 묶음, `db merge-heads` 구현 | U1 (코드 생성) |
| C7 | 위치 정보를 주는 JSON/YAML 로더 선택과 `_설명` 키 처리 | U1 (코드 생성) |
| C7 | 아연도금 가상 사례의 기대값(FR10.2) | U10 (사례 설계) |
| C8 | 명령 이름 접두어 `geosan`과 설치 방식(`python -m` vs 스크립트) | U1 (코드 생성) |
| C8 | (2026-11-09 PM 승인, #489 댓글) `source-confirm` 운영 명령 추가. 소스 2개의 이용·저장 확인을 담당자·서울 날짜와 함께 기록하며 기존 기록은 덮지 않음. 더하는 변경 | #489 이강욱 |
| C1 | (2026-11-09 PM 승인, #497 댓글) AI 점수 제안의 확정·고치기를 기존 check 경로로 처리. 요청 stepLabel 선택 칸·상세 제안 줄 stepOptions 선택지 추가, 공정 제안은 확정만. 기존 열로 새 버전·확정자·시각 기록 뒤 재평가·활동 이력 저장. 더하는 변경 | #497 이강욱 · 화면 #498 고선주 |
| C9 | 홈페이지 자동 탐색의 검색 방식·비용·약관 → **답(2026-11-03 저녁, PM 결정 B 확정)**: **OpenAI 웹 검색 도구**가 찾아 주소·확신도를 바로 저장하고, 회사가 들어올 때 근거 추출·재평가까지 자동으로 잇는다. 담당자는 상세 화면에서 [맞음]/주소 고치기. 확신도 낮으면 "홈페이지 확인 필요" 띠. 비용은 월 $20 상한 안(1곳 약 4~6센트). (낮에 정한 네이버 검색 API 안은 특약상 담당자 확정이 먼저 필요해 같은 날 버림. 구글 Custom Search는 신규 중단) U9가 아니라 **U2에서 함께** 구현(C9 HomepageFinder) | ~~U9~~ → U2 |
| C4·C7·C9 | (2026-11-03, PM 결정 3) 외부 AI 제공사 OpenAI(근거 추출 ③④에만), 모델 gpt-6.1-sol(비교용 gpt-6-luna), 단가 입력 $2/출력 $10 per 1M, 월 비용 상한 $20(50% 알림, OpenAI에만), 월 호출 상한 1,000회(웹 검색 호출 포함). 키는 OPENAI_API_KEY 하나(결정 B로 네이버 키 불필요). 설정 키 추가·C4 비용 상한 거부·EXTERNAL_SEARCH 용도·C1 `/llm-usage`·C9 provider/retention/HomepageFinder. 모두 더하는 변경. **(2026-11-03 저녁 결정 B)** 상세 머리 homepageStatus·homepageConfidence·homepageSource, `POST /homepage` confirmOnly, `homepageDiscovery` 칸 3개, `geosan research` 명령, HomepageFinder find/save/confirm — 더하는 변경. `naverSearch`·`/homepage-candidates`는 "안 씀". 제안서 `../delivery-planning/llm-settings-proposal-20261103.md` | U2 (코드 PR에서 LlmSettings·예시 파일·.env.example 같이) |
| C0·C1·C4·C6·C7·C8·C9 | (2026-11-03, PM 결정 거리·지도) 거리 필터·정렬(`sort`·`maxDistanceKm`·카드 `distanceKm`), 용도 EXTERNAL_GEOCODE, 고객 좌표 열 4개, 설정 `geosan`·`geocoding`·`distanceFilterPresetsKm`, 명령 `geocode`, GeocodeAdapter. 지도 링크 2개는 화면이 주소로 만들어 약속 변경 없음(#210). 코드는 1차 전달 뒤 #222에서. 기준 주소는 봉주로 303-1 본사(PM 최종 확정 2026-11-03 밤. 소개서 기업개요는 본사, '오시는 길' 슬라이드는 제2공장으로 적는 같은 주소), 설정 `geosan.address` | #222 (11/17 주, 코드 PR과 같이) |
| C1·C4·C6·C7·C9 | (2026-11-03 밤, PM 결정 대시보드 집계·지도) `/dashboard` 응답 `breakdown`(공정 9종·산업군, "대시보드 대상" 기준, 없으면 화면이 막대 줄을 숨김), `GET /dashboard/map`, 상세 머리 `industries`·`industriesSource`, `POST /industries`, C4 화면 지도 규칙, `opp_customer` 산업군 3열, 설정 `industries`·`dashboard`·`map`, LlmAdapter `companySummary.industries`. 모두 더하는 변경. 제안서 `../delivery-planning/dashboard-breakdown-map-20261103.md` | 막대(가짜) #215 → 집계 #216(11/10 결정), 산업군 AI #219, 칩 #209·#210, 지도 #226(2차) |
| C0·C1·C4·C6·C7·C9 | (2026-11-03 밤, PM "반영" — 상세 화면 5영역) 코드표 `noteKind`·`reviewItemKind`·`reviewItemSource`, 상세 머리 대표번호 출처·확인 3칸, `POST /main-phone/confirm`, `/notes kind`, `records.contactCount`·카드 `contactCount`, `reviewItems`·`POST /review-items/{itemId}/check`, C4 추출 단계·`extract_main_phone`, `opp_customer` 3열·`rec_note.kind`·`rec_review_check`, 설정 `mainPhone.allowedPrefixes`, LlmAdapter `companyMainPhone` 안 씀. 모두 더하는 변경. (4) 영업 전략 초안(`draft_strategy`·`opp_strategy_draft`·`/strategy`)은 2차라 아직 안 적음. 메모→OpenAI는 거산 답 대기(#208). 제안서 `../delivery-planning/detail-screen-layout-20261103.md` 4장 | #209·#227(서버)·#210·#228(화면)·#211(코드표)·#219(추출) |
| C1·C7 | (2026-11-03 밤, PM 결정 지역·산업 선택) 목록 `region=`(시·군 또는 설정 묶음 "천안 인근" = 천안시·아산시, 주소 글자로)·`industry=`(설정 industries, 1차는 사례 파일에 사람이 적은 값 industriesSource CASE_FILE)·`meta.regionCounts`·`meta.industryCounts`·카드 `region`·`industries`, 설정 `listFilters.regionPresets`, `q`에 산업군 이름. 더하는 변경. km 거리(#222)·AI 산업군 제안(#229)은 2차 그대로. 제안 `../delivery-planning/list-filters-region-industry-20261103.md` | #209(API)·#210(선택 UI)·사례 파일 산업군 손 입력(새 이슈) 1차 |
| C1 | (2026-11-03 밤, PM 결정 공정별 구분) 추천 목록 `process=` 거르기(공정 안 순위)·`meta.processCounts`·카드 `processCodes`. 더하는 변경. 이전 시연은 전기아연도금·아노다이징을 한 줄로 섞었으나 거산 영업이 공정별이라 탭으로 나눔. 제안 `../delivery-planning/process-tabs-20261103.md` | #209(API)·#210(탭) 1차 |
| C1·C6 | (2026-11-03 밤, PM 결정 #209·#213 확인 요청) `/config/ui` 응답 `records`(approvalEnabled·noteMaxLength), 상세 응답 `records.outcome.nextScheduleNote`. 더하는 변경. C6 고객 `address`(원본)·`normalizedAddress`(비교용) 구분을 적음 — 코드가 원본 열을 빠뜨린 것이라 약속 변경 아님. DB 이력 두 갈래(web_001 ∥ opp_002~opp_004)는 C6 규칙대로 `db merge-heads`로 합침 | #209(기록 서버 PR)·#213(배포 준비 PR) |
| C1·C6·C8 | (2026-11-04, PM 결정 ① — 새 후보 가져오기) `POST /ingest`(단추, 명령과 같은 함수, 409 INGEST_RUNNING, 새 회사만 백그라운드 자동 조사), 목록 `batch=`·`meta.latestIngest`, 카드 `ingestBatchId`·`ingestedAt`·`isNewInLatestBatch`, `opp_customer` 2열, `opp_ingest_batch`. 기존 회사는 사라지지 않고 "이번 수집만 / 전체" 전환으로 예전 회사를 다시 봄(①). 순위표 통째 저장(②)은 안 함. 더하는 변경 | #221(U3, 11/17 이후, 유동렬 +6~8h; 단추 화면은 고선주) |
| C8 | (2026-11-04, PM 결정 A — #212) `review-set --all`: BROCHURE 값 전부를 COMPANY_CONFIRMED 묶음으로 복사(REVIEWED + 이력) → 활성 묶음 전환 → 재평가를 한 트랜잭션으로. 띠·참고 점수는 묶음 종류(BROCHURE)로 판단하므로 상태만 바꿔서는 안 내려감(규칙·화면 그대로). 더하는 변경 | #212(유동렬, 평가 진입점 포함) |
| C4·C6·C8 | (2026-11-04 PM 승인, #218) `transfer-unblock` 조회·확인 사용량 수동 정산, `tg_transfer_log.reconciled_at`·`reconciled_by` 추가. 원래 호출 수·월 귀속 보존, 자동 0 처리 없음, 한 트랜잭션·중복 정산 거부. 운영 안내서 포함. 더하는 변경 | #218 유동렬, kind·문구 선행 #252 합친 뒤 올림 |
| C0·C1·C4·C6 | (2026-11-04, PM 결정 — 검토사항 [답 적기] 1차) 코드표 `noteKind REPLY`, 상세 `reviewItems` 질문 줄에 `replyText`·`repliedAt`·`repliedBy`, `Question.repliedBy`, `POST /questions/{questionId}/reply` 대기 → 회신 허용·담당자 키·덮어쓰기, 답 이력은 새 표 없이 `rec_note` kind REPLY 행으로 활동 이력에 보존, `q_question` 회신 3열. 답·활동 이력은 영업 메모와 같은 취급(내부 전용). 담당자 항목 추가·질문 글 고치기는 2차. 더하는 변경. 제안 `../delivery-planning/review-answer-inline-20261104.md` | #248(서버 이강욱)·#249(화면 고선주) |
| C0·C1·C4·C6 | (2026-11-04, PM 결정 — 분석용 코드값 칸 1개) 코드표 `lostReasonCode` 6종(가격·납기·기존 거래처 유지·수요 없음·품질·인증 요건·기타), `/outcomes` LOST 저장 때 필수·OTHER면 자유 글 reason 필수, 상세 `records.outcome.lostReasonCode`, `rec_outcome.lost_reason_code`. 코드값이라 엑셀·대시보드 집계에 쓸 수 있음. (같은 날 추가, #257 질문 답) 거절 상태에서 같은 코드로 다시 저장하면 reason이 비어도 이전 거절 행의 reason을 이어받음. 더하는 변경 | #250(서버 이강욱)·#251(화면 고선주) |
| C1·C2·C4 | (2026-11-04, PM 확정 — [AI로 조사] 응답 모양, 이강욱 제안 #219) `POST /homepage` 성공 응답 2종(조사 실행: 근거 수 전체·그중 요구 후보 수·새 질문 수·새 평가 ID, meta.reevaluated / 주소 확인만: 주소·CONFIRMED·STAFF), 400(confirmOnly+pastedText), 409 STALE_VALUE, 503 실패 종류 kind 6개(LLM_LIMIT·SEARCH_LIMIT·USAGE_UNCONFIRMED·LLM_NOT_CONFIGURED·TIMEOUT·LLM_FAILED; 같은 날 PM 확인으로 키·설정 오류를 LLM_NOT_CONFIGURED로 분리, 잠금 그룹)와 kind별 화면 동작·담당자용 문구, C2 FlowResult `counts`, C4 사용량 빈 행 거부 kind USAGE_UNCONFIRMED. 모두 더하는 변경 | API 연결(이강욱 또는 유동렬, #219 하위 이슈)·kind 정리는 #218 풀기 명령 PR |
| C1·C3 | (2026-11-04, PM 결정 #212 ① — 거래 확인 전 점수 표시) 카드 `scoreDisplay` 규칙 한 줄(소개서 묶음이 아니어도 점수가 있으면 숫자 그대로, 값 형식 변경), 카드·상세 머리 `scoreState`(CONFIRMED/PENDING/NONE → 화면 흐리게), 카드 `relationStatus`(꼬리표 "거래 확인 전"·"기존 거래처"). 정렬은 계산 점수 기준 그대로. 고정 문구 demoLabel 유지(②). 제안 `../delivery-planning/score-display-pending-20261104.md` | 규칙 표시 함수(유동렬)·카드 응답(이강욱)·화면(고선주), 이슈 번호는 제안서 상태 줄 |
| C0·C1·C3·C6 | (2026-11-04, PM 결정 — 거래 관계 화면 입력, 1차) `POST /opportunities/{oppId}/relation`(거래 없음/거래 중/확인 전 되돌리기, 재평가 한 트랜잭션, 같은 값 400, STALE_EVALUATION 409), 상세 머리 `relationConfirmedAt`·`relationConfirmedBy`, ActivityItem `RELATION_CONFIRMED`, `opp_customer.relation_confirmed_by`, `opp_relation_history`(변경 이력), C3 거래 중 기회 맨 아래 정렬 설정 `existingCustomerPlacement`(기본 BOTTOM). 모두 더하는 변경 | 서버 이강욱·화면 고선주, 이슈 번호는 제안서 상태 줄 |
| C1 | (2026-11-04, PM 결정 #229 — 대시보드 성사·거절) `/dashboard` counts에 `WON_LAST_12M`·`LOST_LAST_12M`(최근 12개월), 성사·거절 목록 `meta.analysis`(규칙 집계, 표본 10건 미만은 건수만), 대시보드 대상 규칙 `WON_THIS_YEAR` → `WON_LAST_12M`(연도 기준은 1월에 0 — 코드 없음, 화면 가짜 숫자 파일 이름 1곳). 더하는 변경. 시연용 자료는 DB 파일 분리(#274) | #229(2차)·#216(가짜 숫자 파일 이름) |
| C1 | (2026-11-05, PM 결정 #279 — 대시보드 일정) `/dashboard` schedule·counts.SCHEDULE_DUE에서 최신 단계가 성사·거절로 끝난 영업의 남은 다음 일정 제외. 더하는 변경(규칙 명시) | #216·PR #279(고선주) |
| C1·C2·C5·C6·C7·C8·C9 | (2026-11-05, PM 결정 — 자동 갱신 2차 첫 묶음) 후보 수집을 CSV 수동에서 **산단공 공장등록 API 산업단지명 조회를 매달 서버가 자동으로 부르는 것**으로 바꿈(CSV는 예비; 시도·시군구 조회 API는 없음, 회사명 조회는 회사명 필수라 목록에 못 씀 — 2026-11-05 확인). 근거 추출 출력에 `itemInputProposals`·`processLinkProposals`(출처 AI·PENDING, 점수에 바로 쓰되 흐리게), `eval_item_input`·`opp_process_link` 출처·상태 열, 근거 갱신 규칙 ① 상세 열 때 N일 넘으면 자동 재조사(`research.refreshOnOpen`, 상세 `research` 객체, `POST /homepage` `trigger`) ② [다시 조사](있음) ③ 정기는 상위 `topN`+새 후보만(`research.periodic`), `opp_ingest_batch.requestedBy SCHEDULER`, 설정 `ingestion.schedule`·`ingestion.complexes`, 명령 `ingest kicox-production-api`·`research --periodic`. N일·주기는 5곳 시험(#219) 비용으로 PM이 정함. #224는 MCP 연결 비교표를 2차 설계 때. 모두 더하는 변경. 제안서 `../delivery-planning/auto-refresh-candidates-proposal-20261105.md` | #221(유동렬, 11/17 주)·#286(AI 점수 입력)·#224 |
| C0·C1·C4·C5·C6·C7·C8·C9 | (2026-11-05 저녁, PM "반영" — 후보 찾기 1차 편입) 바로 위 줄의 2차 묶음 가운데 **후보 찾기(#221)와 AI 점수 입력·공정 연결 제안의 최소 범위(#286)를 1차로 당김**. 담당자가 공정·지역·산업을 고르면 AI가 공공자료에서 맞는 회사를 골라 목록에 더한다. 목록은 산단공 공장현황 **파일**에서 얻고(산업단지 밖 공장 포함 — 사례 파일 18곳 중 파일 17곳, 산업단지 이름 조회 5곳), 공장등록 조회는 고른 회사의 정보 채우기에만 쓴다. `POST /ingest` 조건 칸·진행 칸, C4 공개 소스 행 전송 규칙, `src_factory_row`·`src_candidate_judgment`, `opp_ingest_batch` 조건·건수 열, 설정 `ingestion.factoryCsvPath`·`aiPick`, 환경 변수 `DATA_GO_KR_SERVICE_KEY`, `geosan ingest` 조건 인자·`--rejudge`, `pick_candidates`, `reviewItemKind` 2종. 대표자 이름·팩스번호는 저장하지 않는다(거산 확인 #275). 위 줄의 매달 자동 수집(`ingestion.schedule`·`complexes`)·정기 재조사·상세 열 때 자동 재조사는 2차 그대로이고, 산업단지명 조회를 목록에 쓰는 설계는 2차 때 다시 정한다. 모두 더하는 변경 | #221·#286 (1차, 유동렬·이강욱·고선주) |
| C0·C1·C4·C6·C7·C9 | (2026-11-05 밤, PM 결정 — 후보 찾기 웹 검색·채용 공고 근거) **소스 제한을 넓혀 후보 찾기에 웹 검색 허용(PM 결정 2026-11-05)**: 처음의 "자동 수집 소스는 3개 안에서만"(CON-04)을 넓힌다. 채용 사이트·유료 기업 정보 결과 버리기, 사람 이름·연락처 미수집, 검색어에 거산 내부 정보 미포함은 그대로. 등록 자료에서 못 찾은 회사는 ① 공식 홈페이지 확인 ② 실제 검색 결과·페이지에 적힌 회사 ③ 출처 주소 저장일 때만 넣고 꼬리표 "등록 자료에서 못 찾음 · 확인 필요", 담당자 확인 전까지 점수 흐리게. 설정 `candidateWebSearch`(켜고 끄기·하루 한도·결과 저장 일수·막는 사이트), `CandidateSearcher`, `src_web_search_run`·`src_web_candidate`, 카드 `discoverySource`·`registryStatus`·`fitLevel`·`pickReason`, 점수 전 목록은 공정 적합도 순. **채용 공고는 근거로 쓴다**(CON-08 풀이: 채용 사이트를 직접 긁지 않고, AI 웹 검색이 찾은 공고의 날짜·직무 요지·출처 주소만 시점 신호로. 유료 기업 정보는 계속 금지) — `HiringSignalFinder`·`research.hiringSignal`. 만드는 순서: ① 공공자료 찾기+고른 이유+공정 연결(11/15 필수) → ② 웹 검색 갈래(11/15 목표) → ③ 점수 8항목 제안(넘치면 11/17 주). 사례 파일 18곳은 그대로 두고 견주는 기준으로 쓴다. 모두 더하는 변경. 규칙 문서 `AGENTS.md` "바깥 자료 규칙" | #313 · #314(웹 갈래)·#315(채용 공고, 2차)·#221·#286 |
| C1 | (2026-11-06, PM 결정 — 후보 찾기 두 갈래의 순서와 합치는 규칙) 바로 위 줄의 웹 검색 갈래를 **공공자료 갈래 다음에 돌린다**(동시에 돌리지 않음). 규칙 넷: ① 이미 목록에 있는 회사는 출처를 바꾸지 않는다(먼저 들어온 길이 출처 — 두 갈래에서 모두 나오면 공공자료 출처, 사례 파일 18곳도 그대로) ② 같은 회사인지 애매하면 합치지 않고 "확인 필요"(C5 같은 회사 가리기 그대로) ③ 웹 검색은 공공자료 회사가 목록에 들어간 직후 시작하고, 자동 조사는 두 갈래가 다 들어온 뒤에 한 줄로 ④ 공공자료 갈래가 아예 실패하면 웹 검색을 돌리지 않고, 한도로 일부만 됐으면 계속한다. 이유: 꼭 필요한 공공자료 갈래가 월 AI 비용·조회 한도를 먼저 쓰고, 같은 조건으로 찾으면 결과와 출처 표시가 매번 같다(동시에 돌리면 먼저 끝난 쪽이 출처가 됨). 새 응답 칸·코드값·표 없음. 더하는 변경(규칙 명시) | #345 · #314(웹 갈래)·#221 |
| C1 | (2026-11-06, PM 결정 — 찾기 실패 사유 한 줄) 목록 `meta.latestIngest`에 `failureReason`(실패가 아니면 null)을 더함. 저장 표에 이미 있던 칸을 응답에 싣는 것. 이유: 공공자료 갈래가 아예 실패하면 웹 검색도 돌리지 않기로 해서(바로 위 줄), 사유가 없으면 담당자가 왜 아무것도 안 들어왔는지 알 수 없음. 쉬운 말 한 줄만 싣고 내부 경로·키·연락처는 싣지 않음. 공통 응답 모델·명세 파일에 반영. 더하는 변경 | #347 · #317(값 채우기)·#316(화면) |
| C0·C1·C6·C7·C9 | (2026-11-06, PM 결정 — 표면처리를 직접 하는 회사 표시) 후보 찾기에서 도금·아노다이징 같은 표면처리를 **직접 하는 회사로 보이면 표시한다**(실제 파일에서 아산의 아노다이징 회사가 후보로 나옴). **자동으로 빼지 않는다**(FR9.3: 자체 설비가 있다는 것만으로 외주 수요가 없다고 단정하지 않음) — 꼬리표 "표면처리를 직접 하는 회사일 수 있음 · 확인 필요"와 검토사항 확인 줄을 붙이고, 빼는 것은 담당자가 기존 "검토 대상 제외" 의견으로 한다. 판단은 AI 고르기(생산품 글)와 공장등록 조회의 업종명 두 곳에서 하고, 웹에서 찾은 회사에도 같이 적용. 점수 전 회사들 안에서만 표시 없는 회사 뒤에 두고, 점수가 있는 회사의 점수·분류·순서는 바꾸지 않는다. 경쟁사 비교는 만들지 않는다(CON-23 그대로). 카드 `ownPlatingLineSuspected`·`ownPlatingLineBasis`, `reviewItemKind` `OWN_PLATING_LINE_SUSPECTED`, `pick_candidates` 결과 2칸, 설정 `ingestion.aiPick.surfaceTreatmentIndustryNames`. 모두 더하는 변경 | #319 · #221·#314 |
| C0·C1·C4·C5·C6·C7·C9 | (2026-11-06, PM 결정 — 목록에 조회의 단지 입주 목록을 더함) 후보 찾기의 목록 출발점을 **공장현황 파일 하나에서 파일 + 공장등록 조회의 단지 입주 목록 둘로** 늘린다(확인: 천안제3일반산업단지 파일 100행·조회 266행, 조회에만 있는 제조업 14곳). 2026-11-05 저녁 줄의 "산업단지명 조회를 목록에 쓰는 설계는 2차 때 다시 정한다"를 1차로 당긴 것이고, 파일을 목록으로 쓰는 것은 그대로다(단지 밖 공장은 파일에서만 나옴). 부를 단지 이름은 파일의 단지명에서 얻고, 조회 결과는 주소로 다시 거르며, 파일과 같은 회사는 더하지 않는다. `discoverySource` `FACTORY_API`, `meta.latestIngest.complexListSkippedReason`과 화면 문구, C4 업종명 전송, `src_factory_row` 3열·`src_complex_fetch`, 설정 `ingestion.complexList`. 대표자 이름·팩스번호·전화번호·홈페이지 주소는 목록 단계에서 버린다. 옛 줄 2곳은 지우지 않고 "바뀜" 표시만 붙임. 그 밖은 모두 더하는 변경 | #323 · #221 (1차, 유동렬) |
| C0·C1·C6 | (2026-11-06, PM 결정 — 관심을 찜으로 분리, **v3 깨는 변경**) 11/3의 "담기 없음, 관심은 미접촉과 접촉 사이 단계"(Q2)를 바꾼다. **관심은 영업 단계가 아니라 따로 켜고 끄는 표시**이고, **대시보드는 관심으로 고른 회사만 센다**. 이유: 아무도 고르지 않은 회사가 모두 "미접촉"으로 세어졌고, 후보 찾기가 붙으면 그 숫자가 목록 길이가 된다. 흐름: ① 관심 → ② 검토 의견(검토 권고·추가 확인 필요·검토 대상 제외) → ③ 검토 권고만 미접촉 → 접촉 중 → 견적·샘플 → 보류·완료. `outcomeStatus` INTERESTED 삭제, `/bookmark` 다시 씀(끄기 거부·자동 관심), 목록 `bookmarked`·`opinion`·`filter` 값 9개, `/dashboard` counts 10칸, `rec_bookmark`. 관심은 팀이 함께 쓴다 | #356(약속·서버) · #357(화면), PM 세션 |
| C1 | (2026-11-06, PM 결정 — 목록 머리 선택란) 추천 목록의 공정 탭을 **선택란**으로 바꾸고 거산 공정 9종을 모두 보인다: `meta.processCounts`에 0건인 공정도 싣는다(11/3의 "0건은 빼고 보냄"을 바꿈). "전체"는 두지 않는다(서로 다른 공정을 한 줄 순위로 섞지 않는다는 11/3 결정 그대로). 목록 머리에 회사 이름 검색 칸(검색하면 조건과 상관없이 전체 후보에서)과 정렬 "추천 순 / 가까운 순 (준비 중)". 가까운 순은 #222(2차)에서 만든다. 더하는 변경 | #361, PM 세션 |
| C1 | (2026-11-06, PM 결정 — 공정을 고르기 전에는 목록을 비움) 같은 날의 "항상 공정 하나가 골라져 있고 처음은 첫 공정"을 바꾼다. 추천 목록을 처음 열면 공정이 골라져 있지 않고 "공정을 고르면 그 공정의 후보가 나타납니다"만 보인다(프로그램이 공정을 대신 고르지 않는다). 마지막으로 본 공정은 브라우저에 기억해 다음에는 그 공정으로 바로 연다. 검색·관심 기업 목록·대시보드 칸으로 넘어온 목록은 그대로. 화면 규칙만 바뀌고 응답 모양은 그대로 | #368, PM 세션 |
| C1 | (2026-11-07, PM 결정 — 공정별 묶음 보기) #368의 "고르기 전에는 비워 둠"을 바꾼다. 공정을 고르기 전에는 **공정별 묶음**으로 보이고 지역·산업을 먼저 고를 수 있다(지역을 먼저 골라 인근 후보를 훑는 쓰임). 묶음 안에서만 번호를 매겨 섞인 순위는 없다. 화면만 바뀌고 서버 응답은 그대로. 더하는 변경 | #383, PM 세션 |
| C4·C6 | (2026-11-06, PM 결정 — 후보 찾기 저장 표) 회차·확인 필요 후보·공장 행·AI 판단·단지 조회 기록·웹 검색 실행과 후보·소스 이용 확인·수집 집계 표 9개와 회사·공정 연결의 찾기 칸을 **PM 세션이 한 PR로 먼저 만든다**(유동렬·이강욱은 이 표에 쓰는 코드만 만든다). 약속에 없던 칸을 먼저 적음: 회차의 `maxCandidates`·`rejudge`·`skippedCount`·`failureReason`·웹 건수 5칸, 회사의 `fitLevel`·`pickReason`, 실행 중 회차는 DB가 하나만 허용. **AI 사용 기록(`tg_transfer_log`)의 `oppId`를 빈 값 허용으로 바꾸고 `batchId`를 더함**(후보 판단은 영업기회가 생기기 전이라 번호가 없음 — 따로 표를 만들지 않아 월 한도 합산이 한 곳에 남는다). 카드·목록 머리 응답 칸과 명세 파일 갱신은 다음 PR. tg_ 한 칸만 형식 변경(넓히는 쪽), 나머지는 더하는 변경 | #327 · #221·#317 (1차) |
| C7 | (2026-11-06, PM 결정 — 사례 파일 홈페이지 칸) 사례 파일 `customer.homepageUrl`(선택)을 더함. 적으면 확정·사례 파일 출처로 저장해 상세 회사 링크가 공식 주소를 가리킨다(모션텍처럼 근거 주소에서 홍보관 주소가 뽑히는 문제). 비우면 지금 주소 유지, 담당자가 고친 주소가 있으면 그 값 유지 + 경고. `contracts/case-file.schema.json`·예시 틀·작성 안내서 같이 고침. 더하는 변경 | #190 · #332 (PM), 모션텍 파일은 유동렬 |
| C0·C1·C2 | (2026-11-06, PM 결정 — 후보 찾기 응답 칸과 실행 함수 입력) 이미 적혀 있던 응답 칸을 **공통 응답 모델과 명세 파일에 실음**: 목록 `meta.latestIngest`(회차 요약 19칸), 카드의 `ingestBatchId`·`ingestedAt`·`isNewInLatestBatch`, 카드·상세 머리의 `discoverySource`·`discoverySourceUrl`·`registryStatus`·`fitLevel`·`pickReason`·`ownPlatingLineSuspected`·`ownPlatingLineBasis`, 코드표 `DiscoverySource`·`FitLevel`. 상세에서는 머리에 둔다(위치가 안 적혀 있었음). 값은 창구(#317)가 채우고 그 전에는 응답에 안 나온다. **C2 `run_ingest` 입력을 회차 번호 하나로 맞춤**(C6 #327 줄과 달랐던 것을 정리, 함수는 아직 없음). **AI 판단은 한 번 해 두고 조건이 바뀌면 거르기만 함**, `fitLevel`·`pickReason`은 가장 잘 맞는 공정 기준(#221). 응답 칸은 더하는 변경, C2는 구현 전 형식 정리 | #342 · #317·#221 (1차) |
| C1 | (2026-11-07, PM 결정 — 표면처리 확인 줄 규격) #319의 "검토사항에 OWN_PLATING_LINE_SUSPECTED 줄을 만든다"의 줄 번호·문장·출처를 정함: itemId `FLAG:OWN_PLATING_LINE_SUSPECTED` 고정 하나, text "표면처리를 직접 하는 회사일 수 있음: <근거>"(근거 없으면 앞 문장만), source는 표시 출처대로 `AI`/`RULE`, targetLabel null. 체크는 기존 `/review-items/{itemId}/check` 그대로이고 **점수 전 회사는 체크를 저장하지 않는다**(A안. B "점수 전에도 체크되게 약속·DB 보완"은 11/15 범위가 늘어 안 고름). 더하는 변경 | #363·#386 |
| C6·C7·C9 | (2026-11-07, PM 결정 — 산단공 조회 보관 일수·하루 호출 기록) 유동렬 #221 질문 답. `ingestion.complexList.cacheDays` 값 **7** 확정. 공장등록 조회의 하루 호출 1,000회는 **새 표 없이 `tg_transfer_log`에 HTTP 호출마다 1행**(purpose `PUBLIC_SOURCE`, kind `FACTORY_REGISTRY`, costUsd 0, 본문 없음, batchId 또는 oppId)을 남겨 KST 오늘 ALLOW 행 합으로 센다. 월 OpenAI 상한 집계와는 분리. 코드값 2개 추가·설정값 확정이라 더하는 변경 | #393 · #221·#390 (유동렬) |
| C5·C7·C9 | (2026-11-08, PM 결정 — 단지 조회 결과 다시 쓰기의 저장 칸·보관 일수) 유동렬 #405 질문 답. `src_complex_fetch`에 `rowIds: json[string]`(이 조회가 받은 공장 행 번호 목록) 한 칸을 더해 조회마다 받은 행을 기억한다 — 받은 시각만으로는 다른 단지명 조회가 같은 공장을 또 받을 때 앞 조회의 결과가 빠졌기 때문. 받은 행은 지역과 상관없이 전부 저장하고 다시 쓸 때 거르며, 다시 쓰는 것은 status OK·만료 전 조회만. `ingestion.complexList.cacheDays` 기본값 **7 → 15**(공장 등록은 월 단위로 바뀌어 7일은 뜻이 작고, 2차 한 달 수집보다는 짧게). 칸 하나 더함·설정값 변경이라 더하는 변경, 버전 그대로 | #405 · #404 (유동렬) · PR(PM) |
| C1 | (2026-11-08, PM 결정 — 상세 기록 구역 세 칸 헷갈림) 영업 기록 저장의 `attemptedAt`은 오늘(KST)까지만, 뒤면 400(fields path attemptedAt). 화면은 기록 구역 머리에 "① 한 일 → ② 지금 단계 → ③ 다음 할 일" 안내를 붙이고, 접촉을 적은 뒤 단계가 미접촉이면 "접촉으로 바꿀까요?"를 한 번 묻는다(자동 변경 아님, 기존 단계 저장 호출). 규칙 한 줄 더함이라 더하는 변경 **(바뀜 2026-11-12 PM 확인 #607)** 묻는 줄 대신 서버가 접촉 저장 때 미접촉 → 접촉으로 자동으로 바꾸고, 세부 단계가 자료·견적 이상이면 견적·샘플로 바꾼다(앞으로만, 보류·성사·거절은 그대로) (#643부터 꼬리 질문 답으로도 정해진다) | #432 · #433(고선주) #434(이강욱) #435(PM) |
| C1 | (2026-11-08, PM 결정 — 후보 가져오기 조건 칸 선택지) 고선주 #316 질문 답. `/config/ui` 응답에 `ingestOptions`(공정 9종 코드·이름, 지역 목록, 산업 목록)를 더한다. 목록 응답의 공정·지역·산업 건수는 이미 들어온 회사 기준이라 회사가 없는 공정을 찾는 조건 칸에 쓸 수 없고, 설정값을 화면이 이미 부르는 화면 설정 응답 한 곳에서 주는 것이 가장 단순하기 때문. 안 고른 방법: 선택지 전용 새 경로(경로가 늘고 두 곳을 불러야 함), 화면 코드에 값 직접 적기(설정값이라 안 됨). 칸 하나 더함이라 더하는 변경, 버전 그대로 | #424 · #316(화면, 고선주) · #428(서버, 이강욱) · #221 |
| C4·C6·C9 | (2026-11-08, PM 결정 — 고르기 지시문 입력 칸에 업종명) AI 고르기로 나가는 공개 소스 행 칸에 **업종명(있으면)** 을 더한다(파일 행은 비어 있음, 산단공 조회 행만 값). 이유: 생산품 글이 비거나 한 단어뿐인 행은 업종명이 유일한 판단 근거라서(pick-v1 규칙 9). 업종명과 입력 칸 목록을 행 지문·판단 기준 버전에 포함해 바뀌면 다시 판단한다. 칸 하나 더함이라 더하는 변경, 버전 그대로 | #221 · #425(유동렬) · PR #429(PM) |
| C6·C7 | (2026-11-08, PM 결정 — AI 고르기 지시문 파일) 이강욱 #427 질문 답. `ingestion.aiPick.promptFile`(기본 `examples/prompts/candidate-pick.md`)로 지시문 파일을 가리킨다. 이유: PM이 코드 PR 없이 파일 하나로 지시문을 바꿔 끼울 수 있어야 하고(PM 결정 2026-11-06), YAML 안 긴 글은 줄바꿈·따옴표 실수가 잦다. 파일 내용은 판단 기준 버전에 포함. 키 하나 더함이라 더하는 변경, 버전 그대로 | #430 · #425(유동렬) · #427(이강욱) |
| C1·C3 | (2026-11-08, PM 결정 B안 — 점수 전 회사 목록 표시) 이강욱 #427 발견(찾은 회사가 DB에는 있는데 목록에 안 보임) 답. 찾은 회사가 항목 입력이 없으면 재평가가 건너뛰지 않고 **"평가 전"(`NOT_EVALUATED`, 점수 null) 기록**을 남겨 목록에 들어간다. 기획서 11분기에 이미 있는 코드라 코드표 변경 없음. 11/6 "점수 전 회사는 체크를 저장하지 않는다"(A안)는 평가 기록이 없다는 전제가 사라져 저장되는 쪽으로 바뀌고, 허용 유지 여부는 2차 #441. 안 고른 방법: 목록이 평가 없는 회사도 보이게 카드 칸을 선택으로 바꾸기. 더하는 변경(기존 코드값 사용), 버전 그대로 | #440 · #427(이강욱)·#426(유동렬) · 2차 #441 |
| C1·C6 | (2026-11-08, PM 결정 — 그때 본 평가 번호) `rec_outcome`·`rec_note`에 `eval_id`(nullable) 칸을 더하고, `/outcomes`·`/notes`가 요청의 evalId(화면은 이미 보냄)를 저장한다. 검사는 의견과 같은 쪽: 낡은 번호여도 저장, 다른 기회의 번호만 400, 없으면 비움. 기존 행은 비움 그대로. 이유: 이 서비스의 핵심은 쓸수록 거산에 맞게 순위·근거가 맞춰지는 것인데 접촉·단계·메모는 어느 순위를 보고 남긴 기록인지 알 수 없었다. 거산이 쓰기 시작하는 11/15 전에 칸이 있어야 그 뒤 기록이 2차 되먹임(#268·#269)과 KPI 재료가 된다. 안 고른 방법: 시각으로 거꾸로 추정(재평가가 잦아 틀림), 거래 관계처럼 409 거부(목적이 "본 평가 기록"). 응답 모양 그대로, `openapi.json`은 요청 스키마에 evalId가 이미 있어 변경 없음. 더하는 변경, 버전 그대로 | #451(PM) · #450(이강욱) |
| C1·C6·C9 | (2026-11-09, PM 결정 — AI 점수 제안 1차 본체 구현 #286) 2026-11-05 줄의 C6 "eval_item_input에 더하는 열 source·state·confirmedAt·confirmedBy·evidenceRef"는 **새 열 없이 기존 열로 표현**한다: 출처 = `proposed_by`(FILE·AI·STAFF), 상태 = `proposed_by`가 AI인 현재 행이면 확인 전(PENDING), 담당자가 확정하면 STAFF 행이 새 버전으로 들어와 확정(CONFIRMED), 확정자·시각 = 그 행의 `entered_by`·`entered_at`, 근거 참조 = `evidence_ids`. 이유: 열 추가 마이그레이션 없이 같은 뜻을 담을 수 있고(기존 `state`는 항목 판정 상태라 이름이 겹침), 배포 전 DB 변경을 줄인다. C9 extract_evidence의 `itemInputProposals`·`processLinkProposals`는 그대로이며 certaintyProposed는 STRONG·WEAK만 받는다(AI가 "확인됨"을 주장하지 않음). 제안이 하나라도 있으면 8항목을 모두 채우고 근거 없는 항목은 UNAVAILABLE(점수 null) AI 행. scoreState PENDING은 현재 입력에 AI 행이 있을 때 응답에서 계산한다. 뜻·형식 변경 없음, 더하는 설명 | #286(PM) · #497(이강욱 창구) · #498(고선주 화면) |
| C7·C9 | (2026-11-09, PM 결정 — 후보 고르기 비용 줄이기 #491) 설정 `ingestion.aiPick`에 더하는 칸: `model`(string|null, 후보 고르기에만 쓸 모델, `llm.allowedModels` 안. 비우면 `llm.model`. PM의 모델 비교용), `excludeKeywords`(string[], 생산품·업종명에 이 말이 있고 제조 낌새(제조·생산·가공·부품·제작)가 없으면 AI에 보내지 않고 코드가 "제조업 아님"으로 기록, 모델 이름 `rule:exclude-keyword`. 기본 목록은 운송·물류·도소매·소프트웨어·식품·섬유·건설업 등 27개). `rowsPerCall` 기본값 100 → 20(실측: 100행은 60초 한도를 넘김). 지시문 pick-v2: 제조업이 아니면 reason은 빈 문자열·목록은 빈 배열로 짧게, 이유 문장 60자 → 40자. C9 CandidateJudgment의 reason은 제조업일 때만 필수. 실측(세종 923행): 1.62달러 중 출력이 80%였고 비제조업 380곳도 긴 답을 냈다. 제외 키워드와 지시문은 판단 기준 버전에 들어가 바뀌면 다시 판단한다. 모두 더하는 변경 | #491(PM) · #425 |
| C7 | (2026-11-09, PM 결정 — 목록 지역 묶음 이름 #517) `listFilters.regionPresets` 초안 값 "천안 인근"(천안시·아산시)을 **"충남"(충남 15개 시·군 전체)**로 바꾼다. 이유: "인근"이 어디까지인지 모호하고, 후보 찾기 지역(충남·대전·세종)과 같은 단위가 읽기 쉽다. 시·군 선택지는 주소에서 자동으로 따로 보이는 것 그대로. 설정값만 바뀌고 모양·코드는 그대로(값 변경, 약속 형식 변경 아님) | #517(PM) · #361 |
| C1·C7 | (2026-11-09, PM 결정 — 후보 찾기 지역을 시·군으로 #521) `ingestion.regions` 값에 충남 15개 시·군(천안시·아산시 등)을 더한다. "충남"은 충남 전체로 그대로다. `POST /ingest`의 `regions`와 회차 `criteria`에는 고른 값이 그대로 남고, 공장 행의 `region`은 지금처럼 시·도("충남")로 저장한다. 파일 읽기·저장은 시·도 단위로 하고 AI 판단 직전에 주소의 시·군으로 추린다. 구가 붙은 주소("천안시서북구")는 천안시로 본다. 이유: 시 단위로 찾기 위해서이고 비용도 고른 시·군 행만큼만 든다. 안 고른 방법: 저장 행의 region을 시·군으로 바꾸기(충남 전체 선택이 사라지고 저장 행이 바뀜). 값을 더하는 변경, 버전 그대로 | #521(PM) · #221 |
| C1 | (2026-11-09, PM 결정 — 후보 찾기 선정 순서 #528) 조건에 맞는 회사에서 **이미 목록에 있는 회사(이름·주소 모두 같음)를 뺀 뒤 적합도 상 → 중 → 하 순(표면처리 직접 표시는 뒤)으로 `maxCandidates`만큼** 등록한다. 지금까지는 파일 순서로 앞에서 잘라 상위가 먼저 오지 않았고 재실행이 같은 회사만 뽑았다. `pickedCount`는 새로 등록할 회사 + 이미 있어 건너뛴 회사다. 자동 조사는 이미 적힌 "실패는 그 회사만"대로 맞췄고, 한도·사용량 미확정·설정 오류만 멈춘다. 응답 모양 그대로, 더하는 설명 | #528(PM) · #221 |
| C0·C1·C6 | (2026-11-09, PM 결정 — 접촉 때 AI 판단이 맞았나 #531) 코드표 `judgmentCheck`, `/outcomes` 요청 칸, `rec_outcome.judgment_check`(nullable)를 더한다. 이유: "판단이 맞았나"와 "영업이 됐나"를 나눠 쌓아야 2차 되먹임이 "맞음이면 올림, 다름이면 내림"을 할 수 있다. 이미 외주처가 있어 거절해도 사실이 맞으면 맞음이다. 쓰기 시작한 뒤 넣으면 그 전 기록은 복구할 수 없다. 저장만 하고 1차 점수는 바뀌지 않는다. 안 고른 방법: 거절 이유 코드로 거꾸로 추정. 더하는 변경, 버전 그대로 | #531(PM) · #268·#269 |
| C6·C7·C9 | (2026-11-09, PM 결정 — 웹 후보 찾기 착수) 유동렬 #314 질문 답. ① `src_web_candidate`에 `snippet`(공개 생산품 요약) 칸 ② `src_candidate_judgment`에 `webCandidateId` 칸, `rowId`와 둘 중 하나만 채움 ③ `candidateWebSearch` 초기값 하루 20회·15일 보관·막는 사이트 12곳(채용 8·유료 기업 정보 4) ④ #314 독립 부품은 #480·#316 병합 전에 먼저 만들어도 됨. 모두 더하는 변경(`rowId` 빈 값 허용은 기존 행 영향 없음). 안 고른 방법: 웹 후보를 공장 행에 끼워 넣기, 판단 기록 없이 등록 | #314 (유동렬), #487 |
| C1·C6 | (2026-11-10, PM 결정 — 제외한 회사는 관심 기업에서 뺀다, **v4 깨는 변경**) 11/6(#356)의 "기록을 남기면 관심이 켜지고 기록이 있으면 끌 수 없음" 때문에 "검토 대상 제외"로 저장한 회사가 관심 기업에 남아 관심 기업 목록·대시보드 관심 구역에 "제외"가 섞였고, 끄기 거부 안내("빼려면 '검토 대상 제외'로 저장해 주세요")대로 해도 빠지지 않았다. 바꾸는 것: `/opinions` NOT_TARGET 저장이 관심을 끔, 제외인 회사는 메모·단계 저장으로 관심이 켜지지 않음, `/bookmark` 켜기 422 `BOOKMARK_EXCLUDED`, `/dashboard` counts·목록 `filter`에서 `NOT_TARGET` 삭제, 마이그레이션 `rec_011`(지금 "관심 + 제외" 회사의 관심을 끔). 제외한 회사는 목록 머리 "제외한 회사" 보기(`?opinion=NOT_TARGET`, 응답 모양 그대로)에서 본다. 이유: 관심은 "영업해 볼 회사"라서 그만 보기로 한 회사가 섞이면 수와 목록이 뜻을 잃는다. 안 고른 방법: 관심은 켜 둔 채 화면에서만 숨기기(기록상 관심인데 안 보여 헷갈림) | #536(PM) · #356·#357 |
| C1·C4·C7 | (2026-11-10, PM 결정 — AI 응답을 못 받아도 멈추지 않게 #538) 사용량이 빈 전송 기록 1건이라도 있으면 그달 AI를 모두 막던 규칙(2026-11-04, USAGE_UNCONFIRMED)을 바꾼다: 빈 기록은 설정 `llm.unconfirmedCallCostUsd`(초기 0.10)로 쳐서 월 비용 합에 더하고 월 상한만 본다. 수동 정산(`transfer-unblock`)은 선택. AI 응답 대기는 `/homepage` 전체 60초 안에서 남은 시간만큼(코드가 응답 한 번을 20초로 끊던 것은 약속과 다름). 이유: 12/11 뒤 잠금을 풀 사람이 없고, 11/10 실제 확인에서 21초에 끊긴 호출 1건으로 조사·후보 찾기가 모두 잠김. 안 고른 방법: 잠금만 없애기(상한 계산에서 빠짐), 잠금 두고 우리가 풀기. 응답 모양 그대로(USAGE_UNCONFIRMED 코드값은 남기고 안 냄), 설정 키 하나 더함, 버전 그대로 | #538(유동렬) · #218·#252 |
| C1·C6·C7·C8 | (2026-11-10, PM 결정 — 새 후보 가져오기의 비용을 누르기 전에 보인다 #549 ①②③) 새 경로 `GET /ingest/preview`(외부 호출 0건): 고른 조건의 맞는 공장 수·적합도별 수·들어온 곳 수·판단 전 수와 예상 금액·이번 달 사용액·잠금(`blocked`). `POST /ingest`·`geosan ingest`는 넘으면 422 `INGEST_OVER_BUDGET`로 거부. `opp_ingest_batch.estimatedUsd`, `meta.latestIngest.estimatedUsd·actualUsd`, 설정 `ingestion.costEstimate` 4키. 단추 이름 [영업 후보로 더하기 💰], 💰 표시는 [다시 조사]·[붙여넣고 조사]에도. 단추 둘로 나누기·운영 담당 판단 단추는 2차. 안 고른 방법: 거르기에도 [맞는 공장 보기] 단추(돈이 안 드는데 단추가 늘어 "단추 = 돈"이 흐려짐), 한도까지 판단하고 멈추기(담당자 한 번 클릭으로 그 달 예산이 다 나갈 수 있음). 더하는 변경 |
| C7·C9 | (2026-11-11, PM 결정 — 자동 조사가 안쪽 페이지도 읽는다 #557) 새로 들어온 회사의 자동 조사가 첫 화면 1장만 읽어 8항목 중 1~2개만 찼다(11/9·11/10 조사된 14곳 전부). 같은 사이트의 회사소개·제품·연혁 같은 페이지를 설정 장수까지 더 읽어 한 번에 AI에 보낸다. 설정 `homepageDiscovery.extraPages·extraPageHints·extraPageMaxChars`, C9 `HomepageReader.fetchSite`. AI 호출 수는 그대로(본문이 길어져 1곳 약 $0.01~0.02 늘 수 있음). 모두 더하는 변경 | U2 |
| C1·C5·C6·C7·C8 | (2026-11-11, PM 승인 — 공장 등록 정보·수질 명단을 목록 회사에 붙임 #573) 후보 거르기 근거가 생산품 이름 한 줄뿐이라 적합도 "상"이 112곳이었다. 팩토리온 공장조회 엑셀(원자재·종업원 수·업종번호·공장 규모)과 수질 명단을 보조 자료로 넣어 카드·상세 `factoryProfile`과 표면처리 표시(출처 `INDUSTRY_CODE`·`WATER_LIST`)를 붙인다. 종업원 수는 언제나 추정(PM 지시). 후보 목록 출발점·AI 고르기·점수·순서 규칙은 그대로라 AI 비용 없음. 표 `src_factory_profile`·`src_water_site`, `opp_customer` 4열, 설정 `surfaceTreatmentIndustryCodes`, 명령 `source-load`, `source-confirm` 소스 2개. 안 고른 방법: 팩토리온 파일을 후보 공장 파일로 바꾸기(주소가 안 맞는 약 50곳 중복·AI 다시 판단 약 $12). 모두 더하는 변경 | #573 (2차) |
| C0·C1·C4·C6·C7·C8 | (2026-11-12, PM 결정 — 영업 메모를 단계별 꼬리 질문 + 한 줄 메모로 #607) 코드표 `salesStep`(세부 단계 5개, 큰 단계 안), `/outcomes` 선택 칸 `answers`·`stepOverride`와 큰 단계가 세부 단계를 따라 앞으로만 바뀌는 규칙, 카드 `salesStep`, 상세 `records.salesStep`, 새 경로 `GET /sales-questions`, 표 `rec_outcome_answer`·열 `rec_outcome.step_override`(rec_012), 새 파일 `examples/sales-questions.yaml`과 설정 `records.salesQuestionsFile`·`memoLineMaxLength`, check-config가 그 파일도 검사. 이유: 자유 메모는 고려할 게 많고 견줄 수 없다. 11/8 #433의 "접촉해도 단계는 자동으로 안 바꾸고 한 번 묻기"는 이 자동 이동으로 바꾼다(PM 11/12 확인). 안 고른 방법: 큰 단계를 새 6단계로 바꾸기(깨는 변경, 카드·대시보드·거르기 모두 바뀜), 문구를 코드에 고정(바꿀 때마다 PR). 모두 더하는 변경(옛 요청·응답 그대로), 버전 그대로 | #607 · #561 결정 1 |
| C8 | (2026-11-12, PM 확인 — 수질 명단을 이름·주소가 모두 맞는 곳에만 붙임 #613) 수질 명단 붙이기를 "회사명 + 같은 시·군"에서 "회사명 + 도로명·건물번호"로 좁힌다. 이유: 같은 시의 이름이 같은 다른 공장에도 "자체 도금" 표시가 붙었다(실제 공장 자료 기준 101곳 → 78곳). 안 고른 방법: 주소 글자 전체 일치(표기 차이로 10곳만 맞음). 응답 모양·표·설정 그대로, 버전 그대로 | #613 · #561 결정 8 |
| C9 | (2026-11-11, PM 승인 — 원자재를 AI 후보 판단에 넣음 #570) 후보 판단 입력이 생산품 이름 한 줄이라 소재(무슨 금속인지)를 몰랐다. #573이 붙인 팩토리온 원자재를 판단 입력 칸 `rawMaterials`로 더하고, 공장 행에 업종명이 없으면 팩토리온 업종명을 보낸다. 지시문 pick-v3(원자재는 소재 단서로만, 원자재만으로 "상"을 주지 않음). 판단 기준 버전이 바뀌어 지역별 한 번 다시 판단(비용 PM 확인). 안 고른 방법: 조사 검색으로 원자재 찾기(회사당 약 $0.08, 결과가 매번 다름), 원자재 단어 규칙으로 공정 바로 정하기("철강"만으로는 도금 종류를 못 고름). 모두 더하는 변경 | #570 (2차) |
| C9 | (2026-11-12, PM 결정 — 다시 판단한 결과를 기존 회사 카드에도 옮김 #615) 회사를 처음 올릴 때만 추천 이유·적합도를 적어, #570으로 다시 판단한 뒤에도 카드가 옛 문장이었다(이 PC 자료 대조 162곳 중 추천 이유 158곳·적합도 37곳이 달랐음). 후보 찾기 실행 때 AI가 찾아 올린 기존 회사의 `fitLevel`·`pickReason`을 최신 판단으로 바꾸고 그 회사만 재평가한다. 사례 파일 회사·담당자 값·공정 연결·"제조업 아님" 판단은 그대로. 안 고른 방법: 카드를 고치는 운영 명령 추가(약속에 없는 명령이 늘고 돌리는 걸 잊으면 다시 어긋남). 칸·명령을 더하지 않는 동작 보강이라 버전 그대로 | #615 PM |
| C1·C6 | (2026-11-12, PM 결정 — 공장 정보에 공장 등록 업종명 #617) 카드·상세 `factoryProfile`에 `industryName`(string\|null), `opp_customer`에 `factoryIndustryName` 1열. 이유: AI가 고른 이유 한 줄만으로는 어떤 업종인지(예: 절삭가공) 알 수 없었고, 업종명은 이미 받아 둔 등록 사실인데 화면에 없었다. 안 고른 방법: 업종명을 AI 문장에 넣게 지시문 고치기(추정과 사실이 섞이고 다시 판단 비용). 칸 하나·열 하나 더함이라 더하는 변경, 버전 그대로 | #617 PM |
| C1·C4·C6·C7 | (2026-11-12, PM 지시 #594 — 기록 취소, 2차. 결정은 2026-11-04 A안) `POST /opportunities/{oppId}/records/{recordId}/cancel`(본인 기록만, 403·404·409), ActivityItem `recordId`·`recordKind`·`cancelled`·`cancelledBy`·`cancelledAt`와 줄 종류 `RECORD_CANCELLED`, 카드·상세·대시보드의 현재 값은 취소된 행 제외, `rec_note`·`rec_outcome` 열 3개, 설정 `records.cancelByAnyStaff`와 `/config/ui` 같은 칸. 지우지 않고 표시만 한다(기록 신뢰). 안 고른 방법: 10분 안 삭제, 본인 숨기기. 모두 더하는 변경. 근거 `../delivery-planning/record-cancel-20261104.md` | #253(서버)·#254(화면) |
| C1·C4·C6 | (2026-11-12, PM 지시 #594 — 검토사항 자료 줄 메모, 2차. 결정은 2026-11-04) `POST /notes` 선택 칸 `itemId`(자료 조사만, 질문 줄 400, 없는 줄 404, 500자), 상세 `reviewItems[].note`(최신 하나), `rec_note.item_id`. 메모는 기록용이라 점수에 영향 없음. [붙여넣고 조사]는 기존 `/homepage` 그대로(#537로 1차에 됨). 모두 더하는 변경. 근거 `../delivery-planning/review-gap-memo-paste-20261104.md` | #259(서버)·#260(화면) |
| C1·C4 | (2026-11-12, PM 지시 #594 — 비슷한 회사 참고, 2차. 결정은 2026-11-04 A안) `GET /opportunities/{oppId}/peers`(같은 공정·산업군 최대 5곳 + 건수 요약, 가상 분리, 보기 전용도 조회). 응답은 메모와 같은 취급이고 AI 초안에는 건수만, #247 결정 뒤. 저장 표·설정 변경 없음. 모두 더하는 변경. 근거 `../delivery-planning/similar-companies-strategy-20261104.md` | #268(서버)·#269(화면) |
| C1 | (2026-11-09, PM 결정 — 목록 정렬 "최근 들어온 순" #516) 목록 `sort`에 `recent`를 더한다(들어온 시각 최신 순, 시각 없는 사례 파일 회사는 뒤에 추천 순 그대로, rank는 그 순서 번호). 화면의 "이번 수집만 / 전체" 전환과 카드 "이번에 들어옴" 꼬리표를 없애고, 꼬리표는 `ingestedAt`으로 "11/9 들어옴". `batch=`·`isNewInLatestBatch`는 지우지 않고 두되 화면이 쓰지 않는다. 이유: 마지막 회차 기준은 같은 조건 재실행·실패에 바로 비어 버린다(11/9 오전 10곳이 오후 재실행 뒤 안 보임). 안 고른 방법: 기준을 "회사를 실제로 더한 마지막 회차"로 바꾸기(두 번 나눠 들어온 날은 반만 보임). 더하는 변경 | #516 (1차, PR과 같이) |
| C1 | (2026-11-09, PM 결정 — 관심 기업 보기의 공정 선택란·"전체 보기" #516) 관심 기업 목록에도 공정 선택란을 둔다(맨 위 "전체", `process=` 함께 사용). `bookmarked=true`일 때 `meta.processCounts`·`regionCounts`·`industryCounts`는 관심 기업 안의 건수로 바뀐다(뜻이 달라지지만 이 값을 쓰는 곳은 이 화면뿐이고 거산 전달 전이라 영향 0, PM 판단으로 버전은 올리지 않음). 정렬 줄 끝 "전체 보기"는 화면 주소 `?view=all`만 쓰고 서버 조건은 그대로이며 순위 번호를 숨긴다. 안 고른 방법: 관심 기업 보기는 곳 수를 전체 기준으로 두기(고를 수 있는 곳 수와 실제 결과가 달라짐) | #516 (1차, PR과 같이) |
| C1 | (2026-11-13, 걸러 본 목록의 지역·산업 곳 수 #370 — **PM 확인 필요**) 목록 `meta.regionCounts`·`industryCounts`를 지금 걸러 본 목록 안의 건수로 센다: `process`·`batch`·`bookmarked`에 더해 `opinion`·`stage`·`filter`(대시보드 칸) 조건을 모두 적용한 뒤. 지역·산업·검색어(`region`·`industry`·`q`) 조건은 지금처럼 두 곳 수 어디에도 적용하지 않고, 0곳인 선택지는 지금처럼 싣지 않는다. `meta.processCounts`는 그대로. 응답 칸 이름·모양은 그대로(뜻만 맞춤, #516과 같은 종류라 버전은 올리지 않음). 이유: 곳 수가 목록보다 크면 담당자가 "회사가 빠졌나" 하고 헷갈린다(관심 3곳인데 "천안 인근 8"). 안 고른 방법: 이 보기들에서 지역·산업 선택란 숨기기(관심 기업을 지역으로 거르는 쓰임이 사라짐) | #370 (2차) |
| C3·C7·C8 | (2026-10-21 부분 시연 변경) `baseDate` 키(Q4), BROCHURE OTHER 정렬(Q6, 가설·설정값), `brand.demoLabel`(Q7), `check-case` 명령(Q8) — 기능 설계 Q 답으로 확정. 모두 "더하는 변경"(C3 정렬은 팀이 더한 규칙의 변경, 기획서 규칙 아님) | U1 (기능 설계, 10/21) |
| C3·C7 | (2026-11-11, PM 결정 #567 — 거래 관계 확인 보류) 규칙 설정 `relationCheck`(BLOCK 또는 IGNORE, 생략 시 BLOCK). IGNORE면 거래 관계 확인 전을 필터 대기·막는 조건으로 쓰지 않음. 예시 파일 IGNORE. 더하는 변경(생략 시 이전 동작) | PM 세션 |
| C1 | (2026-11-12, PM 결정 #596 — 상세 [다시 조사] 하나로 정리) `POST /homepage`에 주소 없는 회사의 빈 요청 = 홈페이지 찾기부터 하는 동작과 422 kind HOMEPAGE_NOT_FOUND를 더하고, 카드·상세 머리 `researchState`(RUNNING·NO_SCORE_EVIDENCE·NOT_FOUND·READ_FAILED·NOT_TRIED, nullable; 카드는 "조사 중"/"조사 중단"만, 상세가 이유)를 더한다. confirmOnly·url은 남김. 모두 더하는 변경 | #596 |
| C1·C4·C7 | (2026-11-13, #608 — 영업 분석표, 2차. #561 결정 2 · PM 결정 2026-11-12 "따로 화면") (추가 2026-11-13 #608 — PM 확인 필요) 새 경로 `GET /sales-analysis`(공정별 표 + 공정 × 산업군 하위 줄, 회사별 표, 기준 시각·표본 기준), C4 내부 전용 한 줄, 설정 `salesAnalysis.minSampleForRatio`·`closedWindowDays`. 이유: 고른 값이 쌓이면 "몇 번 만에 성사", "방법별 연결"을 AI 없이 0원으로 정확히 셀 수 있다. 숫자의 뜻은 `meta.analysis`·`/peers`와 같게 두었다. 안 고른 방법: 대시보드 응답에 칸으로 넣기(PM 11/12: 표가 두 개라 한 칸에 좁음), 성사·거절 목록 `meta.analysis`를 넓히기(목록 한 종류의 분석 줄이라 공정별·회사별 표를 못 담음), 표본 기준·기간을 코드에 고정(규칙 ⑩), 비율을 늘 내기(표본이 작을 때 숫자가 부풀려 보임). 저장 표 변경 없음. 모두 더하는 변경, 버전 그대로 | #608 |
| C0·C1·C7 | (2026-11-13, #610 — 추천 목록 세 묶음, 1단계. PM 위임 2026-11-12) (추가 2026-11-13 #610 — PM 확인 필요) 코드표 `contactBucket`·`bucketBasis`, 목록 `sort=contact`, 카드 `bucket`·`bucketBasis`·`rankAdjust`, `meta.bucketCounts`, 설정 `contactList`. 이유: 담당자가 "지금 누구에게 연락할지"를 한눈에 보고, 같은 공정·산업의 성사·거절이 쌓이면 묶음 안 순서에 반영된다(이유를 카드에 한 줄로). 부록 F 점수·분류·`original_rank`·`sort=rank`의 뜻은 그대로이고 저장 표 변경 없음(읽을 때 계산). 안 고른 방법: 기본 정렬(`sort=rank`)의 뜻을 다시 정하기(깨는 변경), 평가 전 회사를 "지금 연락할 곳"에 넣기(필수 판정을 건너뜀 — 스위치만 두고 꺼 둠), 기준 숫자를 규칙 설정에 넣기(규칙 버전이 바뀜). 모두 더하는 변경, 버전 그대로 | #610 |
| C1·C4·C7 | (2026-11-13, PM 결정 — 엑셀 내려받기를 만들어 두고 설정으로 꺼 둠 #217) (추가 2026-11-13 #217 — PM 결정 2026-11-13) `GET /export/xlsx`가 목록과 같은 걸러 보기 조건(tab·stage·bookmarked·opinion·process·industry·region·q·batch·sort·filter)을 받음, 설정 `export.xlsxEnabled`(초기값 false)와 `/config/ui` 응답 `export.xlsxEnabled`, 꺼져 있으면 422 kind `EXPORT_DISABLED`·화면 단추 숨김, 다음 일정은 날짜만, 보기 전용도 내려받기 가능. 내려받은 기록 1행(TransferLog)은 지금 만들지 않고 **설정을 켜기 전에 반드시 만든다** — 그 전에는 true 설정을 설정 검사가 거부한다. 지금 파일은 다섯 열만 담고 나머지 열은 켤 때 PM이 정한다. 이유: 코드는 다 됐지만 거산이 아직 요청하지 않았다(2026-11-03 "거산이 필요하다고 하면 그때"). 합쳐 두면 가지가 오래 떨어져 겹치는 일을 막고, 요청이 오면 설정만 켠다. 안 고른 방법: 가지에 둔 채 기다리기(develop과 계속 벌어짐), 스위치 없이 합치기(기록 없이 파일이 나감). 더하는 변경, 버전 그대로 | #217 (2차) |
| C1·C4·C6·C9 | (2026-11-12·11-13, PM 결정 — 웹 검색 갈래 남은 기준) ① 등록 자료에서 못 찾은 웹 후보는 홈페이지 찾기 확신도가 기존 기준 이상이고 출처 페이지·검색 결과 글에 회사 이름이 실제로 적혀 있을 때만 넣는다 ② 목록에 들어오기 전 후보의 홈페이지 찾기에는 공개 회사명·주소만 보내고 비용은 같은 후보 찾기 회차에 남긴다 ③ 조회가 끝나지 않은 후보는 `src_web_candidate.registryStatus` `PENDING`(조회 대기)으로 보관만 하고 `NOT_FOUND`는 조회가 끝나고 정말 없을 때만 ④ 이름은 같은데 주소가 다르게 조회된 후보는 넣지 않고 버린 이유만 남긴다. 저장 열 `homepageConfidence`·`homepageReason` 추가. 이유: AI가 지어낸 회사·다른 지역 회사가 목록에 섞이지 않게 한다. 안 고른 방법: 불일치 후보를 "확인 필요"로 넣기, 조회 전 후보를 "등록 자료에서 못 찾음"으로 저장하기. 카드·상세 응답은 그대로라 명세 파일 변경 없음. 모두 더하는 변경, 버전 그대로 | #314·#639 |
| C1·C7 | (2026-11-13, PM 결정 — 꼬리 질문 답으로 보류·성사·거절까지 #643) (추가 2026-11-13 #643 — PM 결정 2026-11-13) 질문 파일 답 보기의 새 칸 `closes`·`lostReason`과 그 검사, 마무리 질문 2개(`CLOSE_RESULT` "어떻게 끝났나요?", `LOST_REASON` "거절 이유는?"), `GET /sales-questions` 응답의 같은 두 칸, `/outcomes`가 closes 답이 있으면 같은 저장 안에서 큰 단계와 거절 이유 코드를 정하는 규칙, 접촉 결과 DECLINED에서도 step ALL 질문의 답을 받는 것. 이유: 전화·메일을 하고 답을 받으면 결정과 다음 일정이 그 안에서 나오므로 단계를 두 번 고르게 하지 않는다(PM 2026-11-13). 안 고른 방법: 샘플 "합격"이면 저절로 성사(합격이 계약은 아님), 관심 "없음"이면 저절로 거절(담당자가 끝냈다고 고른 것이 아님), 접촉 결과 "거절"만으로 저절로 거절(이유 코드를 알 수 없음). 저장 표·응답 모양은 그대로이고 옛 요청은 그대로 받는다. 모두 더하는 변경, 버전 그대로 | #643 · 앞선 일 #607 |
| C1·C7 | (2026-11-13, PM 결정 — 꼬리 질문에서 공정·산업을 확인하고 영업 분석은 확정 값으로만 센다 #652) (추가 2026-11-13 #652 — PM 결정 2026-11-13) 질문 파일의 새 칸 `choices`(PROCESS·INDUSTRY)와 그 검사, 확인 질문 2개(`CONFIRM_PROCESS` "어떤 공정을 맡길 수 있나요?", `CONFIRM_INDUSTRY` "어느 산업인가요?"), `GET /sales-questions` 응답의 `choices` 칸과 서버가 채우는 보기, `/outcomes`가 같은 질문에 여러 답을 받아 공정 연결·산업군을 확정하고 다시 평가하는 규칙, 상세 `records.salesStep.known`이 여러 값을 값마다 한 항목으로 싣는 것. 여기까지는 더하는 변경. **뜻이 바뀜**: `GET /sales-analysis`가 확정된 공정·산업군만 세고 확인 전 회사는 "공정 확인 전"·"산업 확인 전" 한 줄에 센다(전에는 AI 제안까지 각각 셌고 줄 이름은 "공정 미확정"·"미확정"). 칸 이름·모양은 그대로. PM 결정 2026-11-13, 영업 분석은 11/13에 처음 합쳐져 아직 쓰는 곳이 없어 버전은 올리지 않음(PM 확인 필요). 이유: AI가 회사마다 공정을 평균 4~5개 제안해 한 곳에 연락해도 여러 공정·산업 줄에 나왔다. 안 고른 방법: AI 제안 가운데 첫 번째만 세기(틀린 제안이면 숫자도 틀림), 상세 검토사항 [확정] 단추만 쓰기(제안이 접혀 있어 아무도 안 누름), 답 표에 여러 값 칸 더하기(값마다 한 행이면 표를 안 바꿔도 됨). 저장 표·이전 파일 변경 없음. 세 묶음 순서 조정(카드 rankAdjust, #610)과 대시보드 막대(#627)의 세는 기준은 이번에 바꾸지 않았다 — rankAdjust 설명의 "세는 방법은 영업 분석표와 같음"은 접촉·결과를 세는 방법만 같고 공정·산업군은 전처럼 AI 제안까지 본다. 따로 맞출지 PM 확인 필요 | #652 |
| C1 | (2026-11-13, PM 결정 — 카드 꼬리표 줄이기 #659) (추가 2026-11-13 #659 — PM 결정 2026-11-13) 카드 `confirmedProcessCodes`(확정된 공정만)·`proposedProcessCount`(AI 제안만 있는 공정 수). 화면은 카드에서 지역 꼬리표를 빼고 공정 꼬리표는 확정된 공정만 보이며, 확정이 없고 제안만 있으면 "검토사항" 줄에 "맞는 공정이 아직 확인 전 · AI 제안 n개"를 덧붙인다. 카드 `region`·`processCodes`는 그대로 준다(지역 선택란·공정 선택란·묶음 순서가 씀). 이유: 지역은 목록 머리 지역 선택란과 겹치고, 확인 안 된 공정을 꼬리표로 늘어놓으면 사실처럼 읽힌다. 안 고른 방법: AI 제안 공정에 "(제안)"을 붙여 그대로 두기(꼬리표 수가 안 줄어듦). 더하는 변경, 버전 그대로 | #659 |

## 6. 전달 계획·뒤 단계로 넘기는 것

- (사용자 보호 장치 ③) 서버가 만든 OpenAPI와 `contracts/openapi.json`, 검사기 스키마와 `contracts/*.schema.json` 네 개를 비교하는 검사를 기존 CI 자동 검사에 한 단계로 붙인다. 만드는 시점은 전달 계획에서 정한다(U1 뒤, U2~U5 동시 진행 전이 자연스러움). C6 테이블·C8 명령은 자동 비교 없이 PR 체크리스트로만 보호한다.
- (사용자 보호 장치 ④) PR 체크리스트(PR 템플릿)에 "약속 파일을 바꿨나요?" 한 줄을 넣고, 바꿨으면 PM 확인 후 합친다. 템플릿 파일은 U1 코드 생성에서 만든다.
- 후속 확장 메모(범위 밖): 엑셀로 입력받아 JSON으로 바꾸는 변환 기능. 거산 담당자가 엑셀을 선호하면 12/11 이후 검토.
- 요구사항 갱신 필요: 없음(계약은 요구사항을 그대로 옮김). 응답 시간은 성능 목표 3초(NFR2)와 요청 중단 한도 10초(상호작용 명세)를 구분해 적었다.

## 7. 검토(review-01) 반영 요약

High 3건(출력 검사의 용도 구분과 거부 응답, 담당자 키 헤더, 동시 수정 버전·낡은 평가 처리), Medium 12건(오류 분기·칸별 오류, 세션 보안·429·잔여 위험, 순위 함수, 코드표·변환 규칙, 마이그레이션 규칙, 투입 파일 설명·줄 번호·모르는 키·연락처 검사, 재투입 규칙, 명령 보강, 온라인 백업, 약속 파일 명시적 갱신, `/homepage` 60초 한도와 재시도 집계, 응답 조립 등록 방식), Low 3건(3초/10초 구분, CLAUDE.md 문구, Question·ActivityItem·상태 코드 보강)을 모두 반영했다. 제안대로 LLM 어댑터는 허용 항목 ID만 받아 본문을 직접 조회하고, 쓰지 않는 입력(profileOverride)은 뺐다.

## 8. CLAUDE.md에 추가한 규칙 (사용자 보호 장치 ②)

`.claude/CLAUDE.md`에 "약속(계약) 파일 규칙" 절을 추가했다: 약속 파일(`contracts/` 폴더와 이 문서)에 없는 경로·필드·명령·테이블·파일 항목을 만들지 말고 먼저 물어볼 것, 더하는 것도 약속 파일에 먼저 적고 PR에 표시한 뒤 코드를 만들 것, 약속 파일은 PM 확인 없이 고치지 말 것. `contracts/`는 U1에서 생성된다.
