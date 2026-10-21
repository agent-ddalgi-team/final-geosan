## Review

**Verdict:** NOT-READY
**Reviewer:** aidlc-architecture-reviewer-agent
**Date:** 2026-10-21T00:29:58Z
**Iteration:** 1

### Findings

| ID | Severity | Location | Finding | Required action | Status |
|---|---|---|---|---|---|
| R-01 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > 전체 엔티티(itemInputs를 담는 엔티티 없음); functional-spec.md > W2 3단계, W3 4단계; rules.md > BR4.1 | 평가의 핵심 입력인 사례 파일 `itemInputs`(항목 코드·일치도·확실도·상태·판단 사실·근거 참조 번호)를 투입 시점(`import-case`)에 저장할 곳이 엔티티에 없다. `evaluate`는 `import-case`와 다른 명령이고, W3 4단계는 스냅샷에 itemInputs를 "모은다"고만 적었다. ItemJudgment는 평가 결과 테이블이라 입력 저장용이 아니다. Evidence에도 항목과의 연결이 없어서 `JudgmentEvidence`(itemInputs.evidenceRefs)를 만들 근거도 없다. 그대로면 A정밀 E 77 / P 95 / S 81.1 / R 82 경로를 개발자가 추측 없이 구현할 수 없다. | 항목 입력(itemCode, matchRate, certainty, state, factJudged, 근거 연결)을 저장할 엔티티와 테이블을 opp_ 쪽에 더하거나, 기존 엔티티의 어느 열에 저장하는지 정한다. W2 3단계 저장 순서에 넣고, W3 스냅샷이 거기서 읽는다고 적는다. 재투입 식별 키와 근거 참조(파일 안 인덱스 → evidenceId) 변환 규칙도 적는다. | New |
| R-02 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Signal.relation, scheduledAt, announcedAt; rules.md > BR5.2, BR4.4, BR5.3; functional-spec.md > 8장 "약속 파일 더하는 변경" | `Signal.relation`(DIRECT/INDIRECT, required)은 BR5.2(시점 우선 ①)와 BR4.2(시점 항목 일치도 1.0/0.5)의 판단 근거인데, 계약 C7 CaseFile `signals`와 C3 EvaluationInput `signals`에 이 열이 없다. 사례 파일로 값을 넣을 방법이 없어서 ①이 항상 거짓이 되고, A정밀의 "시점 우선 접촉" 기대값(BR4.7)에 도달하지 못한다. `scheduledAt`·`announcedAt`도 BR4.4·BR5.3·BR6.4(validUntil)가 쓰는데 CaseFile `signals`에 없다. 게다가 8장의 "더하는 변경" 목록(baseDate, check-case, demoLabel, scoreDisplay, otherGroupSort)에도 빠져 있어 약속 파일 선(先)기재 순서를 어긴다. | CaseFile `signals`에 relation, scheduledAt, announcedAt를 더하고 C3 `signals`에도 relation을 더하는 변경을 "더하는 변경 / PM 확인 뒤 반영" 목록(rules.md 상류 연결, functional-spec.md 8장)에 추가한다. 파일 값이 없을 때의 처리(필수 여부, 기본 INDIRECT 같은 보수적 기본값 또는 오류)를 BR2.2 또는 BR5.2에 정한다. | New |
| R-03 | High | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR3.4 logic, BR3.5 | 필터 한 문장 규칙(FR3.4)과 AC5.2.3은 "필수 요구의 필요 단계가 '단계 미확인'이면 거산 충족 판정과 무관하게 확인 대기"인데, BR3.4는 `reqLevel=REQUIRED ∧ neededStage ∈ {NOW, UNKNOWN} ∧ result=UNKNOWN`을 요구한다. 검수 완료된 자격이 맞아 `result=PASS`가 나온 필수 요구의 필요 단계가 UNKNOWN이면 BR3.3은 표시를 PASS로, BR3.4는 필터를 PASS로 내보내서 "나중에 받아도 된다/지금 필요하다"를 짐작해 통과시킨 것이 된다. BR3.5의 "PENDING_BLOCKS(BR3.4)" 설명과도 맞지 않는다. 필수 판정을 약화하는 변환이다. | BR3.4를 FR3.4 문장 그대로 고친다: 지금 단계 필수 요구 중 (거산 충족 판정이 UNKNOWN) 또는 (필요 단계가 UNKNOWN)인 것이 하나라도 있으면 PENDING. 이에 맞춰 BR3.2/BR3.3/BR3.5에서 필요 단계 UNKNOWN인 필수 요구의 result와 displayResult(PENDING_BLOCKS)를 PASS와 겹치지 않게 정하고, 해당 모서리 사례를 모서리 조건 표에 더한다. | New |
| R-04 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/functional-spec.md > W2 4단계, W3 1단계; entities.md > Opportunity; rules.md > BR2.8 | W2 4단계는 "baseDate를 Opportunity에 함께 기억해 verify-case가 쓴다"고 하고 W3 1단계는 `evaluate --opp`에서 "사례의 baseDate"를 쓴다고 하지만, Opportunity 엔티티에 baseDate 열이 없다. 엔티티 요약표도 파일 키로만 더한다고 적었다. 저장 위치가 없어 BR2.8의 기준일 결정 순서를 구현할 수 없다. | 기준일을 저장할 열(예: Opportunity.caseBaseDate)을 엔티티에 선언하거나, 저장하지 않고 verify-case만 파일에서 읽고 evaluate는 인자/오늘만 쓰도록 BR2.8과 W3을 고친다. | New |
| R-05 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR1.3, BR3.2 logic, BR4.1, BR5.6 | 검수 완료(REVIEWED)가 아닌 값은 "가점도 내지 않는다"(BR1.3)고 했지만, 항목 점수는 파일의 itemInputs(일치도·확실도·상태)로만 계산되고(BR4.1) 사용한 거산 값의 검수 상태로 점수를 막는 단계가 없다. BR5.6은 소개서(검수 대기) 묶음에서도 점수를 계산해 둔다고 해서 BR1.3 글자와 충돌한다(기획서 FR4.14는 참고 점수를 허용하므로 의도는 후자로 보임). 또 BR3.2의 "reviewStatus=REVIEWED"가 Qualification 행만 가리키는지 QualificationScope 행도 포함하는지 불명확해, 자격은 검수 완료인데 적용 범위(APPLIES)가 검수 대기인 경우 PASS가 나올 수 있다. 접촉 후보 분류는 ③ 운영 전제가 막아 주지만, 필수 판정 근거 규칙은 모호하면 안 된다. | BR1.3을 "PASS 판정·핵심 근거·운영 전제·접촉 후보 분류의 근거로는 쓰지 않고, 점수는 참고 점수로만 계산해 표시한다"처럼 BR5.6과 일치하게 고친다. BR3.2 통과 조건에 "자격·적용 범위 행이 모두 REVIEWED"를 명시한다. | New |
| R-06 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR2.1, BR9.1; entities.md > ReviewOpinion.memo, reason | 연락처 패턴 검사(BR2.1)는 파일 투입 경로의 일부 칸(quote, allowedSummary, basis, notes, content)에만 걸려 있다. 화면에서 담당자가 직접 쓰는 `ReviewOpinion.memo`·`reason`(200자 자유 문장)과 파일의 다른 자유 문장 칸(Requirement.question, Opportunity.distinctionBasis·reviewCondition, Customer.identityBasis, ItemJudgment 입력의 factJudged 등)에는 검사가 없다. 팀 규칙 "개인정보(연락처)를 저장하지 않는다"(CON-11)를 의견 저장 경로에서 어길 수 있다. | 연락처 패턴 검사를 "모든 자유 문장 칸과 의견 저장 요청"으로 넓힌다. 의견 저장에서 걸리면 400 fields[]로 거부하는 동작과 화면 문구를 BR9.1에 더한다. | New |
| R-07 | Medium | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md > BR10.3; entities.md > EvaluationRun.blockerText | 승인 막힘(blocksApproval)은 평가가 아니라 목록·상세 조회 때 현재 Customer.relationStatus와 묶음 datasetKind로 다시 계산한다. EvaluationRun에는 막힘 여부 열이 없고 blockerText 문장 속에만 섞여 있다. 평가 뒤에 고객 관계 상태가 바뀌면 평가를 다시 하지 않아도 "승인 막힘"이 달라지고, 저장된 평가·이유 문장과 어긋나 재현성(BR4.8, BR7.2) 취지에 맞지 않는다. | EvaluationRun에 `blocksApproval`(boolean)을 스냅샷 값으로 저장하고 조회는 그 값을 쓰게 한다. 관계 상태 변경은 재평가로만 반영한다고 정한다. | New |
| R-08 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Requirement(holder·site 없음); rules.md > BR3.2 | C3 requirements에는 holder·site가 있고 BR3.2도 "요구에 값이 있으면 비교"라고 하지만 Requirement 엔티티와 CaseFile requirements에는 두 열이 없다. 비교 조건이 항상 "자격 값 사용"으로만 동작한다. | holder·site를 Requirement에 더하고 CaseFile 더하는 변경에 포함하거나, BR3.2에서 U1은 비교하지 않는다고 명시한다. | New |
| R-09 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > EvaluationRun.runStatus; functional-spec.md > 3-2, 7장 | 평가 실패는 전체 롤백이라 `runStatus=FAILED` 행이 저장되지 않아 도달할 수 없는 값이다. 또 기회 한 곳의 E/P/R 검증 실패가 묶음 전체를 FAILED로 만드는 점(부분 시연 10~20곳)은 의도인지 적혀 있지 않다. | FAILED 값을 지우거나 언제 저장되는지 정한다. 한 기회 실패 시 묶음 전체 실패인지 해당 기회만 건너뛰는지 W3에 한 줄로 확정한다. | New |
| R-10 | Low | aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/entities.md > Process·ProcessCapability 등의 reviewStatus와 FieldEvidence.reviewStatus | 현재 검수 상태가 엔티티 열과 FieldEvidence 최신 행 두 곳에 있다. 어느 쪽이 원본이고 둘이 어긋날 때 어떻게 하는지 없다. | "엔티티 열이 현재값, FieldEvidence는 이력"처럼 원본을 정하고 갱신을 같은 트랜잭션으로 묶는다고 적는다. | New |

### Validation Tool Results

| Tool | Result | Interpretation |
|---|---|---|
| traceability.json 직접 검사(python3 -I) | PASS: upstream_ids 58건 = coverage id 58건, OK 대상 BR 모두 rules.md에 있음, rules.md의 BR 72개 모두 coverage 또는 reverse에 있음, reverse 항목 모두 실재 규칙 | 구조는 맞다. 다만 AC5.2.3 → BR3.5 연결은 위 High(BR3.4 약화)로 내용상 충족되지 않는다. |
| 스토리 AC 누락 확인 (US1.1/1.2/3.2/5.1/5.2/5.3/6.1/6.2/7.1/10.1/10.4) | PASS: stories.md의 해당 AC가 모두 upstream_ids에 있음. Deferred 3건(AC3.2.3 U5, AC3.2.4 U6, AC6.2.3 U2)은 스토리 매핑상 타당 | 누락 없음 |
| A정밀 산식 재계산 | PASS: F 60, T 17, E 77, P 95, R 82, S 77/95×100=81.0526 → 81.1(HALF_UP). 읽기 예시 2는 E 25, P 25, S 100, C 12.5 | BR4.1~BR4.7 산식은 맞다. 단 입력 경로 구멍(위 첫째·둘째 High)이 있어 구현은 막힌다. |
| 분류 11분기 순서(BR6.1) / 소개서 묶음(BR5.6, BR3.4, BR6.1) | PASS: FR4.10 순서 그대로, ②/③ 구분 일관 | 위 BR3.4 필요 단계 UNKNOWN 불일치를 제외하면 일관됨 |
| 소유권/외래 키(ADR-011) | PASS: 접두사 넘는 참조는 fk false, 존재 확인 명시 | 위반 없음 |

### Suggestions

- 약속 파일 "더하는 변경" 목록은 한 곳(예: rules.md 마지막 절)으로 모으고, 이번에 발견한 relation·scheduledAt·announcedAt·(holder·site)까지 포함해 PM 확인 대상으로 한 번에 보여 주면 코드 생성 전에 빠뜨리지 않는다.
- 엔티티 요약표의 "이 단계에서 더하는 키는 baseDate뿐"이라는 문장은 위 수정 후 함께 고친다.

### Summary

산식(A정밀 E 77 / P 95 / S 81.1 / R 82)과 11분기 순서, 추적표 구조는 맞지만, 평가의 핵심 입력인 itemInputs를 저장할 곳과 신호의 relation·예정일 열이 사례 파일·계약에 없어 뼈대 경로를 추측 없이 구현할 수 없고, BR3.4가 필터 한 문장 규칙(필요 단계 미확인이면 확인 대기)을 약화한다. High 3건을 고친 뒤 재검토가 필요하다.
