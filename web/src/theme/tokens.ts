// 테마 토큰 — 색·글꼴·크기의 유일한 출처(상세 화면 설계 design-system-mapping.md 1·2장, NFR11.4).
// 화면 부품 코드에 색·글꼴 값을 직접 적지 않는다. 강조색만 src/config/brand.ts에서 가져온다.
import type { ThemeConfig } from 'antd';
import { brand } from '../config/brand';

export const colors = {
  text: '#1F2329',
  textSecondary: '#5B6470',
  /** 거래 확인 전 점수(#264): 보조 글자보다 연하지만 흰 배경에서 대비 4.5:1을 지킨다. */
  textDimmed: '#767676',
  bgLayout: '#F5F6F8',
  bgContainer: '#FFFFFF',
  borderSecondary: '#E3E6EA',
  border: '#767F8C',
  error: '#B42318',
} as const;

/** 상태 색 6가지 조합(배경 연함 + 글자 진함, 대비 4.5:1 이상). 색은 보조 신호이고 글자가 항상 함께 있다. */
export const statusPalette = {
  ok: { bg: '#E3F3E8', fg: '#145A32' },
  wait: { bg: '#FFF3C4', fg: '#6B4E00' },
  ask: { bg: '#E6EFFB', fg: '#1A4F9C' },
  no: { bg: '#FCE8E6', fg: '#8A1C1C' },
  recheck: { bg: '#FFE8D1', fg: '#7A3E00' },
  neutral: { bg: '#EEF0F3', fg: '#3C4650' },
} as const;

export type StatusTone = keyof typeof statusPalette;

export const typography = {
  fontFamily: "'Pretendard Variable', Pretendard, -apple-system, 'Malgun Gothic', sans-serif",
  fontSize: 16,
  fontSizeSecondary: 14,
  fontSizeCardTitle: 20,
  fontSizeH1: 24,
  lineHeight: 1.6,
} as const;

export const spacing = {
  cardGap: 16,
  cardPadding: 20,
  sectionGap: 32,
  contentMaxWidth: 1200,
  headerHeight: 64,
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
    borderRadius: 8,
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    controlHeight: 40,
  },
};

/**
 * 영업 분석 그래프 색(#760). dataviz 기본 범주 색 1~4번(파랑 · 주황 · 청록 · 노랑) 순서 그대로 —
 * 검사 도구(validate_palette)로 색맹 구분을 확인한 순서다. 색은 보조 신호이고 범례·값 글자가 함께 있다.
 */
export const chartPalette = {
  series: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100'],
  grid: '#E9EAEC',
  track: '#F1F2F4',
  /** 숫자 칸 하나를 강조할 때의 진한 바탕(참고 그림의 진한 초록 칸). 흰 글자 대비 4.5:1 이상. */
  highlightBg: '#1F3A30',
  highlightFg: '#FFFFFF',
  highlightAccent: '#B9E36B',
  cardRadius: 16,
} as const;
