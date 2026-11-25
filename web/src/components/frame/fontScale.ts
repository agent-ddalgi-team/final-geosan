// #926(PM 요청 2026-11-25): 사용자가 고르는 글자 크기. 화면 전체 비율(CSS zoom)로 키우고 줄인다.
// 글자 크기가 부품마다 숫자로 적혀 있어, 숫자를 하나씩 바꾸지 않고 <html data-font-scale="L">로 한 번에 바꾼다
// (비율은 styles.css). 고른 값은 이 브라우저에만 기억한다(계정·서버 저장 아님).
export const FONT_SCALE_KEYS = ['S', 'M', 'L', 'XL'] as const;
export type FontScaleKey = (typeof FONT_SCALE_KEYS)[number];
export const DEFAULT_FONT_SCALE: FontScaleKey = 'M';
export const FONT_SCALE_STORAGE_KEY = 'geosan.fontScale';

function isFontScale(value: unknown): value is FontScaleKey {
  return typeof value === 'string' && (FONT_SCALE_KEYS as readonly string[]).includes(value);
}

/** 기억한 글자 크기. 없거나 모르는 값이면 보통. 저장소를 못 읽어도 보통. */
export function readFontScale(): FontScaleKey {
  try {
    const saved = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return isFontScale(saved) ? saved : DEFAULT_FONT_SCALE;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

/** 화면에 바로 적용한다. 보통이면 표시를 지워 원래 크기로 둔다. */
export function applyFontScale(key: FontScaleKey): void {
  const root = document.documentElement;
  if (key === DEFAULT_FONT_SCALE) delete root.dataset.fontScale;
  else root.dataset.fontScale = key;
}

/** 적용하고 이 브라우저에 기억한다. 저장소가 막혀 있으면 이번 화면에만 적용된다. */
export function chooseFontScale(key: FontScaleKey): void {
  applyFontScale(key);
  try {
    window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, key);
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 등): 적용은 이미 했으므로 이번 화면에서는 그대로 보인다.
  }
}
