// 왼쪽 메뉴 "새로 생긴 것" 숫자(#770, 계약 C1 `GET /menu-badges`). client.ts(경계 파일)는 고치지 않고 request만 쓴다.
// 서버는 곳 수만 돌려준다(회사 이름·글 없음). "마지막으로 연 시각"은 서버에 저장하지 않고 이 브라우저가
// 담당자별로 기억해 보낸다(새 표·열 없음).
import { request } from './client';
import type { Envelope } from './types';

export interface MenuBadges {
  /** 오늘 확인할 것: 지난 일정 + 오늘 일정 + 나에게 온 전달 사항 곳 수. */
  dashboard: number;
  /** 신규 거래처 찾기를 마지막으로 연 뒤 새로 들어온 후보 곳 수. */
  list: number;
  /** 관심 기업 화면을 마지막으로 연 뒤 다른 사람 기록·새 조사 결과가 붙은 관심 기업 곳 수. */
  bookmarks: number;
  /**
   * (#987) 관심에 담고 검토 의견을 안 고른 회사 수(영업 단계 전인 곳만, 영업 홈 "의견 전" 칸과 같은 숫자).
   * 옛 서버는 이 칸이 없다 — 없으면 화면은 표시를 그리지 않는다.
   */
  bookmarksNoOpinion?: number;
}

export interface MenuSeen {
  list: string | null;
  bookmarks: string | null;
}

export function getMenuBadges(
  seen: MenuSeen,
  staffKey: string | null,
  signal?: AbortSignal,
): Promise<Envelope<MenuBadges>> {
  const params = new URLSearchParams();
  if (seen.list) params.set('listSince', seen.list);
  if (seen.bookmarks) params.set('bookmarksSince', seen.bookmarks);
  const query = params.toString();
  return request<MenuBadges>(`/menu-badges${query ? `?${query}` : ''}`, { signal, staffKey });
}

/** 브라우저에 담당자별로 기억하는 "마지막으로 연 시각". 계정 방식이면 로그인한 사람 키다. */
export const MENU_SEEN_STORAGE_PREFIX = 'geosan.menuSeen.';

function storageKey(staffKey: string | null): string {
  return `${MENU_SEEN_STORAGE_PREFIX}${staffKey ?? 'none'}`;
}

export function readMenuSeen(staffKey: string | null): MenuSeen {
  try {
    const raw = window.localStorage.getItem(storageKey(staffKey));
    const value = raw ? (JSON.parse(raw) as Partial<MenuSeen>) : {};
    return {
      list: typeof value.list === 'string' ? value.list : null,
      bookmarks: typeof value.bookmarks === 'string' ? value.bookmarks : null,
    };
  } catch {
    return { list: null, bookmarks: null };
  }
}

/**
 * 지금 연 화면은 "지금 봤음"으로, 처음 쓰는 브라우저(기억이 없음)는 지금부터 센다.
 * 처음부터 목록 전체를 "새것"으로 세지 않기 위해서다.
 */
export function updateMenuSeen(
  staffKey: string | null,
  opened: keyof MenuSeen | null,
  now: Date = new Date(),
): MenuSeen {
  const stamp = now.toISOString();
  const before = readMenuSeen(staffKey);
  const next: MenuSeen = {
    list: opened === 'list' || !before.list ? stamp : before.list,
    bookmarks: opened === 'bookmarks' || !before.bookmarks ? stamp : before.bookmarks,
  };
  try {
    window.localStorage.setItem(storageKey(staffKey), JSON.stringify(next));
  } catch {
    // 저장소를 못 쓰는 브라우저면 이번 값만 쓴다(숫자는 그때그때 0부터 센다).
  }
  return next;
}
