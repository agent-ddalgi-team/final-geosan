// 시험 도우미(#740): 펼쳐진 일정 달력(QuickDate)에서 날짜 하나를 고른다.
// 달력이 보이는 달(data-month)과 고를 날짜의 달이 다르면 [이전 달]·[다음 달]로 넘긴 뒤 그 날을 누른다.
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** 넘길 수 있는 최대 달 수. 이보다 멀면 시험 쪽에서 오늘(가짜 시계)을 가까이 잡는다. */
const MAX_MONTH_STEPS = 24;

export async function pickCalendarDate(user: UserEvent, testId: string, date: string) {
  const target = date.slice(0, 7);
  for (let step = 0; step < MAX_MONTH_STEPS; step += 1) {
    const shown = screen.getByTestId(testId).getAttribute('data-month') ?? '';
    if (shown === target) break;
    await user.click(screen.getByTestId(`${testId}-${shown < target ? 'next' : 'prev'}`));
  }
  await user.click(screen.getByTestId(`${testId}-day-${date}`));
}

/** "2026-11-14"에서 days일 뒤의 날짜. 날짜만 다루므로 시간대 계산 없이 센다. */
export function addDays(from: string, days: number): string {
  const [year, month, day] = from.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
