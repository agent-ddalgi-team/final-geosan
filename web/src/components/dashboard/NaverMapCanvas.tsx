// 대시보드 지도 바탕을 네이버클라우드 Maps 웹 지도(Dynamic Map)로 그린다(#671, PM 요청 2026-11-13).
// 약속(계약 C4 screenMapRule): 지도 SDK에 넘기는 값은 좌표와 원의 중심·반지름뿐이다. 회사 이름·영업 단계·거리·메모는
// SDK 함수 인자로 넘기지 않는다. 점 모양(●◆★)과 "30km" 같은 원 이름만 그림으로 넘기고, 회사 정보는 부모의 HTML 말풍선이 그린다.
// 검색·지오코딩·길찾기 모듈(submodules)은 불러오지 않는다.
import { useEffect, useRef } from 'react';
import type { DashboardMapGroup, DashboardMapPoint } from '../../api/dashboardMapTypes';

/* 쓰는 SDK 기능만 좁게 적은 모양. 실제 SDK는 window.naver.maps에 있다. */
interface NaverLatLng {
  readonly lat: () => number;
}
interface NaverBounds {
  readonly extend?: (latlng: NaverLatLng) => void;
}
interface NaverMapInstance {
  fitBounds: (bounds: NaverBounds) => void;
  destroy: () => void;
}
interface NaverCircle {
  getBounds: () => NaverBounds;
}
export interface NaverMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMapInstance;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  Point: new (x: number, y: number) => unknown;
  Circle: new (options: Record<string, unknown>) => NaverCircle;
  Marker: new (options: Record<string, unknown>) => unknown;
  Event: { addListener: (target: unknown, name: string, handler: () => void) => unknown };
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

/** 점 모양 그림. 회사 정보 없이 모양·색만 담는다. */
export function pointIcon(group: DashboardMapGroup, color: string): string {
  return `<div style="font-size:20px;line-height:20px;color:${color};text-shadow:0 0 2px #fff,0 0 2px #fff;cursor:pointer">${GLYPH[group]}</div>`;
}

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
}

export default function NaverMapCanvas({
  api,
  center,
  ringsKm,
  points,
  colors,
  ringColor,
  hqColor,
  onSelect,
}: NaverMapCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  // 지도는 한 번 만들고, 말풍선 선택이 바뀌어도 다시 그리지 않는다.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!box.current) return;
    const middle = new api.LatLng(center.lat, center.lng);
    const map = new api.Map(box.current, { center: middle, zoom: 9, scaleControl: true });
    const rings = [...ringsKm].sort((a, b) => a - b);
    let outer: NaverCircle | null = null;
    for (const km of rings) {
      outer = new api.Circle({
        map,
        center: middle,
        radius: km * 1000,
        strokeColor: ringColor,
        strokeOpacity: 0.8,
        strokeWeight: 1.5,
        strokeStyle: 'shortdash',
        fillOpacity: 0,
        clickable: false,
      });
      // 원 이름("30km")은 원 북쪽 끝에 둔다. 위도 1도 ≈ 110.57km.
      new api.Marker({
        map,
        position: new api.LatLng(center.lat + km / 110.57, center.lng),
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
    for (const point of points) {
      const marker = new api.Marker({
        map,
        position: new api.LatLng(point.lat, point.lng),
        icon: {
          content: pointIcon(point.group, colors[point.group]),
          anchor: new api.Point(10, 10),
        },
      });
      api.Event.addListener(marker, 'click', () => select.current(point.oppId));
    }
    if (outer) map.fitBounds(outer.getBounds());
    return () => {
      try {
        map.destroy();
      } catch {
        // 키 인증 실패 뒤에는 SDK가 지도를 반쯤 정리해 둬서 destroy가 SDK 안에서 오류를 낸다(실제 확인 2026-11-13).
        // 정리 오류로 대시보드 전체가 멈추지 않게 여기서만 막는다. 실패 자체는 자리표시 안내 문구로 보인다.
      }
    };
  }, [api, center.lat, center.lng, ringsKm, points, colors, ringColor, hqColor]);

  return (
    <div
      ref={box}
      data-testid="dashboard-naver-map"
      style={{ width: '100%', height: 420, borderRadius: 12, overflow: 'hidden' }}
    />
  );
}
