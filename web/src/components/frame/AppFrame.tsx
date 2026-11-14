// 공통 틀(mockups 2장): 건너뛰기 링크 → header(로고·브랜드명·메뉴·담당자 Select) → 알림 띠 → main(h1 + 본문).
// 설정(/config/ui)을 한 번 읽어 담당자 목록·brand로 화면 기본값을 덮어쓰고, 띠에 보일 값은 페이지가 setBannerMeta로 알린다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ConfigProvider, Select, Typography } from 'antd';
import { getConfigUi } from '../../api/client';
import type { ConfigUi, Meta } from '../../api/types';
import { brand as defaultBrand } from '../../config/brand';
import { frame } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import StatusBanner from './StatusBanner';
import {
  FrameContext,
  VIEWER_KEY,
  readStoredStaffKey,
  storeStaffKey,
  type FrameValue,
} from './FrameContext';

const NARROW_DEVICE_WIDTH = 1024;

/** 기기 폭(screen.width) 기준. 브라우저 확대로 줄어든 경우는 띄우지 않는다. 0은 "알 수 없음"으로 본다. */
function isNarrowDevice(): boolean {
  const width = window.screen?.width;
  return typeof width === 'number' && width > 0 && width < NARROW_DEVICE_WIDTH;
}

export interface AppFrameProps {
  /** 페이지의 h1 (페이지마다 하나). */
  title: string;
  children?: ReactNode;
}

export default function AppFrame({ title, children }: AppFrameProps) {
  const [config, setConfig] = useState<ConfigUi | null>(null);
  const [configMeta, setConfigMeta] = useState<Meta | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [pageMeta, setPageMeta] = useState<Meta | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [rawStaffKey, setRawStaffKey] = useState<string | null>(() => readStoredStaffKey());

  useEffect(() => {
    const controller = new AbortController();
    getConfigUi(controller.signal)
      .then((envelope) => {
        setConfig(envelope.data);
        setConfigMeta(envelope.meta);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigFailed(true);
      });
    return () => controller.abort();
  }, []);

  const staff = config?.staff ?? [];
  // 기억해 둔 키가 설정 목록에 없으면 고른 것으로 치지 않는다.
  const staffKey =
    rawStaffKey && staff.some((entry) => entry.key === rawStaffKey) ? rawStaffKey : null;

  const setStaffKey = useCallback((key: string | null) => {
    setRawStaffKey(key);
    storeStaffKey(key);
  }, []);

  const brand = config?.brand ?? defaultBrand;
  const bannerMeta = pageMeta ?? configMeta;

  const value = useMemo<FrameValue>(
    () => ({
      config,
      staffKey,
      setStaffKey,
      canRecord: staffKey !== null && staffKey !== VIEWER_KEY,
      setBannerMeta: setPageMeta,
      setPageTitle,
    }),
    [config, staffKey, setStaffKey],
  );

  return (
    <FrameContext.Provider value={value}>
      {/* Ant Design 기본 링크색·보조 글자색은 대비 4.5:1에 못 미쳐(axe), 토큰 값으로 맞춘다. */}
      <ConfigProvider
        theme={{
          token: { colorLink: brand.colorPrimary, colorTextDescription: colors.textSecondary },
        }}
      >
        <a href="#main" className="skip-link" data-testid="skip-link">
          {frame.skipToContent}
        </a>
        <header
          data-testid="app-header"
          style={{
            background: colors.bgContainer,
            borderBottom: `1px solid ${colors.borderSecondary}`,
            minHeight: spacing.headerHeight,
            padding: '0 24px',
          }}
        >
          <div
            style={{
              maxWidth: spacing.contentMaxWidth,
              margin: '0 auto',
              minHeight: spacing.headerHeight,
              display: 'flex',
              alignItems: 'center',
              gap: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {brand.logoUrl ? (
                <img src={brand.logoUrl} alt="" height={32} data-testid="brand-logo" />
              ) : null}
              <span
                data-testid="brand-name"
                style={{ fontWeight: 600, fontSize: typography.fontSize }}
              >
                {brand.brandName}
              </span>
            </div>
            <nav aria-label={frame.navLabel} style={{ flex: 1 }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 16 }}>
                <li>
                  <NavLink
                    to="/"
                    end
                    data-testid="nav-dashboard-link"
                    style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}
                  >
                    {frame.menuDashboard}
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/opportunities"
                    data-testid="nav-opportunities-link"
                    style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}
                  >
                    {frame.menuOpportunities}
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to="/sales-analysis"
                    data-testid="nav-sales-analysis-link"
                    style={({ isActive }) => ({ fontWeight: isActive ? 600 : 400 })}
                  >
                    {frame.menuSalesAnalysis}
                  </NavLink>
                </li>
              </ul>
            </nav>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="staff-select">{frame.staffSelectLabel}</label>
              <Select
                id="staff-select"
                data-testid="staff-select"
                style={{ minWidth: 160 }}
                placeholder={frame.staffPlaceholder}
                value={staffKey ?? undefined}
                onChange={(key: string) => setStaffKey(key)}
                options={staff.map((entry) => ({ value: entry.key, label: entry.displayName }))}
                disabled={staff.length === 0}
              />
            </div>
          </div>
          {configFailed ? (
            <Typography.Text type="danger" data-testid="staff-load-failed">
              {frame.staffLoadFailed}
            </Typography.Text>
          ) : null}
        </header>
        <StatusBanner
          hasVirtualData={bannerMeta?.hasVirtualData}
          datasetKind={bannerMeta?.datasetKind ?? config?.activeDatasetKind}
          demoLabel={brand.demoLabel}
          updatedAt={bannerMeta?.updatedAt}
          reevaluated={pageMeta?.reevaluated}
          narrowScreen={isNarrowDevice()}
        />
        <main
          id="main"
          tabIndex={-1}
          style={{ maxWidth: spacing.contentMaxWidth, margin: '0 auto', padding: '24px' }}
        >
          <Typography.Title level={1} style={{ fontSize: typography.fontSizeH1 }}>
            {pageTitle ?? title}
          </Typography.Title>
          {children}
        </main>
      </ConfigProvider>
    </FrameContext.Provider>
  );
}
