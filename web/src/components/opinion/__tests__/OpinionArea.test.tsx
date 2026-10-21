// 의견 영역(BR9.1·BR9.4·BR10.6): 3값 저장 / 사유 필수 / 저장됨 → 영구 문구 / 실패 시 입력 유지 /
// 담당자 미선택 비활성 / 이전 값 안내 / aria-live. 서버 호출(postOpinion)은 가짜로 바꾼 확인이다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpinionArea, { SAVED_FLASH_MS } from '../OpinionArea';
import { ApiError, postOpinion } from '../../../api/client';
import type { Meta, OpinionRecord } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { opinionArea, opinionLabels } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOpinion: vi.fn(),
}));

const mockedPost = vi.mocked(postOpinion);
const OPP = 'opp-1';
const EVAL = 'eval-1';

function frameValue(overrides: Partial<FrameValue> = {}): FrameValue {
  return {
    config: null,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    ...overrides,
  };
}

function saved(overrides: Partial<OpinionRecord> = {}): OpinionRecord {
  return {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-10-20T01:12:00Z', // 한국 시각 10:12
    opinion: 'WORTH_REVIEW',
    reason: null,
    memo: null,
    ...overrides,
  };
}

function reply(record: OpinionRecord, meta: Meta = {}) {
  return { data: record, meta };
}

function renderArea(value: FrameValue = frameValue(), record: OpinionRecord | null = null) {
  return render(
    <FrameContext.Provider value={value}>
      <OpinionArea oppId={OPP} evalId={EVAL} record={record} />
    </FrameContext.Provider>,
  );
}

describe('OpinionArea', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  it('세 값(검토할 만함·추가 확인·대상 아님+사유)이 평가 ID와 함께 저장된다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(reply(saved({ opinion: 'WORTH_REVIEW' })));
    renderArea();
    await user.click(screen.getByTestId('opinion-worth-review-button'));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenLastCalledWith(
        OPP,
        { opinion: 'WORTH_REVIEW', evalId: EVAL, expectedVersion: null },
        'park-lee',
      ),
    );

    mockedPost.mockResolvedValueOnce(reply(saved({ version: 2, opinion: 'NEED_CHECK' })));
    await user.click(await screen.findByTestId('opinion-need-check-button'));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenLastCalledWith(
        OPP,
        { opinion: 'NEED_CHECK', evalId: EVAL, expectedVersion: 1 },
        'park-lee',
      ),
    );

    mockedPost.mockResolvedValueOnce(
      reply(saved({ version: 3, opinion: 'NOT_TARGET', reason: '타지역' })),
    );
    await user.click(screen.getByTestId('opinion-not-target-button'));
    await user.type(screen.getByTestId('opinion-reason-input'), '타지역');
    await user.click(screen.getByTestId('opinion-reason-save-button'));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenLastCalledWith(
        OPP,
        { opinion: 'NOT_TARGET', evalId: EVAL, expectedVersion: 2, reason: '타지역' },
        'park-lee',
      ),
    );
  });

  it("'대상 아님'은 사유가 없으면 저장할 수 없고 글자로 사유를 요구한다", async () => {
    const user = userEvent.setup();
    renderArea();
    await user.click(screen.getByTestId('opinion-not-target-button'));
    expect(screen.getByTestId('opinion-reason-input')).toHaveFocus();
    expect(screen.getByTestId('opinion-reason-input')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByTestId('opinion-reason-error')).toHaveTextContent(
      opinionArea.reasonRequired,
    );
    expect(screen.getByTestId('opinion-reason-save-button')).toBeDisabled();

    await user.type(screen.getByTestId('opinion-reason-input'), '   ');
    expect(screen.getByTestId('opinion-reason-save-button')).toBeDisabled();
    await user.type(screen.getByTestId('opinion-reason-input'), '타지역');
    expect(screen.getByTestId('opinion-reason-save-button')).toBeEnabled();
    expect(screen.queryByTestId('opinion-reason-error')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('opinion-reason-input')).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('저장되면 "저장됨 HH:MM"이 3초 보였다가 "의견: 검토할 만함 (수정)"으로 바뀐다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedPost.mockResolvedValueOnce(reply(saved()));
      renderArea();
      fireEvent.click(screen.getByTestId('opinion-worth-review-button'));
      await waitFor(() =>
        expect(screen.getByTestId('opinion-saved-text')).toHaveTextContent('저장됨 10:12'),
      );
      expect(screen.queryByTestId('opinion-summary')).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(SAVED_FLASH_MS);
      });
      expect(screen.getByTestId('opinion-saved-text')).toHaveTextContent('');
      expect(screen.getByTestId('opinion-summary')).toHaveTextContent(
        `${opinionArea.savedSummaryPrefix} ${opinionLabels.WORTH_REVIEW}`,
      );
      expect(screen.getByRole('button', { name: opinionArea.edit })).toBeEnabled();
      expect(screen.queryByTestId('opinion-worth-review-button')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('opinion-edit-button'));
      expect(screen.getByTestId('opinion-worth-review-button')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('저장에 실패하면 실패 문구를 보이고 적어 둔 사유는 그대로 남는다', async () => {
    const user = userEvent.setup();
    mockedPost.mockRejectedValueOnce(
      new ApiError(500, {
        message: '저장 중 문제가 생겼습니다.',
        nextAction: '다시 시도해 주세요.',
        ref: 'r-1',
      }),
    );
    renderArea();
    await user.click(screen.getByTestId('opinion-not-target-button'));
    await user.type(screen.getByTestId('opinion-reason-input'), '타지역');
    await user.click(screen.getByTestId('opinion-reason-save-button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(opinionArea.saveFailed);
    expect(screen.getByTestId('opinion-reason-input')).toHaveValue('타지역');
    expect(screen.getByTestId('opinion-reason-save-button')).toBeEnabled();
    expect(screen.queryByTestId('opinion-summary')).not.toBeInTheDocument();
  });

  it('담당자를 고르지 않았거나 보기 전용이면 버튼이 꺼지고 이유가 글자로 보인다', () => {
    const { unmount } = renderArea(frameValue({ staffKey: null, canRecord: false }));
    for (const id of [
      'opinion-worth-review-button',
      'opinion-need-check-button',
      'opinion-not-target-button',
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    expect(screen.getByTestId('opinion-pick-staff-text')).toHaveTextContent(
      opinionArea.pickStaffFirst,
    );
    unmount();

    renderArea(frameValue({ staffKey: 'viewer', canRecord: false }));
    expect(screen.getByTestId('opinion-worth-review-button')).toBeDisabled();
    expect(screen.getByTestId('opinion-pick-staff-text')).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('다른 담당자가 먼저 바꿨으면 이전 값과 함께 안내하고 내 저장은 남긴다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(
      reply(saved({ version: 3, opinion: 'NEED_CHECK' }), {
        previousValue: { opinion: 'WORTH_REVIEW', version: 2 },
      }),
    );
    renderArea(frameValue(), saved({ version: 1 }));
    await user.click(screen.getByTestId('opinion-edit-button'));
    await user.click(screen.getByTestId('opinion-need-check-button'));

    const notice = await screen.findByTestId('opinion-changed-by-other');
    expect(notice).toHaveTextContent(opinionArea.changedByOther);
    expect(notice).toHaveTextContent(`${opinionArea.previousPrefix} ${opinionLabels.WORTH_REVIEW}`);
    expect(screen.getByTestId('opinion-need-check-button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('저장 결과 자리는 aria-live=polite이고 버튼 묶음은 이름이 있는 그룹이며 눌린 상태가 aria-pressed로 보인다', async () => {
    const user = userEvent.setup();
    mockedPost.mockResolvedValueOnce(reply(saved()));
    renderArea();
    expect(screen.getByTestId('opinion-saved-text')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('group', { name: opinionArea.groupLabel })).toBeInTheDocument();
    expect(screen.getByTestId('opinion-worth-review-button')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(screen.getByTestId('opinion-worth-review-button'));
    await waitFor(() =>
      expect(screen.getByTestId('opinion-worth-review-button')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByTestId('opinion-saved-text')).toHaveTextContent(/^저장됨 \d{2}:\d{2}$/);
  });
});
