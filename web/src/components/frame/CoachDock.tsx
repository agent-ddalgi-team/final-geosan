// 오른쪽 "영업 코치" 칸(#773, #756 둘째 조각, PM 결정 2026-11-15·16).
// 넓은 화면에서는 화면 오른쪽에 붙어 스크롤을 따라오고(칸 안에서만 넘어감), [›]로 접으면 별 모양 단추만 남는다.
// 접은 상태는 브라우저가 기억한다. 좁은 기기에서는 본문 아래에 그대로 놓는다(따라오지 않음).
// #795(PM 결정 2026-11-16): 기본값과 기억을 화면 종류별로 나눈다. 기업 상세·신규 거래처 찾기는 기본 펼침,
// 대시보드·관심 기업·영업 분석은 기본 접힘(단추만). 담당자가 펼치거나 접으면 그 화면 종류에만 기억한다.
// 예전 공통 키(geosan.coachDockCollapsed)는 읽지 않는다.
// 접어도 안의 내용은 지우지 않는다(쓰던 메모·답이 사라지지 않게 숨기기만 한다).
// #972(보라 톤 시안): 펼치면 흰 카드(얇은 테두리, 모서리 12, 그림자 없음), 접으면 강조 바탕 정사각 단추(모서리 12)만 남는다.
// #981(PM 결정 2026-11-28): 머리를 시안 모양으로 맞춘다 — 별 아이콘 + "영업 코치" + 오른쪽 작은 "AI" + [›].
// 폭은 380 → 340(가운데 본문이 그만큼 넓어진다). 💬 이모지는 쓰지 않는다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { frame } from '../../labels/ko';
import { accent, colors, radius, typography } from '../../theme/tokens';

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
const WIDTH = 340;

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

/** 펼친 칸의 [›]: 흰 바탕 + 얇은 테두리 작은 단추. */
const collapseButtonStyle = {
  minWidth: 36,
  minHeight: 36,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: radius.controlSm,
  background: colors.bgContainer,
  color: colors.textSecondary,
  cursor: 'pointer',
  font: 'inherit',
} as const;

/** 영업 코치 표시(#981): 네 갈래 별. 꾸밈이라 화면 낭독기에는 숨긴다(이름은 옆 글자·단추 이름이 읽힌다). */
function CoachIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="coach-dock-icon"
      style={{ flex: 'none' }}
    >
      <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" />
    </svg>
  );
}

/** 머리 줄의 제목: 별 아이콘 + "영업 코치". */
const titleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  fontSize: typography.fontSizeCardTitle,
} as const;

/** 접힌 칸의 단추: 강조 바탕 정사각 단추(시안의 영업 코치 단추). */
const COLLAPSED_SIZE = 44;
const expandButtonStyle = {
  width: COLLAPSED_SIZE,
  height: COLLAPSED_SIZE,
  padding: 0,
  border: 0,
  borderRadius: radius.card,
  background: accent.bg,
  color: accent.onBg,
  cursor: 'pointer',
  font: 'inherit',
  display: 'grid',
  placeItems: 'center',
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
        <h2 style={{ ...titleStyle, marginBottom: 12 }}>
          <CoachIcon color={accent.bg} />
          {frame.coachDockTitle}
        </h2>
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
        width: collapsed ? COLLAPSED_SIZE : WIDTH,
        flexShrink: 0,
        position: 'sticky',
        top: 12,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 24px)',
        overflowY: collapsed ? 'hidden' : 'auto',
        boxSizing: 'border-box',
        // #972: 화면 바탕(옅은 회보라) 위의 흰 카드라 얇은 테두리만으로 경계가 보인다. 접으면 카드 없이 단추만.
        border: collapsed ? 0 : `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.card,
        margin: '12px 12px 12px 0',
        background: collapsed ? 'transparent' : colors.bgContainer,
        padding: collapsed ? 0 : 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 8,
          marginBottom: collapsed ? 0 : 12,
        }}
      >
        {collapsed ? null : (
          <>
            <h2 style={titleStyle}>
              <CoachIcon color={accent.bg} />
              {frame.coachDockTitle}
            </h2>
            <span
              data-testid="coach-dock-ai"
              style={{
                marginLeft: 'auto',
                color: colors.textSecondary,
                fontSize: typography.fontSizeSecondary,
              }}
            >
              {frame.coachDockAi}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? frame.coachDockExpand : frame.coachDockCollapse}
          title={collapsed ? frame.coachDockExpand : frame.coachDockCollapse}
          data-testid="coach-dock-toggle"
          style={collapsed ? expandButtonStyle : collapseButtonStyle}
        >
          {collapsed ? <CoachIcon color={accent.onBg} size={22} /> : '›'}
        </button>
      </div>
      <div data-testid="coach-dock-body" hidden={collapsed}>
        {children}
      </div>
    </aside>
  );
}
