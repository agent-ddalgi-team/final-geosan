// 달력 날짜 메모 칸(#984): 그날 메모 목록 · 남기기 · 지우기 · 보기 전용 · 읽기 상태.
// 저장 · 지우기 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 담당자 이름은 역할 말만 쓴다.
// 달력과 함께 움직이는 것(테두리 · 달 넘기기)은 MemoCalendar.test.tsx에서 본다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DayMemoBox from '../DayMemoBox';
import type { DayMemoBoxProps } from '../DayMemoBox';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { ApiError } from '../../../api/client';
import { DAY_MEMO_CHANGED_EVENT, deleteDayMemo, postDayMemo } from '../../../api/dayMemos';
import type { DayMemo } from '../../../api/dayMemos';

vi.mock('../../../api/dayMemos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dayMemos')>()),
  postDayMemo: vi.fn(),
  deleteDayMemo: vi.fn(),
}));

const mockedPost = vi.mocked(postDayMemo);
const mockedDelete = vi.mocked(deleteDayMemo);

const memo = (memoId: string, text: string, value: Partial<DayMemo> = {}): DayMemo => ({
  memoId,
  day: '2026-12-09',
  text,
  staffKey: 'park-lee',
  staffName: '영업 담당',
  createdAt: '2026-11-28T08:40:00Z',
  ...value,
});

const MINE = memo('daymemo-1', '오전 안전 교육. 통화는 오후에 몰아서 하기');
const OTHERS = memo('daymemo-2', '오후 3시 팀 회의', {
  staffKey: 'kim-gwajang',
  staffName: '영업 과장',
  createdAt: '2026-11-29T01:05:00Z',
});

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

function renderBox(props: Partial<DayMemoBoxProps> = {}, value: Partial<FrameValue> = {}) {
  const onReload = vi.fn();
  const view = render(
    <FrameContext.Provider value={frameValue(value)}>
      <DayMemoBox
        day="2026-12-09"
        memos={[MINE, OTHERS]}
        state="ready"
        onReload={onReload}
        {...props}
      />
    </FrameContext.Provider>,
  );
  return { ...view, onReload };
}

/** 창(window)에 온 메모 바뀜 알림을 모은다. */
function listen() {
  const heard: unknown[] = [];
  const listener = (event: Event) => heard.push((event as CustomEvent).detail);
  window.addEventListener(DAY_MEMO_CHANGED_EVENT, listener);
  return { heard, stop: () => window.removeEventListener(DAY_MEMO_CHANGED_EVENT, listener) };
}

const input = () => screen.getByTestId('day-memo-input') as HTMLInputElement;
const saveButton = () => screen.getByTestId('day-memo-save');

function apiError(status: number, message: string, nextAction: string) {
  return new ApiError(status, { message, nextAction, ref: 'r-1', kind: 'TEST' });
}

beforeEach(() => {
  mockedPost.mockReset();
  mockedDelete.mockReset();
});

describe('메모 목록', () => {
  it('Given 그날 메모가 둘이면 When 메모 칸을 보면 Then 글 · 쓴 사람 · 적은 시각이 쓴 순서로 보인다', () => {
    renderBox();
    const list = screen.getByTestId('day-memo-list');
    expect(list).toHaveAccessibleName('12월 9일 (수) 메모');
    const rows = within(list).getAllByTestId('day-memo-item');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId('day-memo-text')).toHaveTextContent(
      /^오전 안전 교육\. 통화는 오후에 몰아서 하기$/,
    );
    // 적은 시각은 한국 시각으로 보인다(08:40Z = 17:40).
    expect(within(rows[0]).getByTestId('day-memo-byline')).toHaveTextContent(
      /^영업 담당 · 11\/28 17:40$/,
    );
    expect(within(rows[1]).getByTestId('day-memo-byline')).toHaveTextContent(
      /^영업 과장 · 11\/29 10:05$/,
    );
    expect(screen.queryByTestId('day-memo-empty')).not.toBeInTheDocument();
  });

  it('Given 쓴 사람이 지금 담당자 표에 없으면(이름 없음) When 메모를 보면 Then 이름 자리에 담당자 키가 보인다', () => {
    renderBox({ memos: [memo('daymemo-3', '출장', { staffKey: 'old-staff', staffName: null })] });
    expect(screen.getByTestId('day-memo-byline')).toHaveTextContent(/^old-staff · 11\/28 17:40$/);
  });

  it('Given 그날 메모가 없으면 When 메모 칸을 보면 Then "남긴 메모가 없습니다"와 입력 칸이 보인다', () => {
    renderBox({ memos: [] });
    expect(screen.getByTestId('day-memo-empty')).toHaveTextContent(
      /^이 날짜에 남긴 메모가 없습니다$/,
    );
    expect(screen.queryByTestId('day-memo-list')).not.toBeInTheDocument();
    expect(input()).toBeEnabled();
  });

  it('Given 내 메모와 남의 메모가 있으면 When 메모 칸을 보면 Then 내가 쓴 메모에만 [지우기]가 있다', () => {
    renderBox();
    const rows = screen.getAllByTestId('day-memo-item');
    expect(within(rows[0]).getByTestId('day-memo-remove')).toHaveAccessibleName(
      '메모 지우기: 오전 안전 교육. 통화는 오후에 몰아서 하기',
    );
    expect(within(rows[1]).queryByTestId('day-memo-remove')).not.toBeInTheDocument();
  });

  it('메모 칸에는 AI로 보낸다는 표시("유료" 꼬리표)가 없고, 팀이 함께 본다는 안내가 있다', () => {
    renderBox();
    const box = screen.getByTestId('day-memo-box');
    expect(box).not.toHaveTextContent('유료');
    expect(screen.getByTestId('day-memo-hint')).toHaveTextContent(
      '팀이 함께 봅니다. 그날이 되면 영업 홈 "오늘 할 일"에도 보입니다. AI · 엑셀로는 내보내지 않습니다.',
    );
  });
});

describe('메모 남기기', () => {
  it('입력 칸은 읽는 이름 · 흐린 안내 글 · 200자 상한을 갖는다', () => {
    renderBox();
    expect(input()).toHaveAccessibleName('이 날짜에 메모 남기기');
    expect(input()).toHaveAttribute('placeholder', '이 날짜에 짧은 메모 남기기 (200자)');
    expect(input()).toHaveAttribute('maxLength', '200');
  });

  it('Given 200자를 넘겨 적으면 When 입력하면 Then 200자까지만 들어간다', async () => {
    renderBox({ memos: [] });
    await userEvent.click(input());
    await userEvent.paste('가'.repeat(205));
    expect(input().value).toHaveLength(200);
  });

  it('Given 글이 비었거나 빈칸뿐이면 When 저장하려 하면 Then [저장]이 눌리지 않고 요청도 가지 않는다', async () => {
    renderBox({ memos: [] });
    expect(saveButton()).toBeDisabled();
    await userEvent.type(input(), '   ');
    expect(saveButton()).toBeDisabled();
    // Enter로도 보내지지 않는다.
    await userEvent.type(input(), '{Enter}');
    fireEvent.submit(input().closest('form') as HTMLFormElement);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('Given 담당자가 글을 적으면 When [저장]을 누르면 Then 그 날짜 · 앞뒤 빈칸을 뺀 글 · 담당자 키로 저장하고 입력 칸을 비우며 바뀜을 알린다', async () => {
    const saved = memo('daymemo-9', '샘플 받으러 가기');
    mockedPost.mockResolvedValueOnce({ data: saved, meta: {} });
    const ears = listen();
    renderBox({ memos: [] });
    await userEvent.type(input(), '  샘플 받으러 가기 ');
    expect(saveButton()).toBeEnabled();
    await userEvent.click(saveButton());
    await waitFor(() => expect(input().value).toBe(''));
    ears.stop();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith('2026-12-09', '샘플 받으러 가기', 'park-lee');
    expect(ears.heard).toEqual([{ type: 'added', memo: saved }]);
    expect(screen.queryByTestId('day-memo-save-error')).not.toBeInTheDocument();
  });

  it('Given 글을 적고 When Enter를 누르면 Then [저장]을 누른 것과 같이 저장한다', async () => {
    mockedPost.mockResolvedValueOnce({ data: memo('daymemo-9', '전화'), meta: {} });
    renderBox({ memos: [] });
    await userEvent.type(input(), '전화{Enter}');
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('2026-12-09', '전화', 'park-lee'));
  });

  it('Given 저장이 실패하면 When 응답이 오면 Then 그 자리에 서버가 준 이유를 알리고 적던 글은 그대로 두며 바뀜을 알리지 않는다', async () => {
    mockedPost.mockRejectedValueOnce(
      apiError(400, '날짜 메모의 글자 수를 확인해 주세요.', '줄여서 다시 저장해 주세요.'),
    );
    const ears = listen();
    renderBox({ memos: [] });
    await userEvent.type(input(), '샘플 받으러 가기');
    await userEvent.click(saveButton());
    const alert = await screen.findByTestId('day-memo-save-error');
    ears.stop();
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(
      /^날짜 메모의 글자 수를 확인해 주세요\. 줄여서 다시 저장해 주세요\.$/,
    );
    expect(input().value).toBe('샘플 받으러 가기');
    expect(saveButton()).toBeEnabled();
    expect(ears.heard).toEqual([]);
  });

  it('Given 서버 응답이 아닌 실패면 When 저장하면 Then 기본 안내 "메모를 저장하지 못했습니다"를 보인다', async () => {
    mockedPost.mockRejectedValueOnce(new Error('boom'));
    renderBox({ memos: [] });
    await userEvent.type(input(), '전화');
    await userEvent.click(saveButton());
    expect(await screen.findByTestId('day-memo-save-error')).toHaveTextContent(
      /^메모를 저장하지 못했습니다\. 다시 시도해 주세요\.$/,
    );
  });
});

describe('메모 지우기', () => {
  it('Given 내가 쓴 메모가 있으면 When [지우기]를 누르면 Then 그 메모 번호 · 담당자 키로 지우고 바뀜을 알린다', async () => {
    mockedDelete.mockResolvedValueOnce({ data: { memoId: 'daymemo-1', deleted: true }, meta: {} });
    const ears = listen();
    renderBox();
    await userEvent.click(screen.getByTestId('day-memo-remove'));
    await waitFor(() => expect(ears.heard).toEqual([{ type: 'deleted', memoId: 'daymemo-1' }]));
    ears.stop();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith('daymemo-1', 'park-lee');
    expect(screen.queryByTestId('day-memo-remove-error')).not.toBeInTheDocument();
  });

  it('Given 서버가 막으면(403) When [지우기]를 누르면 Then 그 자리에 이유를 알리고 메모는 그대로 보이며 바뀜을 알리지 않는다', async () => {
    mockedDelete.mockRejectedValueOnce(
      apiError(403, '다른 담당자의 메모는 지울 수 없습니다.', '메모를 쓴 담당자에게 알려 주세요.'),
    );
    const ears = listen();
    const { onReload } = renderBox();
    await userEvent.click(screen.getByTestId('day-memo-remove'));
    const alert = await screen.findByTestId('day-memo-remove-error');
    ears.stop();
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(
      /^다른 담당자의 메모는 지울 수 없습니다\. 메모를 쓴 담당자에게 알려 주세요\.$/,
    );
    expect(screen.getAllByTestId('day-memo-item')).toHaveLength(2);
    expect(ears.heard).toEqual([]);
    expect(onReload).not.toHaveBeenCalled();
    // 다시 누를 수 있다.
    expect(screen.getByTestId('day-memo-remove')).toBeEnabled();
  });

  it('Given 이미 없는 메모면(404) When [지우기]를 누르면 Then 이유를 알리고 목록을 서버 값으로 다시 읽게 하며, 다른 곳에서도 그 메모를 빼게 알린다', async () => {
    mockedDelete.mockRejectedValueOnce(
      apiError(404, '지울 메모가 없습니다.', '화면을 새로 고쳐 다시 봐 주세요.'),
    );
    const ears = listen();
    const { onReload } = renderBox();
    await userEvent.click(screen.getByTestId('day-memo-remove'));
    expect(await screen.findByTestId('day-memo-remove-error')).toHaveTextContent(
      /^지울 메모가 없습니다\. 화면을 새로 고쳐 다시 봐 주세요\.$/,
    );
    ears.stop();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(ears.heard).toEqual([{ type: 'deleted', memoId: 'daymemo-1' }]);
  });
});

describe('보기 전용 · 담당자 미선택', () => {
  it.each([
    ['보기 전용', { staffKey: 'viewer', canRecord: false }],
    ['담당자 미선택', { staffKey: null, canRecord: false }],
  ])(
    'Given %s이면 When 메모 칸을 보면 Then 메모는 읽히고 입력 칸 · [저장]은 눌리지 않으며 "먼저 담당자를 고르세요"가 보이고 [지우기]는 없다',
    (_name, value) => {
      renderBox({}, value);
      expect(screen.getAllByTestId('day-memo-item')).toHaveLength(2);
      expect(input()).toBeDisabled();
      expect(saveButton()).toBeDisabled();
      expect(screen.getByTestId('day-memo-pick-staff')).toHaveTextContent(
        /^먼저 담당자를 고르세요$/,
      );
      expect(screen.queryByTestId('day-memo-remove')).not.toBeInTheDocument();
      fireEvent.submit(input().closest('form') as HTMLFormElement);
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );

  it('기록 담당자에게는 "먼저 담당자를 고르세요"가 보이지 않는다', () => {
    renderBox();
    expect(screen.queryByTestId('day-memo-pick-staff')).not.toBeInTheDocument();
  });
});

describe('메모 읽기 상태', () => {
  it('Given 읽는 중이면 When 메모 칸을 보면 Then "불러오는 중"만 보이고 빈 목록 안내는 보이지 않는다', () => {
    renderBox({ memos: [], state: 'loading' });
    expect(screen.getByTestId('day-memo-loading')).toHaveTextContent(/^메모를 불러오는 중입니다$/);
    expect(screen.queryByTestId('day-memo-empty')).not.toBeInTheDocument();
  });

  it('Given 메모를 못 읽었으면 When 메모 칸을 보면 Then 짧은 안내와 [다시 읽기]가 보이고(빈 목록처럼 보이지 않는다) 누르면 다시 읽는다', async () => {
    const { onReload } = renderBox({ memos: [], state: 'error' });
    const alert = screen.getByTestId('day-memo-load-error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent(/^메모를 불러오지 못했습니다 다시 읽기$/);
    expect(screen.queryByTestId('day-memo-empty')).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByTestId('day-memo-retry'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('Given 전에 읽은 메모는 있는데 다시 읽기에 실패했으면 When 메모 칸을 보면 Then 앞서 읽은 메모와 함께 "새 메모를 읽지 못했다"고 알린다', () => {
    renderBox({ stale: true });
    expect(screen.getAllByTestId('day-memo-item')).toHaveLength(2);
    expect(screen.getByTestId('day-memo-stale')).toHaveTextContent(
      /^새 메모를 읽지 못했습니다\. 앞서 읽은 메모입니다\. 다시 읽기$/,
    );
  });
});
