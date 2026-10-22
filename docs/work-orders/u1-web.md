# 작업 지시서 — U1 최소 화면 (Part E, 담당: 고선주)

이 문서는 AI 도구(Claude Code·Codex)에 그대로 붙여 넣어도 되게 썼습니다. 이슈 **#11**(화면 구현, 가짜 응답으로 먼저, Step 23·24)과 **#12**(실제 API 연결·한 덩어리 빌드, Step 25)의 일입니다. 공통 규칙은 `AGENTS.md`, 시작 절차는 `docs/team-start-guide.md`입니다.

전제: 기본 틀(PR #1)이 `develop`에 합쳐지면 바로 시작할 수 있다(서버 없이 가짜 응답으로 동작). PR 2(실제 연결)는 이강욱의 API PR(#10)이 합쳐진 뒤.

## 0. 한 줄 요약

`web/src/`에 공통 틀 → 추천 목록(S1) → 근거 상세(S2) → 의견 영역(S3)을 만들어, 담당자가 목록에서 A정밀 카드를 보고 [검토할 만함]을 누르면 "저장됨 HH:MM" 뒤 "의견: 검토할 만함 (수정)"이 남고, [자세히 보기]로 상세의 요구 표·확인 질문·점수를 볼 수 있게 한다. 먼저 `VITE_USE_FIXTURES=1`(가짜 응답)로 만들고, API가 합쳐지면 실제로 연결한다.

## 1. 만들 파일 / 고치면 안 되는 파일

**PR 1 `seonju/11-web-mock` (Step 23·24) — 전부 `web/src/` 안 새 파일**

| 파일 | 하는 일 | 규칙 |
|---|---|---|
| `components/frame/AppFrame.tsx` | 로고 자리·메뉴 "추천 목록"·건너뛰기 링크·h1·담당자 Select(localStorage 기억, viewer 포함)·`header/nav/main` 랜드마크 | BR9.3, BR10.8, 접근성 A6~A9 |
| `components/frame/StatusBanner.tsx` | 띠: 내부용 항상·가상 데이터·거산 확인 전(BROCHURE)·demoLabel·갱신 시각, `role="status"`, 닫기 없음, 한 줄에 점으로 이어 표시 | BR10.4 |
| `components/common/FiveStates.tsx` | 비어 있음(Empty)·불러오는 중(Skeleton, 5초 안내)·정상·오류(+다시 시도)·일부 | BR10.7, NFR2.11·2.12 |
| `components/common/StatusTag.tsx` | 색+글자 태그(6가지 조합 `statusPalette`만) | 접근성 A3·A19 |
| `components/opinion/OpinionArea.tsx` | 버튼 3개(`aria-pressed`), '대상 아님' 사유 인라인(필수, Esc로 닫힘), 저장 중 로딩, "저장됨 HH:MM" 3초 → "의견: … (수정)", 실패 시 입력 유지, 담당자 미선택·viewer면 비활성 + "먼저 담당자를 고르세요", previousValue 안내, `aria-live="polite"`, 연락처 패턴 안내 | BR9.1, BR9.4, BR10.6 |
| `pages/OpportunityListPage.tsx` + `components/list/OpportunityCard.tsx` | S1: 카드(순위·제목 h2·분류 쉬운 말·scoreDisplay·추천 이유·막는 조건 "(승인 막힘)/(승인은 막지 않음)"·다음 할 일·재평가됨·가상 표시)·OpinionArea·[자세히 보기]·쪽 넘김("1~20 / N건", 1건이면 숨김)·다섯 상태 | BR10.1~BR10.3 |
| `pages/OpportunityDetailPage.tsx` + `components/detail/HeaderSection.tsx`, `ReasonsSection.tsx`(질문 3개+펼치기, `aria-expanded`, 상태 글자), `RequirementsTable.tsx`(머리글 행 `th scope="col"`, 10행 넘으면 스크롤, 0개 문구), `ApprovalEligibilityLine.tsx`, `ProcessLinksSection.tsx`, `EvidenceSection.tsx`(확인/추정 글자), `ScoresCollapse.tsx`(기본 접힘, E/P/S/R/C·항목표·규칙 버전·묶음·시각) | S2: 영역별 부품, 맨 아래 OpinionArea, "목록으로" | BR10.5, BR8.3 |
| `router.tsx`(`/`, `/opportunities/:oppId`), `App.tsx` 수정(라우터·AppFrame 연결) | 라우팅 | — |
| `labels/ko.ts` | **추가만**(기존 키 변경 금지) | U1 확장 지점 규칙 |
| `src/**/__tests__/*.test.tsx` | 단위 테스트 26개(2장 표) | — |

**PR 2 `seonju/12-web-connect` (Step 25)**: `VITE_USE_FIXTURES` 없이 `geosan serve` + `npm run dev`(프록시)로 A정밀 목록·상세·의견 저장이 실제로 도는지 확인하고 어긋난 필드를 **화면 쪽에서** 고친다(필드 이름은 계약 C1·`src/api/types.ts` 그대로, 서버가 기준). `npm run build` → `web/dist`가 `geosan serve`에서 보이는지 확인. 설정(`/config/ui`)의 담당자 목록·brand·classificationLabels로 화면 기본값을 덮어쓴다.

**고치면 안 되는 파일(경계 파일, 고치려면 PM에게 먼저 말한다)**

- `src/api/types.ts`(응답 타입), `src/api/client.ts`(요청·오류·가짜 응답 전환), `src/theme/tokens.ts`, `src/config/brand.ts`, `src/test/fixtures/*.json`(가짜 응답 — 모양을 바꿔야 하면 PM), `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `package.json` 의존성(새 패키지는 PM과 상의; 기존 Ant Design·react-router-dom으로 만든다).
- `geosan/`, `examples/`, `contracts/`, `tests/`, `.github/`, `scripts/`, `AGENTS.md`.

## 2. 단계 순서 (구현 → 단위 테스트)

1. 읽기(5장). 특히 `mockups.md` 3·4·5장(S1·S2·S3 그림과 다섯 상태), `interaction-spec.md` 1.1·2.16·3.1, `design-system-mapping.md`(부품 대응·토큰·6가지 색), `accessibility-checklist.md` 1~3장, `rules.md` BR9·BR10.
2. `VITE_USE_FIXTURES=1 npm run dev`로 가짜 응답을 보며 공통 틀 → StatusBanner → FiveStates → OpinionArea → 목록 → 상세 순으로 만든다. 모든 상호작용 요소에 `data-testid`(kebab-case, 예: `opinion-worth-review-button`, `card-view-detail-link`).
3. 색·글꼴·문구는 `tokens.ts`·`brand.ts`·`labels/ko.ts`에서만 가져온다(직접 적지 않음). 모달·서랍·notification을 쓰지 않는다(인라인). `dangerouslySetInnerHTML` 금지.
4. 단위 테스트 26개(아래 표)를 `src/**/__tests__/`에 쓰고 통과시킨다. fetch는 `vi.fn`으로 바꾸거나 `client.ts`의 함수를 `vi.mock`하고 응답은 `src/test/fixtures/*.json`.
5. `npm run lint`·`format:check`·`test`·`build` 통과 뒤 PR 1. 접근성 점검표 1~3장을 직접 점검한 결과(키보드만으로 목록→상세→의견, axe 점수)를 PR 본문에 적는다.
6. API PR이 합쳐지면 PR 2(실제 연결).

| 테스트 파일 | 개수 | 핵심 검사 |
|---|---|---|
| `StatusBanner.test.tsx` | 5 | 내부용 항상, 가상 데이터, 거산 확인 전(BROCHURE), demoLabel, 갱신 시각 |
| `OpinionArea.test.tsx` | 7 | 3값 저장, 사유 필수(글자 오류), 저장됨 → "의견: … (수정)" 전환, 실패 시 입력 유지, 담당자 미선택 비활성, previousValue 안내, aria-live |
| `OpportunityListPage.test.tsx` | 6 | 빈 상태 문구, 불러오는 중(Skeleton), 오류+다시 시도, 카드 내용(순위·분류 쉬운 말·점수·막는 조건 글자), "참고 N" 표시, 쪽 넘김 문구 |
| `OpportunityDetailPage.test.tsx` | 6 | 영역 순서(1~5·의견), 질문 3개+펼치기, 요구 0개 문구, 확인/추정 글자, 점수 접힘 기본, 404 문구 |
| `labels.test.ts` | 2 | 코드표 밖 코드 방어(코드 그대로 + 경고), 분류 11개 모두 문구 있음 |

## 3. 완료 기준 (돌려야 할 명령과 기대 출력)

```bash
cd web
npm run lint && npm run format:check      # 오류 없음
npm test                                  # 26개 이상 passed (러너 확인 3개 포함 29개)
npm run build                             # tsc·vite build 성공, dist/ 생성
VITE_USE_FIXTURES=1 npm run dev           # 브라우저에서 A정밀 카드 1건: 순위 1 · "지금 바로 연락 검토" · 81 · 막는 조건 "없음 — … (승인은 막지 않음)"
```

가짜 응답으로 확인할 화면 흐름(10/30 시연 5단계): 목록 → [검토할 만함] → "저장됨 HH:MM" → "의견: 검토할 만함 (수정)" → [자세히 보기] → 상세(요구 표 3행: ISO 9001 통과(응모 가능) / 품질팀 샘플 승인 나중 단계 / Nadcap 질문 필요(승인은 막지 않음), 확인 질문 1개, 점수 자세히 보기 펼치면 E 77·P 95·S 81.1·R 82) → [목록으로]. 담당자를 "보기 전용"으로 바꾸면 의견 버튼이 비활성이고 글자가 보인다.

PR 2 뒤: `python -m geosan serve`를 띄운 상태에서 `npm run dev`(프록시)로 같은 흐름이 실제 서버로 돌고, `npm run build` 뒤 `http://127.0.0.1:8000/`에서 화면이 뜬다.

## 4. 하지 말 것

- 화면 코드에 색·글꼴 값·분류 문구를 직접 적지 않는다(`tokens`·`brand`·`labels`만). 쉬운 말 대응표 밖 문구를 만들지 않는다(필요하면 `labels/ko.ts`에 **추가**).
- 전문 용어(E/P/R, 필터, 프로필)는 "점수 자세히 보기" 안에서만.
- 정렬을 바꾸는 조작, 검색, 담기, 승인, 결과 기록, 대시보드를 만들지 않는다(뒤 단위).
- 응답 필드 이름을 바꾸거나 `types.ts`를 고치지 않는다. 서버와 다르면 화면이 서버에 맞춘다(C1이 기준).
- 오류 코드를 화면에 보이지 않는다(쉬운 말 + 다음 행동 + [다시 시도], ref는 작게).
- 가짜 응답 통과를 실제 연결 성공으로 보고하지 않는다(PR 1은 "가짜 응답으로 확인"이라고 적는다).
- 거산 로고·실제 브랜드 자료가 오기 전에는 `brand.ts` 초기값을 바꾸지 않는다.

## 5. 읽을 설계 문서

- `inception/refined-mockups/mockups.md` — 3장 S1, 4장 S2, 5장 S3, 다섯 상태, 9장 10/30 시연 5단계
- `inception/refined-mockups/interaction-spec.md` — 1장 공통 규칙·1.1 다섯 상태, 2.16 StatusBanner, 3.1 흐름 1, 4장 입력 검증
- `inception/refined-mockups/design-system-mapping.md` — 토큰·6가지 색·부품 대응·반응형·6장 파일 위치
- `inception/refined-mockups/accessibility-checklist.md` — 1장 공통, 2장 S1, 3장 S2, 7장 테스트 방법
- `construction/u1-skeleton/functional-design/rules.md` — BR9(의견), BR10(화면)
- `inception/contract-design/contract-summary.md` — C1(응답 모양·오류 형식·X-Staff-Key), 3장
- `construction/u1-skeleton/code-generation/code-generation-plan.md` Step 23~26, `unit-test-instructions.md` 3장

(모두 `aidlc/spaces/default/intents/261019-geosan-sales-agent/` 아래)

## 6. PR 올리는 법

1. `git switch develop && git pull` → `git switch -c seonju/11-web-mock` (PR 2는 `seonju/12-web-connect`)
2. 부품 하나마다 쉬운 한국어 커밋(예: `추천 목록 카드 추가: 분류는 쉬운 말로, 막는 조건에 승인 막힘 여부 표시`).
3. 3장 명령 통과 뒤에만 PR. PR 본문은 템플릿을 모두 채우고 `Closes #11`(PR 2는 `Closes #12`). "mock으로만 확인한 것"에 가짜 응답 범위를 적는다. 약속 파일을 바꿨나요? → "아니오".
4. 이슈에 쉬운 말 요약 댓글, 보드 '리뷰 중'. PM 세션이 계약 C1 필드·대응표 밖 문구 없음·색 직접 지정 없음·`data-testid`·접근성 항목을 확인한 뒤 merge commit으로 `develop`에 합친다(Step 26).
