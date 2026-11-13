// 대시보드 지도 아래 "같이 들를 곳"(#673, PM 요청 2026-11-13).
// 방문할 회사(진행 중·관심)마다 반경 안 후보를 묶어 보인다. 줄은 "단계 · 회사 이름 · 거산에서 ○km → 근처 N곳".
// 줄을 누르면 펼쳐지고 지도가 그 회사로 다가가 반경 원과 근처 회사(○)를 보인다(지도는 부모가 그린다).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  DashboardMapPoint,
  DashboardVisitGroup,
  DashboardMapGroup,
} from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface VisitGroupsProps {
  groups: DashboardVisitGroup[];
  points: DashboardMapPoint[];
  radiusKm: number;
  /** 펼친 묶음의 중심 회사 oppId. */
  open: string | null;
  onToggle: (oppId: string | null) => void;
  groupColors: Record<DashboardMapGroup, string>;
}

/** 펼친 묶음에 먼저 보이는 근처 회사 수. 산업단지는 5km 안에 수십 곳이라 나머지는 [더 보기]로 연다. */
export const NEARBY_FIRST = 10;

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function VisitGroups({
  groups,
  points,
  radiusKm,
  open,
  onToggle,
  groupColors,
}: VisitGroupsProps) {
  const [showAll, setShowAll] = useState<string | null>(null);
  const byOpp = new Map(points.map((point) => [point.oppId, point]));
  const rows = groups
    .map((group) => ({ group, anchor: byOpp.get(group.oppId) }))
    .filter((row): row is { group: DashboardVisitGroup; anchor: DashboardMapPoint } =>
      Boolean(row.anchor),
    );
  return (
    <section aria-labelledby="dashboard-visit-title" data-testid="dashboard-visit-groups">
      <h3 id="dashboard-visit-title" style={{ margin: '0 0 4px', fontSize: typography.fontSize }}>
        {t.visitTitle}
      </h3>
      <p style={{ ...secondary, margin: '0 0 8px' }}>{t.visitHint(radiusKm)}</p>
      {rows.length === 0 ? (
        <p data-testid="dashboard-visit-empty" style={{ ...secondary, margin: 0 }}>
          {t.visitEmpty}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {rows.map(({ group, anchor }) => {
            const expanded = open === group.oppId;
            return (
              <li key={group.oppId} data-testid="dashboard-visit-group">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onToggle(expanded ? null : group.oppId)}
                  data-testid="dashboard-visit-row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${expanded ? colors.text : colors.borderSecondary}`,
                    background: colors.bgContainer,
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <span aria-hidden="true">{expanded ? '▾' : '▸'} </span>
                  <strong style={{ color: groupColors[anchor.group] }}>
                    {t.groups[anchor.group]}
                  </strong>
                  {' · '}
                  {anchor.customerName}
                  {' · '}
                  <span style={secondary}>{t.distance(anchor.distanceKm)}</span>
                  {' → '}
                  <strong data-testid="dashboard-visit-count">
                    {t.visitNearbyCount(group.nearby.length)}
                  </strong>
                </button>
                {expanded ? (
                  group.nearby.length === 0 ? (
                    <p
                      data-testid="dashboard-visit-none"
                      style={{ ...secondary, margin: '6px 0 0 24px' }}
                    >
                      {t.visitNone}
                    </p>
                  ) : (
                    <ul
                      data-testid="dashboard-visit-nearby"
                      style={{ margin: '6px 0 0', paddingLeft: 24, display: 'grid', gap: 4 }}
                    >
                      {(showAll === group.oppId
                        ? group.nearby
                        : group.nearby.slice(0, NEARBY_FIRST)
                      ).map((row) => (
                        <li key={row.oppId} data-testid="dashboard-visit-nearby-item">
                          <Link to={`/opportunities/${encodeURIComponent(row.oppId)}`}>
                            {row.customerName}
                          </Link>{' '}
                          <span style={secondary}>
                            {t.visitNearbyDistance(row.distanceKm)} ·{' '}
                            {row.group ? t.groups[row.group] : t.candidate}
                          </span>
                        </li>
                      ))}
                      {showAll !== group.oppId && group.nearby.length > NEARBY_FIRST ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => setShowAll(group.oppId)}
                            data-testid="dashboard-visit-more"
                            style={{
                              background: 'none',
                              border: 0,
                              padding: 0,
                              color: colors.textSecondary,
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              font: 'inherit',
                            }}
                          >
                            {t.visitMore(group.nearby.length - NEARBY_FIRST)}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
