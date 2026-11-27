// 왼쪽 메뉴(#762, PM 결정 2026-11-16): 대시보드 · 신규 거래처 찾기 · 관심 기업 · 영업 분석.
// 맨 위 [메뉴 접기]로 접고 펼치며, 접으면 그림(아이콘)만 남는다(이름은 마우스를 올리거나 키보드로 오면 오른쪽 이름표로
// 뜨고, 화면 읽기 도구는 aria-label로 그대로 읽는다). 접은 상태는 브라우저에 기억하고, 좁은 기기는 처음부터 접힌 채로 연다.
// #767(PM 요청 2026-11-15·결정 2026-11-16): 참고 그림처럼 어두운 칸 + 내용에 맞는 선 그림 아이콘(이모지 대신, 글자는
// 한글·숫자만). 그림은 그림 파일 없이 SVG로 그린다. 색은 theme/tokens의 sidebarTheme만 쓴다.
// #770(PM 결정 2026-11-16): 새로 생긴 것 숫자 꼬리표. 펼치면 이름 뒤, 접으면 그림 오른쪽 위 모서리. 0이면 안 그린다.
// 영업 분석에는 숫자가 없다. 숫자를 못 읽으면 꼬리표 없이 메뉴만 보인다.
// #972(PM이 고른 보라 톤 시안 2026-11-27): 화면 맨 위부터 내려오는 흰 칸 + 오른쪽 얇은 테두리.
// 맨 위 로고 + 이름(머리 띠에 있던 것을 옮김) → 주 단추 [새 후보 발굴] → 묶음 "영업" · "분석" · "운영".
// 지금 화면 줄은 강조 연한 바탕 + 강조 글자 굵게, 숫자 꼬리표는 연보라 바탕 + 강조 글자(빨강 아님).
// 접으면 로고 · 접기 단추 · ＋ 그림 · 메뉴 그림만 남는다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { MenuBadges } from '../../api/menuBadges';
import { brand as defaultBrand } from '../../config/brand';
import { frame } from '../../labels/ko';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { colors, radius, sidebarTheme, typography } from '../../theme/tokens';
import { useFrame } from './FrameContext';
import { useMenuBadges } from './useMenuBadges';

export const SIDEBAR_STORAGE_KEY = 'geosan.sidebarCollapsed';
/** #803: 기업 상세에서만 따로 기억한다(기본 접힘 — 본문이 왼쪽 메뉴와 영업 코치 판 사이에 끼어 좁았다). */
export const SIDEBAR_DETAIL_STORAGE_KEY = 'geosan.sidebarCollapsed.detail';

/** 기업 상세 주소(/opportunities/:id). 보고서(/report)·목록은 아니다. */
export function isDetailPath(pathname: string): boolean {
  return /^\/opportunities\/[^/]+\/?$/.test(pathname);
}

function readDetailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_DETAIL_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}
const WIDE = 224;
const NARROW = 72;

/** [새 후보 발굴]이 가는 곳(#972): 거래처 후보 화면이 이 표시를 보고 새 후보 발굴 창을 연다. */
export const NEW_CANDIDATES_PATH = `${LIST_PATH}?newCandidates=1`;

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

/** 새 후보 발굴(#972): 더하기. */
const PlusIcon = () => (
  <Icon name="new-candidates">
    <path d="M12 5.5v13" />
    <path d="M5.5 12h13" />
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

interface MenuItem {
  to: string;
  end: boolean;
  icon: ReactNode;
  label: string;
  testId: string;
  badge: BadgeKey | null;
}

/** 묶음 "영업"(#972): 영업 홈 · 거래처 후보 · 관심 기업. */
const SALES_ITEMS: MenuItem[] = [
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
];

/** 묶음 "분석"(#972): 영업 분석. */
const ANALYSIS_ITEMS: MenuItem[] = [
  {
    to: '/sales-analysis',
    end: false,
    icon: <AnalysisIcon />,
    label: frame.menuSalesAnalysis,
    testId: 'nav-sales-analysis-link',
    badge: null,
  },
];

/** #799 운영 관리: 설정 operations.staffKeys에 든 담당자에게만 맨 아래 묶음 "운영"으로 보인다(권한은 서버가 판단). */
const OPERATIONS_ITEM: MenuItem = {
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
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        boxSizing: 'border-box',
        borderRadius: radius.tag,
        background: sidebarTheme.badgeBg,
        color: sidebarTheme.badgeFg,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: '20px',
        textAlign: 'center',
        ...(collapsed
          ? {
              position: 'absolute',
              top: -8,
              right: -12,
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

export default function SideMenu({
  narrowDevice,
  brand = defaultBrand,
}: {
  narrowDevice: boolean;
  /** 맨 위 로고·이름. 공통 틀이 서버 설정으로 덮은 값을 넘긴다. 없으면 화면에 실린 기본값. */
  brand?: { logoUrl: string | null; brandName: string };
}) {
  const [generalCollapsed, setGeneralCollapsed] = useState(() => readCollapsed(narrowDevice));
  const [detailCollapsed, setDetailCollapsed] = useState(readDetailCollapsed);
  const { pathname } = useLocation();
  const badges = useMenuBadges(pathname);
  const { config, staffKey } = useFrame();
  const operations = Boolean(staffKey && config?.operationsStaffKeys?.includes(staffKey));
  const groups = [
    { key: 'sales', label: frame.navGroupSales, items: SALES_ITEMS },
    { key: 'analysis', label: frame.navGroupAnalysis, items: ANALYSIS_ITEMS },
    ...(operations
      ? [{ key: 'operations', label: frame.navGroupOperations, items: [OPERATIONS_ITEM] }]
      : []),
  ];
  // #803: 기업 상세는 따로 기억하고 처음에는 접혀 있다. 다른 화면의 기억과 섞지 않는다.
  const onDetail = isDetailPath(pathname);
  const collapsed = onDetail ? detailCollapsed : generalCollapsed;
  const toggle = () => {
    const next = !collapsed;
    (onDetail ? setDetailCollapsed : setGeneralCollapsed)(next);
    try {
      window.localStorage.setItem(
        onDetail ? SIDEBAR_DETAIL_STORAGE_KEY : SIDEBAR_STORAGE_KEY,
        String(next),
      );
    } catch {
      // 저장소를 못 써도 이번 화면에서는 바뀐 상태가 유지된다.
    }
  };
  const rowStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: 10,
    minHeight: 44,
    padding: collapsed ? 0 : '0 12px',
    borderRadius: radius.control,
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
        borderRight: `1px solid ${sidebarTheme.border}`,
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        padding: collapsed ? '20px 12px' : '20px 14px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.18s ease',
        zIndex: 5,
      }}
    >
      {/* 맨 위 줄: 로고 + 이름 + [메뉴 접기]. 접으면 로고 아래에 접기 단추가 놓인다. */}
      <div
        style={{
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: collapsed ? 8 : 10,
          marginBottom: 14,
          paddingLeft: collapsed ? 0 : 6,
        }}
      >
        {brand.logoUrl ? (
          <img
            src={brand.logoUrl}
            // 펼치면 옆에 이름 글자가 있어 그림은 꾸밈이고, 접으면 이름이 없으므로 그림이 이름을 대신 읽힌다.
            alt={collapsed ? brand.brandName : ''}
            height={26}
            data-testid="brand-logo"
            style={{ display: 'block', flex: 'none' }}
          />
        ) : null}
        {collapsed ? null : (
          <span
            data-testid="brand-name"
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 600,
              fontSize: typography.fontSize,
              color: colors.text,
            }}
          >
            {brand.brandName}
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          title={collapsed ? frame.sidebarExpand : frame.sidebarCollapse}
          data-testid="side-menu-toggle"
          className="side-nav-link side-nav-row"
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
            width: 36,
            height: 36,
            padding: 0,
            border: 0,
            borderRadius: radius.control,
            color: sidebarTheme.group,
            cursor: 'pointer',
          }}
        >
          <PanelIcon collapsed={collapsed} />
          {collapsed ? <Tip>{frame.sidebarExpand}</Tip> : null}
        </button>
      </div>
      {/* 주 단추 [새 후보 발굴](#972): 거래처 후보 화면으로 가서 새 후보 발굴 창을 연다. 접으면 ＋ 그림만. */}
      <Link
        to={NEW_CANDIDATES_PATH}
        data-testid="nav-new-candidates"
        className="side-nav-link"
        aria-label={collapsed ? frame.menuNewCandidates : undefined}
        title={collapsed ? frame.menuNewCandidates : undefined}
        style={{
          ...rowStyle,
          justifyContent: 'center',
          gap: 6,
          padding: collapsed ? 0 : '0 12px',
          background: sidebarTheme.primaryBg,
          color: sidebarTheme.primaryFg,
          fontWeight: 500,
        }}
      >
        <PlusIcon />
        {collapsed ? <Tip>{frame.menuNewCandidates}</Tip> : <span>{frame.menuNewCandidates}</span>}
      </Link>
      <div style={{ flex: 1 }}>
        {groups.map((group) => (
          <div key={group.key}>
            {/* 묶음 이름. 접으면 글자 대신 얇은 줄로 묶음을 가른다. 읽는 이름은 목록의 aria-label이 맡는다. */}
            {collapsed ? (
              <div
                aria-hidden="true"
                style={{ height: 1, margin: '12px 8px', background: sidebarTheme.border }}
              />
            ) : (
              <div
                aria-hidden="true"
                style={{ fontSize: 12, color: sidebarTheme.group, padding: '18px 10px 6px' }}
              >
                {group.label}
              </div>
            )}
            <ul
              aria-label={group.label}
              data-testid={`side-menu-group-${group.key}`}
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}
            >
              {group.items.map((item) => {
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
                      className="side-nav-link side-nav-row"
                      aria-label={collapsed || meaning ? name : undefined}
                      title={collapsed ? name : undefined}
                      style={({ isActive }) => ({
                        ...rowStyle,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? sidebarTheme.fgActive : sidebarTheme.fg,
                        // 지금 화면 줄만 바탕을 칠한다. 나머지는 손을 올렸을 때 styles.css가 옅은 바탕을 준다.
                        ...(isActive
                          ? {
                              background: sidebarTheme.activeBg,
                              boxShadow: `inset 0 0 0 1px ${sidebarTheme.activeBorder}`,
                            }
                          : {}),
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
          </div>
        ))}
      </div>
    </nav>
  );
}
