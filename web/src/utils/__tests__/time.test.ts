// daysAgo: 한국 날짜 기준 며칠 전인지. 시각은 인자로 받아 현재 시각에 기대지 않는다.
// formatDate: 연도까지 보이는 날짜.
import { daysAgo, formatDate } from '../time';

describe('daysAgo', () => {
  const now = new Date('2026-11-05T03:00:00Z'); // 한국 시각 11/5 12:00

  it.each([
    ['2026-11-05T01:00:00+09:00', 0],
    ['2026-11-04T23:59:00+09:00', 1],
    ['2026-11-02T09:00:00+09:00', 3],
    ['2026-10-06T09:00:00+09:00', 30],
  ])('%s 는 %i일 전', (iso, expected) => {
    expect(daysAgo(iso, now)).toBe(expected);
  });

  it('한국 날짜로 센다: UTC로는 같은 날이어도 한국에서는 다음 날이면 하루 차이', () => {
    // UTC 11/4 16:00 = 한국 11/5 01:00
    expect(daysAgo('2026-11-04T16:00:00Z', now)).toBe(0);
    expect(daysAgo('2026-11-04T14:00:00Z', now)).toBe(1);
  });

  it('미래이거나 읽을 수 없거나 비었으면 null', () => {
    expect(daysAgo('2026-11-06T09:00:00+09:00', now)).toBeNull();
    expect(daysAgo('이상한 값', now)).toBeNull();
    expect(daysAgo(null, now)).toBeNull();
    expect(daysAgo(undefined, now)).toBeNull();
  });
});

describe('formatDate (연도까지 보이는 날짜, #719)', () => {
  it('날짜만 있는 값은 그대로 보인다', () => {
    expect(formatDate('2023-01-02')).toBe('2023-01-02');
  });

  it('시각이 붙은 값은 한국 날짜로 읽는다', () => {
    // UTC 2023-12-31 16:00 = 한국 2024-01-01 01:00
    expect(formatDate('2023-12-31T16:00:00Z')).toBe('2024-01-01');
    expect(formatDate('2026-11-06T09:00:00+09:00')).toBe('2026-11-06');
  });

  it('읽을 수 없거나 비었으면 null', () => {
    expect(formatDate('이상한 값')).toBeNull();
    expect(formatDate('')).toBeNull();
    expect(formatDate(null)).toBeNull();
    expect(formatDate(undefined)).toBeNull();
  });
});
