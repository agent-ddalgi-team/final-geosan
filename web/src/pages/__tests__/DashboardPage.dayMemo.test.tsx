// 영업 홈 "오늘 할 일"의 달력 메모 줄(#984, PM이 고른 시안 2026-11-28).
// 오늘 날짜에 붙인 달력 메모가 일정 줄 아래에 한 줄씩 보이고, 달력에서 남기거나 지우면 바로 따라온다.
// 오늘 챙길 일 건수는 그대로다(서버가 준 줄 수). 좁은 기기에서는 본문 달력에도 메모 칸이 보인다.
// 요청은 모두 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름은 가상이고 담당자 이름은 역할 말만 쓴다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import SideMenu from '../../components/frame/SideMenu';
import { FrameContext } from '../../components/frame/FrameContext';
import type { FrameValue } from '../../components/frame/FrameContext';
import { resetSideSchedule } from '../../components/frame/useSideSchedule';
import { getDashboard } from '../../api/dashboard';
import { announceDayMemoChange, deleteDayMemo, getDayMemos, postDayMemo } from '../../api/dayMemos';
import type { DayMemo } from '../../api/dayMemos';
import type { Dashboard } from '../../api/dashboardTypes';
import type { Envelope } from '../../api/types';
import { tagPalette } from '../../theme/tokens';
import dashboardFixture from '../../test/fixtures/dashboard.json';

vi.mock('../../api/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('../../api/dayMemos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/dayMemos')>()),
  getDayMemos: vi.fn(),
  postDayMemo: vi.fn(),
  deleteDayMemo: vi.fn(),
}));
// 이 시험의 관심사가 아닌 칸(지도 · 월별 추세 · 먼저 볼 후보 · 메뉴 숫자)은 응답이 오지 않게 막아 둔다.
vi.mock('../../api/dashboardMap', () => ({ getDashboardMap: vi.fn(() => new Promise(() => {})) }));
vi.mock('../../api/salesAnalysis', () => ({
  getSalesAnalysis: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/menuBadges')>()),
  getMenuBadges: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(() => new Promise(() => {})),
}));

const mockedDashboard = vi.mocked(getDashboard);
const mockedMemos = vi.mocked(getDayMemos);
const mockedPost = vi.mocked(postDayMemo);
const mockedDelete = vi.mocked(deleteDayMemo);

const TODAY = '2026-11-28';
const fixtureData = dashboardFixture.data as unknown as Dashboard;

const memo = (memoId: string, text: string, value: Partial<DayMemo> = {}): DayMemo => ({
  memoId,
  day: TODAY,
  text,
  staffKey: 'park-lee',
  staffName: '영업 담당',
  createdAt: '2026-11-26T02:00:00Z',
  ...value,
});

const TODAY_MEMOS = [
  memo('daymemo-1', '오후 3시 팀 회의. 통화는 그 전에 끝내기'),
  memo('daymemo-2', '샘플 상자 챙기기', {
    staffKey: 'kim-daeri',
    staffName: '영업 대리',
    createdAt: '2026-11-27T05:00:00Z',
  }),
];

function reply(data: Dashboard): Envelope<Dashboard> {
  return { data, meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' } };
}

function memoReply(memos: DayMemo[]) {
  return { data: memos, meta: {} } as Awaited<ReturnType<typeof getDayMemos>>;
}

/** 오늘 하루를 묻는 요청과 한 달을 묻는 요청(달력)에 따로 답한다. */
function answerMemos(today: DayMemo[], month: DayMemo[] = today) {
  mockedMemos.mockImplementation((from, to) =>
    Promise.resolve(memoReply(from === to ? today : month)),
  );
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

function renderPage(value: Partial<FrameValue> = {}, withMenu = false) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <FrameContext.Provider value={frameValue(value)}>
        {withMenu ? <SideMenu narrowDevice={false} /> : null}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="*" element={null} />
        </Routes>
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const todayCalls = () => mockedMemos.mock.calls.filter(([from, to]) => from === to);

beforeEach(() => {
  window.localStorage.clear();
  resetSideSchedule();
  mockedDashboard.mockReset();
  mockedMemos.mockReset();
  mockedPost.mockReset();
  mockedDelete.mockReset();
  mockedDashboard.mockResolvedValue(reply(fixtureData));
  vi.useFakeTimers({ toFake: ['Date'] });
  // 한국 시간 2026-11-28(토) 낮.
  vi.setSystemTime(new Date('2026-11-28T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('영업 홈 › 오늘 할 일 › 달력 메모 줄 (#984)', () => {
  it('Given 오늘 날짜에 붙인 달력 메모가 있으면 When 영업 홈을 열면 Then 오늘 하루(from = to = 오늘)를 따로 읽어 "메모" 꼬리표 · 글 · "달력 메모 · 누가 언제 적음"을 한 줄씩 보인다', async () => {
    answerMemos(TODAY_MEMOS);
    renderPage();
    const list = await screen.findByTestId('dashboard-today-memos');
    expect(list).toHaveAccessibleName('오늘 날짜의 달력 메모');
    expect(todayCalls()).toHaveLength(1);
    expect(todayCalls()[0].slice(0, 2)).toEqual([TODAY, TODAY]);
    const rows = within(list).getAllByTestId('dashboard-today-memo');
    expect(rows).toHaveLength(2);
    const tag = within(rows[0]).getByTestId('dashboard-today-tag-memo');
    expect(tag).toHaveTextContent(/^메모$/);
    expect(tag).toHaveStyle({
      background: tagPalette.neutral.bg,
      color: tagPalette.neutral.fg,
    });
    expect(within(rows[0]).getByTestId('dashboard-today-memo-text')).toHaveTextContent(
      /^오후 3시 팀 회의\. 통화는 그 전에 끝내기$/,
    );
    // 받침이 있는 이름은 "이", 없는 이름은 "가".
    expect(within(rows[0]).getByTestId('dashboard-today-memo-meta')).toHaveTextContent(
      /^달력 메모 · 영업 담당이 11\/26에 적음$/,
    );
    expect(within(rows[1]).getByTestId('dashboard-today-memo-meta')).toHaveTextContent(
      /^달력 메모 · 영업 대리가 11\/27에 적음$/,
    );
    // 메모 줄에는 일정 줄의 단추(완료 · 날짜 바꾸기)나 "유료" 표시가 없다.
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
    expect(list).not.toHaveTextContent('유료');
  });

  it('메모 줄은 오늘 할 일 칸 안, 일정 줄 바로 아래 · 확인할 회사 묶음 위에 놓인다', async () => {
    answerMemos(TODAY_MEMOS);
    renderPage();
    const list = await screen.findByTestId('dashboard-today-memos');
    const card = screen.getByTestId('dashboard-today');
    expect(card).toContainElement(list);
    const slot = within(card).getByTestId('dashboard-today-memo-slot');
    expect(slot).toContainElement(list);
    expect(slot.previousElementSibling).toBe(within(card).getByTestId('dashboard-today-schedule'));
    expect(slot.nextElementSibling).toBe(within(card).getByTestId('dashboard-today-row'));
  });

  it('Given 쓴 사람이 지금 담당자 표에 없으면 When 메모 줄을 보면 Then 이름 자리에 담당자 키가 보인다', async () => {
    answerMemos([memo('daymemo-3', '출장', { staffKey: 'old-staff', staffName: null })]);
    renderPage();
    expect(await screen.findByTestId('dashboard-today-memo-meta')).toHaveTextContent(
      /^달력 메모 · old-staff이\(가\) 11\/26에 적음$/,
    );
  });

  it('Given 오늘 날짜에 메모가 없으면 When 영업 홈을 열면 Then 메모 줄 · 메모 자리를 아무것도 그리지 않는다', async () => {
    answerMemos([]);
    renderPage();
    const card = await screen.findByTestId('dashboard-today');
    await waitFor(() => expect(todayCalls()).toHaveLength(1));
    expect(within(card).queryByTestId('dashboard-today-memos')).not.toBeInTheDocument();
    expect(within(card).queryByTestId('dashboard-today-memo-slot')).not.toBeInTheDocument();
    expect(within(card).queryByTestId('dashboard-today-memos-error')).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent('달력 메모');
  });

  it('Given 메모가 있든 없든 When 영업 홈을 보면 Then 인사말의 "오늘 챙길 일 n건"과 오늘 할 일 제목 옆 건수는 서버가 준 줄 수 그대로다', async () => {
    answerMemos([]);
    const without = renderPage();
    await screen.findByTestId('dashboard-today');
    await waitFor(() => expect(todayCalls()).toHaveLength(1));
    const todo = screen.getByTestId('dashboard-todo-count').textContent;
    const work = screen.getByTestId('dashboard-today-work-count').textContent;
    // 가짜 응답: 지난 일정 2 + 오늘 일정 1.
    expect(todo).toBe('3건');
    expect(work).toBe('3건');
    without.unmount();

    answerMemos(TODAY_MEMOS);
    renderPage();
    expect(await screen.findAllByTestId('dashboard-today-memo')).toHaveLength(2);
    expect(screen.getByTestId('dashboard-todo-count')).toHaveTextContent(/^3건$/);
    expect(screen.getByTestId('dashboard-today-work-count')).toHaveTextContent(/^3건$/);
    // 대시보드 요청은 메모와 상관없이 한 번씩만 갔다.
    expect(mockedDashboard).toHaveBeenCalledTimes(2);
  });

  it('Given 지난 일정도 오늘 일정도 없는 날에 When 오늘 메모가 있으면 Then "일정 없음" 안내 아래에 메모 줄이 보인다', async () => {
    mockedDashboard.mockResolvedValue(reply({ ...fixtureData, todayChecks: [] }));
    answerMemos(TODAY_MEMOS);
    renderPage();
    expect(await screen.findAllByTestId('dashboard-today-memo')).toHaveLength(2);
    const card = screen.getByTestId('dashboard-today');
    expect(within(card).getByTestId('dashboard-today-empty')).toHaveTextContent(
      /^지난 일정도 오늘 일정도 없습니다$/,
    );
    expect(within(card).queryByTestId('dashboard-today-work-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-todo-count')).toHaveTextContent(/^0건$/);
  });

  it('Given 오늘 메모를 못 읽으면 When 영업 홈을 보면 Then 나머지 칸은 그대로 쓰고 짧은 안내와 [다시 읽기]가 보이며(메모가 없는 것처럼 보이지 않는다) 누르면 다시 읽어 메모가 보인다', async () => {
    mockedMemos.mockRejectedValueOnce(new Error('network'));
    mockedMemos.mockResolvedValueOnce(memoReply(TODAY_MEMOS));
    renderPage();
    const alert = await screen.findByTestId('dashboard-today-memos-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(/^오늘 날짜의 달력 메모를 불러오지 못했습니다 다시 읽기$/);
    // 대시보드의 다른 칸은 그대로 보인다.
    expect(screen.getByTestId('dashboard-today-schedule')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-prep-section')).toBeInTheDocument();
    expect(screen.queryByTestId('five-states-error')).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByTestId('dashboard-today-memos-retry'));
    expect(await screen.findAllByTestId('dashboard-today-memo')).toHaveLength(2);
    expect(screen.queryByTestId('dashboard-today-memos-error')).not.toBeInTheDocument();
    expect(mockedMemos).toHaveBeenCalledTimes(2);
    expect(mockedDashboard).toHaveBeenCalledTimes(1);
  });
});

describe('달력에서 오늘 메모를 남기거나 지우면 오늘 할 일 줄이 바로 따라온다 (#984)', () => {
  it('Given 메모가 바뀌었다는 알림이 오면 When 오늘 날짜의 메모면 Then 다시 읽지 않고 줄을 더하거나 빼며, 다른 날짜의 메모는 넣지 않는다', async () => {
    answerMemos([TODAY_MEMOS[0]]);
    renderPage();
    expect(await screen.findAllByTestId('dashboard-today-memo')).toHaveLength(1);
    act(() => {
      announceDayMemoChange({
        type: 'added',
        memo: memo('daymemo-8', '다른 날 메모', { day: '2026-12-01' }),
      });
      announceDayMemoChange({
        type: 'added',
        memo: memo('daymemo-9', '방금 남긴 메모', { createdAt: '2026-11-28T03:00:00Z' }),
      });
    });
    expect(
      screen.getAllByTestId('dashboard-today-memo-text').map((node) => node.textContent),
    ).toEqual(['오후 3시 팀 회의. 통화는 그 전에 끝내기', '방금 남긴 메모']);
    act(() => announceDayMemoChange({ type: 'deleted', memoId: 'daymemo-1' }));
    expect(
      screen.getAllByTestId('dashboard-today-memo-text').map((node) => node.textContent),
    ).toEqual(['방금 남긴 메모']);
    act(() => announceDayMemoChange({ type: 'deleted', memoId: 'daymemo-9' }));
    expect(screen.queryByTestId('dashboard-today-memos')).not.toBeInTheDocument();
    expect(todayCalls()).toHaveLength(1);
    // 건수는 그대로다.
    expect(screen.getByTestId('dashboard-todo-count')).toHaveTextContent(/^3건$/);
  });

  it('Given 영업 홈에서 When 왼쪽 메뉴 달력의 오늘 날짜에 메모를 저장하고 다시 지우면 Then 오늘 할 일의 메모 줄이 바로 생겼다가 사라진다', async () => {
    answerMemos([]);
    const saved = memo('daymemo-9', '오후 3시 팀 회의', { createdAt: '2026-11-28T03:00:00Z' });
    mockedPost.mockResolvedValueOnce({ data: saved, meta: {} });
    mockedDelete.mockResolvedValueOnce({ data: { memoId: 'daymemo-9', deleted: true }, meta: {} });
    renderPage({}, true);
    await screen.findByTestId('dashboard-today');
    const side = screen.getByTestId('side-calendar');
    await userEvent.click(await within(side).findByTestId(`dashboard-calendar-day-${TODAY}`));
    await userEvent.type(await within(side).findByTestId('day-memo-input'), '오후 3시 팀 회의');
    await userEvent.click(within(side).getByTestId('day-memo-save'));
    // 왼쪽 달력의 메모 칸과 오늘 할 일 칸 양쪽에 보인다.
    expect(await within(side).findByTestId('day-memo-text')).toHaveTextContent(
      /^오후 3시 팀 회의$/,
    );
    const card = screen.getByTestId('dashboard-today');
    expect(within(card).getByTestId('dashboard-today-memo-text')).toHaveTextContent(
      /^오후 3시 팀 회의$/,
    );
    expect(within(card).getByTestId('dashboard-today-memo-meta')).toHaveTextContent(
      /^달력 메모 · 영업 담당이 11\/28에 적음$/,
    );
    expect(mockedPost).toHaveBeenCalledWith(TODAY, '오후 3시 팀 회의', 'park-lee');
    // 지우면 양쪽에서 빠진다.
    await userEvent.click(within(side).getByTestId('day-memo-remove'));
    await waitFor(() =>
      expect(within(card).queryByTestId('dashboard-today-memos')).not.toBeInTheDocument(),
    );
    expect(within(side).queryByTestId('day-memo-item')).not.toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledWith('daymemo-9', 'park-lee');
    // 저장 · 지우기 때문에 대시보드를 다시 읽지 않는다.
    expect(mockedDashboard).toHaveBeenCalledTimes(1);
  });
});

describe('좁은 기기의 영업 홈 달력 (#984)', () => {
  it('Given 좁은 기기면 When 본문 맨 아래 달력을 보면 Then 메모가 있는 날이 표시되고, 날짜를 누르면 날짜 아래 창에 그날 메모 칸이 보인다', async () => {
    const monthMemo = memo('daymemo-5', '거래처 휴무', { day: '2026-11-30' });
    answerMemos(TODAY_MEMOS, [...TODAY_MEMOS, monthMemo]);
    renderPage({ narrowDevice: true });
    const section = await screen.findByTestId('dashboard-calendar-section');
    const day30 = within(section).getByTestId('dashboard-calendar-day-2026-11-30');
    await waitFor(() => expect(day30).toHaveAttribute('data-memo', '1'));
    expect(day30).toHaveAttribute('aria-label', '11월 30일, 일정 없음, 메모 1건');
    // 달력은 이번 달을, 오늘 할 일은 오늘 하루를 읽는다.
    expect(mockedMemos.mock.calls.map((call) => call.slice(0, 2))).toEqual(
      expect.arrayContaining([
        [TODAY, TODAY],
        ['2026-11-01', '2026-11-30'],
      ]),
    );
    await userEvent.click(day30);
    const popover = within(section).getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAttribute('data-side', 'below');
    expect(within(popover).getByTestId('day-memo-text')).toHaveTextContent(/^거래처 휴무$/);
    expect(within(popover).getByTestId('day-memo-input')).toBeEnabled();
  });
});
