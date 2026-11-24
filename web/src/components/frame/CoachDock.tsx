// 오른쪽 "💬 영업 코치" 칸(#773, #756 둘째 조각, PM 결정 2026-11-15·16).
// 넓은 화면에서는 화면 오른쪽에 붙어 스크롤을 따라오고(칸 안에서만 넘어감), [›]로 접으면 💬만 남는다.
// 접은 상태는 브라우저가 기억한다. 좁은 기기에서는 본문 아래에 그대로 놓는다(따라오지 않음).
// #795(PM 결정 2026-11-16): 기본값과 기억을 화면 종류별로 나눈다. 기업 상세·신규 거래처 찾기는 기본 펼침,
// 대시보드·관심 기업·영업 분석은 기본 접힘(💬만). 담당자가 펼치거나 접으면 그 화면 종류에만 기억한다.
// 예전 공통 키(geosan.coachDockCollapsed)는 읽지 않는다.
// 접어도 안의 내용은 지우지 않는다(쓰던 메모·답이 사라지지 않게 숨기기만 한다).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { frame } from '../../labels/ko';
import { colors, radius, tone, typography } from '../../theme/tokens';

/** 코치 칸이 놓이는 화면 종류(#795). */
export type DockScreen = 'DASHBOARD' | 'LIST' | 'BOOKMARKS' | 'DETAIL' | 'ANALYSIS';

/** 화면 종류별 기본 접힘(#795). 담당자가 한 번 바꾸면 그 값을 기억해 쓴다. */
export const DOCK_DEFAULT_COLLAPSED: Record<DockScreen, boolean> = {
  DETAIL: false,
  LIST: false,
  DASHBOARD: true,
  BOOKMARKS: true,
  ANALYSIS: true,
};

/** 화면 종류별 기억 자리. 예: geosan.coachDockCollapsed.DASHBOARD */
export function dockStorageKey(screen: DockScreen): string {
  return `geosan.coachDockCollapsed.${screen}`;
}
const WIDTH = 380;

function readCollapsed(screen: DockScreen): boolean {
  try {
    const saved = window.localStorage.getItem(dockStorageKey(screen));
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch {
    // 저장소를 못 쓰면 화면 기본값.
  }
  return DOCK_DEFAULT_COLLAPSED[screen];
}

const toggleStyle = {
  minWidth: 36,
  minHeight: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.pill,
  background: colors.bgContainer,
  cursor: 'pointer',
  font: 'inherit',
} as const;

export default function CoachDock({
  narrowDevice,
  screen = 'DETAIL',
  children,
}: {
  narrowDevice: boolean;
  /** 화면 종류(#795). 없으면 기업 상세처럼 기본 펼침. */
  screen?: DockScreen;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => (narrowDevice ? false : readCollapsed(screen)));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(dockStorageKey(screen), String(next));
    } catch {
      // 저장소를 못 써도 이번 화면에서는 바뀐 상태가 유지된다.
    }
  };
  if (narrowDevice) {
    return (
      <aside
        aria-label={frame.coachDockTitle}
        data-testid="coach-dock"
        data-collapsed={false}
        style={{ padding: '0 24px 24px' }}
      >
        <h2 style={{ fontSize: typography.fontSizeCardTitle }}>💬 {frame.coachDockTitle}</h2>
        {children}
      </aside>
    );
  }
  return (
    <aside
      aria-label={frame.coachDockTitle}
      data-testid="coach-dock"
      data-collapsed={collapsed}
      style={{
        width: collapsed ? 56 : WIDTH,
        flexShrink: 0,
        position: 'sticky',
        top: 12,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 24px)',
        overflowY: collapsed ? 'hidden' : 'auto',
        boxSizing: 'border-box',
        // #803: 본문과 같은 흰 바탕이라 경계가 안 보였다. #898: 옅은 청회색 판(참고 그림의 색 카드)으로 떠 있는 판처럼.
        border: `1px solid ${tone.mist}`,
        borderRadius: radius.xl,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.06)',
        margin: '12px 12px 12px 0',
        background: tone.mistSoft,
        padding: collapsed ? '12px 8px' : '12px 16px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          marginBottom: collapsed ? 0 : 12,
        }}
      >
        {collapsed ? null : (
          <h2 style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
            💬 {frame.coachDockTitle}
          </h2>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? frame.coachDockExpand : frame.coachDockCollapse}
          title={collapsed ? frame.coachDockExpand : frame.coachDockCollapse}
          data-testid="coach-dock-toggle"
          style={toggleStyle}
        >
          {collapsed ? '💬' : '›'}
        </button>
      </div>
      <div data-testid="coach-dock-body" hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
