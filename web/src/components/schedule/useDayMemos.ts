// 달력 날짜 메모(#984)를 읽는 훅. 왼쪽 메뉴 달력 · 좁은 기기의 영업 홈 달력(보이는 달 한 달)과
// 영업 홈 "오늘 할 일"의 메모 줄(오늘 하루)이 쓴다.
//   - 기간(from~to, 둘 다 포함)이 바뀌면 그 기간을 다시 읽는다(달력에서 달을 넘길 때).
//   - 메모를 남기거나 지웠다는 알림(DAY_MEMO_CHANGED_EVENT)을 들으면 알림에 실린 내용으로 바로 고친다
//     (다시 읽지 않아도 목록 · 달력 테두리 · 오늘 할 일 줄이 함께 따라온다). 아직 읽지 못한 상태였거나
//     읽는 중이었으면 다시 읽는다(늦게 온 옛 응답이 방금 고친 것을 덮지 않게).
//   - watch(지금 화면 주소)를 주면, 화면을 옮길 때 읽은 지 오래됐는지(DAY_MEMO_FRESH_MS) 보고 조용히 다시 읽는다.
//     달력은 모든 화면에 떠 있어서, 그러지 않으면 다른 담당자가 남긴 메모가 새로 고칠 때까지 보이지 않는다.
//   - 못 읽으면 error를 돌려준다(빈 목록을 정상처럼 보이지 않는다). 전에 읽은 메모가 있으면 그대로 두되 stale로 알린다.
// 읽기에는 담당자 키를 보내지 않는다(누구나 읽는다, 계약 C1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { DAY_MEMO_CHANGED_EVENT, getDayMemos } from '../../api/dayMemos';
import type { DayMemo, DayMemoChange } from '../../api/dayMemos';

/** 읽은 값을 "방금 읽은 값"으로 보는 시간(화면 모양값, 규칙 숫자 아님). 지나면 화면을 옮길 때 다시 읽는다. */
export const DAY_MEMO_FRESH_MS = 60_000;

const NONE: DayMemo[] = [];

export interface DayMemos {
  /** loading = 아직 값 없음, error = 못 읽었고 보일 값도 없음, ready = 보일 값이 있음. */
  state: 'loading' | 'error' | 'ready';
  /** 날짜 · 쓴 순서. */
  memos: DayMemo[];
  /** ready인데 마지막 읽기는 실패했다: 보이는 메모는 앞서 읽은 값이다. */
  stale: boolean;
  /** 다시 읽는다([다시 읽기] 단추). */
  reload: () => void;
}

interface Loaded {
  /** 어느 기간의 값인지. 기간이 바뀌면 이전 값은 보이지 않는다. */
  key: string;
  memos: DayMemo[] | null;
  failed: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 그 달의 첫날 ~ 끝날(YYYY-MM-DD). month는 0~11. 시간대 계산 없이 숫자로만 만든다. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`,
  };
}

/** 서버와 같은 순서: 날짜 → 적은 시각 → 번호. */
function sortMemos(list: DayMemo[]): DayMemo[] {
  return [...list].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.memoId.localeCompare(b.memoId),
  );
}

/** 알림에 실린 변화를 지금 목록에 반영한다. 이 기간 밖의 메모는 넣지 않는다. */
export function applyDayMemoChange(
  memos: DayMemo[],
  change: DayMemoChange,
  from: string,
  to: string,
): DayMemo[] {
  if (change.type === 'deleted') {
    return memos.some((memo) => memo.memoId === change.memoId)
      ? memos.filter((memo) => memo.memoId !== change.memoId)
      : memos;
  }
  const { memo } = change;
  if (memo.day < from || memo.day > to) return memos;
  if (memos.some((item) => item.memoId === memo.memoId)) return memos;
  return sortMemos([...memos, memo]);
}

export function useDayMemos(from: string, to: string, watch = ''): DayMemos {
  const key = `${from}:${to}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  // 마지막으로 값을 받은 기간과 시각. 실패했거나 다시 읽으라는 요청이 오면 비운다.
  const freshAt = useRef<{ key: string; at: number } | null>(null);
  // 다시 읽기 · 알림으로 온 요청은 방금 읽은 값이 있어도 읽는다(한 번 쓰고 내린다).
  const forced = useRef(false);
  const reading = useRef(false);
  const reload = useCallback(() => {
    forced.current = true;
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const must = forced.current;
    forced.current = false;
    // 다시 읽으라는 요청이 왔으면 "방금 읽은 값" 표시를 지운다: 이 읽기가 화면 이동으로 끊겨도 다음에 읽는다.
    if (must) freshAt.current = null;
    const last = freshAt.current;
    const fresh = last !== null && last.key === key && Date.now() - last.at < DAY_MEMO_FRESH_MS;
    if (fresh) return undefined;
    const controller = new AbortController();
    reading.current = true;
    getDayMemos(from, to, controller.signal)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        reading.current = false;
        freshAt.current = { key, at: Date.now() };
        setLoaded({ key, memos: sortMemos(envelope.data), failed: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        reading.current = false;
        freshAt.current = null;
        // 전에 읽은 같은 기간의 메모가 있으면 그대로 두고 실패만 적는다.
        setLoaded((before) => ({
          key,
          memos: before?.key === key ? before.memos : null,
          failed: true,
        }));
      });
    return () => {
      reading.current = false;
      controller.abort();
    };
    // watch: 화면을 옮길 때 읽은 지 오래됐는지 다시 본다.
  }, [key, from, to, watch, tick]);

  const mine = loaded?.key === key ? loaded : null;
  const ready = mine !== null && mine.memos !== null && !mine.failed;
  const readyNow = useRef(ready);
  useEffect(() => {
    readyNow.current = ready;
  }, [ready]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const change = (event as CustomEvent<DayMemoChange | undefined>).detail;
      if (change) {
        setLoaded((before) =>
          before && before.key === key && before.memos
            ? { ...before, memos: applyDayMemoChange(before.memos, change, from, to) }
            : before,
        );
      }
      // 아직 못 읽었거나 읽는 중이었으면 서버 값으로 다시 맞춘다.
      if (!change || !readyNow.current || reading.current) reload();
    };
    window.addEventListener(DAY_MEMO_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DAY_MEMO_CHANGED_EVENT, onChange);
  }, [key, from, to, reload]);

  if (mine?.memos) return { state: 'ready', memos: mine.memos, stale: mine.failed, reload };
  if (mine?.failed) return { state: 'error', memos: NONE, stale: false, reload };
  return { state: 'loading', memos: NONE, stale: false, reload };
}
