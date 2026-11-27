// 대시보드 지도 바탕을 네이버클라우드 Maps 웹 지도(Dynamic Map)로 그린다(#671, PM 요청 2026-11-13).
// 약속(계약 C4 screenMapRule): 지도 SDK에 넘기는 값은 좌표와 원의 중심·반지름뿐이다. 회사 이름·영업 단계·거리·메모는
// SDK 함수 인자로 넘기지 않는다. 색 점과 본사 집 그림(#898), 묶음 숫자, "30km" 같은 원 이름만 그림으로 넘기고,
// 회사 정보는 부모의 HTML 말풍선이 그린다.
// 검색·지오코딩·길찾기 모듈(submodules)은 불러오지 않는다.
import { useEffect, useRef, useState } from 'react';
import type { DashboardMapGroup, DashboardMapPoint } from '../../api/dashboardMapTypes';
import { dashboardMapTexts as t } from '../../labels/ko';
import { colors, homePalette, mapPinStroke, radius, statusPalette } from '../../theme/tokens';
import { pinHtml } from '../common/MapPin';
import { spreadPins, type PinSpot } from '../common/spreadPins';

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
  getProjection: () => {
    fromCoordToOffset: (latlng: NaverLatLng) => NaverOffset;
    /** 화면 위치(px) → 좌표. 겹친 핀을 펼친 자리에 놓을 때 쓴다(#898). */
    fromOffsetToCoord: (offset: unknown) => NaverLatLng;
  };
}
interface NaverCircle {
  getBounds: () => NaverBounds;
}
interface NaverMarker {
  setMap?: (map: NaverMapInstance | null) => void;
  setPosition: (latlng: NaverLatLng) => void;
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

// #898(PM 2026-11-24 "섞기"): 한자리에 거의 그대로 겹친 회사(OVERLAP_DISTANCE px 안)는 숫자 풍선으로 묶고(#900),
// 살짝만 겹친 점·풍선은 PIN_GAP 간격으로 살짝 벌려 하나씩 누를 수 있게 한다(잇는 선 없음).
const OVERLAP_DISTANCE = 8;
/** #929 영업 홈(compact) 지도 높이(화면 모양값, 규칙 숫자 아님). 같이 들를 곳 칸 높이와 맞춘다. */
export const DASHBOARD_MAP_HEIGHT = 360;
const CLUSTER_SIZE = 22;
const PIN_SIZE = 14;
const HQ_PIN_SIZE = 24;
const PIN_GAP = 18;
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

  const blocked: LabelBox[] = [
    { left: hq.x - HQ_PIN_SIZE / 2, top: hq.y - 12, width: 100, height: 24 },
  ];
  for (const { x, y, companies } of visible) {
    const half = companies.length > 1 ? CLUSTER_SIZE / 2 : PIN_SIZE / 2 + 2;
    blocked.push({ left: x - half, top: y - half, width: half * 2, height: half * 2 });
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
    const gap = companies.length > 1 ? CLUSTER_SIZE / 2 + 5 : PIN_SIZE / 2 + 5;
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

/** 점 그림(#898: 작은 색 점 — 관심 빨강 · 진행 중 파랑 · 올해 성공 노랑). 회사 정보 없이 색만 담는다. */
export function pointIcon(group: DashboardMapGroup): string {
  return pinHtml(group, PIN_SIZE, 'dashboard-map-pin');
}

/** 묶음 숫자 풍선. 여러 단계가 섞일 수 있어 단계 색 대신 진한 색(핵심 강조)으로 그린다. */
function clusterIcon(count: number): HTMLButtonElement {
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
    background: colors.text,
    boxShadow: `0 1px 4px ${mapPinStroke.shadow}`,
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1',
    cursor: 'pointer',
  });
  return icon;
}

/** "같이 들를 곳" 근처 회사 표시(○). 회사 정보 없이 모양만. */
export const NEARBY_ICON = `<div style="width:10px;height:10px;border-radius:50%;background:${mapPinStroke.ring};border:2px solid ${colors.textSecondary};cursor:pointer"></div>`;

export interface NaverMapCanvasProps {
  api: NaverMapsApi;
  center: { lat: number; lng: number };
  ringsKm: number[];
  points: DashboardMapPoint[];
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
    // 펼친 핀(#898)은 실제 좌표와 조금 다른 자리에 있으므로 이름표·업체명은 지금 보이는 자리에 띄운다.
    const shownAt = new Map<unknown, NaverLatLng>();
    const showHover = (position: NaverLatLng, oppIds: string[], more = 0) =>
      setHover({ ...projectToContainer()(position), oppIds, more });
    const clearHover = () => setHover(null);
    // 점에 마우스를 올리면 이름표를, 내리면 지운다. 지도를 끌거나 확대하면 위치가 바뀌니 지운다.
    const hoverable = (marker: unknown, oppId: string, position: NaverLatLng) => {
      api.Event.addListener(marker, 'click', () => select.current(oppId));
      api.Event.addListener(marker, 'mouseover', () =>
        showHover(shownAt.get(marker) ?? position, [oppId]),
      );
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
          content: `<div style="font-size:12px;color:${ringColor};background:${homePalette.mapLabelBg};padding:0 4px;border-radius:${radius.tag}px">${km}km</div>`,
          anchor: new api.Point(18, 8),
        },
      });
    }
    new api.Marker({
      map,
      position: middle,
      clickable: false,
      // #898: 본사 핀(초록 원 안 흰 집)은 회사 핀 위에 보이게.
      zIndex: 1000,
      icon: {
        content: pinHtml('HQ', HQ_PIN_SIZE),
        anchor: new api.Point(HQ_PIN_SIZE / 2, HQ_PIN_SIZE / 2),
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
          content: pointIcon(point.group),
          anchor: new api.Point(PIN_SIZE / 2, PIN_SIZE / 2),
        },
      });
      hoverable(marker, point.oppId, position);
      return marker;
    };
    // 지도에 올린 회사 점·묶음 풍선(키: 회사 번호를 이은 글자)과 그 실제 좌표.
    const companyPins = new Map<string, { marker: NaverMarker; position: NaverLatLng }>();
    if (!compact) {
      for (const { point, position } of positions) {
        companyPins.set(point.oppId, { marker: addCompanyPin(point, position), position });
      }
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

    // 확대·이동이 끝날 때(idle)마다 화면 위치로 겹친 점·풍선을 살짝 벌린다(#898). 본사와 본사 이름표 자리는
    // 움직이지 않는 칸으로 두고 그 둘레로 옮긴다. 좌표만 다룬다(회사 정보 없음).
    const spread = () => {
      const projection = map.getProjection();
      const hq = projection.fromCoordToOffset(middle);
      const fixedSpots: PinSpot[] = [{ ...hq, fixed: true }];
      if (compact) {
        // 본사 오른쪽 "거산 본사" 이름표 자리.
        for (const dx of [28, 46, 64]) fixedSpots.push({ x: hq.x + dx, y: hq.y, fixed: true });
      }
      const pins = [...companyPins.values()];
      const spots = pins.map(({ position }) => projection.fromCoordToOffset(position));
      const placed = spreadPins([...fixedSpots, ...spots], PIN_GAP).slice(fixedSpots.length);
      pins.forEach(({ marker, position }, i) => {
        const moved = Math.hypot(placed[i].x - spots[i].x, placed[i].y - spots[i].y) > 0.5;
        const at = moved
          ? projection.fromOffsetToCoord(new api.Point(placed[i].x, placed[i].y))
          : position;
        shownAt.set(marker, at);
        marker.setPosition(at);
      });
    };

    // 방문 기준을 선택한 뒤에도 확대·축소가 끝날 때 겹치는 업체 점을 다시 묶는다.
    const byId = new Map(positions.map(({ point, position }) => [point.oppId, position]));
    let groups: (ProjectedGroup & { key: string })[] = [];
    if (!compact) api.Event.addListener(map, 'idle', spread);
    if (compact) {
      const updateGroups = () => {
        const projection = map.getProjection();
        groups = groupOverlappingCompanies(
          positions.map(({ point, position }) => {
            const { x, y } = projection.fromCoordToOffset(position);
            return { x, y, point };
          }),
        ).map((group) => ({ ...group, key: group.companies.map(({ oppId }) => oppId).join(',') }));
        const keep = new Set<string>();
        for (const { companies, key } of groups) {
          keep.add(key);
          if (companyPins.has(key)) continue;
          const point = companies[0];
          const position = byId.get(point.oppId);
          if (!position) continue;
          if (companies.length === 1) {
            companyPins.set(key, { marker: addCompanyPin(point, position), position });
            continue;
          }
          const icon = clusterIcon(companies.length);
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
              shownAt.get(marker) ?? position,
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
          companyPins.set(key, { marker, position });
        }
        for (const [key, { marker }] of companyPins) {
          if (keep.has(key)) continue;
          api.Event.clearInstanceListeners?.(marker);
          marker.setMap?.(null);
          shownAt.delete(marker);
          companyPins.delete(key);
        }
      };
      // 묶은 뒤에 벌린다(같은 idle에서 차례로).
      api.Event.addListener(map, 'idle', () => {
        updateGroups();
        spread();
      });
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
          groups: groups.map(({ companies, key }) => {
            const pin = companyPins.get(key);
            const at = (pin && shownAt.get(pin.marker)) ?? byId.get(companies[0].oppId)!;
            return { ...project(at), companies };
          }),
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
        for (const { marker } of companyPins.values()) {
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
  }, [api, center.lat, center.lng, ringsKm, points, ringColor, hqColor, focus, compact]);

  const hqOffset = overlay?.hq;
  const labels = overlay ? companyNameLabels(overlay, visitBaseId) : [];
  const hoverNames = hover?.oppIds.map((oppId) => labelFor?.(oppId)).filter(Boolean) ?? [];
  const tooltipWidth = overlay?.width ? Math.min(260, overlay.width - 16) : 260;
  const belowMarker = hover ? hover.y < (hoverNames.length > 1 ? 85 : 36) : false;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: radius.card }}>
      <div
        ref={box}
        data-testid="dashboard-naver-map"
        style={{
          width: '100%',
          // #929(PM 요청 2026-11-25): 영업 홈 지도는 옆 "같이 들를 곳"과 균형이 맞게 높이를 고정한다.
          height: compact ? DASHBOARD_MAP_HEIGHT : 420,
          borderRadius: radius.card,
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
            left: hqOffset.x + HQ_PIN_SIZE / 2 + 4,
            top: hqOffset.y,
            transform: 'translateY(-50%)',
            borderRadius: radius.tag,
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
            borderRadius: radius.tag,
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
            borderRadius: radius.tag,
            background: homePalette.mapTipBg,
            color: homePalette.mapTipFg,
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
