// 대시보드(S4): 건수 두 구역("관심 기업" → "영업 진행") · 일정 정렬 · 최근 기록 · 검색 · 공정/산업군 막대 · 다섯 상태.
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

  describe('건수 두 구역 (#357: 관심으로 고른 회사만 센다)', () => {
    it('"관심 기업" 구역이 먼저, "영업 진행" 구역이 그 아래에 제목과 함께 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const counts = await screen.findByTestId('dashboard-counts');
      const titles = within(counts)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent);
      expect(titles).toEqual([
        '관심 기업',
        '영업 진행 관심 기업 가운데 검토 권고를 받은 뒤의 진행',
      ]);
      expect(screen.getByTestId('dashboard-progress-hint')).toHaveTextContent(
        dashboardTexts.progressSectionHint,
      );
      const bookmark = screen.getByTestId('dashboard-section-bookmark');
      const progress = screen.getByTestId('dashboard-section-progress');
      // 문서 순서로 관심 기업 구역이 영업 진행 구역보다 앞이다.
      expect(
        bookmark.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('칸은 약속한 순서로 이름·숫자를 보이고, 각 칸은 그 조건으로 걸러진 목록 주소를 가리킨다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      const bookmarkCells: Array<[string, string]> = [
        ['관심 기업 12곳', '/opportunities?bookmarked=true'],
        ['의견 전 4곳', '/opportunities?filter=NO_OPINION'],
        ['추가 확인 필요 2곳', '/opportunities?filter=NEED_CHECK'],
      ];
      // 검토 대상 제외로 저장한 회사는 관심 기업에서 빠져(#536) "제외" 칸이 없다.
      const progressCells: Array<[string, string]> = [
        ['미접촉 2곳 (검토 권고 · 접촉 전)', '/opportunities?filter=NOT_CONTACTED'],
        ['접촉 중 2곳', '/opportunities?filter=IN_CONTACT'],
        ['견적·샘플 1곳', '/opportunities?filter=QUOTE_SAMPLE'],
        ['보류 0곳', '/opportunities?filter=ON_HOLD'],
        ['완료 1곳', '/opportunities?filter=DONE'],
        ['이번 주 일정 3건', '/opportunities?filter=SCHEDULE_DUE'],
      ];
      const read = (testId: string) =>
        within(screen.getByTestId(testId))
          .getAllByRole('link')
          .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]);
      expect(read('dashboard-section-bookmark')).toEqual(bookmarkCells);
      expect(read('dashboard-section-progress')).toEqual(progressCells);
      // 맨 앞 큰 칸은 관심 기업 전체다.
      expect(screen.getByTestId('dashboard-count-BOOKMARKED')).toHaveTextContent('관심 기업12곳');
      // 칸 높이에 안쪽 여백이 더해져 아래 구역 제목과 겹치지 않게, 여백을 높이 안에 넣는다.
      expect(screen.getByTestId('dashboard-count-BOOKMARKED')).toHaveStyle({
        boxSizing: 'border-box',
      });
      // "미접촉" 칸에는 작은 풀이가 붙는다.
      expect(screen.getByTestId('dashboard-count-NOT_CONTACTED-hint')).toHaveTextContent(
        dashboardTexts.notContactedHint,
      );
      // 관심 기업이 있으면 "아직 없습니다" 안내는 보이지 않는다.
      expect(screen.queryByTestId('dashboard-bookmark-empty')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-counts-outdated')).not.toBeInTheDocument();
    });

    it.each([
      ['BOOKMARKED', '/opportunities?bookmarked=true'],
      ['NOT_CONTACTED', '/opportunities?filter=NOT_CONTACTED'],
      ['SCHEDULE_DUE', '/opportunities?filter=SCHEDULE_DUE'],
    ])('%s 칸을 누르면 %s 로 이동한다', async (key, url) => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await userEvent.click(await screen.findByTestId(`dashboard-count-${key}`));
      expect(await screen.findByTestId('location')).toHaveTextContent(url);
    });

    it('관심 기업이 0곳이면 구역 아래에 추천 목록으로 가는 안내 한 줄이 보인다', async () => {
      const zero = Object.fromEntries(
        Object.keys(fixtureData.counts).map((key) => [key, 0]),
      ) as Dashboard['counts'];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, counts: zero }));
      renderPage();
      const notice = await screen.findByTestId('dashboard-bookmark-empty');
      expect(notice).toHaveTextContent(
        '아직 관심으로 고른 회사가 없습니다. 추천 목록에서 [관심]을 눌러 담아 보세요',
      );
      expect(within(screen.getByTestId('dashboard-section-bookmark')).getByText(/아직 관심/)).toBe(
        notice,
      );
      const link = screen.getByTestId('dashboard-bookmark-empty-link');
      expect(link).toHaveTextContent(/^추천 목록$/);
      expect(link).toHaveAttribute('href', '/opportunities');
      // 0곳도 서버가 준 숫자이므로 칸은 그대로 보인다.
      expect(screen.getByTestId('dashboard-count-BOOKMARKED')).toHaveAttribute(
        'aria-label',
        '관심 기업 0곳',
      );
    });

    it('서버가 옛 모양(관심 기업 건수 없음)을 주면 숫자를 0으로 지어내지 않고 두 구역 대신 안내를 보인다', async () => {
      const oldShape = {
        NOT_CONTACTED: 12,
        INTERESTED: 4,
        IN_CONTACT: 3,
        QUOTE_SAMPLE: 1,
        SCHEDULE_DUE: 3,
      } as unknown as Dashboard['counts'];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, counts: oldShape }));
      renderPage();
      expect(await screen.findByTestId('dashboard-counts-outdated')).toHaveTextContent(
        dashboardTexts.countsOutdated,
      );
      expect(screen.queryByTestId('dashboard-section-bookmark')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-section-progress')).not.toBeInTheDocument();
      // 옛 미접촉(전체 회사 기준 12곳)은 뜻이 달라 새 "미접촉" 칸에 넣지 않는다.
      expect(screen.queryByTestId('dashboard-count-NOT_CONTACTED')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-count-BOOKMARKED')).not.toBeInTheDocument();
      expect(screen.getByTestId('dashboard-counts')).not.toHaveTextContent('0곳');
      // 뜻이 그대로인 이번 주 일정과 아래 일정 달력·최근 기록은 계속 보인다.
      expect(screen.getByTestId('dashboard-count-SCHEDULE_DUE')).toHaveAttribute(
        'aria-label',
        '이번 주 일정 3건',
      );
      expect(screen.getByTestId('dashboard-calendar')).toBeInTheDocument();
    });

    it('새 모양인데 일부 칸만 빠져 있으면 그 칸만 빼고 나머지는 보인다', async () => {
      const { DONE: _done, ...partial } = fixtureData.counts;
      void _done;
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, counts: partial }));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      expect(screen.queryByTestId('dashboard-count-DONE')).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId('dashboard-section-progress')).getAllByRole('link'),
      ).toHaveLength(5);
      expect(screen.getByTestId('dashboard-count-ON_HOLD')).toHaveAttribute(
        'aria-label',
        '보류 0곳',
      );
    });
  });

  describe('일정 달력과 날짜 팝업 (일정 목록 자리를 달력이 맡는다)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('일정이 있는 날을 누르면 작은 창에 회사·건·내용이 보이고, 기한 지남에는 지남 표시가 붙는다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-05T03:00:00Z'));
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      expect(await screen.findByTestId('dashboard-calendar-title')).toHaveTextContent(
        '2026년 11월',
      );
      // 11/1(A정밀 견적 보내기)은 기한이 지났다.
      await userEvent.click(screen.getByTestId('dashboard-calendar-day-2026-11-01'));
      const popover = screen.getByTestId('dashboard-calendar-popover');
      expect(popover).toHaveAttribute('aria-modal', 'false');
      expect(popover).toHaveTextContent('A정밀');
      expect(popover).toHaveTextContent('견적 보내기');
      expect(screen.getByTestId('dashboard-schedule-overdue')).toBeInTheDocument();
      expect(
        within(popover).getByRole('link', { name: dashboardTexts.popoverDetail }),
      ).toHaveAttribute('href', '/opportunities/opp-1');
      // 다른 날을 누르면 그 날 내용으로 바뀌고, [닫기]를 누르면 닫힌다.
      await userEvent.click(screen.getByTestId('dashboard-calendar-day-2026-11-06'));
      expect(screen.getByTestId('dashboard-calendar-popover')).toHaveTextContent('C산업(가상)');
      expect(screen.queryByTestId('dashboard-schedule-overdue')).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId('dashboard-calendar-popover-close'));
      expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
    });

    it('일정이 있는 칸과 달리 일정이 없는 날은 눌러도 팝업이 열리지 않는다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-05T03:00:00Z'));
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await userEvent.click(await screen.findByTestId('dashboard-calendar-day-2026-11-05'));
      expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
    });
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
      dashboardTexts.calendarEmpty,
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
