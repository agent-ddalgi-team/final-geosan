// 시각 표시 도우미. 서버는 시간대가 붙은 시각을 주고, 화면은 항상 한국 시각으로 보인다(BR9.3).

const KST = 'Asia/Seoul';

function kstParts(iso: string, options: Intl.DateTimeFormatOptions): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KST,
    hour12: false,
    ...options,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** "10/20 09:00" — 띠의 갱신 시각. 읽을 수 없는 값이면 null(빈 글자를 보이지 않는다). */
export function formatMonthDayTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const p = kstParts(iso, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return p ? `${p.month}/${p.day} ${p.hour}:${p.minute}` : null;
}

/**
 * "11/4" — 대시보드 일정·기록의 날짜. 날짜만 있는 값(YYYY-MM-DD)은 시간대 계산 없이 그대로 읽고,
 * 시각이 붙은 값은 한국 시각 날짜로 읽는다. 읽을 수 없는 값이면 null.
 */
export function formatMonthDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${Number(dateOnly[2])}/${Number(dateOnly[3])}`;
  const p = kstParts(value, { month: '2-digit', day: '2-digit' });
  return p ? `${Number(p.month)}/${Number(p.day)}` : null;
}

/**
 * "2023-01-02" — 연도까지 보이는 날짜(#719, 회사별 보고서). 여러 해에 걸친 자료가 한 장에 섞여
 * 월/일만으로는 언제인지 알 수 없는 곳에 쓴다. 날짜만 있는 값(YYYY-MM-DD)은 그대로,
 * 시각이 붙은 값은 한국 시각 날짜로 읽는다. 읽을 수 없는 값이면 null.
 */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const p = kstParts(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

/**
 * 지금(`now`) 기준으로 `iso`가 며칠 전인지(한국 날짜 기준 일수). 오늘이면 0, 미래이거나 읽을 수 없으면 null.
 * "조사 11/5 (3일 전)"의 괄호 안에 쓴다. 시각은 인자로 받아 시험이 현재 시각에 기대지 않게 한다.
 */
export function daysAgo(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = kstParts(iso, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = kstParts(now.toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (!then || !today) return null;
  const day = (p: Record<string, string>) =>
    Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const diff = Math.round((day(today) - day(then)) / 86_400_000);
  return diff < 0 ? null : diff;
}

/**
 * "2026-11-08" — 지금(`now`)의 한국 날짜. 접촉 날짜는 오늘(한국 시간)까지만 고를 수 있어(약속 C1, #433)
 * 브라우저 시간대와 상관없이 한국 날짜로 읽는다. 시각은 인자로 받아 시험이 현재 시각에 기대지 않게 한다.
 */
export function todayKst(now: Date = new Date()): string {
  const p = kstParts(now.toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}

/** "09:05" — "저장됨 HH:MM"에 쓴다. */
export function formatHourMinute(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const p = kstParts(typeof iso === 'string' ? iso : iso.toISOString(), {
    hour: '2-digit',
    minute: '2-digit',
  });
  return p ? `${p.hour}:${p.minute}` : null;
}
