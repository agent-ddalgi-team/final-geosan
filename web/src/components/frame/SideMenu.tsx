// 왼쪽 메뉴(#762, PM 결정 2026-11-16): 대시보드 · 신규 거래처 찾기 · 관심 기업 · 영업 분석.
// [메뉴 접기]로 접고 펼치며, 접으면 그림(아이콘)만 남는다(이름은 마우스를 올리거나 키보드로 오면 오른쪽 이름표로
// 뜨고, 화면 읽기 도구는 aria-label로 그대로 읽는다). 접은 상태는 브라우저에 기억하고, 좁은 기기는 처음부터 접힌 채로 연다.
// #767(PM 요청 2026-11-15·결정 2026-11-16): 참고 그림처럼 어두운 칸 + 내용에 맞는 선 그림 아이콘(이모지 대신, 글자는
// 한글·숫자만). 그림은 그림 파일 없이 SVG로 그린다. 색은 theme/tokens의 sidebarTheme만 쓴다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { frame } from '../../labels/ko';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { sidebarTheme, typography } from '../../theme/tokens';

export const SIDEBAR_STORAGE_KEY = 'geosan.sidebarCollapsed';
const WIDE = 220;
const NARROW = 72;

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

/** 선 그림 아이콘 틀(24칸, 둥근 끝). */
function Icon({ name, children }: { name: string; children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
      style={{ flex: 'none' }}
    >
      {children}
    </svg>
  );
}

/** 대시보드: 네 칸 판. */
const DashboardIcon = () => (
  <Icon name="dashboard">
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </Icon>
);

/** 신규 거래처 찾기: 공장 건물 + 돋보기. */
const FindIcon = () => (
  <Icon name="find">
    <path d="M3.5 20.5V11l4.5 2.7V11l4.5 2.7V7" />
    <path d="M3.5 20.5h8" />
    <circle cx="16.5" cy="15.5" r="3.5" />
    <path d="M19 18l2 2" />
  </Icon>
);

/** 관심 기업: 별. */
const StarIcon = () => (
  <Icon name="bookmarks">
    <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />
  </Icon>
);

/** 영업 분석: 막대 그래프. */
const AnalysisIcon = () => (
  <Icon name="sales-analysis">
    <path d="M4 20.5h16" />
    <rect x="5.5" y="11" width="3" height="6.5" rx="1" />
    <rect x="10.5" y="6.5" width="3" height="11" rx="1" />
    <rect x="15.5" y="13.5" width="3" height="4" rx="1" />
  </Icon>
);

/** 접기·펼치기: 왼쪽 칸이 있는 창 + 화살표. */
const PanelIcon = ({ collapsed }: { collapsed: boolean }) => (
  <Icon name={collapsed ? 'expand' : 'collapse'}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9 4.5v15" />
    <path d={collapsed ? 'M13 10l2 2-2 2' : 'M16 10l-2 2 2 2'} />
  </Icon>
);

const ITEMS = [
  {
    to: '/',
    end: true,
    icon: <DashboardIcon />,
    label: frame.menuDashboard,
    testId: 'nav-dashboard-link',
  },
  {
    to: LIST_PATH,
    end: false,
    icon: <FindIcon />,
    label: frame.menuOpportunities,
    testId: 'nav-opportunities-link',
  },
  {
    to: BOOKMARKS_PATH,
    end: false,
    icon: <StarIcon />,
    label: frame.menuBookmarks,
    testId: 'nav-bookmarks-link',
  },
  {
    to: '/sales-analysis',
    end: false,
    icon: <AnalysisIcon />,
    label: frame.menuSalesAnalysis,
    testId: 'nav-sales-analysis-link',
  },
];

/** 접은 상태에서만 보이는 이름표(손 올림·키보드 초점). 읽는 이름은 aria-label이 맡아 여기는 aria-hidden. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="side-nav-tip">
      {children}
    </span>
  );
}

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
  const rowStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 12,
    minHeight: 44,
    padding: collapsed ? 0 : '0 12px',
    borderRadius: 12,
    whiteSpace: 'nowrap',
    fontSize: typography.fontSize,
    textDecoration: 'none',
  } as const;
  return (
    <nav
      aria-label={frame.navLabel}
      data-testid="side-menu"
      data-collapsed={collapsed}
      className="no-print"
      style={{
        width: collapsed ? NARROW : WIDE,
        flexShrink: 0,
        background: sidebarTheme.bg,
        color: sidebarTheme.fg,
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        padding: '18px 12px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.18s ease',
        zIndex: 5,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          fontSize: 12,
          color: sidebarTheme.group,
          padding: '0 10px',
          marginBottom: 8,
          height: 18,
          letterSpacing: '0.04em',
          visibility: collapsed ? 'hidden' : 'visible',
        }}
      >
        {frame.navGroupSales}
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: 4,
          alignContent: 'start',
          flex: 1,
        }}
      >
        {ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              data-testid={item.testId}
              className="side-nav-link"
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              style={({ isActive }) => ({
                ...rowStyle,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? sidebarTheme.fgActive : sidebarTheme.fg,
                background: isActive ? sidebarTheme.activeBg : 'transparent',
                boxShadow: isActive ? `inset 0 0 0 1px ${sidebarTheme.activeBorder}` : 'none',
              })}
            >
              {/* 그림 자리: #770 숫자 꼬리표가 접힌 상태에서 그림 모서리에 얹힐 수 있게 기준 틀로 둔다. */}
              <span
                data-testid={`${item.testId}-icon`}
                style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}
              >
                {item.icon}
              </span>
              {collapsed ? <Tip>{item.label}</Tip> : <span>{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div style={{ borderTop: `1px solid ${sidebarTheme.divider}`, paddingTop: 12 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          title={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          data-testid="side-menu-toggle"
          className="side-nav-link"
          style={{
            ...rowStyle,
            width: '100%',
            border: 0,
            background: 'transparent',
            color: sidebarTheme.fg,
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <PanelIcon collapsed={collapsed} />
          {collapsed ? <Tip>{frame.sidebarExpand}</Tip> : <span>{frame.sidebarCollapse}</span>}
        </button>
      </div>
    </nav>
  );
}
