// 대시보드(S4): 오늘 확인할 것 · 건수 두 구역("관심 기업" → "영업 진행") · 일정 정렬 · 최근 기록 · 검색 · 배치 · 다섯 상태.
// 공정/산업군 막대는 영업 분석 화면으로 옮겼다(#679). 막대 검사는 SalesAnalysisPage.test.tsx에 있다.
// getDashboard는 가짜로 바꾼 확인이며 실제 서버(집계 API) 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import DashboardPage, { CALENDAR_MAX_WIDTH } from '../DashboardPage';
import { getDashboard } from '../../api/dashboard';
import type { Dashboard, TodayCheckRow } from '../../api/dashboardTypes';
import { ApiError } from '../../api/client';
import type { Envelope } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { sortSchedule } from '../../components/dashboard/ScheduleList';
import { bookmarkGrid } from '../../components/dashboard/CountCards';
import { filterName } from '../../components/list/ListViewBar';
import { dashboardTexts, states } from '../../labels/ko';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
// 지도 칸(#641)은 DashboardMap.test.tsx에서 따로 본다. 여기서는 응답이 오지 않게 막아 둔다.
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));

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
    it('#795: "영업 진행" 띠는 맨 위 오늘 브리핑에, "관심 기업" 칸은 맨 아래 접힌 "더 보기"에 제목과 함께 보인다', async () => {
      // 예전(#357·#766)에는 관심 기업 → 영업 진행 순이었다. PM 결정 2026-11-16(#795)으로 대시보드가
      // "오늘 할 일·방문 준비" 중심이 되어, 진행 띠는 브리핑으로 올리고 관심 기업 건수는 접어 둔다.
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const counts = await screen.findByTestId('dashboard-counts');
      expect(
        within(counts)
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['관심 기업']);
      const progress = screen.getByTestId('dashboard-section-progress');
      expect(within(progress).getByRole('heading', { level: 2 })).toHaveTextContent(
        '영업 진행 관심 기업 가운데 영업 대상으로 정한 뒤의 진행',
      );
      expect(screen.getByTestId('dashboard-progress-hint')).toHaveTextContent(
        dashboardTexts.progressSectionHint,
      );
      expect(screen.getByTestId('dashboard-brief')).toContainElement(progress);
      const more = screen.getByTestId('dashboard-more');
      expect(more).toContainElement(screen.getByTestId('dashboard-section-bookmark'));
      expect(more).not.toHaveAttribute('open');
      // 띠 칸 사이 화살표: 4칸이면 3개.
      expect(within(progress).getAllByTestId('dashboard-progress-arrow')).toHaveLength(3);
      expect(
        progress.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('칸은 약속한 순서로 이름·숫자를 보이고, 각 칸은 그 조건으로 걸러진 목록 주소를 가리킨다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      const bookmarkCells: Array<[string, string]> = [
        ['관심 기업 12곳', '/bookmarks'],
        ['의견 전 4곳', '/opportunities?filter=NO_OPINION'],
        ['검토 중 2곳', '/opportunities?filter=NEED_CHECK'],
      ];
      // 제외로 저장한 회사는 관심 기업에서 빠져(#536) "제외" 칸이 없다.
      // #766: "영업 진행"은 상세와 같은 4칸 띠. 보류 0곳은 띠 아래에 보이지 않고, 이번 주 일정·완료 칸은 없다.
      const progressCells: Array<[string, string]> = [
        ['미접촉 2곳', '/opportunities?filter=NOT_CONTACTED'],
        ['접촉 2곳', '/opportunities?filter=IN_CONTACT'],
        ['견적·샘플 1곳', '/opportunities?filter=QUOTE_SAMPLE'],
        ['성사 1곳', '/opportunities?filter=WON'],
      ];
      const read = (testId: string) =>
        within(screen.getByTestId(testId))
          .getAllByRole('link')
          .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]);
      expect(read('dashboard-section-bookmark')).toEqual(bookmarkCells);
      expect(read('dashboard-section-progress')).toEqual(progressCells);
      // 맨 앞 큰 칸은 관심 기업 전체다.
      expect(screen.getByTestId('dashboard-count-BOOKMARKED')).toHaveTextContent('관심 기업12곳');
      // #787: 세 칸은 큰 칸 2 : 1 : 1로 늘 한 줄이다(노트북 폭에서 "검토 중"만 다음 줄로 떨어지지 않게).
      expect(screen.getByTestId('dashboard-bookmark-cells').style.gridTemplateColumns).toBe(
        'minmax(0, 2fr) repeat(2, minmax(0, 1fr))',
      );
      // 칸 높이에 안쪽 여백이 더해져 아래 구역 제목과 겹치지 않게, 여백을 높이 안에 넣는다.
      expect(screen.getByTestId('dashboard-count-BOOKMARKED')).toHaveStyle({
        boxSizing: 'border-box',
      });
      expect(screen.queryByTestId('dashboard-count-DONE')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-count-SCHEDULE_DUE')).not.toBeInTheDocument();
      // 관심 기업이 있으면 "아직 없습니다" 안내는 보이지 않는다.
      expect(screen.queryByTestId('dashboard-bookmark-empty')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-counts-outdated')).not.toBeInTheDocument();
    });

    it.each([
      ['BOOKMARKED', '/bookmarks'],
      ['NOT_CONTACTED', '/opportunities?filter=NOT_CONTACTED'],
      ['WON', '/opportunities?filter=WON'],
    ])('%s 칸을 누르면 %s 로 이동한다', async (key, url) => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await userEvent.click(await screen.findByTestId(`dashboard-count-${key}`));
      expect(await screen.findByTestId('location')).toHaveTextContent(url);
    });

    it('관심 기업이 0곳이면 구역 아래에 신규 거래처 찾기로 가는 안내 한 줄이 보인다(메뉴 이름, #787)', async () => {
      const zero = Object.fromEntries(
        Object.keys(fixtureData.counts).map((key) => [key, 0]),
      ) as Dashboard['counts'];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, counts: zero }));
      renderPage();
      const notice = await screen.findByTestId('dashboard-bookmark-empty');
      expect(notice).toHaveTextContent(
        '아직 관심으로 고른 회사가 없습니다. 신규 거래처 찾기에서 [관심]을 눌러 담아 보세요',
      );
      expect(within(screen.getByTestId('dashboard-section-bookmark')).getByText(/아직 관심/)).toBe(
        notice,
      );
      const link = screen.getByTestId('dashboard-bookmark-empty-link');
      expect(link).toHaveTextContent(/^신규 거래처 찾기$/);
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

    it('새 모양인데 일부 칸만 빠져 있으면(옛 서버라 WON 없음) 그 칸만 빼고 나머지는 보이며, 보류가 있으면 띠 아래 한 줄', async () => {
      const { WON: _won, ...partial } = fixtureData.counts;
      void _won;
      mockedGet.mockResolvedValueOnce(
        reply({ ...fixtureData, counts: { ...partial, ON_HOLD: 2 } }),
      );
      renderPage();
      await screen.findByTestId('dashboard-counts');
      expect(screen.queryByTestId('dashboard-count-WON')).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId('dashboard-progress-band')).getAllByRole('link'),
      ).toHaveLength(3);
      expect(screen.getByTestId('dashboard-count-ON_HOLD')).toHaveTextContent('보류 2곳');
      expect(screen.getByTestId('dashboard-count-ON_HOLD')).toHaveAttribute(
        'href',
        '/opportunities?filter=ON_HOLD',
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

  it('bookmarkGrid: 칸이 하나면 한 칸 전체, 둘 이상이면 맨 앞만 2배 (#787)', () => {
    expect(bookmarkGrid(1)).toBe('minmax(0, 1fr)');
    expect(bookmarkGrid(2)).toBe('minmax(0, 2fr) repeat(1, minmax(0, 1fr))');
    expect(bookmarkGrid(3)).toBe('minmax(0, 2fr) repeat(2, minmax(0, 1fr))');
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

  describe('공정·산업군 막대는 영업 분석 화면으로 옮겼다 (#679)', () => {
    it('서버가 막대 값을 줘도 대시보드에는 막대도, 막대 자리 안내도 보이지 않는다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      expect(fixtureData.breakdown?.basis.total).toBe(8);
      expect(screen.queryByTestId('dashboard-breakdown')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-by-process')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-by-industry')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-breakdown-empty')).not.toBeInTheDocument();
      expect(screen.queryByText(dashboardTexts.breakdownProcessTitle)).not.toBeInTheDocument();
      expect(screen.queryByText(dashboardTexts.breakdownIndustryTitle)).not.toBeInTheDocument();
    });
  });

  describe('배치 (#795): 날짜·작은 검색 → 오늘 브리핑 → 오늘 할 일 → 작은 달력 → 방문 준비·지도 → 더 보기', () => {
    it('구역이 약속한 순서로 놓이고, 관심 기업 건수·최근 내 기록은 접힌 "더 보기" 안에 있다', async () => {
      // 예전(#679) 순서는 검색 → 오늘 확인할 것 → 큰 달력 → 건수 → 최근 기록 → 지도였다.
      // PM 결정 2026-11-16(#795): 대시보드는 오늘 할 일과 방문 나가기 전 정리용이라 순서를 바꿨다.
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      const order = [
        screen.getByTestId('dashboard-date'),
        screen.getByTestId('dashboard-search-input'),
        screen.getByTestId('dashboard-brief'),
        screen.getByTestId('dashboard-today'),
        screen.getByTestId('dashboard-calendar-section'),
        screen.getByTestId('dashboard-map-section'),
        screen.getByTestId('dashboard-more'),
      ];
      const more = screen.getByTestId('dashboard-more');
      expect(more).toContainElement(screen.getByTestId('dashboard-counts'));
      expect(more).toContainElement(screen.getByTestId('dashboard-recent-section'));
      expect(screen.getByTestId('dashboard-map-section')).toHaveTextContent(
        dashboardTexts.prepTitle,
      );
      for (let index = 1; index < order.length; index += 1) {
        expect(
          order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });
  });

  describe('오늘 확인할 것 (#679)', () => {
    const rows: TodayCheckRow[] = [
      {
        kind: 'SCHEDULE_TODAY',
        count: 3,
        items: [
          { oppId: 'opp-1', customerName: '가상정밀', dueAt: '2026-11-13', note: '견적' },
          { oppId: 'opp-2', customerName: '가상금속', dueAt: '2026-11-13', note: '방문' },
          { oppId: 'opp-3', customerName: '가상산업', dueAt: '2026-11-13', note: '' },
        ],
        listFilter: null,
      },
      {
        kind: 'SCHEDULE_OVERDUE',
        count: 1,
        items: [{ oppId: 'opp-4', customerName: '가상테크', dueAt: '2026-11-10', note: '전화' }],
        listFilter: null,
      },
      {
        kind: 'CHECK_LEFT',
        count: 2,
        items: [
          { oppId: 'opp-5', customerName: '가상도금', dueAt: null, note: null },
          { oppId: 'opp-6', customerName: '가상기계', dueAt: null, note: null },
        ],
        listFilter: 'CHECK_LEFT',
      },
    ];

    it('주제별 묶음(지난 일정 → 오늘 일정 → 확인할 것이 남은 관심 기업)으로 아이콘·제목·회사별 한 줄을 보인다(#766)', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: rows }));
      renderPage();
      const today = await screen.findByTestId('dashboard-today');
      expect(within(today).getByRole('heading', { level: 2 })).toHaveTextContent(
        dashboardTexts.todayTitle,
      );
      const groups = within(today).getAllByTestId('dashboard-today-row');
      expect(
        groups.map((group) => within(group).getByRole('heading', { level: 3 }).textContent),
      ).toEqual([
        '🔴지난 일정 — 했나요? 1건',
        '📅오늘 일정 3건',
        '🔍확인할 것이 남은 관심 기업 2곳모두 보기',
      ]);
      const todayItems = within(screen.getByTestId('dashboard-today-items-SCHEDULE_TODAY'))
        .getAllByTestId('dashboard-today-item')
        .map((item) => item.textContent);
      expect(todayItems).toEqual(['가상정밀견적', '가상금속방문', '가상산업']);
      const overdue = within(
        screen.getByTestId('dashboard-today-items-SCHEDULE_OVERDUE'),
      ).getByTestId('dashboard-today-item');
      expect(overdue).toHaveTextContent('가상테크11/10(화) · 전화');
      expect(within(overdue).getByRole('link', { name: '가상테크' })).toHaveAttribute(
        'href',
        '/opportunities/opp-4',
      );
      expect(screen.queryByTestId('dashboard-today-empty')).not.toBeInTheDocument();
    });

    it('묶음이 5곳을 넘으면 앞 5곳만 보이고 [더 보기 n곳]으로 편다', async () => {
      const many: TodayCheckRow[] = [
        {
          kind: 'SCHEDULE_TODAY',
          count: 7,
          items: Array.from({ length: 7 }, (_, i) => ({
            oppId: `opp-m${i}`,
            customerName: `가상${i}`,
            dueAt: '2026-11-13',
            note: '',
          })),
          listFilter: null,
        },
      ];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: many }));
      renderPage();
      const list = await screen.findByTestId('dashboard-today-items-SCHEDULE_TODAY');
      expect(within(list).getAllByTestId('dashboard-today-item')).toHaveLength(5);
      await userEvent.click(screen.getByTestId('dashboard-today-more-SCHEDULE_TODAY'));
      expect(within(list).getAllByTestId('dashboard-today-item')).toHaveLength(7);
    });

    it('"확인할 것이 남은 관심 회사" 줄을 누르면 그 회사들만 걸러진 목록으로 간다', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: rows }));
      renderPage();
      const link = await screen.findByTestId('dashboard-today-link-CHECK_LEFT');
      expect(link).toHaveAttribute('href', '/opportunities?filter=CHECK_LEFT');
      await userEvent.click(link);
      expect(await screen.findByTestId('location')).toHaveTextContent(
        '/opportunities?filter=CHECK_LEFT',
      );
    });

    it('걸러 본 목록의 머리에는 코드 이름이 아니라 줄 이름이 보인다', () => {
      expect(filterName('CHECK_LEFT')).toBe(dashboardTexts.todayRowNames.CHECK_LEFT);
    });

    it('줄이 하나도 없으면 "오늘 확인할 것이 없습니다" 한 줄만 보인다', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: [] }));
      renderPage();
      expect(await screen.findByTestId('dashboard-today-empty')).toHaveTextContent(
        dashboardTexts.todayEmpty,
      );
      expect(screen.queryByTestId('dashboard-today-row')).not.toBeInTheDocument();
    });

    it('0건인 줄과 이름표에 없는 종류의 줄은 보이지 않는다', async () => {
      const mixed: TodayCheckRow[] = [
        { kind: 'SCHEDULE_TODAY', count: 0, items: [], listFilter: null },
        { kind: 'LATER_KIND', count: 4, items: [], listFilter: null },
        rows[1],
      ];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: mixed }));
      renderPage();
      const today = await screen.findByTestId('dashboard-today');
      expect(within(today).getAllByTestId('dashboard-today-row')).toHaveLength(1);
      expect(within(today).getByTestId('dashboard-today-count-SCHEDULE_OVERDUE')).toHaveTextContent(
        '지난 일정 — 했나요? 1건',
      );
    });

    it('영업 비서 자리(#680)는 지금 비어 있다: 빈 상자도 안내 문구도 없다', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: rows }));
      renderPage();
      await screen.findByTestId('dashboard-today');
      expect(screen.queryByTestId('dashboard-today-assistant')).not.toBeInTheDocument();
    });

    it('서버가 옛 모양(줄 목록 칸 없음)이면 구역을 지어내지 않는다', async () => {
      const { todayChecks: _todayChecks, ...old } = fixtureData;
      void _todayChecks;
      mockedGet.mockResolvedValueOnce(reply(old));
      renderPage();
      await screen.findByTestId('dashboard-counts');
      expect(screen.queryByTestId('dashboard-today')).not.toBeInTheDocument();
    });
  });
});

describe('대시보드 › 작은 달력 크기(#825)', () => {
  it('달력 구역은 늘어나지 않고(최대 360px) 할 일 칸과 한 줄에 놓일 수 있는 기본 폭이다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('dashboard-counts');
    const calendar = screen.getByTestId('dashboard-calendar-section');
    // 노트북 폭에서 아래로 내려가도 줄 전체(예: 712px)로 늘어나지 않게: grow 0, 최대 폭 고정.
    expect(calendar.style.flex).toBe('0 1 340px');
    expect(calendar.style.maxWidth).toBe(`${CALENDAR_MAX_WIDTH}px`);
    // 할 일 칸 기본 폭 + 달력 기본 폭이 노트북 본문(약 760px) 안에 들어간다.
    const todo = screen.getByTestId('dashboard-today').parentElement as HTMLElement;
    expect(todo.style.flex).toBe('1 1 380px');
  });
});
