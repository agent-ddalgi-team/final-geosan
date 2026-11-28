// 왼쪽 메뉴 아래 달력(#983)이 쓰는 일정을 읽는 훅. 달력은 모든 화면에 있으므로 일정을 화면마다 다시 읽지 않게
// 이 파일이 한 번 읽은 값을 담당자별로 기억해 둔다(브라우저를 새로 고치면 비워진다).
//   - 자료는 영업 홈과 같은 `GET /dashboard` 응답의 schedule 이다(새 서버 경로 · 새 응답 칸 없음).
//     담당자 키 규칙도 영업 홈과 같다: 기록할 수 있는 담당자만 키를 보내고, 보기 전용 · 미선택은 보내지 않는다.
//   - 영업 홈에서는 같은 요청을 두 번 보내지 않는다: 영업 홈이 읽은 값을 여기에 알리고(publish…),
//     이 훅은 영업 홈 주소에서는 스스로 읽지 않는다.
//   - 다른 화면에서는 기억해 둔 값이 없을 때 한 번 읽고, 화면을 옮겨도 다시 읽지 않는다. 다만 기억한 지
//     오래됐으면(SIDE_SCHEDULE_FRESH_MS) 화면을 옮길 때 조용히 다시 읽는다(보이던 값은 그대로 둔다).
//   - 일정이 바뀌었다는 알림(SCHEDULE_CHANGED_EVENT)을 들으면 다시 읽는다.
//   - 못 읽으면 error 상태를 돌려준다. 빈 달력을 정상처럼 보이지 않는다(달력 칸이 짧은 안내를 보인다).
//     전에 읽은 일정이 있으면 그 달력은 그대로 두되 stale로 알려, 달력 아래에 "새 일정을 읽지 못했다"가 보인다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import { getDashboard } from '../../api/dashboard';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';

/** 기억한 값을 "방금 읽은 값"으로 보는 시간(화면 모양값, 규칙 숫자 아님). 지나면 화면을 옮길 때 다시 읽는다. */
export const SIDE_SCHEDULE_FRESH_MS = 60_000;

/** 영업 홈 주소. 여기서는 영업 홈이 읽은 값을 받아 쓴다. */
const HOME_PATH = '/';

interface Entry {
  items: DashboardScheduleItem[] | null;
  failed: boolean;
  /** 마지막으로 값을 받은 시각(ms). 실패만 했으면 0. */
  at: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function keyOf(staffKey: string | null): string {
  return staffKey ?? '';
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 영업 홈(또는 이 훅)이 읽은 일정을 알린다. */
export function publishSideSchedule(
  staffKey: string | null,
  items: DashboardScheduleItem[],
  now: number = Date.now(),
): void {
  entries.set(keyOf(staffKey), { items, failed: false, at: now });
  emit();
}

/** 읽기에 실패했음을 알린다. 전에 읽은 값이 있으면 그 값은 그대로 두고(보이던 달력 유지) 실패만 적는다. */
export function publishSideScheduleError(staffKey: string | null): void {
  const before = entries.get(keyOf(staffKey));
  entries.set(keyOf(staffKey), { items: before?.items ?? null, failed: true, at: before?.at ?? 0 });
  emit();
}

/** 시험에서 기억을 비운다. */
export function resetSideSchedule(): void {
  entries.clear();
  emit();
}

export interface SideSchedule {
  /** loading = 아직 값 없음, error = 못 읽었고 보일 값도 없음, ready = 보일 값이 있음. */
  state: 'loading' | 'error' | 'ready';
  items: DashboardScheduleItem[];
  /** ready인데 마지막 읽기는 실패했다: 보이는 일정은 앞서 읽은 값이다(달력 아래에 알린다). */
  stale: boolean;
  /** 다시 읽는다([다시 읽기] 단추). 영업 홈에서는 영업 홈의 [다시 시도]가 맡으므로 null. */
  reload: (() => void) | null;
}

export function useSideSchedule(staffKey: string | null, pathname: string): SideSchedule {
  const key = keyOf(staffKey);
  const entry = useSyncExternalStore(subscribe, () => entries.get(key));
  const [tick, setTick] = useState(0);
  // 다시 읽기 · 일정 바뀜 알림으로 온 요청은 기억한 값이 새것이어도 읽는다(한 번 쓰고 내린다).
  const forced = useRef(false);
  const again = useCallback(() => {
    forced.current = true;
    setTick((n) => n + 1);
  }, []);
  const onHome = pathname === HOME_PATH;
  const reload = onHome ? null : again;

  // 일정이 바뀌었다는 알림을 들으면 다시 읽는다. 영업 홈에서는 영업 홈이 다시 읽어 알려 주므로 따로 읽지 않는다.
  useEffect(() => {
    if (onHome) return undefined;
    window.addEventListener(SCHEDULE_CHANGED_EVENT, again);
    return () => window.removeEventListener(SCHEDULE_CHANGED_EVENT, again);
  }, [onHome, again]);

  useEffect(() => {
    if (onHome) return undefined;
    const must = forced.current;
    forced.current = false;
    const known = entries.get(key);
    // 다시 읽으라는 요청이 왔으면 기억한 값을 "오래된 값"으로 적어 둔다: 이 읽기가 화면 이동으로 끊겨도 다음에 읽는다.
    // (보이는 일정은 그대로라 화면에 알리지 않는다.)
    if (must && known) known.at = 0;
    // 방금 읽은 값이 있으면 화면을 옮겨도 다시 읽지 않는다(다시 읽기 · 알림으로 온 경우는 읽는다).
    const fresh =
      known !== undefined && !known.failed && Date.now() - known.at < SIDE_SCHEDULE_FRESH_MS;
    if (fresh && !must) return undefined;
    const controller = new AbortController();
    getDashboard(controller.signal, staffKey)
      .then((envelope) => {
        if (!controller.signal.aborted) publishSideSchedule(staffKey, envelope.data.schedule);
      })
      .catch(() => {
        if (!controller.signal.aborted) publishSideScheduleError(staffKey);
      });
    return () => controller.abort();
    // pathname: 화면을 옮길 때 기억한 값이 오래됐는지 다시 본다.
  }, [key, staffKey, onHome, pathname, tick]);

  if (entry?.items) return { state: 'ready', items: entry.items, stale: entry.failed, reload };
  if (entry?.failed) return { state: 'error', items: [], stale: false, reload };
  return { state: 'loading', items: [], stale: false, reload };
}
