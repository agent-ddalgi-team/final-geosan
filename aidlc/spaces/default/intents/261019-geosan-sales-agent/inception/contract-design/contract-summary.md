# 계약 요약 (Contract Summary) — 거산케미칼 AI 영업지원 에이전트 2차

이 문서는 작업 단위(`../units-generation/unit-of-work.md`)와 의존 그래프(`../units-generation/unit-of-work-dependency.md`)의 경계마다 "무엇이 어떤 모양으로 건너고 잘못되면 어떻게 되는가"를 적은 약속(계약)입니다. 부품과 엔티티 이름은 도메인 설계(`../domain-design/components.md`)를, 성능·오류 규칙은 요구사항(NFR2·NFR7·NFR10, FR7.6)을 따릅니다. 확인된 답변은 `contract-design-questions.md` Q1~Q4입니다. 시스템은 한 덩어리(FastAPI + React 정적 파일 + SQLite)라 **밖에 공개하는 API는 없습니다**. 외부 LLM·외부 소스 API는 우리가 쓰는 쪽이므로 어댑터 계약(C9)으로만 다룹니다.

필드 이름·경로·명령 이름은 **제안**이며 기능 설계와 코드 생성에서 그대로 쓰거나 같은 뜻으로 고칩니다. 깨는 변경은 2장 규칙을 따릅니다. 검토(review-01)의 소견 18건을 반영한 판입니다.

**계약 요약 버전: v2 (2026-11-03, PM 결정)** — (같은 날 PM 지시 추가: 영업 메모에 연락처 허용, 회사 대표번호 자동 표시. 근거 `../delivery-planning/contact-policy-change-20261103.md`) 깨는 변경 1건: C1 `GET /dashboard` 건수 이름·응답 모양 재정의(아직 코드 없음, 영향 0). 같은 날 더한 것: C0 `INTERESTED`·`contactMethod`·`contactResult`, C1 `stage` 조건·`/notes`·`/outcomes` 칸, C6 `rec_note`, C7 `records`, 재접촉(U6) 항목 "보류" 표시. 근거: `../delivery-planning/scope-change-proposal-20261102.md` 4장 답.

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
  1. 약속 파일 = 저장소 `contracts/` 폴더(`openapi.json`, `case-file.schema.json`, `capability-file.schema.json`, `rule-config.schema.json`, `app-settings.schema.json`)와 이 문서. `contracts/`는 U1에서 처음 만든다. 약속 파일은 **사람이 `geosan export-contracts`를 명시적으로 실행할 때만** 갱신하며 서버 시작 시 자동 생성은 하지 않는다(코드가 기준이 되어 버리는 것을 막음).
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
outcomeStatus: [NOT_EXECUTED, INTERESTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST]   # (갱신 2026-11-03, PM 결정 Q2) INTERESTED "관심" 추가(미접촉 다음). 쉬운 말: 미접촉 / 관심 / 접촉 / 견적·샘플 / 보류 / 성사 / 거절. 담기 대신 씀
contactMethod: [CALL, EMAIL, VISIT]                                 # (추가 2026-11-03, U5 메모 4장) 접촉 방법: 전화 / 메일 / 방문
contactResult: [REACHED, ABSENT, DECLINED]                          # (추가 2026-11-03, U5 메모 4장) 접촉 결과: 연결됨 / 부재 / 거절
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
            kind: { type: string, description: '화면 분기용(비노출): ROBOTS_DISALLOW, TERMS_DISALLOW, UNREACHABLE, STALE_EVALUATION, EXPORT_REJECTED, LLM_LIMIT, …' }
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
        rank: { type: integer }
        title: { type: string, description: 기업 · 기회 이름 }
        distanceKm: { type: number, nullable: true, description: '(추가 2026-11-03 PM 결정, 거리 #222) 거산 기준 주소(설정 geosan.address)에서의 직선거리 km. 좌표 없으면 null(화면 "거리 미확인"), 가상 사례는 null("가상·거리 없음")' }
        classificationCode: { type: string }
        coreEvidenceRecheck: { type: boolean }
        scoreS: { type: number, nullable: true }
        scoreDisplay: { type: string, description: "카드 점수 문자열(BR10.2). '<E>점 · <n>/<전체>'(E 확인된 점수, n 미확보가 아닌 항목 수, 전체 신규 8·재접촉 7; 예 '77점 · 7/8'), 판정 0개면 '--', 소개서 묶음이고 분류가 기다리는 중·준비 중이면 '참고 ' 접두(예 '참고 50점 · 3/8'), 소개서 묶음이 아닌데 그 분류면 '--'. 더하는 변경(값 형식만): 2026-10-21 PM '정수 / -- / 참고 N' → 2026-10-28 PM #180" }
        reason: { type: string }
        blocker: { type: object, properties: { text: { type: string }, blocksApproval: { type: boolean } } }
        nextAction: { type: string }
        records: { type: object, properties: { opinion: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { opinion: { type: string, nullable: true } } } ] }, bookmark: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { active: { type: boolean } } } ] } } }
        stage: { type: integer, minimum: 1, maximum: 6, nullable: true }
        isVirtual: { type: boolean }
        isRecontact: { type: boolean }
        recontact: { type: object, nullable: true, description: '재접촉 카드 전용(U6): pastTrade, reasonToRecontact, hasEstimated' }
        evalId: { type: string, description: 카드가 보여 주는 최신 확정 평가 ID }
        reevaluated: { type: boolean, description: '카드의 evalId(최신 확정 평가)가 순위를 정한 FULL 묶음의 평가와 다르면 true (기능 명세 W5; 2026-10-22 PM 확인, 이슈 #33)' }
    OpportunityDetail:
      type: object
      description: 근거 상세 S2. 영역별 구성 함수가 조립
      properties:
        header: { type: object, properties: { title: {}, relationStatus: {}, purpose: {}, owner: {}, isVirtual: {}, datasetKind: {}, isRecontact: {}, homepageUrl: { type: string, nullable: true, description: '근거 출처 주소의 공통 뿌리(scheme+host). 주소 있는 근거가 없으면 null. 더하는 변경 2026-10-27 PM, #176' }, mainPhone: { type: string, nullable: true, description: '(추가 2026-11-03 PM 지시) 회사 대표번호. 공개 홈페이지 본문(U2 근거 추출)이나 산단공 CSV(U3)에서 자동으로 채움, 사람 입력 칸 없음. 사람 이름이 붙은 번호(담당자 휴대폰)는 채우지 않음' }, mainPhoneSource: { type: string, nullable: true, enum: [HOMEPAGE, CSV] }, address: { type: string }, distanceKm: { type: number, nullable: true, description: '(추가 2026-11-03 PM 지시) 거산 기준 주소(설정 geosan.address, PM이 정함)에서의 직선거리 km. 거리 기능(#222) 전까지 null' }, summaryLine: { type: string, nullable: true, description: '(추가 2026-11-03 PM 지시) 회사 한 줄 소개. AI 조사(U2)가 공개 본문에서 생성. 조사 전에는 사례 파일 cardReason' }, highlights: { type: array, maxItems: 3, items: { type: string }, description: '주요 특징 최대 3개(품목·공정·규모·주요 고객 같은 공개 사실만). AI 조사 전에는 빈 배열' }, researchedAt: { type: string, format: date-time, nullable: true, description: '마지막 조사 시각(AI 조사 완료 시각, 사례 파일 투입분은 투입 시각)' }, researchSource: { type: string, nullable: true, enum: [AI, CASE_FILE] }, researchStale: { type: boolean, description: '설정 research.staleAfterDays(기본 90일)보다 오래됐으면 true → 화면 "오래됨" 표시' }, scoreDisplay: { type: string, description: '카드와 같은 문자열(OpportunityCard.scoreDisplay 참고), 2026-10-28 PM #180' } } }
        stage: { type: object, properties: { current: { type: integer }, badge: { type: string, nullable: true } } }
        reasons: { type: object, properties: { reason: { type: string }, nextAction: { type: string }, questions: { type: array, items: { $ref: '#/components/schemas/Question' } } } }
        requirements: { type: array, items: { $ref: '#/components/schemas/RequirementCheckView' } }
        approvalEligibility: { type: object, properties: { eligible: { type: boolean }, reason: { type: string }, readinessChecked: { type: boolean }, readinessNeedsRecheck: { type: boolean }, allowedPurposes: { type: array, items: { type: string } } } }
        processLinks: { type: array, items: { type: object, properties: { linkId: {}, processCode: {}, processName: {}, appliedMaterial: {}, result: {}, reason: {} } } }
        evidence: { type: array, items: { $ref: '#/components/schemas/EvidenceView' } }
        homepageNeedsConfirm: { type: boolean }
        scores: { type: object, description: '점수 키 E/P/S/R/C는 대문자 그대로(camelCase 변환 대상 아님; 2026-10-22 PM 확인, 이슈 #33)', properties: { E: { type: integer }, P: { type: integer }, S: { type: number, nullable: true }, R: { type: integer }, C: { type: number }, items: { type: array, items: { type: object, description: 'itemCode, label, state, weight, matchRate, certainty, decay, score, factJudged, summary(#139), evidenceIds: [string] (이 항목 판정에 쓴 evidence[].evidenceId, 정렬; 더하는 변경 2026-10-27 PM, #176)' } }, ruleVersion: { type: string }, datasetKind: { type: string }, evaluatedAt: { type: string } } }
        records: { type: object, properties: { opinion: { $ref: '#/components/schemas/RecordMeta' }, bookmark: { $ref: '#/components/schemas/RecordMeta' }, approval: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { status: { type: string }, purpose: { type: string, nullable: true }, evalId: { type: string }, basedOnPreviousEval: { type: boolean } } } ] }, outcome: { allOf: [ { $ref: '#/components/schemas/RecordMeta' }, { type: object, properties: { status: { type: string, nullable: true }, nextScheduleAt: { type: string, nullable: true } } } ] } } }
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
        linkedOppIds: { type: array, items: { type: string } }
        isUserAdded: { type: boolean }
    ActivityItem:
      type: object
      properties:
        at: { type: string, format: date-time }
        actor: { type: string, description: staffKey 또는 system }
        kind: { type: string, enum: [CLASSIFICATION, OPINION, BOOKMARK, APPROVAL, CONTACT_ATTEMPT, REPLY, OUTCOME, EVIDENCE_GRADE_CONFIRMED, NOTE] }   # (갱신 2026-11-03) NOTE 영업 메모 추가. BOOKMARK는 담기 제거로 안 씀(값은 남김)
        summary: { type: string }
        previousValue: { type: string, nullable: true }
        evalId: { type: string, nullable: true }
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
      summary: 담당자 목록(키·표시 이름)·브랜드·쉬운 말 코드표·접속 보호 여부 (U1)
      responses: { '200': { description: Envelope } }
  /opportunities:
    get:
      summary: 추천 목록 (U1 신규 탭; U6 재접촉 탭, U5 담기 토글, U7 검색·대시보드 필터는 필터 함수 등록으로 추가)
      parameters:
        - { name: tab, in: query, schema: { type: string, enum: [new, recontact], default: new } }
        - { name: q, in: query, schema: { type: string }, description: 고객명·기회명 부분 일치 (U7) }
        - { name: bookmarked, in: query, schema: { type: boolean } }   # (갱신 2026-11-03, PM 결정 Q2) 안 씀(담기 제거). 경로 호환을 위해 남김
        - { name: stage, in: query, schema: { type: string, enum: [NOT_EXECUTED, INTERESTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST] }, description: (추가 2026-11-03, Q2) 영업 단계(outcomeStatus 최신 값)로 거르기. 대시보드 건수를 누르면 이 조건으로 열림 (U5·U7) }
        - { name: filter, in: query, schema: { type: string, enum: [TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY] }, description: 대시보드 건수 조건 (U7) — (갱신 2026-11-03) 건수 재정의로 SCHEDULE_DUE만 씀, 나머지 값은 남기되 안 씀 }
        - { name: sort, in: query, schema: { type: string, enum: [rank, distance], default: rank }, description: (추가 2026-11-03 PM 결정, 거리 #222) distance = 거산 기준 주소에서 가까운 순. 점수·순위 계산은 바뀌지 않음 }
        - { name: maxDistanceKm, in: query, schema: { type: number }, description: (추가 2026-11-03 PM 결정, 거리 #222) 이 거리 안의 회사만. 선택지는 설정 distanceFilterPresetsKm(기본 30/50/100) }
        - { $ref: '#/components/parameters/page' }
        - { $ref: '#/components/parameters/pageSize' }
      responses: { '200': { description: 'Envelope(data: OpportunityCard[], meta.total)' } }
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
      summary: (추가 2026-11-03, PM 결정 U5 메모 4장) 영업 메모 저장 (U5). 덧붙이기만, 수정·삭제 없음(Q5). 담당자명·시각 자동. 저장 뒤 ActivityItem NOTE
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [text], properties: { text: { type: string, description: '상한은 설정 records.noteMaxLength(기본 200자)' } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + noteId)' }, '400': { description: '글자 수 초과 (fields). (변경 2026-11-03 PM 지시) 연락처 패턴은 거부하지 않는다 — 메모는 거산 담당자의 내부 메모장이라 상대 회사 담당자 전화·이메일을 적어도 된다. 대신 메모(NOTE)는 외부 AI·검색·엑셀·질문 목록 어디에도 나가지 않는다(C4)' }, '403': { description: 담당자 키 없음·보기 전용 } }
  /opportunities/{oppId}/bookmark:
    put:
      summary: 담기 켜고 끄기 (U5) — (갱신 2026-11-03, PM 결정 Q2) **안 씀.** 담기 대신 영업 단계 INTERESTED(관심)를 /outcomes로 기록. 경로는 지우지 않고 남김(깨는 변경 아님)
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [active], properties: { active: { type: boolean } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + active)' } }
  /opportunities/{oppId}/approvals:
    post:
      summary: 접촉 승인·거절·취소 (U5). 승인 가능 검사는 항상 최신 평가 기준 — (갱신 2026-11-03, PM 결정 Q1 B) 설정 `records.approvalEnabled: false`(기본)면 화면에서 숨김. 경로·테이블은 유지(거산이 원하면 설정만 켬)
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [decision, evalId], properties: { decision: { type: string, enum: [APPROVE, REJECT, CANCEL] }, purpose: { type: string }, reason: { type: string } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status·purpose)' }, '409': { description: 'evalId가 최신 확정 평가가 아님 (kind STALE_EVALUATION)' }, '422': { description: '승인할 수 없는 이유(message): 필수 요구 미통과, 관계·중복 미확인, 소개서 묶음, 목적 불가' } }
  /opportunities/{oppId}/outcomes:
    post:
      summary: 영업 결과(영업 단계)·접촉 시도·회신·다음 일정 (U5). LOST는 reason 필수. (갱신 2026-11-03, Q5) 단계·일정 변경은 새 행으로 남기고 이전 행은 이력(수정·삭제 경로 없음)
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [status], properties: { status: { type: string }, replyReceived: { type: boolean }, nextScheduleAt: { type: string, format: date }, nextScheduleNote: { type: string, description: '(추가 2026-11-03) 다음 일정 할 일 한 줄' }, reason: { type: string }, actionId: { type: string, nullable: true }, method: { type: string, enum: [CALL, EMAIL, VISIT], description: '(추가 2026-11-03) 접촉 방법, 접촉 시도 행에만' }, result: { type: string, enum: [REACHED, ABSENT, DECLINED], description: '(추가 2026-11-03) 접촉 결과' }, attemptedAt: { type: string, format: date, description: '(추가 2026-11-03) 접촉 시도 날짜' } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status)' }, '400': { description: 사유 필요 } }
  /opportunities/{oppId}/readiness-check:
    post:
      summary: 기한 내 대응 가능 체크 → 새 평가 (U5, 흐름 ③)
      requestBody: { content: { application/json: { schema: { type: object, required: [checked, evalId], properties: { checked: { type: boolean }, evalId: { type: string } } } } } }
      responses: { '200': { description: '새 평가 ID·분류 (meta.reevaluated=true)' }, '409': { description: 낡은 평가 기준 } }
  /opportunities/{oppId}/homepage:
    post:
      summary: 홈페이지 주소 확정 또는 본문 붙여넣기 → 근거 추출 → 재평가 (U2, 흐름 ①). 전체 60초 한도. (추가 2026-11-03 PM 지시) 상세 머리 [다시 조사] 단추도 이 경로(확정된 url 그대로)를 부른다 — 주기 자동 조사는 두지 않고 담당자가 누를 때만. 성공 시 header.summaryLine·highlights·mainPhone·researchedAt 갱신
      requestBody: { content: { application/json: { schema: { type: object, properties: { url: { type: string, format: uri }, pastedText: { type: string } } } } } }
      responses: { '200': { description: '근거 수·질문 수·새 평가 ID (meta.reevaluated)' }, '422': { description: 'kind ROBOTS_DISALLOW / TERMS_DISALLOW (붙여넣기 요청) 또는 UNREACHABLE (주소를 열 수 없음)' }, '503': { description: 'LLM 실패·상한 초과 (kind LLM_LIMIT) · 60초 초과' } }
  /opportunities/{oppId}/evaluations:
    get:
      summary: 현재·이전 평가 쌍 (U2 "이전 평가 보기")
      responses: { '200': { description: 'Envelope(current, previous)' } }
  /opportunities/{oppId}/activity:
    get:
      summary: 활동 이력 (U5)
      parameters: [ { name: limit, in: query, schema: { type: integer, default: 20, maximum: 100 } } ]
      responses: { '200': { description: 'Envelope(ActivityItem[])' } }
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
      summary: 회신 기록 (U4). 요청 → 회신. 거산 값은 바꾸지 않음
      requestBody: { content: { application/json: { schema: { type: object, required: [replyText, repliedAt], properties: { replyText: { type: string, maxLength: 500 }, repliedAt: { type: string, format: date } } } } } }
      responses: { '200': { description: 기록됨 } }
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
  /dashboard:
    get:
      summary: 대시보드 건수 5개·일정·최근 내 기록 (U7, 기록에만 기대는 최소형). **깨는 변경(2026-11-03, PM 확인): 계약 버전 v2로 올림.** 화면은 이 모양의 가짜 숫자(고정값 파일)로 먼저 만들고 집계 API 완성 뒤 갈아 끼움
      # ~~옛 모양(v1): Envelope(counts{TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY}, schedule[], pipeline, recentActivity[])~~ → 바뀐 뒤(v2) 아래. pipeline(업무 흐름 줄)은 뺌(메모 5장). 검색은 /opportunities?q= 그대로
      responses:
        '200':
          description: >-
            Envelope(
              counts{ NOT_CONTACTED: int, INTERESTED: int, IN_CONTACT: int, QUOTE_SAMPLE: int, SCHEDULE_DUE: int },   # 미접촉 / 관심 / 접촉 중 / 견적·샘플 / 이번 주 일정(오늘 이전~7일). 누르면 /opportunities?stage=… (SCHEDULE_DUE는 ?filter=SCHEDULE_DUE)
              schedule[ { oppId, customerName, oppTitle, dueAt: date, note: string, overdue: boolean, staffKey } ],   # 기한 지남(overdue) 맨 위, 그다음 날짜순. 출처: /outcomes의 nextScheduleAt·nextScheduleNote
              recentActivity[ { at: datetime, oppId, customerName, kind: enum[NOTE, STAGE, CONTACT_ATTEMPT, SCHEDULE, OPINION], summary: string } ],   # 최근 내가 한 기록 10건(요청의 담당자 키로 거름, Q4)
              asOf: datetime
            )
  /opportunities/{oppId}/homepage-candidates:
    get:
      summary: (추가 2026-11-03 정정, PM 결정 2) ② 네이버 검색 API로 회사명+주소 검색 결과를 **가공 없이 그대로** 돌려줌 (U2, C9 HomepageFinder.search_candidates). 화면은 "네이버 검색결과" 표시·원문 링크와 함께 보이고, 담당자가 고른 주소는 기존 POST /homepage(url)로 확정. 결과는 서버에 저장·캐시하지 않음
      responses: { '200': { description: 'Envelope(provider: NAVER, items[{ title, link, description }], total, fetchedAt)' }, '429': { description: '오늘 검색 한도 초과 (kind SEARCH_LIMIT)' }, '503': { description: '네이버 API 실패·10초 초과' } }
  /llm-usage:
    get:
      summary: (추가 2026-11-03, PM 결정 3) 이번 달 외부 AI 사용량·비용·상한 대비 비율 (U2). 공통 틀 상단 띠가 alertReached이면 "이번 달 AI 비용 절반 사용" 표시. webSearchCalls는 네이버 검색 호출 수(비용 없음)
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
```

경로 묶음과 단위: `/session`(U8), `/config/ui`·`/opportunities` 조회·`/opinions`(U1), `/bookmark`·`/approvals`·`/outcomes`·`/readiness-check`·`/activity`(U5), `/homepage`·`/evaluations`(U2), `/questions/*`(U4), `/recontact`(U6), `/dashboard*`·`/export/*`(U7). 파일은 `api/routes/opportunities.py`, `records.py`, `evidence.py`, `questions.py`, `recontact.py`, `dashboard.py`, `session.py`로 묶음별 분리(U1 확장 지점 규칙). 추가조사 기록(ResearchTask, P2) 경로는 기능 설계에서 정한다(5장).

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
    outside: [SourceIngestion 어댑터 읽기(파일·API, 재시도 1회)]
    then: [정규화·병합 후보, OpportunityRegistry 등록, IngestionRun 집계, run_evaluation(새 기회)]
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
  displayFlags: { coreEvidenceRecheck: boolean, brochureDataset: boolean }
  sortKey: { group: enum[URGENT, PLANNED, REVIEW, OTHER], validUntil, E, F, directConfirmedWeight, P, oppId }
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
      - 월 호출 상한 초과 → 거부 (kind LLM_LIMIT)
      - (추가 2026-11-03, PM 결정 3) 월 비용 상한(`llm.monthlyCostLimitUsd`) 초과 → 거부 (kind LLM_LIMIT). 비용 = TransferLog의 입력·출력 토큰 × 단가(`llm.inputCostPerMillionTokens`·`outputCostPerMillionTokens`), 월별 합산. **OpenAI 호출에만** 적용
    EXTERNAL_SEARCH:   # (추가 2026-11-03 정정, PM 결정 2) ② 홈페이지 찾기 — 네이버 검색 API로 나가는 검색어
      - 허용 kind: CUSTOMER_NAME, CUSTOMER_ADDRESS (둘 다 산단공 공개 CSV 출처, securityGrade PUBLIC)만. 그 밖의 kind(NOTE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION, CAPABILITY_VALUE, 연락처)가 하나라도 → 전체 거부
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - 하루 호출 상한(`naverSearch.dailyCallLimit`) 초과 → 거부 (kind SEARCH_LIMIT, 쉬운 말 "오늘 검색 한도 초과"). 네이버 자체 한도는 하루 25,000회
      - sideEffect: TransferLog 1행(kind WEB_SEARCH, 시각·기회 ID·호출 수만, 검색어 본문 없음). 검색 결과는 저장·캐시하지 않는다(네이버 검색 API 특약 2.3)
    EXTERNAL_GEOCODE:   # (추가 2026-11-03 PM 결정, 거리 #222) 회사 주소 → 좌표 변환. 행정안전부 도로명주소 API(검색 → 좌표제공, 승인키 2개)
      - 허용 kind: CUSTOMER_ADDRESS(산단공 공개 CSV 출처, securityGrade PUBLIC)만. 회사명·메모·내부 값·연락처가 섞이면 전체 거부
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - 하루 호출 상한(`geocoding.dailyCallLimit`) 초과 → 거부 (kind GEOCODE_LIMIT, 쉬운 말 "오늘 좌표 변환 한도 초과")
      - sideEffect: TransferLog 1행(kind GEOCODE, 시각·고객 ID·호출 수·성공 여부만, 주소 본문 없음). 받은 좌표는 opp_customer에 저장(약관상 저장 금지 문구 없음, 신청서 용도란에 저장 용도 명시)
    OUTPUT_EXPORT:   # 질문 목록(거산에 보내는 것)·엑셀(내부용)
      - securityGrade = FORBIDDEN 또는 UNKNOWN → 전체 거부
      - kind 없음 → 전체 거부
      - 허용 kind: PUBLIC_TEXT, EVIDENCE, OPPORTUNITY_INFO, QUESTION, CAPABILITY_VALUE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION (내부용 출력이므로 허용하되 파일에 "내부용·고객 제출용 아님"과 가상 표시를 넣는다)
      - (추가 2026-11-03 PM 지시) kind NOTE(영업 메모)와 회사 대표번호(mainPhone)는 엑셀·질문 목록에 넣지 않는다. 남은 자유 문장에는 scrub_contacts를 적용한다(연락처는 파일로 나가지 않음)
      - 예외: 출력물이 외부 제출용으로 표시된 경우(이번 범위 없음)는 INTERNAL_ONLY 이상을 거부
  output: { allowed: boolean, rejectedItems: [{ refId, reason }], logId: string }
  noPartialSend: allowed=false면 호출자는 아무것도 보내지 않는다(걸러서 다시 보내지 않음)
  sideEffect: TransferLog 1행 (본문 없음, 트랜잭션 밖). LLM 재시도는 호출마다 1행
exportColumnKinds:          # 내보내기 항목에 붙는 kind (호출자가 임의로 적지 않고 소유 부품 속성에서 유도)
  questionList: { 질문 문장: QUESTION, 대상·현재 값: CAPABILITY_VALUE, 기회 이름: OPPORTUNITY_INFO }
  xlsx: { 후보·분류·점수: OPPORTUNITY_INFO, 근거 인용: EVIDENCE(각자 securityGrade), 의견·승인·결과: INTERNAL_HISTORY, 재접촉 행: RECONTACT_INPUT, 거래처 관계: CUSTOMER_RELATION }
scrub_contacts:
  input: { text: string }
  output: { text: string, removedCount: int }     # 이메일·전화번호 패턴 제거. 홈페이지 본문·파일 투입 자유 문장 모두에 적용
usage:
  input: { period: enum[MONTH, WEEK], from?: date }
  output: { callCount: int, tokenCount: int, rejectedCount: int, inputTokens: int, outputTokens: int, webSearchCalls: int, costUsd: number, costLimitUsd: number, callLimit: int, alertReached: boolean }   # (추가 2026-11-03) inputTokens 이후 칸. alertReached = costUsd ≥ costLimitUsd × llm.costAlertRatio
```

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
```

### C6. 공유 데이터 (SQLite 하나, 테이블 접두사로 소유)

```yaml
# shared-schema: 테이블 소유와 교차 참조 규칙 (ADR-011). 세부 열은 기능 설계 데이터 사전에서.
ownership:
  cfg_*:   ConfigRegistry        # cfg_rule_config_version, cfg_app_setting
  cap_*:   CapabilityCatalog     # cap_process, cap_process_capability, cap_delivery_record, cap_qualification, cap_qualification_scope, cap_qualification_status, cap_field_evidence
  opp_*:   OpportunityRegistry   # opp_customer, opp_merge_candidate, opp_interaction, opp_opportunity, opp_discovery_path, opp_process_link, opp_requirement, opp_signal
  src_*:   SourceIngestion       # src_ingestion_run, src_source_contract
  tg_*:    TransferGuard         # tg_transfer_log
  ev_*:    EvidenceExtraction    # ev_evidence, ev_homepage_candidate
  eval_*:  EvaluationLedger      # eval_batch, eval_run, eval_item_judgment, eval_requirement_check, eval_judgment_evidence, eval_readiness_check, eval_rank_adjustment
  q_*:     ConfirmationDesk      # q_question, q_question_opportunity_link, q_research_task
  rec_*:   SalesRecords          # rec_review_opinion, rec_bookmark, rec_action, rec_outcome, rec_note(추가 2026-11-03: oppId, staffKey, text, createdAt — 덮어쓰기 없음, 메모마다 새 행). rec_bookmark는 담기 제거로 안 만듦(Q2). 단계·일정(rec_outcome)도 새 행 원칙(Q5): 이전 행은 이력
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

**재투입 규칙**: 식별 키는 CaseFile `caseId`, Process `code`, Qualification `officialName + number`, Customer `bizNumber`(없으면 정규화 상호명+주소). 같은 키를 다시 넣으면 **값은 덮어쓰되 이력(FieldEvidence·QualificationStatus·평가)은 보존**하고, **이미 `REVIEWED`(검수 완료)인 값은 파일의 `PENDING`으로 되돌리지 않는다**(파일 값이 다르면 경고 줄을 내고 기존 검수 상태 유지; 되돌리려면 `geosan review-set … RECHECK`). 투입 뒤 평가는 자동으로 돌지 않고 `geosan evaluate`로 한다(안내서에 명시).

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
  customer: { name, bizNumber|null, address, identityBasis, relationStatus, relationConfirmedAt, securityGrade, mainPhone|null, mainPhoneSource: enum[HOMEPAGE, CSV]|null, summaryLine|null, highlights: json|null, researchedAt|null, researchSource: enum[AI, CASE_FILE]|null, lat|null, lng|null, geocodedAt|null, geocodeSource: enum[JUSO, CSV, MANUAL]|null }   # lat·lng·geocodedAt·geocodeSource는 추가 2026-11-03(PM 결정, 거리 #222, 더하는 마이그레이션). mainPhone·mainPhoneSource·summaryLine·highlights·researchedAt·researchSource는 추가 2026-11-03(PM 지시, 상세 머리 기업 요약·다시 조사): 회사 대표번호만, 개인 연락처 열은 여전히 없음(opp_customer 더하는 마이그레이션)
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
  llm: { mode: enum[EXTERNAL, NONE], model: string, monthlyCallLimit: int, costPerThousandTokens: number }
  # (추가 2026-11-03, PM 결정 3 — 결정값: provider OPENAI, model gpt-6.1-sol, allowedModels [gpt-6.1-sol, gpt-6-luna], monthlyCallLimit 1000, 입력 $2 / 출력 $10 per 1M, monthlyCostLimitUsd 20, costAlertRatio 0.5. OpenAI는 근거 추출(③④)에만)
  #   llm에 더하는 키: provider: enum[OPENAI], allowedModels: [string] (model은 이 안이어야 check-config 통과), inputCostPerMillionTokens: number, outputCostPerMillionTokens: number,
  #   monthlyCostLimitUsd: number, costAlertRatio: number(0~1). costPerThousandTokens는 안 씀(deprecated), 다음 깨는 변경 때 제거.
  #   예시 파일(examples/app-settings.yaml)의 새 키는 모르는 키 거부 규칙 때문에 U2 코드 PR(LlmSettings)과 같이 넣는다. 키는 환경 변수 OPENAI_API_KEY로만.
  naverSearch: { enabled: boolean, dailyCallLimit: int, display: int }   # (추가 2026-11-03 정정, PM 결정 2) ② 홈페이지 찾기용 네이버 검색 API(웹 문서). 키는 환경 변수 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET로만. dailyCallLimit 기본 500(네이버 한도 25,000), display 기본 5(한 번에 보여 줄 결과 수)
  homepageDiscovery: { enabled: false, termsConfirmed: false }
  # (추가 2026-11-03, PM 결정 2 정정) ② 홈페이지 찾기는 네이버 검색 API가 먼저 찾아 **결과를 네이버가 준 모양 그대로 "네이버 검색결과"로 보여 주고**, 담당자가 눌러 확정한 주소 하나만 저장한다(C9 HomepageFinder). 검색 결과 목록은 저장·캐시하지 않는다(네이버 검색 API 특약 2026-09-07: 결과 저장·가공·AI 입력 금지).
  #   U2 PR에서 enabled: true로, termsConfirmed는 PM이 네이버 API 허브 신청 때 이 쓰임새(결과 표시 + 담당자 확정)로 확인한 뒤 true.
  records: { approvalEnabled: boolean, noteMaxLength: int }   # (추가 2026-11-03, PM 결정 Q1·U5) approvalEnabled 기본 false = 접촉 승인을 화면에서 숨김(경로·테이블은 유지). noteMaxLength 기본 200 = 영업 메모 글자 상한. 첫 화면은 대시보드로 고정(Q3 A)이라 ui.homeScreen 키는 두지 않음
  research: { staleAfterDays: 90 }
  geosan: { address: string, lat: number, lng: number }   # (추가 2026-11-03 PM 결정, 거리 #222) 거산 기준 주소와 좌표. PM이 한 번 적음(좌표는 지도에서 읽어 넣음). 거리는 모두 이 점에서 잰다
  geocoding: { provider: JUSO, enabled: boolean, dailyCallLimit: int }   # (추가 2026-11-03 PM 결정) 행정안전부 도로명주소 API. 키는 환경 변수 JUSO_SEARCH_KEY·JUSO_COORD_KEY. 기본 enabled false(키 받기 전)
  distanceFilterPresetsKm: [30, 50, 100]   # (추가 2026-11-03 PM 결정) 목록 거리 필터 선택지   # (추가 2026-11-03 PM 지시) 마지막 조사가 이 일수보다 오래되면 상세 머리에 "오래됨" 표시
  brand: { logoUrl, brandName, colorPrimary, demoLabel: string | null }   # demoLabel: (갱신 제안 2026-10-21, 기능 설계 Q7 답 확정 후 적용) 띠에 함께 보이는 문구, 예: "부분 시연·거산 확인 전"
  accessProtection: { enabled: boolean }      # 비밀번호 자체는 환경 변수 GEOSAN_PASSWORD
```

### C8. 운영 명령 (명령줄, 운영 안내서의 기준)

```yaml
# shared-schema: OperatorCommands 명령 계약. 이름은 제안. 모든 명령은 끝에 쉬운 한국어 요약 한 줄과 종료 코드(0 성공, 1 입력 오류, 2 실행 실패)를 낸다. --help는 한국어.
commands:
  geosan init-db                                 # U1. 데이터베이스 만들기·마이그레이션 적용(처음·갱신 모두)
  geosan serve [--port N]                        # U1. 서버 실행(API + 화면)
  geosan check-config [rule-config.yaml] [app-settings.yaml]   # U1. 설정 파일 형식 검사(오류는 C7 형식: 줄·항목·이유)
  geosan import-capability <file.json>           # U1. 형식·연락처 검사 → 저장(재투입 규칙 적용)
  geosan import-case <file.json>                 # U1. 가상 사례 묶음 투입(투입 순서 자동). 실제 기업도 같은 형식(isVirtual: false)
  geosan check-case <file.json>                  # U1. (갱신 제안 2026-10-21, 기능 설계 Q8 답 확정 후 적용) 저장 없이 형식·허용 값·연락처 패턴만 검사. DB 없이 팀원 컴퓨터에서 실행. (PM 지시 2026-10-21) 코드 생성 Part A-2(Step 11)에서 먼저 연결해 팀원이 10/22부터 쓴다
  geosan evaluate [--opp <id>...] [--base-date YYYY-MM-DD]   # U1. 흐름 ⓪. 출력: 묶음 ID, 기회 수, 분류 요약
  geosan verify-case <file.json>                 # U1. 평가 뒤 expected와 비교. 출력: 항목별 일치/불일치 표
  geosan export-contracts                        # U1. contracts/openapi.json·*.schema.json 생성(사람이 명시적으로만 실행)
  geosan demo-report --capability <file.json> --cases <dir> --out <dir> [--base-date YYYY-MM-DD]   # U1 예비 경로(PM 승인 2026-10-21, 10/29 부분 시연 대비). DB·API·화면 없이 역량 파일 + 사례 파일 폴더를 읽어 규칙 엔진으로 평가하고 순위표(CSV + 인쇄용 HTML), 기업별 근거(md), 기업별 사실표(md, 메모 재료)를 <out>에 쓴다. 저장하지 않는다. 모든 출력 머리에 "시연용 초안·거산 확인 전". 소개서 묶음이면 참고 점수·접촉 후보 없음(BR5.6). 연락처 패턴이 있으면 쓰지 않고 실패(종료 코드 1)
  geosan ingest <sourceId> [--max N]             # U3·U9. 흐름 ⑥
  geosan merge-list                              # U3. 확인 필요 후보 목록
  geosan merge-confirm <candidateId> --keep <customerId>   # U3. 흐름 ⑤
  geosan review-set <targetKind> <targetId> <REVIEWED|RECHECK> --by <name> --basis <text>   # U4. 흐름 ② — (갱신 2026-11-03, PM 결정 Q8·Q9·Q10) U4 중 이 명령만 먼저, U2 줄 첫 작업(유동렬, 12h). 방문 확인된 공정만 REVIEWED로 바꾸고 18곳 재평가(방문 확인 기록은 PM이 채우면 실행)
  geosan dataset-set <datasetKind>               # U4. 거산 값 묶음 전환(설정 변경 + 재평가 안내)
  geosan backup [--to <dir>]                     # U8 최소형 → U10. SQLite 온라인 백업(VACUUM INTO, 서버가 켜져 있어도 일관된 사본, WAL 포함). (갱신 2026-11-03, Q10) 담당 PM(최지예), U8에 묶음, 10h
  geosan restore <backup-file>                   # U8 최소형 → U10. 서버가 멈춘 상태에서만 허용(켜져 있으면 거부), 복원 전 현재 DB를 자동으로 따로 보관, 확인 질문 1회. (갱신 2026-11-03, Q10) 담당 PM, U8에 묶음
  geosan geocode [--missing-only]                # (추가 2026-11-03 PM 결정, 거리 #222) 좌표 없는 회사 주소를 도로명주소 API로 좌표로 바꿔 저장. 건수·실패 사유(주소 못 찾음·한도·통신)를 출력. 가상 사례는 건너뜀
  geosan db merge-heads                          # U1. 마이그레이션 머리가 둘일 때 합치기
  geosan cost [--month YYYY-MM]                  # U10. TransferGuard 집계 × 단가. (추가 2026-11-03) U2로 앞당김: OpenAI 호출 수·입력/출력 토큰·비용·상한($20, 1,000회) 대비 비율을 내고 50% 넘으면 "알림" 줄. 네이버 검색 호출 수는 건수만(비용 없음). 5곳 시험의 1곳당 비용 측정에 쓴다
guideTasks:   # 운영 안내서 작업별 명령 수(3개 이내, US9.4)
  처음 설치·실행: [init-db, check-config, serve]                     # 3
  가상 사례 투입·평가·확인: [import-case, evaluate, verify-case]     # 3
  거산 값 투입: [import-capability, evaluate]                         # 2
  후보 수집: [ingest, merge-list / merge-confirm]                     # 2~3
  검수 상태 전환: [review-set, evaluate(자동 포함)]                   # 1~2
  거산 값 묶음 전환: [dataset-set, evaluate]                          # 2
  백업·복원: [backup] / [restore, serve]                              # 1 / 2
  비용 확인: [cost]                                                   # 1
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
  log: TransferLog (시각·모드·모델·등급·토큰 수, 본문 없음)
  provider: enum[OPENAI]                  # (추가 2026-11-03, PM 결정 3) 설정 llm.provider. 모델은 llm.model(gpt-6.1-sol, 비교용 gpt-6-luna)
  retention:                              # (추가 2026-11-03) 보관 규칙. 한 번 보내고 끝나는 호출만 쓴다. 대화·파일이 제공사 서버에 남는 기능(파일 업로드·대화 보관형 엔드포인트)은 쓰지 않는다. 데이터 공유(학습 제공) 동의는 켜지 않는다. 로그에는 시각·모드·모델·등급·입력/출력 토큰 수·비용만(본문 없음)
  usageGuard: 호출 전 C4 월 호출 상한·월 비용 상한을 함께 검사. 초과면 호출하지 않고 503 LLM_LIMIT
HomepageFinder:                           # (추가 2026-11-03, PM 결정 2 정정 2차) ② 홈페이지 찾기 = 네이버 검색 API(웹 문서)가 찾고 담당자가 확정. C9 열린 질문 "검색 방식·비용·약관"의 답
  search_candidates(companyName, address) -> { provider: NAVER, items: [{ title, link, description }], total, fetchedAt }   # 네이버 응답 항목을 가공·재정렬 없이 그대로. 화면은 "네이버 검색결과" 표시와 원문 링크를 함께 보인다(특약 2.1·2.2)
  # (추가 2026-11-03 PM 지시) LlmAdapter 근거 추출 결과에 companySummary: { line: string, highlights: [string ≤3] }, companyMainPhone: string|null 을 더한다. 공개 본문의 사실만, 담당자 개인 연락처는 뽑지 않는다
  confirm(oppId, url, confirmedBy) -> 저장되는 것은 담당자가 확정한 url 하나와 확정자·시각뿐. 검색 결과 목록(items)은 저장·캐시하지 않는다(특약 2.3). 확정 뒤 기존 흐름 ①(C1 POST /homepage) 호출
  query: 회사명 + 주소(둘 다 공개 CSV 출처). TransferGuard EXTERNAL_SEARCH 통과 뒤에만 호출(C4). 검색어에 메모·내부 값·연락처가 섞이면 호출 안 함
  keys: 환경 변수 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET (설정 파일·코드·로그에 적지 않음)
  limits: 네이버 하루 25,000회 안에서 naverSearch.dailyCallLimit(기본 500). timeout 10s, retry 1 (TransferLog 호출마다 1행, kind WEB_SEARCH, 검색어 본문 없음)
  cost: 무료. 월 $20 비용 상한은 OpenAI(근거 추출)에만 적용
  terms: 네이버 검색 API 특약(2026-09-07 시행) — 결과는 네이버 검색결과로만 제공·가공 금지·저장/캐시 금지·AI 입력 금지. 이 설계는 "결과 그대로 표시 + 사람이 확정한 주소만 저장"으로 그 안에 둔다. API 허브 신청 때 PM이 이 쓰임새를 적어 확인(homepageDiscovery.termsConfirmed)
GeocodeAdapter:                           # (추가 2026-11-03 PM 결정, 거리 #222) 주소 → 좌표. 도로명주소 API 2단계: 검색(주소 글자 → 행정구역·도로명·건물번호 코드) → 좌표제공(코드 → entX/entY)
  geocode(address) -> { lat, lng, source: JUSO, matchedAddress } | null   # 못 찾으면 null(오류 아님). TransferGuard EXTERNAL_GEOCODE 통과 뒤에만 호출
  keys: 환경 변수 JUSO_SEARCH_KEY·JUSO_COORD_KEY (승인키가 서로 달라 바꿔 쓰면 거부됨). 설정 파일·코드·로그에 적지 않음
  limits: geocoding.dailyCallLimit. timeout 10s, retry 1. 좌표계 변환(entX/entY → 위경도)은 공식을 코드로 둠(패키지 추가 없음, 직선거리 용도라 수십 m 오차 허용)
  distance: 두 위경도 사이 직선거리(구면 공식) km 소수 1자리. 점수·순위에는 쓰지 않는다
HomepageReader:
  fetch(url) -> { allowed: boolean, reason: enum[OK, ROBOTS_DISALLOW, TERMS_DISALLOW, UNREACHABLE], text|null }
  timeout: 20s, retry: 1 (전체 60초 한도 안)
ExternalSourceApi (공장등록·나라장터):
  timeout: 30s, retry: 1, dailyLimitGuard: 1000 (공장등록)
  contractRow: SourceContract 필수
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
| C9 | 홈페이지 자동 탐색의 검색 방식·비용·약관 → **답(2026-11-03, PM 결정 2 정정 2차)**: 네이버 검색 API(웹 문서)가 찾고 **결과는 네이버 검색결과로 그대로 보여 주며, 담당자가 확정한 주소 하나만 저장**(결과 목록 저장·가공·AI 입력 없음 — 2026-09-07 특약 2.1~2.3 안). 무료, 하루 25,000회 한도 안에서 호출 상한만 둠. 구글 Custom Search는 신규 중단. U9가 아니라 **U2에서 함께** 구현(C9 HomepageFinder). 네이버 API 허브 신청 때 PM이 쓰임새를 적어 확인 | ~~U9~~ → U2 |
| C4·C7·C9 | (2026-11-03, PM 결정 3) 외부 AI 제공사 OpenAI(근거 추출 ③④에만), 모델 gpt-6.1-sol(비교용 gpt-6-luna), 단가 입력 $2/출력 $10 per 1M, 월 비용 상한 $20(50% 알림, OpenAI에만), 월 호출 상한 1,000회. 네이버 검색 API(② 홈페이지 찾기)는 하루 호출 상한만. 키 2개(NAVER_CLIENT_ID·NAVER_CLIENT_SECRET, OPENAI_API_KEY)는 환경 변수. 설정 키 추가·C4 비용 상한 거부·EXTERNAL_SEARCH 용도·C1 `/llm-usage`·`/homepage-candidates`·C9 provider/retention/HomepageFinder. 모두 더하는 변경. 제안서 `../delivery-planning/llm-settings-proposal-20261103.md` | U2 (코드 PR에서 LlmSettings·예시 파일·.env.example 같이) |
| C0·C1·C4·C6·C7·C8·C9 | (2026-11-03, PM 결정 거리·지도) 거리 필터·정렬(`sort`·`maxDistanceKm`·카드 `distanceKm`), 용도 EXTERNAL_GEOCODE, 고객 좌표 열 4개, 설정 `geosan`·`geocoding`·`distanceFilterPresetsKm`, 명령 `geocode`, GeocodeAdapter. 지도 링크 2개는 화면이 주소로 만들어 약속 변경 없음(#210). 코드는 1차 전달 뒤 #222에서. 기준 주소(본사/제1공장)는 PM이 설정값으로 정함 | #222 (11/17 주, 코드 PR과 같이) |
| C3·C7·C8 | (2026-10-21 부분 시연 변경) `baseDate` 키(Q4), BROCHURE OTHER 정렬(Q6, 가설·설정값), `brand.demoLabel`(Q7), `check-case` 명령(Q8) — 기능 설계 Q 답으로 확정. 모두 "더하는 변경"(C3 정렬은 팀이 더한 규칙의 변경, 기획서 규칙 아님) | U1 (기능 설계, 10/21) |

## 6. 전달 계획·뒤 단계로 넘기는 것

- (사용자 보호 장치 ③) 서버가 만든 OpenAPI와 `contracts/openapi.json`, 검사기 스키마와 `contracts/*.schema.json` 네 개를 비교하는 검사를 기존 CI 자동 검사에 한 단계로 붙인다. 만드는 시점은 전달 계획에서 정한다(U1 뒤, U2~U5 동시 진행 전이 자연스러움). C6 테이블·C8 명령은 자동 비교 없이 PR 체크리스트로만 보호한다.
- (사용자 보호 장치 ④) PR 체크리스트(PR 템플릿)에 "약속 파일을 바꿨나요?" 한 줄을 넣고, 바꿨으면 PM 확인 후 합친다. 템플릿 파일은 U1 코드 생성에서 만든다.
- 후속 확장 메모(범위 밖): 엑셀로 입력받아 JSON으로 바꾸는 변환 기능. 거산 담당자가 엑셀을 선호하면 12/11 이후 검토.
- 요구사항 갱신 필요: 없음(계약은 요구사항을 그대로 옮김). 응답 시간은 성능 목표 3초(NFR2)와 요청 중단 한도 10초(상호작용 명세)를 구분해 적었다.

## 7. 검토(review-01) 반영 요약

High 3건(출력 검사의 용도 구분과 거부 응답, 담당자 키 헤더, 동시 수정 버전·낡은 평가 처리), Medium 12건(오류 분기·칸별 오류, 세션 보안·429·잔여 위험, 순위 함수, 코드표·변환 규칙, 마이그레이션 규칙, 투입 파일 설명·줄 번호·모르는 키·연락처 검사, 재투입 규칙, 명령 보강, 온라인 백업, 약속 파일 명시적 갱신, `/homepage` 60초 한도와 재시도 집계, 응답 조립 등록 방식), Low 3건(3초/10초 구분, CLAUDE.md 문구, Question·ActivityItem·상태 코드 보강)을 모두 반영했다. 제안대로 LLM 어댑터는 허용 항목 ID만 받아 본문을 직접 조회하고, 쓰지 않는 입력(profileOverride)은 뺐다.

## 8. CLAUDE.md에 추가한 규칙 (사용자 보호 장치 ②)

`.claude/CLAUDE.md`에 "약속(계약) 파일 규칙" 절을 추가했다: 약속 파일(`contracts/` 폴더와 이 문서)에 없는 경로·필드·명령·테이블·파일 항목을 만들지 말고 먼저 물어볼 것, 더하는 것도 약속 파일에 먼저 적고 PR에 표시한 뒤 코드를 만들 것, 약속 파일은 PM 확인 없이 고치지 말 것. `contracts/`는 U1에서 생성된다.
