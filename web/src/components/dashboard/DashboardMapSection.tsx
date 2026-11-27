// 대시보드 지도 칸(#641): 지도 정보를 스스로 불러온다. 지도가 실패해도 대시보드 나머지는 그대로 보인다.
// #795: "방문 준비" 일정은 위에, 지도와 근처 업체 카드는 아래에 둔다.
// #921: 넓은 화면에서는 일정 목록(왼쪽)과 지도(오른쪽)를 나란히, 좁으면 위아래. 제목 앞에 작은 표시(badge)를 둘 수 있다.
// #925: 영업 홈은 방문 목록을 "오늘 할 일" 아래로 옮겨 aside 없이 쓴다 → 지도 | 같이 들를 곳이 나란히 놓인다.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getDashboardMap } from '../../api/dashboardMap';
import type { DashboardMap as DashboardMapData } from '../../api/dashboardMapTypes';
import FiveStates from '../common/FiveStates';
import DashboardMap from './DashboardMap';
import { dashboardMapTexts } from '../../labels/ko';
import { colors, radius, spacing, typography } from '../../theme/tokens';

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
  /** #921 제목 앞 작은 표시(예: "외근 전"). */
  badge?: ReactNode;
  /** #925 불러온 지도 정보를 부른 쪽에 알린다(다른 칸의 방문 목록이 같은 응답으로 거리를 그림). */
  onData?: (map: DashboardMapData | undefined) => void;
}

export default function DashboardMapSection({
  title,
  hint,
  aside,
  badge = null,
  onData,
}: DashboardMapSectionProps = {}) {
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
  const loaded = current?.data;
  useEffect(() => {
    onData?.(loaded);
  }, [loaded, onData]);
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
        borderRadius: radius.card,
        padding: spacing.cardPadding,
      }}
    >
      <h2 id="dashboard-map-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
        {badge}
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}>
        {aside && (
          <div data-testid="dashboard-map-aside" style={{ flex: '3 1 380px', minWidth: 0 }}>
            {aside(current?.data)}
          </div>
        )}
        <div style={{ flex: '2 1 320px', minWidth: 0 }}>{map}</div>
      </div>
    </section>
  );
}
