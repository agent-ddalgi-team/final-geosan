# 업무 규칙 (Rules) — U1 뼈대 (u1-skeleton)

뼈대 단위가 지키는 규칙을 번호(`BR{묶음}.{순번}`)로 옮긴 것입니다. 새로 정한 규칙은 없고, 요구사항 FR1~FR14·부록 A, 계약 C0~C8, 확인된 답변 Q1~Q8을 그대로 옮겼습니다. 모든 수치(배점·단계값·확실도·감쇠·기준점·조사 시간 상한)는 **기업 승인 전 가설**이며 코드가 아닌 규칙 설정 파일(`rule-config.yaml`, 버전·해시 기록)에 둡니다. `source`는 출처입니다. 기획서 5장·부록 F의 수치와 순서는 바꾸지 않았고, 필수 판정을 생략하거나 점수로 우회하는 규칙은 없습니다.

```yaml
rules:
  # ===== BR1. 거산 역량·검수 =====
  - id: BR1.1
    statement: 공정 9종(아연도금, 아노다이징, 흑착색(알카리흑착), 크로메이트, 전해연마, 크롬도금, 무전해니켈, 인산염피막, 부동태)은 각각 Process 하나로 등록하고 등록 상태(소개서 표기 / 공식 명칭 확정)를 가진다.
    category: constraint
    applies_to: Process
    trigger: 거산 역량 파일 투입
    logic: IF 파일의 공정 code가 9종 목록에 있으면 THEN 그 파일의 묶음(datasetKind) 안에 하나의 Process로 저장하고 registryStatus를 파일 값(기본 BROCHURE_NAME)으로 둔다. 묶음이 다르면(가상 검수 / 소개서) 같은 code의 Process가 묶음마다 따로 있다. 흑착색과 알카리흑착은 하나의 공정이며 assumptionNote에 "거산 확인 전(가정 A11)"을 남긴다.
    violation: 목록 밖 code는 투입 오류(줄·항목·이유).
    source: FR1.1, AC1.1.1, AC1.2.4
  - id: BR1.2
    statement: 숫자 사양은 최소·최대·단위로 나눠 저장하고, 설비 항목은 설명용이라 생산능력 판정에 쓰지 않는다.
    category: validation
    applies_to: ProcessCapability
    trigger: 거산 역량 파일 투입, 기술 조건 대조(BR3.6)
    logic: IF capKind=SPEC이고 숫자가 있으면 THEN numericMin ≤ numericMax이고 unit이 있어야 한다. IF capKind=EQUIPMENT THEN isDescriptiveOnly=true이며 BR3.6 대조에서 제외한다.
    violation: 단위 없는 숫자, min > max는 투입 오류.
    source: FR1.2, AC1.1.2
  - id: BR1.3
    statement: 거산 값은 '검수 완료'(REVIEWED)일 때만 가점 근거와 필수조건 통과 근거로 쓴다.
    category: policy
    applies_to: Process, ProcessCapability, DeliveryRecord, Qualification, QualificationScope
    trigger: 평가 스냅샷 생성, 요구 판정(BR3.2), 항목 판정(BR4.1)
    logic: 평가 스냅샷과 요구 판정은 앱 설정 activeDatasetKind 묶음의 거산 값만 읽는다(다른 묶음의 검수 완료 값은 보이지 않음). IF reviewStatus ≠ REVIEWED(원본은 최근 FieldEvidence 행) THEN 그 값으로는 요구 판정 PASS를 내지 않고(UNKNOWN), 핵심 근거(BR5.1)·운영 전제(BR5.5)의 "검수 완료" 조건을 충족하지 않으며, 확인 질문 후보(BR8.1)를 만든다. 항목 점수(E 등)는 참고 점수로 계산하되 그 평가는 BR5.6·BR3.4에 따라 ②/③으로 분류되어 접촉 후보(⑤⑥⑦)가 될 수 없다 — "가점 근거로 쓰지 않는다"는 뜻은 이것이다. 조회 결과에는 usable 여부를 함께 돌려준다.
    violation: 검수 전 값으로 PASS가 나오면 결함(테스트 S01·S08).
    source: FR1.3, FR1.5, AC1.1.3, AC1.2.1, CON-20
  - id: BR1.4
    statement: 자격 적용 범위는 공정·고객·기회 단위의 별도 행이며, 공정 ID가 비어 있는 범위를 "모든 공정"으로 해석하지 않는다. ISO 9001·AS9100D는 아노다이징·크로메이트·전기아연도금·부동태 4개 공정에만 연결한다.
    category: constraint
    applies_to: QualificationScope
    trigger: 역량 파일 투입, 요구 판정(BR3.2)
    logic: IF scopeKind=PROCESS이고 processId가 비어 있으면 THEN 투입 오류. 요구 판정은 대조할 공정(linkId의 processId)과 같은 processId의 APPLIES 범위가 있을 때만 범위 일치로 본다.
    violation: 다른 공정 연결에서 이 인증을 통과 근거로 쓰면 결함(AC1.1.4).
    source: FR1.4, FR1.6, AC1.1.4
  - id: BR1.5
    statement: 자격 상태는 갱신마다 새 행이며, 현재 상태가 ACTIVE가 아니면(정지·취소·만료·미확인) 만료일이 남아도 통과 근거로 쓰지 않는다. 갱신 예정만으로 유효를 확정하지 않는다.
    category: policy
    applies_to: QualificationStatus
    trigger: 요구 판정(BR3.2)
    logic: 현재 상태 = 가장 최근 행. IF status ∈ {SUSPENDED, CANCELLED, EXPIRED} THEN 그 자격은 PASS 근거 제외(EXCLUDED 또는 UNKNOWN은 BR3.2 규칙). IF status=UNCONFIRMED THEN UNKNOWN. 한화시스템 특수공정 승인서는 UNCONFIRMED로 투입한다.
    violation: 정지된 자격으로 PASS가 나오면 결함(S11).
    source: FR1.4, FR1.7, FR3.8, AC1.2.2, AC5.2.5
  - id: BR1.6
    statement: 모든 행은 실데이터/가상 구분(datasetKind, isVirtual)을 가지며, 가상 행이 섞인 화면·출력물에는 "가상·거산 실제 사양 아님" 띠를 항상 보인다.
    category: policy
    applies_to: 모든 업무 테이블, 화면 공통 틀
    trigger: 투입, 목록·상세 응답, 화면 표시
    logic: 응답 meta.hasVirtualData = 결과에 isVirtual=true 행이 하나라도 있음. IF hasVirtualData THEN 띠 표시(BR10.4).
    violation: 가상 행이 있는데 띠가 없으면 결함(AC6.1.4, AC10.1.1).
    source: FR1.8, CON-10, AC6.1.4, AC10.1.1, AC5.4.2
  - id: BR1.7
    statement: 같은 식별 키를 다시 투입하면 값은 덮어쓰되 이력(FieldEvidence·QualificationStatus·평가)은 보존하고, 이미 REVIEWED인 값은 파일의 PENDING으로 되돌리지 않는다.
    category: policy
    applies_to: 거산 역량 파일, 가상 사례 파일
    trigger: import-capability, import-case 재투입
    logic: 식별 키는 (datasetKind, Process.code), (datasetKind, Qualification.officialName, number), Customer.bizNumber(없으면 normalizedName+normalizedAddress), Opportunity.caseId. 거산 값은 묶음별로 따로 존재하므로 소개서 파일을 넣어도 가상 검수 묶음의 값은 바뀌지 않고, 반대도 같다. IF 같은 묶음의 기존 값이 REVIEWED이고 파일 값이 PENDING THEN 기존 검수 상태 유지 + 경고 줄 출력. 되돌리려면 U4의 review-set … RECHECK. 사례 파일 재투입(같은 caseId)은 기회 행은 덮어쓰고 자식 행(발견 경로·공정 연결·요구·신호·근거·항목 입력·조사 요건·기한 체크)은 기존 행에 supersededAt을 찍은 뒤 새 행을 넣는다(삭제 없음, 이전 평가의 참조 보존).
    violation: 재투입으로 평가 이력이 사라지면 결함.
    source: C7 재투입 규칙, FR1.3

  # ===== BR2. 투입 파일·고객·기회 =====
  - id: BR2.1
    statement: 고객·기회·근거·이력에 담당자 이름·이메일·전화 같은 연락처 열이 없고, 자유 문장(quote, allowedSummary, basis, notes, content)에 이메일·전화 패턴이 있으면 투입을 거부한다.
    category: validation
    applies_to: Customer, Interaction, Evidence, Requirement, 투입 파일 전체
    trigger: check-case, import-case, import-capability
    logic: IF 자유 문장에 이메일 패턴 또는 전화번호 패턴(국내 02/0xx-xxxx-xxxx, 010-xxxx-xxxx, +82 포함)이 있으면 THEN 오류 "N번째 줄 <항목>: 연락처는 저장하지 않습니다"와 함께 아무것도 저장하지 않는다. 담당자가 화면에서 적는 자유 문장(의견 메모·사유, 뒤 단위의 질문 문장·결과 메모)도 같은 검사를 거쳐 400 fields 오류로 거부한다(BR9.1).
    violation: 연락처가 저장되면 결함(테스트로 0건 확인).
    source: FR2.1, CON-11, AC3.1.4, C7
  - id: BR2.2
    statement: 투입 파일은 `_설명` 키를 무시하고 그 밖의 모르는 키는 오류이며, 허용 값(C0 코드 또는 단계 이름) 밖의 값은 오류이고, 한 항목이라도 틀리면 아무것도 저장하지 않는다. 오류는 "몇 번째 줄 어느 항목이 왜"로 보인다.
    category: validation
    applies_to: CaseFile, CapabilityFile, rule-config.yaml, app-settings.yaml
    trigger: check-config, check-case, import-*
    logic: 위치 정보를 주는 로더로 읽는다. 일치도·확실도는 숫자(부록 A 단계값) 또는 단계 이름("정확히 일치", "강한 추정" 등)으로 받고 검사기가 숫자로 바꾼다. 오류 메시지 형식: `<줄>번째 줄 <경로>: <허용 값> 중 하나여야 하는데 '<값>'이 적혀 있습니다`.
    violation: 모르는 키가 조용히 사라지면 결함.
    source: C7 공통 규칙, 부분 시연 제안 ④, AC9.4.3
  - id: BR2.3
    statement: 교차 부품 참조는 ID만 저장하고 외래 키를 걸지 않으며, 저장 전에 서버가 존재를 확인한다. 가상 사례 파일 한 묶음은 고객 → 기회 → (거산 값은 역량 파일로 이미 있음) → 근거 → 요구·신호·발견 경로·조사 요건·기한 체크 순서로 넣는다.
    category: constraint
    applies_to: 투입 흐름, WorkflowRunner
    trigger: import-case, run_evaluation 저장
    logic: IF 참조 대상(processCode는 어느 묶음에든 존재, customerRef 등)이 없으면 THEN 저장 거부(오류에 대상 표시); processCode가 현재 활성 묶음에 없으면 경고 줄("활성 묶음에 없는 공정, 평가에서 연결이 미확인 처리됨"). 파일 투입의 Evidence·Signal 참조(evidenceRefs, signalRefs)는 같은 파일 안 인덱스만 허용하고 FieldEvidence·QualificationStatus의 evidenceId는 비워야 한다.
    violation: 없는 대상을 가리키는 행이 저장되면 결함.
    source: ADR-011, components 서버 검사 담당 표, C7
  - id: BR2.4
    statement: 같은 프로젝트를 다른 경로로 찾아도 기회 ID는 하나이고 발견 경로만 늘어난다.
    category: constraint
    applies_to: Opportunity, DiscoveryPath
    trigger: import-case(같은 caseId 재투입, 발견 경로 여러 건)
    logic: caseId가 같으면 Opportunity를 재사용하고(값 덮어씀) 자식 행은 BR1.7의 supersededAt 규칙으로 교체한다. DiscoveryPath는 (sourceId, originKey)가 같은 현재 행이 있으면 그대로 두고 다를 때만 추가한다. U1에서 자동 병합(FR2.4)은 하지 않고 U3이 한다.
    violation: 같은 caseId로 기회가 둘 생기면 결함(S02).
    source: FR2.3, AC3.1.1
  - id: BR2.5
    statement: 기회-공정 연결은 (기회, 공정) 쌍당 하나이며 현재 결과(통과/확인 대기/제외)는 평가에서 파생된 값이고 원본은 평가 기록이다.
    category: constraint
    applies_to: OppProcessLink
    trigger: import-case, run_evaluation 뒤 갱신
    logic: 평가 저장 뒤 EvaluationLedger가 RequirementCheck 결과를 연결별로 모아 currentResult·currentReason·sourceEvalId를 갱신한다. 조회 시 sourceEvalId가 최신 확정 평가와 다르면 RequirementCheck 원본으로 다시 계산해 돌려주고 불일치를 로그에 남긴다.
    violation: 같은 쌍이 둘이면 투입 오류.
    source: FR2.5, AC3.1.3, ADR-007
  - id: BR2.6
    statement: 고객 요구의 수준(필수/우대/비요구/미확인)과 필요 단계(지금/나중/단계 미확인)는 파일에 적힌 값만 쓰고, 같은 산업이라는 이유로 짐작해 채우지 않는다.
    category: policy
    applies_to: Requirement
    trigger: import-case
    logic: IF reqLevel 또는 neededStage가 비어 있으면 THEN UNKNOWN으로 저장(추정하지 않음). proposedBy=FILE.
    violation: 기본값을 REQUIRED/NOW로 채우면 결함(S07).
    source: FR3.1, AC5.2.1, CON 기획서 5.2.1
  - id: BR2.7
    statement: 접촉 이력은 고객에 속하고 이 기회에 연결된 것만 이 기회의 평가 입력(linkedInteractionKinds)에 들어가며, 같은 고객의 다른 프로젝트 이력은 점수에 들어가지 않는다. 고객 관계와 대응 목적은 따로 저장한다.
    category: policy
    applies_to: Interaction, Opportunity, Customer
    trigger: 스냅샷 생성
    logic: EvaluationInput.opportunity.hasLinkedInteraction = 이 기회(oppId)에 연결된 Interaction이 1건 이상. U1의 신규 프로필 계산은 이 값을 점수에 쓰지 않고 표시(고객 관계 "기존 (2024년 아연도금 견적)")와 프로필 선택(FR4.1: 연결 이력 없으면 NEW)에만 쓴다.
    violation: 다른 기회의 이력으로 점수가 오르면 결함(S04).
    source: FR2.2, FR2.7, FR4.1, AC3.2.1
  - id: BR2.8
    statement: 평가 기준일은 명령 인자 → 사례 파일의 baseDate → 오늘 순으로 정하고, verify-case는 파일의 baseDate로 평가한다.
    category: policy
    applies_to: EvaluationBatch.baseDate, CaseFile
    trigger: evaluate, verify-case
    logic: IF --base-date가 있으면 그 값, ELSE IF 평가 대상 사례 파일에 baseDate가 있으면 그 값(여러 기회를 한 묶음으로 돌릴 때는 명령 인자 또는 오늘), ELSE 오늘(Asia/Seoul). 기준일은 묶음에 기록한다.
    violation: 기준일 없이 감쇠를 계산하면 결함.
    source: Q4 A, FR4.3, NFR12, C7·C8 갱신 제안
  - id: BR2.9
    statement: check-case는 저장 없이 파일 검사(BR2.1·BR2.2·BR2.3의 파일 안 참조)만 하고 DB 없이 동작한다.
    category: policy
    applies_to: OperatorCommands
    trigger: geosan check-case
    logic: import-case와 같은 검사기를 쓰되 저장 단계를 건너뛰고 종료 코드 0/1을 돌려준다. 파일 밖 참조(processCode 존재 여부)는 역량 파일을 함께 주면 검사하고 없으면 "역량 파일 없이 검사함" 안내.
    violation: check-case가 DB에 무엇이든 쓰면 결함.
    source: Q8 A, C8 갱신 제안

  # ===== BR3. 요구 판정·필터 =====
  - id: BR3.1
    statement: 평가 때마다 요구별 판정(통과/미확인/제외)을 별도 행으로 남기고 무엇과 대조했는지(자격 ID, 공정 연결 ID, 비교값)와 사유·기준일을 저장한다. "조건부 통과" 같은 중간 상태는 없다.
    category: constraint
    applies_to: RequirementCheck
    trigger: run_evaluation
    logic: 요구마다 RequirementCheck 1행. result ∈ {PASS, UNKNOWN, EXCLUDED}.
    violation: 중간 상태 값이 저장되면 결함.
    source: FR3.2, AC1.3.5
  - id: BR3.2
    statement: 인증·승인 요구의 '통과'는 검수 완료된 자격이 명칭·판본·보유 주체·사업장·적용 범위(대조 공정 또는 기회/고객)·유효기간(기준일 포함)·현재 상태(ACTIVE) 모두 맞을 때만이다. 하나라도 모르면 '미확인', 없거나 범위가 안 맞는다고 확인되면 '제외'다. 한 인증의 통과가 다른 요구의 통과를 뜻하지 않는다.
    category: calculation
    applies_to: RequirementCheck (reqKind CERTIFICATION, APPROVAL)
    trigger: run_evaluation
    logic: 후보 자격 = officialName(과 edition이 있으면 edition)이 요구 name·edition과 같은 Qualification. IF 후보 없음 THEN UNKNOWN(사유 "해당 자격 등록 없음"). ELSE 각 조건을 검사: Qualification.reviewStatus=REVIEWED, holder·site 확인(요구에 값이 있으면 비교, 없으면 자격 값 사용), 적용 범위 행이 있고 그 행의 reviewStatus=REVIEWED이며 applicability=APPLIES(BR1.4), validFrom ≤ baseDate ≤ validTo(validTo 없으면 미확인), 현재 상태 ACTIVE(BR1.5). 모두 참 → PASS. 어느 하나가 "확인된 불일치"(REVIEWED 범위 행의 NOT_APPLIES, 만료일 지남, CANCELLED/EXPIRED) → EXCLUDED. 나머지(검수 대기 값 포함) → UNKNOWN.
    violation: 검수 전 값이나 범위 밖 자격으로 PASS가 나오면 결함(S08·S13).
    source: FR3.3, AC5.2.1, AC5.2.2, AC5.2.5
  - id: BR3.3
    statement: 판정은 화면 표시값(checkDisplay)으로 함께 변환해 낸다.
    category: calculation
    applies_to: RequirementCheck.displayResult
    trigger: run_evaluation
    logic: EXCLUDED → EXCLUDED; reqLevel=REQUIRED이고 neededStage=UNKNOWN → PENDING_BLOCKS(판정이 PASS여도; FR3.5 "필수인데 단계가 불명확하면 확인 대기"); PASS → PASS; UNKNOWN이고 reqLevel=UNKNOWN → QUESTION_NEEDED(승인 안 막음); UNKNOWN이고 neededStage=LATER → LATER_STAGE; UNKNOWN이고 reqLevel=REQUIRED이고 neededStage=NOW → PENDING_BLOCKS(승인 막음); 그 밖의 UNKNOWN(PREFERRED, NOT_REQUIRED) → QUESTION_NEEDED. (계약 C1의 변환 규칙에 "REQUIRED·단계 미확인 → PENDING_BLOCKS 우선" 한 줄을 더하는 보강이며 PM 확인 뒤 약속 파일에 반영한다.)
    violation: 표시값과 판정이 어긋나면 결함.
    source: C1 요구 판정 표시 변환, FR3.4
  - id: BR3.4
    statement: 기회의 필터 상태 한 문장 규칙 — 지금 단계 필수 요구 중 거산 충족 판정이 '미확인'이거나 필요 단계가 '단계 미확인'인 것이 하나라도 있으면 "확인 대기"이고, 요구 수준 자체가 '미확인'인 요구는 필터에 영향 없이 질문으로만 남는다. 제외 판정이 있으면 "제외"다.
    category: calculation
    applies_to: EvaluationRun.filterState
    trigger: run_evaluation
    logic: IF 기업 전체 제한(companyFilterStatus=EXCLUDED) 또는 어느 **필수**(reqLevel=REQUIRED, neededStage ∈ {NOW, UNKNOWN}) 요구 result=EXCLUDED(제외 범위 BR3.7) 또는 모든 공정 연결이 EXCLUDED THEN EXCLUDED. 우대·비요구·수준 미확인 요구의 EXCLUDED는 표시만 하고 필터·승인에 영향 없음(사유에 "우대 요구 미충족 (승인은 막지 않음)"). ELSE IF ∃ 요구: reqLevel=REQUIRED ∧ ( neededStage=UNKNOWN ∨ (neededStage=NOW ∧ result=UNKNOWN) ) THEN PENDING — 단계 미확인인 필수 요구는 판정이 PASS여도 막는다(FR3.5, AC5.2.3). ELSE IF 관계 미확인(BR3.10) THEN PENDING. ELSE PASS. reqLevel=UNKNOWN인 요구는 어느 분기에도 들어가지 않는다. A정밀: ISO 9001(REQUIRED·NOW·PASS) → 필터 통과, 샘플 승인(REQUIRED·LATER) → 영향 없음, Nadcap(UNKNOWN) → 질문만.
    violation: Nadcap(미확인 수준)이 필터를 막으면 결함(AC5.2.1).
    source: FR3.4, AC5.2.1, AC5.2.2, AC5.2.3
  - id: BR3.5
    statement: 나중 단계(샘플·양산)에 필요하다고 확인된 요구는 지금 판정에서 빼고 "후속 단계 미완료"로 함께 표시하며, 필수인데 단계가 불명확한 요구는 '확인 대기'다.
    category: calculation
    applies_to: RequirementCheck
    trigger: run_evaluation
    logic: IF neededStage=LATER THEN stageJudged=LATER, result는 자격 대조 결과와 무관하게 UNKNOWN, displayResult=LATER_STAGE, followUpCondition="후속 단계 미완료(<단계>)". 필터 상태에 영향 없음. IF reqLevel=REQUIRED ∧ neededStage=UNKNOWN THEN PENDING_BLOCKS(BR3.4).
    violation: "나중에 받아도 된다"고 짐작해 통과시키면 결함.
    source: FR3.5, AC5.2.1(샘플 승인), AC5.2.3
  - id: BR3.6
    statement: 기술 조건(두께·치수·시험 등)도 지금 단계 필수로 확인됐으면 검수된 사양과 대조한다. 검수된 사양이 명백히 안 맞으면 해당 공정 연결 제외, 근거가 없으면 확인 대기이고, 수량·납기·생산 여력은 담당자가 확인한 상태만 기록하고 시스템이 계산하지 않는다.
    category: calculation
    applies_to: RequirementCheck (reqKind TECHNICAL, QUANTITY_DELIVERY)
    trigger: run_evaluation
    logic: TECHNICAL: 대조 대상 = linkId의 공정의 ProcessCapability 중 capKind=SPEC ∧ isDescriptiveOnly=false ∧ unit 일치 ∧ name 일치(요구 name과 설정의 대응표). IF 대상 없음 또는 reviewStatus≠REVIEWED THEN UNKNOWN. ELSE IF requiredValue가 [numericMin, numericMax] 안이면 PASS, 밖이면 EXCLUDED(scopeJudged=PROCESS_LINK, 제외 범위 LINK). QUANTITY_DELIVERY: result=UNKNOWN 고정, staffConfirmedState만 표시, 필터·점수에 영향 없음.
    violation: 수량·납기를 시스템이 통과·제외 판정하면 결함(CON-23).
    source: FR3.6, AC5.2.6, CON-23
  - id: BR3.7
    statement: 제외의 범위는 원인에 맞춘다 — 기업 전체 제한은 기업과 모든 기회에, 프로젝트 제한은 해당 기회에, 소재·공정 불일치는 해당 공정 연결에만 적용하고 같은 기회의 다른 공정 연결은 따로 판정한다.
    category: calculation
    applies_to: EvaluationRun.exclusionScope, OppProcessLink.currentResult
    trigger: run_evaluation
    logic: companyFilterStatus=EXCLUDED → COMPANY(기회 전체 EXCLUDED). 기회 단위 요구(scopeKind=OPPORTUNITY) EXCLUDED → OPPORTUNITY. 연결 단위 요구 또는 소재 불일치(appliedMaterial ∉ Process.materialCodes, 둘 다 REVIEWED일 때) → LINK: 그 연결만 EXCLUDED, 나머지 연결로 계속 평가. 기회의 filterState는 "남은 연결이 하나라도 PASS/PENDING이면 그 상태, 모두 EXCLUDED면 EXCLUDED".
    violation: 한 연결의 소재 불일치로 기회 전체가 제외되면 결함(S09).
    source: FR3.7, AC5.2.4
  - id: BR3.8
    statement: 자격의 정지·취소가 확인되면 영향받는 기회를 재평가하되 이전 평가는 보존한다. U1에서는 "새 상태 행 투입 → evaluate 재실행"으로 같은 효과를 낸다(검수 전환 흐름 ②는 U4).
    category: policy
    applies_to: QualificationStatus, EvaluationRun
    trigger: evaluate 재실행
    logic: 재실행은 새 묶음·새 평가를 만들고 previousEvalId로 이전 평가를 가리킨다(BR7.2).
    violation: 이전 평가가 덮어써지면 결함(S11).
    source: FR3.8, AC5.2.5, AC8.1.2
  - id: BR3.9
    statement: 필수 자격이 없어 제외된 기회에 재검토 조건·근거·담당자·예정일을 기록할 수 있고(U1은 파일 값), 새 근거가 확인되면 같은 기회 ID로 재평가하며 취득 의향만으로 점수를 올리지 않는다.
    category: policy
    applies_to: Opportunity.reviewCondition/reviewOwner/reviewDueAt
    trigger: import-case, evaluate
    logic: 재검토 조건은 점수·분류 계산에 들어가지 않는다. 재평가는 같은 oppId의 새 평가로 한다("중장기 기회"로 복제하지 않음).
    violation: 취득 의향으로 점수가 오르면 결함(S14).
    source: FR3.9, AC5.2.7, AC8.2.2
  - id: BR3.10
    statement: 관계 미확인 고객의 기회는 참고 점수만 계산하고 분류는 "기다리는 중(확인 필요)"(필터 확인 대기)이며 접촉 승인이 막힌다.
    category: calculation
    applies_to: EvaluationRun
    trigger: run_evaluation
    logic: IF Customer.relationStatus=UNCONFIRMED THEN 점수(E/P/R/S)는 계산하되 filterState=PENDING, classificationCode=FILTER_PENDING, blockerText="거래 관계 확인 전 (승인 막힘)".
    violation: 관계 미확인 기회가 접촉 후보로 분류되면 결함(S06).
    source: FR4.1, AC3.2.2

  # ===== BR4. 항목 점수·합계 =====
  - id: BR4.1
    statement: 항목 점수 = 배점 × 일치도 × 확실도 × 시점 감쇠. 소수 첫째 자리에서 반올림한 정수(0.5는 올림, HALF_UP). 적합도 항목의 감쇠는 1.
    category: calculation
    applies_to: ItemJudgment.score
    trigger: run_evaluation
    logic: 신규 프로필 8항목(부록 A.1): NEW_PRODUCT 25, NEW_MATERIAL 20, NEW_RECORD 15, NEW_PERF 10, SIG_EXPAND 10, SIG_ORDER 8, SIG_BID 7, SIG_HIRE 5 (적합도 70 + 시점 30). U1 입력은 사례 파일 itemInputs를 저장한 ItemJudgmentInput(기회당 8행, 최신 version: 상태·일치도·근거 참조·대조 거산 값 ID)이며 EvaluationLedger가 스냅샷에 `itemInputs`로 넣는다(C3 EvaluationInput에 더하는 키). 확실도 계수는 state(CONFIRMED/STRONG/WEAK)에서, 시점 항목의 감쇠는 신호 날짜와 기준일로 시스템이 계산한다(BR4.4). 예: 납품실적 15 × 0.67 × 1.0 × 1 = 10.05 → 10.
    violation: 10.05가 10이 아니면 결함(AC5.1.4).
    source: FR4.2, FR4.5, 부록 A.1, AC5.1.4
  - id: BR4.2
    statement: 일치도는 항목별 고정 단계값만 허용하고 자유로운 소수를 받지 않는다.
    category: validation
    applies_to: ItemJudgment.matchRate, CaseFile.itemInputs
    trigger: check-case, import-case, run_evaluation
    logic: NEW_PRODUCT {해당 1.0}; NEW_MATERIAL {정확히 일치 1.0, 일부 가능 0.5}; NEW_RECORD {동일 부품 1.0, 동일 산업 0.67, 인접 산업 0.33}; NEW_PERF {2개 이상 일치 1.0, 1개 일치 0.5}; SIG_* {직접 관련 1.0, 간접 관련 0.5}. 단계 밖 값은 투입 오류. 단계 어느 것에도 해당하지 않음이 확인되면 state=MISMATCH 0점, 해당 여부를 모르면 UNAVAILABLE.
    violation: 0.8 같은 값이 저장되면 결함.
    source: FR4.2, 부록 A.1·A.3
  - id: BR4.3
    statement: 확실도는 확인 1.0 / 강한 추정 0.65 / 약한 추정 0.25이며, 등급 기준은 확인 = A/B등급 자료가 직접 명시, 강한 추정 = A/B 간접 근거 또는 독립 C등급 2건, 약한 추정 = C 단독 또는 업종·제품 특성 추정이다.
    category: calculation
    applies_to: ItemJudgment.certainty
    trigger: run_evaluation
    logic: 설정값 certainty {CONFIRMED 1.0, STRONG 0.65, WEAK 0.25}. 상태 CONFIRMED/STRONG/WEAK가 각각 대응. D등급 단독 근거는 확인 대기(UNAVAILABLE).
    violation: 다른 계수를 쓰면 결함.
    source: FR4.2, 부록 A.3, FR5.6
  - id: BR4.4
    statement: 시점 감쇠 — 일반 외부 사건은 실제 발생일 기준 0~30일 1.0 / 31~90일 0.5 / 91일 이상 0. 공고는 마감 전 1.0, 마감·취소 후 0, 마감 여부 미상은 미확보. 채용은 종료·채용 완료 0. 발생일 미상은 미확보이며 수집일·확인일로 대신하지 않는다. 기준일보다 뒤의 예정 사건은 가점하지 않고 미확보로 둔다.
    category: calculation
    applies_to: ItemJudgment.decay (SIG_EXPAND, SIG_ORDER, SIG_BID, SIG_HIRE)
    trigger: run_evaluation
    logic: 항목이 쓰는 신호 = ItemJudgmentInput.signalIds의 현재 Signal 행 중 종류가 맞는 것. 여럿이면 대표 신호 하나를 고른다 — SIG_EXPAND/SIG_ORDER/SIG_HIRE는 occurredAt ≤ baseDate인 것 중 가장 최근, SIG_BID는 deadlineAt ≥ baseDate인 것 중 가장 이른 마감(없으면 가장 최근 마감). 감쇠·relation·validUntil은 대표 신호로 계산하고 JudgmentEvidence에는 연결된 모든 신호의 근거를 남긴다. days = baseDate − 대표 신호.occurredAt. SIG_EXPAND/SIG_ORDER/SIG_HIRE: occurredAt 없음 → UNAVAILABLE; occurredAt > baseDate → UNAVAILABLE(예정 사건); days 0~30 → 1.0; 31~90 → 0.5; ≥91 → 0; HIRING이 progressStatus ∈ {CLOSED, DONE} → 0. SIG_BID: deadlineAt 없음 → UNAVAILABLE; progressStatus ∈ {CLOSED, CANCELLED} 또는 deadlineAt < baseDate → 0; 그 밖 → 1.0. 신호가 없으면 state=NO_SIGNAL 0점(판정 완료).
    violation: 수집일로 감쇠를 계산하면 결함(NFR12).
    source: FR4.3, 부록 A.1·A.3, NFR12, AC2.3.1
  - id: BR4.5
    statement: 항목 상태는 확인/강한 추정/약한 추정/불일치/가점 없음/신호 없음/미확보 일곱 가지이며, 앞 여섯은 판정 완료(점수 정수), 미확보만 점수 NULL이다. 미확보 항목도 행을 남겨 완료율 분모가 줄지 않는다.
    category: constraint
    applies_to: ItemJudgment
    trigger: run_evaluation
    logic: 평가마다 8항목 행을 모두 만든다. MISMATCH/NO_BONUS/NO_SIGNAL → score 0. UNAVAILABLE → score null, P 분모에서 제외.
    violation: 항목 행이 8개 미만이면 결함.
    source: FR4.4, 부록 A.3
  - id: BR4.6
    statement: F(적합 합), T(시점 합), E=F+T, P(판정 완료 항목의 배점 합), S=E÷P×100(P=0이면 "산정 전"), C(완료 항목 수÷전체×100), W=P, R=E+미확보 배점 합+Σ(추정 항목을 확실도 1.0으로 재계산한 점수−현재 점수). 0≤E≤P≤100, E≤R≤100을 검증한다. S·C는 소수 첫째 자리(HALF_UP)까지 표시하되 분기에는 반올림한 S가 아니라 원래 E·P·R을 쓴다.
    category: calculation
    applies_to: EvaluationRun 합계
    trigger: run_evaluation
    logic: 합계는 정수 합. S = round_half_up(E/P×100, 1). 검증 실패 시 평가 FAILED로 두고 사유 출력(저장은 되돌림).
    violation: 반올림이 은행가식(짝수 반올림)이면 결함(81.05 → 81.1이어야 함).
    source: FR4.5, 부록 A.3
  - id: BR4.7
    statement: A정밀 가상 사례 입력은 E 77 / P 95 / S 81.1 / R 82, 필터 통과, 핵심 근거 충족, 시점 우선 접촉 후보를 내야 하고, 읽기 예시 2(25점 한 항목만 확인, 나머지 미확보)는 E 25 / P 25 / S 100 / C 12.5이며 접촉 후보가 아니어야 한다.
    category: constraint
    applies_to: 규칙 엔진 테스트 기대값
    trigger: verify-case, 시나리오 테스트
    logic: 역산 입력(FR10.1): 제품 25(1.0 확인) / 소재 20(1.0 확인) / 납품실적 15×0.67=10 / 성능 10×0.5=5 / 증설 10(1.0, 0~30일) / 신규 수주 8(신호 없음 0, 판정 완료) / 공고 7(마감 전 1.0) / 채용 5(미확보). F=60, T=17, E=77, P=95, R=77+5=82, S=81.05→81.1. 기대값은 "역산한 가정값, 규칙서 F.7 확인 전, 증설 신호는 가상 추가"로 표시한다.
    violation: 기대값 불일치는 뼈대 미완성.
    source: FR4.13, FR10.1, AC5.1.1, AC5.1.3, project.md 학습 메모
  - id: BR4.8
    statement: 같은 확정 입력·기준일·규칙 버전·검수 값이면 결과(E/F/T/P/R/S/C, 분류, 순위)가 100% 같다. 규칙 엔진은 DB·파일·네트워크를 쓰지 않는 순수 계산이다.
    category: constraint
    applies_to: RuleEngine
    trigger: 모든 평가
    logic: 입력 스냅샷(C3 EvaluationInput)만 받고 결과 구조체(EvaluationOutput)만 돌려준다. 현재 시각·난수·외부 조회 금지. 기준일은 입력으로 받는다.
    violation: 두 번 실행 결과가 다르면 결함(AC5.1.2).
    source: NFR1, AC5.1.2, C3

  # ===== BR5. 핵심 근거·시점 우선·운영 전제·조사 요건 =====
  - id: BR5.1
    statement: 핵심 근거(신규 프로필)는 "제품·부품 근거"(NEW_PRODUCT)와 "고객 소재/공정 연결 근거"(NEW_MATERIAL)가 각각 확인 또는 강한 추정이고, 그 판정에 쓰인 거산 공정·소재 근거가 검수 완료일 때 충족이다. 핵심 묶음이 약한 추정·미확보뿐이면 "핵심 근거 재확인"으로 접촉 분기를 통과하지 않는다.
    category: calculation
    applies_to: EvaluationRun.coreEvidenceMet
    trigger: run_evaluation
    logic: MET ⇔ state(NEW_PRODUCT) ∈ {CONFIRMED, STRONG} ∧ state(NEW_MATERIAL) ∈ {CONFIRMED, STRONG} ∧ usedCapabilityIds(NEW_MATERIAL)의 Process·ProcessCapability가 모두 REVIEWED. 아니면 RECHECK(displayFlags.coreEvidenceRecheck=true).
    violation: 약한 추정 소재 근거로 접촉 분기에 들어가면 결함(AC5.3.2).
    source: FR4.6, 부록 A.3, AC5.3.2
  - id: BR5.2
    statement: 시점 우선 요건 ① "기회와 직접 연결된 행동 신호(모집·구매 요청·합의된 후속 연락)가 직접 확인됨"은 시스템이 판정한다.
    category: calculation
    applies_to: EvaluationRun.timingRequirements.directSignal
    trigger: run_evaluation
    logic: directSignal ⇔ ∃ Signal: signalKind ∈ {BID, NEW_ORDER, NEXT_CONTACT} ∧ relation=DIRECT ∧ certainty=CONFIRMED ∧ (BID이면 deadlineAt ≥ baseDate ∧ progressStatus ∉ {CLOSED, CANCELLED}). Signal.relation(DIRECT/INDIRECT)·scheduledAt·announcedAt은 사례 파일 signals와 C3 신호 입력에 더하는 키다(PM 확인 뒤 약속 파일 반영). A정밀: 공고(BID, DIRECT, CONFIRMED, 마감 3주 뒤) → 참.
    violation: 간접 관련 신호로 ①이 충족되면 결함.
    source: FR4.7 ①
  - id: BR5.3
    statement: 시점 우선 요건 ② "현재 유효성·마감을 확인했고 합의한 실행기간 안에 대응해야 함"은 합의값(agreedWindow)이 있어야 충족이며, G0 합의 전 실제 후보는 미충족으로 두고 가상 사례는 데이터에 넣은 가상 합의값으로 판정한다. 임의의 "7일 이내" 같은 날짜 기준을 코드에 넣지 않는다.
    category: calculation
    applies_to: timingRequirements.agreedWindow
    trigger: run_evaluation
    logic: agreedWindow ⇔ ①을 만든 신호에 agreedWindow 값이 있고 (deadlineAt 또는 scheduledAt) − baseDate ≤ agreedWindow.days. 설정 timingRequirements.agreedWindowRequired=true.
    violation: 합의값 없이 ②가 참이면 결함(AC2.3.3).
    source: FR4.7 ②, AC2.3.3, A8
  - id: BR5.4
    statement: 시점 우선 요건 ③ "준비시간을 고려해 기한 내 대응 가능"은 담당자 체크(ReadinessCheck.checked)로 판정하며, 시스템은 그 전에 필수 요구 통과와 관계·중복 확인을 먼저 판정해 둔다.
    category: calculation
    applies_to: timingRequirements.readiness
    trigger: run_evaluation
    logic: readiness ⇔ 현재 ReadinessCheck(resetAt 없음)가 있고 checked=true. 체크 처리 규칙은 BR7.4.
    violation: 체크 없이 ③이 참이면 결함(AC5.3.1 둘째 문장).
    source: FR4.7 ③, AC5.3.1
  - id: BR5.5
    statement: 운영 전제는 "이 평가가 쓴 거산 값이 모두 검수 완료(가상 검수 포함)이고 쓰인 근거 자료가 모두 사용 허용"이면 충족이며, 사용 허용은 보안 등급이 공개/외부 AI 허용/내부 구조화만 중 하나로 확인된 상태다. 처리 금지·미확인 근거는 사용 허용이 아니다.
    category: calculation
    applies_to: EvaluationRun.operationalReady
    trigger: 스냅샷 생성(EvaluationLedger가 계산해 입력으로 넘김)
    logic: operationalReady ⇔ 스냅샷의 모든 usedCapabilityIds 값 reviewStatus=REVIEWED ∧ 스냅샷에 들어간 모든 Evidence.securityGrade ∈ {PUBLIC, EXTERNAL_AI_OK, INTERNAL_ONLY}. FORBIDDEN 자료는 스냅샷에 원문을 넣지 않는다(BR7.3).
    violation: 미확인 등급 근거로 운영 전제가 참이면 결함.
    source: FR4.8, FR5.6
  - id: BR5.6
    statement: 거산 값 묶음이 '소개서'(BROCHURE, 검수 대기)인 평가는 지금 단계 필수 요구가 있으면 "기다리는 중(확인 대기)"(②), 없으면 "준비 중"(③)으로 분류하고, 참고 점수·"거산 확인 전" 띠·확인 대기 질문을 보이며 접촉 승인을 열지 않는다.
    category: calculation
    applies_to: EvaluationRun (datasetKind=BROCHURE)
    trigger: run_evaluation
    logic: BROCHURE 묶음에서는 BR1.3에 따라 자격이 PENDING이라 필수 요구 판정이 UNKNOWN → BR3.4로 FILTER_PENDING(②). 필수 요구가 없으면 BR5.5의 운영 전제가 거짓 → OPS_PENDING(③). 점수는 계산해 scores에 둔다. displayFlags.brochureDataset=true, blocksApproval=true. 10월 말 부분 시연의 실제 기업은 모두 이 규칙을 탄다.
    violation: 소개서 묶음 기회가 접촉 후보가 되면 결함(AC5.3.6).
    source: FR4.14, AC5.3.6, AC10.3.1, A12
  - id: BR5.7
    statement: 추가조사(⑧)는 다섯 가지가 모두 있을 때만이다 — 관련 A~C등급 근거 1건 이상 / 구체 질문 묶음 / 허용된 확인 경로와 담당자 / E·P·핵심 근거를 통해 분류를 바꿀 수 있는 질문 / 합의한 조사시간 안의 실행 여력(예상 시간 ≤ 시간 상한). 하나라도 부족하면 조건부 대기(⑨)이며 부족 요건·재개 조건을 기록한다.
    category: calculation
    applies_to: EvaluationRun.researchReady
    trigger: run_evaluation
    logic: researchReady ⇔ hasGradedEvidence(스냅샷 Evidence 중 sourceGrade ∈ {A,B,C} 1건 이상) ∧ ResearchTask.questionSet 비어 있지 않음 ∧ allowedChannel·owner 있음 ∧ canChangeClass=true ∧ estimatedHours ≤ maxHours(없으면 설정 maxHoursDefault 2시간, 가설). U1은 ResearchTask 값을 파일로 받는다. 부족 요건 목록을 reason에 남긴다.
    violation: 요건 넷만 충족인데 ⑧이면 결함(AC5.3.3).
    source: FR4.9, 부록 A.3, AC5.3.3, AC9.5.2

  # ===== BR6. 분류 11분기·정렬 =====
  - id: BR6.1
    statement: 분류는 순서대로 처음 해당하는 하나다 — ① 필터 제외 → ② 필터 미확인(확인 대기) → ③ 운영 전제 미확정 → ④ P=0(초기 평가 대기) → ⑤ E≥75 + 핵심 근거 + 시점 우선 세 요건 = 시점 우선 접촉 → ⑥ E≥75 + 핵심 근거 = 계획형 접촉 → ⑦ E≥60, P≥70 + 핵심 근거 = 검토 후 접촉 → ⑧ P>0, R≥60 + 조사 요건 충족 = 추가조사 → ⑨ P>0, R≥60 + 일부 미충족 = 조건부 대기 → ⑩ 40≤R<60 = 관찰 → ⑪ R<40 = 후순위.
    category: calculation
    applies_to: EvaluationRun.classificationCode
    trigger: run_evaluation
    logic: 기준점은 설정값 thresholds {urgentE 75, plannedE 75, reviewE 60, reviewP 70, researchR 60, watchRMin 40}(가설). 코드: FILTER_EXCLUDED, FILTER_PENDING, OPS_PENDING, NOT_EVALUATED, CONTACT_URGENT, CONTACT_PLANNED, CONTACT_REVIEW, RESEARCH, CONDITIONAL_WAIT, WATCH, LOW. 비교는 반올림 전 E·P·R 정수값.
    violation: 순서를 바꾸거나 기준점을 코드에 박으면 결함.
    source: FR4.10, 부록 A.3, AC5.3.1, AC5.3.3, AC5.3.4
  - id: BR6.2
    statement: 핵심 근거가 약하면(RECHECK) ⑤~⑦ 대신 "핵심 근거 재확인"으로 표시하고 ⑧ 이후로 넘긴다.
    category: calculation
    applies_to: classificationCode, displayFlags.coreEvidenceRecheck
    trigger: run_evaluation
    logic: IF coreEvidenceMet=RECHECK THEN ⑤·⑥·⑦ 분기를 건너뛰고 ⑧부터 판정, 카드·상세에 "근거 다시 확인" 표시. E 80이어도 접촉 후보가 아니다.
    violation: 재확인 상태에서 접촉 후보가 되면 결함(AC5.3.2).
    source: FR4.6, FR4.10, AC5.3.2
  - id: BR6.3
    statement: 11개 분기 코드와 쉬운 말 문구는 DB·API·화면·파일이 같은 코드표를 쓴다. 저장·전송은 영문 코드, 화면은 코드표로 쉬운 말.
    category: constraint
    applies_to: ClassificationCode, 모든 상태 값
    trigger: 저장·응답·표시
    logic: 쉬운 말 초기값(팀 제안, 설정에서 변경): CONTACT_URGENT "지금 바로 연락 검토", CONTACT_PLANNED "계획해서 연락 검토", CONTACT_REVIEW "확인 후 연락 검토", RESEARCH "더 알아봐야 함", CONDITIONAL_WAIT "조건 갖춰지면 다시 봄", WATCH "지켜보는 중", LOW "나중에", FILTER_PENDING "기다리는 중 (확인 필요)", OPS_PENDING "준비 중", FILTER_EXCLUDED "대상 아님(제외)", NOT_EVALUATED "평가 전".
    violation: 화면에 코드표 밖 문구가 있으면 결함(AC5.3.7).
    source: FR4.10, C0, AC5.3.7, AC6.2.5
  - id: BR6.4
    statement: 정렬 — 신규 기회와 재접촉 목록을 분리하고 섞지 않는다. 접촉 분류 순서는 시점 우선 → 계획형 → 검토 후. 시점 우선 안은 유효 접촉 기한 오름차순 → E → F → 직접 확인 배점 → P → 기회 ID, 계획형 안은 E → F → 직접 확인 배점 → P → 기회 ID, 검토 후 안은 E → F → 직접 확인 배점 → P → 유효 기한 → 기회 ID(E·F·배점·P는 내림). 직접 확인 배점은 '확인' 상태 항목의 원래 배점 합이고 S는 정렬 키가 아니다.
    category: calculation
    applies_to: EvaluationRun.originalRank, sortKey
    trigger: run_evaluation(묶음 단위 rank)
    logic: group URGENT/PLANNED/REVIEW/OTHER. validUntil = ①을 만든 신호의 deadlineAt 또는 scheduledAt 중 가장 이른 날. directConfirmedWeight = Σ weight(state=CONFIRMED). originalRank는 묶음 안 1부터.
    violation: S로 정렬하거나 두 프로필이 섞이면 결함(AC5.3.5).
    source: FR4.11, C3 rank, AC5.3.5
  - id: BR6.5
    statement: 접촉 후보가 아닌 분류(OTHER 그룹)의 정렬은 모든 거산 값 묶음에서 E 내림 → P(판정한 배점) 내림 → 기회 ID다(2026-10-25 PM 결정, #63 원칙 2: 동점이면 더 많이 확인한 회사를 앞에 두고, 가능 점수 R은 정렬에 쓰지 않는다. 그 전에는 default R → E, 소개서 E → R 순이었다. default의 R 먼저는 '조사 우선순위' 용도였고 그 역할은 11월 세 묶음 안의 ②가 맡는다). 이것은 기획서 부록 F에 없는 화면용 규칙이라 '가설·설정값'(`otherGroupSort`)으로 둔다.
    category: calculation
    applies_to: sortKey (OTHER 안 정렬·전체 그룹의 기존 거래처 배치)
    trigger: run_evaluation(rank)
    logic: 설정 otherGroupSort {default: [E desc, P desc, oppId], brochure: [E desc, P desc, oppId]}는 그대로다. 모든 그룹을 정렬한 뒤 existingCustomerPlacement=BOTTOM(기본)이면 relationStatus=EXISTING_CONFIRMED인 기회만 맨 아래로 보내고 두 묶음 안의 기존 순서를 유지한다. INLINE이면 그룹 정렬 그대로다(v0.17-d, PM 승인 2026-11-04 #262). 점수·분류·단독 A정밀 기대값에는 영향 없음.
    violation: 설정 없이 코드에 고정하면 결함.
    source: Q6 A, C3 갱신 제안, FR4.11

  # ===== BR7. 평가 기록·재현·기한 체크 =====
  - id: BR7.1
    statement: 평가 묶음에는 프로필·기준일·규칙 설정 버전과 해시·코드 버전·LLM 실행 모드·거산 값 묶음을 저장하고, 묶음은 프로필별로 나누어 신규 기회와 재접촉이 섞이지 않으며 확정 묶음에는 같은 기회의 평가가 1건이다.
    category: constraint
    applies_to: EvaluationBatch
    trigger: run_evaluation
    logic: evaluate 한 번 = 묶음 하나(NEW). 대상이 전체면 scope FULL, --opp 목록이나 verify-case면 PARTIAL. 성공하면 CONFIRMED, 실패하면 FAILED(평가 행은 되돌림). 거산 값 묶음은 앱 설정 activeDatasetKind. 기회별 "최신 확정 평가"는 FULL·PARTIAL을 가리지 않고 가장 최근 CONFIRMED 평가다(계약 C1 카드 evalId 정의).
    violation: 묶음 없이 평가가 저장되면 결함(AC5.1.5).
    source: FR4.12, FR4.14, AC5.1.5
  - id: BR7.2
    statement: 평가마다 허용된 입력 스냅샷(해시 포함)·검수 값 버전·필터 상태·E/F/T/P/R/S/C·분류·원래 순위를 저장하고, 값이 바뀌면 새 평가를 만들며 이전 평가는 절대 덮어쓰지 않는다.
    category: constraint
    applies_to: EvaluationRun
    trigger: run_evaluation
    logic: 새 평가는 같은 기회의 직전 CONFIRMED 평가를 previousEvalId로 가리키고 그 평가를 SUPERSEDED로 표시한다(행은 그대로). 목록·상세는 "최신 CONFIRMED 묶음의 평가"를 쓴다.
    violation: UPDATE로 평가 값을 바꾸면 결함(S11, AC8.1.2).
    source: FR4.12, NFR5, AC5.1.5, AC8.1.1, AC8.1.2
  - id: BR7.3
    statement: 스냅샷에는 '처리 금지'와 사용 허용이 철회된 자료의 원문을 넣지 않고 ID와 차단 사유만 남기며, 조회 시에도 철회된 자료는 노출하지 않는다. 금지 원문은 로그에도 남기지 않는다.
    category: policy
    applies_to: EvaluationRun.inputSnapshot, Evidence 조회
    trigger: 스냅샷 생성, 근거 조회
    logic: Evidence.securityGrade=FORBIDDEN → 스냅샷 evidence 항목에 {evidenceId, blocked: true, reason}만. 상세의 근거 목록에서도 제외.
    violation: FORBIDDEN 원문이 스냅샷·응답·로그에 있으면 결함.
    source: NFR4, NFR5, components EvaluationLedger(R-03)
  - id: BR7.4
    statement: "기한 내 대응 가능" 체크는 담당자명·시각·체크 당시 평가 ID와 함께 평가 입력으로 저장되고 체크·해제하면 새 평가를 만든다. 파일로 넣은 체크는 평가 ID를 비워 두고 그 체크를 처음 쓰는 평가가 자기 ID를 채운다. 재평가 때 마감일(행동 신호의 기한)이나 지금 단계 필수 요구의 판정이 바뀌면 체크를 초기화하고 다시 확인을 요청하며, 그 밖의 변경에서는 유지한다. 초기화된 체크는 이전 평가 기록에 남는다.
    category: policy
    applies_to: ReadinessCheck
    trigger: import-case(파일 값), run_evaluation
    logic: 평가 시 현재 체크를 읽는다. IF evalIdAtCheck=null THEN 이 평가의 evalId로 채운다(Q1 A). ELSE 이전 평가(evalIdAtCheck)와 비교해 ①을 만든 신호의 deadlineAt이 달라졌거나 NOW·REQUIRED 요구 중 어느 result가 달라졌으면 resetReason·resetAt을 채우고(체크 무효) timing.readiness=false, 상세에 "조건이 바뀌어 다시 확인해 주세요". 그 밖(근거 추가, 점수 변동, 검수 완료 전환)은 유지.
    violation: 마감일 변경에도 체크가 유지되면 결함(AC7.3.4).
    source: FR4.7, Q1 A, AC5.3.1, AC7.3.4, C3 열린 질문
  - id: BR7.5
    statement: 평가 저장 → 공정 연결 현재 결과 갱신 → 확인 질문 후보 전달은 한 흐름(⓪) = 한 SQLite 트랜잭션이며, 중간 단계가 실패하면 전부 되돌리고 사유를 호출자에게 돌려준다.
    category: constraint
    applies_to: WorkflowRunner run_evaluation
    trigger: evaluate 명령
    logic: 외부 호출 없음(U1). 쓰기 잠금 대기 5초, 넘으면 실패·되돌림. 반환 FlowResult {ok, affectedOppIds, newEvalIds, error}.
    violation: 평가는 저장됐는데 질문 후보가 없는 상태가 남으면 결함.
    source: C2, ADR-009
  - id: BR7.6
    statement: 규칙 설정 파일은 버전·해시를 기록하고 고정(FIXED) 버전은 덮어쓰지 않으며, 설정이 없거나 형식이 틀리면 어떤 키가 잘못됐는지 알리고 기본값으로 조용히 대체하지 않는다. 모든 기준점·확실도·감쇠·핵심 근거·조사 요건·배점·단계값은 "기업 승인 전 가설" 표시와 함께 설정값이다.
    category: validation
    applies_to: RuleConfigVersion, check-config
    trigger: 서버 시작, evaluate, check-config
    logic: 파일 해시가 기록된 FIXED 버전과 다르면 새 버전으로만 등록. hypothesisNote 필수.
    violation: 기준점이 코드 상수로 있으면 결함(NFR11).
    source: NFR11, FR4.12, AC9.4.3

  # ===== BR8. 확인 질문 후보 =====
  - id: BR8.1
    statement: 평가가 쓴 거산 값이 '검수 대기'·'미확보'·'재확인'이거나 요구가 '미확인'(수준) 또는 '단계 미확인'이면 해당 기회·값에 연결된 확인 질문을 만든다. 질문은 예/아니요로 답할 수 있는 형태가 기본이며, 파일의 요구에 적힌 질문 문장은 이 조건에 해당할 때 그 문구로 쓴다. 통과·확인된 값에 대해서는 질문을 만들지 않는다.
    category: calculation
    applies_to: EvaluationOutput.questionCandidates, ConfirmationQuestion
    trigger: run_evaluation
    logic: 거산 값: 스냅샷의 usedCapabilityIds·대조한 qualId 중 reviewStatus ∈ {PENDING, UNAVAILABLE, RECHECK} → 질문(예: "ISO 9001 인증 범위에 아노다이징 라인이 포함됩니까?"). 요구: reqLevel=UNKNOWN → "<name>이(가) 필수입니까?"(Requirement.question 있으면 그 문장), neededStage=UNKNOWN → "<name>은(는) 어느 단계에 필요합니까?". 가상 검수 묶음 A정밀 → Nadcap 1개(Q2 A).
    violation: 통과한 ISO 9001에 질문이 생기면 결함(Q2).
    source: FR11.1, Q2 A, AC1.3.1, AC5.2.2
  - id: BR8.2
    statement: 질문은 대상 하나(targetKind + targetId)당 하나이며, 같은 대상 질문이 다른 평가에서 다시 나오면 질문을 새로 만들지 않고 기회 연결만 추가한다. sourceEvalId는 최초로 만든 평가다.
    category: constraint
    applies_to: ConfirmationQuestion, QuestionOpportunityLink
    trigger: run_evaluation 뒤 질문 후보 저장
    logic: upsert by (targetKind, targetId); 연결은 (questionId, oppId) 유일. effectIfAnswered 예: "검수 완료로 바뀌면 재평가".
    violation: 같은 대상 질문이 둘이면 결함.
    source: components ConfirmationDesk, FR11.1
  - id: BR8.3
    statement: 상세 화면 1번 영역에는 이 기회에 연결된 '대기' 질문을 3개까지 보이고 나머지는 "펼치기"로 보이며, 뼈대에서는 읽기 전용이다(거산 확인 요청·직접 추가는 U4).
    category: policy
    applies_to: 상세 응답 reasons.questions
    trigger: 상세 조회
    logic: 질문 정렬: 승인을 막는 요구(PENDING_BLOCKS) 관련 → 거산 값 → 수준 미확인 요구 순.
    violation: 4개 이상이 접히지 않으면 결함(AC6.2.6).
    source: AC6.2.6, FR6.2, Q10 stories

  # ===== BR9. 담당자 의견 =====
  - id: BR9.1
    statement: 내 의견은 검토할 만함 / 추가 확인 필요 / 대상 아님 중 하나와 짧은 메모(200자)이며, '대상 아님'은 사유(1~200자)가 필수다.
    category: validation
    applies_to: ReviewOpinion
    trigger: POST /opportunities/{oppId}/opinions
    logic: IF opinion=NOT_TARGET ∧ reason 비어 있음 THEN 400 fields[{path: reason, message: "사유를 적어 주세요"}], 저장 없음. memo·reason에 이메일·전화 패턴이 있으면 400 fields "연락처는 저장하지 않습니다"(BR2.1, CON-11).
    violation: 사유 없는 대상 아님이 저장되면 결함(AC7.1.2).
    source: FR7.2, FR6.3, AC7.1.2
  - id: BR9.2
    statement: 의견은 실제로 본 평가 ID를 필수로 저장하고, 그 평가가 낡았더라도(재평가됨) 저장한다. 본 평가 기록이 목적이다.
    category: constraint
    applies_to: ReviewOpinion.evalId
    trigger: 의견 저장
    logic: evalId가 그 기회의 평가(어느 묶음이든)로 존재해야 한다(존재 확인). 최신 여부는 검사하지 않는다(승인·기한 체크의 409 규칙은 U5).
    violation: evalId 없이 저장되거나 낡은 evalId가 거부되면 결함(AC7.1.4).
    source: FR7.1, C1 /opinions, AC7.1.1, AC7.1.4
  - id: BR9.3
    statement: 모든 기록은 담당자 키(X-Staff-Key)와 시각(시간대 포함, 화면은 한국 시각)을 저장한다. 담당자 키는 앱 설정 목록에 있어야 하고(없으면 403), 예약 키 viewer(보기 전용)는 기록 요청을 거부한다(403). 화면은 담당자명을 고르지 않으면 기록 버튼을 비활성하고 "먼저 담당자를 고르세요"를 글자로 보인다.
    category: authorization
    applies_to: WebApi 기록 경로, 화면 공통 틀
    trigger: 기록 요청
    logic: 보기 전용은 보안 기능이 아니라 실수 방지용(계정 없음, 알려진 잔여 위험 C1).
    violation: 목록 밖 키로 저장되면 결함(AC10.2.1).
    source: FR14.1, FR7.6, C1 공통, AC10.2.1, NFR12
  - id: BR9.4
    statement: 의견 수정은 새 행(previousOpinionId, version+1)으로 남기고 덮어쓰지 않는다. 요청의 expectedVersion이 서버의 현재 version보다 낡으면 저장은 하되 응답 meta.previousValue에 이전 값을 실어 "다른 담당자가 방금 바꿨습니다"를 보이게 한다(마지막 저장이 이김).
    category: policy
    applies_to: ReviewOpinion, 응답 RecordMeta
    trigger: 의견 저장
    logic: 응답 data = {version, updatedBy, updatedAt, opinion, reason, memo}. 409는 쓰지 않는다.
    violation: 이전 값이 사라지면 결함(AC7.1.5).
    source: FR7.6, C1 동시 수정, AC7.1.5
  - id: BR9.5
    statement: 다섯 기록(시스템 분류 / 내 의견 / 담기 / 접촉 승인 / 영업 결과)은 각각 다른 저장소이며, 의견을 저장해도 분류·평가·다른 기록은 바뀌지 않는다. 재평가로 분류가 바뀌어도 의견은 그대로이고 "어느 평가를 보고 낸 의견인지"가 남는다.
    category: constraint
    applies_to: rec_review_opinion, eval_run
    trigger: 의견 저장, 재평가
    logic: 의견 저장 흐름은 eval_·opp_ 테이블에 쓰지 않는다. 예외는 기한 체크(평가 입력, BR7.4)뿐이며 U1에서는 파일 값만.
    violation: 의견 저장이 분류를 바꾸면 결함(S10).
    source: FR7.1, AC7.1.4, AC7.4.4

  # ===== BR10. 화면 표시 =====
  - id: BR10.1
    statement: 추천 목록(신규 기회 탭)은 최신 확정 묶음(프로필 NEW)의 평가를 원래 순위 순으로 보이고, 카드는 순위·기업·기회 이름·분류(쉬운 말)·점수·추천 이유·막는 조건·다음 할 일·의견 버튼·자세히 보기를 가진다. 쪽당 20건, 100건 이상이면 쪽 넘김. 정렬을 바꾸는 조작은 없다.
    category: policy
    applies_to: GET /opportunities, 화면 S1
    trigger: 목록 조회
    logic: 목록의 구성원과 순위는 **최신 CONFIRMED FULL 묶음**(profile NEW)의 originalRank로 정하고, 각 카드의 내용(분류·점수·이유·막는 조건·evalId)은 **그 기회의 최신 확정 평가**(PARTIAL 포함)에서 가져온다. 둘이 다르면(부분 재평가 뒤) 카드에 "재평가됨" 표시를 하고 순위는 FULL 묶음 값을 유지한다. 최신 FULL 묶음 뒤에 투입된 기회는 다음 전체 평가까지 목록에 없다("평가 전 N건" 안내). 응답 OpportunityCard[](C1), meta.total·updatedAt·hasVirtualData·datasetKind. 재접촉 탭·검색·담기·대시보드 필터는 뒤 단위(필터 함수 등록 방식).
    violation: 다른 묶음의 평가가 섞여 보이면 결함.
    source: FR6.1, AC6.1.1, AC6.1.3, C1
  - id: BR10.2
    statement: 카드의 점수는 점수가 있으면 "E점 · 판정 항목 수/전체 항목 수"이고, ②③도 숫자를 유지한다. 소개서 묶음의 ②③은 "참고 " 접두를 유지한다(PM 승인 2026-11-04 #262).
    category: policy
    applies_to: OpportunityCard.scoreS·scoreDisplay·scoreState
    trigger: 목록 조회
    logic: S가 null이면 scoreDisplay="--"·scoreState=NONE이다. 0점을 포함해 점수가 있으면 "E점 · n/전체"를 쓰고, FILTER_PENDING·OPS_PENDING이면 scoreState=PENDING(소개서만 "참고 " 접두), 그 밖에는 CONFIRMED다. 평가 시점에 계산해 scoreDisplay를 저장하며 점수·분류·승인 차단은 바꾸지 않는다. 응답은 scoreS·scoreDisplay·scoreState를 함께 낸다(C1·C3).
    violation: 점수가 있는 확인 전 기회의 숫자를 숨기거나 0점을 점수 없음으로 처리하면 결함(#262).
    source: Q5 A, FR6.1, AC5.3.6
  - id: BR10.3
    statement: 막는 조건 줄에는 "(승인 막힘)" 또는 "(승인은 막지 않음)"이 글자로 붙고, blocksApproval은 분류 코드표(blocksApproval)와 PENDING_BLOCKS 요구 유무로 정한다.
    category: calculation
    applies_to: OpportunityCard.blocker, 상세 approvalEligibility
    trigger: 목록·상세 조회
    logic: 평가 시점(W3 5-5)에 계산해 EvaluationRun.blocksApproval·blockerText로 저장하고 조회 때는 저장값을 그대로 쓴다(조회 시 재계산 없음; 관계 상태가 바뀌면 재평가가 새 값을 만든다). blocksApproval ⇔ ClassificationCode.blocksApproval ∨ ∃ displayResult=PENDING_BLOCKS ∨ datasetKind=BROCHURE ∨ 스냅샷의 relationStatus=UNCONFIRMED. 문구 예: "없음 — 지금 단계 꼭 필요한 요구(ISO 9001) 통과", "인증 요구 미확인 — 질문 필요 (승인은 막지 않음)", "거래 관계 확인 전 (승인 막힘)". 상세의 approvalEligibility.eligible = ¬blocksApproval(승인 버튼 자체는 U5).
    violation: 질문 필요만 있는데 "승인 막힘"이면 결함(AC6.1.2).
    source: FR6.1, FR7.4, AC6.1.2, AC7.3.2
  - id: BR10.4
    statement: 모든 화면 위쪽 띠에 "내부용·고객 제출용 아님"은 항상, 가상 데이터가 섞이면 "가상 데이터 표시 중", 평가 묶음이 소개서면 "거산 확인 전: 참고 추천이며 접촉 승인은 열리지 않습니다", 앱 설정 brand.demoLabel이 있으면 그 문구(예: "부분 시연·거산 확인 전")를 함께 보인다. 데이터 갱신 시각도 보인다.
    category: policy
    applies_to: 화면 공통 틀 StatusBanner, GET /config/ui
    trigger: 화면 표시
    logic: /config/ui 응답에 brand.demoLabel 포함(C7 AppSettings·C1 더하는 변경). 띠는 닫기 없음, role=status.
    violation: 실제 데이터만 있어도 "내부용" 띠가 없으면 결함(AC10.1.2).
    source: FR1.8, FR4.14, Q7 A, AC10.1.1, AC10.1.2, AC10.3.1
  - id: BR10.5
    statement: 근거 상세는 위에서부터 ① 추천 이유·다음 할 일·확인 질문 ② 요구별 판정 표(요구, 꼭 필요한가, 언제, 거산 상태, 판정)와 "승인 가능 여부" 한 줄 ③ 공정 연결 ④ 근거 자료 목록(출처 등급·확실도·확인/추정 글자) ⑤ 접을 수 있는 점수 세부(E/P/S/R, 항목별 상태·점수, 규칙 버전·거산 값 묶음·평가 시각) 순서이고, 맨 아래 의견 영역이 있다. 근거 문장과 거산 값은 사실(확인)/추정(강한·약한)/미확인(미확보·검수 대기)을 글자로 구분한다.
    category: policy
    applies_to: GET /opportunities/{oppId}, 화면 S2
    trigger: 상세 조회
    logic: 응답 OpportunityDetail(C1)의 header·reasons·requirements·approvalEligibility·processLinks·evidence·scores·records.opinion·evalId. 영역별 구성 함수 등록 방식으로 뒤 단위가 자기 영역을 더한다. 요구가 없으면 "확인된 요구가 없습니다. 질문 목록을 보세요", 요구 10개 이상이면 표 안 스크롤.
    violation: 순서가 다르거나 추정이 확정처럼 보이면 결함(AC6.2.1, AC10.1.3).
    source: FR6.2, AC6.2.1, AC6.2.2, AC6.2.4, AC10.1.3
  - id: BR10.6
    statement: 의견 저장 피드백 — 저장되면 "저장됨 HH:MM"(화면 낭독기에 바로 읽힘)이 3초 보였다가 "의견: 검토할 만함 (수정)"으로 남고, 저장 실패 시 "저장하지 못했습니다. 다시 시도"와 입력값 유지. 목록 카드와 상세 맨 아래 모두 같은 부품이다.
    category: policy
    applies_to: 화면 S3(S1·S2 안)
    trigger: 의견 버튼
    logic: 가장 흔한 길(목록 열기 → 의견)은 클릭 2번, 상세를 거치면 4번.
    violation: 실패 시 사유 입력이 사라지면 결함(AC7.1.3).
    source: FR6.3, NFR8, AC7.1.1, AC7.1.3
  - id: BR10.7
    statement: 각 화면·영역은 비어 있음 / 불러오는 중 / 정상 / 오류 / 일부의 다섯 상태를 가지며, 오류는 오류 코드 없이 쉬운 말 원인과 다음 행동을 보이고 로그에 남긴다. 조용히 실패하지 않는다.
    category: policy
    applies_to: 화면 전체, WebApi 오류 응답
    trigger: 모든 요청
    logic: 오류 응답 형식 {error: {message, nextAction, ref, kind?, fields?}}(계약 3장). 목록 비어 있음 "아직 추천할 기회가 없습니다. 운영자가 후보를 넣으면 여기에 나타납니다.", 불러오는 중 자리표시 3개(5초 넘으면 "조금 오래 걸리고 있습니다"), 오류 "목록을 불러오지 못했습니다." + [다시 시도]. 요청 중단 한도 목록·상세 10초.
    violation: 오류 코드가 화면에 보이면 결함(AC10.4.3).
    source: NFR10, FR6 공통, AC6.1.3, AC10.4.3, 계약 3장
  - id: BR10.8
    statement: 모든 기능을 키보드로 조작할 수 있고, 페이지마다 h1 하나, "본문으로 건너뛰기" 링크, 머리글 행이 있는 진짜 표, 펼치기/접기 상태를 글자로도 표시, 저장 결과는 낭독기에 바로 읽히며, 본문 글자 16px 이상, 대비 4.5:1 이상, 상태는 색과 글자를 함께 쓴다.
    category: policy
    applies_to: 화면 전체
    trigger: 화면 구현·점검
    logic: 접근성 점검표(`../../../inception/refined-mockups/accessibility-checklist.md`)를 뼈대 화면(S1·S2·S3)에 적용한다.
    violation: 점검표 항목 미충족은 결함(AC6.1.5, AC10.4.2).
    source: FR6.7, NFR8, AC6.1.5, AC10.4.2
  - id: BR10.9
    statement: 화면 문구는 쉬운 말 대응표 한 곳을 쓰고, 전문 용어(E/P/R, 필터, 프로필)는 상세의 "점수 자세히 보기" 안에서만 쓴다. 로고·강조색은 설정 한 곳에서 바꾼다. 관리 화면은 없고 데이터는 파일로만 들어온다.
    category: policy
    applies_to: 화면 전체, 앱 설정 brand
    trigger: 화면 구현
    logic: 대응표 파일(labels) 하나, 테마 토큰 파일 하나. 화면 코드에 색·글꼴 값·분류 문구를 직접 적지 않는다.
    violation: 카드에 "E 77"이 보이면 결함(AC6.2.5).
    source: NFR8, FR6.6, FR6.8, AC6.2.5, AC10.4.4, AC10.4.5

  # ===== BR11. 운영 명령 =====
  - id: BR11.1
    statement: 뼈대 명령은 init-db, serve, check-config, import-capability, import-case, check-case, evaluate, verify-case, export-contracts이며, 모든 명령은 끝에 쉬운 한국어 요약 한 줄과 종료 코드(0 성공, 1 입력 오류, 2 실행 실패)를 내고 --help는 한국어다. 운영 안내서 작업(가상 사례 투입·평가·확인)은 명령 3개 이내다.
    category: constraint
    applies_to: OperatorCommands
    trigger: 명령 실행
    logic: 비밀번호·API 키는 인자로 받지 않는다. 투입 뒤 평가는 자동으로 돌지 않는다(안내서에 명시).
    violation: 명령 3개를 넘으면 결함(AC1.1.5, AC5.1.6).
    source: C8, AC1.1.5, AC5.1.6, AC9.4.1
  - id: BR11.2
    statement: verify-case는 사례 파일의 baseDate로 평가(또는 최신 평가를 그 기준일로 재실행)한 뒤 expected(E, P, S, R, C, filterState, coreEvidenceMet, classificationCode, requirementResults)와 항목별 일치/불일치 표를 내고, 하나라도 다르면 종료 코드 2다.
    category: validation
    applies_to: OperatorCommands verify-case
    trigger: 구현 검증 명령
    logic: 비교는 저장된 값(정수·소수 첫째 자리)끼리. requirementResults는 요구 name → displayResult.
    violation: 불일치인데 0을 돌려주면 결함.
    source: C8, FR4.13, BR4.7
  - id: BR11.3
    statement: 자격증명·API 키는 코드에 적지 않고 환경 변수로만 읽으며 로그에 남기지 않는다. U1에는 외부 호출이 없으므로 쓰는 환경 변수는 데이터베이스 경로(GEOSAN_DB_PATH)뿐이고, 비밀번호(GEOSAN_PASSWORD)는 U8에서 읽는다.
    category: policy
    applies_to: 설정·명령·서버
    trigger: 시작
    logic: 설정 파일에 비밀 값 키가 있으면 check-config 오류.
    violation: 하드코딩된 비밀이 있으면 결함(AC10.5.4).
    source: NFR4, phases/construction.md Security, AC10.5.4
```

## 규칙 요약표

| 묶음 | 규칙 | 한 줄 요약 | 출처 |
|---|---|---|---|
| BR1 거산 역량·검수 | BR1.1~BR1.7 | 9종 공정·숫자 사양·검수 완료만 근거·범위 행·상태 이력·가상 표시·재투입 보존 | FR1, C7 |
| BR2 투입·기회 | BR2.1~BR2.9 | 연락처 거부·파일 검사·존재 확인·기회 ID 하나·연결 쌍·수준 짐작 금지·이력 분리·기준일·check-case | FR2, FR3.1, C7, Q4, Q8 |
| BR3 요구 판정·필터 | BR3.1~BR3.10 | 판정 행·통과 조건·표시 변환·필터 한 문장·나중 단계·기술 조건·제외 범위·정지 재평가·재검토·관계 미확인 | FR3, FR4.1 |
| BR4 점수 | BR4.1~BR4.8 | 항목 식·고정 단계값·확실도·감쇠·7상태·합계·A정밀 기대값·결정성 | FR4.2~4.5, 부록 A, NFR1 |
| BR5 핵심·시점·운영·조사 | BR5.1~BR5.7 | 핵심 근거·시점 ①②③·운영 전제·소개서 묶음·조사 요건 5가지 | FR4.6~4.9, FR4.14 |
| BR6 분류·정렬 | BR6.1~BR6.5 | 11분기 순서·재확인·코드표·정렬 키·OTHER 정렬(가설·설정값) | FR4.10~4.11, Q6 |
| BR7 평가 기록 | BR7.1~BR7.6 | 묶음·스냅샷·보존·금지 원문 제외·기한 체크(Q1)·트랜잭션·규칙 설정 버전 | FR4.12, FR4.7, NFR4·5·11 |
| BR8 질문 후보 | BR8.1~BR8.3 | 생성 조건(Q2)·대상당 하나·상세 3개+펼치기 | FR11.1 |
| BR9 의견 | BR9.1~BR9.5 | 3값·사유 필수·본 평가 ID·담당자 키·버전 이력·기록 분리 | FR7, FR14.1 |
| BR10 화면 | BR10.1~BR10.9 | 목록·카드 점수(Q5)·막는 조건·띠(Q7)·상세 순서·저장 피드백·다섯 상태·접근성·쉬운 말 | FR6, NFR8·10 |
| BR11 명령 | BR11.1~BR11.3 | 명령 목록·verify-case·환경 변수 | C8, NFR4 |

가설·설정값으로 표시한 것: 배점·단계값(BR4.1·4.2), 확실도(BR4.3), 감쇠 경계(BR4.4), 분류 기준점(BR6.1), 핵심 근거 조건(BR5.1), 조사 시간 상한 2시간(BR5.7), 쉬운 말 문구(BR6.3), OTHER 정렬(BR6.5). 모두 `rule-config.yaml`에 있고 바꾸면 규칙 버전을 올린다(BR7.6).

## 상류 문서와의 연결

- 작업 단위 `../../../inception/units-generation/unit-of-work.md` U1 책임·경계: 외부 LLM·홈페이지 읽기·전송 보호·수집·담기/승인/결과·대시보드·재접촉·접속 보호 규칙은 여기 없다(뒤 단위).
- 이야기 대응 `../../../inception/units-generation/unit-of-work-story-map.md`: 수용 기준 ↔ 규칙 대응은 `traceability.json`.
- 요구사항 `../../../inception/requirements-analysis/requirements.md` FR1~FR4, FR6, FR7.1·7.2·7.6, FR10, FR11.1, FR14.1, NFR1·4·5·8·10·11·12, 부록 A.
- 부품 목록 `../../../inception/domain-design/components.md` RuleEngine·EvaluationLedger·CapabilityCatalog·OpportunityRegistry·ConfirmationDesk·SalesRecords·WorkflowRunner·OperatorCommands·WebApi·WebUI behaviour.
- 계약 `../../../inception/contract-design/contract-summary.md` C0·C1·C2·C3·C6·C7·C8, 3장 오류 규칙. 이 설계가 더하는 약속 파일 변경(모두 "더하는 변경", PM 확인 뒤 적용): CaseFile `baseDate`(BR2.8), CaseFile `signals[].relation`·`scheduledAt`·`announcedAt`과 `itemInputs[].usedCapabilityRefs`(BR5.2, BR4.1), C3 EvaluationInput `itemInputs`·`signals[].relation`(BR4.1, BR5.2), C1 요구 판정 표시 변환에 "REQUIRED·단계 미확인 → PENDING_BLOCKS 우선"(BR3.3), CaseFile `itemInputs[].signalRefs`(BR4.4), C6 거산 값 식별 키에 `datasetKind` 포함·`eval_batch.scope`·자식 행 `superseded_at`·공정 연결의 `processCode` 참조(BR1.1, BR1.7, BR7.1, BR2.3), `check-case` 명령(BR2.9), AppSettings `brand.demoLabel`(BR10.4), OpportunityCard `scoreDisplay`(BR10.2), `otherGroupSort` 설정(BR6.5). 깨는 변경은 없다.
