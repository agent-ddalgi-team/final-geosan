// 대시보드 지도(#641): 원 3개·점 모양·범례·말풍선·빈 상태·좌표 없는 회사 줄.
// 가짜 응답(고정값 파일)으로만 확인했으며 실제 서버(#642)·네이버 지도 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardMap, { offsetKm } from '../DashboardMap';
import DashboardMapSection from '../DashboardMapSection';
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

  it('점을 묶음별 모양으로 그리고 범례에 곳 수를 함께 적는다', () => {
    renderMap(data);
    const points = screen.getAllByTestId('dashboard-map-point');
    expect(points).toHaveLength(4);
    const shapeOf = (group: string) =>
      points.find((p) => p.getAttribute('data-group') === group)!.firstElementChild!
        .nextElementSibling!;
    expect(shapeOf('INTERESTED').tagName).toBe('circle');
    expect(shapeOf('IN_PROGRESS').tagName).toBe('polygon');
    expect(shapeOf('WON_THIS_YEAR').tagName).toBe('polygon');
    const items = screen.getAllByTestId('dashboard-map-legend-item').map((i) => i.textContent);
    expect(items).toEqual(['●관심 2곳', '◆진행 중 1곳', '★올해 성공 1곳']);
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

  it('대상이 0곳이면 안내와 [추천 목록 가기]를 보이고 지도는 그리지 않는다', () => {
    renderMap({ ...data, points: [], missingCoordinates: 0 });
    expect(screen.getByTestId('dashboard-map-empty')).toHaveTextContent(t.emptyText);
    expect(screen.getByTestId('dashboard-map-empty-link')).toHaveAttribute(
      'href',
      '/opportunities',
    );
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
