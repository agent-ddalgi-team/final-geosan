// 대시보드 지도 바탕을 네이버 지도로(#671). 실제 SDK 대신 window.naver.maps 가짜로 확인한다(실제 연결 확인 아님).
// 약속 C4 화면 지도 규칙: SDK에는 좌표·원 중심·반지름과 모양 그림만, 회사 이름·단계·거리는 넘기지 않는다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardMap from '../DashboardMap';
import { naverMapsScriptUrl, resetNaverMapsLoader } from '../NaverMapCanvas';
import type { DashboardMap as MapData } from '../../../api/dashboardMapTypes';
import mapFixture from '../../../test/fixtures/dashboard-map.json';
import { dashboardMapTexts as t } from '../../../labels/ko';

const data = mapFixture.data as unknown as MapData;

interface Call {
  kind: string;
  args: unknown[];
}

function fakeSdk() {
  const calls: Call[] = [];
  const clicks = new Map<unknown, () => void>();
  class LatLng {
    constructor(
      public la: number,
      public ln: number,
    ) {
      calls.push({ kind: 'LatLng', args: [la, ln] });
    }
    lat = () => this.la;
  }
  const api = {
    Map: class {
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Map', args });
      }
      fitBounds = (...args: unknown[]) => calls.push({ kind: 'fitBounds', args });
      destroy = () => calls.push({ kind: 'destroy', args: [] });
    },
    LatLng,
    Point: class {
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Point', args });
      }
    },
    Circle: class {
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Circle', args });
      }
      getBounds = () => ({ bounds: true });
    },
    Marker: class {
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Marker', args });
      }
    },
    Event: {
      addListener: (target: unknown, name: string, handler: () => void) => {
        calls.push({ kind: 'addListener', args: [name] });
        clicks.set(target, handler);
      },
    },
  };
  return { api, calls, clicks };
}

function renderMap(clientId: string) {
  return render(
    <MemoryRouter>
      <DashboardMap data={data} mapClientId={clientId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  delete window.naver;
  delete window.navermap_authFailure;
  document.getElementById('naver-maps-sdk')?.remove();
  resetNaverMapsLoader();
});

describe('네이버 지도 바탕(#671)', () => {
  it('키가 없으면 SDK를 부르지 않고 지금 자리표시로 그린다', () => {
    renderMap('');
    expect(document.getElementById('naver-maps-sdk')).toBeNull();
    expect(screen.getByTestId('dashboard-map-placeholder')).toHaveTextContent(t.placeholder);
    expect(screen.getAllByTestId('dashboard-map-point')).toHaveLength(4);
  });

  it('SDK 주소에는 키만 붙고 검색·지오코딩 같은 추가 모듈은 부르지 않는다', async () => {
    renderMap('test-key');
    const script = document.getElementById('naver-maps-sdk') as HTMLScriptElement;
    expect(script.src).toBe(naverMapsScriptUrl('test-key'));
    expect(script.src).not.toMatch(/submodules|geocoder|direction|search/i);
    expect(screen.getByTestId('dashboard-map-placeholder')).toHaveTextContent(t.mapLoading);
  });

  it('SDK가 오면 지도 위에 원 3개·본사·점 4개를 그리고, 회사 이름·단계·거리는 SDK에 넘기지 않는다', async () => {
    const sdk = fakeSdk();
    window.naver = { maps: sdk.api as never };
    renderMap('test-key');
    await screen.findByTestId('dashboard-naver-map');
    // 지도 상자가 먼저 그려지고 그리기는 그 뒤 효과에서 일어나므로 끝날 때까지 기다린다.
    await waitFor(() => expect(sdk.calls.some((c) => c.kind === 'fitBounds')).toBe(true));
    const circles = sdk.calls.filter((c) => c.kind === 'Circle');
    expect(circles.map((c) => (c.args[0] as { radius: number }).radius)).toEqual([
      30000, 50000, 100000,
    ]);
    // 원 이름 3 + 본사 1 + 점 4
    expect(sdk.calls.filter((c) => c.kind === 'Marker')).toHaveLength(8);
    expect(sdk.calls.some((c) => c.kind === 'fitBounds')).toBe(true);
    // 지도 상자(DOM)와 지도 객체는 빼고, SDK에 넘긴 나머지 값을 글자로 모은다.
    const sent = JSON.stringify(
      sdk.calls.filter((c) => c.kind !== 'Map').map((c) => c.args),
      (key, value) => (key === 'map' ? 'MAP' : value),
    );
    for (const point of data.points) {
      expect(sent).not.toContain(point.customerName);
      expect(sent).not.toContain(point.oppId);
      expect(sent).not.toContain(`${point.distanceKm}km`);
    }
    for (const word of Object.values(t.groups)) expect(sent).not.toContain(word);
    expect(screen.queryByTestId('dashboard-map-placeholder')).not.toBeInTheDocument();
  });

  it('지도 점을 누르면 우리 말풍선에 회사 이름·단계·거리가 보인다', async () => {
    const sdk = fakeSdk();
    window.naver = { maps: sdk.api as never };
    renderMap('test-key');
    await screen.findByTestId('dashboard-naver-map');
    await waitFor(() => expect(sdk.clicks.size).toBe(4));
    const handlers = [...sdk.clicks.values()];
    expect(handlers).toHaveLength(4);
    handlers[0]();
    const callout = await screen.findByTestId('dashboard-map-callout');
    expect(within(callout).getByText(data.points[0].customerName)).toBeInTheDocument();
    expect(callout).toHaveTextContent(t.distance(data.points[0].distanceKm));
  });

  it('낭독기용 점 목록 단추로도 말풍선을 열 수 있다', async () => {
    const user = userEvent.setup();
    window.naver = { maps: fakeSdk().api as never };
    renderMap('test-key');
    const list = await screen.findByTestId('dashboard-map-point-list');
    await user.click(within(list).getAllByRole('button')[1]);
    expect(await screen.findByTestId('dashboard-map-callout')).toHaveTextContent(
      data.points[1].customerName,
    );
  });

  it('지도를 그린 뒤에 키 인증 실패가 와도 빈 지도를 남기지 않고 자리표시로 돌아간다', async () => {
    renderMap('test-key');
    const script = document.getElementById('naver-maps-sdk') as HTMLScriptElement;
    const sdk = fakeSdk();
    // 실제 SDK처럼 인증 실패 뒤의 정리 함수가 오류를 낸다.
    sdk.api.Map = class extends sdk.api.Map {
      destroy = () => {
        throw new TypeError("Cannot read properties of null (reading 'isArray')");
      };
    };
    window.naver = { maps: sdk.api as never };
    script.onload?.(new Event('load'));
    await screen.findByTestId('dashboard-naver-map');
    window.navermap_authFailure?.();
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-map-placeholder')).toHaveTextContent(t.mapFailed),
    );
    expect(screen.queryByTestId('dashboard-naver-map')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('dashboard-map-point')).toHaveLength(4);
    expect(screen.getByTestId('dashboard-map-legend')).toBeInTheDocument();
  });

  it('키 인증에 실패하면(허용 URL 미등록 등) 안내 문구와 함께 자리표시로 돌아간다', async () => {
    renderMap('bad-key');
    expect(document.getElementById('naver-maps-sdk')).not.toBeNull();
    window.navermap_authFailure?.();
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-map-placeholder')).toHaveTextContent(t.mapFailed),
    );
    expect(screen.getAllByTestId('dashboard-map-point')).toHaveLength(4);
    expect(document.getElementById('naver-maps-sdk')).toBeNull();
  });
});
