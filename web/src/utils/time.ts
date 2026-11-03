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

/** "09:05" — "저장됨 HH:MM"에 쓴다. */
export function formatHourMinute(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const p = kstParts(typeof iso === 'string' ? iso : iso.toISOString(), {
    hour: '2-digit',
    minute: '2-digit',
  });
  return p ? `${p.hour}:${p.minute}` : null;
}
