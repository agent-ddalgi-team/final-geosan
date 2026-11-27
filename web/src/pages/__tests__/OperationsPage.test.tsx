// #799 운영 관리 화면과 대시보드 운영 알림. 서버 응답은 가짜(실제 계산은 서버 시험 test_operations.py).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getOperations } from '../../api/operations';
import type { Operations } from '../../api/operations';
import { ApiError } from '../../api/client';
import type { ConfigUi } from '../../api/types';
import type { TodayCheckRow } from '../../api/dashboardTypes';
import TodayChecks from '../../components/dashboard/TodayChecks';
import { FrameContext } from '../../components/frame/FrameContext';
import SideMenu from '../../components/frame/SideMenu';
import OperationsPage from '../OperationsPage';
import fixture from '../../test/fixtures/config-ui.json';
import { accent, colors, warn } from '../../theme/tokens';
import { todayKst } from '../../utils/time';

vi.mock('../../api/operations', async (original) => ({
  ...(await original<typeof import('../../api/operations')>()),
  getOperations: vi.fn(),
}));
vi.mock('../../api/menuBadges', async (original) => ({
  ...(await original<typeof import('../../api/menuBadges')>()),
  getMenuBadges: vi.fn().mockResolvedValue({ data: { dashboard: 0, list: 0, bookmarks: 0 } }),
}));

const mocked = vi.mocked(getOperations);
const config = {
  ...(fixture as unknown as { data: ConfigUi }).data,
  operationsStaffKeys: ['choi-pm'],
} as ConfigUi;

const data: Operations = {
  usage: {
    month: '2026-11',
    calls: 4,
    callLimit: 1000,
    costUsd: 16.5,
    costLimitUsd: 20,
    alertRatio: 0.8,
    groups: [
      { group: 'RESEARCH', calls: 2, costUsd: 15 },
      { group: 'WEB_SEARCH', calls: 1, costUsd: 1 },
      { group: 'SALES', calls: 1, costUsd: 0.5 },
    ],
    daily: [
      { day: '2026-11-13', costUsd: 1 },
      { day: '2026-11-16', costUsd: 15.5 },
    ],
    autoResearchToday: { usedUsd: 0.8, limitUsd: 1 },
  },
  sources: [
    {
      source: 'FACTORY_FILE',
      asOf: '2025-12-31',
      loadedAt: '2026-11-06T00:00:00Z',
      rows: 20195,
      refreshDueAt: '2026-06-29',
      refreshOverdue: true,
    },
    {
      source: 'WATER_LIST',
      asOf: null,
      loadedAt: null,
      rows: 0,
      refreshDueAt: null,
      refreshOverdue: false,
    },
  ],
  blocked: [
    {
      occurredAt: '2026-11-16T01:00:00Z',
      purpose: 'EXTERNAL_AI',
      kind: 'PUBLIC_TEXT',
      reason: '가상 거부',
    },
  ],
};

function frame(staffKey: string | null, children: React.ReactNode) {
  return (
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== null,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        {children}
      </FrameContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => mocked.mockReset());

it('Given 운영 담당 / When 운영 관리 / Then 사용액·쓰임새별·날짜별·오늘 자동 조사·자료 현황·막힌 전송이 보인다', async () => {
  mocked.mockResolvedValueOnce({ data, meta: {} });
  render(frame('choi-pm', <OperationsPage />));
  expect(await screen.findByTestId('ops-usage-total')).toHaveTextContent(
    '$16.50 / 한도 $20.00 (83%)',
  );
  expect(mocked).toHaveBeenCalledWith(expect.anything(), 'choi-pm');
  expect(screen.getByTestId('ops-usage-group-RESEARCH')).toHaveTextContent(
    '회사 조사·후보 판단$15.00 · 2회',
  );
  expect(within(screen.getByTestId('ops-usage-daily')).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByTestId('ops-auto-research')).toHaveTextContent(
    '오늘 자동 조사 $0.80 / 하루 $1.00',
  );
  expect(screen.getByTestId('ops-source-FACTORY_FILE')).toHaveTextContent(
    '산단공 등록공장현황 파일2025-12-31',
  );
  // #972: "(지남)" 괄호 글 → 날짜 옆 주의 꼬리표 "지남"(뜻은 같고 모양만 바뀜).
  expect(screen.getByTestId('ops-source-FACTORY_FILE')).toHaveTextContent('2026-06-29 지남');
  expect(screen.getByTestId('ops-source-overdue')).toHaveTextContent('지남');
  expect(screen.getByTestId('ops-source-WATER_LIST')).toHaveTextContent('—');
  expect(screen.getAllByTestId('ops-blocked-row')[0]).toHaveTextContent('가상 거부');
  expect(screen.queryByRole('button', { name: /갱신|실행/ })).not.toBeInTheDocument();
});

describe('새 톤(#972)', () => {
  it('사용액이 알림 비율 이상이면 막대가 주의색이고 "알림 기준 80% 이상"을 알린다', async () => {
    // 16.5 / 20 = 83% ≥ 알림 비율 80%
    mocked.mockResolvedValueOnce({ data, meta: {} });
    render(frame('choi-pm', <OperationsPage />));
    expect(await screen.findByTestId('ops-usage-bar')).toHaveStyle({ background: warn.dot });
    expect(screen.getByTestId('ops-usage-over')).toHaveTextContent('알림 기준 80% 이상입니다');
    expect(screen.getByTestId('ops-usage-over')).toHaveStyle({ color: warn.text });
    // 쓰임새별 막대는 알림과 상관없이 보라 계열이다.
    expect(screen.getByTestId('ops-usage-group-bar-RESEARCH')).toHaveStyle({
      background: accent.line,
    });
  });

  it('알림 비율에 못 미치면 막대가 보라이고 주의 글은 없다(바로 아래 값 79.5%)', async () => {
    mocked.mockResolvedValueOnce({
      data: { ...data, usage: { ...data.usage, costUsd: 15.9 } },
      meta: {},
    });
    render(frame('choi-pm', <OperationsPage />));
    expect(await screen.findByTestId('ops-usage-bar')).toHaveStyle({ background: accent.bright });
    expect(screen.queryByTestId('ops-usage-over')).not.toBeInTheDocument();
  });

  it('알림 비율과 꼭 같으면(80%) 전과 같은 기준대로 주의색이다', async () => {
    mocked.mockResolvedValueOnce({
      data: { ...data, usage: { ...data.usage, costUsd: 16 } },
      meta: {},
    });
    render(frame('choi-pm', <OperationsPage />));
    expect(await screen.findByTestId('ops-usage-bar')).toHaveStyle({ background: warn.dot });
  });

  it('날짜별 막대는 오늘만 진한 보라, 나머지는 옅은 보라이고 막대마다 금액·날짜를 읽을 수 있다', async () => {
    const today = todayKst();
    mocked.mockResolvedValueOnce({
      data: {
        ...data,
        usage: {
          ...data.usage,
          daily: [
            { day: '2026-01-02', costUsd: 1 },
            { day: today, costUsd: 0.5 },
          ],
        },
      },
      meta: {},
    });
    render(frame('choi-pm', <OperationsPage />));
    const items = within(await screen.findByTestId('ops-usage-daily')).getAllByRole('listitem');
    expect(items.map((item) => item.dataset.today)).toEqual(['false', 'true']);
    const bars = screen.getAllByTestId('ops-usage-daily-bar');
    expect(bars[0]).toHaveStyle({ background: accent.softDeep });
    expect(bars[1]).toHaveStyle({ background: accent.bg });
    expect(items[0]).toHaveAttribute('aria-label', '01-02 $1.00');
    expect(items[0]).toHaveTextContent('$1.001/2');
    expect(items[1]).toHaveAttribute('aria-current', 'date');
    expect(screen.getByTestId('ops-daily')).toHaveTextContent('이번 달 쓴 날 2일');
  });

  it('자료 현황 표 머리는 흐린 글자이고, 지나지 않은 자료에는 "지남" 꼬리표가 없다', async () => {
    mocked.mockResolvedValueOnce({ data, meta: {} });
    render(frame('choi-pm', <OperationsPage />));
    const sources = await screen.findByTestId('ops-sources');
    const heads = within(sources).getAllByRole('columnheader');
    expect(heads.map((head) => head.textContent)).toEqual([
      '자료',
      '기준일',
      '넣은 날',
      '행 수',
      '다음 갱신 권장',
    ]);
    for (const head of heads) expect(head).toHaveStyle({ color: colors.textDimmed });
    expect(
      within(screen.getByTestId('ops-source-WATER_LIST')).queryByTestId('ops-source-overdue'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-blocked-count')).toHaveTextContent('1건');
  });
});

it('운영 담당이 아니면 서버 403을 "운영 담당만" 안내로 보인다', async () => {
  mocked.mockRejectedValueOnce(
    new ApiError(403, {
      code: 'FORBIDDEN',
      message: '운영 관리 화면은 운영 담당만 볼 수 있습니다.',
      nextAction: '운영 담당으로 골라 주세요.',
    } as never),
  );
  render(frame('park-lee', <OperationsPage />));
  // 머리 문구(화면)와 서버 안내가 같은 말이다.
  expect(
    (await screen.findAllByText(/운영 관리 화면은 운영 담당만 볼 수 있습니다/)).length,
  ).toBeGreaterThan(0);
  expect(screen.queryByTestId('ops-page')).not.toBeInTheDocument();
});

it('왼쪽 메뉴 "운영 관리"는 설정의 운영 담당에게만 맨 아래에 보인다', () => {
  const { unmount } = render(frame('choi-pm', <SideMenu narrowDevice={false} />));
  const links = screen.getAllByRole('link');
  expect(links[links.length - 1]).toHaveAttribute('data-testid', 'nav-operations-link');
  expect(links[links.length - 1]).toHaveAttribute('href', '/operations');
  unmount();
  render(frame('park-lee', <SideMenu narrowDevice={false} />));
  expect(screen.queryByTestId('nav-operations-link')).not.toBeInTheDocument();
});

const alertRows: TodayCheckRow[] = [
  {
    kind: 'AI_USAGE_ALERT',
    count: 1,
    items: [],
    listFilter: null,
    alert: { usedUsd: 16.5, limitUsd: 20, percent: 83, asOf: null, dueAt: null },
  },
  {
    kind: 'DATA_REFRESH_DUE',
    count: 1,
    items: [],
    listFilter: null,
    alert: {
      usedUsd: null,
      limitUsd: null,
      percent: null,
      asOf: '2025-12-31',
      dueAt: '2026-06-29',
    },
  },
];

it('대시보드 오늘 확인할 것 맨 앞에 운영 알림 줄과 [운영 관리 →]이 보인다(운영 담당)', () => {
  render(frame('choi-pm', <TodayChecks rows={alertRows} />));
  expect(screen.getByTestId('dashboard-today-alert-AI_USAGE_ALERT')).toHaveTextContent(
    'AI 사용 83% ($16.50/$20.00)운영 관리 →',
  );
  expect(screen.getByTestId('dashboard-today-alert-DATA_REFRESH_DUE')).toHaveTextContent(
    '공장현황 자료(2025-12-31 기준) 갱신할 때가 지났습니다',
  );
  expect(screen.getByTestId('dashboard-today-alert-link-AI_USAGE_ALERT')).toHaveAttribute(
    'href',
    '/operations',
  );
  expect(screen.queryByTestId('dashboard-today-empty')).not.toBeInTheDocument();
});

it('한도 도달 줄은 영업 담당에게도 보이고, 운영 담당이 아니면 [운영 관리 →]는 없다', () => {
  render(
    frame(
      'park-lee',
      <TodayChecks
        rows={[
          {
            kind: 'AI_LIMIT_REACHED',
            count: 1,
            items: [],
            listFilter: null,
            alert: { usedUsd: 21, limitUsd: 20, percent: 105, asOf: null, dueAt: null },
          },
        ]}
      />,
    ),
  );
  expect(screen.getByTestId('dashboard-today-alert-AI_LIMIT_REACHED')).toHaveTextContent(
    '이번 달 AI 한도에 닿아 조사·코치가 멈췄습니다',
  );
  expect(
    screen.queryByTestId('dashboard-today-alert-link-AI_LIMIT_REACHED'),
  ).not.toBeInTheDocument();
});
