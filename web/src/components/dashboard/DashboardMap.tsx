// 대시보드 지도(#641): 거산 본사 가운데 30/50/100km 원과 관심·진행 중·올해 성공 점, 범례, 말풍선.
// 지도 배경(#671): 화면용 키(VITE_NCP_MAPS_CLIENT_ID)가 있으면 네이버 지도 위에 원·점을 그린다(NaverMapCanvas).
// 키가 없거나 불러오지 못하면 자리표시로 원·점의 상대 위치만 좌표로 계산해 그린다.
// 약속(계약 C4 screenMapRule): 회사 이름·단계·거리·메모는 지도 SDK에 넘기지 않고 이 부품의 HTML 말풍선으로만 그린다.
// 지도 업체의 검색·길찾기 기능은 부르지 않는다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  DashboardMap as DashboardMapData,
  DashboardMapGroup,
} from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import NaverMapCanvas, { loadNaverMaps, onNaverMapsFailure } from './NaverMapCanvas';
import VisitGroups from './VisitGroups';
import type { NaverMapsApi } from './NaverMapCanvas';
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

const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

export default function DashboardMap({
  data,
  mapClientId = import.meta.env.VITE_NCP_MAPS_CLIENT_ID,
}: {
  data: DashboardMapData;
  /** 네이버 지도 화면용 키(비밀 아님, 콘솔 허용 URL로 보호). 없으면 자리표시로 그린다. */
  mapClientId?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [naver, setNaver] = useState<NaverMapsApi | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  // "같이 들를 곳"(#673)에서 펼친 묶음의 중심 회사.
  const [visitOpen, setVisitOpen] = useState<string | null>(null);
  const visitGroups = data.visitGroups;
  const visitRadius = data.visitRadiusKm;
  const focus = useMemo(() => {
    const group = visitGroups?.find((row) => row.oppId === visitOpen);
    const anchor = data.points.find((point) => point.oppId === visitOpen);
    if (!group || !anchor || visitRadius === undefined) return null;
    return {
      center: { lat: anchor.lat, lng: anchor.lng },
      radiusKm: visitRadius,
      nearby: group.nearby.map((row) => ({ oppId: row.oppId, lat: row.lat, lng: row.lng })),
    };
  }, [visitGroups, visitOpen, visitRadius, data.points]);
  const wantsMap = Boolean(mapClientId) && data.points.length > 0;

  useEffect(() => {
    if (!wantsMap || !mapClientId) return;
    let alive = true;
    loadNaverMaps(mapClientId)
      .then((api) => {
        if (alive) setNaver(api);
      })
      .catch(() => {
        // 키 인증 실패·네트워크 실패: 숨기지 않고 자리표시와 안내 문구로 돌아간다.
        if (alive) setMapFailed(true);
      });
    // 다 불러온 뒤에 오는 키 인증 실패도 자리표시로 돌린다.
    const stop = onNaverMapsFailure(() => {
      if (alive) setMapFailed(true);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [wantsMap, mapClientId]);

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
  // 지도 대상이 아닌 근처 후보(○)를 눌렀을 때: 펼친 "같이 들를 곳" 묶음에서 찾는다(#673).
  const openGroup = visitGroups?.find((row) => row.oppId === visitOpen) ?? null;
  const openAnchor = data.points.find((p) => p.oppId === visitOpen) ?? null;
  const chosenNearby =
    chosen === null ? (openGroup?.nearby.find((row) => row.oppId === selected) ?? null) : null;
  const labelFor = (oppId: string) =>
    data.points.find((p) => p.oppId === oppId)?.customerName ??
    openGroup?.nearby.find((row) => row.oppId === oppId)?.customerName ??
    null;

  return (
    <div data-testid="dashboard-map" style={{ display: 'grid', gap: 12 }}>
      {naver && !mapFailed ? (
        <>
          <NaverMapCanvas
            api={naver}
            center={data.center}
            ringsKm={data.ringsKm}
            points={data.points}
            colors={GROUP_COLOR}
            ringColor={colors.textSecondary}
            hqColor={colors.text}
            onSelect={setSelected}
            focus={focus}
            labelFor={labelFor}
          />
          {/* 지도 점은 키보드로 고를 수 없어 낭독기용 단추 목록을 함께 둔다. */}
          <ul aria-label={t.pointList} data-testid="dashboard-map-point-list" style={srOnly}>
            {data.points.map((p) => (
              <li key={p.oppId}>
                <button type="button" onClick={() => setSelected(p.oppId)}>
                  {t.pointAria(p.customerName, t.groups[p.group], p.distanceKm)}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p
            data-testid="dashboard-map-placeholder"
            style={{ margin: 0, color: colors.textSecondary }}
          >
            {mapFailed ? t.mapFailed : wantsMap ? t.mapLoading : t.placeholder}
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
                  {/* 마우스를 올리면 회사 이름이 뜬다(#673). */}
                  <title>{p.customerName}</title>
                </g>
              );
            })}
          </svg>
        </>
      )}

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

      {chosen || chosenNearby ? (
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
          {chosen ? (
            <>
              <strong>{chosen.customerName}</strong>
              <span>
                {t.groups[chosen.group]} · {t.distance(chosen.distanceKm)}
              </span>
            </>
          ) : chosenNearby ? (
            <>
              <strong>{chosenNearby.customerName}</strong>
              <span>
                {chosenNearby.group ? t.groups[chosenNearby.group] : t.candidate} ·{' '}
                {t.fromAnchor(openAnchor?.customerName ?? '', chosenNearby.distanceKm)}
              </span>
            </>
          ) : null}
          <div style={{ display: 'flex', gap: 12 }}>
            <Link
              to={`/opportunities/${encodeURIComponent((chosen ?? chosenNearby)!.oppId)}`}
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

      {visitGroups && visitRadius !== undefined ? (
        <VisitGroups
          groups={visitGroups}
          points={data.points}
          radiusKm={visitRadius}
          open={visitOpen}
          onToggle={setVisitOpen}
          groupColors={GROUP_COLOR}
        />
      ) : null}
    </div>
  );
}

const missingStyle = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;
