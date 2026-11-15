// 오른쪽 "💬 영업 코치" 칸(#773, #756 둘째 조각, PM 결정 2026-11-15·16).
// 넓은 화면에서는 화면 오른쪽에 붙어 스크롤을 따라오고(칸 안에서만 넘어감), [›]로 접으면 💬만 남는다.
// 접은 상태는 브라우저가 기억한다. 좁은 기기에서는 본문 아래에 그대로 놓는다(따라오지 않음).
// 접어도 안의 내용은 지우지 않는다(쓰던 메모·답이 사라지지 않게 숨기기만 한다).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { frame } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export const DOCK_STORAGE_KEY = 'geosan.coachDockCollapsed';
const WIDTH = 380;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DOCK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

const toggleStyle = {
  minWidth: 36,
  minHeight: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  background: colors.bgContainer,
  cursor: 'pointer',
  font: 'inherit',
} as const;

export default function CoachDock({
  narrowDevice,
  children,
}: {
  narrowDevice: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => (narrowDevice ? false : readCollapsed()));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(DOCK_STORAGE_KEY, String(next));
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
        top: 0,
        alignSelf: 'flex-start',
        maxHeight: '100vh',
        overflowY: collapsed ? 'hidden' : 'auto',
        boxSizing: 'border-box',
        borderLeft: `1px solid ${colors.borderSecondary}`,
        background: colors.bgContainer,
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
