// 메모를 쓰는 작은 달력(#984). 왼쪽 메뉴 아래 달력(SideCalendar)과 좁은 기기의 영업 홈 달력이 같이 쓴다.
// 작은 달력(DashboardCalendar mini)에 날짜 메모를 붙인다:
//   - 보이는 달 한 달의 메모를 한 번 읽고(달을 넘기면 그 달을 읽는다) 메모가 있는 날 칸에 테두리를 두른다.
//   - 날짜를 누르면 뜨는 창의 일정 아래에 그날 메모 칸(DayMemoBox)을 그린다.
//   - 메모를 못 읽어도 달력 · 일정은 그대로 쓴다. 메모 칸이 짧은 안내와 [다시 읽기]를 보인다.
// 일정은 받아서 그리기만 한다(읽는 것은 부르는 쪽 몫).
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DayMemo } from '../../api/dayMemos';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import DashboardCalendar from '../dashboard/DashboardCalendar';
import DayMemoBox from './DayMemoBox';
import { monthRange, useDayMemos } from './useDayMemos';

const NONE: DayMemo[] = [];

/** 달력이 처음 보이는 달(DashboardCalendar와 같은 규칙): 오늘이 속한 달, 오늘을 모르면 지금 달. */
function startMonth(today: string): { year: number; month: number } {
  const base = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (base) return { year: Number(base[1]), month: Number(base[2]) - 1 };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

interface Props {
  items: DashboardScheduleItem[];
  /** 오늘 날짜(YYYY-MM-DD, 한국 기준). */
  today: string;
  /** 작은 창이 뜨는 쪽. right = 달력 오른쪽(왼쪽 메뉴), below = 날짜 아래. */
  popoverSide: 'right' | 'below';
  /** 지금 화면 주소. 주면 화면을 옮길 때 오래된 메모를 조용히 다시 읽는다(모든 화면에 떠 있는 왼쪽 달력용). */
  watch?: string;
  /** 메모 칸 대신 작은 창 본문 아래에 끼울 것. 주면 메모 칸을 그리지 않는다(메모 표시는 그대로). */
  extra?: (day: string) => ReactNode;
}

export default function MemoCalendar({ items, today, popoverSide, watch, extra }: Props) {
  const [month, setMonth] = useState(() => startMonth(today));
  const { from, to } = monthRange(month.year, month.month);
  const memos = useDayMemos(from, to, watch);
  const byDay = useMemo(() => {
    const map = new Map<string, DayMemo[]>();
    for (const memo of memos.memos) map.set(memo.day, [...(map.get(memo.day) ?? []), memo]);
    return map;
  }, [memos.memos]);
  const counts = useMemo(
    () => new Map([...byDay].map(([day, list]) => [day, list.length] as const)),
    [byDay],
  );
  return (
    <DashboardCalendar
      items={items}
      today={today}
      mini
      popoverSide={popoverSide}
      memoCounts={counts}
      onMonthChange={(year, monthIndex) => setMonth({ year, month: monthIndex })}
      extra={
        extra ??
        ((day) => (
          // key: 다른 날짜를 누르면 적던 글 · 오류 안내를 비운다.
          <DayMemoBox
            key={day}
            day={day}
            memos={byDay.get(day) ?? NONE}
            state={memos.state}
            stale={memos.stale}
            onReload={memos.reload}
          />
        ))
      }
    />
  );
}
