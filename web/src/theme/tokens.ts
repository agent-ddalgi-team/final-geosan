// 테마 토큰 — 색·글꼴·크기의 유일한 출처(상세 화면 설계 design-system-mapping.md 1·2장, NFR11.4).
// 화면 부품 코드에 색·글꼴 값을 직접 적지 않는다. 강조색만 src/config/brand.ts에서 가져온다.
import type { ThemeConfig } from 'antd';
import { brand } from '../config/brand';

// 디자인 톤(#972, PM이 고른 보라 톤 시안 2026-11-27): 옅은 회보라 바탕 + 흰 카드(얇은 테두리, 그림자 없음) +
// 남색에 가까운 글자, 강조는 보라 한 가지. 주의(주황)·확인(초록)은 뜻이 있을 때만 쓴다.
// 모서리는 카드 12 · 단추·입력 9 · 꼬리표 6. 알약 모양은 쓰지 않는다.
// 글자가 올라가는 조합은 대비 4.5:1 이상이고, theme/__tests__/tokens.test.ts가 값을 계산해 지킨다.

/**
 * 강조(보라) 묶음(#972). 글자가 올라가는 바탕은 bg(흰 글자 약 5.3:1), 글자 없는 막대·점·선은 bright,
 * 흰 바탕·연한 바탕 위 글자는 text(soft 위 약 5.8:1, softDeep 위 약 5.2:1).
 */
export const accent = {
  /** 주 단추 · 지금 단계 · 오늘처럼 흰 글자가 올라가는 바탕. */
  bg: '#6A4DF0',
  /** bg 위 글자. */
  onBg: '#FFFFFF',
  /** 글자 없는 막대·점·그래프 선. 이 위에 글자를 올리지 않는다(흰 글자 대비 부족). */
  bright: '#7C5CFC',
  /** 링크 · 꼬리표 글자 · 고른 단추 글자. */
  text: '#5B3FE0',
  /** 링크에 손을 올렸을 때. */
  textHover: '#3F28B8',
  /** 연한 바탕: 고른 단추, 꼬리표, 지금 화면 메뉴 줄, 지나온 단계. */
  soft: '#F4F1FF',
  /** 조금 진한 연한 바탕: 숫자 꼬리표, 지나온 단계 칸. */
  softDeep: '#E9E3FF',
  /** 고른 단추 테두리. */
  border: '#D9CFFF',
  /** 흐린 선: 지나온 단계 선, 보조 막대. */
  line: '#B9A6FF',
} as const;

/** 주의(#972): 지난 일정, 멈춘 회사, 거산 확인 전. text는 흰 바탕·bg 위에서 5:1 이상. dot은 글자 없는 점. */
export const warn = {
  text: '#9A5415',
  bg: '#FDF1E4',
  dot: '#C8742A',
  /** 주의 바탕 칸의 얇은 테두리(받은 전달 등). */
  border: '#F2D9BD',
} as const;

/**
 * "유료" 꼬리표(#981): 누르면 AI 비용이 드는 단추의 글 뒤. 흰 단추 위는 연보라 바탕 + 보라 글자,
 * 보라 주 단추 위는 흰 바탕 + 보라 글자(둘 다 대비 4.5:1 이상).
 */
export const paidTag = {
  plain: { bg: accent.softDeep, fg: accent.text },
  onPrimary: { bg: '#FFFFFF', fg: accent.text },
  radius: 5,
  fontSize: 11.5,
} as const;

/**
 * 의견 전 알림(#981): 관심에 담고 의견을 안 고른 회사의 고르기 칸 · 안내 띠. 주의(주황) 계열을 그대로 쓴다.
 * 색만으로 알리지 않게 "의견을 골라 주세요" 글이 늘 함께 보인다.
 */
export const opinionNudge = {
  border: warn.dot,
  bg: warn.bg,
  fg: warn.text,
  line: warn.border,
} as const;

/** 확인(초록, #972): 사실(확인), 공정 확인됨. text는 bg 위 약 4.7:1. */
export const ok = {
  text: '#1F7A43',
  bg: '#E6F5EC',
  /** 확인 바탕 칸의 얇은 테두리(#985 "부재로 저장했습니다" · "메모를 저장했습니다" 상자). 글자를 올리지 않는다. */
  border: '#BFE3CC',
} as const;

/** 중립 꼬리표(#972): 그 밖의 꼬리표. 글자는 보조 글자색(약 6.3:1). */
export const neutralChip = {
  bg: '#F1F1F7',
  text: '#56566E',
} as const;

/** 아직 안 간 단계의 선·점(#972). 글자를 올리지 않는다. */
export const stepTodo = {
  line: '#E3E3EE',
  dot: '#D6D6E4',
} as const;

/**
 * 옛 견본 이름(#898). 다른 부품이 깨지지 않게 이름만 남기고 값은 새 톤(#972)이다.
 * 새 코드는 accent · warn · ok · neutralChip을 쓴다. lemon·lavender 계열 = 강조 연한 바탕, mist 계열 = 테두리·바탕.
 */
export const tone = {
  ink: '#1B1A2E',
  paper: '#FFFFFF',
  lemon: accent.softDeep,
  lemonSoft: accent.soft,
  /** 옛 "조금 진한 쪽": 연한 바탕 칸의 얇은 테두리. */
  lemonDeep: accent.border,
  mist: '#EBEBF3',
  mistSoft: '#F7F7FB',
  lavender: accent.softDeep,
  lavenderSoft: accent.soft,
} as const;

export const colors = {
  text: tone.ink,
  textSecondary: '#56566E',
  /** 흐린 글자(작은 이름표, 거래 확인 전 점수 #264): 흰 바탕 약 5.2:1, 화면 바탕 위 약 4.8:1. */
  textDimmed: '#6B6B85',
  bgLayout: '#F7F7FB',
  bgContainer: '#FFFFFF',
  /** 카드 · 보조 단추 · 나눔 줄의 얇은 테두리. */
  borderSecondary: '#EBEBF3',
  /**
   * 입력 칸 · 체크 칸 · 눌러 고르는 칸의 테두리. 카드 테두리보다 한 단계 진해 흰 카드 위에서도 칸이 보인다
   * (시안의 입력 칸은 카드 테두리와 같은 값이지만 흰 카드 위에서 거의 안 보여 한 단계 올렸다, #972).
   */
  border: '#D6D6E4',
  error: '#B42318',
} as const;

/**
 * 모서리 둥글기(#972): 카드 12 · 단추·입력·선택 칸 9(작은 단추 8) · 꼬리표 6 · 뜨는 창 16.
 * 새 코드는 뜻이 있는 이름(card·control·controlSm·tag·modal)을 쓴다.
 * sm·md·lg·xl·pill은 옛 이름(#898)으로, 다른 부품이 깨지지 않게 남기고 값만 맞췄다.
 * pill은 더 이상 알약이 아니다(꼬리표 모서리 6). 완전한 동그라미가 필요하면 '50%'를 쓴다.
 */
export const radius = {
  card: 12,
  control: 9,
  controlSm: 8,
  tag: 6,
  modal: 16,
  sm: 9,
  md: 12,
  lg: 12,
  xl: 12,
  pill: 6,
} as const;

/**
 * 고른 상태의 선택 단추(공정·종류·거르기·글자 크기 등, #972): 강조 연한 바탕 + 강조 테두리 + 강조 글자 굵게.
 * 안 고른 단추는 흰 바탕 + 카드 테두리 + 보조 글자. (#947의 "강조색 바탕 + 흰 글자"를 대신한다.)
 */
export const choiceChip = {
  selected: { bg: accent.soft, border: accent.border, fg: accent.text, fontWeight: 600 },
  idle: { bg: colors.bgContainer, border: colors.borderSecondary, fg: colors.textSecondary },
} as const;

/** 꼬리표 3종 + 중립(#972). 모서리는 radius.tag. 색은 보조 신호이고 글자가 늘 함께 있다. */
export const tagPalette = {
  accent: { bg: accent.soft, fg: accent.text },
  warn: { bg: warn.bg, fg: warn.text },
  ok: { bg: ok.bg, fg: ok.text },
  neutral: { bg: neutralChip.bg, fg: neutralChip.text },
} as const;

/**
 * 거래처 후보 · 관심 기업 표 줄과 새 후보 발굴 창(#972 시안 Candidates · Bookmarks · FindModal).
 * 줄을 담는 흰 칸 + 줄 사이 얇은 선 + 흐린 열 머리. 검토사항("확인할 것: …")은 주의 글자.
 * 별 단추 켜짐은 강조 밝은 쪽 바탕 + 흰 별이다. 별은 글자가 아니라 그림이라 3:1 기준을 쓴다(약 4.1:1).
 * 이름("관심"·"관심 기업")은 화면 낭독용 글자로 늘 함께 있다.
 */
export const listTheme = {
  panelBg: colors.bgContainer,
  panelBorder: colors.borderSecondary,
  panelRadius: radius.card,
  panelPadding: '18px 20px',
  /** 줄과 줄 사이, 열 머리 아래 선. */
  rowLine: colors.borderSecondary,
  /** 열 머리 · 칸 안 작은 이름표("추천 근거" 등) · 순위 번호. */
  headFg: colors.textDimmed,
  /** 추천 근거 본문. */
  bodyFg: colors.textSecondary,
  /** 확인할 것이 있는 검토사항 줄. */
  checkFg: warn.text,
  /** 지난 일정(굵게). */
  overdueFg: warn.text,
  /** 회사 이름 글자 크기: 표 줄 / 관심 기업 줄. #981: 회사 이름이 잘 보이게 표 줄도 18로 키웠다(품목은 그 아래 작은 글). */
  titleSize: 18,
  titleSizeLarge: 18,
  /** 점수 숫자 크기: 표 줄 / 관심 기업 줄의 큰 숫자. */
  scoreSize: 18,
  scoreSizeLarge: 30,
  /** 별 단추(한 변 36). 꺼짐 = 흰 바탕 + 흐린 별, 켜짐 = 강조 밝은 쪽 바탕 + 흰 별. */
  starSize: 36,
  starRadius: radius.controlSm,
  starOff: { bg: colors.bgContainer, border: colors.borderSecondary, fg: colors.textDimmed },
  starOn: { bg: accent.bright, border: accent.bright, fg: accent.onBg },
  /** "지금 새 후보를 찾는 중" 줄: 강조 연한 바탕 + 강조 글자. */
  runningBg: accent.soft,
  runningFg: accent.text,
  runningRadius: radius.control,
} as const;

/** 단계 카드 사이의 작은 동그라미 화살표(#972): 지름 22 흰 원 + 강조 테두리 + 보라 화살표. */
export const stepArrow = {
  size: 22,
  bg: colors.bgContainer,
  border: accent.border,
  stroke: accent.bg,
} as const;

/**
 * 영업 홈 "진행 중인 회사" 제목 옆 작은 영업 단계 칸 묶음(#983 → #992, PM이 고른 수정안 3 2026-11-29).
 * #983의 두 줄짜리 칸(이름 · 숫자 "곳" · 아래 꼬리표)을 제목 옆 한 줄짜리 더 작은 칸으로 줄였다:
 * 연보라 묶음(얇은 연보라 테두리) 안에 "영업 단계" 작은 글 + 칸(이름 · 굵은 숫자 · 작은 꼬리표 "+2" · "멈춤 1").
 * 보는 중인(고른) 칸은 진한 보라 바탕 + 흰 글자(약 5.3:1), 나머지는 흰 바탕 + 연보라 테두리, 보류는 점선 테두리.
 * 색만으로 알리지 않게 고른 칸은 이름 굵기도 한 단계 올리고 단추에 눌림 상태(aria-pressed)가 실린다.
 * 칸 사이 화살표 · 세로 줄은 글자가 아닌 꾸밈(강조 흐린 선 색).
 */
export const stageCell = {
  /** 묶음: 강조 연한 바탕 + 강조 테두리 + 카드 모서리. */
  group: { bg: accent.soft, border: accent.border, radius: radius.card, padding: '5px 8px' },
  /** 묶음 맨 앞 작은 글 "영업 단계"(강조 연한 바탕 위 강조 글자, 약 5.8:1). */
  lead: { fg: accent.text, size: 12 },
  /** 묶음 안 칸 · 화살표 사이 간격. 노트북 본문 폭에서 제목 · 묶음 · 거르기 단추가 한 줄에 들어가게 시안(6)보다 좁혔다. */
  gap: 4,
  /** 칸 안 이름 · 숫자 · 꼬리표 사이 간격. */
  cellGap: 6,
  height: 34,
  /** 칸 안쪽 좌우 여백(시안은 10. 같은 까닭으로 8). */
  padding: '0 8px',
  radius: radius.control,
  nameSize: 13,
  countSize: 16,
  tagSize: 11.5,
  tagRadius: 4,
  /** 고르지 않은 칸: 흰 바탕 + 연보라 테두리, 이름은 보조 글자색 굵게, 숫자는 본문 글자색. */
  idle: {
    bg: colors.bgContainer,
    border: accent.border,
    name: colors.textSecondary,
    count: colors.text,
    nameWeight: 600,
  },
  /** 보류(순서 밖) 칸의 점선 테두리. 연보라 묶음 위에서도 보이게 강조 흐린 선 색. */
  holdBorder: accent.line,
  /** 보는 중인(고른) 칸: 진한 보라 바탕 + 흰 글자, 이름 굵기 한 단계 위. */
  selected: {
    bg: accent.bg,
    border: accent.bg,
    name: accent.onBg,
    count: accent.onBg,
    nameWeight: 700,
  },
  /** "+2"(이번 주에 들어온 곳): 흰 칸 위에서는 조금 진한 연보라 바탕 + 강조 글자(약 5.2:1). */
  enteredTag: { bg: accent.softDeep, fg: accent.text },
  /**
   * 고른 칸(진한 보라) 위의 "+2": 흰 바탕 + 강조 글자(약 6.5:1).
   * 시안의 "반투명 흰 바탕 + 흰 글자"는 약 3.4:1이라 쓰지 않는다.
   */
  enteredTagOnSelected: { bg: accent.onBg, fg: accent.text },
  /** "멈춤 1": 주의 바탕 + 주의 글자. 고른 칸 위에서도 같은 값을 쓴다. */
  stalledTag: { bg: warn.bg, fg: warn.text },
  arrow: accent.line,
  arrowSize: 13,
  divider: accent.border,
  dividerHeight: 22,
} as const;

/**
 * 왼쪽 메뉴 아래 작은 한 달 달력(#983, PM이 고른 시안 2026-11-28). 점 대신 칸 색으로 알린다(나이 있는 분도 보이게).
 * 일정 있는 날 = 연보라 바탕 + 보라 굵은 숫자, 지난 일정이 남은 날 = 연주황 바탕 + 주황 굵은 숫자,
 * 누른 날 = 진한 보라 바탕 + 흰 숫자, 오늘 = 얇은 테두리. 색만으로 알리지 않게 굵기와 달력 아래 풀이가 함께 있다.
 * 글자가 올라가는 조합은 모두 대비 4.5:1 이상이다(시안의 연주황 #FBDCBB는 4.4:1이라 한 단계 옅은 값을 쓴다).
 */
export const sideCalendar = {
  panelBg: colors.bgLayout,
  panelBorder: colors.borderSecondary,
  panelRadius: radius.card,
  /**
   * 메뉴 묶음과 달력 칸 사이 최소 간격(#992). 달력은 메뉴 칸 맨 아래(브라우저 창 아래 끝)에 붙으므로 창이 높으면
   * 그 사이가 더 벌어지고, 창이 낮아 다 들어가지 않을 때만 이 간격으로 메뉴 줄 바로 아래에 이어 붙는다.
   */
  gapAbove: 16,
  /** 달력 칸 아래 끝에서 브라우저 창 아래 끝까지 여백(#992). 메뉴 칸의 아래 안쪽 여백으로 쓴다. */
  gapBelow: 16,
  /** 날짜를 눌렀을 때 뜨는 창이 브라우저 창 위·아래 끝에서 띄우는 여백(#992). 이보다 길면 창 안에서 내려 본다. */
  popoverEdgeGap: 12,
  cellSize: 26,
  cellFontSize: 13,
  cellRadius: 7,
  weekdayFontSize: 11,
  titleFontSize: 14,
  legendFontSize: 12,
  plain: { bg: 'transparent', fg: colors.text },
  has: { bg: accent.softDeep, fg: accent.text },
  overdue: { bg: '#FBE6CF', fg: warn.text },
  selected: { bg: accent.bg, fg: accent.onBg },
  /** 오늘 칸 안쪽 얇은 테두리(글자 없는 선). */
  todayRing: accent.text,
  todayRingWidth: 1.5,
  /**
   * 메모가 있는 날 칸 안쪽 테두리(#984, 글자 없는 선). 오늘 테두리(보라)와 헷갈리지 않게 어느 칸 색에서나 회색이다
   * (흰 바탕 약 5.2:1). 색만으로 알리지 않게 날짜 단추의 읽는 말에 "메모 n건"이 함께 있다.
   */
  memoRing: colors.textDimmed,
  memoRingWidth: 1.5,
  /** 날짜를 눌렀을 때 달력 오른쪽에 뜨는 작은 창. */
  popoverWidth: 300,
  /** 달력(날짜 칸 묶음) 오른쪽 끝에서 창까지: 달력 칸 안쪽 여백 6 + 바깥 틈 10. */
  popoverGap: 16,
  /** 달력 칸 안쪽 여백. 메뉴 폭 224에서 날짜 칸 26이 일곱 개 딱 들어가게 좌우 6(시안은 8이라 칸이 0.6씩 겹쳤다). */
  panelPadding: '12px 6px 10px',
  popoverBg: colors.bgContainer,
  popoverBorder: accent.border,
  popoverRadius: radius.card,
  popoverShadow: '0 12px 32px rgba(27, 26, 46, 0.18)',
} as const;

/**
 * 왼쪽 메뉴(#767 → #972): 흰 칸 + 오른쪽 얇은 테두리. 보통 글자는 보조 글자색(흰 바탕 약 7.1:1),
 * 묶음 이름은 흐린 글자(약 5.2:1). 지금 화면 줄은 강조 연한 바탕 + 강조 글자 굵게(약 5.8:1).
 */
export const sidebarTheme = {
  bg: colors.bgContainer,
  border: colors.borderSecondary,
  fg: colors.textSecondary,
  fgActive: accent.text,
  group: colors.textDimmed,
  activeBg: accent.soft,
  /** 지금 화면 줄의 테두리. 새 톤에서는 바탕과 같은 값이라 보이지 않는다. */
  activeBorder: accent.soft,
  /** 메뉴 숫자 꼬리표(#770 → #972): 강조 조금 진한 연한 바탕 + 강조 글자(약 5.2:1). 빨강을 쓰지 않는다. */
  badgeBg: accent.softDeep,
  badgeFg: accent.text,
  /** 주 단추 [새 후보 발굴]. */
  primaryBg: accent.bg,
  primaryFg: accent.onBg,
} as const;

/** 상태 색 6가지 조합(배경 연함 + 글자 진함, 대비 4.5:1 이상). 색은 보조 신호이고 글자가 항상 함께 있다. */
export const statusPalette = {
  ok: { bg: ok.bg, fg: ok.text },
  /** 검수 대기 · 거산 확인 전 = 주의. */
  wait: { bg: warn.bg, fg: warn.text },
  ask: { bg: accent.soft, fg: accent.text },
  no: { bg: '#FBE4E1', fg: '#8A1C1C' },
  /** 다시 확인 = 주의(조금 진한 바탕으로 검수 대기와 가른다). */
  recheck: { bg: '#FBE6CF', fg: '#7A3E00' },
  neutral: { bg: neutralChip.bg, fg: neutralChip.text },
} as const;

export type StatusTone = keyof typeof statusPalette;

/**
 * 영업 홈 색(#929 → #972). 이름은 옛 색 이름 그대로 두고 값만 새 톤이다:
 * blue* · purple* = 강조(보라), red* · orange* · yellow* = 주의, green* = 확인.
 * 글자 위 색은 대비 4.5:1 이상인 진한 값(blueText·redText 등)을 쓴다. 흰 글자 바탕은 blueStrong.
 */
export const homePalette = {
  blueBg: accent.soft,
  blueBorder: accent.border,
  blueText: accent.text,
  blueStrong: accent.bg,
  redBg: warn.bg,
  redText: warn.text,
  orangeBg: warn.bg,
  orangeText: warn.text,
  greenBg: ok.bg,
  greenText: ok.text,
  yellowBg: warn.bg,
  yellowBorder: warn.border,
  yellowText: warn.text,
  purpleBg: accent.soft,
  purpleText: accent.text,
  /** 거리 숫자처럼 굵게 띄우는 글자. */
  teal: accent.text,
  line: stepTodo.line,
  muted: colors.textDimmed,
  /** #972 단계 숫자 카드 "보류"(순서 밖): 흰 카드보다 살짝 옅은 바탕 + 점선 테두리. 글자는 본문·보조 글자색. */
  holdBg: '#FBFBFD',
  holdBorder: stepTodo.dot,
  /** #972 달력 날짜를 눌렀을 때 뜨는 작은 창의 그림자(부품에 직접 적혀 있던 값을 옮김). */
  popoverShadow: '0 12px 32px rgba(27, 26, 46, 0.1)',
  /** #972 지도 위 작은 이름표(회사 이름·거리 숫자): 글자색 바탕 + 흰 글자, 숫자 이름표는 흰 바탕. */
  mapTipBg: tone.ink,
  mapTipFg: tone.paper,
  mapLabelBg: tone.paper,
} as const;

/** #925 영업 홈 묶음 제목 앞 색 막대(PM 요청 2026-11-25). 글자가 늘 함께 있어 색은 보조 신호다. #972부터 지난 일정 = 주의색, 오늘 = 보라. */
export const groupMarkPalette = {
  overdue: homePalette.redText,
  overdueBg: homePalette.redBg,
  today: homePalette.blueText,
  todayBg: homePalette.blueBg,
  received: homePalette.yellowText,
  other: colors.border,
} as const;

/**
 * 대시보드 일정 달력 색(#758 → #972). 흰 판 위에 둥근 칸을 두고, 일정이 있는 날만 상태별 색을 칠한다.
 * 일정 없는 날은 옅은 칸·흐린 글자. 색은 보조 신호이고 칸 안 "N건"과 아래 색 설명 줄이 함께 있다.
 * badge는 칸 바탕 위에 겹치는 "N건" 바탕이라, 겹친 뒤에도 글자 대비 4.5:1을 지키는 값만 쓴다.
 */
export const calendarPalette = {
  panel: colors.bgContainer,
  panelBorder: colors.borderSecondary,
  title: tone.ink,
  textSecondary: colors.textSecondary,
  weekday: colors.textDimmed,
  navBg: colors.bgLayout,
  navFg: tone.ink,
  emptyBg: colors.bgLayout,
  emptyFg: colors.textDimmed,
  todayRing: accent.bg,
  popoverBg: colors.bgContainer,
  popoverBorder: colors.borderSecondary,
  link: accent.text,
  tones: {
    /** 기한 지난 일정이 있는 날 = 주의. */
    overdue: { bg: warn.bg, fg: warn.text, badge: 'rgba(255, 255, 255, 0.6)' },
    /** 오늘 일정 = 강조 바탕 + 흰 글자. */
    today: { bg: accent.bg, fg: accent.onBg, badge: 'rgba(27, 26, 46, 0.2)' },
    /** 7일 안 예정. */
    soon: { bg: accent.softDeep, fg: tone.ink, badge: 'rgba(255, 255, 255, 0.6)' },
    /** 그 뒤 예정. */
    later: { bg: neutralChip.bg, fg: tone.ink, badge: 'rgba(255, 255, 255, 0.7)' },
  },
} as const;

export type CalendarTone = keyof typeof calendarPalette.tones;

export const typography = {
  /** 영문·숫자는 Urbanist(참고 그림 글꼴), 한글은 Urbanist에 없으므로 Pretendard가 그린다. */
  fontFamily:
    "'Urbanist Variable', 'Pretendard Variable', Pretendard, -apple-system, 'Malgun Gothic', sans-serif",
  fontSize: 16,
  fontSizeSecondary: 14,
  fontSizeCardTitle: 20,
  fontSizeH1: 32,
  lineHeight: 1.6,
} as const;

export const spacing = {
  cardGap: 16,
  cardPadding: 24,
  sectionGap: 32,
  contentMaxWidth: 1200,
  headerHeight: 64,
} as const;

/**
 * 기업 상세 톤(#759 → #972): 흰 카드 + 얇은 테두리 + 모서리 12, 색은 포인트(지금 단계·숫자 꼬리표·막대)에만.
 * accent · accentSoft는 글자가 올라가는 연한 바탕(본문 글자·강조 글자 모두 4.5:1 이상), accentBar는 글자 없는 막대.
 */
export const detailTheme = {
  border: colors.borderSecondary,
  radius: radius.card,
  /** 칸 나눔 정보(머리 정보 칸 등)의 옅은 바탕. */
  cellBg: colors.bgLayout,
  /** 포인트 바탕: 숫자 꼬리표, 값이 있는 칸. */
  accent: accent.softDeep,
  /** 더 연한 포인트 바탕: 지나온 큰 단계 띠, 이름 꼬리표. */
  accentSoft: accent.soft,
  /** 포인트 색 테두리. */
  accentLine: accent.border,
  /** 회색 칸 위를 채우는 막대(점수·사용량)의 포인트 색. 글자를 올리지 않는다. */
  accentBar: accent.bright,
  /** 아직인 큰 단계 띠, 막대의 빈 칸. */
  bandTodo: neutralChip.bg,
  /** 지나온 단계를 잇는 선·점, 지도 위 선. */
  lineDone: accent.bright,
  lineTodo: stepTodo.line,
  /** 지금 세부 단계 점의 테두리. */
  ringCurrent: accent.bg,
} as const;

/**
 * 기업 상세 새 구성(#996, PM 결정 2026-11-29).
 * 둘째 줄(영업 단계 | 담당자 연락처)과 셋째 줄(한눈에 + 왜 이 회사인가 | 기록)은 같은 비율 1.25 : 1을 쓴다.
 * 늘어나는 비율(grow)과 처음 폭(basis)의 비가 같아 두 줄의 칸 경계가 같은 자리에 선다.
 * 본문이 두 처음 폭과 틈을 합친 것보다 좁으면 한 칸씩 아래로 쌓인다.
 */
export const detailLayout = {
  mainGrow: 1.25,
  sideGrow: 1,
  mainBasis: 380,
  sideBasis: 304,
  /** 회사 이름(h1). */
  nameSize: 30,
  /** 카드 안쪽 여백과 카드 제목 크기(반 폭 칸에 맞춰 조금 줄였다). */
  cardPadding: '18px 20px',
  cardTitleSize: 17,
  /** 한 블록 안 큰 제목("한눈에" · "왜 이 회사인가")과 그 앞 세로 강조 막대. */
  blockTitleSize: 18,
  blockBar: accent.bg,
  /** 요약 줄: 연보라 바탕 칸과 칩 사이 세로선. */
  summaryBg: accent.soft,
  summaryBorder: accent.border,
  /** 한 블록 안 "한눈에"와 "왜 이 회사인가" 사이 구분 띠. */
  bandBg: colors.bgLayout,
  bandHeight: 8,
  /** 고른 의견 단추: 진한 보라 바탕 + 흰 글자. */
  opinionPicked: { bg: accent.bg, fg: accent.onBg },
  /** 한눈에 핵심 줄 이름표 폭과 작은 글자 크기. */
  keyLabelWidth: 74,
  smallFont: 12.5,
} as const;

/** Ant Design ConfigProvider에 넘기는 테마(#972 보라 톤). */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.colorPrimary,
    colorInfo: accent.bg,
    colorSuccess: ok.text,
    colorWarning: warn.text,
    colorLink: accent.text,
    colorLinkHover: accent.textHover,
    colorLinkActive: accent.textHover,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorTextDescription: colors.textSecondary,
    colorTextPlaceholder: colors.textDimmed,
    colorBgLayout: colors.bgLayout,
    colorBgContainer: colors.bgContainer,
    colorBorderSecondary: colors.borderSecondary,
    colorBorder: colors.border,
    colorError: colors.error,
    borderRadius: radius.control,
    borderRadiusLG: radius.card,
    borderRadiusSM: radius.tag,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    controlHeight: 40,
    boxShadow: 'none',
    boxShadowSecondary: '0 12px 32px rgba(27, 26, 46, 0.1)',
  },
  components: {
    // 주 단추 = 강조 바탕 + 흰 글자, 보조 단추 = 흰 바탕 + 카드 테두리 + 본문 글자. 모서리 9(작은 단추 8).
    Button: {
      borderRadius: radius.control,
      borderRadiusLG: radius.control,
      borderRadiusSM: radius.controlSm,
      defaultBorderColor: colors.borderSecondary,
      defaultColor: colors.text,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      fontWeight: 500,
    },
    Input: { borderRadiusLG: radius.control, borderRadiusSM: radius.controlSm },
    InputNumber: { borderRadiusLG: radius.control, borderRadiusSM: radius.controlSm },
    // 선택 칸은 모서리 9, 열린 목록(borderRadiusLG)은 카드처럼 12(#910: 목록이 부풀어 글자가 잘리지 않게).
    Select: {
      borderRadius: radius.control,
      borderRadiusLG: radius.card,
      optionSelectedBg: accent.soft,
      optionSelectedColor: accent.text,
    },
    DatePicker: { borderRadius: radius.control },
    // 고른 칸 = 강조 연한 바탕 + 강조 글자(테두리·굵기는 styles.css가 더한다).
    Segmented: {
      borderRadius: radius.control,
      borderRadiusSM: radius.controlSm,
      trackBg: neutralChip.bg,
      itemColor: colors.textSecondary,
      itemHoverColor: colors.text,
      itemSelectedBg: accent.soft,
      itemSelectedColor: accent.text,
    },
    Tag: { borderRadiusSM: radius.tag },
    Card: { borderRadiusLG: radius.card },
    Modal: { borderRadiusLG: radius.modal },
    Collapse: { borderRadiusLG: radius.card },
    Alert: { borderRadiusLG: radius.card },
    Table: {
      headerBg: colors.bgLayout,
      headerColor: colors.textSecondary,
      borderColor: colors.borderSecondary,
      rowHoverBg: accent.soft,
    },
    Typography: { fontWeightStrong: 600 },
  },
};

/**
 * 접속 화면(#978, PM 결정 2026-11-28): 짙은 보라 밤하늘 + 아래쪽 연보라로 빛나는 곡선, 유리 느낌 입력 상자,
 * 보라 [접속 →]. 배치는 PM이 준 접속 화면 디자인이고 색은 다른 화면의 보라 톤에 맞췄다.
 * (#972의 밝은 바탕 흰 상자를 대신한다.) 이 값은 접속 화면에만 쓴다.
 */
export const loginTheme = {
  skyTop: '#15123A',
  skyMiddle: '#2A2170',
  skyLow: '#5A43D6',
  /** 곡선 바로 위 가장 밝은 하늘. 유리 상자가 여기까지 내려와도 흰 글자가 읽혀야 한다. */
  skyGlow: '#8F7BFF',
  spot: 'rgba(255, 255, 255, 0.07)',
  planet: '#0D0B24',
  rim: 'rgba(255, 255, 255, 0.6)',
  glowCore: '#D9CFFF',
  text: '#FFFFFF',
  /** 맨 아래 저작권 줄(짙은 곡선 위). */
  textSoft: '#C7C3E0',
  badgeBorder: 'rgba(255, 255, 255, 0.45)',
  /** 유리 상자: 보라 유리(cardTint) 위에 옅은 흰 막(cardSheen)을 겹친다. */
  cardTint: 'rgba(58, 46, 140, 0.6)',
  cardSheen: 'rgba(255, 255, 255, 0.08)',
  cardBorder: 'rgba(255, 255, 255, 0.28)',
  cardShadow: 'rgba(5, 5, 30, 0.35)',
  inputBg: colors.bgContainer,
  /** 입력 칸 앞 아이콘(흰 입력 칸 위). */
  icon: colors.textSecondary,
  accent: accent.bg,
  accentHover: accent.bright,
  accentActive: accent.text,
  accentText: accent.onBg,
  /** 보라 단추가 보라 유리 위에서 묻히지 않게 두르는 얇은 흰 선. */
  buttonRing: 'rgba(255, 255, 255, 0.22)',
  focusRing: 'rgba(207, 196, 255, 0.7)',
  /** 누를 수 없는 [접속]: 채도를 뺀 보라 바탕 + 옅은 글자(약 6:1). */
  disabledBg: '#4A3F8F',
  disabledFg: '#D9D4F2',
  cardWidth: 400,
  cardRadius: 20,
  inputHeight: 48,
  buttonHeight: 50,
  inputRadius: radius.control,
  badgeRadius: radius.controlSm,
  titleSize: 50,
  subtitleSize: 34,
} as const;

/** 접속 화면에서만 쓰는 Ant Design 테마: 공통 테마 위에 입력 칸·단추 크기를 덮는다. */
export const loginAntdTheme: ThemeConfig = {
  ...antdTheme,
  components: {
    ...antdTheme.components,
    Input: {
      ...antdTheme.components?.Input,
      controlHeightLG: loginTheme.inputHeight,
      borderRadiusLG: loginTheme.inputRadius,
      colorBgContainer: loginTheme.inputBg,
      // 흰 입력 칸이 유리 상자 위에 놓여 테두리 선이 따로 필요 없다(초점일 때만 보라 선).
      colorBorder: loginTheme.inputBg,
      hoverBorderColor: loginTheme.accent,
      activeBorderColor: loginTheme.accent,
      activeShadow: `0 0 0 3px ${loginTheme.focusRing}`,
    },
    Button: {
      ...antdTheme.components?.Button,
      controlHeightLG: loginTheme.buttonHeight,
      borderRadiusLG: loginTheme.inputRadius,
      fontWeight: 700,
      colorPrimary: loginTheme.accent,
      colorPrimaryHover: loginTheme.accentHover,
      colorPrimaryActive: loginTheme.accentActive,
      primaryColor: loginTheme.accentText,
      colorBgContainerDisabled: loginTheme.disabledBg,
      colorTextDisabled: loginTheme.disabledFg,
      borderColorDisabled: 'transparent',
    },
  },
};

/**
 * 영업 분석 그래프 색(#760 → #972). 보라(성사·주 계열) · 주의 점(거절·견줄 계열) · 흐린 보라 · 글자색 순서.
 * 색은 보조 신호이고 범례·값 글자가 함께 있다. 막대 위에는 글자를 올리지 않는다.
 */
export const chartPalette = {
  series: [accent.bright, warn.dot, accent.line, tone.ink],
  /** 전체 건수(접촉 등) 막대: 색 계열 막대 뒤에 깔리는 옅은 회보라. */
  base: stepTodo.dot,
  grid: colors.borderSecondary,
  track: neutralChip.bg,
  /** 숫자 칸 하나를 강조할 때의 진한 바탕(강조). 흰 글자 대비 4.5:1 이상. */
  highlightBg: accent.bg,
  highlightFg: accent.onBg,
  highlightAccent: accent.softDeep,
  cardRadius: radius.card,
} as const;

/**
 * 분석 그림 카드(#898 → #972): 청회색 판을 없애고 흰 카드(얇은 테두리) 위에 보라 막대, 빈 부분은 중립 칸.
 * 가장 중요한 숫자 하나는 오른쪽 위 말풍선(callout, 화면 바탕색 칸)에 크게, 카드 아래에는 그 그림을 읽은 요약 문장.
 * 막대 색은 보조 신호이고 값 글자가 늘 함께 있다. bar · barSoft · barStrong 위에는 글자를 올리지 않는다.
 */
export const chartTheme = {
  cardBg: colors.bgContainer,
  cardBorder: colors.borderSecondary,
  text: tone.ink,
  textSecondary: colors.textSecondary,
  track: neutralChip.bg,
  bar: accent.bright,
  /** 가장 진한 막대·점 테두리(성사 등 한 계열을 띄울 때). */
  barStrong: tone.ink,
  /** 가장 옅은 막대(전체 건수처럼 뒤에 깔리는 쪽). */
  barSoft: accent.softDeep,
  line: colors.borderSecondary,
  calloutBg: colors.bgLayout,
  summaryText: colors.textSecondary,
} as const;

/**
 * 지도 핀(#898 → #972 시안 범례). 회사는 작은 색 점(그림 없음), 거산 본사만 핀 안 흰 집.
 * 관심 = 주의 점, 진행 중 = 강조 밝은 쪽, 올해 성사 = 글자색, 본사 = 강조. 점은 흰 테두리 + 그림자로 지도 위에서 보인다.
 * icon은 본사 집 그림 색(강조 바탕 대비 약 5.3:1). text는 흰 바탕 글자용 진한 색(4.5:1 이상).
 */
export const mapPinPalette = {
  INTERESTED: { bg: warn.dot, icon: '#FFFFFF', text: warn.text },
  IN_PROGRESS: { bg: accent.bright, icon: '#FFFFFF', text: accent.text },
  WON_THIS_YEAR: { bg: tone.ink, icon: '#FFFFFF', text: tone.ink },
  HQ: { bg: accent.bg, icon: '#FFFFFF', text: accent.text },
} as const;

export type MapPinKind = keyof typeof mapPinPalette;

/** 지도 핀 둘레(#972: 부품에 직접 적혀 있던 값을 옮김). 흰 테두리 + 옅은 그림자로 지도 위에서 또렷하게. */
export const mapPinStroke = {
  ring: '#FFFFFF',
  shadow: 'rgba(27, 26, 46, 0.35)',
} as const;

/**
 * 상세 영업 단계(#898 → #972): 지나온 칸 = 강조 연한 바탕 + 강조 글자, 지금 칸 = 강조 바탕 + 흰 글자,
 * 아직인 칸 = 중립. 점 사이 선은 지나온 구간 강조 흐린 선, 나머지 옅은 회보라.
 * 지나온 점 = dotDone(강조 밝은 쪽), 지금 점 = 흰 가운데 + 강조 고리, 아직인 점 = dotTodo.
 */
export const progressTheme = {
  done: accent.softDeep,
  doneFg: accent.text,
  doneLine: accent.line,
  current: accent.bg,
  currentFg: accent.onBg,
  todo: neutralChip.bg,
  todoBorder: stepTodo.dot,
  line: stepTodo.line,
  bandBorder: colors.borderSecondary,
  bandBorderDone: accent.border,
  /** 지나온 세부 단계 점(#972). */
  dotDone: accent.bright,
  /** 아직인 세부 단계 점(#972). */
  dotTodo: stepTodo.dot,
} as const;

/**
 * 영업 분석 "상대 반응 — 거산의 강점 · 약점" 파이 그래프 색(#985, PM이 승인한 시안 2026-11-29).
 * 반응 세 가지: 긍정 = 강조 보라, 보통 = 중립 회색(흰 바탕 대비 3:1 이상), 부정 = 주의 점색.
 * 좋게 본 부분(강점) = 보라 6단계, 걸린 부분(약점) = 주황 6단계. 둘 다 진한 것부터 쓰고 건수가 많은 조각이 진한 색이다.
 * 조각 위에는 글자를 올리지 않는다. 색만으로 가르지 않게 파이 옆 줄에 이름 · 건수 · 비율이 늘 함께 있다.
 * 조각 사이 틈(gap)은 카드 바탕색 선이다.
 */
export const reactionPalette = {
  positive: accent.bg,
  neutral: '#8A8A9E',
  negative: warn.dot,
  good: [accent.textHover, accent.text, '#7A61F2', '#9C89F5', '#BEB1F8', '#DCD5FB'],
  bad: ['#8A4A0C', '#B0661C', warn.dot, '#DC9A57', '#ECBD8E', '#F6DCC1'],
  gap: colors.bgContainer,
  gapWidth: 2,
  /** 파이 한 변(px). 시안은 148이지만 실제 화면은 세 칸이 더 좁아 범례 이름이 한 줄에 들어가게 줄였다. */
  pieSize: 124,
  /** 범례 줄 앞 색 네모. */
  swatch: 12,
  swatchRadius: 3,
  /** 고른 범례 줄: 강조 연한 바탕 + 강조 테두리(글자는 본문색 굵게). */
  picked: { bg: accent.soft, border: accent.border },
  /** 조각을 눌렀을 때 펼치는 상세 칸: 걸린 부분 = 주의, 좋게 본 부분 = 강조, 반응 = 중립. */
  detail: {
    bad: { bg: warn.bg, border: warn.border, title: warn.text },
    good: { bg: accent.soft, border: accent.border, title: accent.text },
    reaction: { bg: colors.bgLayout, border: colors.borderSecondary, title: colors.text },
  },
} as const;
