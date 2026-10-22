# 작업 지시서 — U1 규칙 엔진 (Part C, 담당: 유동렬)

이 문서는 AI 도구(Claude Code·Codex)에 그대로 붙여 넣어도 되게 썼습니다. 이슈 **#6**(규칙 엔진 구현, Step 13)과 **#7**(단위 테스트·PR, Step 14)의 일입니다. 공통 규칙은 `AGENTS.md`, 시작 절차는 `docs/team-start-guide.md`입니다.

## 0. 한 줄 요약

`geosan/rules/` 안에 **순수 계산** 규칙 엔진을 만들어, A정밀 입력이 E 77 / P 95 / S 81.1 / R 82 / C 87.5 · 필터 PASS · 핵심 근거 MET · 분류 CONTACT_URGENT로 나오고, 읽기 예시 2가 E 25 / P 25 / S 100 / C 12.5 · 접촉 후보 아님으로 나오게 한다. 수치는 전부 규칙 설정에서 받고 코드에 숫자를 적지 않는다.

## 1. 만들 파일 / 고치면 안 되는 파일

**만들 파일(전부 새 파일, `geosan/rules/` 안)**

| 파일 | 하는 일 | 규칙 |
|---|---|---|
| `geosan/rules/requirements.py` | 요구별 판정: 자격 대조 7조건, 기술 조건 대조, 표시 변환, 필터 상태, 제외 범위 | BR3.1~BR3.7, BR3.10 |
| `geosan/rules/items.py` | 8항목 점수: 대표 신호 선택, 감쇠, HALF_UP 반올림, 7상태, 항상 8행 | BR4.1~BR4.5 |
| `geosan/rules/totals.py` | 합계 F/T/E/P/S/C/R과 검증(0≤E≤P≤100, E≤R≤100) | BR4.6 |
| `geosan/rules/timing.py` | 핵심 근거, 시점 ①②③, 운영 전제 반영, 조사 요건, 기한 체크 초기화 판단 | BR5.1~BR5.5, BR5.7, BR7.4 |
| `geosan/rules/classify.py` | 11분기 분류(순서대로 첫 해당), 소개서 묶음 ②/③, 표시값(추천 이유·막는 조건·blocksApproval·scoreDisplay·nextAction) | BR6.1~BR6.3, BR5.6, BR10.2, BR10.3 |
| `geosan/rules/rank.py` | sortKey·originalRank, OTHER 정렬(설정 `otherGroupSort`) | BR6.4, BR6.5 |
| `geosan/rules/questions.py` | 확인 질문 후보 | BR8.1 |
| `geosan/rules/engine.py` | `evaluate(input) -> EvaluationOutput`, `rank(outputs, dataset_kind, rule_config) -> list[RankOutput]` 본문 | BR4.8 |
| `tests/unit/u1/test_rules_requirements.py` 외 5개 | 단위 테스트(2장 참고) | — |
| `tests/data/reading_example2.json` | 읽기 예시 2 입력(25점 한 항목만 확인, 나머지 UNAVAILABLE) | BR4.7 |

**고치면 안 되는 파일(경계 파일, 고치려면 PM에게 먼저 말한다)**

- `geosan/rules/codes.py`(코드표), `geosan/rules/models.py`(입력·출력 모델, `evaluate`·`rank` 서명) — 모델 필드가 모자라면 이슈에 적고 PM에게 묻는다. `models.py`의 `evaluate`·`rank`는 서명을 보여 주는 자리이고 본문은 `NotImplementedError`로 남겨 둔다(고치지 않는다). 실제 함수는 **`geosan/rules/engine.py`에 같은 서명으로** 구현하며, 평가 흐름(이강욱)과 테스트는 `from geosan.rules.engine import evaluate, rank`로 부른다.
- `geosan/` 안의 다른 폴더 전부, `examples/`, `contracts/`, `tests/conftest.py`, `tests/factories.py`(함수 추가는 됨), `web/`, `.github/`, `scripts/`, `AGENTS.md`.

## 2. 단계 순서 (구현 → 단위 테스트, 이 순서 그대로)

1. 읽기: `aidlc/spaces/default/intents/261019-geosan-sales-agent/construction/u1-skeleton/functional-design/rules.md`(BR3~BR8, BR10.2·10.3), `entities.md`(ItemJudgment·RequirementCheck·EvaluationRun), 계약 `inception/contract-design/contract-summary.md` C3, 그리고 `geosan/rules/models.py`·`codes.py`·`examples/rule-config.yaml`. A정밀 손 계산은 이미 확인된 내용이라 다시 하지 않는다.
2. `requirements.py` → `items.py` → `totals.py` → `timing.py` → `classify.py` → `rank.py` → `questions.py` → `engine.py` 순으로 구현한다. 함수 docstring에 규칙 번호(BR x.y)를 적는다.
3. `engine.evaluate`가 A정밀 입력으로 기대값을 내는지 먼저 확인한다(3장 명령). 입력은 `examples/case-apjeong.json`을 `EvaluationInput` 모양으로 옮긴 `tests/data/apjeong-input.json`을 만들어 쓴다(규칙 엔진 단독 입력: 거산 값은 `examples/capability-geosan.json`의 ANODIZING 공정·ISO 9001 자격을 ID를 붙여 옮긴다).
4. 단위 테스트 41개(아래 표)를 쓰고 통과시킨다. `geosan/rules/` 커버리지 95% 이상.
5. 포매터·린터(`ruff format .`, `ruff check .`)를 통과시킨 뒤 PR을 올린다(4장).

| 파일 | 개수 | 핵심 검사 |
|---|---|---|
| `test_rules_requirements.py` | 8 | 통과 7조건 각각 실패 시 UNKNOWN/EXCLUDED, LATER 단계 → LATER_STAGE, TECHNICAL 범위 안/밖, QUANTITY_DELIVERY는 UNKNOWN 고정 |
| `test_rules_items.py` | 8 | 15×0.67=10.05→10, 81.05→81.1 규칙의 반올림 함수, 단계값 밖 거부, 대표 신호 선택(최근 발생/가장 이른 마감), 예정 사건 미확보, 채용 종료 0, 공고 마감=기준일 1.0, 자격 validTo=기준일 유효 |
| `test_rules_totals.py` | 6 | P=0 → S None, E>P 검증 실패, R 재계산(추정 항목 1.0 재계산), C 소수 1자리 |
| `test_rules_classify.py` | 8 | 11분기 순서, RECHECK는 ⑤⑥⑦ 건너뜀, 기준점은 설정값(설정을 바꾸면 결과가 바뀜), BROCHURE ②/③, scoreDisplay "--"/"참고 N"/정수, blocksApproval |
| `test_rules_rank.py` | 6 | 그룹 순서 URGENT→PLANNED→REVIEW→OTHER, URGENT 안 validUntil 오름, OTHER default/brochure, 두 번 실행 동일 |
| `test_rules_questions.py` | 5 | PENDING 자격·UNKNOWN 수준·단계 미확인 질문 생성, 통과값 질문 없음, 대상당 하나 |

## 3. 완료 기준 (돌려야 할 명령과 기대 출력)

```bash
source .venv/bin/activate
python -m pytest tests/unit/u1/test_rules_requirements.py tests/unit/u1/test_rules_items.py tests/unit/u1/test_rules_totals.py tests/unit/u1/test_rules_classify.py tests/unit/u1/test_rules_rank.py tests/unit/u1/test_rules_questions.py -q --cov=geosan/rules
# 기대: 41 passed, geosan/rules 커버리지 95% 이상
ruff format --check . && ruff check .
# 기대: 오류 없음
```

A정밀(`tests/data/apjeong-input.json`, baseDate 2026-10-20)로 `engine.evaluate`를 돌리면:

| 값 | 기대 |
|---|---|
| totals | E 77, F 60, T 17, P 95, R 82, S 81.1, C 87.5 |
| items | NEW_PRODUCT 25, NEW_MATERIAL 20, NEW_RECORD 10, NEW_PERF 5, SIG_EXPAND 10, SIG_ORDER 0(NO_SIGNAL), SIG_BID 7, SIG_HIRE None(UNAVAILABLE) |
| filterState / coreEvidenceMet | PASS / MET |
| requirementChecks displayResult | ISO 9001 PASS, 품질팀 샘플 승인 LATER_STAGE, Nadcap QUESTION_NEEDED |
| timing | directSignal True, agreedWindow True(21일 ≤ 21일), readiness True |
| classificationCode | CONTACT_URGENT, sortKey.group URGENT, validUntil 2026-11-10 |
| display | blocksApproval False, scoreDisplay "81", blockerText에 "없음" |
| questionCandidates | Nadcap 1개(targetKind REQUIREMENT) |

읽기 예시 2(`tests/data/reading_example2.json`): NEW_PRODUCT만 CONFIRMED 1.0, 나머지 7항목 UNAVAILABLE → E 25, P 25, S 100.0, C 12.5, 접촉 후보 아님(⑤⑥⑦이 아님).

시나리오 테스트(`tests/features/u1/reading_example2.feature` 등, PM 세션 작성)는 세 트랙이 합쳐진 뒤 초록이면 된다. 자기 PR에서는 위 단위 테스트만 초록이면 된다.

## 4. 하지 말 것

- 배점·단계값·확실도·감쇠·기준점·조사 시간 상한을 코드에 숫자로 적지 않는다(`rule_config`에서 읽는다). 설정에 없는 값이 필요하면 멈추고 이슈에 적는다.
- 경계 파일(`codes.py`, `models.py`)과 약속 파일(`contracts/`)을 고치지 않는다.
- 현재 시각·난수·파일·DB·네트워크를 쓰지 않는다(`datetime.now()` 금지, 기준일은 입력).
- 테스트 기대값(A정밀, 읽기 예시 2)을 구현에 맞춰 바꾸지 않는다. 다르면 PM에게 묻는다.
- 거산 역량 파일·회사소개서 값·거산 내부 자료를 AI 도구에 넣지 않는다(가상 검수 파일 `examples/capability-geosan.json`은 가상이라 넣어도 된다).
- 담당 폴더 밖 파일을 고치지 않는다.

## 5. 읽을 설계 문서

- `construction/u1-skeleton/functional-design/rules.md` — BR3(요구 판정·필터), BR4(점수·합계), BR5(핵심·시점·운영·조사), BR6(분류·정렬), BR8(질문), BR10.2·10.3(표시값)
- `construction/u1-skeleton/functional-design/entities.md` — ItemJudgment, RequirementCheck, EvaluationRun 열
- `inception/contract-design/contract-summary.md` — C3(입력·출력·rank·기대값), C0(코드표)
- `inception/requirements-analysis/requirements.md` — 부록 A(규칙 설정 명세), FR10.1(A정밀 역산 입력)
- `construction/u1-skeleton/code-generation/code-generation-plan.md` Step 13·14, `unit-test-instructions.md` 3장

(모두 `aidlc/spaces/default/intents/261019-geosan-sales-agent/` 아래)

## 6. PR 올리는 법

1. `git switch develop && git pull` → `git switch -c dongryeol/6-rules-engine`
2. 기능 하나(파일 하나)를 끝낼 때마다 쉬운 한국어 한 문장으로 커밋(예: `항목 점수 계산 추가: 15×0.67은 10.05라 10으로 반올림`).
3. 3장 명령이 모두 통과한 뒤에만 PR을 연다. 제목 예: `규칙 엔진: 요구 판정·8항목 점수·11분기 분류 (A정밀 E77/P95/S81.1/R82 통과)`.
4. PR 본문은 `.github/pull_request_template.md`를 모두 채운다. "무엇이 되는지"는 사용자 입장(예: "A정밀 사례를 평가하면 지금 바로 연락 검토로 분류된다"). `Closes #6` (테스트 PR이면 `Closes #7`). 약속 파일을 바꿨나요? → "아니오".
5. 이슈 #6에 무엇을 했는지 쉬운 말 요약 댓글을 남기고 보드를 '리뷰 중'으로 옮긴다. PM 세션이 계약 C3·A정밀 기대값·경계 파일 미수정을 대조한 뒤 merge commit으로 `develop`에 합친다(Step 15).
6. 1~2개 PR로 나눠도 된다(예: 판정·점수·합계 / 분류·정렬·질문).
