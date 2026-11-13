// 대시보드 지도(#641): 거산 본사 가운데 30/50/100km 원과 관심·진행 중·올해 성공 점, 범례, 말풍선.
// 지도 배경(네이버클라우드 지도)은 클라이언트 ID가 오기 전이라 자리표시만 둔다. 원·점은 좌표로 계산해 그린다.
// 약속(계약 C4 screenMapRule): 회사 이름·단계·거리·메모는 지도 SDK에 넘기지 않고 이 부품의 HTML 말풍선으로만 그린다.
// 지도 업체의 검색·길찾기 기능은 부르지 않는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  DashboardMap as DashboardMapData,
  DashboardMapGroup,
} from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import { colors, spacing, statusPalette, typography } from '../../theme/tokens';

const VIEW = 400;
const CENTER = VIEW / 2;
const MAX_RADIUS = 180;

const GROUP_ORDER: DashboardMapGroup[] = ['INTERESTED', 'IN_PROGRESS', 'WON_THIS_YEAR'];
const GROUP_COLOR: Record<DashboardMapGroup, string> = {
  INTERESTED: statusPalette.ask.fg,
  IN_PROGRESS: statusPalette.wait.fg,
  WON_THIS_YEAR: statusPalette.ok.fg,
};

/** 거산 본사 기준 동서·남북 거리(km)로 바꾼다(가까운 거리라 평면 근사로 충분하다). */
export function offsetKm(
  center: { lat: number; lng: number },
  point: { lat: number; lng: number },
): { x: number; y: number } {
  const x = (point.lng - center.lng) * 111.32 * Math.cos((center.lat * Math.PI) / 180);
  const y = (point.lat - center.lat) * 110.57;
  return { x, y };
}

function Shape({ group, x, y }: { group: DashboardMapGroup; x: number; y: number }) {
  const fill = GROUP_COLOR[group];
  if (group === 'IN_PROGRESS') {
    // ◆
    return (
      <polygon
        points={`${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}`}
        fill={fill}
        stroke="#fff"
        strokeWidth={1.5}
      />
    );
  }
  if (group === 'WON_THIS_YEAR') {
    // ★
    const pts = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 === 0 ? 11 : 4.6;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} fill={fill} stroke="#fff" strokeWidth={1.2} />;
  }
  // ●
  return <circle cx={x} cy={y} r={8} fill={fill} stroke="#fff" strokeWidth={1.5} />;
}

const GLYPH: Record<DashboardMapGroup, string> = {
  INTERESTED: '●',
  IN_PROGRESS: '◆',
  WON_THIS_YEAR: '★',
};

export default function DashboardMap({ data }: { data: DashboardMapData }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (data.points.length === 0) {
    return (
      <div data-testid="dashboard-map-empty" style={{ display: 'grid', gap: 8 }}>
        <p style={{ margin: 0, color: colors.textSecondary }}>{t.emptyText}</p>
        <div>
          <Link to="/opportunities" data-testid="dashboard-map-empty-link">
            {t.emptyAction}
          </Link>
        </div>
        {data.missingCoordinates > 0 ? (
          <p data-testid="dashboard-map-missing" style={missingStyle}>
            {t.missingCoordinates(data.missingCoordinates)}
          </p>
        ) : null}
      </div>
    );
  }

  const rings = [...data.ringsKm].sort((a, b) => a - b);
  const maxKm = rings[rings.length - 1] ?? 100;
  const scale = MAX_RADIUS / maxKm;
  const chosen = data.points.find((p) => p.oppId === selected) ?? null;

  return (
    <div data-testid="dashboard-map" style={{ display: 'grid', gap: 12 }}>
      <p data-testid="dashboard-map-placeholder" style={{ margin: 0, color: colors.textSecondary }}>
        {t.placeholder}
      </p>
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="group"
        aria-label={t.title}
        style={{
          width: '100%',
          maxWidth: 480,
          justifySelf: 'center',
          background: statusPalette.neutral.bg,
          borderRadius: 12,
        }}
      >
        {[...rings].reverse().map((km) => (
          <g key={km} data-testid="dashboard-map-ring">
            <circle
              cx={CENTER}
              cy={CENTER}
              r={km * scale}
              fill="none"
              stroke={colors.border}
              strokeDasharray="4 4"
            />
            <text
              x={CENTER}
              y={CENTER - km * scale - 4}
              textAnchor="middle"
              fontSize={12}
              fill={colors.textSecondary}
            >
              {t.ringLabel(km)}
            </text>
          </g>
        ))}
        <g data-testid="dashboard-map-hq">
          <rect x={CENTER - 8} y={CENTER - 8} width={16} height={16} fill={colors.text} />
          <text x={CENTER} y={CENTER + 24} textAnchor="middle" fontSize={12} fill={colors.text}>
            {t.hqLabel}
          </text>
        </g>
        {data.points.map((p) => {
          const off = offsetKm(data.center, p);
          const dist = Math.hypot(off.x, off.y) || 1;
          // 가장 큰 원 밖에 있는 점은 가장자리에 붙여 그린다.
          const k = Math.min(1, maxKm / dist) * scale;
          const x = CENTER + off.x * k;
          const y = CENTER - off.y * k;
          const groupName = t.groups[p.group];
          return (
            <g
              key={p.oppId}
              data-testid="dashboard-map-point"
              data-group={p.group}
              role="button"
              tabIndex={0}
              aria-label={t.pointAria(p.customerName, groupName, p.distanceKm)}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelected(p.oppId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelected(p.oppId);
                }
              }}
            >
              <circle cx={x} cy={y} r={16} fill="transparent" />
              <Shape group={p.group} x={x} y={y} />
            </g>
          );
        })}
      </svg>

      <ul
        data-testid="dashboard-map-legend"
        aria-label={t.legendTitle}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {GROUP_ORDER.map((group) => (
          <li key={group} data-testid="dashboard-map-legend-item">
            <span aria-hidden="true" style={{ color: GROUP_COLOR[group], marginRight: 4 }}>
              {GLYPH[group]}
            </span>
            {t.groups[group]} {data.points.filter((p) => p.group === group).length}곳
          </li>
        ))}
      </ul>

      {chosen ? (
        <div
          role="dialog"
          aria-label={t.callout}
          data-testid="dashboard-map-callout"
          style={{
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: 8,
            padding: spacing.cardGap,
            display: 'grid',
            gap: 4,
            background: colors.bgContainer,
          }}
        >
          <strong>{chosen.customerName}</strong>
          <span>
            {t.groups[chosen.group]} · {t.distance(chosen.distanceKm)}
          </span>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link
              to={`/opportunities/${encodeURIComponent(chosen.oppId)}`}
              data-testid="dashboard-map-detail-link"
            >
              {t.detailLink}
            </Link>
            <button
              type="button"
              data-testid="dashboard-map-callout-close"
              onClick={() => setSelected(null)}
              style={{
                background: 'none',
                border: 0,
                color: colors.textSecondary,
                cursor: 'pointer',
              }}
            >
              {t.close}
            </button>
          </div>
        </div>
      ) : null}

      {data.missingCoordinates > 0 ? (
        <p data-testid="dashboard-map-missing" style={missingStyle}>
          {t.missingCoordinates(data.missingCoordinates)}
        </p>
      ) : null}
    </div>
  );
}

const missingStyle = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;
