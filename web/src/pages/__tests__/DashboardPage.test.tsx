// 대시보드(S4): 건수 5개 · 일정 정렬 · 최근 기록 · 검색 · 공정/산업군 막대 · 다섯 상태.
// getDashboard는 가짜로 바꾼 확인이며 실제 서버(집계 API) 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import { getDashboard } from '../../api/dashboard';
import type { Dashboard } from '../../api/dashboardTypes';
import { ApiError } from '../../api/client';
import type { Envelope } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { sortSchedule } from '../../components/dashboard/ScheduleList';
import { dashboardTexts, states } from '../../labels/ko';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));

const mockedGet = vi.mocked(getDashboard);
const fixtureData = dashboardFixture.data as unknown as Dashboard;

function reply(data: Dashboard): Envelope<Dashboard> {
  return { data, meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' } };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(setBannerMeta: () => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta,
          setPageTitle: () => {},
        }}
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('불러오는 동안 자리표시를 보이고 끝나면 대시보드로 바뀐다', async () => {
    let resolve: (value: Envelope<Dashboard>) => void = () => {};
    mockedGet.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderPage();
    expect(screen.getByTestId('five-states-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('dashboard-counts')).not.toBeInTheDocument();
    resolve(reply(fixtureData));
    expect(await screen.findByTestId('dashboard-counts')).toBeInTheDocument();
  });

  it('불러오지 못하면 쉬운 말 오류와 [다시 시도]를 보이고, 누르면 다시 불러온다', async () => {
    mockedGet.mockRejectedValueOnce(
      new ApiError(500, {
        message: '대시보드를 가져오는 중 문제가 생겼습니다.',
        nextAction: '잠시 뒤 다시 시도해 주세요.',
        ref: 'r-9',
        kind: 'INTERNAL_ERROR',
      }),
    );
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(dashboardTexts.loadError);
    expect(alert).toHaveTextContent('대시보드를 가져오는 중 문제가 생겼습니다.');
    expect(alert).not.toHaveTextContent('INTERNAL_ERROR');

    await userEvent.click(screen.getByRole('button', { name: states.retry }));
    expect(await screen.findByTestId('dashboard-counts')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('건수 5개를 이름·숫자로 보이고, 누르면 그 단계로 걸러진 목록 주소로 간다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('dashboard-counts');
    const expected: Array<[string, string, string]> = [
      ['NOT_CONTACTED', '미접촉 12곳', '/opportunities?stage=NOT_EXECUTED'],
      ['INTERESTED', '관심 4곳', '/opportunities?stage=INTERESTED'],
      ['IN_CONTACT', '접촉 중 3곳', '/opportunities?stage=IN_PROGRESS'],
      ['QUOTE_SAMPLE', '견적·샘플 1곳', '/opportunities?stage=SAMPLE_OR_REGISTRATION_APPROVED'],
      ['SCHEDULE_DUE', '이번 주 일정 3건', '/opportunities?filter=SCHEDULE_DUE'],
    ];
    for (const [key, label, href] of expected) {
      const link = screen.getByTestId(`dashboard-count-${key}`);
      expect(link).toHaveAttribute('aria-label', label);
      expect(link).toHaveAttribute('href', href);
    }
    expect(within(screen.getByTestId('dashboard-counts')).getAllByRole('link')).toHaveLength(5);
  });

  it('건수를 누르면 /opportunities?stage=… 로 이동한다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await userEvent.click(await screen.findByTestId('dashboard-count-INTERESTED'));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/opportunities?stage=INTERESTED',
    );
  });

  it('일정은 기한 지남이 맨 위, 그다음 날짜순으로 보이고 지남 표시가 붙는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    const items = await screen.findAllByTestId('dashboard-schedule-item');
    expect(items.map((item) => item.textContent)).toEqual([
      '지남10/30 D테크(가상) 방문 일정 다시 잡기',
      '지남11/1 A정밀 견적 보내기',
      '11/4 B금속(가상) 공정 확인 질문 보내기',
      '11/6 C산업(가상) 샘플 결과 확인 전화',
    ]);
    expect(screen.getAllByTestId('dashboard-schedule-overdue')).toHaveLength(2);
  });

  it('sortSchedule은 원본 배열을 바꾸지 않고 지남 → 날짜 순으로 돌려준다', () => {
    const original = fixtureData.schedule;
    const before = original.map((item) => item.oppId);
    const sorted = sortSchedule(original);
    expect(sorted.map((item) => item.oppId)).toEqual(['opp-4', 'opp-1', 'opp-2', 'opp-3']);
    expect(original.map((item) => item.oppId)).toEqual(before);
  });

  it('일정이 없으면 안내 문구를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, schedule: [] }));
    renderPage();
    expect(await screen.findByTestId('dashboard-schedule-empty')).toHaveTextContent(
      dashboardTexts.scheduleEmpty,
    );
  });

  it('최근 내 기록은 날짜 · 회사 · 종류와 요약을 보이고 10건까지만 보인다', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...fixtureData.recentActivity[0],
      at: `2026-11-03T08:${String(59 - i).padStart(2, '0')}:00+09:00`,
      summary: `기록 ${i + 1}`,
    }));
    mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, recentActivity: many }));
    renderPage();
    const items = await screen.findAllByTestId('dashboard-recent-item');
    expect(items).toHaveLength(10);
    expect(items[0]).toHaveTextContent('11/3 B금속(가상) · 메모');
    expect(items[0]).toHaveTextContent('기록 1');
  });

  it('기록이 없으면 안내 문구를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, recentActivity: [] }));
    renderPage();
    expect(await screen.findByTestId('dashboard-recent-empty')).toHaveTextContent(
      dashboardTexts.recentEmpty,
    );
  });

  it('회사 이름을 검색하면 /opportunities?q=이름 으로 이동한다(앞뒤 공백은 지운다)', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await userEvent.type(await screen.findByTestId('dashboard-search-input'), '  A정밀 ');
    await userEvent.click(screen.getByTestId('dashboard-search-button'));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      `/opportunities?q=${encodeURIComponent('A정밀')}`,
    );
  });

  it('검색칸이 비어 있으면 이동하지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await userEvent.click(await screen.findByTestId('dashboard-search-button'));
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-counts')).toBeInTheDocument();
  });

  it('검색칸에는 이름표가 있고 검색 영역(role=search)으로 묶여 있다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('dashboard-counts');
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText(dashboardTexts.searchLabel)).toBeInTheDocument();
  });

  it('응답 meta를 띠에 알린다(가상 데이터 표시)', async () => {
    const setBannerMeta = vi.fn();
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage(setBannerMeta);
    await screen.findByTestId('dashboard-counts');
    await waitFor(() =>
      expect(setBannerMeta).toHaveBeenCalledWith(
        expect.objectContaining({ hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' }),
      ),
    );
  });

  describe('최근 내 기록은 고른 담당자 것이다 (#216 후속)', () => {
    type Frame = { staffKey: string | null; canRecord: boolean };
    const park: Frame = { staffKey: 'park-lee', canRecord: true };

    /** 담당자 값을 바꿔 다시 그릴 수 있게 틀 값만 받는 렌더 도우미. */
    function renderWithFrame(frame: Frame) {
      const tree = (value: Frame) => (
        <MemoryRouter initialEntries={['/']}>
          <FrameContext.Provider
            value={{
              config: null,
              staffKey: value.staffKey,
              setStaffKey: () => {},
              canRecord: value.canRecord,
              setBannerMeta: () => {},
              setPageTitle: () => {},
            }}
          >
            <Routes>
              <Route path="/" element={<DashboardPage />} />
            </Routes>
          </FrameContext.Provider>
        </MemoryRouter>
      );
      const view = render(tree(frame));
      return { change: (next: Frame) => view.rerender(tree(next)) };
    }

    const withRecent = (summary: string): Dashboard => ({
      ...fixtureData,
      recentActivity: [
        {
          at: '2026-11-05T09:00:00+09:00',
          oppId: 'opp-9',
          customerName: '시험 회사',
          kind: 'NOTE',
          summary,
        },
      ],
    });

    it('기록할 수 있는 담당자를 골랐으면 그 키를 서버에 보낸다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderWithFrame(park);
      await screen.findByTestId('dashboard-counts');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0][1]).toBe('park-lee');
    });

    it.each([
      ['보기 전용', { staffKey: 'viewer', canRecord: false }],
      ['담당자 미선택', { staffKey: null, canRecord: false }],
    ])('%s이면 키를 보내지 않는다', async (_name, frame) => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderWithFrame(frame);
      await screen.findByTestId('dashboard-counts');
      expect(mockedGet.mock.calls[0][1] ?? null).toBeNull();
    });

    it('담당자를 바꾸면 이전 요청을 중단하고 다시 읽어 새 담당자의 기록이 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply(withRecent('박 담당의 메모')));
      mockedGet.mockResolvedValueOnce(reply(withRecent('김 과장의 메모')));
      const { change } = renderWithFrame(park);
      expect(await screen.findByText('박 담당의 메모')).toBeInTheDocument();
      const firstSignal = mockedGet.mock.calls[0][0] as AbortSignal;

      change({ staffKey: 'kim-gwajang', canRecord: true });
      expect(await screen.findByText('김 과장의 메모')).toBeInTheDocument();
      expect(screen.queryByText('박 담당의 메모')).not.toBeInTheDocument();
      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(mockedGet.mock.calls[1][1]).toBe('kim-gwajang');
      expect(firstSignal.aborted).toBe(true);
    });

    it('바뀌는 동안에는 이전 담당자의 기록을 그대로 두지 않고 불러오는 중으로 바뀐다', async () => {
      let resolveSecond: (value: Envelope<Dashboard>) => void = () => {};
      mockedGet.mockResolvedValueOnce(reply(withRecent('박 담당의 메모')));
      mockedGet.mockReturnValueOnce(new Promise((r) => (resolveSecond = r)));
      const { change } = renderWithFrame(park);
      await screen.findByText('박 담당의 메모');
      change({ staffKey: 'kim-gwajang', canRecord: true });
      expect(await screen.findByTestId('five-states-loading')).toBeInTheDocument();
      expect(screen.queryByText('박 담당의 메모')).not.toBeInTheDocument();
      resolveSecond(reply(withRecent('김 과장의 메모')));
      expect(await screen.findByText('김 과장의 메모')).toBeInTheDocument();
    });

    it('이전 담당자의 응답이 늦게 와도 새 담당자 화면을 덮지 않는다', async () => {
      let resolveFirst: (value: Envelope<Dashboard>) => void = () => {};
      mockedGet.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
      mockedGet.mockResolvedValueOnce(reply(withRecent('김 과장의 메모')));
      const { change } = renderWithFrame(park);
      change({ staffKey: 'kim-gwajang', canRecord: true });
      expect(await screen.findByText('김 과장의 메모')).toBeInTheDocument();
      // 박 담당 요청이 이제야 끝난다(이미 중단된 요청).
      resolveFirst(reply(withRecent('박 담당의 메모')));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.getByText('김 과장의 메모')).toBeInTheDocument();
      expect(screen.queryByText('박 담당의 메모')).not.toBeInTheDocument();
    });

    it('같은 담당자로 다시 그려도 서버를 또 부르지 않는다', async () => {
      mockedGet.mockResolvedValue(reply(fixtureData));
      const { change } = renderWithFrame(park);
      await screen.findByTestId('dashboard-counts');
      change({ ...park });
      await new Promise((r) => setTimeout(r, 50));
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('공정·산업군 막대', () => {
    it('breakdown이 없으면 막대 줄을 숨긴다(실제 집계 전 전달본에 가짜 숫자가 보이면 안 된다)', async () => {
      const { breakdown: _breakdown, ...withoutBreakdown } = fixtureData;
      void _breakdown;
      mockedGet.mockResolvedValueOnce(reply(withoutBreakdown));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      expect(screen.queryByTestId('dashboard-breakdown')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-by-process')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-breakdown-empty')).not.toBeInTheDocument();
    });

    it('공정 9종은 0곳도 모두 보이고 "3곳 (38%)" 형식으로 개수와 비율을 글자로 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const process = await screen.findByTestId('dashboard-by-process');
      expect(screen.getByTestId('dashboard-breakdown-basis')).toHaveTextContent(
        dashboardTexts.breakdownBasis(8),
      );
      const rows = within(process).getAllByTestId('dashboard-by-process-row');
      expect(rows).toHaveLength(9);
      expect(rows[0]).toHaveTextContent('아연도금(전기아연도금)');
      expect(rows[0]).toHaveTextContent('3곳 (38%)');
      expect(rows[2]).toHaveTextContent('알카리 흑착(흑색산화피막)');
      expect(rows[2]).toHaveTextContent('0곳 (0%)');
    });

    it('산업군 막대는 AI 제안이 섞였을 때 "AI 제안 포함"을 알리고 미확정도 센다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const industry = await screen.findByTestId('dashboard-by-industry');
      expect(within(industry).getByTestId('dashboard-by-industry-proposed')).toHaveTextContent(
        dashboardTexts.breakdownProposed,
      );
      const rows = within(industry).getAllByTestId('dashboard-by-industry-row');
      expect(rows.at(-1)).toHaveTextContent('미확정');
      expect(rows.at(-1)).toHaveTextContent('4곳 (50%)');
    });

    it('AI 제안이 하나도 없으면 "AI 제안 포함"을 보이지 않는다', async () => {
      const noProposed: Dashboard = {
        ...fixtureData,
        breakdown: {
          ...fixtureData.breakdown!,
          byIndustry: fixtureData.breakdown!.byIndustry.map((item) => ({
            ...item,
            includesProposed: false,
          })),
        },
      };
      mockedGet.mockResolvedValueOnce(reply(noProposed));
      renderPage();
      await screen.findByTestId('dashboard-by-industry');
      expect(screen.queryByTestId('dashboard-by-industry-proposed')).not.toBeInTheDocument();
    });

    it('대시보드 대상이 0곳이면 막대 대신 안내와 [추천 목록 가기]를 보인다', async () => {
      const empty: Dashboard = {
        ...fixtureData,
        breakdown: { basis: { statuses: [], total: 0 }, byProcess: [], byIndustry: [] },
      };
      mockedGet.mockResolvedValueOnce(reply(empty));
      renderPage();
      expect(await screen.findByTestId('dashboard-breakdown-empty')).toHaveTextContent(
        dashboardTexts.breakdownEmptyText,
      );
      expect(screen.queryByTestId('dashboard-by-process')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-breakdown-empty-link')).toHaveAttribute(
        'href',
        '/opportunities',
      );
      expect(screen.getByTestId('dashboard-breakdown-empty-link')).toHaveTextContent(
        dashboardTexts.breakdownEmptyAction,
      );
    });
  });
});
