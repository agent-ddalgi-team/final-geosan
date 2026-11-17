// 대시보드 지도 칸(#641): 지도 정보를 스스로 불러온다. 지도가 실패해도 대시보드 나머지는 그대로 보인다.
// #795: 대시보드는 이 칸을 "방문 준비" 구역으로 쓴다. aside(왼쪽 목록)는 같은 지도 응답을 받아 거리 줄을 그리고,
// 지도를 못 불러와도(응답 없음) 목록은 그대로 보인다. 넓으면 목록 | 지도, 좁으면 위아래.
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
  /** 지도 왼쪽(좁으면 위)에 놓을 것. 지도 응답(못 받았으면 undefined)을 받는다(#795). */
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
      {current?.data ? <DashboardMap data={current.data} /> : null}
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
      {aside ? (
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}
        >
          <div data-testid="dashboard-map-aside" style={{ flex: '1 1 320px', minWidth: 0 }}>
            {aside(current?.data)}
          </div>
          <div style={{ flex: '2 1 420px', minWidth: 0 }}>{map}</div>
        </div>
      ) : (
        map
      )}
    </section>
  );
}
