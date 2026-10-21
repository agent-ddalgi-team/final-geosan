## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-21T00:36:36Z
**Iteration:** 2

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > 전체 엔티티(itemInputs를 담는 엔티티 없음); functional-spec.md > W2 3단계, W3 4단계; rules.md > BR4.1 | 평가의 핵심 입력인 사례 파일 `itemInputs`(항목 코드·일치도·확실도·상태·판단 사실·근거 참조 번호)를 투입 시점(`import-case`)에 저장할 곳이 엔티티에 없다. `evaluate`는 `import-case`와 다른 명령이고, W3 4단계는 스냅샷에 itemInputs를 "모은다"고만 적었다. ItemJudgment는 평가 결과 테이블이라 입력 저장용이 아니다. Evidence에도 항목과의 연결이 없어서 `JudgmentEvidence`(itemInputs.evidenceRefs)를 만들 근거도 없다. 그대로면 A정밀 E 77 / P 95 / S 81.1 / R 82 경로를 개발자가 추측 없이 구현할 수 없다. | 항목 입력(itemCode, matchRate, certainty, state, factJudged, 근거 연결)을 저장할 엔티티와 테이블을 opp_ 쪽에 더하거나, 기존 엔티티의 어느 열에 저장하는지 정한다. W2 3단계 저장 순서에 넣고, W3 스냅샷이 거기서 읽는다고 적는다. 재투입 식별 키와 근거 참조(파일 안 인덱스 → evidenceId) 변환 규칙도 적는다. | Resolved (reviewer) |
| R-02 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Signal.relation, scheduledAt, announcedAt; rules.md > BR5.2, BR4.4, BR5.3; functional-spec.md > 8장 "약속 파일 더하는 변경" | `Signal.relation`(DIRECT/INDIRECT, required)은 BR5.2(시점 우선 ①)와 BR4.2(시점 항목 일치도 1.0/0.5)의 판단 근거인데, 계약 C7 CaseFile `signals`와 C3 EvaluationInput `signals`에 이 열이 없다. 사례 파일로 값을 넣을 방법이 없어서 ①이 항상 거짓이 되고, A정밀의 "시점 우선 접촉" 기대값(BR4.7)에 도달하지 못한다. `scheduledAt`·`announcedAt`도 BR4.4·BR5.3·BR6.4(validUntil)가 쓰는데 CaseFile `signals`에 없다. 게다가 8장의 "더하는 변경" 목록(baseDate, check-case, demoLabel, scoreDisplay, otherGroupSort)에도 빠져 있어 약속 파일 선(先)기재 순서를 어긴다. | CaseFile `signals`에 relation, scheduledAt, announcedAt를 더하고 C3 `signals`에도 relation을 더하는 변경을 "더하는 변경 / PM 확인 뒤 반영" 목록(rules.md 상류 연결, functional-spec.md 8장)에 추가한다. 파일 값이 없을 때의 처리(필수 여부, 기본 INDIRECT 같은 보수적 기본값 또는 오류)를 BR2.2 또는 BR5.2에 정한다. | Resolved (reviewer) |
| R-03 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR3.4 logic, BR3.5 | 필터 한 문장 규칙(FR3.4)과 AC5.2.3은 "필수 요구의 필요 단계가 '단계 미확인'이면 거산 충족 판정과 무관하게 확인 대기"인데, BR3.4는 `reqLevel=REQUIRED ∧ neededStage ∈ {NOW, UNKNOWN} ∧ result=UNKNOWN`을 요구한다. 검수 완료된 자격이 맞아 `result=PASS`가 나온 필수 요구의 필요 단계가 UNKNOWN이면 BR3.3은 표시를 PASS로, BR3.4는 필터를 PASS로 내보내서 "나중에 받아도 된다/지금 필요하다"를 짐작해 통과시킨 것이 된다. BR3.5의 "PENDING_BLOCKS(BR3.4)" 설명과도 맞지 않는다. 필수 판정을 약화하는 변환이다. | BR3.4를 FR3.4 문장 그대로 고친다: 지금 단계 필수 요구 중 (거산 충족 판정이 UNKNOWN) 또는 (필요 단계가 UNKNOWN)인 것이 하나라도 있으면 PENDING. 이에 맞춰 BR3.2/BR3.3/BR3.5에서 필요 단계 UNKNOWN인 필수 요구의 result와 displayResult(PENDING_BLOCKS)를 PASS와 겹치지 않게 정하고, 해당 모서리 사례를 모서리 조건 표에 더한다. | Resolved (reviewer) |
| R-04 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/functional-spec.md > W2 4단계, W3 1단계; entities.md > Opportunity; rules.md > BR2.8 | W2 4단계는 "baseDate를 Opportunity에 함께 기억해 verify-case가 쓴다"고 하고 W3 1단계는 `evaluate --opp`에서 "사례의 baseDate"를 쓴다고 하지만, Opportunity 엔티티에 baseDate 열이 없다. 엔티티 요약표도 파일 키로만 더한다고 적었다. 저장 위치가 없어 BR2.8의 기준일 결정 순서를 구현할 수 없다. | 기준일을 저장할 열(예: Opportunity.caseBaseDate)을 엔티티에 선언하거나, 저장하지 않고 verify-case만 파일에서 읽고 evaluate는 인자/오늘만 쓰도록 BR2.8과 W3을 고친다. | Resolved (reviewer) |
| R-05 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR1.3, BR3.2 logic, BR4.1, BR5.6 | 검수 완료(REVIEWED)가 아닌 값은 "가점도 내지 않는다"(BR1.3)고 했지만, 항목 점수는 파일의 itemInputs(일치도·확실도·상태)로만 계산되고(BR4.1) 사용한 거산 값의 검수 상태로 점수를 막는 단계가 없다. BR5.6은 소개서(검수 대기) 묶음에서도 점수를 계산해 둔다고 해서 BR1.3 글자와 충돌한다(기획서 FR4.14는 참고 점수를 허용하므로 의도는 후자로 보임). 또 BR3.2의 "reviewStatus=REVIEWED"가 Qualification 행만 가리키는지 QualificationScope 행도 포함하는지 불명확해, 자격은 검수 완료인데 적용 범위(APPLIES)가 검수 대기인 경우 PASS가 나올 수 있다. 접촉 후보 분류는 ③ 운영 전제가 막아 주지만, 필수 판정 근거 규칙은 모호하면 안 된다. | BR1.3을 "PASS 판정·핵심 근거·운영 전제·접촉 후보 분류의 근거로는 쓰지 않고, 점수는 참고 점수로만 계산해 표시한다"처럼 BR5.6과 일치하게 고친다. BR3.2 통과 조건에 "자격·적용 범위 행이 모두 REVIEWED"를 명시한다. | Resolved (reviewer) |
| R-06 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR2.1, BR9.1; entities.md > ReviewOpinion.memo, reason | 연락처 패턴 검사(BR2.1)는 파일 투입 경로의 일부 칸(quote, allowedSummary, basis, notes, content)에만 걸려 있다. 화면에서 담당자가 직접 쓰는 `ReviewOpinion.memo`·`reason`(200자 자유 문장)과 파일의 다른 자유 문장 칸(Requirement.question, Opportunity.distinctionBasis·reviewCondition, Customer.identityBasis, ItemJudgment 입력의 factJudged 등)에는 검사가 없다. 팀 규칙 "개인정보(연락처)를 저장하지 않는다"(CON-11)를 의견 저장 경로에서 어길 수 있다. | 연락처 패턴 검사를 "모든 자유 문장 칸과 의견 저장 요청"으로 넓힌다. 의견 저장에서 걸리면 400 fields[]로 거부하는 동작과 화면 문구를 BR9.1에 더한다. | Resolved (reviewer) |
| R-07 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR10.3; entities.md > EvaluationRun.blockerText | 승인 막힘(blocksApproval)은 평가가 아니라 목록·상세 조회 때 현재 Customer.relationStatus와 묶음 datasetKind로 다시 계산한다. EvaluationRun에는 막힘 여부 열이 없고 blockerText 문장 속에만 섞여 있다. 평가 뒤에 고객 관계 상태가 바뀌면 평가를 다시 하지 않아도 "승인 막힘"이 달라지고, 저장된 평가·이유 문장과 어긋나 재현성(BR4.8, BR7.2) 취지에 맞지 않는다. | EvaluationRun에 `blocksApproval`(boolean)을 스냅샷 값으로 저장하고 조회는 그 값을 쓰게 한다. 관계 상태 변경은 재평가로만 반영한다고 정한다. | Resolved (reviewer) |
| R-08 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Requirement(holder·site 없음); rules.md > BR3.2 | C3 requirements에는 holder·site가 있고 BR3.2도 "요구에 값이 있으면 비교"라고 하지만 Requirement 엔티티와 CaseFile requirements에는 두 열이 없다. 비교 조건이 항상 "자격 값 사용"으로만 동작한다. | holder·site를 Requirement에 더하고 CaseFile 더하는 변경에 포함하거나, BR3.2에서 U1은 비교하지 않는다고 명시한다. | Resolved (reviewer) |
| R-09 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > EvaluationRun.runStatus; functional-spec.md > 3-2, 7장 | 평가 실패는 전체 롤백이라 `runStatus=FAILED` 행이 저장되지 않아 도달할 수 없는 값이다. 또 기회 한 곳의 E/P/R 검증 실패가 묶음 전체를 FAILED로 만드는 점(부분 시연 10~20곳)은 의도인지 적혀 있지 않다. | FAILED 값을 지우거나 언제 저장되는지 정한다. 한 기회 실패 시 묶음 전체 실패인지 해당 기회만 건너뛰는지 W3에 한 줄로 확정한다. | Resolved (reviewer) |
| R-10 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Process·ProcessCapability 등의 reviewStatus와 FieldEvidence.reviewStatus | 현재 검수 상태가 엔티티 열과 FieldEvidence 최신 행 두 곳에 있다. 어느 쪽이 원본이고 둘이 어긋날 때 어떻게 하는지 없다. | "엔티티 열이 현재값, FieldEvidence는 이력"처럼 원본을 정하고 갱신을 같은 트랜잭션으로 묶는다고 적는다. | Resolved (reviewer) |
| R-11 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Process.code (unique), Qualification 재투입 식별 키; rules.md > BR1.7; functional-spec.md > W1 3단계, W8 1단계 | 거산 값 묶음(VIRTUAL_REVIEWED / BROCHURE / COMPANY_CONFIRMED)은 계약 C7의 `activeDatasetKind`와 `dataset-set`(묶음 전환)으로 한 DB 안에서 갈아 끼우는 값이다. 그런데 `Process.code`는 전역 유일이고, 재투입 식별 키(Process.code, Qualification.officialName+number)에 datasetKind가 들어 있지 않다. 가상 검수 묶음(REVIEWED)을 넣은 DB에 소개서 묶음(PENDING)을 W1로 넣으면 같은 code로 만나 덮어쓰거나 유일 제약에 걸리고, BR1.7이 "REVIEWED를 PENDING으로 되돌리지 않음"을 적용해 소개서 값이 REVIEWED로 남는다. 그러면 소개서 묶음 평가가 필수 요구를 PASS로 내보내 BR5.6(② 또는 ③, 접촉 승인 막힘)이 깨지고, 검수 완료만 통과 근거라는 필수 규칙을 우회한다. W8(가상 A정밀과 실제 기업 소개서 값을 같은 시연 DB에 함께 두는 흐름)이 바로 이 경로다. | 묶음별 거산 값이 한 DB에 공존하는지 정한다. 공존이면 Process·Qualification 등 cap_ 테이블의 식별 키와 유일 제약에 datasetKind를 포함하고, BR1.7의 "REVIEWED 유지"를 같은 묶음 안에서만 적용한다고 쓴다. 평가 스냅샷이 activeDatasetKind 행만 읽는다는 것도 BR5.5·W3 4단계에 적는다. 공존하지 않으면(DB 하나에 묶음 하나) 그 제약과 dataset-set의 의미를 함께 적는다. | New |
| R-12 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/functional-spec.md > W3 2·3단계, W4 1단계, W5 1~2단계; rules.md > BR10.1, BR7.2 | 목록(W5)은 "최신 CONFIRMED 묶음의 평가"만 originalRank 순으로 읽는데, `evaluate --opp`와 `verify-case`(W4는 W3을 기회 하나로 실행)도 populationSpec이 기회 1건뿐인 새 묶음을 CONFIRMED로 만든다. 평가 뒤 A정밀 하나를 verify-case하거나 한 기회만 재평가하면 그 묶음이 "최신"이 되어 목록이 1건으로 줄고, 순위도 1건짜리 묶음 안 순위가 된다. W4의 "같은 기준일·규칙 버전·스냅샷 해시면 재사용" 예외는 기준일이 다르면(실제 기업은 평가 기준일이 오늘, verify-case는 파일 baseDate) 작동하지 않는다. 계약 C1도 카드 evalId를 "기회별 최신 확정 평가"로 정의해 목록의 묶음 단위 선택과 어긋난다. 뼈대 시연(import → evaluate → verify-case → 목록)의 기본 흐름에서 재현된다. | 목록의 원천을 정한다. 예: 기회마다 최신 CONFIRMED 평가를 모아 원래 순위가 아니라 목록 시점에 정렬하거나, 부분 평가 묶음은 목록 원천 묶음으로 치지 않는다는 규칙(전체 평가 묶음만 "최신 묶음")을 정한다. verify-case가 저장 없는 계산(dry run)인지 정식 평가인지 W4에 확정한다. originalRank가 어떤 모집단 기준인지 BR6.4에 적는다. | New |
| R-13 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR3.2, BR3.4 | 요구 판정 EXCLUDED는 reqLevel을 따지지 않고 만들어지고(BR3.2는 요구 수준 조건이 없다), BR3.4는 "어느 요구든 EXCLUDED면 기회 EXCLUDED"라고 한다. 우대(PREFERRED)·비요구(NOT_REQUIRED)·수준 미확인 요구의 자격이 만료돼도 기회가 제외되며, FR3.4 문장은 필터가 지금 단계 필수 요구만 본다고 했다(수준 미확인 요구는 필터에 영향 없음). | BR3.2 또는 BR3.4에서 필터 상태·제외 범위에 영향을 주는 EXCLUDED를 "지금 단계(NOW) 필수 요구"의 EXCLUDED로 한정하고, 그 밖 수준의 EXCLUDED는 표시와 질문으로만 남는다고 쓴다. | New |
| R-14 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR4.2, BR4.4, BR5.2; entities.md > ItemJudgmentInput, Signal | SIG_* 항목 입력과 Signal 행을 잇는 규칙이 없다. ItemJudgmentInput에는 signalId가 없고, "연결된 Signal"이 어떤 것인지(signalKind → itemCode 대응: EXPANSION→SIG_EXPAND, NEW_ORDER→SIG_ORDER, BID→SIG_BID, HIRING→SIG_HIRE), 같은 종류 신호가 둘 이상일 때 어느 것으로 감쇠를 계산하는지, REORDER_CYCLE·NEXT_CONTACT는 항목에 안 들어가는지 적혀 있지 않다. 결정성(BR4.8)을 구현 담당이 추측으로 채워야 한다. | 대응표를 BR4.4에 한 줄로 적고, 같은 종류 신호가 여럿일 때의 선택 기준(예: 기준일에 가장 가까운 유효 신호 하나, 동률이면 signalId 순)을 정한다. 파일 검사(check-case)에서 같은 종류 신호가 여럿이면 어떻게 하는지도 정한다. | New |
| R-15 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR1.7; functional-spec.md > 7장 "같은 caseId 재투입" | 재투입 식별 키가 Process·Qualification·Customer·Opportunity에만 있다. 같은 caseId를 다시 넣을 때 Requirement·Signal·Evidence·Interaction·ResearchTask·ReadinessCheck가 덮어써지는지, 새 행이 더해지는지, 파일에서 빠진 행이 어떻게 되는지 정한 곳이 없다. 그대로 구현하면 요구와 신호가 투입할 때마다 중복되어 필수 판정과 감쇠가 흔들린다. | 이 행들의 재투입 식별 키(예: Requirement은 oppId+reqKind+name, Signal은 oppId+signalKind+occurredAt 또는 파일 안 순번)와 파일에서 빠진 행의 처리(보존/비활성)를 BR1.7 또는 BR2.4에 적는다. | New |

> R-01 Reviewer note: `ItemJudgmentInput`(eval_item_input)이 생겼고 W2 3단계 저장 순서, W3 4단계 스냅샷(`itemInputs`), 재투입 version, 근거 참조 변환(evidenceRefs → evidenceIds), 대조 거산 값 ID 해석이 모두 적혀 있다. 8행 보장(없으면 UNAVAILABLE 행)도 정했다.

> R-02 Reviewer note: `Signal.relation`·`scheduledAt`·`announcedAt`이 CaseFile signals와 C3 신호 입력의 "더하는 변경" 목록(rules.md 상류 연결, functional-spec.md 8장)에 들어갔다. `relation`은 required라 파일에 없으면 BR2.2의 필수 키 오류로 걸린다.

> R-03 Reviewer note: BR3.4가 FR3.4 문장대로 고쳐졌다(필수 ∧ 단계 미확인이면 PASS여도 PENDING). BR3.3·BR3.5와 같은 방향이다. 모서리 조건 표에 해당 사례를 직접 적지는 않았으나 설계 모순은 사라졌다.

> R-04 Reviewer note: `Opportunity.baseDate` 열이 선언됐고 W2·W3·BR2.8과 맞는다.

> R-05 Reviewer note: BR1.3이 "참고 점수 계산 가능 / PASS·핵심 근거·운영 전제는 불가"로 BR5.6과 일치하게 바뀌었고, BR3.2가 범위 행의 REVIEWED·APPLIES를 명시한다.

> R-06 Reviewer note: BR2.1과 BR9.1이 의견 메모·사유까지 연락처 검사를 넓히고 400 fields로 거부한다. W7에도 반영됐다.

> R-07 Reviewer note: `EvaluationRun.blocksApproval`·`scoreDisplay`를 평가 시점에 저장하고 BR10.3·모서리 표가 저장값을 쓰도록 맞춰졌다.

> R-08 Reviewer note: `Requirement.holder`·`site`가 추가됐다.

> R-09 Reviewer note: `runStatus`에서 FAILED가 빠졌고 W3이 "E/P/R 검증 실패는 묶음 전체 실패, 입력 부족은 그 기회만 건너뜀"을 한 줄로 확정했다.

> R-10 Reviewer note: entities.md 머리말에 FieldEvidence 최신 행이 원본, 열은 같은 트랜잭션 사본, 어긋나면 FieldEvidence 우선이라고 적었다.

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability.json 점검(`python3 -I`) | PASS: 참조된 BR ID가 모두 rules.md에 존재(72개), rules.md의 BR이 모두 한 번 이상 참조됨 | 추적 데이터는 일관된다. |
| 상류 계약 대조(contract-summary.md C1·C7) | `activeDatasetKind`·`dataset-set`·카드 evalId "최신 확정 평가"를 확인 | 첫째·둘째 새 소견의 근거다. |

### Summary

이전 소견 R-01~R-10은 모두 실제로 고쳐졌다. 다만 거산 값 묶음 공존(식별 키와 유일 제약) 문제가 소개서 값을 REVIEWED로 남겨 필수 판정 규칙을 우회할 수 있고, 부분 평가 묶음이 목록 원천을 바꿔 시연 흐름에서 목록이 줄어드는 문제가 있어 두 곳을 고친 뒤에 구현으로 넘기는 것이 맞다.

### Suggestions

- 모서리 조건 표(functional-spec.md 7장)에 "필수 ∧ 단계 미확인 ∧ 자격 PASS → 필터 확인 대기" 한 줄을 더해 두면 R-03의 시나리오 테스트를 바로 쓸 수 있다.
- BR10.2는 ①(제외)과 ④(평가 대기)의 카드 점수 문구를 따로 말하지 않는다. S가 null이면 "--"라는 문장이 있어 ④는 덮이지만 ①은 한 줄로 확정하면 좋다.
