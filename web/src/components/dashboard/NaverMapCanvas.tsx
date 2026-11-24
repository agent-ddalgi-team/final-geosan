// 대시보드 지도 바탕을 네이버클라우드 Maps 웹 지도(Dynamic Map)로 그린다(#671, PM 요청 2026-11-13).
// 약속(계약 C4 screenMapRule): 지도 SDK에 넘기는 값은 좌표와 원의 중심·반지름뿐이다. 회사 이름·영업 단계·거리·메모는
// SDK 함수 인자로 넘기지 않는다. 점 모양(●◆★)과 "30km" 같은 원 이름만 그림으로 넘기고, 회사 정보는 부모의 HTML 말풍선이 그린다.
// 검색·지오코딩·길찾기 모듈(submodules)은 불러오지 않는다.
import { useEffect, useRef, useState } from 'react';
import type { DashboardMapGroup, DashboardMapPoint } from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';

/* 쓰는 SDK 기능만 좁게 적은 모양. 실제 SDK는 window.naver.maps에 있다. */
interface NaverLatLng {
  readonly lat: () => number;
}
interface NaverBounds {
  readonly extend?: (latlng: NaverLatLng) => void;
}
interface NaverOffset {
  readonly x: number;
  readonly y: number;
}
interface NaverMapInstance {
  fitBounds: (
    bounds: NaverBounds | NaverLatLng[],
    padding?: { top: number; right: number; bottom: number; left: number; maxZoom: number },
  ) => void;
  destroy: () => void;
  getCenter?: () => NaverLatLng;
  /** 좌표 → 지도 상자 안 화면 위치(px). 마우스를 올린 점 위에 우리 이름표를 띄울 때 쓴다(#673). */
  getProjection: () => { fromCoordToOffset: (latlng: NaverLatLng) => NaverOffset };
}
interface NaverCircle {
  getBounds: () => NaverBounds;
}
interface NaverMarker {
  setMap?: (map: NaverMapInstance | null) => void;
}
export interface NaverMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMapInstance;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  Point: new (x: number, y: number) => unknown;
  Circle: new (options: Record<string, unknown>) => NaverCircle;
  Marker: new (options: Record<string, unknown>) => NaverMarker;
  Event: {
    addListener: (target: unknown, name: string, handler: () => void) => unknown;
    clearInstanceListeners?: (target: unknown) => void;
  };
  /** #803 상세 작은 지도: 거산과 회사 두 점을 잇는 선, 두 점을 담는 범위. 대시보드 지도는 쓰지 않는다. */
  Polyline?: new (options: Record<string, unknown>) => unknown;
  LatLngBounds?: new (southWest: NaverLatLng, northEast: NaverLatLng) => NaverBounds;
}

declare global {
  interface Window {
    naver?: { maps?: NaverMapsApi };
    navermap_authFailure?: () => void;
  }
}

const SCRIPT_ID = 'naver-maps-sdk';
let loading: Promise<NaverMapsApi> | null = null;
// 키 인증 실패는 SDK를 다 불러온 뒤(지도를 그리려 할 때)에도 온다. 그때도 화면이 자리표시로 돌아가게 알린다.
let authFailed = false;
const failureListeners = new Set<() => void>();

/** SDK 주소. 키 하나만 붙이고 submodules(검색·지오코딩 등)는 붙이지 않는다. */
export function naverMapsScriptUrl(clientId: string): string {
  return `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
}

/** 키 인증 실패를 듣는다. 이미 실패했으면 바로 알린다. 돌려받은 함수로 그만 듣는다. */
export function onNaverMapsFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  if (authFailed) listener();
  return () => {
    failureListeners.delete(listener);
  };
}

/** 네이버 지도 SDK를 한 번만 불러온다. 키 인증 실패(허용 URL 미등록 등)·네트워크 실패면 거부한다. */
export function loadNaverMaps(clientId: string): Promise<NaverMapsApi> {
  if (authFailed) return Promise.reject(new Error('auth'));
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  if (loading) return loading;
  loading = new Promise<NaverMapsApi>((resolve, reject) => {
    const fail = (reason: string) => {
      loading = null;
      document.getElementById(SCRIPT_ID)?.remove();
      reject(new Error(reason));
    };
    // 콘솔의 Web 서비스 URL에 지금 주소가 없거나 Dynamic Map이 꺼져 있으면 SDK가 이 함수를 부른다.
    window.navermap_authFailure = () => {
      authFailed = true;
      fail('auth');
      for (const listener of [...failureListeners]) listener();
    };
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = naverMapsScriptUrl(clientId);
    script.async = true;
    script.onload = () => {
      if (window.naver?.maps) resolve(window.naver.maps);
      else fail('missing');
    };
    script.onerror = () => fail('network');
    document.head.appendChild(script);
  });
  return loading;
}

/** 시험에서 불러오기 상태를 비운다. */
export function resetNaverMapsLoader() {
  loading = null;
  authFailed = false;
  failureListeners.clear();
}

const GLYPH: Record<DashboardMapGroup, string> = {
  INTERESTED: '●',
  IN_PROGRESS: '◆',
  WON_THIS_YEAR: '★',
};

const OVERLAP_DISTANCE = 32;
const CLUSTER_SIZE = 38;
const KM_PER_LATITUDE_DEGREE = 110.57;
const DETAIL_SCALE_PX_PER_KM = 50;
const LABEL_HEIGHT = 22;
const OVERVIEW_PADDING = { top: 46, right: 68, bottom: 46, left: 46, maxZoom: 13 };

interface ProjectedCompany extends NaverOffset {
  point: DashboardMapPoint;
}

interface ProjectedGroup extends NaverOffset {
  companies: DashboardMapPoint[];
}

interface MapOverlay {
  width: number;
  height: number;
  hq: NaverOffset;
  groups: ProjectedGroup[];
  showCompanyNames: boolean;
}

interface LabelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

function companyNameLabels(overlay: MapOverlay, visitBaseId?: string) {
  const { width, height, hq, groups, showCompanyNames } = overlay;
  if (width < 32 || height < 32) return [];
  const visible = groups.filter(({ x, y }) => x >= 0 && x <= width && y >= 0 && y <= height);
  const visitGroup = visible.find(({ companies }) =>
    companies.some(({ oppId }) => oppId === visitBaseId),
  );
  const candidates = showCompanyNames
    ? visible.filter((group) => group !== visitGroup && group.companies.length === 1)
    : [];
  if (visitGroup) candidates.unshift(visitGroup);

  const blocked: LabelBox[] = [{ left: hq.x - 10, top: hq.y - 11, width: 98, height: 22 }];
  for (const { x, y, companies } of visible) {
    const radius = companies.length > 1 ? CLUSTER_SIZE / 2 : 10;
    blocked.push({ left: x - radius, top: y - radius, width: radius * 2, height: radius * 2 });
  }

  const labels = [];
  for (const group of candidates) {
    const { x, y, companies } = group;
    const isVisitBase = group === visitGroup;
    const company = isVisitBase
      ? companies.find(({ oppId }) => oppId === visitBaseId)!
      : companies[0];
    const text =
      companies.length > 1 ? t.visitClusterIncludes(company.customerName) : company.customerName;
    const labelWidth = Math.min(text.length * 12 + 12, isVisitBase ? 210 : 136, width - 8);
    const gap = companies.length > 1 ? CLUSTER_SIZE / 2 + 5 : 14;
    const top = y - LABEL_HEIGHT / 2;
    const centeredLeft = Math.max(4, Math.min(width - labelWidth - 4, x - labelWidth / 2));
    const placements = [
      { left: x + gap, top },
      { left: x - gap - labelWidth, top },
      ...(isVisitBase
        ? [
            { left: centeredLeft, top: y - gap - LABEL_HEIGHT },
            { left: centeredLeft, top: y + gap },
          ]
        : []),
    ];
    const fit = placements.find(
      ({ left, top: boxTop }) =>
        left >= 4 &&
        left + labelWidth <= width - 4 &&
        boxTop >= 4 &&
        boxTop + LABEL_HEIGHT <= height - 4 &&
        !blocked.some(
          (other) =>
            left < other.left + other.width &&
            left + labelWidth > other.left &&
            boxTop < other.top + other.height &&
            boxTop + LABEL_HEIGHT > other.top,
        ),
    );
    if (!fit) continue;
    blocked.push({ ...fit, width: labelWidth, height: LABEL_HEIGHT });
    labels.push({ ...fit, maxWidth: labelWidth, text, id: company.oppId, isVisitBase });
  }
  return labels;
}

export function groupOverlappingCompanies(points: ProjectedCompany[]): ProjectedGroup[] {
  const groups: ProjectedGroup[] = [];
  for (const { x, y, point } of points) {
    const hit = groups.find((group) => Math.hypot(group.x - x, group.y - y) < OVERLAP_DISTANCE);
    if (hit) {
      hit.companies.push(point);
    } else {
      groups.push({ x, y, companies: [point] });
    }
  }
  return groups;
}

/** 점 모양 그림. 회사 정보 없이 모양·색만 담는다. */
export function pointIcon(group: DashboardMapGroup, color: string): string {
  return `<div data-testid="dashboard-map-pin" style="font-size:20px;line-height:20px;color:${color};text-shadow:0 0 2px #fff,0 0 2px #fff;cursor:pointer">${GLYPH[group]}</div>`;
}

function clusterIcon(count: number, color: string): HTMLButtonElement {
  const icon = document.createElement('button');
  icon.type = 'button';
  icon.dataset.testid = 'dashboard-map-cluster';
  icon.setAttribute('aria-label', `이 위치의 업체 ${count}곳`);
  icon.textContent = String(count);
  Object.assign(icon.style, {
    width: `${CLUSTER_SIZE}px`,
    height: `${CLUSTER_SIZE}px`,
    boxSizing: 'border-box',
    padding: '0',
    border: `2px solid ${colors.bgContainer}`,
    borderRadius: '50%',
    color: colors.bgContainer,
    background: color,
    boxShadow: '0 1px 4px #1f232947',
    fontSize: `${typography.fontSizeSecondary}px`,
    fontWeight: '700',
    lineHeight: '1',
    cursor: 'pointer',
  });
  return icon;
}

/** "같이 들를 곳" 근처 회사 표시(○). 회사 정보 없이 모양만. */
export const NEARBY_ICON =
  '<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #555;cursor:pointer"></div>';

export interface NaverMapCanvasProps {
  api: NaverMapsApi;
  center: { lat: number; lng: number };
  ringsKm: number[];
  points: DashboardMapPoint[];
  colors: Record<DashboardMapGroup, string>;
  ringColor: string;
  hqColor: string;
  /** 점을 누르면 그 기회 번호를 알린다. 말풍선은 부모가 그린다. */
  onSelect: (oppId: string) => void;
  onCluster?: (companies: DashboardMapPoint[]) => void;
  visitBaseId?: string;
  /** "같이 들를 곳"(#673)에서 고른 묶음. 있으면 그 회사 둘레 반경 원과 근처 회사(○)를 그리고 그쪽으로 다가간다.
   *  좌표·반지름만 쓰고 회사 이름은 넘기지 않는다. */
  focus?: {
    center: { lat: number; lng: number };
    radiusKm: number;
    nearby: { oppId: string; lat: number; lng: number }[];
  } | null;
  /** 마우스를 올린 점의 회사 이름. 이름은 SDK에 넘기지 않고 이 부품의 HTML 이름표로만 그린다(#673). */
  labelFor?: (oppId: string) => string | null;
}

export default function NaverMapCanvas({
  api,
  center,
  ringsKm,
  points,
  colors: groupColors,
  ringColor,
  hqColor,
  onSelect,
  onCluster,
  visitBaseId,
  focus = null,
  labelFor,
}: NaverMapCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  // 마우스를 올린 점과 그 화면 위치. 이름표는 우리 HTML로 지도 위에 띄운다.
  const [hover, setHover] = useState<(NaverOffset & { oppIds: string[]; more: number }) | null>(
    null,
  );
  const [overlay, setOverlay] = useState<MapOverlay | null>(null);
  const compact = Boolean(onCluster);
  // 지도는 한 번 만들고, 말풍선 선택이 바뀌어도 다시 그리지 않는다.
  const select = useRef(onSelect);
  const selectCluster = useRef(onCluster);
  useEffect(() => {
    select.current = onSelect;
    selectCluster.current = onCluster;
  }, [onSelect, onCluster]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const middle = new api.LatLng(center.lat, center.lng);
    const map = new api.Map(element, {
      center: middle,
      zoom: 9,
      scaleControl: true,
      ...(compact ? { zoomControl: true, scrollWheel: true, baseTileOpacity: 0.78 } : {}),
    });
    const projectToContainer = () => {
      const projection = map.getProjection();
      if (!compact || !map.getCenter) {
        return (coordinate: NaverLatLng) => projection.fromCoordToOffset(coordinate);
      }
      // SDK의 오버레이 좌표를 같은 중심점 기준의 지도 상자 좌표로 옮긴다.
      const origin = projection.fromCoordToOffset(map.getCenter());
      const shiftX = element.clientWidth / 2 - origin.x;
      const shiftY = element.clientHeight / 2 - origin.y;
      return (coordinate: NaverLatLng) => {
        const { x, y } = projection.fromCoordToOffset(coordinate);
        return { x: x + shiftX, y: y + shiftY };
      };
    };
    const showHover = (position: NaverLatLng, oppIds: string[], more = 0) =>
      setHover({ ...projectToContainer()(position), oppIds, more });
    const clearHover = () => setHover(null);
    // 점에 마우스를 올리면 이름표를, 내리면 지운다. 지도를 끌거나 확대하면 위치가 바뀌니 지운다.
    const hoverable = (marker: unknown, oppId: string, position: NaverLatLng) => {
      api.Event.addListener(marker, 'click', () => select.current(oppId));
      api.Event.addListener(marker, 'mouseover', () => showHover(position, [oppId]));
      api.Event.addListener(marker, 'mouseout', clearHover);
    };
    api.Event.addListener(map, 'dragstart', clearHover);
    api.Event.addListener(map, 'zoom_changed', clearHover);
    const rings = [...ringsKm].sort((a, b) => a - b);
    let outer: NaverCircle | null = null;
    for (const km of rings) {
      outer = new api.Circle({
        map,
        center: middle,
        radius: km * 1000,
        strokeColor: ringColor,
        strokeOpacity: compact ? 0.27 : 0.8,
        strokeWeight: 1.5,
        strokeStyle: 'shortdash',
        fillOpacity: 0,
        clickable: false,
      });
      // 원 이름("30km")은 원 북쪽 끝에 둔다. 위도 1도 ≈ 110.57km.
      new api.Marker({
        map,
        position: new api.LatLng(center.lat + km / KM_PER_LATITUDE_DEGREE, center.lng),
        clickable: false,
        icon: {
          content: `<div style="font-size:12px;color:${ringColor};background:#fff;padding:0 4px;border-radius:4px">${km}km</div>`,
          anchor: new api.Point(18, 8),
        },
      });
    }
    new api.Marker({
      map,
      position: middle,
      clickable: false,
      icon: {
        content: `<div style="width:14px;height:14px;background:${hqColor};border:2px solid #fff"></div>`,
        anchor: new api.Point(9, 9),
      },
    });
    const positions = points.map((point) => ({
      point,
      position: new api.LatLng(point.lat, point.lng),
    }));
    const addCompanyPin = (point: DashboardMapPoint, position: NaverLatLng) => {
      const marker = new api.Marker({
        map,
        position,
        icon: {
          content: pointIcon(point.group, groupColors[point.group]),
          anchor: new api.Point(10, 10),
        },
      });
      hoverable(marker, point.oppId, position);
      return marker;
    };
    if (!compact) {
      for (const { point, position } of positions) addCompanyPin(point, position);
    }
    if (focus) {
      const spot = new api.LatLng(focus.center.lat, focus.center.lng);
      const around = new api.Circle({
        map,
        center: spot,
        radius: focus.radiusKm * 1000,
        strokeColor: hqColor,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: hqColor,
        fillOpacity: 0.06,
        clickable: false,
      });
      for (const near of focus.nearby) {
        const position = new api.LatLng(near.lat, near.lng);
        const marker = new api.Marker({
          map,
          position,
          icon: { content: NEARBY_ICON, anchor: new api.Point(7, 7) },
        });
        hoverable(marker, near.oppId, position);
      }
      map.fitBounds(around.getBounds());
    } else if (compact) {
      map.fitBounds([middle, ...positions.map(({ position }) => position)], OVERVIEW_PADDING);
    } else if (outer) {
      map.fitBounds(outer.getBounds());
    }

    // 방문 기준을 선택한 뒤에도 확대·축소가 끝날 때 겹치는 업체 점을 다시 묶는다.
    const companyPins = new Map<string, NaverMarker>();
    const byId = new Map(positions.map(({ point, position }) => [point.oppId, position]));
    let groups: ProjectedGroup[] = [];
    if (compact) {
      const updateGroups = () => {
        const projection = map.getProjection();
        groups = groupOverlappingCompanies(
          positions.map(({ point, position }) => {
            const { x, y } = projection.fromCoordToOffset(position);
            return { x, y, point };
          }),
        );
        const keep = new Set<string>();
        for (const { companies } of groups) {
          const key = companies.map((point) => point.oppId).join(',');
          keep.add(key);
          if (companyPins.has(key)) continue;
          const point = companies[0];
          const position = byId.get(point.oppId);
          if (!position) continue;
          if (companies.length === 1) {
            companyPins.set(key, addCompanyPin(point, position));
            continue;
          }
          const icon = clusterIcon(companies.length, groupColors.INTERESTED);
          const marker = new api.Marker({
            map,
            position,
            zIndex: 5,
            icon: {
              content: icon,
              size: { width: CLUSTER_SIZE, height: CLUSTER_SIZE },
              anchor: new api.Point(CLUSTER_SIZE / 2, CLUSTER_SIZE / 2),
            },
          });
          const open = () => {
            clearHover();
            selectCluster.current?.(companies);
          };
          const preview = () =>
            showHover(
              position,
              companies.slice(0, 2).map(({ oppId }) => oppId),
              companies.length - 2,
            );
          api.Event.addListener(marker, 'click', open);
          api.Event.addListener(marker, 'mouseover', preview);
          api.Event.addListener(marker, 'mouseout', clearHover);
          icon.addEventListener('focus', preview);
          icon.addEventListener('blur', clearHover);
          icon.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open();
          });
          companyPins.set(key, marker);
        }
        for (const [key, marker] of companyPins) {
          if (keep.has(key)) continue;
          api.Event.clearInstanceListeners?.(marker);
          marker.setMap?.(null);
          companyPins.delete(key);
        }
      };
      api.Event.addListener(map, 'idle', updateGroups);
      updateGroups();
    }

    let frame = 0;
    if (compact) {
      const north = new api.LatLng(center.lat + 1 / KM_PER_LATITUDE_DEGREE, center.lng);
      const update = () => {
        const project = projectToContainer();
        const hq = project(middle);
        setOverlay({
          width: element.clientWidth,
          height: element.clientHeight,
          hq,
          groups: groups.map(({ companies }) => ({
            ...project(byId.get(companies[0].oppId)!),
            companies,
          })),
          // 이 지역에서 축척 1km가 약 50px 이상일 때 업체명까지 표시할 여유가 생긴다.
          showCompanyNames: Math.abs(project(north).y - hq.y) >= DETAIL_SCALE_PX_PER_KM,
        });
      };
      const scheduleUpdate = () => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(update);
      };
      api.Event.addListener(map, 'bounds_changed', scheduleUpdate);
      api.Event.addListener(map, 'idle', scheduleUpdate);
      const resize =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
      resize?.observe(element);
      update();
      return () => {
        resize?.disconnect();
        cleanup();
      };
    }
    function cleanup() {
      window.cancelAnimationFrame(frame);
      setHover(null);
      setOverlay(null);
      try {
        for (const marker of companyPins.values()) {
          api.Event.clearInstanceListeners?.(marker);
          marker.setMap?.(null);
        }
        map.destroy();
      } catch {
        // 키 인증 실패 뒤에는 SDK가 지도를 반쯤 정리해 둬서 destroy가 SDK 안에서 오류를 낸다(실제 확인 2026-11-13).
        // 정리 오류로 대시보드 전체가 멈추지 않게 여기서만 막는다. 실패 자체는 자리표시 안내 문구로 보인다.
      }
    }
    return cleanup;
  }, [
    api,
    center.lat,
    center.lng,
    ringsKm,
    points,
    groupColors,
    ringColor,
    hqColor,
    focus,
    compact,
  ]);

  const hqOffset = overlay?.hq;
  const labels = overlay ? companyNameLabels(overlay, visitBaseId) : [];
  const hoverNames = hover?.oppIds.map((oppId) => labelFor?.(oppId)).filter(Boolean) ?? [];
  const tooltipWidth = overlay?.width ? Math.min(260, overlay.width - 16) : 260;
  const belowMarker = hover ? hover.y < (hoverNames.length > 1 ? 85 : 36) : false;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
      <div
        ref={box}
        data-testid="dashboard-naver-map"
        style={{
          width: '100%',
          height: compact ? 'clamp(420px, 52vw, 510px)' : 420,
          borderRadius: 12,
          overflow: 'hidden',
          isolation: 'isolate',
        }}
      />
      {compact && hqOffset ? (
        <span
          data-testid="dashboard-map-hq-label"
          style={{
            position: 'absolute',
            zIndex: 1,
            left: hqOffset.x + 13,
            top: hqOffset.y,
            transform: 'translateY(-50%)',
            borderRadius: 5,
            padding: '2px 5px',
            background: colors.bgContainer,
            color: colors.text,
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {t.hqLabel}
        </span>
      ) : null}
      {labels.map(({ id, text, left, top, maxWidth, isVisitBase }) => (
        <span
          key={id}
          aria-hidden="true"
          data-testid={
            isVisitBase ? 'dashboard-map-visit-base-label' : 'dashboard-map-company-label'
          }
          style={{
            position: 'absolute',
            left,
            top,
            maxWidth,
            height: LABEL_HEIGHT,
            lineHeight: `${LABEL_HEIGHT}px`,
            boxSizing: 'border-box',
            padding: '0 5px',
            borderRadius: 5,
            background: isVisitBase ? statusPalette.ask.bg : colors.bgContainer,
            color: isVisitBase ? statusPalette.ask.fg : colors.text,
            fontWeight: isVisitBase ? 700 : 500,
            fontSize: 12,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {text}
        </span>
      ))}
      {hover && hoverNames.length > 0 ? (
        <div
          role="tooltip"
          data-testid="dashboard-map-hover"
          style={{
            position: 'absolute',
            left: overlay?.width
              ? Math.max(
                  tooltipWidth / 2 + 8,
                  Math.min(overlay.width - tooltipWidth / 2 - 8, hover.x),
                )
              : hover.x,
            top: hover.y + (belowMarker ? 22 : -16),
            transform: belowMarker ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            padding: '2px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.78)',
            color: '#fff',
            fontSize: 13,
            maxWidth: tooltipWidth,
            boxSizing: 'border-box',
            overflowWrap: 'anywhere',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {hoverNames.map((name) => (
            <div key={name}>{name}</div>
          ))}
          {hover.more > 0 ? <div>{t.visitClusterMore(hover.more)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
