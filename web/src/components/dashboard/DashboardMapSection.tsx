// 대시보드 지도 칸(#641): 지도 정보를 스스로 불러온다. 지도가 실패해도 대시보드 나머지는 그대로 보인다.
import { useCallback, useEffect, useState } from 'react';
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

export default function DashboardMapSection() {
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
        {dashboardMapTexts.title}
      </h2>
      <FiveStates
        state={state}
        errorTitle={dashboardMapTexts.loadError}
        error={current?.error}
        onRetry={retry}
      >
        {current?.data ? <DashboardMap data={current.data} /> : null}
      </FiveStates>
    </section>
  );
}
