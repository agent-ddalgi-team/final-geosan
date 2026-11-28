// 메모를 쓰는 작은 달력(#984): 메모가 있는 날 표시(테두리 + 읽는 말) · 날짜를 누르면 그날 메모 칸 ·
// 남기기/지우기 뒤 바로 반영 · 달을 넘기면 그 달을 읽음 · 못 읽었을 때 안내와 [다시 읽기].
// 메모 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름은 가상이고 담당자 이름은 역할 말만 쓴다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MemoCalendar from '../MemoCalendar';
import { DAY_MEMO_FRESH_MS, applyDayMemoChange, monthRange } from '../useDayMemos';
import { miniCellShadow } from '../../dashboard/DashboardCalendar';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import {
  announceDayMemoChange,
  deleteDayMemo,
  getDayMemos,
  postDayMemo,
} from '../../../api/dayMemos';
import type { DayMemo } from '../../../api/dayMemos';
import type { DashboardScheduleItem } from '../../../api/dashboardTypes';
import { colors, sideCalendar } from '../../../theme/tokens';

vi.mock('../../../api/dayMemos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dayMemos')>()),
  getDayMemos: vi.fn(),
  postDayMemo: vi.fn(),
  deleteDayMemo: vi.fn(),
}));

const mockedGet = vi.mocked(getDayMemos);
const mockedPost = vi.mocked(postDayMemo);
const mockedDelete = vi.mocked(deleteDayMemo);

const TODAY = '2026-12-03';

const memo = (
  memoId: string,
  day: string,
  text: string,
  value: Partial<DayMemo> = {},
): DayMemo => ({
  memoId,
  day,
  text,
  staffKey: 'park-lee',
  staffName: '영업 담당',
  createdAt: '2026-11-28T08:40:00Z',
  ...value,
});

const MEMOS = [
  memo('daymemo-1', '2026-12-03', '오후 3시 팀 회의'),
  memo('daymemo-2', '2026-12-04', '샘플 챙기기'),
  memo('daymemo-3', '2026-12-09', '오전 안전 교육'),
  memo('daymemo-4', '2026-12-09', '통화는 오후에', {
    staffKey: 'kim-gwajang',
    staffName: '영업 과장',
    createdAt: '2026-11-29T01:05:00Z',
  }),
];

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

function reply(memos: DayMemo[]) {
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

function tree(watch?: string, value: Partial<FrameValue> = {}) {
  return (
    <FrameContext.Provider value={frameValue(value)}>
      <MemoryRouter>
        <MemoCalendar items={SCHEDULE} today={TODAY} popoverSide="below" watch={watch} />
      </MemoryRouter>
    </FrameContext.Provider>
  );
}

const day = (date: string) => screen.getByTestId(`dashboard-calendar-day-${date}`);
const cell = (date: string) => screen.getByTestId(`dashboard-calendar-cell-${date}`);

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedDelete.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('메모가 있는 날 표시', () => {
  it('Given 달력이 열리면 When 메모를 읽으면 Then 보이는 달의 첫날~끝날로 한 번만 읽는다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0].slice(0, 2)).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('Given 메모가 있는 날이면 When 달력을 보면 Then 칸에 회색 테두리가 있고 읽는 말 · 손 올림 글에 "메모 n건"이 붙는다(색만으로 알리지 않는다)', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    expect(day('2026-12-09')).toHaveAttribute('aria-label', '12월 9일, 일정 없음, 메모 2건');
    expect(day('2026-12-09')).toHaveAttribute('title', '12월 9일, 일정 없음, 메모 2건');
    expect(cell('2026-12-09').style.boxShadow).toBe(miniCellShadow(false, false, true));
    expect(cell('2026-12-09').style.boxShadow).toContain('inset');
    // 메모가 없는 날은 지금까지와 같다.
    expect(day('2026-12-10')).toHaveAttribute('aria-label', '12월 10일, 일정 없음');
    expect(day('2026-12-10')).not.toHaveAttribute('title');
    expect(day('2026-12-10')).not.toHaveAttribute('data-memo');
    expect(cell('2026-12-10').style.boxShadow).toBe('none');
  });

  it('Given 일정도 메모도 있는 날이면 When 달력을 보면 Then 일정 칸 색(연보라)은 그대로이고 테두리와 "일정 1건, 메모 1건"이 함께 보인다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-04')).toHaveAttribute('data-memo', '1'));
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 1건, 메모 1건');
    expect(cell('2026-12-04')).toHaveStyle({
      background: sideCalendar.has.bg,
      color: sideCalendar.has.fg,
    });
    expect(cell('2026-12-04').style.boxShadow).toBe(miniCellShadow(false, false, true));
  });

  it('Given 오늘에 메모가 있으면 When 달력을 보면 Then 오늘 테두리와 메모 테두리가 겹쳐 둘 다 보이고 "오늘 … 메모 1건"으로 읽힌다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day(TODAY)).toHaveAttribute('data-memo', '1'));
    expect(day(TODAY)).toHaveAttribute('aria-label', '12월 3일, 오늘, 일정 없음, 메모 1건');
    expect(cell(TODAY).style.boxShadow).toBe(miniCellShadow(false, true, true));
    // 오늘만 · 메모만 · 둘 다는 서로 다른 테두리다.
    const shadows = [
      miniCellShadow(false, true, false),
      miniCellShadow(false, false, true),
      miniCellShadow(false, true, true),
      miniCellShadow(false, false, false),
    ];
    expect(new Set(shadows).size).toBe(4);
    expect(miniCellShadow(false, false, false)).toBe('none');
    // 누른 날은 메모가 있어도 누른 날 고리만 보인다.
    expect(miniCellShadow(true, true, true)).toBe(
      `0 0 0 2px ${colors.bgContainer}, 0 0 0 4px ${sideCalendar.selected.bg}`,
    );
  });

  it('달력 아래 풀이에 "메모"가 더해지고 안내 글이 "일정과 메모"로 바뀐다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    expect(screen.getByTestId('dashboard-calendar-legend')).toHaveTextContent(
      /^일정지난 일정메모$/,
    );
    expect(screen.getByTestId('dashboard-calendar-hint')).toHaveTextContent(
      /^날짜를 누르면 그날 일정과 메모가 보입니다$/,
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
  });
});

describe('날짜를 누르면 그날 메모 칸', () => {
  it('Given 메모가 있는 날을 누르면 When 작은 창이 뜨면 Then 일정 아래 메모 칸에 그날 메모만 보인다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    await userEvent.click(day('2026-12-09'));
    const extra = screen.getByTestId('dashboard-calendar-popover-extra');
    expect(
      within(extra)
        .getAllByTestId('day-memo-text')
        .map((node) => node.textContent),
    ).toEqual(['오전 안전 교육', '통화는 오후에']);
    // 일정이 있는 날: 일정 줄과 메모 칸이 함께 보인다.
    await userEvent.click(day('2026-12-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(within(popover).getByTestId('dashboard-calendar-popover-item')).toHaveTextContent(
      /^가상금속 · 방문$/,
    );
    expect(
      within(popover)
        .getAllByTestId('day-memo-text')
        .map((node) => node.textContent),
    ).toEqual(['샘플 챙기기']);
  });

  it('Given 적다 만 글이 있으면 When 다른 날짜를 누르면 Then 입력 칸이 비워진다(다른 날에 잘못 저장하지 않게)', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    await userEvent.click(day('2026-12-09'));
    await userEvent.type(screen.getByTestId('day-memo-input'), '적다 만 글');
    await userEvent.click(day('2026-12-10'));
    expect(screen.getByTestId('day-memo-input')).toHaveValue('');
    expect(screen.getByTestId('day-memo-empty')).toBeInTheDocument();
  });
});

describe('남기기 · 지우기 뒤 바로 반영', () => {
  it('Given 메모가 없는 날에 When 글을 적고 [저장]하면 Then 목록에 바로 보이고 달력 칸에 테두리가 생기며 다시 읽지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    mockedPost.mockResolvedValueOnce({
      data: memo('daymemo-9', '2026-12-10', '견적서 챙기기', {
        createdAt: '2026-12-03T02:00:00Z',
      }),
      meta: {},
    });
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    await userEvent.click(day('2026-12-10'));
    expect(screen.getByTestId('day-memo-empty')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('day-memo-input'), '견적서 챙기기');
    await userEvent.click(screen.getByTestId('day-memo-save'));
    expect(await screen.findByTestId('day-memo-text')).toHaveTextContent(/^견적서 챙기기$/);
    expect(mockedPost).toHaveBeenCalledWith('2026-12-10', '견적서 챙기기', 'park-lee');
    expect(screen.getByTestId('day-memo-byline')).toHaveTextContent(/^영업 담당 · 12\/03 11:00$/);
    expect(screen.getByTestId('day-memo-input')).toHaveValue('');
    expect(day('2026-12-10')).toHaveAttribute('data-memo', '1');
    expect(day('2026-12-10')).toHaveAttribute('aria-label', '12월 10일, 일정 없음, 메모 1건');
    // 창을 닫으면 그 칸에 메모 테두리가 보인다.
    await userEvent.click(screen.getByTestId('dashboard-calendar-popover-close'));
    expect(cell('2026-12-10').style.boxShadow).toBe(miniCellShadow(false, false, true));
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('Given 저장이 실패하면 When 응답이 오면 Then 이유를 알리고 목록 · 달력 표시는 그대로다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    mockedPost.mockRejectedValueOnce(new Error('boom'));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    await userEvent.click(day('2026-12-10'));
    await userEvent.type(screen.getByTestId('day-memo-input'), '견적서 챙기기');
    await userEvent.click(screen.getByTestId('day-memo-save'));
    expect(await screen.findByTestId('day-memo-save-error')).toBeInTheDocument();
    expect(screen.queryByTestId('day-memo-text')).not.toBeInTheDocument();
    expect(day('2026-12-10')).not.toHaveAttribute('data-memo');
  });

  it('Given 내가 쓴 메모 하나뿐인 날에 When [지우기]를 누르면 Then 목록에서 바로 빠지고 달력 칸의 테두리가 사라진다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    mockedDelete.mockResolvedValueOnce({ data: { memoId: 'daymemo-2', deleted: true }, meta: {} });
    render(tree());
    await waitFor(() => expect(day('2026-12-04')).toHaveAttribute('data-memo', '1'));
    await userEvent.click(day('2026-12-04'));
    await userEvent.click(screen.getByTestId('day-memo-remove'));
    expect(await screen.findByTestId('day-memo-empty')).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledWith('daymemo-2', 'park-lee');
    expect(day('2026-12-04')).not.toHaveAttribute('data-memo');
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 1건');
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('Given 서버가 지우기를 막으면(403) When 응답이 오면 Then 메모와 달력 표시는 그대로 남는다', async () => {
    const { ApiError } = await import('../../../api/client');
    mockedGet.mockResolvedValue(reply(MEMOS));
    mockedDelete.mockRejectedValueOnce(
      new ApiError(403, {
        message: '다른 담당자의 메모는 지울 수 없습니다.',
        nextAction: '메모를 쓴 담당자에게 알려 주세요.',
        ref: 'r-1',
        kind: 'FORBIDDEN',
      }),
    );
    render(tree());
    await waitFor(() => expect(day('2026-12-04')).toHaveAttribute('data-memo', '1'));
    await userEvent.click(day('2026-12-04'));
    await userEvent.click(screen.getByTestId('day-memo-remove'));
    expect(await screen.findByTestId('day-memo-remove-error')).toHaveTextContent(
      '다른 담당자의 메모는 지울 수 없습니다.',
    );
    expect(screen.getByTestId('day-memo-text')).toHaveTextContent(/^샘플 챙기기$/);
    expect(day('2026-12-04')).toHaveAttribute('data-memo', '1');
  });

  it('Given 다른 곳(다른 달력 · 다른 달)에서 메모가 바뀌었다는 알림이 오면 When 이 달의 메모면 반영하고 Then 다른 달의 메모는 넣지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    act(() => {
      announceDayMemoChange({ type: 'added', memo: memo('daymemo-7', '2026-12-20', '이 달 메모') });
      announceDayMemoChange({
        type: 'added',
        memo: memo('daymemo-8', '2027-01-05', '다음 달 메모'),
      });
      announceDayMemoChange({ type: 'deleted', memoId: 'daymemo-4' });
    });
    expect(day('2026-12-20')).toHaveAttribute('data-memo', '1');
    expect(day('2026-12-09')).toHaveAttribute('data-memo', '1');
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});

describe('달을 넘기면 그 달을 읽는다', () => {
  it('Given 12월을 보다가 When [다음 달]을 누르면 Then 1월 1일~31일로 다시 읽고 그 달의 메모 표시를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply(MEMOS));
    mockedGet.mockResolvedValueOnce(reply([memo('daymemo-5', '2027-01-05', '신년 인사 전화')]));
    render(tree());
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    await userEvent.click(screen.getByTestId('dashboard-calendar-next'));
    await waitFor(() => expect(day('2027-01-05')).toHaveAttribute('data-memo', '1'));
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet.mock.calls[1].slice(0, 2)).toEqual(['2027-01-01', '2027-01-31']);
    expect(day('2027-01-09')).not.toHaveAttribute('data-memo');
  });

  it('Given 12월을 보다가 When [지난달]을 누르면 Then 11월 1일~30일로 읽는다(달마다 끝날이 다르다)', async () => {
    mockedGet.mockResolvedValue(reply([]));
    render(tree());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByTestId('dashboard-calendar-prev'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(mockedGet.mock.calls[1].slice(0, 2)).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('한 달의 범위: 2월은 28일(윤년 29일)까지, 12월은 31일까지', () => {
    expect(monthRange(2027, 1)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthRange(2028, 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2026, 11)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('메모를 못 읽었을 때', () => {
  it('Given 메모 읽기가 실패하면 When 날짜를 누르면 Then 달력 · 일정은 그대로 쓰고 메모 칸에 짧은 안내와 [다시 읽기]가 보이며, 누르면 다시 읽어 메모가 보인다', async () => {
    mockedGet.mockRejectedValueOnce(new Error('network'));
    mockedGet.mockResolvedValueOnce(reply(MEMOS));
    render(tree());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    // 달력과 일정은 그대로다.
    expect(day('2026-12-04')).toHaveAttribute('aria-label', '12월 4일, 일정 1건');
    await userEvent.click(day('2026-12-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(within(popover).getByTestId('dashboard-calendar-popover-item')).toHaveTextContent(
      /^가상금속 · 방문$/,
    );
    const alert = await within(popover).findByTestId('day-memo-load-error');
    expect(alert).toHaveTextContent(/^메모를 불러오지 못했습니다 다시 읽기$/);
    expect(within(popover).queryByTestId('day-memo-empty')).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByTestId('day-memo-retry'));
    expect(await within(popover).findByTestId('day-memo-text')).toHaveTextContent(/^샘플 챙기기$/);
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('day-memo-load-error')).not.toBeInTheDocument();
    expect(day('2026-12-09')).toHaveAttribute('data-memo', '2');
  });

  it('Given 메모를 못 읽은 상태에서 When 메모를 저장하면 Then 저장 뒤 서버 값으로 다시 읽어 목록을 보인다', async () => {
    const saved = memo('daymemo-9', '2026-12-10', '견적서 챙기기');
    mockedGet.mockRejectedValueOnce(new Error('network'));
    mockedGet.mockResolvedValueOnce(reply([...MEMOS, saved]));
    mockedPost.mockResolvedValueOnce({ data: saved, meta: {} });
    render(tree());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    await userEvent.click(day('2026-12-10'));
    await screen.findByTestId('day-memo-load-error');
    await userEvent.type(screen.getByTestId('day-memo-input'), '견적서 챙기기');
    await userEvent.click(screen.getByTestId('day-memo-save'));
    expect(await screen.findByTestId('day-memo-text')).toHaveTextContent(/^견적서 챙기기$/);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });
});

describe('다른 담당자가 남긴 메모 따라가기', () => {
  it('Given 읽은 지 오래됐으면 When 화면을 옮기면 Then 조용히 다시 읽고(보이던 표시는 그대로), 방금 읽었으면 다시 읽지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-03T03:00:00Z'));
    mockedGet.mockResolvedValueOnce(reply(MEMOS));
    const view = render(tree('/opportunities'));
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    // 방금 읽었다: 화면을 옮겨도 다시 읽지 않는다.
    view.rerender(tree('/bookmarks'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    // 한참 뒤 화면을 옮기면 다시 읽는다.
    vi.setSystemTime(new Date(Date.now() + DAY_MEMO_FRESH_MS + 1));
    let finish: (value: Awaited<ReturnType<typeof getDayMemos>>) => void = () => {};
    mockedGet.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    view.rerender(tree('/sales-analysis'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(day('2026-12-09')).toHaveAttribute('data-memo', '2');
    await act(async () => {
      finish(reply([...MEMOS, memo('daymemo-6', '2026-12-15', '동료가 남긴 메모')]));
    });
    expect(day('2026-12-15')).toHaveAttribute('data-memo', '1');
  });

  it('Given 전에 읽은 메모가 있는데 When 다시 읽기에 실패하면 Then 보이던 메모는 그대로 두고 메모 칸에서 "새 메모를 읽지 못했다"고 알린다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-03T03:00:00Z'));
    mockedGet.mockResolvedValueOnce(reply(MEMOS));
    mockedGet.mockRejectedValueOnce(new Error('network'));
    const view = render(tree('/opportunities'));
    await waitFor(() => expect(day('2026-12-09')).toHaveAttribute('data-memo', '2'));
    vi.setSystemTime(new Date(Date.now() + DAY_MEMO_FRESH_MS + 1));
    view.rerender(tree('/bookmarks'));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await userEvent.click(day('2026-12-09'));
    expect(await screen.findByTestId('day-memo-stale')).toHaveTextContent(
      /^새 메모를 읽지 못했습니다\. 앞서 읽은 메모입니다\. 다시 읽기$/,
    );
    expect(screen.getAllByTestId('day-memo-item')).toHaveLength(2);
  });
});

describe('알림에 실린 변화를 목록에 반영하기(applyDayMemoChange)', () => {
  const list = [memo('a', '2026-12-03', '첫째', { createdAt: '2026-12-01T01:00:00Z' })];

  it('더해진 메모는 날짜 · 적은 시각 순서 자리에 들어가고, 같은 번호는 두 번 넣지 않는다', () => {
    const earlier = memo('b', '2026-12-02', '앞 날짜', { createdAt: '2026-12-02T01:00:00Z' });
    const added = applyDayMemoChange(
      list,
      { type: 'added', memo: earlier },
      '2026-12-01',
      '2026-12-31',
    );
    expect(added.map((item) => item.memoId)).toEqual(['b', 'a']);
    expect(
      applyDayMemoChange(added, { type: 'added', memo: earlier }, '2026-12-01', '2026-12-31'),
    ).toBe(added);
  });

  it('기간 밖 메모는 넣지 않고, 없는 번호를 지우라는 알림은 목록을 바꾸지 않는다', () => {
    const outside = memo('c', '2027-01-01', '다음 달');
    expect(
      applyDayMemoChange(list, { type: 'added', memo: outside }, '2026-12-01', '2026-12-31'),
    ).toBe(list);
    expect(
      applyDayMemoChange(list, { type: 'deleted', memoId: 'zzz' }, '2026-12-01', '2026-12-31'),
    ).toBe(list);
    expect(
      applyDayMemoChange(list, { type: 'deleted', memoId: 'a' }, '2026-12-01', '2026-12-31'),
    ).toEqual([]);
  });
});
