# 디자인 시스템 대응 (Design System Mapping) — 거산케미칼 AI 영업지원 에이전트 2차

화면 부품 라이브러리는 **Ant Design 5**(React), 글꼴은 **Pretendard**입니다(`refined-mockups-questions.md` Q1·Q2). 기본 부품을 그대로 쓰되 테마 토큰으로 "깔끔하고 세련된 업무용" 느낌을 내고, 빽빽한 ERP 느낌은 피합니다. 세부 디자인 다듬기는 P3(US9.6)입니다. 거산 로고·강조색은 자료가 오면 이 문서의 토큰 한 곳만 바꿉니다(FR6.8).

## 1. 테마 토큰 (ConfigProvider theme)

| 토큰 | 값(초기) | 비고 |
|---|---|---|
| `colorPrimary` (강조색 1개) | `#1F5FBF` (차분한 파랑, 팀 제안) | 거산 색을 받으면 교체. 흰 바탕 대비 약 6.1:1 |
| `colorText` | `#1F2329` | 본문 글자, 흰 바탕 대비 약 15:1 |
| `colorTextSecondary` | `#5B6470` | 보조 글자(점수·시각), 대비 약 6.0:1 |
| `colorBgLayout` | `#F5F6F8` | 바깥 배경 |
| `colorBgContainer` | `#FFFFFF` | 카드·표 배경 |
| `colorBorderSecondary` | `#E3E6EA` | 카드·표의 구분선(장식용, 대비 기준 적용 안 함) |
| `colorBorder` (입력·버튼 테두리) | `#767F8C` | 입력 칸·선택·날짜·기본 버튼 테두리, 흰 바탕 대비 약 4.0:1 (3:1 기준 충족) |
| 초점선 (`:focus-visible`) | `#1F5FBF`, 2px 실선, 바깥 2px 간격 | 대비 약 6.1:1. Ant Design 기본 반투명 윤곽 대신 전역 CSS로 지정 |
| `colorError` / 기한 지남 글자 | `#B42318` | 흰 바탕 대비 약 6.4:1 |
| `borderRadius` | `8` | 살짝 둥근 모서리 |
| `fontFamily` | `'Pretendard Variable', Pretendard, -apple-system, 'Malgun Gothic', sans-serif` | 웹폰트는 `pretendard-variable` CDN 또는 자체 호스팅 |
| `fontSize` | `16` | 본문 16px(NFR8). 카드 제목 20px, h1 24px, 보조 14px(점수·시각만) |
| `lineHeight` | `1.6` | |
| `controlHeight` | `40` | 버튼·입력 높이(클릭 여유) |
| `padding` / `margin` | 기본값 + 카드 안 여백 20px | 넉넉한 여백 |
| `motion` | `false`를 `prefers-reduced-motion`에서 적용 | 접근성 |

로고: `src/config/brand.ts`에 `logoUrl`, `brandName`("거산 영업지원"), `colorPrimary`를 두고 ConfigProvider와 Header가 읽는다. 환경 변수 `VITE_BRAND_COLOR`로도 덮어쓸 수 있게 한다(NFR11).

## 2. 상태 색 체계 (색 + 글자, 항상 함께)

Ant Design 프리셋 태그는 글자색이 연해 14px에서 4.5:1에 못 미칠 수 있으므로, 태그·띠는 아래 **6가지 맞춤 조합**(배경 연함 + 글자 진함)만 쓴다. 색 수를 줄여 비전공 팀의 유지 부담도 줄인다.

| 조합 이름 | 배경 | 글자 | 대비(계산값) | 뜻 |
|---|---|---|---|---|
| `ok`(초록) | `#E3F3E8` | `#145A32` | 약 8.6:1 | 통과, 연락 검토 분류, 확인됨, 재평가됨 띠 |
| `wait`(노랑) | `#FFF3C4` | `#6B4E00` | 약 7.9:1 | 확인 대기(승인 막힘), 기다리는 중, 확인 기다림, 가상 데이터 띠 |
| `ask`(파랑) | `#E6EFFB` | `#1A4F9C` | 약 7.4:1 | 질문 필요, 더 알아봐야 함, 확인 후 연락 검토, 추정(LLM 제안), 거산 확인 전 띠 |
| `no`(빨강) | `#FCE8E6` | `#8A1C1C` | 약 8.4:1 | 제외, 실주, 기한 지남(글자만일 때는 `#B42318`) |
| `recheck`(주황) | `#FFE8D1` | `#7A3E00` | 약 8.0:1 | 다시 확인, 근거 다시 확인 |
| `neutral`(회색) | `#EEF0F3` | `#3C4650` | 약 9.4:1 | 나중 단계, 지켜보는 중, 나중에, 준비 중, 아직 평가 전, 자료 없음, 내부용 띠, 보류·거절·대상 아님 배지 |

| 상태(쉬운 말) | 기획서 용어 | 조합 | 아이콘 |
|---|---|---|---|
| 통과 (응모 가능) | 통과 | `ok` | ✔ |
| 확인 대기 (승인 막힘) | 필수 요구 충족 미확인 | `wait` | ⏳ |
| 질문 필요 (승인은 막지 않음) | 요구 미확인 | `ask` | ? |
| 나중 단계 | 후속 단계 미완료 | `neutral` | → |
| 제외 | 제외 | `no` | ✕ |
| 확인됨 / 확인 기다림 / 자료 없음 / 다시 확인 | 검수 완료 / 검수 대기 / 미확보 / 재확인 | `ok` / `wait` / `neutral` / `recheck` | |
| 사실(확인) / 추정(강한·약한) / 미확인 | 확인 / 강한·약한 추정 / 미확보 | 글자만 / `ask` / `neutral` | |
| [LLM 제안] | 확정 전 제안값 | `ask` | |

분류(11분기) 태그:

| 화면 문구 | 코드 | 조합 |
|---|---|---|
| 지금 바로 연락 검토 | `CONTACT_URGENT` | `ok` (굵게) |
| 일정 잡고 연락 검토 | `CONTACT_PLANNED` | `ok` |
| 확인 후 연락 검토 | `CONTACT_REVIEW` | `ask` |
| 더 알아봐야 함 | `RESEARCH` | `ask` |
| 조건 갖춰지면 다시 봄 | `CONDITIONAL_WAIT` | `neutral` |
| 지켜보는 중 | `WATCH` | `neutral` |
| 나중에 | `LOW` | `neutral` |
| 기다리는 중 (확인 필요) | `FILTER_PENDING` | `wait` |
| 이번엔 제외 | `FILTER_EXCLUDED` | `no` |
| 준비 중 | `OPS_PENDING` | `neutral` |
| 아직 평가 전 | `NOT_EVALUATED` | `neutral` |
| 근거 다시 확인 | `CORE_EVIDENCE_RECHECK` | `recheck` |

코드 이름은 제안이며 DB·API·화면이 같은 코드표를 쓴다(FR4.10). 색은 보조 신호일 뿐 글자가 항상 함께 있다. 대비 계산값은 구현 시 axe로 실측해 4.5:1 미만이면 글자색을 더 진하게 한다.

## 3. 화면 요소 → Ant Design 부품

| 화면 요소 | 부품 | 설정 메모 |
|---|---|---|
| 공통 틀 | `Layout` (Header, Content) | Header 높이 64, Content 최대 폭 1200 중앙 |
| 메뉴 | `Menu` mode=horizontal | 항목 3개, 현재 항목 강조 |
| 담당자명 선택 | `Select` | 옵션은 설정 파일, "보기 전용" 포함 |
| 알림 띠 | `Alert` type=info/warning/success, `banner` | 닫기 없음, `role="status"` |
| 탭 | `Tabs` | 신규 기회 / 재접촉, 건수는 라벨에 |
| 검색 칸 | `Input.Search` allowClear | 300ms 디바운스 |
| 추천 카드 | `Card` + `Tag` + `Button` + `Space` | hoverable, 제목 20px |
| 진행 점(P2) | 작은 `Progress` type=steps steps=6 | 카드 오른쪽 위 |
| 쪽 넘김 | `Pagination` showTotal | 20건씩 |
| 진행 단계 | `Steps` | 가로, 1280 미만 size=small, 현재 process |
| 배지(보류·실주·대상 아님) | `Tag` | 회색/빨강/회색 |
| 요구 판정 표 | `Table` size=middle sticky | 10행 넘으면 scroll y=320 |
| 승인 가능 여부 | `Alert` type=success/warning inline | |
| 기한 내 대응 체크 | `Checkbox` | 즉시 저장 |
| 확인 질문 목록 | `List` + `Collapse`(나머지 펼치기) | |
| 거산 확인 요청 인라인 | `Button` + `DatePicker` + `Input` | 그 줄 아래 펼침 |
| 공정 연결 | `Descriptions` 한 줄 | |
| 근거 자료 | `List` + `Tag`(출처 등급) | 인용문은 `Typography.Paragraph` ellipsis |
| 홈페이지 주소 입력 | `Input` + `Button` | 확인 필요일 때만 |
| 점수 자세히 보기 | `Collapse` 한 패널 + `Statistic` ×4 + `Table` | 기본 접힘 |
| 의견 버튼 | `Button` ×3 (`aria-pressed`) + `Input.TextArea` | |
| 담기 | `Button` icon=Star/StarFilled | |
| 접촉 승인 | `Button` ×2 + `Radio.Group` + `Button` 확정/취소 | 인라인 펼침 |
| 결과 기록 | `Select` + `Radio.Group` + `DatePicker` + `Input` + `Button` | 한 줄 배치, 1024~1279는 두 줄 |
| 활동 이력 | `Timeline` | 최신 위, "더 보기" |
| 대시보드 건수 | `Card` + `Statistic` + 링크 | 4개 가로, 1024~1279는 2×2 |
| 일정 목록 | `List` | 기한 지남 항목 빨강 글자+아이콘 |
| 업무 흐름 줄 | `Steps` type=inline 또는 `Space`+`Statistic` | 지연 시 제거 |
| 활동 요약(P2) | `Segmented`(기간) + `Table` + `Statistic` | |
| 재접촉 입력 | `Form` layout=vertical + `Input`/`Radio.Group`/`DatePicker` | 7개 Form.Item |
| 질문 목록 | `Table` 또는 `List` + `Segmented`(상태 필터) + `Button`(복사/내보내기/요청으로 보내기/회신 기록/질문 직접 추가) | 기한 지남 우선. 검수 상태를 바꾸는 버튼은 없음 |
| 빈 상태 | `Empty` | 설명 + 1차 행동 버튼 |
| 불러오는 중 | `Skeleton` (카드·표) / `Spin` (근거 추출) | |
| 오류 | `Alert` type=error + `Button` 다시 시도 | 오류 코드 없음 |
| 저장됨 피드백 | `Typography.Text` + aria-live (message 대신) | 화면 위치 유지 |

| 접속 보호(S0) | `Form` + `Input.Password` + `Button` | 거산 환경에서만, 설정으로 끔 |
| 질문 목록 회신 기록·질문 직접 추가 | `Input` + `DatePicker` + `Button` 인라인 | 검수 상태 변경 버튼 없음(읽기 전용) |
| 담아 둔 목록 토글 | `Switch` "담은 것만" | S1 검색 칸 옆 |

쓰지 않는 부품: `Modal`(모든 입력 인라인, Q3), `Drawer`(재접촉은 별도 페이지, Q4), `notification`(저장 피드백은 그 자리에서). **유일한 예외**: 재접촉 입력(S5)에 입력한 내용이 있을 때 이탈하면 브라우저 기본 확인창을 쓴다(탭 닫기·새로고침은 `beforeunload`, 화면 안 이동은 라우터 차단 + `window.confirm`). 이는 Ant Design Modal이 아닌 브라우저 대화상자다.

## 4. 반응형 규칙

| 폭 | 배치 |
|---|---|
| ≥1280px | 본문 최대 1200px 중앙. 카드 요약 1줄, 대시보드 건수 4개 가로, 결과 기록 한 줄 |
| 1024~1279px | 카드 요약 2줄, 표 가로 스크롤(`scroll x`), Steps small·축약 이름, 대시보드 건수 2×2, 결과 기록 두 줄. 기능 모두 동작 |
| <1024px | 위 규칙 유지 + 안내 띠 "넓은 화면에서 써 주세요(1024px 이상)". 동작은 막지 않음. 휴대폰 최적화는 여유 시(P3) |
| 브라우저 확대(zoom) | 안내 띠는 기기 폭(`screen.width`) 기준으로만 띄우고, 확대로 뷰포트가 줄어든 경우에는 띄우지 않는다. 200% 확대에서 표 영역 외 본문은 가로 스크롤 없이 읽히고, 표는 가로 스크롤을 허용한다 |

## 5. 간격·타이포 척도

- 간격 척도 4·8·16·24·32px. 카드 사이 16px, 카드 안 20px, 영역 사이 32px.
- 글자: h1 24px/700, 카드 제목 20px/600, 본문 16px/400, 보조 14px/400(점수·시각·태그 안 글자는 14px 이상).
- 버튼: 높이 40px, 좌우 여백 16px, primary는 강조색, 나머지는 default(흰 바탕 회색 선). 한 영역에 primary 버튼은 하나.

## 6. 파일·설정 위치(제안, 코드 생성에서 확정)

- `src/theme/tokens.ts` — 위 토큰. `src/config/brand.ts` — 로고·브랜드명·강조색. 이 두 파일이 테마의 유일한 출처이며, 화면 코드에 색·글꼴 값을 직접 적지 않는다. 나중에 거산 홈페이지(후속 확장 후보, `mockups.md` 11장)를 만들 때 같은 테마를 그대로 가져다 쓸 수 있게 화면 부품과 분리해 둔다. 영업 도구 자체는 독립된 웹 주소로 동작한다. `src/config/labels.ts` — 쉬운 말 대응표(분류 코드 → 문구). `src/config/staff.ts` — 담당자명 목록(또는 서버 설정).
- Prettier + ESLint 설정은 팀 실천 방식(team-practices Code Style)대로 저장소 루트.
