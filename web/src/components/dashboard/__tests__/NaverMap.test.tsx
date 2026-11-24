// 대시보드 지도 바탕을 네이버 지도로(#671). 실제 SDK 대신 window.naver.maps 가짜로 확인한다(실제 연결 확인 아님).
// 약속 C4 화면 지도 규칙: SDK에는 좌표·원 중심·반지름과 모양 그림만, 회사 이름·단계·거리는 넘기지 않는다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

function fakeSdk(
  project?: (point: { la: number; ln: number }) => { x: number; y: number },
  viewport?: { width: number; height: number },
) {
  const calls: Call[] = [];
  const clicks = new Map<unknown, () => void>();
  const listeners: { target: unknown; name: string; handler: () => void }[] = [];
  let mapElement: HTMLElement | null = null;
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
        mapElement = args[0] as HTMLElement;
        if (viewport) {
          Object.defineProperties(mapElement, {
            clientWidth: { value: viewport.width, configurable: true },
            clientHeight: { value: viewport.height, configurable: true },
          });
        }
      }
      fitBounds = (...args: unknown[]) => calls.push({ kind: 'fitBounds', args });
      // 기본은 모든 좌표가 같은 화면 위치로 온다(핀이 모두 겹친 상태). 펼친 자리({spread})는 그 화면 위치로 되돌린다(#898).
      getProjection = () => ({
        fromCoordToOffset: (point: LatLng | { spread: { x: number; y: number } }) =>
          'spread' in point ? point.spread : (project?.(point) ?? { x: 120, y: 80 }),
        fromOffsetToCoord: (offset: { x: number; y: number }) => ({
          spread: { x: offset.x, y: offset.y },
        }),
      });
      destroy = () => calls.push({ kind: 'destroy', args: [] });
    },
    LatLng,
    Point: class {
      constructor(
        public x: number,
        public y: number,
      ) {
        calls.push({ kind: 'Point', args: [x, y] });
      }
    },
    Circle: class {
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Circle', args });
      }
      getBounds = () => ({ bounds: true });
    },
    Marker: class {
      readonly iconNode?: HTMLElement;
      constructor(...args: unknown[]) {
        calls.push({ kind: 'Marker', args });
        const content = (args[0] as { icon?: { content?: unknown } }).icon?.content;
        if (content instanceof HTMLElement) {
          this.iconNode = content;
          mapElement?.append(content);
        }
      }
      setPosition = (...args: unknown[]) => calls.push({ kind: 'setPosition', args });
      setMap = () => this.iconNode?.remove();
    },
    Event: {
      addListener: (target: unknown, name: string, handler: () => void) => {
        calls.push({ kind: 'addListener', args: [name] });
        if (name === 'click') clicks.set(target, handler);
        if (name === 'click' && target instanceof api.Marker) {
          target.iconNode?.addEventListener('click', handler);
        }
        listeners.push({ target, name, handler });
      },
    },
  };
  return { api, calls, clicks, listeners };
}

function renderMap(clientId: string, compact = false) {
  return render(
    <MemoryRouter>
      <DashboardMap data={data} mapClientId={clientId} compact={compact} />
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

  it('확대·이동이 끝나면(idle) 겹친 점을 서로 떨어진 자리로 옮기고, 본사 핀은 그대로 둔다 (#898)', async () => {
    const sdk = fakeSdk();
    window.naver = { maps: sdk.api as never };
    renderMap('test-key');
    await waitFor(() => expect(sdk.calls.some((c) => c.kind === 'fitBounds')).toBe(true));
    const idle = sdk.listeners.find((l) => l.name === 'idle');
    expect(idle).toBeDefined();
    idle!.handler();
    // 회사 핀 4개만 자리를 받는다(본사는 움직이지 않음). 모두 같은 화면 위치였으므로 서로 다른 자리로 펼쳐진다.
    const moves = sdk.calls
      .filter((c) => c.kind === 'setPosition')
      .map((c) => (c.args[0] as { spread: { x: number; y: number } }).spread);
    expect(moves).toHaveLength(4);
    for (let i = 0; i < moves.length; i += 1) {
      for (let j = i + 1; j < moves.length; j += 1) {
        // 점 가운데 사이 16px(PIN_GAP) 이상 — 점 지름은 14px.
        expect(Math.hypot(moves[i].x - moves[j].x, moves[i].y - moves[j].y)).toBeGreaterThan(15.5);
      }
      expect(Math.hypot(moves[i].x - 120, moves[i].y - 80)).toBeGreaterThan(15.5);
    }
  });

  it('영업 홈 지도: 한자리에 겹친 회사는 숫자로 묶고, 살짝 겹친 점은 벌려 하나씩 누르게 한다 (#898·#900)', async () => {
    // Given: 회사 0·1은 거의 같은 자리(3px), 회사 2는 살짝 옆(12px), 회사 3은 멀리. 본사도 멀리.
    const spots = [
      { x: 300, y: 200 },
      { x: 303, y: 201 },
      { x: 312, y: 200 },
      { x: 450, y: 320 },
    ];
    const sdk = fakeSdk(({ la, ln }) => {
      const index = data.points.findIndex((point) => point.lat === la && point.lng === ln);
      return index >= 0 ? spots[index] : { x: 60, y: 40 };
    });
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);
    // When: 확대·이동이 끝난다(idle).
    const cluster = await screen.findByTestId('dashboard-map-cluster');
    act(() => sdk.listeners.filter(({ name }) => name === 'idle').forEach((l) => l.handler()));
    // Then: 0·1만 숫자 2로 묶이고, 점은 2개(회사 2·3)가 따로 그려진다.
    expect(cluster).toHaveTextContent('2');
    const dots = sdk.calls.filter(
      ({ kind, args: [options] }) =>
        kind === 'Marker' &&
        String((options as { icon?: { content?: unknown } }).icon?.content).includes(
          'dashboard-map-pin',
        ),
    );
    expect(dots).toHaveLength(2);
    // 점은 작은 색 점(그림 없음)이고 본사만 집 모양이다.
    expect(String((dots[0].args[0] as { icon: { content: string } }).icon.content)).toContain(
      'data-pin="dot"',
    );
    // 숫자 풍선과 살짝 옆 점은 서로 떨어진 자리로 옮겨져, 겹치지 않고 따로 누를 수 있다.
    const shown = sdk.calls
      .filter(({ kind }) => kind === 'setPosition')
      .slice(-3)
      .map(({ args: [at] }) => {
        const coord = at as { spread?: { x: number; y: number }; la?: number; ln?: number };
        if (coord.spread) return coord.spread;
        const index = data.points.findIndex((p) => p.lat === coord.la && p.lng === coord.ln);
        return spots[index];
      });
    const [bubble, near, far] = shown;
    expect(Math.hypot(bubble.x - near.x, bubble.y - near.y)).toBeGreaterThan(17.5);
    expect(far).toEqual(spots[3]);
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

  it('지도는 본사와 표시할 업체에 맞추고 겹친 점의 회사 카드를 연다', async () => {
    const user = userEvent.setup();
    const sdk = fakeSdk();
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);

    const cluster = await screen.findByTestId('dashboard-map-cluster');
    expect(cluster).toHaveTextContent(String(data.points.length));
    const fit = sdk.calls.find((call) => call.kind === 'fitBounds');
    expect(fit?.args[0]).toHaveLength(data.points.length + 1);
    const options = sdk.calls.find((call) => call.kind === 'Map')?.args[1];
    expect(options).toMatchObject({ scrollWheel: true, zoomControl: true });
    expect(
      sdk.calls.some(
        (call) => (call.args[0] as { icon?: { content?: unknown } })?.icon?.content === cluster,
      ),
    ).toBe(true);
    await user.click(cluster);

    const cards = screen.getByTestId('dashboard-map-cluster-list');
    expect(cards).toHaveTextContent(data.points[0].customerName);
    await user.click(within(cards).getByRole('button', { name: '같이 들를 곳으로 돌아가기' }));
    const visit = screen.getByTestId('dashboard-map-visit-cards');
    const picker = within(visit).getByRole('combobox', { name: '방문 기준' });
    expect(picker).toHaveValue(data.visitGroups?.[0].oppId);
    await user.selectOptions(picker, data.visitGroups![1].oppId);
    expect(visit).toHaveTextContent(t.visitNone);

    const focusedCluster = await screen.findByTestId('dashboard-map-cluster');
    await user.click(focusedCluster);
    const grouped = screen.getByTestId('dashboard-map-cluster-list');
    expect(within(grouped).getAllByRole('button', { name: /방문 기준으로 선택/ })).toHaveLength(2);
    await user.click(
      within(grouped).getByRole('button', { name: '가상 가나정밀 방문 기준으로 선택' }),
    );
    expect(picker).toHaveValue(data.visitGroups![0].oppId);
    expect(visit).toBeVisible();
    expect(visit).toHaveTextContent('가상 자차산업');
  });

  it('업체 점을 누르면 오른쪽에서 방문 기준·거리·상세 링크와 주변 업체를 함께 갱신한다', async () => {
    // Given: 서로 다른 위치의 업체와 각 업체의 방문 후보가 있다.
    const sdk = fakeSdk(({ la, ln }) => ({ x: ln * 10000, y: la * 10000 }));
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);
    await screen.findByTestId('dashboard-naver-map');
    await waitFor(() => expect(sdk.clicks.size).toBe(data.points.length));

    const visit = screen.getByTestId('dashboard-map-visit-cards');
    const picker = within(visit).getByRole('combobox', { name: '방문 기준' });
    expect(picker).toHaveValue('opp-map-1');
    const distance = within(visit).getByTestId('dashboard-map-visit-distance');
    const detail = within(visit).getByRole('link', { name: '자세히 보기' });
    expect(distance).toHaveTextContent('거산에서 12.3km');
    expect(detail).toHaveAttribute('href', '/opportunities/opp-map-1');
    const handlers = [...sdk.clicks.values()];
    // When: 지도에서 다른 방문 기준 업체의 점을 선택한다.
    act(() => handlers[3]());
    // Then: 오른쪽 카드가 그 업체의 정보로 바뀐다.
    expect(picker).toHaveValue('opp-map-4');
    expect(visit).toHaveTextContent('가상 파하볼트1.4km');
    expect(visit).not.toHaveTextContent('가상 자차산업');
    expect(distance).toHaveTextContent('거산에서 71.9km');
    expect(detail).toHaveAttribute('href', '/opportunities/opp-map-4');
    expect(screen.queryByTestId('dashboard-map-callout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-map-visit-route')).not.toBeInTheDocument();
    expect(sdk.calls.filter(({ kind }) => kind === 'fitBounds')).toHaveLength(1);

    act(() => handlers[2]());
    const callout = screen.getByTestId('dashboard-map-callout');
    expect(callout).toHaveTextContent('가상 마바플랜트');
    expect(within(callout).getByRole('link', { name: '자세히 보기' })).toHaveAttribute(
      'href',
      '/opportunities/opp-map-3',
    );
    expect(picker).toHaveValue('opp-map-4');
  });

  it('처음에는 방문 기준 업체를 강조하고 확대하면 펼쳐진 점 옆에 업체명을 표시한다', async () => {
    let close = false;
    const sdk = fakeSdk(
      ({ la, ln }) => {
        const index = data.points.findIndex((point) => point.lat === la && point.lng === ln);
        if (index >= 0) {
          return close ? { x: 210, y: 120 + index * 60 } : { x: 210, y: 150 };
        }
        return { x: 75, y: close && la !== data.center.lat ? 105 : 35 };
      },
      { width: 600, height: 420 },
    );
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);

    const label = await screen.findByTestId('dashboard-map-visit-base-label');
    expect(label).toHaveTextContent('가상 가나정밀 포함');
    expect(screen.queryByTestId('dashboard-map-company-label')).not.toBeInTheDocument();
    const hover = sdk.listeners.find(({ name }) => name === 'mouseover')!;
    act(() => hover.handler());
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('가상 가나정밀');
    expect(tooltip).toHaveTextContent('가상 다라금속');
    expect(tooltip).toHaveTextContent('외 2곳');
    expect(tooltip).not.toHaveTextContent('가상 마바플랜트');

    close = true;
    act(() =>
      sdk.listeners.filter(({ name }) => name === 'idle').forEach(({ handler }) => handler()),
    );
    expect(
      (await screen.findAllByTestId('dashboard-map-company-label')).map((item) => item.textContent),
    ).toEqual(data.points.slice(1).map((point) => point.customerName));
    expect(label).toHaveTextContent('가상 가나정밀');
    expect(label).not.toHaveTextContent('포함');
    expect(screen.queryByTestId('dashboard-map-cluster')).not.toBeInTheDocument();
  });

  it('지도 확대가 끝나고 점 사이가 멀어지면 묶음을 걷고 같은 위치의 개별 마커를 그린다', async () => {
    let zoomed = false;
    const sdk = fakeSdk(({ la, ln }) =>
      zoomed ? { x: ln * 10000, y: la * 10000 } : { x: 120, y: 80 },
    );
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);
    const cluster = await screen.findByTestId('dashboard-map-cluster');

    zoomed = true;
    const changed = sdk.listeners.find((row) => row.name === 'zoom_changed')!;
    act(() => changed.handler());
    expect(cluster).toBeInTheDocument();
    const idle = sdk.listeners.find((row) => row.name === 'idle')!;
    act(() => idle.handler());
    expect(cluster).not.toBeInTheDocument();

    const pointPositions = sdk.calls.flatMap(({ kind, args: [options] }) => {
      if (kind !== 'Marker') return [];
      const { icon, position } = options as {
        icon: { content: unknown };
        position: { la: number; ln: number };
      };
      return typeof icon.content === 'string' && icon.content.includes('dashboard-map-pin')
        ? [[position.la, position.ln]]
        : [];
    });
    expect(pointPositions).toEqual(data.points.map(({ lat, lng }) => [lat, lng]));
  });

  it('방문 기준을 지도에서 본 뒤 축소하면 겹치는 업체를 다시 숫자로 묶는다', async () => {
    const user = userEvent.setup();
    let zoomedIn = true;
    const sdk = fakeSdk(({ la, ln }) =>
      zoomedIn ? { x: ln * 10000, y: la * 10000 } : { x: 120, y: 80 },
    );
    window.naver = { maps: sdk.api as never };
    renderMap('test-key', true);
    await screen.findByTestId('dashboard-naver-map');

    const initialListeners = sdk.listeners.length;
    const visitCards = screen.getByTestId('dashboard-map-visit-cards');
    await user.click(within(visitCards).getByRole('button', { name: '지도에서 보기' }));
    expect(sdk.calls.filter(({ kind }) => kind === 'fitBounds').at(-1)?.args[0]).toEqual({
      bounds: true,
    });
    expect(screen.queryByTestId('dashboard-map-cluster')).not.toBeInTheDocument();

    zoomedIn = false;
    const focusListeners = sdk.listeners.slice(initialListeners);
    act(() =>
      focusListeners.filter(({ name }) => name === 'idle').forEach(({ handler }) => handler()),
    );
    expect(screen.getByTestId('dashboard-map-cluster')).toHaveTextContent(
      String(data.points.length),
    );
    expect(visitCards).toBeVisible();
  });

  it('점에 마우스를 올리면 그 위에 회사 이름이 뜨고, 내리면 사라진다(#673)', async () => {
    const sdk = fakeSdk();
    window.naver = { maps: sdk.api as never };
    renderMap('test-key');
    await screen.findByTestId('dashboard-naver-map');
    await waitFor(() => expect(sdk.clicks.size).toBe(4));
    const over = sdk.listeners.filter((row) => row.name === 'mouseover');
    expect(over).toHaveLength(4);
    act(() => over[1].handler());
    const tip = await screen.findByTestId('dashboard-map-hover');
    expect(tip).toHaveTextContent(data.points[1].customerName);
    expect(tip).toHaveStyle({ left: '120px' });
    const out = sdk.listeners.filter((row) => row.name === 'mouseout');
    act(() => out[1].handler());
    expect(screen.queryByTestId('dashboard-map-hover')).not.toBeInTheDocument();
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
