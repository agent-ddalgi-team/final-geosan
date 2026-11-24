// 상세 "한눈에" 작은 지도(#803, PM 결정 2026-11-16 "좌표 칸 더해서 지도 넣어줘").
// 거산 점 · 회사 점 · 두 점을 잇는 선만 그린다. 대시보드 지도의 SDK 불러오기(loadNaverMaps)를 그대로 쓴다.
// 상자가 화면에 들어올 때만(IntersectionObserver) 스크립트와 지도를 불러와 상세 첫 화면이 무거워지지 않게 한다.
// 확대·끌기는 막고, 누르면 지금의 네이버 지도 링크가 새 창으로 열린다.
// 약속(C4 screenMapRule): SDK에 넘기는 것은 두 점 좌표와 선뿐이다. 회사 이름·거리·메모는 넘기지 않는다.
// 키가 없거나 인증·불러오기에 실패하면 onUnavailable을 불러 부모가 거리 그림으로 돌아가게 한다.
import { useEffect, useRef, useState } from 'react';
import type { DetailMap } from '../../api/types';
import { detailMiniMap } from '../../labels/ko';
import { colors, detailTheme } from '../../theme/tokens';
import { loadNaverMaps, onNaverMapsFailure } from '../dashboard/NaverMapCanvas';
import { pinHtml } from '../common/MapPin';
import type { NaverMapsApi } from '../dashboard/NaverMapCanvas';

export const MINI_MAP_WIDTH = 240;
export const MINI_MAP_HEIGHT = 160;

// #898: 거산 본사는 대시보드 지도와 같은 초록 집 핀.
const HQ_PIN_SIZE = 20;
const HQ_ICON = pinHtml('HQ', HQ_PIN_SIZE);
const COMPANY_ICON = `<div style="width:14px;height:14px;border-radius:50%;background:${detailTheme.accentBar};border:2px solid ${detailTheme.lineDone}"></div>`;

export interface DetailMiniMapProps {
  map: DetailMap;
  /** 누르면 새 창으로 여는 지도 주소(지금의 네이버 지도 링크). 없으면 누를 곳이 없다. */
  href: string | null;
  /** 지도를 못 그릴 때(키 없음·인증 실패·불러오기 실패) 부른다. 부모가 거리 그림으로 돌아간다. */
  onUnavailable: () => void;
  /** 화면용 키. 시험에서 넘길 수 있다. */
  clientId?: string;
}

type State = 'waiting' | 'loading' | 'ready';

export default function DetailMiniMap({
  map,
  href,
  onUnavailable,
  clientId = import.meta.env.VITE_NCP_MAPS_CLIENT_ID,
}: DetailMiniMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('waiting');
  const [api, setApi] = useState<NaverMapsApi | null>(null);
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  }, [onUnavailable]);

  // 키가 없으면 지도를 그리지 않는다.
  useEffect(() => {
    if (!clientId) unavailable.current();
  }, [clientId]);

  // 화면에 들어올 때 한 번만 불러온다. IntersectionObserver가 없는 브라우저는 바로 불러온다.
  useEffect(() => {
    if (!clientId || state !== 'waiting' || !box.current) return undefined;
    const start = () => setState('loading');
    if (typeof IntersectionObserver === 'undefined') {
      start();
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [clientId, state]);

  useEffect(() => {
    if (state !== 'loading' || !clientId) return undefined;
    let alive = true;
    const stop = onNaverMapsFailure(() => {
      if (alive) unavailable.current();
    });
    loadNaverMaps(clientId)
      .then((loaded) => {
        if (!alive) return;
        setApi(loaded);
        setState('ready');
      })
      .catch(() => {
        if (alive) unavailable.current();
      });
    return () => {
      alive = false;
      stop();
    };
  }, [state, clientId]);

  useEffect(() => {
    if (!api || !canvas.current) return undefined;
    const hq = new api.LatLng(map.center.lat, map.center.lng);
    const company = new api.LatLng(map.company.lat, map.company.lng);
    const view = new api.Map(canvas.current, {
      center: company,
      zoom: 10,
      draggable: false,
      pinchZoom: false,
      scrollWheel: false,
      keyboardShortcuts: false,
      disableDoubleClickZoom: true,
      disableDoubleTapZoom: true,
      zoomControl: false,
      mapDataControl: false,
      scaleControl: false,
    });
    new api.Marker({
      map: view,
      position: hq,
      clickable: false,
      icon: { content: HQ_ICON, anchor: new api.Point(HQ_PIN_SIZE / 2, HQ_PIN_SIZE / 2) },
    });
    new api.Marker({
      map: view,
      position: company,
      clickable: false,
      icon: { content: COMPANY_ICON, anchor: new api.Point(9, 9) },
    });
    if (api.Polyline) {
      new api.Polyline({
        map: view,
        path: [hq, company],
        strokeColor: detailTheme.lineDone,
        strokeWeight: 2,
        strokeStyle: 'shortdash',
        clickable: false,
      });
    }
    if (api.LatLngBounds) {
      const south = Math.min(map.center.lat, map.company.lat);
      const north = Math.max(map.center.lat, map.company.lat);
      const west = Math.min(map.center.lng, map.company.lng);
      const east = Math.max(map.center.lng, map.company.lng);
      view.fitBounds(
        new api.LatLngBounds(new api.LatLng(south, west), new api.LatLng(north, east)),
      );
    }
    return () => view.destroy();
  }, [api, map]);

  return (
    <div
      ref={box}
      data-testid="detail-mini-map"
      data-state={state}
      style={{
        position: 'relative',
        width: MINI_MAP_WIDTH,
        height: MINI_MAP_HEIGHT,
        maxWidth: '100%',
        flexShrink: 0,
        borderRadius: detailTheme.radius,
        border: `1px solid ${detailTheme.border}`,
        overflow: 'hidden',
        background: colors.bgLayout,
      }}
    >
      <div ref={canvas} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      {href ? (
        // 지도 위 투명 링크: 누르면 지금의 네이버 지도 링크가 새 창으로 열린다(지도 자체는 움직이지 않음).
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={detailMiniMap.openLabel}
          title={detailMiniMap.openLabel}
          data-testid="detail-mini-map-link"
          style={{ position: 'absolute', inset: 0 }}
        />
      ) : null}
    </div>
  );
}
