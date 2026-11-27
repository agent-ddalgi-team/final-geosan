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
  DashboardMapPoint,
} from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import NaverMapCanvas, {
  DASHBOARD_MAP_HEIGHT,
  loadNaverMaps,
  onNaverMapsFailure,
} from './NaverMapCanvas';
import VisitGroups from './VisitGroups';
import VisitMapCards, { MapClusterCards } from './VisitMapCards';
import type { NaverMapsApi } from './NaverMapCanvas';
import {
  colors,
  mapPinPalette,
  mapPinStroke,
  radius,
  spacing,
  statusPalette,
  typography,
} from '../../theme/tokens';
import { MapPinIcon, MapPinMark } from '../common/MapPin';
import { spreadPins } from '../common/spreadPins';

const VIEW = 400;
const CENTER = VIEW / 2;
const MAX_RADIUS = 180;
// #898(PM 2026-11-23 "점 색으로만, 선은 안 보이게"): 그림 단위(400칸 기준) 점 지름과, 떨어뜨린 점 가운데 사이 거리.
const SVG_PIN_SIZE = 11;
const SVG_HQ_SIZE = 20;
const SVG_PIN_GAP = 13;

const GROUP_ORDER: DashboardMapGroup[] = ['INTERESTED', 'IN_PROGRESS', 'WON_THIS_YEAR'];
/** 흰 바탕 글자용 묶음 색(#898 핀 색과 같은 계열, 대비 4.5:1 이상). "같이 들를 곳" 줄의 묶음 이름에 쓴다. */
const GROUP_TEXT_COLOR: Record<DashboardMapGroup, string> = {
  INTERESTED: mapPinPalette.INTERESTED.text,
  IN_PROGRESS: mapPinPalette.IN_PROGRESS.text,
  WON_THIS_YEAR: mapPinPalette.WON_THIS_YEAR.text,
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
  compact = false,
}: {
  data: DashboardMapData;
  /** 네이버 지도 화면용 키(비밀 아님, 콘솔 허용 URL로 보호). 없으면 자리표시로 그린다. */
  mapClientId?: string;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [cluster, setCluster] = useState<DashboardMapPoint[] | null>(null);
  const [naver, setNaver] = useState<NaverMapsApi | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [visitBase, setVisitBase] = useState<string | null>(null);
  // "같이 들를 곳"(#673)에서 펼친 묶음의 중심 회사.
  const [visitOpen, setVisitOpen] = useState<string | null>(null);
  const visitGroups = data.visitGroups;
  const visitRadius = data.visitRadiusKm;
  const visitOptions = useMemo(() => {
    const anchors = new Map(data.points.map((point) => [point.oppId, point]));
    return (visitGroups ?? []).flatMap((group) => {
      const anchor = anchors.get(group.oppId);
      return anchor ? [{ group, anchor }] : [];
    });
  }, [data.points, visitGroups]);
  const visitSelection =
    visitOptions.find(({ anchor }) => anchor.oppId === visitBase) ?? visitOptions[0];
  const focus = useMemo(() => {
    const group = visitGroups?.find((row) => row.oppId === visitOpen);
    const anchor = data.points.find((point) => point.oppId === visitOpen);
    if (!group || !anchor || visitRadius === undefined) return null;
    return {
      center: { lat: anchor.lat, lng: anchor.lng },
      // 넓힌 묶음(#743)은 그 반경으로 원을 그린다. 옛 응답은 기본 반경.
      radiusKm: group.radiusKm ?? visitRadius,
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
  // 그림 단위 위치. 가장 큰 원 밖에 있는 점은 가장자리에 붙여 그린다.
  const truePos = data.points.map((p) => {
    const off = offsetKm(data.center, p);
    const dist = Math.hypot(off.x, off.y) || 1;
    const k = Math.min(1, maxKm / dist) * scale;
    return { x: CENTER + off.x * k, y: CENTER - off.y * k };
  });
  // #898: 겹친 점은 본사(가운데, 움직이지 않음) 둘레·서로 사이로 조금씩 떨어뜨려 하나씩 누를 수 있게 한다(잇는 선 없음).
  // "거산 본사" 이름 자리(왼쪽·오른쪽 반)도 움직이지 않는 칸으로 넣어 핀이 이름을 가리지 않게 한다.
  const fixedSpots = [
    { x: CENTER, y: CENTER, fixed: true },
    { x: CENTER - 14, y: CENTER + 18, fixed: true },
    { x: CENTER + 14, y: CENTER + 18, fixed: true },
  ];
  const placed = spreadPins([...fixedSpots, ...truePos], SVG_PIN_GAP).slice(fixedSpots.length);
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
  const canPickVisitBase = (oppId: string) =>
    visitRadius !== undefined && visitOptions.some(({ anchor }) => anchor.oppId === oppId);
  const choosePoint = (oppId: string) => {
    setCluster(null);
    if (compact && canPickVisitBase(oppId)) {
      setVisitBase(oppId);
      setSelected(null);
      return;
    }
    setSelected(oppId);
  };
  const chooseCluster = (companies: DashboardMapPoint[]) => {
    setSelected(null);
    setCluster(companies);
  };
  const focusVisit = (oppId: string | null) => {
    setSelected(null);
    setVisitOpen(oppId);
  };
  const pickVisitBase = (oppId: string) => {
    setVisitBase(oppId);
    focusVisit(oppId);
  };

  const map = (
    <div style={{ flex: '3 1 430px', minWidth: 0, display: 'grid', gap: 12 }}>
      {naver && !mapFailed ? (
        <>
          <NaverMapCanvas
            api={naver}
            center={data.center}
            ringsKm={data.ringsKm}
            points={data.points}
            ringColor={colors.textSecondary}
            hqColor={colors.text}
            onSelect={choosePoint}
            onCluster={compact ? chooseCluster : undefined}
            visitBaseId={compact ? visitSelection?.anchor.oppId : undefined}
            focus={focus}
            labelFor={labelFor}
          />
          {/* 지도 점은 키보드로 고를 수 없어 낭독기용 단추 목록을 함께 둔다. */}
          <ul aria-label={t.pointList} data-testid="dashboard-map-point-list" style={srOnly}>
            {data.points.map((p) => (
              <li key={p.oppId}>
                <button type="button" onClick={() => choosePoint(p.oppId)}>
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
              maxWidth: compact ? undefined : 480,
              // #929: 영업 홈 지도는 높이를 고정(원 그림은 가운데 정렬로 비율 유지).
              height: compact ? DASHBOARD_MAP_HEIGHT : undefined,
              justifySelf: 'center',
              background: statusPalette.neutral.bg,
              borderRadius: radius.card,
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
            {data.points.map((p, index) => {
              const { x, y } = placed[index];
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
                  onClick={() => choosePoint(p.oppId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choosePoint(p.oppId);
                    }
                  }}
                >
                  {/* 누르기 쉬운 칸: 점보다 조금 크게(이웃 점과는 겹치지 않는 크기). */}
                  <circle cx={x} cy={y} r={SVG_PIN_GAP / 2} fill="transparent" />
                  <MapPinMark kind={p.group} x={x} y={y} size={SVG_PIN_SIZE} />
                  {/* 마우스를 올리면 회사 이름이 뜬다(#673). */}
                  <title>{p.customerName}</title>
                </g>
              );
            })}
            {/* #898: 본사 핀은 회사 핀에 가리지 않게 맨 위(마지막)에 그린다. */}
            <g data-testid="dashboard-map-hq">
              <MapPinMark kind="HQ" x={CENTER} y={CENTER} size={SVG_HQ_SIZE} />
              <text
                x={CENTER}
                y={CENTER + 22}
                textAnchor="middle"
                fontSize={12}
                fill={colors.text}
                stroke={mapPinStroke.ring}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {t.hqLabel}
              </text>
            </g>
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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <MapPinIcon kind={group} />
              {t.groups[group]} {data.points.filter((p) => p.group === group).length}곳
            </span>
          </li>
        ))}
        <li data-testid="dashboard-map-legend-hq">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <MapPinIcon kind="HQ" />
            {t.hqLabel}
          </span>
        </li>
      </ul>

      {chosen || chosenNearby ? (
        <div
          role="dialog"
          aria-label={t.callout}
          data-testid="dashboard-map-callout"
          style={{
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: radius.control,
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
                {t.groups[chosenNearby.group]} ·{' '}
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

      {!compact && visitGroups && visitRadius !== undefined ? (
        <VisitGroups
          groups={visitGroups}
          points={data.points}
          radiusKm={visitRadius}
          widenBelowCount={data.visitWidenBelowCount}
          open={visitOpen}
          onToggle={setVisitOpen}
          groupColors={GROUP_TEXT_COLOR}
        />
      ) : null}
    </div>
  );
  return (
    <div
      data-testid="dashboard-map"
      style={
        compact
          ? { display: 'flex', flexWrap: 'wrap', alignItems: 'start', gap: spacing.cardGap }
          : undefined
      }
    >
      {map}
      {compact && cluster ? (
        <MapClusterCards
          key={cluster.map((company) => company.oppId).join(',')}
          companies={cluster}
          canPickVisitBase={canPickVisitBase}
          onPickVisitBase={choosePoint}
          onClose={() => setCluster(null)}
        />
      ) : null}
      {compact && visitGroups && visitRadius !== undefined ? (
        <div
          style={{
            flex: '1 1 235px',
            minWidth: 0,
            // #929: 같이 들를 곳은 지도 높이 안에서 보이고, 넘치면 칸 안에서 내려 본다.
            maxHeight: DASHBOARD_MAP_HEIGHT,
            overflowY: 'auto',
          }}
          hidden={cluster !== null}
        >
          <VisitMapCards
            options={visitOptions}
            current={visitSelection}
            radiusKm={visitRadius}
            widenBelowCount={data.visitWidenBelowCount}
            onPick={pickVisitBase}
            focused={visitOpen}
            onFocus={focusVisit}
          />
        </div>
      ) : null}
    </div>
  );
}

const missingStyle = {
  margin: 0,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;
