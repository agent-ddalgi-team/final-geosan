# 실제 기업 사례 파일 작성 안내서 (완성판 2026-10-22, 이슈 #18)

10월 말 부분 시연에 쓸 **실제 기업 1곳 = 사례 파일 1개**를 만드는 방법입니다. 배분(2026-10-21 PM 결정)은 유동렬 약 6곳, 고선주 약 6곳, 이강욱 3곳, PM 2~5곳이고 PR 마감은 10/26(월) 저녁입니다(`docs/team-start-guide.md` 4-1장, 이슈 #19~#22, 이 안내서는 #18). 파일 형식은 계약 C7(CaseFile)이고 틀은 `examples/case-template.json`, 완성 예시는 `examples/case-apjeong.json`(가상)입니다. 형식 설명서는 `contracts/case-file.schema.json`입니다.

## 1. 원칙 세 가지

1. **공개 자료만** 근거로 씁니다 — 기업 공개 홈페이지 본문, 공고(나라장터 등), 보도자료. 채용 사이트·유료 기업 DB는 쓰지 않습니다(CON-08).
2. **연락처는 적지 않습니다** — 담당자 이름·이메일·전화번호는 어떤 칸에도 적지 않습니다. 자유 문장(quote·basis·notes 등)에 이메일·전화 패턴이 있으면 `check-case`가 거부합니다(BR2.1).
3. **모르면 모른다고 적습니다** — 요구 수준(`reqLevel`)·필요 단계(`neededStage`)·관계 상태(`relationStatus`)를 짐작해 채우지 않습니다. 모르면 `UNKNOWN`/`UNCONFIRMED`입니다(BR2.6). 추정을 확인(`CONFIRMED`)으로 적지 않습니다.

AI 도구(Claude Code·Codex)에 공개 홈페이지 본문을 넣어 초안을 만들어도 됩니다. 거산 역량 파일·회사소개서 값·거산 내부 자료는 넣지 않습니다.

## 2. 순서

1. **후보 고르기** — 이슈 #16(2026-10-22 확정)의 기준으로 산단공 전국등록공장현황 CSV(공공데이터포털, 2025-12-31 기준)에서 고릅니다.
   - 공정 2개: **① 아연도금(전기아연도금, 우선) `ZINC_PLATING`** — 생산품 키워드 자동차부품, 배전반·분전반·제어반, 프레스, 브라켓, 농기계, 볼트·너트·파스너, 스프링, 금구·철물 / **② 아노다이징 `ANODIZING`** — 반도체 장비·부품, 알루미늄(알미늄·AL) 가공·압출·다이캐스팅, 방열·히트싱크, 디스플레이 장비. 대략 아연도금 2 : 아노다이징 1.
   - 지역: 충청남도(천안·아산 우선, 당진·서산 포함), 대전광역시, 세종특별자치시.
   - 뺄 것: 생산품에 도금·표면처리·아노다이징·피막·코팅·열처리·도장이 들어간 곳(직접 하는 곳), 철구조물·레미콘·창호·샷시·방충망·간판처럼 공정과 안 맞는 곳, 홈페이지가 없어 근거 3종을 못 찾는 곳.
   - 고른 회사명을 **먼저 자기 이슈(#19·#20·#21)에 댓글로 적어** 겹치지 않게 합니다.
2. 그 회사의 공개 홈페이지·공고에서 **근거 3종**을 찾아 원문 인용·출처 주소·날짜를 적습니다.
   - 제품·부품(`subject: PRODUCT`) — 표면처리가 필요한 제품을 만드는가
   - 소재(`subject: MATERIAL`) — 알루미늄·철·동·스테인리스 등
   - 처리 목적(`subject: PURPOSE`) — 내식·내마모·외관·전도 등
   - 있으면 시점 신호(`subject: SIGNAL`) — 증설·신규 수주·공고·채용
3. `examples/case-template.json`을 복사해 `examples/cases/<회사-품목-공정>.json`으로 저장하고 칸을 채웁니다(칸마다 `_설명`에 뜻과 허용 값이 있습니다. `examples/cases/` 폴더가 없으면 만듭니다). `caseId`는 영문 소문자·숫자·하이픈만(예: `b-precision-bracket-zinc`), 한글·공백은 안 됩니다. 실제 기업의 고정값은 5장, 거산 값 참조는 2-1장을 봅니다. `baseDate`는 비워 두면 PM이 평가 때 `--base-date`로 넣습니다(10/27 1차 출력 기준일은 2026-10-27).
4. 8항목 판정(`itemInputs`)을 아래 3장 판정표대로 적습니다.
5. `geosan check-case <파일>`로 검사합니다. 저장 없이 형식·허용 값·연락처만 봅니다(DB 불필요). 오류는 "몇 번째 줄 어느 항목이 왜"로 나옵니다. 역량 파일을 함께 주면(`--capability examples/capability-geosan-brochure.json`, 실제 기업은 소개서 묶음 파일) 공정 코드·역량 이름·실적 산업이 그 파일에 있는지도 검사합니다. 내 파일이 어떻게 평가되는지 미리 보려면 `geosan demo-report --capability examples/capability-geosan-brochure.json --cases <내 사례 폴더> --out <아무 폴더>`를 돌립니다(사례 폴더에는 사례 파일만 넣고 `case-template.json`은 넣지 않음).
6. PR로 올립니다(이슈 번호 연결, `자료` 라벨). 투입·평가는 PM이 합니다.

## 2-1. 거산 값 참조표 (소개서 묶음 `examples/capability-geosan-brochure.json`)

실제 기업 파일의 `processLinks[].processCode`·`appliedMaterial`과 `itemInputs[].usedCapabilityRefs`는 아래 값만 씁니다. 회사소개서(2026-09-21판)를 옮겨 적은 것이라 전부 검수 대기이며, 사실표·메모에는 "소개서 기준·거산 확인 전"이 붙습니다.

| 공정 코드 | 공정 이름 | 처리 소재 코드(`appliedMaterial`) | 성능 태그(`NEW_PERF` 대조) | 역량 항목 이름(`kind: CAPABILITY`의 `name`) | 실적 산업(`kind: DELIVERY_RECORD`의 `industry`) |
|---|---|---|---|---|---|
| `ZINC_PLATING` | 아연도금(전기아연도금) | FE, AL, CU | CORROSION, APPEARANCE | 도금 두께, 도금 종류, 국방색 아연도금 전용 라인, 염수분무 시험, 도금 두께 측정 | 방위산업, 자동차 부품 |
| `ANODIZING` | 아노다이징(양극산화피막) | AL, MG, ZN, TI, HF, NB | CORROSION, APPEARANCE, HARDNESS | 피막 종류, 처리 소재, 특허 피막, 실링(봉공처리), 염수분무 시험, 내마모·광택 시험 | 방위산업, 항공우주 |
| `BLACK_OXIDE` | 알카리 흑착(흑색산화피막) | FE | APPEARANCE, CORROSION, DIMENSIONAL | 피막 두께, 용도 | 반도체 |
| `ELECTROLESS_NICKEL` | 무전해 니켈 | AL, FE, CU | CORROSION, WEAR, CONDUCTIVITY | 도금 종류, 특징, 도금 두께 측정, 염수분무 시험 | 방위산업, 반도체 장비 |
| `CHROME_PLATING` | 크롬 도금 | AL, FE, CU | WEAR, HARDNESS, APPEARANCE, CORROSION | 도금 종류, 내마모·광택 시험, 도금 두께 측정 | - |
| `ELECTROPOLISHING` | 전해연마 | SUS | APPEARANCE, CORROSION | 용도, 처리 소재 | - |
| `PHOSPHATE_COATING` | 인산염 피막 | FE | CORROSION, PAINT_ADHESION | 용도 | 반도체 |
| `CHROMATE` | 크로메이트(화성피막) | AL | CORROSION, CONDUCTIVITY | 피막 종류, 염수분무 내식성, 전기접촉 저항 시험 | 방위산업 |
| `PASSIVATION` | 부동태(부동태 처리) | SUS | CORROSION | 처리 소재, 염수분무 시험 | 방위산업 |

- **알루미늄 주물(다이캐스팅)** 부품은 `appliedMaterial: "AL"`로 적고 `notes`에 "주물"이라고 남깁니다. 소개서에 주물 처리 여부가 없어 10/29 방문 때 확인합니다(`docs/visit-questions-20261029.md` B3). `AL_CASTING`은 가상 사례(A정밀)에만 있습니다.
- `NEW_RECORD`(납품실적) 판정은 위 "실적 산업"과 상대 회사 산업을 비교합니다. 예: 방산 부품 회사면 '동일 산업 0.67', 일반 자동차 부품 회사가 아연도금이면 '동일 산업 0.67', 실적 산업과 무관하면 `MISMATCH` 또는 `UNAVAILABLE`.
- `usedCapabilityRefs` 예시: `{ "kind": "PROCESS", "processCode": "ZINC_PLATING" }`, `{ "kind": "CAPABILITY", "processCode": "ZINC_PLATING", "name": "도금 두께" }`, `{ "kind": "DELIVERY_RECORD", "processCode": "ZINC_PLATING", "industry": "자동차 부품" }`. 표에 없는 이름·산업을 적으면 `check-case`가 경고를 냅니다(통과는 됨).

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
- `NEW_MATERIAL`·`NEW_RECORD`·`NEW_PERF`는 어떤 거산 값과 대조했는지 `usedCapabilityRefs`에 적습니다(공정 코드·역량 이름·실적 산업). 거산 값은 실제 기업이면 **소개서 묶음 파일 `examples/capability-geosan-brochure.json`**(회사소개서를 옮겨 적음, 검수 대기)의 공정 코드·역량 이름·실적 산업을 쓰고, 가상 사례(A정밀)만 `examples/capability-geosan.json`(가상)을 씁니다. 소개서 묶음의 알루미늄 소재 코드는 `AL`(주물 `AL_CASTING` 가능 여부는 거산 확인 전)입니다.

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

## 5-1. 상태값 뜻 — "모름"을 적는 두 가지 방법 (규칙 BR1.5·BR3.2)

역량 파일(거산 값)과 사례 파일에는 "확실하지 않음"을 뜻하는 값이 둘 있습니다. 둘 다 통과(PASS) 근거로는 쓰이지 않고, 확인 질문 후보가 됩니다. 값만 적지 말고 **`basis`(범위) 또는 `reason`(상태) 칸에 "이유: … 다음 할 일: …"을 같이 적습니다**(소개서 묶음 파일 `examples/capability-geosan-brochure.json`이 예시).

| 값 | 어디에 쓰나 | 뜻 | 예 |
|---|---|---|---|
| `UNKNOWN` | 자격 범위 `scopes[].applicability`, 요구 `reqLevel`·`neededStage`, 사례 `certainty` | **자료에 언급이 없거나 범위가 애매해서 판단할 수 없음.** 자료 자체가 없는 경우도 포함 | SEMES 인증서 범위가 "도금"으로만 적혀 어느 도금 공정인지 모름 → 세 공정에 `UNKNOWN` |
| `UNCONFIRMED` | 자격 현재 상태 `statuses[].status`, 고객 `relationStatus` | **자료(또는 언급)는 있지만 내용을 확인하지 못함.** 번호·유효기간을 못 읽었거나 지금 유효한지 모를 때 | 한화시스템 승인서 이미지가 흐려 번호·유효기간 판독 불가 → `UNCONFIRMED` |

- 비슷하지만 다른 값: 검수 상태 `reviewStatus`의 `PENDING`은 "값은 적혀 있고 거산 검수만 안 됨"(소개서 묶음은 전부 이 상태), `UNAVAILABLE`은 "값이 아예 없음", `RECHECK`는 "검수했는데 다시 봐야 함"입니다. 자격 범위에서 "해당 안 됨"이 확인되면 `UNKNOWN`이 아니라 `NOT_APPLIES`입니다.
- 거산에 물어볼 것이 생기면 `docs/visit-questions-20261029.md`(10/29 방문 질문 목록)에 더합니다.

## 6. check-case 오류 읽는 법 (실제 문구, 2026-10-22 확인)

`geosan check-case <파일> --capability examples/capability-geosan-brochure.json`을 돌리면 **오류**(고쳐야 통과)와 **경고**(통과는 되지만 확인 권장)가 "N번째 줄 항목: 이유"로 나옵니다. 줄 번호는 내 파일의 줄입니다.

| 나오는 문구(예) | 뜻 | 고치는 법 |
|---|---|---|
| `49번째 줄 requirements[0].reqLevel: 'REQUIRED', 'PREFERRED', 'NOT_REQUIRED', 'UNKNOWN' 중 하나여야 하는데 '필수'이 적혀 있습니다` | 허용 값 밖(한글로 적음) | 영문 코드로 바꿉니다 |
| `60번째 줄 requirements[0].reqlevel: 모르는 키 'reqlevel'입니다 (오타인지 확인해 주세요. 설명은 _설명 키에 적습니다)` | 키 이름 오타(대소문자 포함) | 틀의 키 이름을 그대로 복사합니다 |
| `129번째 줄 evidence[0].quote: 연락처는 저장하지 않습니다 (전화번호 패턴 발견)` | 인용문에 전화·이메일 | 그 부분을 지웁니다. 사업자번호는 `bizNumber` 칸에만 |
| `189번째 줄 itemInputs[0].evidenceRefs[0]: 번호 9은 evidence 배열 밖입니다 (0~4만 가능)` | 근거 번호가 범위 밖(0부터 셈) | `evidence` 배열의 순서를 다시 셉니다 |
| `196번째 줄 itemInputs[1].matchRate: NEW_MATERIAL의 일치도 단계 '정확히 일치'(1), '일부 가능'(0.5) 중 하나여야 하는데 '0.8'이 적혀 있습니다` | 자유로운 소수 | 3-1장 단계 이름이나 그 숫자만 씁니다 |
| `185번째 줄 itemInputs[0].certainty: state가 CONFIRMED이면 certainty도 'CONFIRMED'이어야 하는데 'WEAK'이 적혀 있습니다` | 상태와 확실도 불일치 | 둘을 같은 값으로(그 밖의 state면 `null`) |
| `278번째 줄 itemInputs[6].matchRate: SIG_BID의 matchRate 0.5이 대표 신호의 relation DIRECT(1)와 다릅니다` | 시점 항목 일치도가 신호의 관련도와 다름 | `signals[].relation`(DIRECT 1.0 / INDIRECT 0.5)과 맞춥니다 |
| `39번째 줄 processLinks[0].processCode: 'ZINC_PLATING', … 중 하나여야 하는데 'ANODIZE'이 적혀 있습니다` | 공정 코드 오타 | 2-1장 표의 코드를 복사합니다 |
| `3번째 줄 caseId: 영문 소문자·숫자·하이픈(-)만 쓸 수 있고 첫 글자는 영문·숫자여야 합니다: 'B사 브라켓'` | caseId에 한글·공백 | `b-company-bracket-zinc`처럼 바꿉니다 |
| `경고: 230번째 줄 itemInputs[2].usedCapabilityRefs[0].industry: 역량 파일의 ANODIZING 공정에 산업 '밸브·유체기기' 실적이 없습니다` | 역량 파일에 없는 실적 산업을 대조 대상으로 적음 | 2-1장 표의 산업 이름으로 바꾸거나, 실적 대조가 안 되면 `NEW_RECORD`를 `UNAVAILABLE`로 |

- 오류가 여러 개면 **한 번에 전부** 나옵니다. 위에서부터 고치고 다시 돌립니다.
- 마지막 줄 `검사 통과: … 저장하지 않았습니다. 투입은 geosan import-case`가 나오면 끝입니다. 통과했는데 결과가 궁금하면 `demo-report`로 미리 봅니다(2장 5번).
- `appliedMaterial`이 공정의 처리 소재와 안 맞는 것(예: 아노다이징에 FE)은 `check-case`가 잡지 않고 **평가에서 "소재 불일치"로 제외**됩니다. 2-1장 표를 보고 적습니다.

## 7. 적지 말 것 (다시 한번)

연락처(이름·이메일·전화), 단가·견적 금액, 거산 내부 자료, 추측으로 채운 필수/비요구 판정, 자유로운 소수 일치도(0.8 등).

## 8. PR 올리기 전 점검표 (파일 하나마다)

- [ ] `geosan check-case <파일> --capability examples/capability-geosan-brochure.json` 통과(경고는 읽고 판단).
- [ ] 근거 3종(제품·부품, 소재, 처리 목적)마다 원문 인용·출처 주소·날짜가 있고, 인용에 연락처가 없다.
- [ ] 8항목 모두 적었다. 모르는 항목은 `UNAVAILABLE`, 신호 없는 시점 항목은 `NO_SIGNAL`.
- [ ] `isVirtual: false`, `datasetKind: BROCHURE`, `relationStatus: UNCONFIRMED`, `agreedWindow: null`, `readinessCheck: null`, `expected: null`(5장).
- [ ] `notes`에 "주물" 같은 확인 필요 사항과 홈페이지 갱신일이 오래됐으면 그 사실을 적었다.
- [ ] PR 본문에 회사명·공정·분류 예상(아연도금/아노다이징)을 적고 `Closes #내 이슈`를 넣었다. 라벨 `자료`, 마일스톤 `10월 말 부분 시연`.
