// 대시보드(S4): 오늘 할 일 · 전달 사항 · 영업 단계 칩 · 관심 기업 건수 · 일정 정렬 · 최근 기록 · 검색 · 배치 · 다섯 상태.
// #921(PM 결정 2026-11-25): 출근하면 · 외근 전 · 누가 봐도 세 칸. 진행 중인 회사 표는 ProgressTable.test.tsx.
// 공정/산업군 막대는 영업 분석 화면으로 옮겼다(#679). 막대 검사는 SalesAnalysisPage.test.tsx에 있다.
// getDashboard는 가짜로 바꾼 확인이며 실제 서버(집계 API) 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import DashboardPage, {
  CALENDAR_MAX_WIDTH,
  greetingDate,
  greetingName,
  todoCount,
} from '../DashboardPage';
import { getDashboard } from '../../api/dashboard';
import { getDashboardMap } from '../../api/dashboardMap';
import { getSalesAnalysis } from '../../api/salesAnalysis';
import dashboardMapFixture from '../../test/fixtures/dashboard-map.json';
import type { Dashboard, TodayCheckRow } from '../../api/dashboardTypes';
import { ApiError, getOpportunities } from '../../api/client';
import type { ConfigUi, Envelope } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { sortSchedule } from '../../components/dashboard/ScheduleList';
import { bookmarkGrid } from '../../components/dashboard/CountCards';
import { filterName } from '../../components/list/ListViewBar';
import { dashboardTexts, frame, states } from '../../labels/ko';
import { colors, groupMarkPalette, homePalette, stepArrow, tagPalette } from '../../theme/tokens';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
// 지도 칸(#641)은 DashboardMap.test.tsx에서 따로 본다. 여기서는 응답이 오지 않게 막아 둔다.
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));
// 월별 접촉 추세(#972)는 HomeTrend.test.tsx에서 따로 본다. 여기서는 기본으로 응답이 오지 않게 막아 둔다.
vi.mock('../../api/salesAnalysis', () => ({
  getSalesAnalysis: vi.fn(() => new Promise(() => {})),
}));
// 먼저 볼 후보(#972)도 마찬가지다(TopCandidates.test.tsx). 목록 읽기만 막고 나머지 요청 함수는 그대로 둔다.
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(() => new Promise(() => {})),
}));

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
    it('#972: 영업 단계는 인사말 줄 아래 숫자 카드 5칸, "관심 기업" 칸은 맨 아래 접힌 "더 보기"에 보인다', async () => {
      // #921(PM 결정 2026-11-25)의 작은 칩 한 줄을 #972(새 디자인, 2026-11-27)에서 큰 카드 5칸으로 바꿨다.
      // 보류도 서버가 숫자를 주면 0곳이어도 카드로 보인다(5칸 자리).
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const counts = await screen.findByTestId('dashboard-counts');
      expect(
        within(counts)
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['관심 기업']);
      expect(screen.queryByTestId('dashboard-section-progress')).not.toBeInTheDocument();
      const chips = screen.getByTestId('dashboard-stage-chips');
      expect(
        within(chips)
          .getAllByRole('button')
          .map((chip) => chip.getAttribute('aria-label')),
      ).toEqual(['미접촉 2곳', '접촉 2곳', '견적·샘플 1곳', '성사 1곳', '보류 0곳']);
      // 순서가 있는 네 칸 사이에만 화살표 3개(보류 앞에는 없다).
      expect(within(chips).getAllByTestId('dashboard-stage-arrow')).toHaveLength(3);
      expect(screen.getByTestId('dashboard-stage-chip-NOT_CONTACTED')).toHaveTextContent(
        '미접촉2곳',
      );
      // 인사말 줄(제목 · 날짜 · 검색) 아래에 따로 놓인다.
      const header = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement;
      expect(header).toContainElement(screen.getByTestId('dashboard-date'));
      expect(header).not.toContainElement(chips);
      expect(
        screen.getByTestId('dashboard-date').compareDocumentPosition(chips) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const more = screen.getByTestId('dashboard-more');
      expect(more).toContainElement(screen.getByTestId('dashboard-section-bookmark'));
      expect(more).not.toHaveAttribute('open');
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
      // #921: 영업 단계 칸은 맨 위 칩으로 옮겨 이 구역에는 없다.
      const read = (testId: string) =>
        within(screen.getByTestId(testId))
          .getAllByRole('link')
          .map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')]);
      expect(read('dashboard-section-bookmark')).toEqual(bookmarkCells);
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

    it.each([['BOOKMARKED', '/bookmarks']])('%s 칸을 누르면 %s 로 이동한다', async (key, url) => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      await userEvent.click(await screen.findByTestId(`dashboard-count-${key}`));
      expect(await screen.findByTestId('location')).toHaveTextContent(url);
    });

    it('관심 기업이 0곳이면 구역 아래에 거래처 후보로 가는 안내 한 줄이 보인다(메뉴 이름, #787)', async () => {
      const zero = Object.fromEntries(
        Object.keys(fixtureData.counts).map((key) => [key, 0]),
      ) as Dashboard['counts'];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, counts: zero }));
      renderPage();
      const notice = await screen.findByTestId('dashboard-bookmark-empty');
      expect(notice).toHaveTextContent(
        '아직 관심으로 고른 회사가 없습니다. 거래처 후보에서 [관심]을 눌러 담아 보세요',
      );
      expect(within(screen.getByTestId('dashboard-section-bookmark')).getByText(/아직 관심/)).toBe(
        notice,
      );
      const link = screen.getByTestId('dashboard-bookmark-empty-link');
      expect(link).toHaveTextContent(/^거래처 후보$/);
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

    it('#972 단계 카드: 순서가 있는 네 칸은 흰 카드 + 얇은 실선 테두리, 보류는 화살표 없이 점선 테두리', async () => {
      // #929의 "회사가 있는 칸 연파랑 · 성사 진한 파랑"은 새 디자인에서 모두 흰 카드로 바뀌었다.
      mockedGet.mockResolvedValueOnce(
        reply({ ...fixtureData, counts: { ...fixtureData.counts, NOT_CONTACTED: 0, ON_HOLD: 1 } }),
      );
      renderPage();
      await screen.findByTestId('dashboard-stage-chips');
      for (const band of ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON']) {
        const card = screen.getByTestId(`dashboard-stage-chip-${band}`);
        expect(card).toHaveStyle({ background: colors.bgContainer, borderRadius: '12px' });
        expect(card.style.border).toContain('solid');
        expect(card).not.toHaveAttribute('data-hold');
      }
      const hold = screen.getByTestId('dashboard-stage-chip-ON_HOLD');
      expect(hold).toHaveAttribute('data-hold', 'true');
      expect(hold).toHaveStyle({ background: homePalette.holdBg });
      expect(hold.style.border).toContain('dashed');
      // 화살표는 앞 세 카드 뒤에만 있다: 성사 뒤(보류 앞)와 보류 뒤에는 없다.
      const arrowAfter = (band: string) =>
        within(screen.getByTestId(`dashboard-stage-chip-${band}`).parentElement!).queryByTestId(
          'dashboard-stage-arrow',
        );
      expect(arrowAfter('NOT_CONTACTED')).toBeInTheDocument();
      expect(arrowAfter('IN_CONTACT')).toBeInTheDocument();
      expect(arrowAfter('QUOTE_SAMPLE')).toBeInTheDocument();
      expect(arrowAfter('WON')).not.toBeInTheDocument();
      expect(arrowAfter('ON_HOLD')).not.toBeInTheDocument();
      // 화살표는 꾸밈이라 화면 읽기 도구가 읽지 않고, 카드(단추) 밖에 있어 단추 이름에 섞이지 않는다.
      expect(arrowAfter('NOT_CONTACTED')).toHaveAttribute('aria-hidden', 'true');
      expect(arrowAfter('NOT_CONTACTED')).toHaveStyle({
        width: `${stepArrow.size}px`,
        borderRadius: '50%',
      });
    });

    it('#972 단계 카드: 고른 카드는 강조 연한 바탕 + 강조 테두리로 바뀐다', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const card = await screen.findByTestId('dashboard-stage-chip-IN_CONTACT');
      await userEvent.click(card);
      expect(card).toHaveAttribute('aria-pressed', 'true');
      expect(card).toHaveStyle({ background: homePalette.blueBg });
    });

    it('#972 단계 카드: 그 단계에 멈춘 회사가 있으면 "멈춘 회사 n곳" 주의 꼬리표가 붙고, 없거나 회사 목록이 없으면 붙지 않는다', async () => {
      const company = (oppId: string, stalled: boolean) => ({
        oppId,
        customerName: `가상 ${oppId}`,
        lastContactAt: '2026-10-01',
        nextScheduleAt: null,
        nextScheduleNote: null,
        stalled,
      });
      mockedGet.mockResolvedValueOnce(
        reply({
          ...fixtureData,
          progressCompanies: {
            IN_CONTACT: [company('a', false), company('b', false)],
            QUOTE_SAMPLE: [company('c', true), company('d', true), company('e', false)],
          },
        }),
      );
      renderPage();
      await screen.findByTestId('dashboard-stage-chips');
      const tag = screen.getByTestId('dashboard-stage-stalled-QUOTE_SAMPLE');
      expect(tag).toHaveTextContent('멈춘 회사 2곳');
      expect(tag).toHaveStyle({ background: tagPalette.warn.bg, color: tagPalette.warn.fg });
      // 단추 이름에도 실려 화면 읽기 도구가 읽는다.
      expect(screen.getByTestId('dashboard-stage-chip-QUOTE_SAMPLE')).toHaveAttribute(
        'aria-label',
        '견적·샘플 1곳 · 멈춘 회사 2곳',
      );
      expect(screen.queryByTestId('dashboard-stage-stalled-IN_CONTACT')).not.toBeInTheDocument();
      // 회사 목록이 오지 않은 칸(성사)은 꼬리표를 지어내지 않는다.
      expect(screen.queryByTestId('dashboard-stage-stalled-WON')).not.toBeInTheDocument();
    });

    it('#972 단계 카드: "이번 주 +1" 같은 지난주 대비 글은 없다(응답에 없는 값)', async () => {
      mockedGet.mockResolvedValueOnce(reply(fixtureData));
      renderPage();
      const chips = await screen.findByTestId('dashboard-stage-chips');
      expect(chips).not.toHaveTextContent(/이번 주|지난주/);
    });

    it('새 모양인데 일부 칸만 빠져 있으면(옛 서버라 WON 없음) 그 칩만 빼고 나머지는 보이며, 보류가 있으면 끝에 보류 칩', async () => {
      const { WON: _won, ...partial } = fixtureData.counts;
      void _won;
      mockedGet.mockResolvedValueOnce(
        reply({ ...fixtureData, counts: { ...partial, ON_HOLD: 2 } }),
      );
      renderPage();
      const chips = await screen.findByTestId('dashboard-stage-chips');
      expect(screen.queryByTestId('dashboard-stage-chip-WON')).not.toBeInTheDocument();
      expect(within(chips).getAllByRole('button')).toHaveLength(4);
      expect(screen.getByTestId('dashboard-stage-chip-ON_HOLD')).toHaveAttribute(
        'aria-label',
        '보류 2곳',
      );
      expect(screen.getByTestId('dashboard-stage-chip-ON_HOLD')).toHaveTextContent('보류2곳');
      // 성사 칸이 없으면 남은 세 칸 사이에만 화살표 2개.
      expect(within(chips).getAllByTestId('dashboard-stage-arrow')).toHaveLength(2);
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
      // #929(시안 v3): 점 달력 — 머리 "11월 일정", 일정 있는 날 점, 오늘부터 7일은 연파랑.
      expect(await screen.findByTestId('dashboard-calendar-title')).toHaveTextContent(
        dashboardTexts.calendarDotsTitle(11),
      );
      expect(screen.getByTestId('dashboard-calendar-dot-2026-11-06')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-calendar-day-2026-11-06')).toHaveStyle({
        background: homePalette.blueBg,
      });
      expect(screen.getByTestId('dashboard-calendar-day-2026-11-05')).toHaveStyle({
        background: groupMarkPalette.today,
      });
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

  describe('배치 (#921 → #925 → #929): 제목·날짜·단계 칸·검색 한 줄 → 오늘 할 일 | 전달 사항 → 이번 주 방문·연락(+달력) → 지도 → 진행 중인 회사 → 더 보기', () => {
    it('구역이 약속한 순서로 놓이고, 칸 이름표(출근하면 등) 없이 큰 제목만 보이며, 관심 기업 건수·최근 내 기록은 접힌 "더 보기" 안에 있다', async () => {
      // 예전(#795) 순서는 오늘 브리핑 → 오늘 할 일 → 작은 달력 → 방문 준비·지도 → 더 보기였다.
      // PM 결정 2026-11-25(#921): 같은 일정을 네 곳에 되풀이하지 않고, 보는 때(출근·외근 전·누구나)로 나눴다.
      mockedGet.mockResolvedValueOnce(
        reply({
          ...fixtureData,
          progressCompanies: {
            IN_CONTACT: [
              {
                oppId: 'opp-1',
                customerName: '가상정밀',
                lastContactAt: '2026-11-03',
                nextScheduleAt: null,
                nextScheduleNote: null,
                stalled: false,
              },
            ],
          },
        }),
      );
      renderPage();
      await screen.findByTestId('dashboard-counts');
      // #972: 페이지 제목(이름을 모르면 "영업 홈")과 날짜 줄이 왼쪽, 검색이 오른쪽인 인사말 줄. 단계 카드는 그 아래.
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent(frame.pageTitleDashboard);
      expect(heading.parentElement).toContainElement(screen.getByTestId('dashboard-date'));
      expect(heading.parentElement?.parentElement).toContainElement(
        screen.getByTestId('dashboard-search-input'),
      );
      const order = [
        heading,
        screen.getByTestId('dashboard-date'),
        screen.getByTestId('dashboard-search-input'),
        screen.getByTestId('dashboard-stage-chips'),
        screen.getByTestId('dashboard-today'),
        screen.getByTestId('dashboard-handoff'),
        screen.getByTestId('dashboard-prep-section'),
        screen.getByTestId('dashboard-map-section'),
        screen.getByTestId('dashboard-progress-table'),
        screen.getByTestId('dashboard-more'),
      ];
      expect(screen.queryByTestId('dashboard-brief')).not.toBeInTheDocument();
      // #929(시안 v3): 이번 주 방문·연락은 한 줄 전체 칸이고, 그 칸 안 오른쪽에 한 달 달력이 있다.
      const prep = screen.getByTestId('dashboard-prep-section');
      expect(prep).toHaveTextContent(dashboardTexts.outTitle);
      expect(prep).toContainElement(screen.getByTestId('dashboard-calendar'));
      expect(screen.getByTestId('dashboard-handoff')).not.toContainElement(
        screen.getByTestId('dashboard-calendar'),
      );
      const mapSection = screen.getByTestId('dashboard-map-section');
      expect(mapSection).toHaveTextContent(dashboardTexts.mapTitle);
      expect(within(mapSection).queryByTestId('dashboard-map-aside')).not.toBeInTheDocument();
      // #925: 칸 이름표("출근하면·외근 전·누가 봐도")는 없다.
      expect(screen.queryByText('출근하면')).not.toBeInTheDocument();
      expect(screen.queryByText('누가 봐도')).not.toBeInTheDocument();
      const more = screen.getByTestId('dashboard-more');
      expect(more).toContainElement(screen.getByTestId('dashboard-counts'));
      expect(more).toContainElement(screen.getByTestId('dashboard-recent-section'));
      for (let index = 1; index < order.length; index += 1) {
        expect(
          order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    it('#925: 오늘 할 일 아래 방문 목록은 지도 칸이 불러온 지도 정보로 거리 화살표를 그린다(지도는 한 번만 부름)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-05T03:00:00Z'));
      const mapCalls = vi.mocked(getDashboardMap).mock.calls.length;
      vi.mocked(getDashboardMap).mockResolvedValueOnce(
        dashboardMapFixture as unknown as Awaited<ReturnType<typeof getDashboardMap>>,
      );
      mockedGet.mockResolvedValueOnce(
        reply({
          ...fixtureData,
          schedule: [
            {
              oppId: 'opp-map-1',
              customerName: '가상 가나정밀',
              oppTitle: '가상',
              dueAt: '2026-11-06',
              note: '방문',
              overdue: false,
              staffKey: 'park-lee',
            },
          ],
        }),
      );
      try {
        renderPage();
        const prep = await screen.findByTestId('dashboard-prep-section');
        const route = await within(prep).findByTestId('dashboard-prep-route');
        expect(route).toHaveTextContent('가상 가나정밀');
        expect(vi.mocked(getDashboardMap).mock.calls.length - mapCalls).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('단계 칩을 누르면 진행 중인 회사 표가 그 단계 회사만 보이고, 다시 누르면 풀린다', async () => {
      const company = (oppId: string, customerName: string) => ({
        oppId,
        customerName,
        lastContactAt: null,
        nextScheduleAt: null,
        nextScheduleNote: null,
        stalled: false,
      });
      mockedGet.mockResolvedValueOnce(
        reply({
          ...fixtureData,
          progressCompanies: {
            NOT_CONTACTED: [company('opp-a', '가상미접촉')],
            IN_CONTACT: [company('opp-b', '가상접촉')],
          },
        }),
      );
      renderPage();
      const table = await screen.findByTestId('dashboard-progress-table');
      const names = () =>
        within(table)
          .getAllByTestId('dashboard-progress-row')
          .map((row) => within(row).getByRole('link').textContent);
      // 기본은 접촉 · 견적·샘플 · 성사 칸.
      expect(names()).toEqual(['가상접촉']);
      const chip = screen.getByTestId('dashboard-stage-chip-NOT_CONTACTED');
      await userEvent.click(chip);
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      expect(names()).toEqual(['가상미접촉']);
      expect(screen.getByTestId('dashboard-progress-stage')).toHaveTextContent('미접촉만 보는 중');
      await userEvent.click(chip);
      expect(names()).toEqual(['가상접촉']);
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

    it('#929(시안 v3): 지난 일정·오늘 일정은 [지난 일정]·[오늘] 표시가 붙은 한 목록(지난 것 먼저), 확인할 회사는 그 아래 회사 이름 칩', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: rows }));
      renderPage();
      const today = await screen.findByTestId('dashboard-today');
      expect(within(today).getByRole('heading', { level: 2 })).toHaveTextContent(
        dashboardTexts.workTitle,
      );
      const schedule = within(today).getByTestId('dashboard-today-schedule');
      const lines = within(schedule).getAllByTestId('dashboard-today-item');
      expect(lines.map((line) => line.getAttribute('data-tone'))).toEqual([
        'overdue',
        'today',
        'today',
        'today',
      ]);
      expect(lines[0]).toHaveTextContent('지난 일정가상테크 · 전화11/10(화) 예정이었음');
      expect(within(lines[0]).getByRole('link', { name: '가상테크' })).toHaveAttribute(
        'href',
        '/opportunities/opp-4',
      );
      expect(lines[1]).toHaveTextContent('오늘가상정밀 · 견적');
      expect(within(lines[1]).getByTestId('dashboard-today-report')).toBeInTheDocument();
      // 일정 줄에는 묶음 제목이 없고, 묶음은 확인할 회사 하나뿐이다.
      const groups = within(today).getAllByTestId('dashboard-today-row');
      expect(
        groups.map((group) => within(group).getByRole('heading', { level: 3 }).textContent),
      ).toEqual(['확인할 회사 2곳모두 보기']);
      expect(
        within(screen.getByTestId('dashboard-today-items-CHECK_LEFT'))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['가상도금', '가상기계']);
      expect(screen.queryByTestId('dashboard-today-empty')).not.toBeInTheDocument();
    });

    it('일정 줄은 모두 보이고, 확인할 회사가 5곳을 넘으면 앞 5곳만 보이고 [더 보기 n곳]으로 편다', async () => {
      const seven = (prefix: string) =>
        Array.from({ length: 7 }, (_, i) => ({
          oppId: `opp-${prefix}${i}`,
          customerName: `가상${prefix}${i}`,
          dueAt: prefix === 't' ? '2026-11-13' : null,
          note: '',
        }));
      const many: TodayCheckRow[] = [
        { kind: 'SCHEDULE_TODAY', count: 7, items: seven('t'), listFilter: null },
        { kind: 'CHECK_LEFT', count: 7, items: seven('c'), listFilter: 'CHECK_LEFT' },
      ];
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: many }));
      renderPage();
      const schedule = await screen.findByTestId('dashboard-today-schedule');
      expect(within(schedule).getAllByTestId('dashboard-today-item')).toHaveLength(7);
      const list = screen.getByTestId('dashboard-today-items-CHECK_LEFT');
      expect(within(list).getAllByTestId('dashboard-today-item')).toHaveLength(5);
      await userEvent.click(screen.getByTestId('dashboard-today-more-CHECK_LEFT'));
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

    it('줄이 하나도 없으면 두 칸에 빈 안내 한 줄씩만 보인다(#921)', async () => {
      mockedGet.mockResolvedValueOnce(reply({ ...fixtureData, todayChecks: [] }));
      renderPage();
      expect(await screen.findByTestId('dashboard-today-empty')).toHaveTextContent(
        dashboardTexts.workEmpty,
      );
      expect(screen.getByTestId('dashboard-handoff-empty')).toHaveTextContent(
        dashboardTexts.handoffEmpty,
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
      const lines = within(within(today).getByTestId('dashboard-today-schedule')).getAllByTestId(
        'dashboard-today-item',
      );
      expect(lines.map((line) => line.getAttribute('data-tone'))).toEqual(['overdue']);
      expect(within(today).queryAllByTestId('dashboard-today-row')).toHaveLength(0);
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

describe('대시보드 › 칸 폭(#825 → #921 → #929)', () => {
  it('오늘 할 일 | 전달 사항 두 칸 기본 폭 합이 노트북 본문(약 700px)에 들어가고, 이번 주 방문 칸 안 달력은 최대 폭이 있다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    await screen.findByTestId('dashboard-counts');
    const right = screen.getByTestId('dashboard-handoff-column');
    expect(right).toContainElement(screen.getByTestId('dashboard-handoff'));
    expect(right.style.flex).toBe('2 1 300px');
    const todo = screen.getByTestId('dashboard-today').parentElement as HTMLElement;
    // 360 + 300 + 칸 사이 16 = 676px
    expect(todo.style.flex).toBe('3 1 360px');
    const calendar = screen.getByTestId('dashboard-calendar-section');
    expect(screen.getByTestId('dashboard-prep-section')).toContainElement(calendar);
    expect(calendar.style.maxWidth).toBe(`${CALENDAR_MAX_WIDTH}px`);
  });
});

describe('영업 홈 › 인사말 줄 (#972)', () => {
  const STAFF = [
    { key: 'park-lee', displayName: '영업 김' },
    { key: 'viewer', displayName: '보기 전용' },
  ];
  const config = (extra: Record<string, unknown> = {}) =>
    ({ staff: STAFF, ...extra }) as unknown as ConfigUi;

  function renderWith(value: {
    config: ConfigUi | null;
    staffKey: string | null;
    canRecord: boolean;
  }) {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <FrameContext.Provider
          value={{
            ...value,
            setStaffKey: () => {},
            setBannerMeta: () => {},
            setPageTitle: () => {},
          }}
        >
          <DashboardPage />
        </FrameContext.Provider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    mockedGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('고른 담당자의 화면 이름으로 "안녕하세요, ○○ 님"을 보이고, 그 아래 날짜 · 오늘 챙길 일 건수를 보인다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T03:00:00Z'));
    mockedGet.mockResolvedValueOnce(
      reply({
        ...fixtureData,
        todayChecks: [
          { kind: 'SCHEDULE_OVERDUE', count: 2, items: [], listFilter: null },
          { kind: 'SCHEDULE_TODAY', count: 1, items: [], listFilter: null },
          { kind: 'HANDOFF_FOR_ME', count: 1, items: [], listFilter: null },
          // 확인할 회사·내가 보낸 전달은 "오늘 챙길 일"에 세지 않는다(왼쪽 메뉴 숫자와 같은 뜻).
          { kind: 'CHECK_LEFT', count: 5, items: [], listFilter: 'CHECK_LEFT' },
          { kind: 'HANDOFF_FROM_ME', count: 3, items: [], listFilter: null },
        ],
      }),
    );
    renderWith({ config: config(), staffKey: 'park-lee', canRecord: true });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '안녕하세요, 영업 김 님',
    );
    expect(screen.getByTestId('dashboard-date')).toHaveTextContent(
      '11월 27일 금요일 · 오늘 챙길 일 4건',
    );
    expect(screen.getByTestId('dashboard-todo-count')).toHaveTextContent('4건');
  });

  it('계정 방식이면 로그인한 사람의 화면 이름을 쓴다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderWith({
      config: config({ currentStaff: { key: 'kim', displayName: '김영업', canRecord: true } }),
      staffKey: 'kim',
      canRecord: true,
    });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '안녕하세요, 김영업 님',
    );
  });

  it('이름을 모르면(보기 전용 · 설정 전) 지금 제목 "영업 홈"을 그대로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderWith({ config: config(), staffKey: 'viewer', canRecord: false });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      frame.pageTitleDashboard,
    );
    expect(screen.queryByText(/안녕하세요/)).not.toBeInTheDocument();
  });

  it('서버가 줄 목록을 주지 않으면(옛 서버) "오늘 챙길 일"을 0건으로 지어내지 않고 날짜만 보인다', async () => {
    const { todayChecks: _rows, ...old } = fixtureData;
    void _rows;
    mockedGet.mockResolvedValueOnce(reply(old as Dashboard));
    renderWith({ config: null, staffKey: null, canRecord: false });
    const line = await screen.findByTestId('dashboard-date');
    expect(line).not.toHaveTextContent(dashboardTexts.greetingTodoLead);
    expect(screen.queryByTestId('dashboard-todo-count')).not.toBeInTheDocument();
  });

  it('greetingName · greetingDate · todoCount', () => {
    expect(greetingName(null, 'park-lee', true)).toBeNull();
    expect(greetingName(config(), 'park-lee', true)).toBe('영업 김');
    expect(greetingName(config(), 'park-lee', false)).toBeNull();
    expect(greetingName(config(), 'nobody', true)).toBeNull();
    // 첫 로그인 설정 전(화면 이름 없음)이면 고른 담당자 이름으로 대신하지 않는다.
    expect(
      greetingName(
        config({ currentStaff: { key: 'park-lee', displayName: null, canRecord: true } }),
        'park-lee',
        true,
      ),
    ).toBeNull();
    expect(greetingDate('2026-11-27')).toBe('11월 27일 금요일');
    expect(greetingDate('2026-12-01')).toBe('12월 1일 화요일');
    expect(greetingDate('')).toBe('');
    expect(todoCount(undefined)).toBeNull();
    expect(todoCount([])).toBe(0);
  });
});

describe('영업 홈 › 월별 접촉 추세 카드 (#972)', () => {
  const monthly = Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    contacted: index,
    won: 0,
    lost: 0,
  }));

  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('단계 카드 아래 · 오늘 할 일 위에 놓인다', async () => {
    vi.mocked(getSalesAnalysis).mockResolvedValueOnce({
      data: { monthly, total: { contactedCount: 7 } },
      meta: {},
    } as unknown as Awaited<ReturnType<typeof getSalesAnalysis>>);
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    const trend = await screen.findByTestId('dashboard-trend');
    expect(trend).toHaveTextContent('7곳');
    const order = [
      screen.getByTestId('dashboard-stage-chips'),
      trend,
      screen.getByTestId('dashboard-today'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('추세 응답을 못 읽어도 영업 홈은 오류가 되지 않고 그 칸만 빠진다', async () => {
    vi.mocked(getSalesAnalysis).mockRejectedValueOnce(
      new ApiError(500, {
        message: '문제',
        nextAction: '다시',
        ref: 'r-2',
        kind: 'INTERNAL_ERROR',
      }),
    );
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    expect(await screen.findByTestId('dashboard-today')).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getSalesAnalysis)).toHaveBeenCalled());
    expect(screen.queryByTestId('dashboard-trend')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // 가짜 응답에는 진행 중인 회사 목록이 없어 표는 없다. 다른 칸들이 그대로 보이는지 본다.
    expect(screen.getByTestId('dashboard-stage-chips')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-prep-section')).toBeInTheDocument();
  });
});

describe('영업 홈 › 먼저 볼 후보 (#972)', () => {
  const card = (oppId: string, title: string) => ({
    oppId,
    title,
    rank: 1,
    reason: `${title} 추천 근거`,
    isVirtual: true,
  });
  const listReply = (items: unknown[]) =>
    ({ data: items, meta: {} }) as unknown as Awaited<ReturnType<typeof getOpportunities>>;

  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('진행 중인 회사 표 아래 · 접힌 "더 보기" 위에 놓인다', async () => {
    vi.mocked(getOpportunities).mockResolvedValueOnce(
      listReply([card('opp-1', '가상기공 · 선반 부품'), card('opp-2', '가상산업 · 커버')]),
    );
    mockedGet.mockResolvedValueOnce(
      reply({
        ...fixtureData,
        progressCompanies: {
          IN_CONTACT: [
            {
              oppId: 'opp-9',
              customerName: '가상정밀',
              lastContactAt: '2026-11-03',
              nextScheduleAt: null,
              nextScheduleNote: null,
              stalled: false,
            },
          ],
        },
      }),
    );
    renderPage();
    const top = await screen.findByTestId('dashboard-top');
    expect(within(top).getAllByTestId('dashboard-top-card')).toHaveLength(2);
    const order = [
      screen.getByTestId('dashboard-map-section'),
      screen.getByTestId('dashboard-progress-table'),
      top,
      screen.getByTestId('dashboard-more'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('후보 목록을 못 읽어도 영업 홈은 오류가 되지 않고 그 칸만 빠진다', async () => {
    const before = vi.mocked(getOpportunities).mock.calls.length;
    vi.mocked(getOpportunities).mockRejectedValueOnce(
      new ApiError(500, {
        message: '문제',
        nextAction: '다시',
        ref: 'r-3',
        kind: 'INTERNAL_ERROR',
      }),
    );
    mockedGet.mockResolvedValueOnce(reply(fixtureData));
    renderPage();
    expect(await screen.findByTestId('dashboard-today')).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getOpportunities).mock.calls.length).toBe(before + 1));
    expect(screen.queryByTestId('dashboard-top')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-more')).toBeInTheDocument();
  });
});
