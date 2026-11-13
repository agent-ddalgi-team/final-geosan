// 대시보드 지도 "같이 들를 곳"(#673). 가짜 응답으로만 확인한다(실제 서버·네이버 연결 확인 아님).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardMap from '../DashboardMap';
import { NEARBY_ICON, resetNaverMapsLoader } from '../NaverMapCanvas';
import type { DashboardMap as MapData } from '../../../api/dashboardMapTypes';
import mapFixture from '../../../test/fixtures/dashboard-map.json';
import { dashboardMapTexts as t } from '../../../labels/ko';

const data = mapFixture.data as unknown as MapData;

function renderMap(value: MapData, clientId = '') {
  return render(
    <MemoryRouter>
      <DashboardMap data={value} mapClientId={clientId} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  delete window.naver;
  delete window.navermap_authFailure;
  document.getElementById('naver-maps-sdk')?.remove();
  resetNaverMapsLoader();
});

describe('같이 들를 곳(#673)', () => {
  it('묶음 줄은 단계 · 회사 이름 · 거산 거리 → 근처 N곳 순서로, 진행 중이 먼저 보인다', () => {
    renderMap(data);
    const section = screen.getByTestId('dashboard-visit-groups');
    expect(section).toHaveTextContent(t.visitTitle);
    expect(section).toHaveTextContent(t.visitHint(5));
    const rows = within(section).getAllByTestId('dashboard-visit-row');
    expect(rows.map((row) => row.textContent)).toEqual([
      '▸ 진행 중 · 가상 가나정밀 · 거산에서 12.3km → 근처 2곳',
      '▸ 관심 · 가상 다라금속 · 거산에서 38.4km → 근처 0곳',
      '▸ 관심 · 가상 사아테크 · 거산에서 71.9km → 근처 1곳',
    ]);
  });

  it('줄을 누르면 근처 회사가 가까운 순으로 펼쳐지고 이름은 자세히 보기로 이어진다. 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    renderMap(data);
    const [first] = screen.getAllByTestId('dashboard-visit-row');
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByTestId('dashboard-visit-nearby')).getAllByTestId(
      'dashboard-visit-nearby-item',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      '가상 자차산업 1.8km · 후보',
      '가상 카타정공 3.2km · 후보',
    ]);
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', '/opportunities/opp-near-1');
    await user.click(first);
    expect(screen.queryByTestId('dashboard-visit-nearby')).not.toBeInTheDocument();
  });

  it('근처 후보가 없으면 그렇게 알린다', async () => {
    const user = userEvent.setup();
    renderMap(data);
    await user.click(screen.getAllByTestId('dashboard-visit-row')[1]);
    expect(screen.getByTestId('dashboard-visit-none')).toHaveTextContent(t.visitNone);
  });

  it('진행 중·관심 회사가 없으면 빈 안내, 옛 응답(칸 없음)이면 칸을 그리지 않는다', () => {
    const { unmount } = renderMap({ ...data, visitGroups: [] });
    expect(screen.getByTestId('dashboard-visit-empty')).toHaveTextContent(t.visitEmpty);
    unmount();
    renderMap({ ...data, visitGroups: undefined, visitRadiusKm: undefined });
    expect(screen.queryByTestId('dashboard-visit-groups')).not.toBeInTheDocument();
  });

  it('네이버 지도에서 묶음을 펼치면 반경 원과 근처 ○를 그리고, 회사 이름은 SDK에 넘기지 않는다', async () => {
    const user = userEvent.setup();
    const calls: { kind: string; args: unknown[] }[] = [];
    const record =
      (kind: string) =>
      (...args: unknown[]) =>
        calls.push({ kind, args });
    class Base {
      constructor(...args: unknown[]) {
        calls.push({ kind: this.constructor.name, args });
      }
    }
    window.naver = {
      maps: {
        Map: class Map extends Base {
          fitBounds = record('fitBounds');
          destroy = () => {};
        },
        LatLng: class LatLng extends Base {
          lat = () => 0;
        },
        Point: class Point extends Base {},
        Circle: class Circle extends Base {
          getBounds = () => ({});
        },
        Marker: class Marker extends Base {},
        Event: { addListener: () => undefined },
      } as never,
    };
    renderMap(data, 'test-key');
    await screen.findByTestId('dashboard-naver-map');
    await waitFor(() => expect(calls.some((c) => c.kind === 'fitBounds')).toBe(true));
    calls.length = 0;
    await user.click(screen.getAllByTestId('dashboard-visit-row')[0]);
    await waitFor(() => expect(calls.some((c) => c.kind === 'fitBounds')).toBe(true));
    const circles = calls.filter((c) => c.kind === 'Circle');
    expect(circles.map((c) => (c.args[0] as { radius: number }).radius)).toContain(5000);
    const nearbyMarkers = calls.filter(
      (c) =>
        c.kind === 'Marker' &&
        (c.args[0] as { icon?: { content?: string } }).icon?.content === NEARBY_ICON,
    );
    expect(nearbyMarkers).toHaveLength(2);
    const sent = JSON.stringify(
      calls.filter((c) => c.kind !== 'Map').map((c) => c.args),
      (key, value) => (key === 'map' ? 'MAP' : value),
    );
    for (const name of ['가상 자차산업', '가상 카타정공', '가상 가나정밀']) {
      expect(sent).not.toContain(name);
    }
  });
});
