// 대시보드 지도(#641): 원 3개·점 모양·범례·말풍선·빈 상태·좌표 없는 회사 줄.
// 가짜 응답(고정값 파일)으로만 확인했으며 실제 서버(#642)·네이버 지도 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardMap, { offsetKm } from '../DashboardMap';
import DashboardMapSection from '../DashboardMapSection';
import { DASHBOARD_MAP_HEIGHT, DASHBOARD_MAP_STACKED_HEIGHT } from '../NaverMapCanvas';
import { getDashboardMap } from '../../../api/dashboardMap';
import type { DashboardMap as MapData } from '../../../api/dashboardMapTypes';
import mapFixture from '../../../test/fixtures/dashboard-map.json';
import { dashboardMapTexts as t } from '../../../labels/ko';

vi.mock('../../../api/dashboardMap', () => ({ getDashboardMap: vi.fn() }));
const mockedGet = vi.mocked(getDashboardMap);
const data = mapFixture.data as unknown as MapData;

function renderMap(value: MapData) {
  return render(
    <MemoryRouter>
      <DashboardMap data={value} mapClientId="" />
    </MemoryRouter>,
  );
}

describe('DashboardMap', () => {
  it('거산 본사와 30/50/100km 원 3개를 그린다', () => {
    renderMap(data);
    expect(screen.getByTestId('dashboard-map-hq')).toHaveTextContent(t.hqLabel);
    const rings = screen.getAllByTestId('dashboard-map-ring');
    expect(rings.map((r) => r.textContent)).toEqual(['100km', '50km', '30km']);
  });

  it('회사는 묶음별 색 점으로만(그림 없이), 거산 본사만 집 모양으로 그리고 범례에 곳 수를 함께 적는다', () => {
    // #898(PM 2026-11-23): 관심 빨강 · 진행 중 파랑 · 올해 성공 노랑 점, 본사만 집. 점을 잇는 선은 없다.
    renderMap(data);
    const points = screen.getAllByTestId('dashboard-map-point');
    expect(points).toHaveLength(4);
    for (const point of points) {
      const pin = point.querySelector('[data-pin]')!;
      expect(pin.getAttribute('data-pin')).toBe('dot');
      expect(pin.getAttribute('data-kind')).toBe(point.getAttribute('data-group'));
      expect(pin.querySelector('path')).toBeNull();
      expect(point.querySelector('line')).toBeNull();
    }
    expect(screen.getByTestId('dashboard-map-hq').querySelector('[data-pin]')).toHaveAttribute(
      'data-pin',
      'house',
    );
    const items = screen.getAllByTestId('dashboard-map-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['관심 2곳', '진행 중 1곳', '올해 성공 1곳']);
    expect(items.map((i) => i.querySelector('[data-pin]')!.getAttribute('data-kind'))).toEqual([
      'INTERESTED',
      'IN_PROGRESS',
      'WON_THIS_YEAR',
    ]);
    expect(screen.getByTestId('dashboard-map-legend-hq')).toHaveTextContent(t.hqLabel);
  });

  it('점을 누르면 이름·단계·거리와 [자세히 보기]가 든 말풍선이 열리고, 닫을 수 있다', async () => {
    const user = userEvent.setup();
    renderMap(data);
    expect(screen.queryByTestId('dashboard-map-callout')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '가상 가나정밀 · 진행 중 · 12.3km' }));
    const callout = screen.getByTestId('dashboard-map-callout');
    expect(callout).toHaveTextContent('가상 가나정밀');
    expect(callout).toHaveTextContent('진행 중 · 거산에서 12.3km');
    expect(within(callout).getByTestId('dashboard-map-detail-link')).toHaveAttribute(
      'href',
      '/opportunities/opp-map-1',
    );
    await user.click(screen.getByTestId('dashboard-map-callout-close'));
    expect(screen.queryByTestId('dashboard-map-callout')).not.toBeInTheDocument();
  });

  it('키보드(Enter)로도 점을 고를 수 있다', async () => {
    const user = userEvent.setup();
    renderMap(data);
    // 지도 아래 "같이 들를 곳"(#673) 줄에도 회사 이름이 있어 지도 그림 안에서 찾는다.
    within(screen.getByRole('group', { name: t.title }))
      .getByRole('button', { name: /가상 다라금속/ })
      .focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('dashboard-map-callout')).toHaveTextContent('가상 다라금속');
  });

  it('좌표 없는 회사가 있으면 지도 아래에 한 줄로 알린다', () => {
    renderMap(data);
    expect(screen.getByTestId('dashboard-map-missing')).toHaveTextContent('좌표 없는 회사 2곳');
  });

  it('대상이 0곳이면 안내와 [거래처 후보로 이동]을 보이고 지도는 그리지 않는다(메뉴 이름, #787)', () => {
    renderMap({ ...data, points: [], missingCoordinates: 0 });
    expect(screen.getByTestId('dashboard-map-empty')).toHaveTextContent(t.emptyText);
    expect(screen.getByTestId('dashboard-map-empty-link')).toHaveAttribute(
      'href',
      '/opportunities',
    );
    expect(screen.getByTestId('dashboard-map-empty-link')).toHaveTextContent('거래처 후보로 이동');
    expect(screen.queryByTestId('dashboard-map')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-map-missing')).not.toBeInTheDocument();
  });

  it('지도 업체의 검색·길찾기 주소를 부르지 않는다', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = renderMap(data);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector('a[href^="http"], script[src]')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('동서·남북 거리를 km로 바꾼다(위도 1도 ≈ 110km)', () => {
    const off = offsetKm({ lat: 36.8, lng: 126.9 }, { lat: 37.8, lng: 126.9 });
    expect(off.x).toBeCloseTo(0, 5);
    expect(off.y).toBeGreaterThan(109);
    expect(off.y).toBeLessThan(112);
  });
});

describe('DashboardMapSection', () => {
  beforeEach(() => mockedGet.mockReset());

  it('불러오면 지도를 보이고, 실패하면 오류와 [다시 시도]를 보인 뒤 다시 불러온다', async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValueOnce(new Error('network'));
    mockedGet.mockResolvedValueOnce({ data, meta: { hasVirtualData: true } } as never);
    render(
      <MemoryRouter>
        <DashboardMapSection />
      </MemoryRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t.loadError);
    await user.click(within(alert).getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('dashboard-map')).toBeInTheDocument());
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});

describe('#983 영업 홈: 지도(위, 낮게) + 같이 들를 곳(아래)으로 쌓기', () => {
  beforeEach(() => mockedGet.mockReset());

  function renderCompact(stacked: boolean) {
    return render(
      <MemoryRouter>
        <DashboardMap data={data} mapClientId="" compact stacked={stacked} />
      </MemoryRouter>,
    );
  }

  it('쌓으면 지도가 위, 같이 들를 곳이 그 아래에 한 줄씩 놓이고 지도 높이가 낮아진다', () => {
    renderCompact(true);
    const box = screen.getByTestId('dashboard-map');
    expect(box).toHaveAttribute('data-stacked', 'true');
    expect(box).toHaveStyle({ display: 'flex', flexDirection: 'column' });
    const picture = screen.getByRole('group', { name: t.title });
    const nearby = screen.getByTestId('dashboard-map-nearby');
    expect(box).toContainElement(picture);
    expect(box).toContainElement(nearby);
    expect(picture.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 같이 들를 곳 목록(방문 기준 고르기)이 그 칸 안에 그대로 있다.
    expect(nearby).not.toBeEmptyDOMElement();
    expect(picture.style.height).toBe(`${DASHBOARD_MAP_STACKED_HEIGHT}px`);
    expect(DASHBOARD_MAP_STACKED_HEIGHT).toBe(250);
    expect(DASHBOARD_MAP_STACKED_HEIGHT).toBeLessThan(DASHBOARD_MAP_HEIGHT);
  });

  it('쌓지 않으면(다른 화면이 쓸 때) 지금처럼 지도 | 같이 들를 곳이 나란히 놓이고 지도 높이도 그대로다', () => {
    renderCompact(false);
    const box = screen.getByTestId('dashboard-map');
    expect(box).not.toHaveAttribute('data-stacked');
    expect(box.style.flexDirection).toBe('');
    expect(box.style.flexWrap).toBe('wrap');
    expect(screen.getByRole('group', { name: t.title }).style.height).toBe(
      `${DASHBOARD_MAP_HEIGHT}px`,
    );
  });

  it('지도 구역(DashboardMapSection)에 stacked를 주면 불러온 지도를 쌓아 그린다', async () => {
    mockedGet.mockResolvedValueOnce({ data, meta: { hasVirtualData: true } } as never);
    render(
      <MemoryRouter>
        <DashboardMapSection title="지도" stacked />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('dashboard-map')).toHaveAttribute('data-stacked', 'true');
    expect(screen.getByTestId('dashboard-map-section')).toHaveTextContent('지도');
  });
});
