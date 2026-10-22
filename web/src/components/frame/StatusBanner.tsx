// 알림 띠(BR10.4, interaction-spec 2.16). 닫기 없음, role="status", 한 줄에 점(·)으로 이어 표시한다.
// 내부용은 항상, 나머지는 조건부. 색은 6가지 조합만 쓰고 글자가 항상 함께 있다.
import type { ReactNode } from 'react';
import StatusTag from '../common/StatusTag';
import { banner } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import type { DatasetKind } from '../../api/types';
import { formatMonthDayTime } from '../../utils/time';

export interface StatusBannerProps {
  hasVirtualData?: boolean | null;
  datasetKind?: DatasetKind | null;
  /** 앱 설정 brand.demoLabel (예: "부분 시연·거산 확인 전"). */
  demoLabel?: string | null;
  updatedAt?: string | null;
  /** 해당 상세에서 재평가된 경우(10초 표시는 호출하는 쪽이 정한다). */
  reevaluated?: boolean | null;
  /** 기기 폭 1024px 미만(브라우저 확대로 줄어든 경우는 제외, 호출하는 쪽이 판단). */
  narrowScreen?: boolean;
}

export default function StatusBanner({
  hasVirtualData,
  datasetKind,
  demoLabel,
  updatedAt,
  reevaluated,
  narrowScreen,
}: StatusBannerProps) {
  const updated = formatMonthDayTime(updatedAt);
  const items: ReactNode[] = [
    <StatusTag key="internal" tone="neutral" data-testid="banner-internal-only">
      {banner.internalOnly}
    </StatusTag>,
  ];
  if (hasVirtualData) {
    items.push(
      <StatusTag key="virtual" tone="wait" data-testid="banner-virtual-data">
        {banner.virtualData}
      </StatusTag>,
    );
  }
  if (datasetKind === 'BROCHURE') {
    items.push(
      <StatusTag key="brochure" tone="ask" data-testid="banner-brochure">
        {banner.brochure}
      </StatusTag>,
    );
  }
  if (demoLabel) {
    items.push(
      <StatusTag key="demo" tone="ask" data-testid="banner-demo-label">
        {demoLabel}
      </StatusTag>,
    );
  }
  if (reevaluated) {
    items.push(
      <StatusTag key="reevaluated" tone="ok" data-testid="banner-reevaluated">
        {banner.reevaluated}
      </StatusTag>,
    );
  }
  if (narrowScreen) {
    items.push(
      <StatusTag key="narrow" tone="neutral" data-testid="banner-narrow-screen">
        {banner.narrowScreen}
      </StatusTag>,
    );
  }
  if (updated) {
    items.push(
      <span
        key="updated"
        data-testid="banner-updated-at"
        style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
      >
        {banner.updatedAtPrefix} {updated}
      </span>,
    );
  }

  return (
    <div
      role="status"
      data-testid="status-banner"
      style={{
        background: colors.bgContainer,
        borderBottom: `1px solid ${colors.borderSecondary}`,
        padding: `8px 24px`,
      }}
    >
      <div
        style={{
          maxWidth: spacing.contentMaxWidth,
          margin: '0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {items.map((item, index) => (
          <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {index > 0 ? (
              <span aria-hidden="true" style={{ color: colors.textSecondary }}>
                ·
              </span>
            ) : null}
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
