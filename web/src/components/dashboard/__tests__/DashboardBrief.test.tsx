// #795 대시보드 재구성: 맨 위 "오늘 브리핑" 칸과 "방문 준비" 줄. 가짜 응답(가상 회사)으로만 본다.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardBrief from '../DashboardBrief';
import VisitPrep, { prepItems } from '../VisitPrep';
import type { DashboardScheduleItem, TodayCheckRow } from '../../../api/dashboardTypes';
import type { DashboardMap } from '../../../api/dashboardMapTypes';

const counts = { BOOKMARKED: 3, NOT_CONTACTED: 2, IN_CONTACT: 1, QUOTE_SAMPLE: 0, WON: 1 };

function rows(handoff: number): TodayCheckRow[] {
  const list: TodayCheckRow[] = [
    { kind: 'SCHEDULE_OVERDUE', count: 1, items: [], listFilter: null },
    { kind: 'SCHEDULE_TODAY', count: 2, items: [], listFilter: null },
  ];
  if (handoff > 0)
    list.push({ kind: 'HANDOFF_FOR_ME', count: handoff, items: [], listFilter: null });
  return list;
}

function schedule(oppId: string, name: string, dueAt: string, note = '방문', overdue = false) {
  return {
    oppId,
    customerName: name,
    oppTitle: '가상 건',
    dueAt,
    note,
    overdue,
    staffKey: 'park-lee',
  } satisfies DashboardScheduleItem;
}

const map: DashboardMap = {
  center: { lat: 36.8, lng: 127.1 },
  ringsKm: [30, 50, 100],
  points: [
    {
      oppId: 'opp-1',
      customerName: '가상정밀',
      lat: 36.9,
      lng: 127.2,
      group: 'IN_PROGRESS',
      distanceKm: 8.2,
    },
    {
      oppId: 'opp-2',
      customerName: '가상금속',
      lat: 36.7,
      lng: 127.0,
      group: 'INTERESTED',
      distanceKm: 12,
    },
  ],
  missingCoordinates: 0,
  asOf: '2026-11-16T00:00:00Z',
  visitRadiusKm: 5,
  visitGroups: [
    {
      oppId: 'opp-1',
      nearby: [
        {
          oppId: 'opp-9',
          customerName: '가상볼트',
          lat: 0,
          lng: 0,
          distanceKm: 3.4,
          group: 'INTERESTED',
        },
        {
          oppId: 'opp-8',
          customerName: '가상도금',
          lat: 0,
          lng: 0,
          distanceKm: 1.5,
          group: 'INTERESTED',
        },
      ],
    },
  ],
};

describe('오늘 브리핑 (#795)', () => {
  it('일정 칸은 "지난 1 · 오늘 2", 전달 사항이 있으면 칸이 생기고, 진행 띠는 화살표 흐름으로 보인다', () => {
    render(
      <MemoryRouter>
        <DashboardBrief rows={rows(1)} counts={counts} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dashboard-brief-schedule-counts')).toHaveTextContent(
      '지난 1 · 오늘 2',
    );
    expect(screen.getByTestId('dashboard-brief-handoff')).toHaveTextContent('확인 전 1곳');
    const progress = screen.getByTestId('dashboard-section-progress');
    expect(within(progress).getAllByTestId('dashboard-progress-arrow')).toHaveLength(3);
    expect(within(progress).getByTestId('dashboard-count-NOT_CONTACTED')).toHaveAttribute(
      'href',
      '/opportunities?filter=NOT_CONTACTED',
    );
  });

  it('전달 사항이 0이면 칸이 없고, 일정이 없으면 "오늘 일정 없음"', () => {
    render(
      <MemoryRouter>
        <DashboardBrief rows={[]} counts={counts} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('dashboard-brief-handoff')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-brief-schedule-counts')).toHaveTextContent(
      '오늘 일정 없음',
    );
  });

  it('옛 서버라 관심 기업 건수가 없으면 띠를 그리지 않는다(안내는 아래 "더 보기"에서 한 번만)', () => {
    render(
      <MemoryRouter>
        <DashboardBrief rows={rows(0)} counts={{ SCHEDULE_DUE: 2 }} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('dashboard-section-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-counts-outdated')).not.toBeInTheDocument();
  });
});

describe('방문 준비 (#795)', () => {
  const items = [
    schedule('opp-2', '가상금속', '2026-11-18', '견적 전달'),
    schedule('opp-1', '가상정밀', '2026-11-16'),
    schedule('opp-3', '가상지난', '2026-11-12', '방문', true),
    schedule('opp-4', '가상먼날', '2026-11-30'),
  ];

  it('오늘부터 7일 안 일정만 날짜순으로 고르고, 지난 일정·먼 일정은 뺀다', () => {
    expect(prepItems(items, '2026-11-16').map((item) => item.customerName)).toEqual([
      '가상정밀',
      '가상금속',
    ]);
  });

  it('회사마다 [보고서 ↗](새 창)·[상세] 링크와, 지도 응답이 있으면 거산 → 회사 → 가장 가까운 관심 기업 거리 줄', () => {
    render(
      <MemoryRouter>
        <VisitPrep items={items} today="2026-11-16" map={map} />
      </MemoryRouter>,
    );
    const rowsShown = screen.getAllByTestId('dashboard-prep-item');
    expect(rowsShown).toHaveLength(2);
    expect(rowsShown[0]).toHaveTextContent('가상정밀오늘 · 방문');
    const report = within(rowsShown[0]).getByTestId('dashboard-prep-report');
    expect(report).toHaveAttribute('href', '/opportunities/opp-1/report');
    expect(report).toHaveAttribute('target', '_blank');
    expect(within(rowsShown[0]).getByTestId('dashboard-prep-detail')).toHaveAttribute(
      'href',
      '/opportunities/opp-1',
    );
    expect(within(rowsShown[0]).getByTestId('dashboard-prep-route')).toHaveTextContent(
      '거산─8.2km→가상정밀─1.5km→가상도금· 같이 들를 곳 2곳',
    );
    // 같이 들를 곳이 없으면 거산 → 회사까지만.
    expect(within(rowsShown[1]).getByTestId('dashboard-prep-route')).toHaveTextContent(
      '거산─12.0km→가상금속',
    );
    expect(within(rowsShown[1]).getByTestId('dashboard-prep-route')).not.toHaveTextContent('같이');
  });

  it('지도를 못 받았으면 거리 줄 없이 목록만, 일정이 없으면 안내 한 줄', () => {
    const { unmount } = render(
      <MemoryRouter>
        <VisitPrep items={items} today="2026-11-16" map={undefined} />
      </MemoryRouter>,
    );
    expect(screen.getAllByTestId('dashboard-prep-item')).toHaveLength(2);
    expect(screen.queryByTestId('dashboard-prep-route')).not.toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <VisitPrep items={[]} today="2026-11-16" map={map} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dashboard-prep-empty')).toBeInTheDocument();
  });
});
