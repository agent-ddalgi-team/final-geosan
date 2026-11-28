// #972 보라 톤: 글자가 올라가는 색 조합이 대비 4.5:1 이상인지 값을 계산해 지킨다(WCAG 2.1 상대 휘도 식).
// 색 값을 바꾸면 이 시험이 먼저 알려 준다. 글자 없는 막대·점·선(accent.bright, warn.dot 등)은 대상이 아니다.
import {
  accent,
  calendarPalette,
  chartPalette,
  chartTheme,
  choiceChip,
  colors,
  homePalette,
  loginTheme,
  mapPinPalette,
  neutralChip,
  ok,
  progressTheme,
  radius,
  sideCalendar,
  sidebarTheme,
  stageCell,
  statusPalette,
  tagPalette,
  warn,
} from '../tokens';
import { brand } from '../../config/brand';

type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!rgba) throw new Error(`읽을 수 없는 색: ${color}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

/** 반투명 색을 바탕 위에 겹친 실제 색. */
function over(top: string, base: string): Rgb {
  const t = parse(top);
  const b = parse(base).rgb;
  return t.rgb.map((value, i) => value * t.alpha + b[i] * (1 - t.alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: string, bg: string | Rgb): number {
  const a = luminance(parse(fg).rgb);
  const b = luminance(typeof bg === 'string' ? parse(bg).rgb : bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const WHITE = colors.bgContainer;

it.each([
  ['본문 글자 / 흰 카드', colors.text, WHITE],
  ['보조 글자 / 흰 카드', colors.textSecondary, WHITE],
  ['보조 글자 / 화면 바탕', colors.textSecondary, colors.bgLayout],
  ['흐린 글자 / 흰 카드', colors.textDimmed, WHITE],
  ['흐린 글자 / 화면 바탕', colors.textDimmed, colors.bgLayout],
  ['오류 글자 / 흰 카드', colors.error, WHITE],
  ['주 단추 흰 글자 / 강조 바탕', accent.onBg, accent.bg],
  ['기본 강조색(brand) 위 흰 글자', accent.onBg, brand.colorPrimary],
  ['강조 글자(링크) / 흰 카드', accent.text, WHITE],
  ['강조 글자(링크) / 화면 바탕', accent.text, colors.bgLayout],
  ['링크 손 올림 / 흰 카드', accent.textHover, WHITE],
  ['강조 글자 / 강조 연한 바탕', accent.text, accent.soft],
  ['강조 글자 / 조금 진한 연한 바탕', accent.text, accent.softDeep],
  ['본문 글자 / 조금 진한 연한 바탕', colors.text, accent.softDeep],
  ['주의 글자 / 주의 바탕', warn.text, warn.bg],
  ['주의 글자 / 흰 카드', warn.text, WHITE],
  ['확인 글자 / 확인 바탕', ok.text, ok.bg],
  ['확인 글자 / 흰 카드', ok.text, WHITE],
  ['중립 꼬리표', neutralChip.text, neutralChip.bg],
  ['고른 선택 단추', choiceChip.selected.fg, choiceChip.selected.bg],
  ['안 고른 선택 단추', choiceChip.idle.fg, choiceChip.idle.bg],
  ['왼쪽 메뉴 보통 줄', sidebarTheme.fg, sidebarTheme.bg],
  ['왼쪽 메뉴 묶음 이름', sidebarTheme.group, sidebarTheme.bg],
  ['왼쪽 메뉴 지금 화면 줄', sidebarTheme.fgActive, sidebarTheme.activeBg],
  ['왼쪽 메뉴 숫자 꼬리표', sidebarTheme.badgeFg, sidebarTheme.badgeBg],
  ['왼쪽 메뉴 주 단추', sidebarTheme.primaryFg, sidebarTheme.primaryBg],
  ['영업 홈 강조 칩', homePalette.blueText, homePalette.blueBg],
  ['영업 홈 진한 칩', WHITE, homePalette.blueStrong],
  ['영업 홈 지난 일정', homePalette.redText, homePalette.redBg],
  ['영업 홈 견적·샘플', homePalette.orangeText, homePalette.orangeBg],
  ['영업 홈 성사', homePalette.greenText, homePalette.greenBg],
  ['영업 홈 받은 전달', homePalette.yellowText, homePalette.yellowBg],
  ['영업 홈 흐린 글자', homePalette.muted, WHITE],
  ['영업 홈 보류 카드 이름', colors.textSecondary, homePalette.holdBg],
  ['영업 홈 보류 카드 풀이', homePalette.muted, homePalette.holdBg],
  ['영업 홈 지도 이름표', homePalette.mapTipFg, homePalette.mapTipBg],
  ['작은 단계 칸 "+n" 꼬리표(#983 → #992)', stageCell.enteredTag.fg, stageCell.enteredTag.bg],
  ['작은 단계 칸 "멈춤 n" 꼬리표(#983)', stageCell.stalledTag.fg, stageCell.stalledTag.bg],
  // #992: 고른 칸이 강조 연한 바탕에서 진한 보라 바탕 + 흰 글자로 바뀌었다(앞의 "이름·곳 / 고른 칸 바탕" 두 줄을 대신한다).
  ['작은 단계 칸 이름 / 흰 칸(#992)', stageCell.idle.name, stageCell.idle.bg],
  ['작은 단계 칸 숫자 / 흰 칸(#992)', stageCell.idle.count, stageCell.idle.bg],
  ['작은 단계 칸 이름 / 고른 칸 진한 보라(#992)', stageCell.selected.name, stageCell.selected.bg],
  ['작은 단계 칸 숫자 / 고른 칸 진한 보라(#992)', stageCell.selected.count, stageCell.selected.bg],
  [
    '고른 단계 칸 위 "+n" 꼬리표(#992)',
    stageCell.enteredTagOnSelected.fg,
    stageCell.enteredTagOnSelected.bg,
  ],
  ['단계 칸 묶음 맨 앞 "영업 단계" 글(#992)', stageCell.lead.fg, stageCell.group.bg],
  ['단계 칸 묶음 아래 설명 줄 / 흰 카드(#992)', colors.textDimmed, WHITE],
  ['왼쪽 달력 일정 있는 날(#983)', sideCalendar.has.fg, sideCalendar.has.bg],
  ['왼쪽 달력 지난 일정이 남은 날(#983)', sideCalendar.overdue.fg, sideCalendar.overdue.bg],
  ['왼쪽 달력 누른 날(#983)', sideCalendar.selected.fg, sideCalendar.selected.bg],
  ['왼쪽 달력 일정 없는 날 / 달력 칸 바탕(#983)', sideCalendar.plain.fg, sideCalendar.panelBg],
  ['왼쪽 달력 풀이 글 / 달력 칸 바탕(#983)', calendarPalette.textSecondary, sideCalendar.panelBg],
  ['왼쪽 달력 요일 · 안내 글 / 달력 칸 바탕(#983)', calendarPalette.weekday, sideCalendar.panelBg],
  ['달력 빈 날', calendarPalette.emptyFg, calendarPalette.emptyBg],
  ['달력 링크', calendarPalette.link, calendarPalette.popoverBg],
  ['그림 카드 보조 글자', chartTheme.textSecondary, chartTheme.cardBg],
  ['그림 숫자 칸 글자', chartTheme.text, chartTheme.calloutBg],
  ['그림 요약 글자 / 화면 바탕', chartTheme.summaryText, colors.bgLayout],
  ['강조 숫자 칸', chartPalette.highlightFg, chartPalette.highlightBg],
  ['단계: 지나온 칸', progressTheme.doneFg, progressTheme.done],
  ['단계: 지금 칸', progressTheme.currentFg, progressTheme.current],
  ['단계: 아직인 칸', colors.textSecondary, progressTheme.todo],
  ['접속 화면 제목 · 한 줄 소개(밤하늘 위)', loginTheme.text, loginTheme.skyMiddle],
  ['접속 화면 저작권 줄(짙은 곡선 위)', loginTheme.textSoft, loginTheme.planet],
  ['접속 단추', loginTheme.accentText, loginTheme.accent],
  ['누를 수 없는 접속 단추', loginTheme.disabledFg, loginTheme.disabledBg],
])('%s: 대비 4.5:1 이상', (_name, fg, bg) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
});

it.each([
  ['밤하늘 가운데', loginTheme.skyMiddle],
  ['밤하늘 아래쪽', loginTheme.skyLow],
  ['곡선 바로 위 가장 밝은 하늘', loginTheme.skyGlow],
])('#978 접속 화면 유리 상자의 흰 글자: %s 위에 놓여도 대비 4.5:1 이상', (_where, sky) => {
  // 유리 상자 = 하늘 위에 보라 유리(cardTint)를 겹치고 그 위에 옅은 흰 막(cardSheen)을 겹친 색.
  const tinted = over(loginTheme.cardTint, sky);
  const sheen = parse(loginTheme.cardSheen);
  const glass = tinted.map(
    (value, i) => sheen.rgb[i] * sheen.alpha + value * (1 - sheen.alpha),
  ) as Rgb;
  expect(contrast(loginTheme.text, glass)).toBeGreaterThanOrEqual(4.5);
});

it('#978 접속 화면의 [접속] 단추는 다른 화면의 강조 보라와 같은 색이다', () => {
  expect(loginTheme.accent).toBe(accent.bg);
  expect(loginTheme.accentText).toBe(accent.onBg);
});

it.each(Object.entries(statusPalette))('상태 꼬리표 %s: 대비 4.5:1 이상', (_tone, palette) => {
  expect(contrast(palette.fg, palette.bg)).toBeGreaterThanOrEqual(4.5);
});

it.each(Object.entries(tagPalette))('꼬리표 %s: 대비 4.5:1 이상', (_kind, palette) => {
  expect(contrast(palette.fg, palette.bg)).toBeGreaterThanOrEqual(4.5);
});

it.each(Object.entries(calendarPalette.tones))(
  '달력 %s: 칸 글자와, 칸 위에 겹친 "N건" 바탕의 글자 모두 대비 4.5:1 이상',
  (_tone, palette) => {
    expect(contrast(palette.fg, palette.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.fg, over(palette.badge, palette.bg))).toBeGreaterThanOrEqual(4.5);
  },
);

it.each(Object.entries(mapPinPalette))(
  '지도 핀 %s: 범례 글자(흰 바탕)와 핀 안 그림 모두 읽힌다',
  (_kind, palette) => {
    expect(contrast(palette.text, WHITE)).toBeGreaterThanOrEqual(4.5);
    // 핀 안 그림(본사 집)은 글자가 아닌 그림이라 3:1이 기준이다.
    expect(contrast(palette.icon, palette.bg)).toBeGreaterThanOrEqual(3);
  },
);

it('알약 모양을 쓰지 않는다: 모서리 값은 모두 16 이하이고, 카드 12 · 단추 9(작은 단추 8) · 꼬리표 6 · 뜨는 창 16', () => {
  expect(radius).toMatchObject({ card: 12, control: 9, controlSm: 8, tag: 6, modal: 16 });
  for (const value of Object.values(radius)) expect(value).toBeLessThanOrEqual(16);
});
