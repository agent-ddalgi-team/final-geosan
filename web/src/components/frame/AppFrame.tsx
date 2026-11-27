// 공통 틀(mockups 2장 → #972 시안): 건너뛰기 링크 → 왼쪽 메뉴(#762, 화면 맨 위부터. 로고·브랜드명이 여기 있다) +
// 오른쪽 칸[header(글자 크기·담당자) → 알림 띠 → main(h1 + 본문) + 영업 코치 칸].
// 설정(/config/ui)을 한 번 읽어 담당자 목록·brand로 화면 기본값을 덮어쓰고, 띠에 보일 값은 페이지가 setBannerMeta로 알린다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, ConfigProvider, Select, Typography } from 'antd';
import { getConfigUi } from '../../api/client';
import { logout } from '../../api/session';
import type { ConfigUi, Meta } from '../../api/types';
import { brand as defaultBrand } from '../../config/brand';
import { frame } from '../../labels/ko';
import { accent, colors, spacing, typography } from '../../theme/tokens';
import AssistantAsk from '../assistant/AssistantAsk';
import CoachDock from './CoachDock';
import FontScaleControl from './FontScaleControl';
import type { DockScreen } from './CoachDock';
import SideMenu from './SideMenu';
import StatusBanner from './StatusBanner';
import {
  FrameContext,
  VIEWER_KEY,
  readStoredStaffKey,
  storeStaffKey,
  type FrameValue,
} from './FrameContext';

const NARROW_DEVICE_WIDTH = 1024;
/** 위쪽 줄(글자 크기·담당자) 높이. 로고가 왼쪽 메뉴로 옮겨 가 조금 낮췄다(#972). */
const HEADER_HEIGHT = 56;

/** 기기 폭(screen.width) 기준. 브라우저 확대로 줄어든 경우는 띄우지 않는다. 0은 "알 수 없음"으로 본다. */
function isNarrowDevice(): boolean {
  const width = window.screen?.width;
  return typeof width === 'number' && width > 0 && width < NARROW_DEVICE_WIDTH;
}

export interface AppFrameProps {
  /** 페이지의 h1 (페이지마다 하나). */
  title: string;
  /** 본문이 제목과 화면 동작을 한 줄에 직접 배치할 때 사용한다. */
  ownHeading?: boolean;
  children?: ReactNode;
  /**
   * 오른쪽 "💬 영업 코치" 칸(#773). assistant = 여러 회사를 보는 질문 칸(대시보드·목록·관심 기업·영업 분석),
   * page = 페이지가 자기 내용을 넣는 빈 자리(기업 상세: 전달 사항·통화 전·기록 남기기). 없으면 칸이 없다.
   */
  dock?: 'assistant' | 'page' | null;
  /** 코치 칸의 화면 종류(#795): 화면마다 기본 펼침·접힘과 기억이 다르다. 없으면 기본 펼침. */
  dockScreen?: DockScreen;
}

export default function AppFrame({
  title,
  ownHeading = false,
  children,
  dock = null,
  dockScreen,
}: AppFrameProps) {
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
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
  // 계정 방식(#754)이면 로그인한 사람이 담당자다. 공용 방식이면 고른 담당자(기억해 둔 키가
  // 설정 목록에 없으면 고른 것으로 치지 않는다).
  const currentStaff = config?.currentStaff ?? null;
  const pickedKey =
    rawStaffKey && staff.some((entry) => entry.key === rawStaffKey) ? rawStaffKey : null;
  const staffKey = currentStaff ? currentStaff.key : pickedKey;

  const setStaffKey = useCallback((key: string | null) => {
    setRawStaffKey(key);
    storeStaffKey(key);
  }, []);

  // 서버 설정에 로고가 없으면(null) 화면에 실린 거산 로고를 쓴다(#898).
  const brand = config?.brand
    ? { ...config.brand, logoUrl: config.brand.logoUrl ?? defaultBrand.logoUrl }
    : defaultBrand;
  const narrowDevice = isNarrowDevice();
  const bannerMeta = pageMeta ?? configMeta;

  const value = useMemo<FrameValue>(
    () => ({
      config,
      staffKey,
      setStaffKey,
      canRecord: currentStaff
        ? currentStaff.canRecord
        : staffKey !== null && staffKey !== VIEWER_KEY,
      setBannerMeta: setPageMeta,
      setPageTitle,
      dockSlot: dock === 'page' ? dockSlot : null,
    }),
    [config, staffKey, setStaffKey, currentStaff, dock, dockSlot],
  );
  const dockBody =
    dock === 'assistant' ? (
      <AssistantAsk />
    ) : dock === 'page' ? (
      <div ref={setDockSlot} data-testid="coach-dock-slot" />
    ) : null;

  return (
    <FrameContext.Provider value={value}>
      {/* Ant Design 기본 링크색·보조 글자색은 대비 4.5:1에 못 미쳐(axe), 토큰 값으로 맞춘다.
          #972: 링크는 강조 글자색 + 밑줄(색만으로 구분하지 않게). 서버 설정 brand.colorPrimary는 링크색으로 쓰지 않는다. */}
      <ConfigProvider
        theme={{
          token: {
            colorLink: accent.text,
            colorLinkHover: accent.textHover,
            colorLinkActive: accent.textHover,
            linkDecoration: 'underline',
            colorTextDescription: colors.textSecondary,
          },
        }}
      >
        <a href="#main" className="skip-link" data-testid="skip-link">
          {frame.skipToContent}
        </a>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          {/* #972: 왼쪽 메뉴가 화면 맨 위부터 내려오고, 로고·브랜드명은 메뉴 맨 위에 한 번만 보인다. */}
          <SideMenu narrowDevice={narrowDevice} brand={brand} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <header
              data-testid="app-header"
              style={{
                background: colors.bgContainer,
                borderBottom: `1px solid ${colors.borderSecondary}`,
                minHeight: HEADER_HEIGHT,
                padding: '0 24px',
              }}
            >
              <div
                style={{
                  maxWidth: spacing.contentMaxWidth,
                  margin: '0 auto',
                  minHeight: HEADER_HEIGHT,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '8px 24px',
                }}
              >
                {/* #926 글자 크기 고르기: 담당자 칸 왼쪽. */}
                <FontScaleControl />
                {currentStaff ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span data-testid="current-staff">
                      {frame.currentStaff(currentStaff.displayName ?? currentStaff.key)}
                    </span>
                    <Button
                      size="small"
                      data-testid="logout-button"
                      onClick={() => {
                        void logout().finally(() => window.location.reload());
                      }}
                    >
                      {frame.logout}
                    </Button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label htmlFor="staff-select">{frame.staffSelectLabel}</label>
                    <Select
                      id="staff-select"
                      data-testid="staff-select"
                      style={{ minWidth: 160 }}
                      // 열린 목록은 가장 긴 이름에 맞춰 넓힌다(예: "보기 전용(대표·상무)", #910).
                      popupMatchSelectWidth={false}
                      placeholder={frame.staffPlaceholder}
                      value={staffKey ?? undefined}
                      onChange={(key: string) => setStaffKey(key)}
                      options={staff.map((entry) => ({
                        value: entry.key,
                        label: entry.displayName,
                      }))}
                      disabled={staff.length === 0}
                    />
                  </div>
                )}
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
              narrowScreen={narrowDevice}
            />
            <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
              <main
                id="main"
                tabIndex={-1}
                style={{
                  flex: 1,
                  minWidth: 0,
                  maxWidth: spacing.contentMaxWidth,
                  margin: '0 auto',
                  padding: '24px',
                }}
              >
                {!ownHeading ? (
                  <Typography.Title level={1} style={{ fontSize: typography.fontSizeH1 }}>
                    {pageTitle ?? title}
                  </Typography.Title>
                ) : null}
                {children}
                {dockBody && narrowDevice ? (
                  <CoachDock narrowDevice screen={dockScreen}>
                    {dockBody}
                  </CoachDock>
                ) : null}
              </main>
              {dockBody && !narrowDevice ? (
                <CoachDock key={dockScreen ?? 'DETAIL'} narrowDevice={false} screen={dockScreen}>
                  {dockBody}
                </CoachDock>
              ) : null}
            </div>
          </div>
        </div>
      </ConfigProvider>
    </FrameContext.Provider>
  );
}
