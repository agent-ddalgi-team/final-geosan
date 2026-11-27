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

/** 확인(초록, #972): 사실(확인), 공정 확인됨. text는 bg 위 약 4.7:1. */
export const ok = {
  text: '#1F7A43',
  bg: '#E6F5EC',
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

/** 단계 카드 사이의 작은 동그라미 화살표(#972): 지름 22 흰 원 + 강조 테두리 + 보라 화살표. */
export const stepArrow = {
  size: 22,
  bg: colors.bgContainer,
  border: accent.border,
  stroke: accent.bg,
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
 * 접속 화면(#972 시안 Login): 밝은 바탕 + 가운데 흰 상자(얇은 테두리, 모서리 16), 보라 [접속 →].
 * 예전의 남색 바탕 · 빛나는 곡선 · 라임 단추는 없앴다. 이 값은 접속 화면에만 쓴다.
 */
export const loginTheme = {
  bg: colors.bgLayout,
  text: colors.text,
  textSoft: colors.textSecondary,
  /** 맨 아래 저작권 줄(화면 바탕 위 약 4.8:1). */
  textDimmed: colors.textDimmed,
  badgeBg: colors.bgContainer,
  badgeBorder: colors.borderSecondary,
  cardBg: colors.bgContainer,
  cardBorder: colors.borderSecondary,
  inputBg: colors.bgContainer,
  inputBorder: colors.border,
  accent: accent.bg,
  accentHover: accent.bright,
  accentActive: accent.text,
  accentText: accent.onBg,
  focusRing: 'rgba(106, 77, 240, 0.28)',
  /** 누를 수 없는 [접속]: 중립 바탕 + 보조 글자(약 6.3:1). */
  disabledBg: neutralChip.bg,
  disabledFg: neutralChip.text,
  cardWidth: 400,
  cardRadius: radius.modal,
  inputHeight: 48,
  buttonHeight: 50,
  inputRadius: radius.control,
  badgeRadius: radius.controlSm,
  titleSize: 28,
  subtitleSize: 16,
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
      colorBorder: loginTheme.inputBorder,
      hoverBorderColor: loginTheme.accent,
      activeBorderColor: loginTheme.accent,
      activeShadow: `0 0 0 3px ${loginTheme.focusRing}`,
    },
    Button: {
      ...antdTheme.components?.Button,
      controlHeightLG: loginTheme.buttonHeight,
      borderRadiusLG: loginTheme.inputRadius,
      fontWeight: 600,
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
