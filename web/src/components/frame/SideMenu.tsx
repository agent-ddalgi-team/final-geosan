// 왼쪽 메뉴(#762, PM 결정 2026-11-16): 📊 대시보드 · 🔍 신규 거래처 찾기 · ⭐ 관심 기업 · 📈 영업 분석.
// [‹]/[›]로 접고 펼치며, 접으면 이모지 아이콘만 남는다(이름은 마우스를 올리면 뜨고, 화면 읽기 도구는
// aria-label로 그대로 읽는다). 접은 상태는 브라우저에 기억하고, 좁은 기기는 처음부터 접힌 채로 연다.
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { frame } from '../../labels/ko';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { colors, typography } from '../../theme/tokens';

export const SIDEBAR_STORAGE_KEY = 'geosan.sidebarCollapsed';
const WIDE = 208;
const NARROW = 60;

function readCollapsed(narrowDevice: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // 저장소를 못 쓰면 기기 폭으로 정한다.
  }
  return narrowDevice;
}

const ITEMS = [
  {
    to: '/',
    end: true,
    icon: frame.menuIcons.dashboard,
    label: frame.menuDashboard,
    testId: 'nav-dashboard-link',
  },
  {
    to: LIST_PATH,
    end: false,
    icon: frame.menuIcons.opportunities,
    label: frame.menuOpportunities,
    testId: 'nav-opportunities-link',
  },
  {
    to: BOOKMARKS_PATH,
    end: false,
    icon: frame.menuIcons.bookmarks,
    label: frame.menuBookmarks,
    testId: 'nav-bookmarks-link',
  },
  {
    to: '/sales-analysis',
    end: false,
    icon: frame.menuIcons.salesAnalysis,
    label: frame.menuSalesAnalysis,
    testId: 'nav-sales-analysis-link',
  },
] as const;

export default function SideMenu({ narrowDevice }: { narrowDevice: boolean }) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(narrowDevice));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // 저장소를 못 써도 이번 화면에서는 바뀐 상태가 유지된다.
    }
  };
  return (
    <nav
      aria-label={frame.navLabel}
      data-testid="side-menu"
      data-collapsed={collapsed}
      style={{
        width: collapsed ? NARROW : WIDE,
        flexShrink: 0,
        borderRight: `1px solid ${colors.borderSecondary}`,
        background: colors.bgContainer,
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        minHeight: '100vh',
        padding: '12px 8px',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
        title={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
        data-testid="side-menu-toggle"
        style={{
          display: 'block',
          marginLeft: 'auto',
          minWidth: 36,
          minHeight: 36,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          background: colors.bgContainer,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 4 }}>
        {ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              data-testid={item.testId}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 10,
                minHeight: 40,
                padding: collapsed ? 0 : '0 12px',
                borderRadius: 8,
                fontWeight: isActive ? 700 : 400,
                background: isActive ? colors.borderSecondary : 'transparent',
                color: colors.text,
                fontSize: typography.fontSize,
                textDecoration: 'none',
              })}
            >
              <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
                {item.icon}
              </span>
              {collapsed ? null : <span>{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
