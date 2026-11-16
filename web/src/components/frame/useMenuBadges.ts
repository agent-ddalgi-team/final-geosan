// 왼쪽 메뉴 숫자(#770)를 읽는 훅. 화면을 옮길 때마다 "지금 연 화면"을 봤음으로 기억하고 숫자를 다시 읽는다.
// 영업 코치 [넣기](#774)로 일정이 바뀌어도 다시 읽는다. 숫자를 못 읽으면 숫자를 붙이지 않는다(메뉴 자체는 그대로).
import { useEffect, useState } from 'react';
import { SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import { getMenuBadges, updateMenuSeen } from '../../api/menuBadges';
import type { MenuBadges, MenuSeen } from '../../api/menuBadges';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { useFrame } from './FrameContext';

function openedOf(pathname: string): keyof MenuSeen | null {
  if (pathname === LIST_PATH) return 'list';
  if (pathname === BOOKMARKS_PATH) return 'bookmarks';
  return null;
}

export function useMenuBadges(pathname: string): MenuBadges | null {
  const { staffKey } = useFrame();
  const [badges, setBadges] = useState<MenuBadges | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const again = () => setRefresh((n) => n + 1);
    window.addEventListener(SCHEDULE_CHANGED_EVENT, again);
    return () => window.removeEventListener(SCHEDULE_CHANGED_EVENT, again);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const seen = updateMenuSeen(staffKey, openedOf(pathname));
    getMenuBadges(seen, staffKey, controller.signal)
      .then((envelope) => {
        if (!controller.signal.aborted) setBadges(envelope.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBadges(null);
      });
    return () => controller.abort();
  }, [pathname, staffKey, refresh]);

  return badges;
}
