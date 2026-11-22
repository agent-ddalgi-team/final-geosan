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
  lemon: '#FCFD76',
  lemonSoft: '#FDFEC4',
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
  wait: { bg: '#FBFCA8', fg: '#4A4500' },
  ask: { bg: '#E4E4F8', fg: '#36368A' },
  no: { bg: '#FBE4E1', fg: '#8A1C1C' },
  recheck: { bg: '#FDE8D2', fg: '#7A3E00' },
  neutral: { bg: '#EEEFEF', fg: '#3C4045' },
} as const;

export type StatusTone = keyof typeof statusPalette;

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
    Select: { borderRadius: radius.pill, borderRadiusLG: radius.pill },
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
 * 영업 분석 그래프 색(#760 → #898 참고 그림). 청회색 · 연보라 · 연노랑 · 먹색 순서. 참고 그림보다 한 단계
 * 진하게 해 흰 바탕에서 막대가 보이게 했다. 색은 보조 신호이고 범례·값 글자가 함께 있다.
 * 막대는 둥근 알약 모양, 빈 부분은 옅은 칸(track)으로 보인다.
 */
export const chartPalette = {
  series: ['#8FB2B9', '#ABABE8', '#E6E84A', '#4A4A4A'],
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
