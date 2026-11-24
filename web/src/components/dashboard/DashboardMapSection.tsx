// 대시보드 지도 칸(#641): 지도 정보를 스스로 불러온다. 지도가 실패해도 대시보드 나머지는 그대로 보인다.
// #795: "방문 준비" 일정은 위에, 지도와 근처 업체 카드는 아래에 둔다.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getDashboardMap } from '../../api/dashboardMap';
import type { DashboardMap as DashboardMapData } from '../../api/dashboardMapTypes';
import FiveStates from '../common/FiveStates';
import DashboardMap from './DashboardMap';
import { dashboardMapTexts } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

interface Result {
  key: number;
  data?: DashboardMapData;
  error?: unknown;
}

export interface DashboardMapSectionProps {
  /** 구역 제목. 없으면 "거산 주변 지도". */
  title?: string;
  /** 제목 옆 작은 풀이(#795). */
  hint?: string;
  /** 지도 위 일정 목록. 지도 응답이 있는 경우 회사별 거리도 표시한다. */
  aside?: (map: DashboardMapData | undefined) => ReactNode;
}

export default function DashboardMapSection({ title, hint, aside }: DashboardMapSectionProps = {}) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getDashboardMap(controller.signal)
      .then((envelope) => {
        if (!controller.signal.aborted) setResult({ key: reload, data: envelope.data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: reload, error });
      });
    return () => controller.abort();
  }, [reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const current = result?.key === reload ? result : null;
  let state: 'loading' | 'error' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';

  const map = (
    <FiveStates
      state={state}
      errorTitle={dashboardMapTexts.loadError}
      error={current?.error}
      onRetry={retry}
    >
      {current?.data ? <DashboardMap data={current.data} compact /> : null}
    </FiveStates>
  );

  return (
    <section
      aria-labelledby="dashboard-map-title"
      data-testid="dashboard-map-section"
      style={{
        display: 'grid',
        gap: 12,
        boxSizing: 'border-box',
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 12,
        padding: spacing.cardPadding,
      }}
    >
      <h2 id="dashboard-map-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
        {title ?? dashboardMapTexts.title}
        {hint ? (
          <small
            style={{
              marginLeft: 8,
              color: colors.textSecondary,
              fontSize: typography.fontSizeSecondary,
              fontWeight: 400,
            }}
          >
            {hint}
          </small>
        ) : null}
      </h2>
      {aside && (
        <div data-testid="dashboard-map-aside" style={{ minWidth: 0 }}>
          {aside(current?.data)}
        </div>
      )}
      {map}
    </section>
  );
}
