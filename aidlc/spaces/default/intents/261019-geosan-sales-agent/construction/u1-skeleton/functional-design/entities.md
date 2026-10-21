# 엔티티 모델 (Entities) — U1 뼈대 (u1-skeleton)

뼈대 단위가 처음 만드는 데이터의 모양입니다. 이름은 도메인 설계(`../../../inception/domain-design/components.md`)의 엔티티를, 열거값은 계약 C0(`../../../inception/contract-design/contract-summary.md`)의 영문 코드를 그대로 씁니다. 저장은 SQLite 한 파일이며 테이블 이름 접두사(`cfg_`, `cap_`, `opp_`, `ev_`, `eval_`, `q_`, `rec_`)로 소유 부품을 나눕니다(C6). 교차 부품 참조는 ID만 저장하고 외래 키를 걸지 않으며 저장 전에 서버가 존재를 확인합니다(ADR-011). 뒤 단위(U2~U11)는 여기 있는 열을 바꾸지 않고 자기 열·테이블을 "더하기만" 합니다. 확인된 답변은 `functional-design-questions.md` Q1~Q8입니다.

공통 열(모든 업무 테이블, C6): `created_at`(시각, 시간대 포함), `created_by`(staffKey 또는 `system`), `session_ref`(접속 기록 참조, U8 전까지 비어 있음), `dataset_kind`(datasetKind), `is_virtual`(boolean). 기록 테이블은 `version`(integer, 1부터). 아래 YAML에서는 공통 열을 생략했습니다.

거산 값 묶음 분리(cap_ 묶음, 검토 반영 2026-10-21): 거산 값(Process·ProcessCapability·DeliveryRecord·Qualification·QualificationScope·QualificationStatus·FieldEvidence)은 **묶음(datasetKind)별로 따로 존재**한다. 재투입 식별 키는 모두 `datasetKind`를 포함한다 — Process (datasetKind, code), Qualification (datasetKind, officialName, number), ProcessCapability (processId, capKind, name). 평가 스냅샷과 조회는 앱 설정 `activeDatasetKind`의 행만 읽으며, 다른 묶음의 검수 완료 값이 섞여 통과 근거가 되는 일은 구조적으로 없다. 기회 쪽(opp_)은 묶음과 무관하므로 공정 연결·항목 입력은 공정 **코드**(processCode)로 가리키고 평가 때 활성 묶음의 Process로 해석한다.

재투입 시 자식 행(검토 반영): 같은 caseId를 다시 넣으면 기회의 자식 행(DiscoveryPath·OppProcessLink·Requirement·Signal·Evidence·ItemJudgmentInput·ResearchTask·ReadinessCheck)은 **기존 행에 `supersededAt`을 찍고 새 행을 넣는다**(삭제 없음). 현재 행 = supersededAt이 빈 행. 이전 평가의 스냅샷·근거 연결은 옛 행을 그대로 가리키므로 이력이 보존된다. 아래 YAML에서 `supersededAt`(datetime, 선택)은 이 자식 엔티티들의 공통 열로 보고 생략했다.

검수 상태의 원본(cap_ 묶음): 어떤 거산 값의 검수 상태 원본은 그 값에 대한 **가장 최근 FieldEvidence 행**(targetTable·targetId·targetField="reviewStatus")이고, 엔티티의 `reviewStatus` 열은 그 값을 같은 트랜잭션에서 복사해 둔 조회용 사본이다. 둘이 다르면 FieldEvidence가 맞으며 조회 시 로그를 남기고 사본을 고친다. 전환(U4 review-set)은 FieldEvidence 새 행 → 사본 갱신 순서로만 한다. 논리 타입: `string`, `text`(긴 글), `integer`, `decimal`, `boolean`, `date`, `datetime`(시간대 포함), `json`(구조화 값), `enum`(C0 코드).

```yaml
entities:
  # ---------- ConfigRegistry (cfg_) ----------
  - name: RuleConfigVersion
    table: cfg_rule_config_version
    description: 규칙 설정 파일(rule-config.yaml) 한 판. 모든 기준점·확실도·감쇠·배점은 "기업 승인 전 가설"이며 코드가 아닌 이 파일에 둔다 (NFR11, FR4.12)
    attributes:
      - { name: ruleVersion, type: string, required: true, unique: true, constraints: "예: v0.17-a. 파일의 version 값" }
      - { name: ruleHash, type: string, required: true, constraints: "파일 내용 SHA-256" }
      - { name: status, type: enum, required: true, allowed: [DRAFT, FIXED], default: DRAFT, constraints: "FIXED는 덮어쓰지 않고 새 버전으로만 바꿈" }
      - { name: changeReason, type: text, required: false }
      - { name: fixedAt, type: datetime, required: false }
      - { name: companyApprovalStatus, type: enum, required: true, allowed: [HYPOTHESIS, COMPANY_APPROVED], default: HYPOTHESIS }
      - { name: filePath, type: string, required: true }
    constraints:
      - 같은 ruleHash로 두 버전을 만들지 않는다
  - name: AppSetting
    table: cfg_app_setting
    description: 앱 설정(app-settings.yaml)을 키-값으로 읽은 사본. 담당자 목록·활성 거산 값 묶음·브랜드(로고·강조색·demoLabel)·접속 보호 켜기 등 (FR14.1, FR6.8, Q7)
    attributes:
      - { name: settingKey, type: string, required: true, unique: true, constraints: "예: staff, activeDatasetKind, brand.demoLabel" }
      - { name: value, type: json, required: true }
      - { name: updatedAt, type: datetime, required: true }
      - { name: updatedBy, type: string, required: true }
    constraints:
      - 비밀번호·API 키는 저장하지 않는다(환경 변수에서만 읽음)

  # ---------- CapabilityCatalog (cap_) ----------
  - name: Process
    table: cap_process
    description: 거산 공정 9종 중 하나 (FR1.1)
    attributes:
      - { name: processId, type: string, required: true, unique: true }
      - { name: code, type: string, required: true, constraints: "묶음 안에서 유일 (datasetKind, code)가 재투입 식별 키. 예: ANODIZING, ZINC_PLATING" }
      - { name: name, type: string, required: true, constraints: "회사소개서 표기" }
      - { name: category, type: string, required: false }
      - { name: materialCodes, type: json, required: true, constraints: "처리 가능 소재 코드 목록, 예: [AL, FE, CU]" }
      - { name: performanceTags, type: json, required: true, constraints: "처리 목적 태그 목록, 예: [CORROSION, WEAR, APPEARANCE, CONDUCTIVITY]" }
      - { name: registryStatus, type: enum, required: true, allowed: [BROCHURE_NAME, OFFICIAL_NAME], default: BROCHURE_NAME, constraints: "소개서 표기 / 공식 명칭 확정" }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
      - { name: assumptionNote, type: text, required: false, constraints: "예: 흑착색=알카리흑착 같은 공정 여부 거산 확인 전(가정 A11)" }
  - name: ProcessCapability
    table: cap_process_capability
    description: 공정의 역량 항목(사양·시험·설비). 숫자 사양은 최소·최대·단위로 나눔 (FR1.2)
    attributes:
      - { name: capabilityId, type: string, required: true, unique: true }
      - { name: processId, type: string, required: true, references: Process }
      - { name: capKind, type: enum, required: true, allowed: [SPEC, TEST, EQUIPMENT] }
      - { name: name, type: string, required: true }
      - { name: displayValue, type: string, required: false }
      - { name: numericMin, type: decimal, required: false }
      - { name: numericMax, type: decimal, required: false, constraints: "numericMin 이상" }
      - { name: unit, type: string, required: false, constraints: "숫자가 있으면 필수" }
      - { name: standardRef, type: string, required: false }
      - { name: scopeNote, type: text, required: false }
      - { name: isDescriptiveOnly, type: boolean, required: true, default: false, constraints: "EQUIPMENT는 true. 생산능력 판정에 쓰지 않음" }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
    constraints:
      - 재투입 식별 키는 (processId, capKind, name)
  - name: DeliveryRecord
    table: cap_delivery_record
    description: 공정별 납품 실적(산업·부품 종류·기간). 고객 실명 없음 (FR1.2, NEW_RECORD 항목 근거)
    attributes:
      - { name: recordId, type: string, required: true, unique: true }
      - { name: processId, type: string, required: true, references: Process }
      - { name: industry, type: string, required: true }
      - { name: partType, type: string, required: false }
      - { name: period, type: string, required: false }
      - { name: allowedBasis, type: text, required: false, constraints: "공개 가능 근거 요약" }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
  - name: Qualification
    table: cap_qualification
    description: 인증·승인 (ISO 9001, AS9100D, 한화시스템 특수공정 승인서 등) (FR1.4)
    attributes:
      - { name: qualId, type: string, required: true, unique: true }
      - { name: kind, type: enum, required: true, allowed: [CERTIFICATION, APPROVAL] }
      - { name: officialName, type: string, required: true }
      - { name: number, type: string, required: false, constraints: "(datasetKind, officialName, number)가 재투입 식별 키" }
      - { name: edition, type: string, required: false, constraints: "판본, 예: 2015" }
      - { name: holder, type: string, required: true, constraints: "보유 주체(법인명), 개인 아님" }
      - { name: site, type: string, required: false, constraints: "사업장" }
      - { name: validFrom, type: date, required: false }
      - { name: validTo, type: date, required: false }
      - { name: sourceVersion, type: string, required: false, constraints: "예: 회사소개서 2026-09-21" }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
  - name: QualificationScope
    table: cap_qualification_scope
    description: 자격의 적용 범위 한 줄. 공정·고객·기회 단위로 별도 행. processId가 비어 있어도 "모든 공정"으로 읽지 않는다 (FR1.4, FR1.6)
    attributes:
      - { name: scopeId, type: string, required: true, unique: true }
      - { name: qualId, type: string, required: true, references: Qualification }
      - { name: scopeKind, type: enum, required: true, allowed: [PROCESS, CUSTOMER, OPPORTUNITY] }
      - { name: processId, type: string, required: false, references: Process, constraints: "scopeKind=PROCESS면 필수" }
      - { name: customerId, type: string, required: false, references: Customer, constraints: "교차 참조, 저장 전 존재 확인" }
      - { name: oppId, type: string, required: false, references: Opportunity, constraints: "교차 참조" }
      - { name: productScope, type: string, required: false }
      - { name: applicability, type: enum, required: true, allowed: [APPLIES, NOT_APPLIES, UNKNOWN] }
      - { name: basis, type: text, required: false }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
  - name: QualificationStatus
    table: cap_qualification_status
    description: 자격 상태 이력. 갱신마다 새 행 (FR1.4, FR1.7, FR3.8)
    attributes:
      - { name: statusId, type: string, required: true, unique: true }
      - { name: qualId, type: string, required: true, references: Qualification }
      - { name: status, type: enum, required: true, allowed: [ACTIVE, SUSPENDED, CANCELLED, EXPIRED, UNCONFIRMED] }
      - { name: occurredAt, type: date, required: false }
      - { name: confirmedAt, type: date, required: false }
      - { name: confirmedBy, type: string, required: false }
      - { name: reason, type: text, required: false }
      - { name: evidenceId, type: string, required: false, references: Evidence, constraints: "파일 투입에서는 비워 둠(값이 있으면 거부)" }
    constraints:
      - 현재 상태 = 그 자격의 가장 최근 행
  - name: FieldEvidence
    table: cap_field_evidence
    description: 거산 값 하나의 검수 기록(검수자·검수일·근거·값 스냅샷). 값이 바뀌면 새 행, 이전 행 보존 (FR1.3, FR1.5)
    attributes:
      - { name: fieldEvidenceId, type: string, required: true, unique: true }
      - { name: targetTable, type: string, required: true, constraints: "cap_* 테이블 이름" }
      - { name: targetId, type: string, required: true }
      - { name: targetField, type: string, required: true }
      - { name: valueSnapshot, type: json, required: true }
      - { name: dataVersion, type: integer, required: true, constraints: "같은 대상 안에서 1부터 증가" }
      - { name: reviewStatus, type: enum, required: true, allowed: [UNAVAILABLE, PENDING, REVIEWED, RECHECK] }
      - { name: reviewer, type: string, required: false }
      - { name: reviewedAt, type: date, required: false }
      - { name: basis, type: text, required: false, constraints: "예: 회사소개서 2026-09-21, 거산 메일 답변 2026-11-02" }
      - { name: evidenceId, type: string, required: false, references: Evidence, constraints: "파일 투입에서는 비워 둠" }

  # ---------- OpportunityRegistry (opp_) ----------
  - name: Customer
    table: opp_customer
    description: 고객 기업. 연락처 열이 없고 넣어도 저장하지 않는다 (FR2.1, CON-11)
    attributes:
      - { name: customerId, type: string, required: true, unique: true }
      - { name: name, type: string, required: true }
      - { name: normalizedName, type: string, required: true, constraints: "㈜·(주)·공백·대소문자 정규화" }
      - { name: bizNumber, type: string, required: false, unique: true, constraints: "사업자번호 10자리, 없으면 빈값. 있으면 재투입 식별 키" }
      - { name: normalizedAddress, type: string, required: false, constraints: "bizNumber 없으면 normalizedName+normalizedAddress가 식별 키" }
      - { name: identityBasis, type: text, required: false }
      - { name: relationStatus, type: enum, required: true, allowed: [NEW_CONFIRMED, EXISTING_CONFIRMED, UNCONFIRMED] }
      - { name: relationConfirmedAt, type: date, required: false }
      - { name: companyFilterStatus, type: enum, required: true, allowed: [PASS, PENDING, EXCLUDED], default: PASS, constraints: "기업 전체 제한(폐업 등)" }
      - { name: companyFilterReason, type: text, required: false }
      - { name: securityGrade, type: enum, required: true, allowed: [PUBLIC, EXTERNAL_AI_OK, INTERNAL_ONLY, FORBIDDEN, UNKNOWN], constraints: "회사소개서 주요 거래처는 INTERNAL_ONLY" }
  - name: Interaction
    table: opp_interaction
    description: 접촉 이력(거래·견적·상담·제안·메모). 고객에 속하고 기회에 연결할 수 있다. U1은 파일 투입 값만 저장하고 재접촉 7칸(U6)은 열만 비워 둔다 (FR2.7)
    attributes:
      - { name: interactionId, type: string, required: true, unique: true }
      - { name: customerId, type: string, required: true, references: Customer }
      - { name: oppId, type: string, required: false, references: Opportunity, constraints: "이 기회에 연결된 이력일 때만" }
      - { name: kind, type: enum, required: true, allowed: [TRADE, QUOTE, CONSULT, PROPOSAL, MEMO] }
      - { name: occurredAt, type: date, required: false }
      - { name: allowedSummary, type: text, required: false, constraints: "연락처 패턴 금지" }
      - { name: applyScope, type: string, required: false }
      - { name: certainty, type: enum, required: true, allowed: [CONFIRMED, STRONG, WEAK, UNKNOWN] }
      - { name: confirmedAt, type: date, required: false }
      - { name: enteredBy, type: string, required: true }
      - { name: securityGrade, type: enum, required: true, allowed: [PUBLIC, EXTERNAL_AI_OK, INTERNAL_ONLY, FORBIDDEN, UNKNOWN], default: INTERNAL_ONLY }
      - { name: externalAiAllowed, type: boolean, required: true, default: false }
      - { name: pastProcessItem, type: string, required: false, constraints: "U6 재접촉 ①~⑤ 열(orderCount, sampleApproved, requirementMet, lossReason, lossResolved, lastDeliveryAt, orderCycle)은 U1에서 비어 있음" }
  - name: Opportunity
    table: opp_opportunity
    description: 영업기회. 고객 하나에 속하고 같은 프로젝트는 ID 하나 (FR2.2, FR2.3)
    attributes:
      - { name: oppId, type: string, required: true, unique: true }
      - { name: customerId, type: string, required: true, references: Customer }
      - { name: caseId, type: string, required: false, unique: true, constraints: "가상 사례·실제 기업 파일의 caseId(재투입 식별 키)" }
      - { name: baseDate, type: date, required: false, constraints: "사례 파일의 baseDate(Q4). verify-case와 단일 기회 평가의 기준일" }
      - { name: item, type: string, required: true, constraints: "품목" }
      - { name: project, type: string, required: false }
      - { name: distinctionBasis, type: text, required: false, constraints: "다른 기회와 구분하는 근거" }
      - { name: purpose, type: enum, required: true, allowed: [NEW_PROPOSAL, FOLLOW_UP_PROPOSAL, REORDER_CHECK] }
      - { name: owner, type: string, required: false, constraints: "담당 staffKey" }
      - { name: progressStatus, type: string, required: false }
      - { name: reviewCondition, type: text, required: false, constraints: "제외 기회의 재검토 조건(FR3.9). U1은 파일 값 저장만" }
      - { name: reviewOwner, type: string, required: false }
      - { name: reviewDueAt, type: date, required: false }
      - { name: mergeHistory, type: json, required: false, constraints: "U3이 채움" }
  - name: DiscoveryPath
    table: opp_discovery_path
    description: 기회를 발견한 경로. 기회당 여러 건, 같은 프로젝트를 다른 경로로 찾아도 기회 ID는 하나 (FR2.3)
    attributes:
      - { name: pathId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: pathKind, type: enum, required: true, allowed: [PROCESS_DEMAND, CERTIFICATION, HISTORY] }
      - { name: sourceId, type: string, required: false, constraints: "예: manual-case, kicox-factory-csv" }
      - { name: originKey, type: string, required: false, constraints: "(sourceId, originKey)로 중복 경로 판정" }
      - { name: discoveredAt, type: date, required: false }
      - { name: evidenceId, type: string, required: false, references: Evidence }
  - name: OppProcessLink
    table: opp_process_link
    description: 기회-공정 연결. (기회, 공정) 쌍당 하나. 현재 결과는 평가에서 파생된 값이며 원본은 RequirementCheck·EvaluationRun (FR2.5)
    attributes:
      - { name: linkId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: processCode, type: string, required: true, constraints: "공정 코드(묶음 무관). 평가 때 활성 묶음의 Process로 해석. 투입 시 어느 묶음에든 그 코드가 있어야 함(교차 참조 존재 확인)" }
      - { name: appliedMaterial, type: string, required: false, constraints: "적용 소재 코드, 예: AL_CASTING" }
      - { name: currentResult, type: enum, required: false, allowed: [PASS, PENDING, EXCLUDED] }
      - { name: currentReason, type: text, required: false }
      - { name: confirmedAt, type: datetime, required: false }
      - { name: sourceEvalId, type: string, required: false, references: EvaluationRun, constraints: "현재 결과를 만든 평가. 최신 확정 평가와 다르면 조회 시 재계산" }
    constraints:
      - (oppId, processCode) 유일(현재 행 기준)
  - name: Requirement
    table: opp_requirement
    description: 고객 요구(인증·승인·기술·수량/납기). 수준을 짐작해 채우지 않는다 (FR3.1)
    attributes:
      - { name: reqId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: linkId, type: string, required: false, references: OppProcessLink, constraints: "scopeKind=PROCESS_LINK면 필수" }
      - { name: reqKind, type: enum, required: true, allowed: [CERTIFICATION, APPROVAL, TECHNICAL, QUANTITY_DELIVERY] }
      - { name: name, type: string, required: true, constraints: "예: ISO 9001, 품질팀 샘플 승인, 피막 두께" }
      - { name: content, type: text, required: false }
      - { name: reqLevel, type: enum, required: true, allowed: [REQUIRED, PREFERRED, NOT_REQUIRED, UNKNOWN] }
      - { name: scopeKind, type: enum, required: true, allowed: [OPPORTUNITY, PROCESS_LINK] }
      - { name: requiredValue, type: decimal, required: false, constraints: "TECHNICAL일 때 기준값" }
      - { name: unit, type: string, required: false }
      - { name: edition, type: string, required: false, constraints: "요구하는 판본" }
      - { name: holder, type: string, required: false, constraints: "요구하는 보유 주체(C3 입력). 비어 있으면 자격 값으로 대조" }
      - { name: site, type: string, required: false, constraints: "요구하는 사업장(C3 입력)" }
      - { name: certainty, type: enum, required: true, allowed: [CONFIRMED, STRONG, WEAK, UNKNOWN] }
      - { name: neededStage, type: enum, required: true, allowed: [NOW, LATER, UNKNOWN] }
      - { name: dueAt, type: date, required: false }
      - { name: question, type: text, required: false, constraints: "파일에 적힌 확인 질문 문장. 질문 후보의 문구로만 쓰고 표시 조건은 BR8.1을 따름(Q2)" }
      - { name: basis, type: text, required: false }
      - { name: evidenceId, type: string, required: false, references: Evidence }
      - { name: proposedBy, type: enum, required: true, allowed: [FILE, LLM, STAFF], default: FILE }
      - { name: staffConfirmedState, type: string, required: false, constraints: "QUANTITY_DELIVERY는 담당자 확인 상태만 저장, 계산 안 함(FR3.6)" }
  - name: Signal
    table: opp_signal
    description: 시점 신호(증설·신규 수주·공고·채용·재발주 주기·후속 연락) (FR4.3, FR4.7)
    attributes:
      - { name: signalId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: signalKind, type: enum, required: true, allowed: [EXPANSION, NEW_ORDER, BID, HIRING, REORDER_CYCLE, NEXT_CONTACT] }
      - { name: occurredAt, type: date, required: false, constraints: "실제 발생일. 없으면 시점 항목 미확보" }
      - { name: announcedAt, type: date, required: false }
      - { name: scheduledAt, type: date, required: false, constraints: "예정 사건(미래)" }
      - { name: confirmedAt, type: date, required: false }
      - { name: deadlineAt, type: date, required: false, constraints: "공고 마감일. BID는 필수에 가깝다(없으면 마감 미상 → 미확보)" }
      - { name: timezone, type: string, required: true, default: Asia/Seoul }
      - { name: progressStatus, type: enum, required: false, allowed: [OPEN, CLOSED, CANCELLED, DONE] }
      - { name: nextCheckAt, type: date, required: false }
      - { name: agreedWindow, type: json, required: false, constraints: "시점 우선 ② 합의 실행기간. G0 전 실제 후보는 비어 있음, 가상 사례는 가상 합의값 (FR4.7)" }
      - { name: certainty, type: enum, required: true, allowed: [CONFIRMED, STRONG, WEAK, UNKNOWN] }
      - { name: relation, type: enum, required: true, allowed: [DIRECT, INDIRECT], constraints: "직접 관련 1.0 / 간접 관련 0.5 일치도 단계" }
      - { name: enteredBy, type: string, required: true }
      - { name: evidenceId, type: string, required: false, references: Evidence }

  # ---------- EvidenceExtraction 최소형 (ev_) ----------
  - name: Evidence
    table: ev_evidence
    description: 근거 자료 한 건. U1은 파일 투입(수동 입력)만 받고, 홈페이지 읽기·LLM 추출(U2)은 없다 (FR5.6, FR5.7)
    attributes:
      - { name: evidenceId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: sourceGrade, type: enum, required: true, allowed: [A, B, C, D] }
      - { name: sourceRef, type: string, required: true, constraints: "출처(주소·문서명)" }
      - { name: sourceVersion, type: string, required: false }
      - { name: originKey, type: string, required: false }
      - { name: quote, type: text, required: true, constraints: "원문 인용. 연락처 패턴 금지" }
      - { name: subject, type: enum, required: true, allowed: [PRODUCT, MATERIAL, PURPOSE, SIGNAL, REQUIREMENT, OTHER] }
      - { name: occurredAt, type: date, required: false }
      - { name: confirmedAt, type: date, required: false }
      - { name: securityGrade, type: enum, required: true, allowed: [PUBLIC, EXTERNAL_AI_OK, INTERNAL_ONLY, FORBIDDEN, UNKNOWN] }
      - { name: externalAiAllowed, type: boolean, required: true, default: false }
      - { name: presentationAllowed, type: boolean, required: true, default: false }
      - { name: extractionMethod, type: enum, required: true, allowed: [MANUAL, EXTERNAL_LLM], default: MANUAL }
      - { name: extractedBy, type: string, required: true }
      - { name: extractedAt, type: datetime, required: true }
      - { name: certaintyProposed, type: enum, required: false, allowed: [CONFIRMED, STRONG, WEAK, UNKNOWN] }
      - { name: certaintyConfirmed, type: enum, required: false, allowed: [CONFIRMED, STRONG, WEAK, UNKNOWN], constraints: "파일 투입 값은 확정값으로 저장(isLlmProposed=false)" }
      - { name: isLlmProposed, type: boolean, required: true, default: false }

  # ---------- RuleEngine (코드표, 설정 파일에서 읽어 cfg_에 두지 않음) ----------
  - name: ClassificationCode
    table: "(코드표 — 규칙 설정 파일 classificationLabels와 코드 상수. 테이블 없음)"
    description: 11분기 코드 ↔ 쉬운 말 문구 ↔ 승인 막힘 여부 ↔ 접촉 후보 여부. DB·API·화면·파일이 같은 표를 쓴다 (FR4.10, C0)
    attributes:
      - { name: code, type: enum, required: true, unique: true, allowed: [FILTER_EXCLUDED, FILTER_PENDING, OPS_PENDING, NOT_EVALUATED, CONTACT_URGENT, CONTACT_PLANNED, CONTACT_REVIEW, RESEARCH, CONDITIONAL_WAIT, WATCH, LOW] }
      - { name: order, type: integer, required: true, min: 1, max: 11 }
      - { name: ruleLabel, type: string, required: true, constraints: "기획서 용어, 예: 시점 우선 접촉" }
      - { name: easyLabel, type: string, required: true, constraints: "쉬운 말, 예: 지금 바로 연락 검토 (팀 제안, 설정에서 바꿈)" }
      - { name: blocksApproval, type: boolean, required: true }
      - { name: isContactCandidate, type: boolean, required: true, constraints: "CONTACT_URGENT·CONTACT_PLANNED·CONTACT_REVIEW만 true" }

  # ---------- EvaluationLedger (eval_) ----------
  - name: EvaluationBatch
    table: eval_batch
    description: 평가 묶음. 프로필·기준일·규칙 버전·해시·코드 버전·LLM 모드·거산 값 묶음을 기록해 재현성을 보장 (FR4.12, FR4.14)
    attributes:
      - { name: batchId, type: string, required: true, unique: true }
      - { name: profile, type: enum, required: true, allowed: [NEW, RECONTACT], constraints: "U1은 NEW만 만든다" }
      - { name: scope, type: enum, required: true, allowed: [FULL, PARTIAL], constraints: "FULL = 모든 기회, PARTIAL = --opp 목록·verify-case 1건. 목록 순위는 최신 FULL 묶음만 쓴다(BR10.1)" }
      - { name: baseDate, type: date, required: true, constraints: "감쇠·기한 기준일. 수집일 아님 (NFR12)" }
      - { name: ruleVersion, type: string, required: true, references: RuleConfigVersion }
      - { name: ruleHash, type: string, required: true }
      - { name: codeVersion, type: string, required: true, constraints: "패키지 버전 + git 짧은 해시" }
      - { name: llmMode, type: enum, required: true, allowed: [EXTERNAL, NONE], constraints: "U1은 NONE" }
      - { name: modelId, type: string, required: false }
      - { name: datasetKind, type: enum, required: true, allowed: [VIRTUAL_REVIEWED, BROCHURE, COMPANY_CONFIRMED] }
      - { name: populationSpec, type: json, required: true, constraints: "전체 또는 기회 ID 목록" }
      - { name: status, type: enum, required: true, allowed: [RUNNING, CONFIRMED, FAILED] }
      - { name: sortRule, type: string, required: true, constraints: "적용한 정렬 규칙 이름(예: default, brochureOther=E_FIRST)" }
      - { name: createdAt, type: datetime, required: true }
    constraints:
      - 한 묶음에 신규 기회와 재접촉이 섞이지 않는다
      - CONFIRMED 묶음에는 기회당 평가가 1건이다
  - name: EvaluationRun
    table: eval_run
    description: 기회 하나의 평가 결과. 값이 바뀌면 새 행, 이전 행 보존 (FR4.12)
    attributes:
      - { name: evalId, type: string, required: true, unique: true }
      - { name: batchId, type: string, required: true, references: EvaluationBatch }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: profile, type: enum, required: true, allowed: [NEW, RECONTACT] }
      - { name: profileChangeReason, type: text, required: false }
      - { name: runStatus, type: enum, required: true, allowed: [CONFIRMED, SUPERSEDED], constraints: "실패는 흐름 전체를 되돌리므로 평가 행이 남지 않고 묶음만 FAILED" }
      - { name: inputSnapshot, type: json, required: true, constraints: "C3 EvaluationInput 전체. FORBIDDEN·철회 자료 원문은 넣지 않고 ID·차단 사유만" }
      - { name: snapshotHash, type: string, required: true }
      - { name: capabilityVersion, type: string, required: true, constraints: "쓰인 거산 값의 FieldEvidence dataVersion 묶음 해시" }
      - { name: filterState, type: enum, required: true, allowed: [PASS, PENDING, EXCLUDED] }
      - { name: exclusionScope, type: enum, required: false, allowed: [COMPANY, OPPORTUNITY, LINK] }
      - { name: coreEvidenceMet, type: enum, required: true, allowed: [MET, RECHECK] }
      - { name: operationalReady, type: boolean, required: true }
      - { name: timingRequirements, type: json, required: true, constraints: "{directSignal, agreedWindow, readiness}" }
      - { name: researchReady, type: boolean, required: true }
      - { name: scoreE, type: integer, required: true, min: 0, max: 100 }
      - { name: scoreF, type: integer, required: true, min: 0, max: 70 }
      - { name: scoreT, type: integer, required: true, min: 0, max: 30 }
      - { name: scoreP, type: integer, required: true, min: 0, max: 100 }
      - { name: scoreR, type: integer, required: true, min: 0, max: 100 }
      - { name: scoreS, type: decimal, required: false, constraints: "소수 첫째 자리(HALF_UP). P=0이면 null(산정 전)" }
      - { name: completionC, type: decimal, required: true, constraints: "완료 항목 수 ÷ 전체 × 100, 소수 첫째 자리" }
      - { name: classificationCode, type: enum, required: true, references: ClassificationCode }
      - { name: coreEvidenceRecheckFlag, type: boolean, required: true }
      - { name: directConfirmedWeight, type: integer, required: true, constraints: "CONFIRMED 항목의 배점 합" }
      - { name: validUntil, type: date, required: false, constraints: "시점 우선의 유효 접촉 기한" }
      - { name: originalRank, type: integer, required: false, min: 1 }
      - { name: previousEvalId, type: string, required: false, references: EvaluationRun }
      - { name: reason, type: text, required: true, constraints: "카드 추천 이유 한 줄" }
      - { name: blockerText, type: text, required: true, constraints: "막는 조건 한 줄" }
      - { name: blocksApproval, type: boolean, required: true, constraints: "평가 시점에 계산해 저장(BR10.3). 조회 때 다시 계산하지 않음" }
      - { name: scoreDisplay, type: string, required: true, constraints: "카드 점수 문구(BR10.2): 정수, '--', '참고 N'. 평가 시점에 계산" }
      - { name: nextAction, type: text, required: true }
    constraints:
      - 0 ≤ E ≤ P ≤ 100, E ≤ R ≤ 100 (BR4.6 검증, 어기면 평가 실패)
  - name: ItemJudgment
    table: eval_item_judgment
    description: 평가 하나의 항목 판정. (평가, 항목) 쌍당 하나이며 미확보도 행을 남긴다 (FR4.4)
    attributes:
      - { name: judgmentId, type: string, required: true, unique: true }
      - { name: evalId, type: string, required: true, references: EvaluationRun }
      - { name: itemCode, type: enum, required: true, allowed: [NEW_PRODUCT, NEW_MATERIAL, NEW_RECORD, NEW_PERF, SIG_EXPAND, SIG_ORDER, SIG_BID, SIG_HIRE] }
      - { name: factJudged, type: text, required: false }
      - { name: reasoning, type: text, required: false }
      - { name: weight, type: integer, required: true, constraints: "부록 A.1 배점" }
      - { name: state, type: enum, required: true, allowed: [CONFIRMED, STRONG, WEAK, MISMATCH, NO_BONUS, NO_SIGNAL, UNAVAILABLE] }
      - { name: matchRate, type: decimal, required: false, constraints: "부록 A.1 고정 단계값만" }
      - { name: certainty, type: decimal, required: false, constraints: "1.0 / 0.65 / 0.25" }
      - { name: decay, type: decimal, required: false, constraints: "1.0 / 0.5 / 0" }
      - { name: score, type: integer, required: false, constraints: "UNAVAILABLE만 null, 그 밖은 0 이상 정수(HALF_UP)" }
      - { name: usedCapabilityIds, type: json, required: true, constraints: "쓰인 거산 공정·역량·실적 ID 목록" }
    constraints:
      - (evalId, itemCode) 유일
  - name: RequirementCheck
    table: eval_requirement_check
    description: 평가 하나의 요구별 판정. 무엇과 대조했는지와 사유·기준일을 남긴다 (FR3.2)
    attributes:
      - { name: checkId, type: string, required: true, unique: true }
      - { name: reqId, type: string, required: true, references: Requirement }
      - { name: evalId, type: string, required: true, references: EvaluationRun }
      - { name: result, type: enum, required: true, allowed: [PASS, UNKNOWN, EXCLUDED] }
      - { name: displayResult, type: enum, required: true, allowed: [PASS, LATER_STAGE, QUESTION_NEEDED, PENDING_BLOCKS, EXCLUDED] }
      - { name: stageJudged, type: enum, required: true, allowed: [NOW, LATER, UNKNOWN] }
      - { name: scopeJudged, type: enum, required: true, allowed: [OPPORTUNITY, PROCESS_LINK] }
      - { name: reason, type: text, required: true }
      - { name: comparedValue, type: json, required: false, constraints: "대조한 자격 속성 또는 사양 범위" }
      - { name: baseDate, type: date, required: true }
      - { name: qualId, type: string, required: false, references: Qualification }
      - { name: linkId, type: string, required: false, references: OppProcessLink }
      - { name: evidenceId, type: string, required: false, references: Evidence }
      - { name: followUpCondition, type: text, required: false, constraints: "LATER 단계면 '후속 단계 미완료'와 조건" }
  - name: JudgmentEvidence
    table: eval_judgment_evidence
    description: 항목 판정 ↔ 근거 연결. 같은 쌍 중복 금지
    attributes:
      - { name: judgmentEvidenceId, type: string, required: true, unique: true }
      - { name: judgmentId, type: string, required: true, references: ItemJudgment }
      - { name: evidenceId, type: string, required: true, references: Evidence }
      - { name: relationType, type: enum, required: true, allowed: [SUPPORTS, CONTRADICTS, CONTEXT] }
      - { name: applyReason, type: text, required: false }
    constraints:
      - (judgmentId, evidenceId) 유일
  - name: ItemJudgmentInput
    table: eval_item_input
    description: 사람이 사례 파일에 적은 8항목 판정 입력(역산 입력·실제 기업 판정). 뼈대는 LLM 추출 없이 이 값으로 점수를 낸다. 평가가 읽는 입력이므로 EvaluationLedger가 소유한다(U2는 LLM 제안값을 같은 표에 proposedBy=LLM으로 더한다) (FR10.3, C7 itemInputs, BR4.1)
    attributes:
      - { name: itemInputId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity, constraints: "교차 참조" }
      - { name: itemCode, type: enum, required: true, allowed: [NEW_PRODUCT, NEW_MATERIAL, NEW_RECORD, NEW_PERF, SIG_EXPAND, SIG_ORDER, SIG_BID, SIG_HIRE] }
      - { name: state, type: enum, required: true, allowed: [CONFIRMED, STRONG, WEAK, MISMATCH, NO_BONUS, NO_SIGNAL, UNAVAILABLE] }
      - { name: matchRateStep, type: string, required: false, constraints: "단계 이름(예: 정확히 일치, 동일 산업). 숫자로 적어도 허용" }
      - { name: matchRate, type: decimal, required: false, constraints: "부록 A.1 고정 단계값만. state가 CONFIRMED/STRONG/WEAK면 필수" }
      - { name: factJudged, type: text, required: false }
      - { name: evidenceIds, type: json, required: true, constraints: "파일의 evidenceRefs를 Evidence ID로 바꾼 목록(비어 있을 수 있음)" }
      - { name: signalIds, type: json, required: true, constraints: "SIG_* 항목이 쓰는 Signal ID 목록(파일 signalRefs → ID). SIG_* 항목에서 state가 NO_SIGNAL·UNAVAILABLE이 아니면 1개 이상 필수" }
      - { name: usedCapabilityRefs, type: json, required: true, constraints: "NEW_MATERIAL·NEW_RECORD·NEW_PERF가 대조한 거산 값의 참조(공정 코드·역량 이름·실적 산업). 평가 때 활성 묶음의 ID로 해석해 ItemJudgment.usedCapabilityIds에 저장" }
      - { name: proposedBy, type: enum, required: true, allowed: [FILE, LLM, STAFF], default: FILE }
      - { name: enteredBy, type: string, required: true }
      - { name: enteredAt, type: datetime, required: true }
      - { name: version, type: integer, required: true, min: 1, constraints: "재투입 시 새 행, 평가는 최신 version만 읽음" }
    constraints:
      - (oppId, itemCode, version) 유일. 기회당 8항목 행이 모두 있어야 평가할 수 있다(없는 항목은 UNAVAILABLE 행으로 투입 시 채움)
      - SIG_* 항목의 matchRate는 signalIds 중 대표 신호(BR4.4 선택 규칙)의 relation(DIRECT 1.0 / INDIRECT 0.5)과 같아야 한다(check-case 오류)
      - signalIds의 신호는 같은 기회의 현재 Signal 행이어야 하고 signalKind가 항목과 맞아야 한다(SIG_EXPAND↔EXPANSION, SIG_ORDER↔NEW_ORDER, SIG_BID↔BID, SIG_HIRE↔HIRING)
  - name: ReadinessCheck
    table: eval_readiness_check
    description: 시점 우선 요건 ③ "기한 내 대응 가능" 담당자 체크. 담당자 입력이지만 평가 입력이다. U1은 파일 값으로 넣고 화면 체크는 U5 (FR4.7, Q1)
    attributes:
      - { name: readinessCheckId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: checked, type: boolean, required: true }
      - { name: staffName, type: string, required: true, constraints: "staffKey. 파일 투입이면 파일의 staffKey" }
      - { name: checkedAt, type: datetime, required: true }
      - { name: evalIdAtCheck, type: string, required: false, references: EvaluationRun, constraints: "파일 투입 시 null → 그 체크를 처음 쓰는 평가가 자기 ID로 채움(Q1 A)" }
      - { name: resetReason, type: text, required: false }
      - { name: resetAt, type: datetime, required: false }
    constraints:
      - 기회당 "현재 체크" = resetAt이 비어 있는 가장 최근 행

  # ---------- ConfirmationDesk 최소형 (q_) ----------
  - name: ConfirmationQuestion
    table: q_question
    description: 확인 질문. U1은 평가가 만든 후보를 WAITING으로 저장하고 상세에 읽기 전용으로 보이기만 한다. 요청·회신·반영은 U4 (FR11.1)
    attributes:
      - { name: questionId, type: string, required: true, unique: true }
      - { name: targetKind, type: enum, required: true, allowed: [QUALIFICATION, PROCESS, CAPABILITY, FIELD, REQUIREMENT, OPPORTUNITY] }
      - { name: targetId, type: string, required: true }
      - { name: questionText, type: text, required: true }
      - { name: currentValue, type: string, required: false }
      - { name: answerFormat, type: enum, required: true, allowed: [YES_NO, SHORT_TEXT], default: YES_NO }
      - { name: status, type: enum, required: true, allowed: [WAITING, REQUESTED, REPLIED, APPLIED], default: WAITING }
      - { name: sourceEvalId, type: string, required: false, references: EvaluationRun }
      - { name: isUserAdded, type: boolean, required: true, default: false }
    constraints:
      - (targetKind, targetId) 유일 — 같은 대상 질문은 하나이고 연결만 늘어남
  - name: QuestionOpportunityLink
    table: q_question_opportunity_link
    description: 질문이 영향을 주는 기회와 "답하면 바뀌는 것"
    attributes:
      - { name: questionLinkId, type: string, required: true, unique: true }
      - { name: questionId, type: string, required: true, references: ConfirmationQuestion }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: effectIfAnswered, type: text, required: true }
      - { name: linkedAt, type: datetime, required: true }
    constraints:
      - (questionId, oppId) 유일
  - name: ResearchTask
    table: q_research_task
    description: 조사 요건 입력값. U1은 파일 투입 저장만(⑧ 추가조사 / ⑨ 조건부 대기 판정 입력), 화면 입력은 U4 P2 (FR4.9, FR12.1)
    attributes:
      - { name: taskId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: evalId, type: string, required: false, references: EvaluationRun }
      - { name: questionSet, type: json, required: false, constraints: "구체 질문 묶음" }
      - { name: allowedChannel, type: string, required: false, constraints: "허용된 확인 경로" }
      - { name: owner, type: string, required: false }
      - { name: canChangeClass, type: boolean, required: false, constraints: "질문이 E·P·핵심 근거를 통해 분류를 바꿀 수 있는가" }
      - { name: estimatedHours, type: decimal, required: false }
      - { name: maxHours, type: decimal, required: false, constraints: "비어 있으면 규칙 설정 researchRequirements.maxHoursDefault(2)" }
      - { name: status, type: enum, required: true, allowed: [PLANNED, IN_PROGRESS, DONE, CANCELLED], default: PLANNED }
      - { name: recheckAt, type: date, required: false }

  # ---------- SalesRecords 최소형 (rec_) ----------
  - name: ReviewOpinion
    table: rec_review_opinion
    description: 담당자 의견(검토할 만함 / 추가 확인 필요 / 대상 아님). 본 평가 ID 필수, 수정은 새 행 (FR7.1, FR7.2, FR7.6)
    attributes:
      - { name: opinionId, type: string, required: true, unique: true }
      - { name: oppId, type: string, required: true, references: Opportunity }
      - { name: evalId, type: string, required: true, references: EvaluationRun, constraints: "낡은 평가 ID여도 저장(본 평가 기록이 목적)" }
      - { name: opinion, type: enum, required: true, allowed: [WORTH_REVIEW, NEED_CHECK, NOT_TARGET] }
      - { name: memo, type: string, required: false, max: 200 }
      - { name: reason, type: string, required: false, max: 200, constraints: "NOT_TARGET이면 1~200자 필수" }
      - { name: staffName, type: string, required: true, constraints: "staffKey. viewer 불가" }
      - { name: recordedAt, type: datetime, required: true }
      - { name: previousOpinionId, type: string, required: false, references: ReviewOpinion }
      - { name: version, type: integer, required: true, min: 1 }
    constraints:
      - 기회당 "현재 의견" = version이 가장 큰 행

relationships:
  - { from: ProcessCapability, to: Process, cardinality: "N:1", fk: true }
  - { from: DeliveryRecord, to: Process, cardinality: "N:1", fk: true }
  - { from: QualificationScope, to: Qualification, cardinality: "N:1", fk: true }
  - { from: QualificationScope, to: Process, cardinality: "N:1 (선택)", fk: true }
  - { from: QualificationScope, to: Customer, cardinality: "N:1 (선택)", fk: false, note: "교차 참조" }
  - { from: QualificationScope, to: Opportunity, cardinality: "N:1 (선택)", fk: false }
  - { from: QualificationStatus, to: Qualification, cardinality: "N:1", fk: true }
  - { from: FieldEvidence, to: "Process | ProcessCapability | DeliveryRecord | Qualification | QualificationScope", cardinality: "N:1 (targetTable/targetId)", fk: false }
  - { from: Interaction, to: Customer, cardinality: "N:1", fk: true }
  - { from: Interaction, to: Opportunity, cardinality: "N:1 (선택)", fk: true }
  - { from: Opportunity, to: Customer, cardinality: "N:1", fk: true }
  - { from: DiscoveryPath, to: Opportunity, cardinality: "N:1", fk: true }
  - { from: OppProcessLink, to: Opportunity, cardinality: "N:1", fk: true }
  - { from: OppProcessLink, to: Process, cardinality: "N:1 (processCode로, 평가 때 활성 묶음에서 해석)", fk: false }
  - { from: OppProcessLink, to: EvaluationRun, cardinality: "N:1 (선택, sourceEvalId)", fk: false }
  - { from: Requirement, to: Opportunity, cardinality: "N:1", fk: true }
  - { from: Requirement, to: OppProcessLink, cardinality: "N:1 (선택)", fk: true }
  - { from: Signal, to: Opportunity, cardinality: "N:1", fk: true }
  - { from: Evidence, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: EvaluationBatch, to: RuleConfigVersion, cardinality: "N:1", fk: false }
  - { from: EvaluationRun, to: EvaluationBatch, cardinality: "N:1", fk: true }
  - { from: EvaluationRun, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: EvaluationRun, to: EvaluationRun, cardinality: "N:1 (previousEvalId)", fk: true }
  - { from: ItemJudgment, to: EvaluationRun, cardinality: "N:1", fk: true }
  - { from: RequirementCheck, to: EvaluationRun, cardinality: "N:1", fk: true }
  - { from: RequirementCheck, to: Requirement, cardinality: "N:1", fk: false }
  - { from: RequirementCheck, to: Qualification, cardinality: "N:1 (선택)", fk: false }
  - { from: JudgmentEvidence, to: ItemJudgment, cardinality: "N:1", fk: true }
  - { from: JudgmentEvidence, to: Evidence, cardinality: "N:1", fk: false }
  - { from: ItemJudgmentInput, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: ReadinessCheck, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: ReadinessCheck, to: EvaluationRun, cardinality: "N:1 (선택)", fk: true }
  - { from: ConfirmationQuestion, to: EvaluationRun, cardinality: "N:1 (선택)", fk: false }
  - { from: QuestionOpportunityLink, to: ConfirmationQuestion, cardinality: "N:1", fk: true }
  - { from: QuestionOpportunityLink, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: ResearchTask, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: ReviewOpinion, to: Opportunity, cardinality: "N:1", fk: false }
  - { from: ReviewOpinion, to: EvaluationRun, cardinality: "N:1", fk: false }
```

## 엔티티 요약 (사람이 읽는 보기)

| 묶음(접두사) | 엔티티 | 뼈대에서 하는 일 | 뒤 단위가 더하는 것 |
|---|---|---|---|
| 설정 `cfg_` | RuleConfigVersion, AppSetting | 규칙 설정 파일 버전·해시, 담당자 목록·활성 묶음·브랜드(demoLabel 포함) | U8 환경 변수·접속 보호, U10 단가 |
| 거산 역량 `cap_` | Process, ProcessCapability, DeliveryRecord, Qualification, QualificationScope, QualificationStatus, FieldEvidence | 거산 역량 파일 투입(가상 검수 묶음·소개서 묶음), 검수 상태 조회, 평가 스냅샷 | U4 검수 상태 전환 명령 |
| 고객·기회 `opp_` | Customer, Interaction, Opportunity, DiscoveryPath, OppProcessLink, Requirement, Signal | 가상 사례·실제 기업 파일 투입, 평가 입력, 공정 연결 현재 결과 | U3 병합·MergeCandidate, U5 재검토 조건 화면, U6 재접촉 7칸 |
| 근거 `ev_` | Evidence | 파일로 넣은 근거 저장·조회, 스냅샷 | U2 홈페이지 읽기·LLM 제안값, HomepageCandidate |
| 코드표 | ClassificationCode | 11분기 코드·쉬운 말·승인 막힘·접촉 후보 여부 | — |
| 평가 `eval_` | EvaluationBatch, EvaluationRun, ItemJudgment, RequirementCheck, JudgmentEvidence, ItemJudgmentInput, ReadinessCheck | ⓪ 평가 실행, 스냅샷·결과 보존, 8항목 판정 입력(파일 값), 기한 체크 파일 값 | U2 LLM 제안 입력·재평가 쌍, U5 화면 체크·RankAdjustment |
| 질문 `q_` | ConfirmationQuestion, QuestionOpportunityLink, ResearchTask | 질문 후보 WAITING 저장, 상세 읽기 전용 표시, 조사 요건 파일 값 | U4 요청·회신·반영·내보내기, P2 조사 입력 |
| 기록 `rec_` | ReviewOpinion | 의견 저장·수정 이력·동시 수정 버전 | U5 Bookmark·Action·Outcome |

가상 사례 파일(CaseFile)과 거산 역량 파일(CapabilityFile)은 계약 C7의 형식을 쓰며, 이 단계에서 더하는 키(모두 "더하는 변경", PM 확인 뒤 약속 파일 반영)는 CaseFile `baseDate`(Q4), `signals[].relation`(직접/간접)·`signals[].scheduledAt`·`signals[].announcedAt`(C3 신호 입력과 맞춤), `itemInputs[].usedCapabilityRefs`(대조한 공정·역량 이름), `itemInputs[].signalRefs`(파일 안 신호 인덱스)입니다. 규칙 엔진 입력(C3 EvaluationInput)에는 `itemInputs`(위 ItemJudgmentInput)와 `signals[].relation`을 더하고, 공유 데이터(C6)에는 cap_ 식별 키의 `datasetKind` 포함, `eval_batch.scope`, 자식 행 `superseded_at`을 더합니다. 공정 연결은 `processId` 대신 `processCode`를 저장합니다(도메인 설계의 "공정 ID 참조"를 묶음 분리 때문에 코드 참조로 바꾼 것, 같은 뜻). 사람이 적는 일치도·확실도는 단계 이름("정확히 일치", "강한 추정")으로도 받아 검사기가 숫자로 바꿉니다(부분 시연 제안 ④). 데이터 설계서(팀 문서) 24개 테이블과의 대응은 도메인 설계 "엔티티 소유" 표와 같고, 설계서와 다른 곳(OUTCOME 상태·ACTION 승인 상태·재접촉 7칸 저장 위치)은 뒤 단위 몫입니다.

## 상류 문서와의 연결

- 작업 단위: `../../../inception/units-generation/unit-of-work.md` U1 포함 부품(최소형) — 위 8개 묶음이 그 목록과 같다. 뼈대 밖 엔티티(MergeCandidate, TransferLog, HomepageCandidate, IngestionRun, SourceContract, RankAdjustment, Bookmark, Action, Outcome, AccessSession)는 만들지 않는다.
- 이야기 대응: `../../../inception/units-generation/unit-of-work-story-map.md` US1.1·US1.2(cap_), US3.2(opp_), US5.1~5.3(eval_·코드표), US6.1·US6.2(조회 파생 열), US7.1(rec_), US10.1(dataset_kind·is_virtual), US10.4(AppSetting brand).
- 요구사항: `../../../inception/requirements-analysis/requirements.md` FR1·FR2·FR3.1·FR4.12·FR4.14·FR5.6·FR7.1·FR7.2·FR7.6·FR10.3·FR11.1·FR14.1, 부록 A 항목 코드.
- 부품 목록: `../../../inception/domain-design/components.md` 엔티티 이름·소유 부품·교차 참조 규칙(ADR-011).
- 계약: `../../../inception/contract-design/contract-summary.md` C0 코드표, C6 테이블 접두사·공통 열, C7 파일 형식.
