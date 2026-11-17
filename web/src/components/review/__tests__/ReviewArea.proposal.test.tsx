// AI 제안 줄(#498): 체크 상자 대신 [확정]·[고치기], 드롭다운(모달 없음), stepLabel 전송, 저장 뒤 다시 불러오기 알림.
// 서버 호출(postReviewCheck)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버 #497이 합쳐지기 전).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea from '../ReviewArea';
import { ApiError, postReviewCheck } from '../../../api/client';
import type { ConfigUi, Envelope, ReviewCheckResponse, ReviewItem } from '../../../api/types';
import proposalFixture from '../../../test/fixtures/review-items-ai-proposal.json';
import { FrameContext } from '../../frame/FrameContext';
import { reviewArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postReviewCheck: vi.fn(),
}));

const mockedCheck = vi.mocked(postReviewCheck);

const proposals = proposalFixture.reviewItems as unknown as ReviewItem[];
const scoreProposal = proposals[0];
const processProposal = proposals[1];

const question: ReviewItem = {
  itemId: 'Q:q-1',
  kind: 'QUESTION',
  source: 'AI',
  text: '납품 거래처를 알려 줄 수 있는지',
  targetLabel: '상대 회사',
  checked: false,
};

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
} as unknown as ConfigUi;

function saved(itemId: string): Envelope<ReviewCheckResponse> {
  return {
    data: {
      itemId,
      checked: true,
      checkedBy: 'park-lee',
      checkedAt: '2026-11-09T17:00:00+09:00',
    },
    meta: { updatedAt: '2026-11-09T17:00:00+09:00' },
  };
}

function renderArea(
  overrides: {
    items?: ReviewItem[];
    canRecord?: boolean;
    staffKey?: string | null;
    onProposalSaved?: () => void;
  } = {},
) {
  const { canRecord = true, staffKey = 'park-lee' } = overrides;
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey,
        setStaffKey: () => {},
        canRecord,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ReviewArea
        oppId="opp-1"
        evalId="eval-1"
        items={overrides.items ?? proposals}
        onProposalSaved={overrides.onProposalSaved}
      />
    </FrameContext.Provider>,
  );
}

describe('ReviewArea · AI 제안 줄', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
  });

  it('제안 줄에는 체크 상자가 없고 꼬리표와 [확정]이 보이며, [고치기]는 점수 입력 줄에만 있다', () => {
    renderArea();
    const rows = screen.getAllByTestId('review-item');
    expect(rows).toHaveLength(2);

    const score = rows[0];
    expect(within(score).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(score).getByTestId('review-tag')).toHaveTextContent('AI 제안 점수 입력');
    expect(within(score).getByTestId('review-text')).toHaveTextContent('소재와 보유 공정 일치');
    expect(within(score).getByTestId('review-proposal-confirm')).toHaveTextContent('확정');
    expect(within(score).getByTestId('review-proposal-fix')).toHaveTextContent('고치기');

    // 공정 연결 제안은 1차에 [확정]만이다.
    const link = rows[1];
    expect(within(link).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(link).getByTestId('review-tag')).toHaveTextContent('AI 제안 공정 연결');
    expect(within(link).getByTestId('review-proposal-confirm')).toBeInTheDocument();
    expect(within(link).queryByTestId('review-proposal-fix')).not.toBeInTheDocument();
  });

  it('기존 줄(질문)은 그대로 체크 상자가 있고 제안 단추가 붙지 않는다', () => {
    renderArea({ items: [question, scoreProposal] });
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[0]).getByRole('checkbox')).toBeInTheDocument();
    expect(within(rows[0]).queryByTestId('review-proposal-confirm')).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('[확정]은 checked:true만 보내고(stepLabel 없음) 저장이 끝나면 다시 불러오게 알린다', async () => {
    mockedCheck.mockResolvedValueOnce(saved(scoreProposal.itemId));
    const onProposalSaved = vi.fn();
    renderArea({ onProposalSaved });
    fireEvent.click(
      within(screen.getAllByTestId('review-item')[0]).getByTestId('review-proposal-confirm'),
    );
    await waitFor(() => expect(onProposalSaved).toHaveBeenCalledTimes(1));
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'II:NEW_MATERIAL',
      { checked: true, evalId: 'eval-1' },
      'park-lee',
    );
    const body = mockedCheck.mock.calls[0][2];
    expect('stepLabel' in body).toBe(false);
  });

  it('공정 연결 제안도 [확정]이 같은 체크 저장을 쓴다', async () => {
    mockedCheck.mockResolvedValueOnce(saved(processProposal.itemId));
    const onProposalSaved = vi.fn();
    renderArea({ onProposalSaved });
    fireEvent.click(
      within(screen.getAllByTestId('review-item')[1]).getByTestId('review-proposal-confirm'),
    );
    await waitFor(() => expect(onProposalSaved).toHaveBeenCalledTimes(1));
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'PL:ZINC_PLATING',
      { checked: true, evalId: 'eval-1' },
      'park-lee',
    );
  });

  it('[고치기]를 누르면 줄 안에 드롭다운이 열리고 선택지는 서버가 준 단계다(모달 없음)', () => {
    renderArea();
    const row = screen.getAllByTestId('review-item')[0];
    expect(within(row).queryByTestId('review-fix-editor')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTestId('review-proposal-fix'));
    const editor = within(row).getByTestId('review-fix-editor');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const select = within(editor).getByTestId('review-fix-select');
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toEqual([reviewArea.stepPlaceholder, '정확히 일치', '일부 가능']);
    // 단계를 고르기 전에는 저장할 수 없다.
    expect(within(editor).getByTestId('review-fix-save')).toBeDisabled();
  });

  it('[고치기]에서 단계를 고르고 저장하면 checked:true와 stepLabel을 함께 보낸다', async () => {
    mockedCheck.mockResolvedValueOnce(saved(scoreProposal.itemId));
    const onProposalSaved = vi.fn();
    renderArea({ onProposalSaved });
    const row = screen.getAllByTestId('review-item')[0];
    fireEvent.click(within(row).getByTestId('review-proposal-fix'));
    fireEvent.change(within(row).getByTestId('review-fix-select'), {
      target: { value: '정확히 일치' },
    });
    expect(within(row).getByTestId('review-fix-save')).toBeEnabled();
    fireEvent.click(within(row).getByTestId('review-fix-save'));
    await waitFor(() => expect(onProposalSaved).toHaveBeenCalledTimes(1));
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'II:NEW_MATERIAL',
      { checked: true, evalId: 'eval-1', stepLabel: '정확히 일치' },
      'park-lee',
    );
    // 저장 뒤 드롭다운은 닫힌다.
    expect(within(row).queryByTestId('review-fix-editor')).not.toBeInTheDocument();
  });

  it('[고치기]를 취소하면 요청 없이 드롭다운만 닫힌다', () => {
    renderArea();
    const row = screen.getAllByTestId('review-item')[0];
    fireEvent.click(within(row).getByTestId('review-proposal-fix'));
    fireEvent.click(within(row).getByTestId('review-fix-cancel'));
    expect(within(row).queryByTestId('review-fix-editor')).not.toBeInTheDocument();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('서버가 단계 선택지를 주지 않은 점수 입력 줄에는 [고치기]가 보이지 않는다', () => {
    renderArea({ items: [{ ...scoreProposal, stepOptions: null }] });
    const row = screen.getByTestId('review-item');
    expect(within(row).getByTestId('review-proposal-confirm')).toBeInTheDocument();
    expect(within(row).queryByTestId('review-proposal-fix')).not.toBeInTheDocument();
  });

  it('저장이 실패하면 쉬운 말 오류를 보이고, 다시 불러오라는 알림은 보내지 않으며 줄은 그대로다', async () => {
    mockedCheck.mockRejectedValueOnce(
      new ApiError(400, { message: '고를 수 없는 단계입니다.', nextAction: '', ref: 'r-1' }),
    );
    const onProposalSaved = vi.fn();
    renderArea({ onProposalSaved });
    const row = screen.getAllByTestId('review-item')[0];
    fireEvent.click(within(row).getByTestId('review-proposal-confirm'));
    const alert = await screen.findByTestId('review-error');
    expect(alert).toHaveTextContent(reviewArea.saveFailed);
    expect(alert).toHaveTextContent('고를 수 없는 단계입니다.');
    expect(onProposalSaved).not.toHaveBeenCalled();
    expect(within(row).getByTestId('review-proposal-confirm')).toBeEnabled();
  });

  it('보기 전용 등 기록할 수 없는 담당자에게는 [확정]·[고치기]가 잠긴다', () => {
    renderArea({ canRecord: false, staffKey: 'viewer' });
    const row = screen.getAllByTestId('review-item')[0];
    expect(within(row).getByTestId('review-proposal-confirm')).toBeDisabled();
    expect(within(row).getByTestId('review-proposal-fix')).toBeDisabled();
  });

  it('이미 확인된 제안 줄에는 [확정]·[고치기]가 없고 확인한 사람과 날짜가 보인다', () => {
    renderArea({
      items: [
        {
          ...scoreProposal,
          checked: true,
          checkedBy: 'park-lee',
          checkedAt: '2026-11-09T17:00:00+09:00',
        },
      ],
    });
    const row = screen.getByTestId('review-item');
    expect(within(row).queryByTestId('review-proposal-confirm')).not.toBeInTheDocument();
    expect(within(row).queryByTestId('review-proposal-fix')).not.toBeInTheDocument();
    expect(within(row).getByTestId('review-checked-by')).toHaveTextContent('박 이사');
  });
});
