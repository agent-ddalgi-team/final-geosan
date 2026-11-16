// 왼쪽 메뉴(#762, PM 결정 2026-11-16): 대시보드 · 신규 거래처 찾기 · 관심 기업 · 영업 분석.
// 맨 위 [메뉴 접기]로 접고 펼치며, 접으면 그림(아이콘)만 남는다(이름은 마우스를 올리거나 키보드로 오면 오른쪽 이름표로
// 뜨고, 화면 읽기 도구는 aria-label로 그대로 읽는다). 접은 상태는 브라우저에 기억하고, 좁은 기기는 처음부터 접힌 채로 연다.
// #767(PM 요청 2026-11-15·결정 2026-11-16): 참고 그림처럼 어두운 칸 + 내용에 맞는 선 그림 아이콘(이모지 대신, 글자는
// 한글·숫자만). 그림은 그림 파일 없이 SVG로 그린다. 색은 theme/tokens의 sidebarTheme만 쓴다.
// #770(PM 결정 2026-11-16): 새로 생긴 것 숫자 꼬리표. 펼치면 이름 뒤, 접으면 그림 오른쪽 위 모서리. 0이면 안 그린다.
// 영업 분석에는 숫자가 없다. 숫자를 못 읽으면 꼬리표 없이 메뉴만 보인다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { MenuBadges } from '../../api/menuBadges';
import { frame } from '../../labels/ko';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { sidebarTheme, typography } from '../../theme/tokens';
import { useFrame } from './FrameContext';
import { useMenuBadges } from './useMenuBadges';

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

/** 운영 관리(#799): 계기판 바늘(사용량·자료 상태를 보는 곳). */
const OperationsIcon = () => (
  <Icon name="operations">
    <path d="M4.5 16.5a7.5 7.5 0 1 1 15 0" />
    <path d="M12 16.5l3.5-4" />
    <circle cx="12" cy="16.5" r="1.2" />
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

type BadgeKey = keyof MenuBadges;

const ITEMS: {
  to: string;
  end: boolean;
  icon: ReactNode;
  label: string;
  testId: string;
  badge: BadgeKey | null;
}[] = [
  {
    to: '/',
    end: true,
    icon: <DashboardIcon />,
    label: frame.menuDashboard,
    testId: 'nav-dashboard-link',
    badge: 'dashboard',
  },
  {
    to: LIST_PATH,
    end: false,
    icon: <FindIcon />,
    label: frame.menuOpportunities,
    testId: 'nav-opportunities-link',
    badge: 'list',
  },
  {
    to: BOOKMARKS_PATH,
    end: false,
    icon: <StarIcon />,
    label: frame.menuBookmarks,
    testId: 'nav-bookmarks-link',
    badge: 'bookmarks',
  },
  {
    to: '/sales-analysis',
    end: false,
    icon: <AnalysisIcon />,
    label: frame.menuSalesAnalysis,
    testId: 'nav-sales-analysis-link',
    badge: null,
  },
];

/** #799 운영 관리: 설정 operations.staffKeys에 든 담당자에게만 맨 아래에 보인다(권한은 서버가 판단). */
const OPERATIONS_ITEM: (typeof ITEMS)[number] = {
  to: '/operations',
  end: false,
  icon: <OperationsIcon />,
  label: frame.menuOperations,
  testId: 'nav-operations-link',
  badge: null,
};

/**
 * 숫자 꼬리표(#770). 99를 넘으면 "99+". 뜻("새 후보 12곳")은 손을 올리면(title) 보이고,
 * 화면 읽기 도구는 링크 이름(aria-label)으로 읽으므로 꼬리표 자체는 aria-hidden.
 */
function Badge({
  count,
  meaning,
  collapsed,
  testId,
}: {
  count: number;
  meaning: string;
  collapsed: boolean;
  testId: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      title={meaning}
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        boxSizing: 'border-box',
        borderRadius: 9,
        background: sidebarTheme.badgeBg,
        color: sidebarTheme.badgeFg,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: '18px',
        textAlign: 'center',
        ...(collapsed
          ? {
              position: 'absolute',
              top: -7,
              right: -10,
              boxShadow: `0 0 0 2px ${sidebarTheme.bg}`,
            }
          : { marginLeft: 'auto' }),
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

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
  const { pathname } = useLocation();
  const badges = useMenuBadges(pathname);
  const { config, staffKey } = useFrame();
  const operations = Boolean(staffKey && config?.operationsStaffKeys?.includes(staffKey));
  const items = operations ? [...ITEMS, OPERATIONS_ITEM] : ITEMS;
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
      {/* 맨 위 줄: 묶음 이름 + [메뉴 접기]. 메뉴 칸이 머리 띠 아래에서 시작해 아래쪽 단추는 첫 화면에서 가려지므로 위에 둔다. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          marginBottom: 8,
          paddingLeft: collapsed ? 0 : 10,
        }}
      >
        {collapsed ? null : (
          <span
            aria-hidden="true"
            style={{ fontSize: 12, color: sidebarTheme.group, letterSpacing: '0.04em' }}
          >
            {frame.navGroupSales}
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          title={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          data-testid="side-menu-toggle"
          className="side-nav-link"
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            padding: 0,
            border: 0,
            borderRadius: 10,
            background: 'transparent',
            color: sidebarTheme.fg,
            cursor: 'pointer',
          }}
        >
          <PanelIcon collapsed={collapsed} />
          {collapsed ? <Tip>{frame.sidebarExpand}</Tip> : null}
        </button>
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
        {items.map((item) => {
          const count = item.badge && badges ? badges[item.badge] : 0;
          const meaning = item.badge && count > 0 ? frame.menuBadge[item.badge](count) : null;
          const name = meaning ? `${item.label}, ${meaning}` : item.label;
          const badge = meaning ? (
            <Badge
              count={count}
              meaning={meaning}
              collapsed={collapsed}
              testId={`${item.testId}-badge`}
            />
          ) : null;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                data-testid={item.testId}
                className="side-nav-link"
                aria-label={collapsed || meaning ? name : undefined}
                title={collapsed ? name : undefined}
                style={({ isActive }) => ({
                  ...rowStyle,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? sidebarTheme.fgActive : sidebarTheme.fg,
                  background: isActive ? sidebarTheme.activeBg : 'transparent',
                  boxShadow: isActive ? `inset 0 0 0 1px ${sidebarTheme.activeBorder}` : 'none',
                })}
              >
                {/* 그림 자리: #770 숫자 꼬리표가 접힌 상태에서 그림 모서리에 얹힌다. */}
                <span
                  data-testid={`${item.testId}-icon`}
                  style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}
                >
                  {item.icon}
                  {collapsed ? badge : null}
                </span>
                {collapsed ? <Tip>{name}</Tip> : <span>{item.label}</span>}
                {collapsed ? null : badge}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
