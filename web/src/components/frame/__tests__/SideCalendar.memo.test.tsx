// #984 왼쪽 메뉴 아래 달력의 날짜 메모: 모든 화면에서 보이는 달력에 메모 표시와 메모 칸이 붙는다.
// 일정 · 메모 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름은 가상이고 담당자 이름은 역할 말만 쓴다.
// 메모 칸 · 메모 달력의 세부는 schedule/__tests__/DayMemoBox.test.tsx · MemoCalendar.test.tsx에서 본다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import SideMenu from '../SideMenu';
import { FrameContext } from '../FrameContext';
import type { FrameValue } from '../FrameContext';
import { resetSideSchedule } from '../useSideSchedule';
import { DAY_MEMO_FRESH_MS } from '../../schedule/useDayMemos';
import { getDashboard } from '../../../api/dashboard';
import { getDayMemos, postDayMemo } from '../../../api/dayMemos';
import type { DayMemo } from '../../../api/dayMemos';
import type { Dashboard, DashboardScheduleItem } from '../../../api/dashboardTypes';

vi.mock('../../../api/dashboard', () => ({ getDashboard: vi.fn() }));
vi.mock('../../../api/dayMemos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dayMemos')>()),
  getDayMemos: vi.fn(),
  postDayMemo: vi.fn(),
}));
// 메뉴 숫자(#770)는 이 시험의 관심사가 아니다. 응답이 오지 않게 막아 둔다.
vi.mock('../../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/menuBadges')>()),
  getMenuBadges: vi.fn(() => new Promise(() => {})),
}));

const mockedDashboard = vi.mocked(getDashboard);
const mockedMemos = vi.mocked(getDayMemos);
const mockedPost = vi.mocked(postDayMemo);

const SCHEDULE: DashboardScheduleItem[] = [
  {
    oppId: 'opp-b',
    customerName: '가상금속',
    oppTitle: '가상 건',
    dueAt: '2026-12-04',
    note: '방문',
    overdue: false,
    staffKey: 'park-lee',
  },
];

const memo = (memoId: string, day: string, text: string): DayMemo => ({
  memoId,
  day,
  text,
  staffKey: 'park-lee',
  staffName: '영업 담당',
  createdAt: '2026-11-28T08:40:00Z',
});

const MEMOS = [memo('daymemo-1', '2026-12-09', '오전 안전 교육')];

function memoReply(memos: DayMemo[]) {
  return { data: memos, meta: {} } as Awaited<ReturnType<typeof getDayMemos>>;
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

function Mover() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/sales-analysis')}>
      영업 분석으로
    </button>
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

beforeEach(() => {
  window.localStorage.clear();
  resetSideSchedule();
  mockedDashboard.mockReset();
  mockedMemos.mockReset();
  mockedPost.mockReset();
  mockedDashboard.mockResolvedValue({
    data: { schedule: SCHEDULE } as unknown as Dashboard,
    meta: {},
  } as Awaited<ReturnType<typeof getDashboard>>);
  vi.useFakeTimers({ toFake: ['Date'] });
  // 한국 시간 2026-12-03(목) 낮.
  vi.setSystemTime(new Date('2026-12-03T03:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('왼쪽 메뉴 달력의 날짜 메모', () => {
  it.each(['/bookmarks', '/opportunities/opp-1', '/sales-analysis'])(
    'Given %s 화면에서 When 달력이 보이면 Then 이번 달 메모를 한 번 읽어 메모가 있는 날을 표시하고, 날짜를 누르면 오른쪽 창의 일정 아래에 메모 칸이 보인다',
    async (path) => {
      mockedMemos.mockResolvedValue(memoReply(MEMOS));
      renderMenu(path);
      await screen.findByTestId('dashboard-calendar');
      await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '1'));
      expect(mockedMemos).toHaveBeenCalledTimes(1);
      expect(mockedMemos.mock.calls[0].slice(0, 2)).toEqual(['2026-12-01', '2026-12-31']);
      expect(day('2026-12-09')).toHaveAttribute('aria-label', '12월 9일, 일정 없음, 메모 1건');
      expect(screen.getByTestId('dashboard-calendar-legend')).toHaveTextContent(
        /^일정지난 일정메모$/,
      );
      await userEvent.click(day('2026-12-09'));
      const popover = screen.getByTestId('dashboard-calendar-popover');
      expect(popover).toHaveAttribute('data-side', 'right');
      const box = within(popover).getByTestId('day-memo-box');
      expect(within(box).getByTestId('day-memo-text')).toHaveTextContent(/^오전 안전 교육$/);
      expect(within(box).getByTestId('day-memo-input')).toBeEnabled();
      // 창은 달력 칸 안(메뉴 안)에 있다.
      expect(screen.getByTestId('side-calendar')).toContainElement(box);
    },
  );

  it('Given 왼쪽 달력에서 When 메모를 저장하면 Then 창의 목록과 달력 칸 표시에 바로 보인다', async () => {
    mockedMemos.mockResolvedValue(memoReply(MEMOS));
    mockedPost.mockResolvedValueOnce({
      data: memo('daymemo-2', '2026-12-10', '견적서 챙기기'),
      meta: {},
    });
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    await userEvent.click(day('2026-12-10'));
    await userEvent.type(await screen.findByTestId('day-memo-input'), '견적서 챙기기');
    await userEvent.click(screen.getByTestId('day-memo-save'));
    expect(await screen.findByTestId('day-memo-text')).toHaveTextContent(/^견적서 챙기기$/);
    expect(mockedPost).toHaveBeenCalledWith('2026-12-10', '견적서 챙기기', 'park-lee');
    expect(day('2026-12-10')).toHaveAttribute('data-memo', '1');
  });

  it('Given 보기 전용이면 When 날짜를 누르면 Then 메모는 읽히고 입력 칸은 눌리지 않으며 "먼저 담당자를 고르세요"가 보인다', async () => {
    mockedMemos.mockResolvedValue(memoReply(MEMOS));
    renderMenu('/bookmarks', { staffKey: 'viewer', canRecord: false });
    await screen.findByTestId('dashboard-calendar');
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '1'));
    await userEvent.click(day('2026-12-09'));
    expect(screen.getByTestId('day-memo-text')).toHaveTextContent(/^오전 안전 교육$/);
    expect(screen.getByTestId('day-memo-input')).toBeDisabled();
    expect(screen.getByTestId('day-memo-pick-staff')).toHaveTextContent(/^먼저 담당자를 고르세요$/);
    expect(screen.queryByTestId('day-memo-remove')).not.toBeInTheDocument();
  });

  it('Given 메모 읽기가 실패해도 When 달력을 보면 Then 달력 · 일정 · 메뉴는 그대로 쓰고 메모 칸만 안내를 보인다', async () => {
    mockedMemos.mockRejectedValue(new Error('network'));
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    expect(screen.getByTestId('side-calendar')).toHaveAttribute('data-state', 'ready');
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 1건');
    await userEvent.click(day('2026-12-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(within(popover).getByTestId('dashboard-calendar-popover-item')).toHaveTextContent(
      /^가상금속 · 방문$/,
    );
    expect(await within(popover).findByTestId('day-memo-load-error')).toHaveTextContent(
      /^메모를 불러오지 못했습니다 다시 읽기$/,
    );
    expect(screen.queryByTestId('side-calendar-error')).not.toBeInTheDocument();
  });

  it('Given 읽은 지 오래됐으면 When 화면을 옮기면 Then 메모를 조용히 다시 읽는다(다른 담당자가 남긴 메모가 보이게)', async () => {
    mockedMemos.mockResolvedValueOnce(memoReply(MEMOS));
    mockedMemos.mockResolvedValueOnce(
      memoReply([...MEMOS, memo('daymemo-3', '2026-12-15', '동료가 남긴 메모')]),
    );
    renderMenu('/bookmarks');
    await screen.findByTestId('dashboard-calendar');
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '1'));
    vi.setSystemTime(new Date(Date.now() + DAY_MEMO_FRESH_MS + 1));
    await userEvent.click(screen.getByRole('button', { name: '영업 분석으로' }));
    await waitFor(() => expect(day('2026-12-15')).toHaveAttribute('data-memo', '1'));
    expect(mockedMemos).toHaveBeenCalledTimes(2);
  });

  it('Given 좁은 기기면 When 메뉴를 그리면 Then 메뉴 아래 달력이 없으므로 메모도 읽지 않는다', async () => {
    mockedMemos.mockResolvedValue(memoReply(MEMOS));
    renderMenu('/bookmarks', {}, true);
    expect(screen.queryByTestId('side-calendar')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedMemos).not.toHaveBeenCalled();
  });
});
