// #983 왼쪽 메뉴 아래 한 달 달력: 모든 화면에서 보이고, 일정은 영업 홈과 같은 응답(GET /dashboard의 schedule)을 쓴다.
// 일정 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름은 모두 가상이다.
// 날짜 칸 모양 · 작은 창의 세부는 dashboard/__tests__/DashboardCalendar.test.tsx(작은 달력 묶음)에서 본다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import SideMenu from '../SideMenu';
import SideCalendar from '../SideCalendar';
import { FrameContext } from '../FrameContext';
import type { FrameValue } from '../FrameContext';
import {
  SIDE_SCHEDULE_FRESH_MS,
  publishSideSchedule,
  publishSideScheduleError,
  resetSideSchedule,
} from '../useSideSchedule';
import { SCHEDULE_CHANGED_EVENT } from '../../../api/assistant';
import { getDashboard } from '../../../api/dashboard';
import type { Dashboard, DashboardScheduleItem } from '../../../api/dashboardTypes';
import { sideCalendar } from '../../../theme/tokens';

vi.mock('../../../api/dashboard', () => ({ getDashboard: vi.fn() }));
// 메뉴 숫자(#770)는 이 시험의 관심사가 아니다. 응답이 오지 않게 막아 둔다.
vi.mock('../../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/menuBadges')>()),
  getMenuBadges: vi.fn(() => new Promise(() => {})),
}));

const mockedGet = vi.mocked(getDashboard);

const item = (
  dueAt: string,
  overdue: boolean,
  oppId: string,
  customerName: string,
  note = '방문',
): DashboardScheduleItem => ({
  oppId,
  customerName,
  oppTitle: '가상 건',
  dueAt,
  note,
  overdue,
  staffKey: 'park-lee',
});

const SCHEDULE = [
  item('2026-12-01', true, 'opp-a', '가상정밀', '견적 회신'),
  item('2026-12-04', false, 'opp-b', '가상금속'),
  item('2026-12-04', false, 'opp-c', '가상산업', '전화'),
];

function reply(schedule: DashboardScheduleItem[]) {
  return {
    data: { schedule } as unknown as Dashboard,
    meta: {},
  } as Awaited<ReturnType<typeof getDashboard>>;
}

function frameValue(value: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...value,
  };
}

/** 화면을 옮기는 단추가 달린 왼쪽 메뉴. */
function Mover() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/bookmarks')}>
        관심 기업으로
      </button>
      <button type="button" onClick={() => navigate('/sales-analysis')}>
        영업 분석으로
      </button>
      <button type="button" onClick={() => navigate('/')}>
        영업 홈으로
      </button>
    </>
  );
}

function renderMenu(path: string, value: Partial<FrameValue> = {}, narrowDevice = false) {
  return render(
    <FrameContext.Provider value={frameValue(value)}>
      <MemoryRouter initialEntries={[path]}>
        <SideMenu narrowDevice={narrowDevice} />
        <Routes>
          <Route path="*" element={<Mover />} />
        </Routes>
      </MemoryRouter>
    </FrameContext.Provider>,
  );
}

const day = (date: string) => screen.getByTestId(`dashboard-calendar-day-${date}`);
const cell = (date: string) => screen.getByTestId(`dashboard-calendar-cell-${date}`);

beforeEach(() => {
  window.localStorage.clear();
  resetSideSchedule();
  mockedGet.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  // 한국 시간 2026-12-03(목) 낮.
  vi.setSystemTime(new Date('2026-12-03T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('모든 화면에서 보인다', () => {
  it.each([
    '/opportunities',
    '/bookmarks',
    '/opportunities/opp-1',
    '/sales-analysis',
    '/operations',
  ])('%s: 메뉴 아래 달력 칸에 이번 달 달력이 보인다', async (path) => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu(path);
    const calendar = screen.getByTestId('side-calendar');
    expect(calendar).toHaveAccessibleName('일정 달력');
    expect(await within(calendar).findByTestId('dashboard-calendar-title')).toHaveTextContent(
      /^12월 일정$/,
    );
    expect(calendar).toHaveAttribute('data-state', 'ready');
    // 메뉴와 간격을 띄운 연회색 칸(모서리 12).
    expect(calendar).toHaveStyle({
      background: sideCalendar.panelBg,
      borderRadius: '12px',
      marginTop: `${sideCalendar.gapAbove}px`,
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('영업 홈(/): 달력 칸은 있고, 일정은 영업 홈이 읽어 알려 준 값을 쓴다(스스로 같은 요청을 또 보내지 않는다)', async () => {
    renderMenu('/');
    const calendar = screen.getByTestId('side-calendar');
    // 영업 홈이 아직 읽는 중: 빈 달력을 정상처럼 보이지 않고 읽는 중이라고 알린다.
    expect(within(calendar).getByTestId('side-calendar-loading')).toHaveTextContent(
      /^일정을 불러오는 중입니다$/,
    );
    expect(screen.queryByTestId('dashboard-calendar')).not.toBeInTheDocument();
    // 영업 홈이 읽은 값을 알린다.
    act(() => publishSideSchedule('park-lee', SCHEDULE));
    expect(await within(calendar).findByTestId('dashboard-calendar')).toBeInTheDocument();
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 2건');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('좁은 기기에는 메뉴 아래 달력이 없고 일정도 읽지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu('/bookmarks', {}, true);
    expect(screen.queryByTestId('side-calendar')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedGet).not.toHaveBeenCalled();
  });
});

describe('날짜 칸과 작은 창', () => {
  it('일정 있는 날은 연보라 칸 + "일정 n건", 지난 일정이 남은 날은 연주황 칸 + "지난 일정 있음", 오늘은 "오늘"로 읽힌다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    expect(cell('2026-12-04')).toHaveStyle({
      background: sideCalendar.has.bg,
      color: sideCalendar.has.fg,
      fontWeight: '700',
    });
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 2건');
    expect(cell('2026-12-01')).toHaveStyle({
      background: sideCalendar.overdue.bg,
      color: sideCalendar.overdue.fg,
      fontWeight: '700',
    });
    expect(day('2026-12-01')).toHaveAttribute('aria-label', '12월 1일, 일정 1건, 지난 일정 있음');
    expect(day('2026-12-03')).toHaveAttribute('aria-label', '12월 3일, 오늘, 일정 없음');
    expect(day('2026-12-05')).toHaveAttribute('aria-label', '12월 5일, 일정 없음');
    // 달력 아래 풀이.
    expect(screen.getByTestId('dashboard-calendar-legend')).toHaveTextContent(/^일정지난 일정$/);
  });

  it('일정이 있는 날을 누르면 달력 오른쪽 작은 창에 회사(상세 링크) · 내용이 보이고, 지난 일정에는 "지남"이 붙는다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    await userEvent.click(day('2026-12-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAttribute('data-side', 'right');
    expect(popover).toHaveAccessibleName('12월 4일 (금) 일정 2건');
    expect(
      within(popover)
        .getAllByTestId('dashboard-calendar-popover-item')
        .map((row) => row.textContent),
    ).toEqual(['가상금속 · 방문', '가상산업 · 전화']);
    expect(within(popover).getByRole('link', { name: '가상금속' })).toHaveAttribute(
      'href',
      '/opportunities/opp-b',
    );
    // 창은 달력 칸 안(메뉴 안)에 있어 메뉴와 함께 읽힌다.
    expect(screen.getByTestId('side-calendar')).toContainElement(popover);
    await userEvent.click(day('2026-12-01'));
    const overdue = screen.getByTestId('dashboard-calendar-popover');
    expect(within(overdue).getByTestId('dashboard-calendar-popover-item')).toHaveTextContent(
      /^지남가상정밀 · 견적 회신$/,
    );
  });

  it('일정이 없는 날도 누를 수 있고 "일정 없음"이라고 보인다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    await userEvent.click(day('2026-12-10'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAccessibleName('12월 10일 (목) 일정 없음');
    expect(within(popover).getByTestId('dashboard-calendar-popover-count')).toHaveTextContent(
      /^일정 없음$/,
    );
    expect(within(popover).queryByTestId('dashboard-calendar-popover-item')).toBeNull();
  });

  it('작은 창 본문 아래에 끼울 자리(날짜 메모 #984)를 열어 둔다: 넘겨받은 것을 그날 날짜로 그린다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    render(
      <FrameContext.Provider value={frameValue()}>
        <MemoryRouter initialEntries={['/bookmarks']}>
          <SideCalendar extra={(date) => <em data-testid="memo-slot">{`메모 ${date}`}</em>} />
        </MemoryRouter>
      </FrameContext.Provider>,
    );
    await screen.findByTestId('dashboard-calendar');
    await userEvent.click(day('2026-12-10'));
    expect(
      within(screen.getByTestId('dashboard-calendar-popover-extra')).getByTestId('memo-slot'),
    ).toHaveTextContent(/^메모 2026-12-10$/);
  });
});

describe('일정 읽기', () => {
  it('담당자 키 규칙은 영업 홈과 같다: 기록할 수 있는 담당자는 키를 보내고, 보기 전용 · 미선택은 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    const first = renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    expect(mockedGet.mock.calls[0][1]).toBe('park-lee');
    first.unmount();
    for (const value of [
      { staffKey: 'viewer', canRecord: false },
      { staffKey: null, canRecord: false },
    ]) {
      resetSideSchedule();
      mockedGet.mockClear();
      const view = renderMenu('/bookmarks', value);
      await screen.findByTestId('dashboard-calendar');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0][1]).toBeNull();
      view.unmount();
    }
  });

  it('화면을 옮겨도 다시 읽지 않는다(방금 읽은 값을 그대로 쓴다)', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    renderMenu('/opportunities');
    await screen.findByTestId('dashboard-calendar');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '관심 기업으로' }));
    await userEvent.click(screen.getByRole('button', { name: '영업 분석으로' }));
    expect(screen.getByTestId('nav-sales-analysis-link')).toHaveAttribute('aria-current', 'page');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard-calendar')).toBeInTheDocument();
  });

  it('읽은 지 오래됐으면 화면을 옮길 때 조용히 다시 읽고, 그동안 보이던 달력은 그대로 둔다', async () => {
    // 영업 홈이 한참 전에 알려 둔 값.
    publishSideSchedule('park-lee', SCHEDULE, Date.now() - SIDE_SCHEDULE_FRESH_MS - 1);
    let finish: (value: Awaited<ReturnType<typeof getDashboard>>) => void = () => {};
    mockedGet.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderMenu('/bookmarks');
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    // 다시 읽는 동안에도 달력은 보인다.
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 2건');
    expect(screen.queryByTestId('side-calendar-loading')).not.toBeInTheDocument();
    await act(async () => {
      finish(reply([item('2026-12-09', false, 'opp-n', '가상신규')]));
    });
    expect(day('2026-12-09')).toHaveAttribute('aria-label', '12월 9일, 일정 1건');
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 없음');
  });

  it('일정이 바뀌었다는 알림(일정 저장 등)을 들으면 다시 읽어 달력에 반영한다', async () => {
    mockedGet.mockResolvedValueOnce(reply(SCHEDULE));
    mockedGet.mockResolvedValueOnce(
      reply([...SCHEDULE, item('2026-12-15', false, 'opp-n', '가상신규')]),
    );
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    expect(day('2026-12-15')).toHaveAttribute('aria-label', '12월 15일, 일정 없음');
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: 'opp-n' }));
    });
    await waitFor(() =>
      expect(day('2026-12-15')).toHaveAttribute('aria-label', '12월 15일, 일정 1건'),
    );
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet.mock.calls[1][1]).toBe('park-lee');
  });

  it('영업 홈에서는 알림이 와도 스스로 읽지 않는다(영업 홈이 다시 읽어 알려 준다)', async () => {
    renderMenu('/');
    act(() => publishSideSchedule('park-lee', SCHEDULE));
    await screen.findByTestId('dashboard-calendar');
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: 'opp-b' }));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedGet).not.toHaveBeenCalled();
    // 영업 홈이 다시 읽은 값을 알리면 달력이 바뀐다.
    act(() => publishSideSchedule('park-lee', [item('2026-12-20', false, 'opp-z', '가상테크')]));
    expect(day('2026-12-20')).toHaveAttribute('aria-label', '12월 20일, 일정 1건');
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 없음');
  });

  it('담당자를 바꾸면 그 담당자 키로 다시 읽는다', async () => {
    mockedGet.mockResolvedValue(reply(SCHEDULE));
    const tree = (staffKey: string) => (
      <FrameContext.Provider value={frameValue({ staffKey })}>
        <MemoryRouter initialEntries={['/bookmarks']}>
          <SideMenu narrowDevice={false} />
        </MemoryRouter>
      </FrameContext.Provider>
    );
    const view = render(tree('park-lee'));
    await screen.findByTestId('dashboard-calendar');
    view.rerender(tree('kim-gwajang'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(mockedGet.mock.calls[1][1]).toBe('kim-gwajang');
    await screen.findByTestId('dashboard-calendar');
  });
});

describe('일정을 못 읽었을 때', () => {
  it('달력 칸에 짧은 안내와 [다시 읽기]만 보이고(빈 달력을 정상처럼 보이지 않는다) 메뉴는 그대로 쓴다', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network'));
    mockedGet.mockResolvedValueOnce(reply(SCHEDULE));
    renderMenu('/bookmarks');
    const alert = await screen.findByTestId('side-calendar-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(/^일정을 불러오지 못했습니다 다시 읽기$/);
    expect(screen.getByTestId('side-calendar')).toHaveAttribute('data-state', 'error');
    expect(screen.queryByTestId('dashboard-calendar')).not.toBeInTheDocument();
    // 메뉴 네 줄과 주 단추는 그대로다.
    expect(screen.getByTestId('nav-new-candidates')).toHaveAttribute(
      'href',
      '/opportunities?newCandidates=1',
    );
    expect(
      screen.getAllByRole('link').filter((link) => link.classList.contains('side-nav-row')),
    ).toHaveLength(4);
    // [다시 읽기]로 다시 읽으면 달력이 보인다.
    await userEvent.click(screen.getByTestId('side-calendar-retry'));
    expect(await screen.findByTestId('dashboard-calendar')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('side-calendar-error')).not.toBeInTheDocument();
  });

  it('영업 홈이 못 읽었다고 알리면 안내만 보이고(다시 시도는 영업 홈 본문의 단추가 맡는다), 다시 읽어 알리면 달력이 돌아온다', async () => {
    renderMenu('/');
    act(() => publishSideScheduleError('park-lee'));
    const alert = await screen.findByTestId('side-calendar-error');
    expect(alert).toHaveTextContent(/^일정을 불러오지 못했습니다$/);
    expect(screen.queryByTestId('side-calendar-retry')).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
    act(() => publishSideSchedule('park-lee', SCHEDULE));
    expect(await screen.findByTestId('dashboard-calendar')).toBeInTheDocument();
  });

  it('전에 읽은 일정이 있으면 다시 읽기에 실패해도 보이던 달력을 지우지 않되, "새 일정을 읽지 못했다"고 알리고 [다시 읽기]를 둔다', async () => {
    mockedGet.mockResolvedValueOnce(reply(SCHEDULE));
    mockedGet.mockRejectedValueOnce(new Error('network'));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    expect(screen.queryByTestId('side-calendar-stale')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: 'opp-b' }));
    });
    const stale = await screen.findByTestId('side-calendar-stale');
    expect(stale).toHaveAttribute('role', 'alert');
    expect(stale).toHaveTextContent(
      /^새 일정을 읽지 못했습니다\. 앞서 읽은 일정입니다\. 다시 읽기$/,
    );
    expect(mockedGet).toHaveBeenCalledTimes(2);
    // 앞서 읽은 달력은 그대로 보인다.
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 2건');
    // [다시 읽기]가 성공하면 알림이 사라진다.
    mockedGet.mockResolvedValueOnce(reply([item('2026-12-09', false, 'opp-n', '가상신규')]));
    await userEvent.click(within(stale).getByTestId('side-calendar-retry'));
    await waitFor(() =>
      expect(day('2026-12-09')).toHaveAttribute('aria-label', '12월 9일, 일정 1건'),
    );
    expect(screen.queryByTestId('side-calendar-stale')).not.toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it('실패한 값은 "방금 읽은 값"으로 치지 않는다: 다음에 화면을 옮기면 다시 읽어 본다', async () => {
    mockedGet.mockResolvedValueOnce(reply(SCHEDULE));
    mockedGet.mockRejectedValueOnce(new Error('network'));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    act(() => {
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: 'opp-b' }));
    });
    await screen.findByTestId('side-calendar-stale');
    mockedGet.mockResolvedValueOnce(reply(SCHEDULE));
    await userEvent.click(screen.getByRole('button', { name: '영업 분석으로' }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.queryByTestId('side-calendar-stale')).not.toBeInTheDocument(),
    );
  });
});
