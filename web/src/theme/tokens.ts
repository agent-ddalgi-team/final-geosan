// 테마 토큰 — 색·글꼴·크기의 유일한 출처(상세 화면 설계 design-system-mapping.md 1·2장, NFR11.4).
// 화면 부품 코드에 색·글꼴 값을 직접 적지 않는다. 강조색만 src/config/brand.ts에서 가져온다.
import type { ThemeConfig } from 'antd';
import { brand } from '../config/brand';

// 디자인 톤(#898, PM 참고 그림 2026-11-22): 밝은 회색 바탕 + 흰 카드 + 먹색 글자,
// 포인트는 연노랑 · 청회색 · 연보라 세 가지. 모서리는 크게 둥글고 버튼·꼬리표는 알약 모양.

/** 참고 그림의 색 견본. 포인트 칸 바탕으로만 쓰고, 그 위 글자는 늘 먹색(대비 4.5:1 이상). */
export const tone = {
  ink: '#212121',
  paper: '#FDFEFF',
  /** 포인트(PM 견본 2026-11-24 "쨍하지 않게, 밝은 노랑은 눈이 아파"): 연한 크림 연두. */
  lemon: '#F3F5CA',
  lemonSoft: '#F9FAE6',
  /** 같은 색의 조금 진한 쪽: 청회색 판 위 막대·얇은 테두리처럼 바탕과 구분이 필요한 곳. */
  lemonDeep: '#DCE09A',
  mist: '#C5D8DC',
  mistSoft: '#E5EEF0',
  lavender: '#D7D7F4',
  lavenderSoft: '#EDEDFA',
} as const;

export const colors = {
  text: tone.ink,
  textSecondary: '#5C5C5C',
  /** 거래 확인 전 점수(#264): 보조 글자보다 연하지만 흰 배경에서 대비 4.5:1을 지킨다. */
  textDimmed: '#6F6F6F',
  bgLayout: '#F2F3F3',
  bgContainer: '#FFFFFF',
  borderSecondary: '#E7E8E8',
  border: '#8C8C8C',
  error: '#B42318',
} as const;

/** 모서리 둥글기 단계(#898). 얇은 칸에 큰 값을 주면 알아서 알약 모양이 된다. */
export const radius = {
  sm: 12,
  md: 20,
  lg: 24,
  xl: 28,
  pill: 999,
} as const;

/**
 * 왼쪽 메뉴(#767 → #898 밝은 톤): 흰 세로 칸. 보통 글자 #4A4A4A / 흰 바탕 약 8.9:1,
 * 묶음 이름 #6F6F6F 약 5:1. 지금 화면 칸은 먹색 알약 + 흰 글자.
 */
export const sidebarTheme = {
  bg: tone.paper,
  fg: '#4A4A4A',
  fgActive: '#FFFFFF',
  group: '#6F6F6F',
  activeBg: tone.ink,
  activeBorder: tone.ink,
  /** 메뉴 숫자 꼬리표(#770): 빨간 칸 + 흰 글자(대비 약 4.8:1). 접힌 그림 위에서는 바탕색 테두리로 띄운다. */
  badgeBg: '#D92D20',
  badgeFg: '#FFFFFF',
} as const;

/** 상태 색 6가지 조합(배경 연함 + 글자 진함, 대비 4.5:1 이상). 색은 보조 신호이고 글자가 항상 함께 있다. */
export const statusPalette = {
  ok: { bg: '#DCEBEE', fg: '#1C4A51' },
  wait: { bg: tone.lemon, fg: '#4A4500' },
  ask: { bg: '#E4E4F8', fg: '#36368A' },
  no: { bg: '#FBE4E1', fg: '#8A1C1C' },
  recheck: { bg: '#FDE8D2', fg: '#7A3E00' },
  neutral: { bg: '#EEEFEF', fg: '#3C4045' },
} as const;

export type StatusTone = keyof typeof statusPalette;

/** #925 영업 홈 묶음 제목 앞 색 막대(PM 요청 2026-11-25). 글자가 늘 함께 있어 색은 보조 신호다. */
export const groupMarkPalette = {
  overdue: statusPalette.no.fg,
  today: '#2E7D32',
  received: statusPalette.ask.fg,
  other: colors.border,
} as const;

/**
 * 대시보드 일정 달력 색(#758 → #898 밝은 톤). 흰 판 위에 둥근 칸을 두고, 일정이 있는 날만 상태별 색을 칠한다.
 * 일정 없는 날은 옅은 칸·흐린 글자. 색은 보조 신호이고 칸 안 "N건"과 아래 색 설명 줄이 함께 있다.
 */
export const calendarPalette = {
  panel: '#FFFFFF',
  panelBorder: '#E7E8E8',
  title: tone.ink,
  textSecondary: '#5C5C5C',
  weekday: '#6F6F6F',
  navBg: '#F2F3F3',
  navFg: tone.ink,
  emptyBg: '#F5F6F6',
  emptyFg: '#6F6F6F',
  todayRing: tone.ink,
  popoverBg: '#FFFFFF',
  popoverBorder: '#E7E8E8',
  link: '#36368A',
  tones: {
    /** 기한 지난 일정이 있는 날. */
    overdue: { bg: '#FBE4E1', fg: '#8A1C1C', badge: 'rgba(138, 28, 28, 0.1)' },
    /** 오늘 일정. */
    today: { bg: tone.lemon, fg: tone.ink, badge: 'rgba(0, 0, 0, 0.08)' },
    /** 7일 안 예정. */
    soon: { bg: tone.lavender, fg: tone.ink, badge: 'rgba(0, 0, 0, 0.08)' },
    /** 그 뒤 예정. */
    later: { bg: tone.mist, fg: tone.ink, badge: 'rgba(0, 0, 0, 0.08)' },
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
 * 기업 상세 톤(#759 → #898): 흰 바탕 + 옅은 테두리 + 둥근 모서리, 색은 포인트(지금 단계·숫자 꼬리표)에만.
 * 연노랑 포인트 위 글자는 먹색(colors.text)으로 대비 4.5:1 이상.
 */
export const detailTheme = {
  border: '#E7E8E8',
  radius: radius.md,
  /** 칸 나눔 정보(머리 정보 칸 등)의 옅은 바탕. */
  cellBg: '#F5F6F6',
  /** 포인트: 지금 큰 단계 띠, 지나온 점, 숫자 꼬리표. */
  accent: tone.lemon,
  /** 지나온 큰 단계 띠. */
  accentSoft: tone.lemonSoft,
  /** 포인트 색 테두리(흰 바탕에서도 보이게 조금 진하게). */
  accentLine: tone.lemonDeep,
  /** 회색 칸 위를 채우는 막대(점수·사용량)의 포인트 색. */
  accentBar: tone.lemonDeep,
  /** 아직인 큰 단계 띠. */
  bandTodo: '#F1F2F2',
  /** 지나온 단계를 잇는 선. */
  lineDone: tone.ink,
  lineTodo: '#DADBDB',
  /** 지금 세부 단계 점의 테두리. */
  ringCurrent: tone.mist,
} as const;

/** Ant Design ConfigProvider에 넘기는 테마. */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.colorPrimary,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorBgLayout: colors.bgLayout,
    colorBgContainer: colors.bgContainer,
    colorBorderSecondary: colors.borderSecondary,
    colorBorder: colors.border,
    colorError: colors.error,
    borderRadius: radius.sm,
    borderRadiusLG: radius.lg,
    borderRadiusSM: radius.sm,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    controlHeight: 40,
    boxShadow: 'none',
    boxShadowSecondary: '0 12px 32px rgba(0, 0, 0, 0.08)',
  },
  components: {
    // 버튼·선택 칸·날짜 칸·꼬리표는 알약 모양(참고 그림), 큰 칸은 크게 둥글게.
    Button: {
      borderRadius: radius.pill,
      borderRadiusLG: radius.pill,
      borderRadiusSM: radius.pill,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      fontWeight: 500,
    },
    // 선택 칸은 알약, 열린 목록(borderRadiusLG)은 보통 둥근 상자. 목록까지 알약이면 말풍선처럼 부풀고 글자가 잘린다(#910).
    Select: { borderRadius: radius.pill, borderRadiusLG: radius.md },
    DatePicker: { borderRadius: radius.pill },
    Segmented: { borderRadius: radius.pill, borderRadiusSM: radius.pill },
    Tag: { borderRadiusSM: radius.pill },
    Card: { borderRadiusLG: radius.xl },
    Collapse: { borderRadiusLG: radius.lg },
    Alert: { borderRadiusLG: radius.lg },
    Typography: { fontWeightStrong: 600 },
  },
};

/**
 * 접속 화면(화면 담당 시안 login_mix): 짙은 남색 바탕 + 아래쪽 빛나는 곡선, 반투명 입력 상자, 라임색 접속 단추.
 * 이 색은 접속 화면에만 쓴다. 비활성 단추는 일부러 흐리게 둔다.
 */
export const loginTheme = {
  bgTop: '#0F2048',
  bgMiddle: '#132A5C',
  bgLow: '#245089',
  spotLeft: 'rgba(52, 88, 160, 0.55)',
  spotRight: 'rgba(40, 78, 150, 0.5)',
  planet: '#0B1632',
  glowCore: 'rgba(205, 228, 255, 0.95)',
  glowMiddle: 'rgba(95, 165, 232, 0.7)',
  glowFar: 'rgba(50, 120, 200, 0.45)',
  text: '#FFFFFF',
  textSoft: 'rgba(255, 255, 255, 0.62)',
  badgeBorder: 'rgba(160, 195, 245, 0.5)',
  cardBg: 'rgba(255, 255, 255, 0.09)',
  cardBorder: 'rgba(255, 255, 255, 0.18)',
  cardShadow: 'rgba(3, 10, 30, 0.35)',
  inputBg: '#FFFFFF',
  accent: '#C8F03C',
  accentHover: '#D6F766',
  accentText: '#14275A',
  focusRing: 'rgba(200, 240, 60, 0.45)',
  disabledBg: 'rgba(200, 240, 60, 0.55)',
  disabledFg: 'rgba(20, 39, 90, 0.85)',
  cardWidth: 400,
  cardRadius: 18,
  inputHeight: 48,
  buttonHeight: 50,
  inputRadius: 10,
  titleSize: 48,
  subtitleSize: 34,
} as const;

/** 접속 화면에서만 쓰는 Ant Design 테마: 공통 테마 위에 입력 칸·단추 모양을 덮는다. */
export const loginAntdTheme: ThemeConfig = {
  ...antdTheme,
  components: {
    ...antdTheme.components,
    Input: {
      controlHeightLG: loginTheme.inputHeight,
      borderRadiusLG: loginTheme.inputRadius,
      lineWidth: 2,
      colorBgContainer: loginTheme.inputBg,
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
      colorPrimaryActive: loginTheme.accent,
      primaryColor: loginTheme.accentText,
      colorBgContainerDisabled: loginTheme.disabledBg,
      colorTextDisabled: loginTheme.disabledFg,
      borderColorDisabled: 'transparent',
    },
  },
};

/**
 * 영업 분석 그래프 색(#760 → #898 참고 그림). 청회색 · 연보라 · 연노랑 · 먹색 순서. 참고 그림보다 한 단계
 * 진하게 해 흰 바탕에서 막대가 보이게 했다. 색은 보조 신호이고 범례·값 글자가 함께 있다.
 * 막대는 둥근 알약 모양, 빈 부분은 옅은 칸(track)으로 보인다.
 */
export const chartPalette = {
  series: ['#8FB2B9', '#ABABE8', tone.lemonDeep, '#4A4A4A'],
  /** 전체 건수(접촉 등) 막대: 색 계열 막대 뒤에 깔리는 옅은 회색이지만 흰 바탕에서 보이는 정도. */
  base: '#C9CBCB',
  grid: '#ECEDED',
  track: '#F0F1F1',
  /** 숫자 칸 하나를 강조할 때의 진한 바탕(먹색). 흰 글자 대비 4.5:1 이상. */
  highlightBg: tone.ink,
  highlightFg: '#FFFFFF',
  highlightAccent: tone.lemon,
  cardRadius: radius.xl,
} as const;

/**
 * 분석 그림 카드(#898, PM 참고 그림 "Cost Breakdown"): 청회색 판 위에 연노랑 막대, 빈 부분은 반투명 흰 칸.
 * 가장 중요한 숫자 하나는 오른쪽 위 말풍선(callout)에 크게, 카드 아래에는 그 그림을 읽은 요약 문장.
 * 판 위 보조 글자 #3E4C50은 청회색 대비 약 6:1, 먹색은 약 10.9:1. 막대 색은 보조 신호이고 값 글자가 늘 함께 있다.
 */
export const chartTheme = {
  cardBg: tone.mist,
  text: tone.ink,
  textSecondary: '#3E4C50',
  track: 'rgba(255, 255, 255, 0.55)',
  bar: tone.lemonDeep,
  barStrong: tone.ink,
  barSoft: 'rgba(255, 255, 255, 0.9)',
  line: 'rgba(33, 33, 33, 0.18)',
  calloutBg: 'rgba(255, 255, 255, 0.72)',
  summaryText: '#3A3A3A',
} as const;

/**
 * 지도 핀(#898). PM 요청 2026-11-23: 회사는 작은 색 점(그림 없음), 거산 본사만 초록 핀 안 흰 집.
 * 관심 = 빨강, 진행 중 = 파랑, 올해 성공 = 노랑. 점은 흰 테두리 + 그림자로 지도 위에서 보인다.
 * icon은 본사 집 그림 색(핀 바탕 대비 4.4:1). text는 흰 바탕 글자용 진한 색(4.5:1 이상).
 */
export const mapPinPalette = {
  INTERESTED: { bg: '#E5484D', icon: '#FFFFFF', text: '#B42318' },
  IN_PROGRESS: { bg: '#1594C9', icon: '#FFFFFF', text: '#0B6A93' },
  WON_THIS_YEAR: { bg: '#EDB100', icon: tone.ink, text: '#7A5A00' },
  HQ: { bg: '#23885F', icon: '#FFFFFF', text: '#1B6B4A' },
} as const;

export type MapPinKind = keyof typeof mapPinPalette;

/**
 * 상세 영업 단계(#898, PM 2026-11-23 "연두와 비슷하게, 해당 부분은 진한 회색"): 지나온 칸·점 = 연두(점 안 검정 ✓),
 * 지금 칸·점 = 진한 회색(칸 글자 흰색, 대비 약 10:1), 아직인 칸 = 옅은 회색, 아직인 점 = 흰 원 + 회색 테두리.
 * 칸마다 테두리를 두고, 점 사이 선은 지나온 구간 진한 연두, 나머지 옅은 회색.
 */
export const progressTheme = {
  // 11/24 PM "쨍하지 않게": 지나온 칸·점을 포인트 색(크림 연두)의 진한 쪽으로 차분하게.
  done: tone.lemonDeep,
  doneFg: tone.ink,
  doneLine: '#A9AE5E',
  current: '#3C4045',
  currentFg: '#FFFFFF',
  todo: '#F1F2F2',
  todoBorder: '#B5B8B8',
  line: '#D5D7D7',
  bandBorder: '#C9CBCB',
  bandBorderDone: '#BFC37A',
} as const;
