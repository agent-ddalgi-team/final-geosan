// [관심] 단추(#357): 켜짐·꺼짐 표시(aria-pressed) / 켜기·끄기 요청 본문과 담당자 / 끄기 거부(422) 문구 그대로 /
// 그 밖의 실패 안내 / 잠금(담당자 없음·보기 전용). 카드와 상세 머리가 이 부품을 같이 쓴다.
// 서버 호출(putBookmark)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookmarkButton from '../BookmarkButton';
import { ApiError, putBookmark } from '../../../api/client';
import type { BookmarkRecord } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { bookmarkTexts, errorTexts, recordsArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  putBookmark: vi.fn(),
}));

const mockedPut = vi.mocked(putBookmark);
const OPP = 'opp-1';

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
    ...overrides,
  };
}

function record(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    version: 3,
    updatedBy: 'kim-gwajang',
    updatedAt: '2026-11-06T01:00:00Z',
    active: true,
    ...overrides,
  };
}

function renderButton(bookmark: BookmarkRecord | null, value: FrameValue = frameValue()) {
  const onChanged = vi.fn();
  render(
    <FrameContext.Provider value={value}>
      <BookmarkButton oppId={OPP} bookmark={bookmark} onChanged={onChanged} />
    </FrameContext.Provider>,
  );
  return onChanged;
}

describe('BookmarkButton', () => {
  beforeEach(() => {
    mockedPut.mockReset();
  });

  it.each([
    ['한 번도 켠 적이 없으면(null)', null],
    ['켰다가 끈 기록이면(active false)', record({ active: false })],
  ])('%s 꺼짐: 글자는 "관심"이고 눌리지 않은 상태로 알린다', (_name, bookmark) => {
    renderButton(bookmark);
    const button = screen.getByTestId('bookmark-button');
    expect(button).toHaveTextContent(/^관심$/);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toBeEnabled();
  });

  it('켜져 있으면 글자는 "관심 기업"이고 눌린 상태로 알린다', () => {
    renderButton(record());
    const button = screen.getByTestId('bookmark-button');
    expect(button).toHaveTextContent(/^관심 기업$/);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    // 그림 문자 없이 글자와 굵기로 구분한다.
    expect(button).toHaveStyle({ fontWeight: 700 });
  });

  it('꺼진 단추를 누르면 켜기 요청(active true)을 고른 담당자로 보내고, 서버가 돌려준 값을 알린다', async () => {
    const user = userEvent.setup();
    const saved = record({ version: 1, updatedBy: 'park-lee' });
    mockedPut.mockResolvedValueOnce({ data: saved, meta: {} });
    const onChanged = renderButton(null);
    await user.click(screen.getByTestId('bookmark-button'));
    expect(mockedPut).toHaveBeenCalledWith(
      OPP,
      { active: true, expectedVersion: null },
      'park-lee',
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(saved));
    expect(screen.queryByTestId('bookmark-error')).not.toBeInTheDocument();
  });

  it('켜진 단추를 누르면 끄기 요청(active false)을 지금 본 판 번호와 함께 보낸다', async () => {
    const user = userEvent.setup();
    const saved = record({ version: 4, active: false, updatedBy: 'park-lee' });
    mockedPut.mockResolvedValueOnce({ data: saved, meta: {} });
    const onChanged = renderButton(record({ version: 3 }));
    await user.click(screen.getByTestId('bookmark-button'));
    expect(mockedPut).toHaveBeenCalledWith(OPP, { active: false, expectedVersion: 3 }, 'park-lee');
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(saved));
  });

  it('기록이 있어 끄기가 거부되면(422) 서버의 문구와 다음 할 일을 단추 옆에 그대로 보이고 값은 바꾸지 않는다', async () => {
    const user = userEvent.setup();
    mockedPut.mockRejectedValueOnce(
      new ApiError(422, {
        message: '기록이 있는 회사는 관심에서 뺄 수 없습니다',
        nextAction: "빼려면 검토 의견을 '제외'로 저장해 주세요",
        ref: 'r-1',
        kind: 'BOOKMARK_HAS_RECORDS',
      }),
    );
    const onChanged = renderButton(record());
    await user.click(screen.getByTestId('bookmark-button'));
    const alert = await screen.findByRole('alert');
    expect(screen.getByTestId('bookmark-refused-message')).toHaveTextContent(
      /^기록이 있는 회사는 관심에서 뺄 수 없습니다$/,
    );
    expect(screen.getByTestId('bookmark-refused-next')).toHaveTextContent(
      /^빼려면 검토 의견을 '제외'로 저장해 주세요$/,
    );
    // 코드 이름은 화면에 보이지 않는다.
    expect(alert).not.toHaveTextContent('BOOKMARK_HAS_RECORDS');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('그 밖의 실패는 기록 저장 실패와 같은 안내에 서버의 쉬운 말을 붙여 보인다', async () => {
    const user = userEvent.setup();
    mockedPut.mockRejectedValueOnce(
      new ApiError(403, {
        message: '이 담당자는 기록을 남길 수 없습니다.',
        nextAction: '담당자를 다시 고르세요',
        ref: 'r-2',
      }),
    );
    const onChanged = renderButton(null);
    await user.click(screen.getByTestId('bookmark-button'));
    const alert = await screen.findByTestId('bookmark-error');
    expect(alert).toHaveTextContent(recordsArea.saveFailed);
    expect(alert).toHaveTextContent('이 담당자는 기록을 남길 수 없습니다.');
    expect(screen.queryByTestId('bookmark-refused-message')).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('서버에 닿지 못하면 연결 실패 문구를 보이고, 다시 눌러 성공하면 안내가 사라진다', async () => {
    const user = userEvent.setup();
    mockedPut.mockRejectedValueOnce(new Error('boom'));
    mockedPut.mockResolvedValueOnce({ data: record({ version: 1 }), meta: {} });
    const onChanged = renderButton(null);
    await user.click(screen.getByTestId('bookmark-button'));
    expect(await screen.findByTestId('bookmark-error')).toHaveTextContent(errorTexts.network);
    await user.click(screen.getByTestId('bookmark-button'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('bookmark-error')).not.toBeInTheDocument();
  });

  it.each([
    ['담당자를 고르기 전', { canRecord: false, staffKey: null }],
    ['보기 전용', { canRecord: false, staffKey: 'viewer' }],
  ])('%s에는 단추가 잠기고 안내가 보이며 서버를 부르지 않는다', async (_name, frame) => {
    const user = userEvent.setup();
    renderButton(null, frameValue(frame));
    const button = screen.getByTestId('bookmark-button');
    expect(button).toBeDisabled();
    await user.click(button);
    expect(mockedPut).not.toHaveBeenCalled();
    expect(screen.getByTestId('bookmark-pick-staff-text')).toHaveTextContent(
      bookmarkTexts.pickStaffFirst,
    );
  });

  it('담당자를 골랐으면 잠금 안내는 보이지 않는다', () => {
    renderButton(null);
    expect(screen.queryByTestId('bookmark-pick-staff-text')).not.toBeInTheDocument();
  });
});
