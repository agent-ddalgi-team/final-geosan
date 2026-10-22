# 계약 요약 (Contract Summary) — 거산케미칼 AI 영업지원 에이전트 2차

이 문서는 작업 단위(`../units-generation/unit-of-work.md`)와 의존 그래프(`../units-generation/unit-of-work-dependency.md`)의 경계마다 "무엇이 어떤 모양으로 건너고 잘못되면 어떻게 되는가"를 적은 약속(계약)입니다. 부품과 엔티티 이름은 도메인 설계(`../domain-design/components.md`)를, 성능·오류 규칙은 요구사항(NFR2·NFR7·NFR10, FR7.6)을 따릅니다. 확인된 답변은 `contract-design-questions.md` Q1~Q4입니다. 시스템은 한 덩어리(FastAPI + React 정적 파일 + SQLite)라 **밖에 공개하는 API는 없습니다**. 외부 LLM·외부 소스 API는 우리가 쓰는 쪽이므로 어댑터 계약(C9)으로만 다룹니다.

필드 이름·경로·명령 이름은 **제안**이며 기능 설계와 코드 생성에서 그대로 쓰거나 같은 뜻으로 고칩니다. 깨는 변경은 2장 규칙을 따릅니다. 검토(review-01)의 소견 18건을 반영한 판입니다.

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
interactionKind: [TRADE, QUOTE, CONSULT, PROPOSAL, MEMO]            # 재접촉 입력(C1 /recontact)은 MEMO 제외
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
outcomeStatus: [NOT_EXECUTED, IN_PROGRESS, SAMPLE_OR_REGISTRATION_APPROVED, ON_HOLD, WON, LOST]
questionStatus: [WAITING, REQUESTED, REPLIED, APPLIED]
questionTargetKind: [QUALIFICATION, PROCESS, CAPABILITY, FIELD, REQUIREMENT, OPPORTUNITY]
transferPurpose: [EXTERNAL_AI, OUTPUT_EXPORT]
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
        classificationCode: { type: string }
        coreEvidenceRecheck: { type: boolean }
        scoreS: { type: number, nullable: true }
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
        header: { type: object, properties: { title: {}, relationStatus: {}, purpose: {}, owner: {}, isVirtual: {}, datasetKind: {}, isRecontact: {} } }
        stage: { type: object, properties: { current: { type: integer }, badge: { type: string, nullable: true } } }
        reasons: { type: object, properties: { reason: { type: string }, nextAction: { type: string }, questions: { type: array, items: { $ref: '#/components/schemas/Question' } } } }
        requirements: { type: array, items: { $ref: '#/components/schemas/RequirementCheckView' } }
        approvalEligibility: { type: object, properties: { eligible: { type: boolean }, reason: { type: string }, readinessChecked: { type: boolean }, readinessNeedsRecheck: { type: boolean }, allowedPurposes: { type: array, items: { type: string } } } }
        processLinks: { type: array, items: { type: object, properties: { linkId: {}, processCode: {}, processName: {}, appliedMaterial: {}, result: {}, reason: {} } } }
        evidence: { type: array, items: { $ref: '#/components/schemas/EvidenceView' } }
        homepageNeedsConfirm: { type: boolean }
        scores: { type: object, description: '점수 키 E/P/S/R/C는 대문자 그대로(camelCase 변환 대상 아님; 2026-10-22 PM 확인, 이슈 #33)', properties: { E: { type: integer }, P: { type: integer }, S: { type: number, nullable: true }, R: { type: integer }, C: { type: number }, items: { type: array, items: { type: object } }, ruleVersion: { type: string }, datasetKind: { type: string }, evaluatedAt: { type: string } } }
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
        kind: { type: string, enum: [CLASSIFICATION, OPINION, BOOKMARK, APPROVAL, CONTACT_ATTEMPT, REPLY, OUTCOME, EVIDENCE_GRADE_CONFIRMED] }
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
        - { name: bookmarked, in: query, schema: { type: boolean } }
        - { name: filter, in: query, schema: { type: string, enum: [TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY] }, description: 대시보드 건수 조건 (U7) }
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
  /opportunities/{oppId}/bookmark:
    put:
      summary: 담기 켜고 끄기 (U5)
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [active], properties: { active: { type: boolean } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + active)' } }
  /opportunities/{oppId}/approvals:
    post:
      summary: 접촉 승인·거절·취소 (U5). 승인 가능 검사는 항상 최신 평가 기준
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [decision, evalId], properties: { decision: { type: string, enum: [APPROVE, REJECT, CANCEL] }, purpose: { type: string }, reason: { type: string } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status·purpose)' }, '409': { description: 'evalId가 최신 확정 평가가 아님 (kind STALE_EVALUATION)' }, '422': { description: '승인할 수 없는 이유(message): 필수 요구 미통과, 관계·중복 미확인, 소개서 묶음, 목적 불가' } }
  /opportunities/{oppId}/outcomes:
    post:
      summary: 영업 결과·접촉 시도·회신·다음 일정 (U5). LOST는 reason 필수
      requestBody: { content: { application/json: { schema: { allOf: [ { $ref: '#/components/schemas/RecordRequest' }, { type: object, required: [status], properties: { status: { type: string }, replyReceived: { type: boolean }, nextScheduleAt: { type: string, format: date }, reason: { type: string }, actionId: { type: string, nullable: true } } } ] } } } }
      responses: { '200': { description: '저장됨 (RecordMeta + status)' }, '400': { description: 사유 필요 } }
  /opportunities/{oppId}/readiness-check:
    post:
      summary: 기한 내 대응 가능 체크 → 새 평가 (U5, 흐름 ③)
      requestBody: { content: { application/json: { schema: { type: object, required: [checked, evalId], properties: { checked: { type: boolean }, evalId: { type: string } } } } } }
      responses: { '200': { description: '새 평가 ID·분류 (meta.reevaluated=true)' }, '409': { description: 낡은 평가 기준 } }
  /opportunities/{oppId}/homepage:
    post:
      summary: 홈페이지 주소 확정 또는 본문 붙여넣기 → 근거 추출 → 재평가 (U2, 흐름 ①). 전체 60초 한도
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
      summary: 재접촉 7칸 저장 → 평가 (U6, 흐름 ④). 이력 없음이면 meta.evaluatedAsNew=true
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
      summary: 대시보드 건수 4개·일정·업무 흐름·최근 활동 (U7)
      responses: { '200': { description: 'Envelope(counts{TO_REVIEW, APPROVAL_PENDING, SCHEDULE_DUE, WAITING_COMPANY}, schedule[], pipeline, recentActivity[])' } }
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
  run_recontact_save:        # ④ 재접촉 저장 (U6)
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
  opportunity: { oppId, customerId, relationStatus, purpose, companyFilterStatus, hasLinkedInteraction: boolean, linkedInteractionKinds: [interactionKind] }
  processLinks: [{ linkId, processId, appliedMaterial }]
  requirements: [{ reqId, linkId|null, reqKind, name, content, reqLevel, scopeKind, neededStage, dueAt, certainty, requiredValue, unit, edition, holder|null, site|null }]
  signals: [{ signalId, signalKind, occurredAt, announcedAt, scheduledAt, deadlineAt, progressStatus, agreedWindow, certainty, evidenceIds }]
  interactions: [{ interactionId, kind, occurredAt, linkedToOpportunity, pastProcessItem, orderCount, sampleApproved, requirementMet, lossReason, lossResolved, lastDeliveryAt, orderCycle, certainty }]
  evidence: [{ evidenceId, sourceGrade, certainty, isLlmProposed, subject, occurredAt, securityGrade }]   # 처리 금지·철회 자료는 Ledger가 미리 제외
  capability:
    processes: [{ processId, code, materialCodes, performanceTags, reviewStatus, datasetKind }]
    capabilities: [{ capabilityId, processId, capKind, numericMin, numericMax, unit, isDescriptiveOnly, reviewStatus }]
    deliveryRecords: [{ recordId, processId, industry, partType, reviewStatus }]
    qualifications: [{ qualId, kind, officialName, number, edition, holder, site, validFrom, validTo, reviewStatus, currentStatus }]
    qualificationScopes: [{ scopeId, qualId, scopeKind, processId, customerId, oppId, applicability, reviewStatus }]
  readinessCheck: { checked: boolean, checkedAt, evalIdAtCheck|null } | null
  researchReadiness: { hasGradedEvidence, hasQuestionSet, hasChannelAndOwner, questionCanChangeClass, estimatedHours, maxHours } | null
  operationalReady: boolean            # 모든 거산 값 검수 완료 + 근거 사용 허용 (Ledger가 계산해 넘김)
EvaluationOutput:
  requirementChecks: [{ reqId, result: checkResult, displayResult: checkDisplay, stageJudged, scopeJudged, reason, comparedValue, qualId|null, linkId|null, followUpCondition }]
  filterState: filterState
  exclusionScope: enum[COMPANY, OPPORTUNITY, LINK] | null
  processLinkResults: [{ linkId, result: filterState, reason }]
  items: [{ itemCode, state: itemState, weight, matchRate, certainty, decay, score: int|null, factJudged, reasoning, evidenceIds, usedCapabilityIds }]
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
    - OTHER 안: R 내림 → E → oppId (화면 정렬용, 접촉 후보 아님)
    - (갱신 제안 2026-10-21, 기능 설계 Q6 답 확정 후 적용 · 가설·설정값 `otherGroupSort`) 거산 값 묶음이 BROCHURE(소개서)일 때 OTHER 안은 E 내림 → R 내림 → oppId(참고 점수 순). 부록 F.10은 접촉 분류 3가지의 순서만 정하므로 기획서 규칙·A정밀 기대값은 바뀌지 않는다
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
      - kind ∈ {RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION, CAPABILITY_VALUE} 하나라도 → 전체 거부
      - kind 또는 securityGrade 없음·UNKNOWN → 전체 거부
      - securityGrade ∈ {PUBLIC, EXTERNAL_AI_OK}만 허용
      - 월 호출 상한 초과 → 거부 (kind LLM_LIMIT)
    OUTPUT_EXPORT:   # 질문 목록(거산에 보내는 것)·엑셀(내부용)
      - securityGrade = FORBIDDEN 또는 UNKNOWN → 전체 거부
      - kind 없음 → 전체 거부
      - 허용 kind: PUBLIC_TEXT, EVIDENCE, OPPORTUNITY_INFO, QUESTION, CAPABILITY_VALUE, RECONTACT_INPUT, INTERNAL_HISTORY, CUSTOMER_RELATION (내부용 출력이므로 허용하되 파일에 "내부용·고객 제출용 아님"과 가상 표시를 넣는다)
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
  output: { callCount: int, tokenCount: int, rejectedCount: int }
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
  rec_*:   SalesRecords          # rec_review_opinion, rec_bookmark, rec_action, rec_outcome
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

공통 규칙(Q4): 파일마다 설명이 달린 예시 파일을 `examples/` 폴더에 둔다(`case-apjeong.json`, `capability-geosan.json`, `rule-config.yaml`, `app-settings.yaml`). **설명은 `_설명` 키**에 적는다(JSON에는 주석이 없으므로 어느 객체에든 `_설명` 키를 허용하고 검사기는 이 키를 무시한다; YAML은 `#` 주석도 가능). 예시 파일은 들여쓴(한 항목 한 줄) 형태로 두고 투입 명령은 **위치 정보를 주는 로더**(줄·열을 돌려주는 JSON/YAML 파서)로 읽어 오류를 "**몇 번째 줄 어느 항목이 왜 틀렸는지**"로 보인다(예: `12번째 줄 requirements[1].reqLevel: 'REQUIRED', 'PREFERRED', 'NOT_REQUIRED', 'UNKNOWN' 중 하나여야 하는데 '필수요'가 적혀 있습니다`). `_설명` 외의 **모르는 키는 오류**다(오타가 조용히 사라지지 않게). 자유 문장 칸(quote, notes, allowedSummary, basis 등)에 이메일·전화 패턴이 있으면 **오류로 거부**한다(연락처는 저장하지 않음). 한 항목이라도 틀리면 아무것도 저장하지 않는다. 형식 설명서는 `contracts/*.schema.json` 네 개(약속 파일). 12/11 인계 뒤 거산 운영 담당자가 고치는 것을 전제로 한다.

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
  customer: { name, bizNumber|null, address, identityBasis, relationStatus, relationConfirmedAt, securityGrade }
  interactions: [{ kind: interactionKind, occurredAt, allowedSummary, linkedToOpportunity: boolean, certainty }]
  opportunity: { item, project, purpose, owner }
  discoveryPaths: [{ pathKind, sourceId, originKey, discoveredAt }]
  processLinks: [{ processCode, appliedMaterial }]
  requirements: [{ reqKind, name, content, reqLevel, scopeKind, linkProcessCode|null, neededStage, dueAt, certainty, basis, question, requiredValue, unit, edition }]
  signals: [{ signalKind, occurredAt, deadlineAt, progressStatus, agreedWindow, certainty }]
  evidence: [{ sourceGrade, certainty, isLlmProposed, subject, quote, sourceRef, occurredAt, securityGrade, externalAiAllowed }]
  itemInputs: [{ itemCode, matchRate, certainty, state, factJudged, evidenceRefs: [int] }]   # 역산 입력
  readinessCheck: { checked: boolean, staffKey, checkedAt } | null     # evalIdAtCheck는 투입 시 비어 있고 첫 평가가 채움(기능 설계 확인)
  researchReadiness: { ... } | null
  expected: { E, P, S, R, C, filterState, coreEvidenceMet, classificationCode, requirementResults: { <name>: checkDisplay } }
# shared-schema: 거산 역량 파일 (JSON 1개)
CapabilityFile:
  _설명: string
  datasetKind: datasetKind
  sourceNote: string                    # 예: "회사소개서 2026-09-21판"
  processes: [{ code, name, category, materialCodes, performanceTags, registryStatus, reviewStatus, capabilities: [{ capKind, name, displayValue, numericMin, numericMax, unit, standardRef, isDescriptiveOnly, reviewStatus }], deliveryRecords: [{ industry, partType, period, allowedBasis, reviewStatus }] }]
  qualifications: [{ kind, officialName, number, edition, holder, site, validFrom, validTo, reviewStatus, scopes: [{ scopeKind, processCode|null, customerRef|null, applicability, basis, reviewStatus }], statuses: [{ status, occurredAt, confirmedAt, confirmedBy, reason }] }]
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
  homepageDiscovery: { enabled: false, termsConfirmed: false }
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
  geosan review-set <targetKind> <targetId> <REVIEWED|RECHECK> --by <name> --basis <text>   # U4. 흐름 ②
  geosan dataset-set <datasetKind>               # U4. 거산 값 묶음 전환(설정 변경 + 재평가 안내)
  geosan backup [--to <dir>]                     # U8 최소형 → U10. SQLite 온라인 백업(VACUUM INTO, 서버가 켜져 있어도 일관된 사본, WAL 포함)
  geosan restore <backup-file>                   # U8 최소형 → U10. 서버가 멈춘 상태에서만 허용(켜져 있으면 거부), 복원 전 현재 DB를 자동으로 따로 보관, 확인 질문 1회
  geosan db merge-heads                          # U1. 마이그레이션 머리가 둘일 때 합치기
  geosan cost [--month YYYY-MM]                  # U10. TransferGuard 집계 × 단가
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
| C1 | 재접촉 카드·상세 영역(`recontact` 객체)의 세부 필드 | U6 (기능 설계) |
| C1 | 추가조사 기록(ResearchTask, P2)의 경로와 본문 | U4 (기능 설계, P2) |
| C3 | ReadinessCheck의 `evalIdAtCheck`가 파일 투입 시 비어 있을 때 첫 평가가 채우는지 | U1 (기능 설계) |
| C3 | 재접촉 프로필 입력 ①~⑦ 값과 일치도 단계 값 매핑 | U6 (기능 설계) |
| C6 | 마이그레이션 도구(Alembic 후보)와 첫 마이그레이션 묶음, `db merge-heads` 구현 | U1 (코드 생성) |
| C7 | 위치 정보를 주는 JSON/YAML 로더 선택과 `_설명` 키 처리 | U1 (코드 생성) |
| C7 | 아연도금 가상 사례의 기대값(FR10.2) | U10 (사례 설계) |
| C8 | 명령 이름 접두어 `geosan`과 설치 방식(`python -m` vs 스크립트) | U1 (코드 생성) |
| C9 | 홈페이지 자동 탐색의 검색 방식·비용·약관 | U9 (P1-5 구현 전) |
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
