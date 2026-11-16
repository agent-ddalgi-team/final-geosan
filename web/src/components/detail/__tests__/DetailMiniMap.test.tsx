// 상세 "한눈에" 작은 지도(#803): 화면에 들어오기 전에는 불러오지 않고, 두 점·선만 그리며, 못 그리면 거리 그림으로 돌아간다.
// 지도 SDK는 가짜 객체다(실제 네이버 지도는 브라우저에서만 확인). 좌표는 가상 값.
import { act, render, screen } from '@testing-library/react';
import type { DetailHeader, DetailMap } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { resetNaverMapsLoader } from '../../dashboard/NaverMapCanvas';
import type { NaverMapsApi } from '../../dashboard/NaverMapCanvas';
import DetailGlance from '../DetailGlance';
import DetailMiniMap from '../DetailMiniMap';

const MAP: DetailMap = { center: { lat: 36.8, lng: 127.1 }, company: { lat: 36.85, lng: 127.0 } };

let observed: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
class FakeObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
}

function fakeApi() {
  const calls = { map: [] as Record<string, unknown>[], markers: 0, lines: 0, bounds: 0 };
  const api = {
    Map: vi.fn().mockImplementation((_el: HTMLElement, options: Record<string, unknown>) => {
      calls.map.push(options);
      return { fitBounds: () => {}, destroy: () => {}, getProjection: () => ({}) };
    }),
    LatLng: vi.fn().mockImplementation((lat: number) => ({ lat: () => lat })),
    Point: vi.fn(),
    Circle: vi.fn(),
    Marker: vi.fn().mockImplementation(() => {
      calls.markers += 1;
      return {};
    }),
    Polyline: vi.fn().mockImplementation(() => {
      calls.lines += 1;
      return {};
    }),
    LatLngBounds: vi.fn().mockImplementation(() => {
      calls.bounds += 1;
      return {};
    }),
    Event: { addListener: vi.fn() },
  };
  return { api: api as unknown as NaverMapsApi, calls };
}

beforeEach(() => {
  observed = [];
  resetNaverMapsLoader();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { naver?: unknown }).naver;
  document.getElementById('naver-maps-sdk')?.remove();
});

describe('DetailMiniMap', () => {
  it('Given 지도 좌표 When 화면에 들어오기 전 Then 스크립트·지도를 불러오지 않고, 들어오면 두 점과 선을 움직이지 않는 지도로 그린다', async () => {
    const { api, calls } = fakeApi();
    window.naver = { maps: api };
    render(
      <DetailMiniMap map={MAP} href="https://map.example/" onUnavailable={vi.fn()} clientId="k" />,
    );
    expect(screen.getByTestId('detail-mini-map')).toHaveAttribute('data-state', 'waiting');
    expect(calls.map).toHaveLength(0);
    expect(document.getElementById('naver-maps-sdk')).toBeNull();

    await act(async () => {
      observed[0]([{ isIntersecting: true }]);
    });
    expect(screen.getByTestId('detail-mini-map')).toHaveAttribute('data-state', 'ready');
    expect(calls.map).toHaveLength(1);
    expect(calls.map[0]).toMatchObject({
      draggable: false,
      scrollWheel: false,
      zoomControl: false,
    });
    expect(calls.markers).toBe(2);
    expect(calls.lines).toBe(1);
    expect(calls.bounds).toBe(1);
    // 누르면 지금의 지도 링크가 새 창으로 열린다.
    const link = screen.getByTestId('detail-mini-map-link');
    expect(link).toHaveAttribute('href', 'https://map.example/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('Given 화면용 키가 없다 When 그리면 Then 바로 onUnavailable을 부르고 지도를 만들지 않는다', () => {
    const { api, calls } = fakeApi();
    window.naver = { maps: api };
    const onUnavailable = vi.fn();
    render(<DetailMiniMap map={MAP} href={null} onUnavailable={onUnavailable} clientId="" />);
    expect(onUnavailable).toHaveBeenCalled();
    expect(calls.map).toHaveLength(0);
  });
});

describe('DetailMiniMap 인증 실패', () => {
  it('Given 화면에 들어와 스크립트를 부르는 중 When 키 인증이 실패하면 Then onUnavailable을 불러 거리 그림으로 돌아가게 한다', async () => {
    const onUnavailable = vi.fn();
    render(<DetailMiniMap map={MAP} href={null} onUnavailable={onUnavailable} clientId="k" />);
    await act(async () => {
      observed[0]([{ isIntersecting: true }]);
    });
    expect(document.getElementById('naver-maps-sdk')).not.toBeNull();
    await act(async () => {
      window.navermap_authFailure?.();
    });
    expect(onUnavailable).toHaveBeenCalled();
  });
});

describe('DetailGlance 작은 지도 자리', () => {
  const header = {
    ...(detailFixture.data.header as unknown as DetailHeader),
    address: '충청남도 아산시 가상로 1',
    distanceKm: 8.2,
  };

  it('Given 지도 좌표가 없다(null) When 한눈에 Then 지도 없이 지금처럼 거리 그림만', () => {
    render(<DetailGlance header={header} processLinks={[]} evidence={[]} map={null} />);
    expect(screen.queryByTestId('detail-mini-map')).not.toBeInTheDocument();
    expect(screen.getByTestId('glance-distance-line')).toBeInTheDocument();
  });

  it('Given 지도 좌표는 있지만 화면용 키가 없다 When 한눈에 Then 지도 대신 거리 그림으로 돌아간다', () => {
    render(
      <DetailGlance header={header} processLinks={[]} evidence={[]} map={MAP} mapClientId="" />,
    );
    expect(screen.queryByTestId('detail-mini-map')).not.toBeInTheDocument();
    expect(screen.getByTestId('glance-distance-line')).toBeInTheDocument();
  });

  it('Given 지도 좌표와 키 When 한눈에 Then "어떤 회사" 칸 옆에 지도 상자가 놓이고 거리 그림은 숨는다', () => {
    const { api } = fakeApi();
    window.naver = { maps: api };
    render(
      <DetailGlance header={header} processLinks={[]} evidence={[]} map={MAP} mapClientId="k" />,
    );
    const layout = screen.getByTestId('glance-company-layout');
    expect(layout).toContainElement(screen.getByTestId('detail-mini-map'));
    expect(screen.queryByTestId('glance-distance-line')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-distance')).toHaveTextContent('8.2km');
  });
});
