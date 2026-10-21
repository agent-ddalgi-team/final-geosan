# 실제 기업 사례 파일 작성 안내서 (초안, Step 7 — Step 30에서 완성)

10월 말 부분 시연에 쓸 **실제 기업 1곳 = 사례 파일 1개**를 만드는 방법입니다. 팀원 각자 약 5곳을 씁니다(`docs/team-start-guide.md` 4-1장, 이슈 #18~#21). 파일 형식은 계약 C7(CaseFile)이고 틀은 `examples/case-template.json`, 완성 예시는 `examples/case-apjeong.json`(가상)입니다. 형식 설명서는 `contracts/case-file.schema.json`입니다.

## 1. 원칙 세 가지

1. **공개 자료만** 근거로 씁니다 — 기업 공개 홈페이지 본문, 공고(나라장터 등), 보도자료. 채용 사이트·유료 기업 DB는 쓰지 않습니다(CON-08).
2. **연락처는 적지 않습니다** — 담당자 이름·이메일·전화번호는 어떤 칸에도 적지 않습니다. 자유 문장(quote·basis·notes 등)에 이메일·전화 패턴이 있으면 `check-case`가 거부합니다(BR2.1).
3. **모르면 모른다고 적습니다** — 요구 수준(`reqLevel`)·필요 단계(`neededStage`)·관계 상태(`relationStatus`)를 짐작해 채우지 않습니다. 모르면 `UNKNOWN`/`UNCONFIRMED`입니다(BR2.6). 추정을 확인(`CONFIRMED`)으로 적지 않습니다.

AI 도구(Claude Code·Codex)에 공개 홈페이지 본문을 넣어 초안을 만들어도 됩니다. 거산 역량 파일·회사소개서 값·거산 내부 자료는 넣지 않습니다.

## 2. 순서

1. PM이 정한 공정 1~2개·지역·생산품 키워드로 산단공 전국등록공장현황 CSV에서 후보를 고릅니다(이슈 #16).
2. 그 회사의 공개 홈페이지·공고에서 **근거 3종**을 찾아 원문 인용·출처 주소·날짜를 적습니다.
   - 제품·부품(`subject: PRODUCT`) — 표면처리가 필요한 제품을 만드는가
   - 소재(`subject: MATERIAL`) — 알루미늄·철·동·스테인리스 등
   - 처리 목적(`subject: PURPOSE`) — 내식·내마모·외관·전도 등
   - 있으면 시점 신호(`subject: SIGNAL`) — 증설·신규 수주·공고·채용
3. `examples/case-template.json`을 복사해 `examples/cases/<회사-품목>.json`처럼 저장하고 칸을 채웁니다(칸마다 `_설명`에 뜻과 허용 값이 있습니다). `caseId`는 영문 소문자·숫자·하이픈(예: `b-precision-bracket-zinc`).
4. 8항목 판정(`itemInputs`)을 아래 3장 판정표대로 적습니다.
5. `geosan check-case <파일>`로 검사합니다. 저장 없이 형식·허용 값·연락처만 봅니다(DB 불필요). 오류는 "몇 번째 줄 어느 항목이 왜"로 나옵니다. 역량 파일을 함께 주면(`--capability examples/capability-geosan.json`) 공정 코드 존재도 검사합니다.
6. PR로 올립니다(이슈 번호 연결, `자료` 라벨). 투입·평가는 PM이 합니다.

## 3. 8항목 판정표 (일치도 단계 · 확실도 등급, 규칙 BR4.2·BR4.3)

### 3-1. 일치도(`matchRate`) — 항목별 고정 단계만 허용, 자유로운 소수 금지

단계 이름(한글)으로 적어도 되고 숫자로 적어도 됩니다. 어느 단계에도 해당하지 않음이 확인되면 `state: MISMATCH`(0점), 해당 여부를 모르면 `state: UNAVAILABLE`(미확보, 점수 없음)입니다.

| 항목 코드 | 항목 | 배점 | 단계 이름 → 일치도 |
|---|---|---:|---|
| `NEW_PRODUCT` | 표면처리가 필요한 제품·부품 생산 근거 | 25 | 해당 1.0 |
| `NEW_MATERIAL` | 소재와 거산 보유 공정 일치 | 20 | 정확히 일치 1.0 / 일부 가능 0.5 |
| `NEW_RECORD` | 유사 산업·부품 납품실적(거산 실적 기준) | 15 | 동일 부품 1.0 / 동일 산업 0.67 / 인접 산업 0.33 |
| `NEW_PERF` | 처리 목적·성능 태그 일치(내식·내마모·외관·전도 등) | 10 | 2개 이상 일치 1.0 / 1개 일치 0.5 |
| `SIG_EXPAND` | 공장 증설·신규 생산라인 | 10 | 직접 관련 1.0 / 간접 관련 0.5 |
| `SIG_ORDER` | 신규 수주·제품 출시·사업 확대 | 8 | 직접 관련 1.0 / 간접 관련 0.5 |
| `SIG_BID` | 입찰·협력사 모집·구매 공고 | 7 | 직접 관련 1.0 / 간접 관련 0.5 |
| `SIG_HIRE` | 관련 직무 채용(구매·품질·생산기술·표면처리) | 5 | 직접 관련 1.0 / 간접 관련 0.5 |

- 시점 항목(`SIG_*`)은 신호가 없으면 `state: NO_SIGNAL`(0점, 판정 완료)로 적고 `signalRefs`를 비웁니다. 신호가 있으면 `signals` 배열에 신호를 적고 `signalRefs`에 그 번호를 넣습니다. `matchRate`는 그 신호의 `relation`(DIRECT 1.0 / INDIRECT 0.5)과 같아야 합니다.
- 감쇠(발생일이 오래됐는지)는 시스템이 신호 날짜와 기준일로 계산하므로 적지 않습니다. 발생일(`occurredAt`)을 모르면 비워 둡니다(미확보 처리).
- `NEW_MATERIAL`·`NEW_RECORD`·`NEW_PERF`는 어떤 거산 값과 대조했는지 `usedCapabilityRefs`에 적습니다(공정 코드·역량 이름·실적 산업). 거산 값은 `examples/capability-geosan.json`(가상) 또는 PM이 만든 소개서 묶음 파일의 공정 코드를 씁니다.

### 3-2. 확실도(`state` / `certainty`) — 근거 등급으로 정합니다

| 상태 | 계수 | 등급 기준 (출처 등급 A/B/C/D는 아래 3-3) |
|---|---:|---|
| `CONFIRMED` 확인 | 1.0 | A 또는 B등급 자료가 **직접 명시** |
| `STRONG` 강한 추정 | 0.65 | A/B등급의 **간접** 근거, 또는 서로 독립인 C등급 2건 |
| `WEAK` 약한 추정 | 0.25 | C등급 단독, 또는 업종·제품 특성에서 추정 |
| `UNAVAILABLE` 미확보 | — | 근거가 없거나 D등급 단독 (점수 없음, 질문 후보) |

`certainty` 칸은 `state`와 같은 값(CONFIRMED/STRONG/WEAK)으로 적고, 그 밖의 상태면 `null`입니다.

### 3-3. 출처 등급(`sourceGrade`)과 보안 등급(`securityGrade`)

| 등급 | 뜻 |
|---|---|
| A | 공시·입찰 공고·기업 내부자료 |
| B | 기업 홈페이지·보도자료·채용 공고 |
| C | 출처 있는 DB·언론 |
| D | 블로그·출처 불명 (단독이면 확인 대기) |

공개 자료만 썼으면 `securityGrade: PUBLIC`, `externalAiAllowed: true`입니다.

## 4. 요구(`requirements`) 적는 법

- 공고·홈페이지에 적힌 인증·승인·기술 조건만 적습니다. "ISO 9001 보유 업체"처럼 원문에 필수라고 적혀 있으면 `reqLevel: REQUIRED`, 그 밖에는 `UNKNOWN`입니다.
- 언제 필요한지(응모 단계 `NOW` / 샘플·양산 `LATER`)가 원문에 없으면 `neededStage: UNKNOWN`입니다. 필수인데 단계가 불명확하면 시스템이 "확인 대기(승인 막힘)"으로 표시합니다(BR3.4).
- 거산에 물어볼 질문이 있으면 `question`에 한 문장(예/아니요로 답할 수 있게)으로 적습니다.
- 수량·납기는 시스템이 판정하지 않으므로 `reqKind: QUANTITY_DELIVERY`로 사실만 적습니다.

## 5. 실제 기업 파일의 고정값

| 칸 | 값 | 이유 |
|---|---|---|
| `isVirtual` | `false` | 실제 기업 |
| `datasetKind` | `BROCHURE` | 10월 말 부분 시연은 소개서 묶음(거산 확인 전)으로 평가 |
| `customer.relationStatus` | 보통 `UNCONFIRMED` | 거산 확인 전. 확인되면 PM이 바꿈 |
| `signals[].agreedWindow` | `null` | G0 합의 전 실제 후보는 합의값 없음(BR5.3) |
| `readinessCheck` | `null` | 담당자 체크는 화면(U5) 또는 PM 투입 |
| `expected` | `null` | 기대값은 가상 사례에만 |

소개서 묶음으로 평가한 실제 기업은 규칙상 "기다리는 중(확인 필요)" 또는 "준비 중"으로 분류되고 카드에 "참고 N" 점수가 보입니다. 접촉 승인은 열리지 않습니다(BR5.6). 이것이 정상입니다.

## 6. check-case 오류 읽는 법 (Step 30에서 예시 보강)

- `12번째 줄 requirements[1].reqLevel: 'REQUIRED', 'PREFERRED', 'NOT_REQUIRED', 'UNKNOWN' 중 하나여야 하는데 '필수요'가 적혀 있습니다` → 허용 값 밖. 영문 코드로 고칩니다.
- `… 모르는 키 'reqlevel'` → 오타. `_설명` 외의 모르는 키는 오류입니다.
- `… 연락처는 저장하지 않습니다` → 이메일·전화 패턴이 있는 칸을 지웁니다.
- `… evidenceRefs[0]=5: evidence 배열 밖 번호` → 근거 번호(0부터)를 확인합니다.
- `… SIG_BID의 matchRate 1.0이 대표 신호의 relation INDIRECT(0.5)와 다릅니다` → 신호의 `relation`과 맞춥니다.

## 7. 적지 말 것 (다시 한번)

연락처(이름·이메일·전화), 단가·견적 금액, 거산 내부 자료, 추측으로 채운 필수/비요구 판정, 자유로운 소수 일치도(0.8 등).
