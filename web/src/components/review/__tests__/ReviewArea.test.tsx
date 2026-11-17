// 검토사항 영역: 머리 "확인 n / m", 꼬리표, 체크 저장 호출, 체크한 사람·날짜, 실패, 담당자 미선택.
// 서버 호출(postReviewCheck)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea from '../ReviewArea';
import { ApiError, postQuestionReply, postReviewCheck } from '../../../api/client';
import type {
  ConfigUi,
  Envelope,
  ReplyResponse,
  ReviewCheckResponse,
  ReviewItem,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { reviewArea } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postReviewCheck: vi.fn(),
  postQuestionReply: vi.fn(),
}));

const mockedCheck = vi.mocked(postReviewCheck);
const mockedReply = vi.mocked(postQuestionReply);

const items: ReviewItem[] = [
  {
    itemId: 'Q:q-1',
    kind: 'QUESTION',
    source: 'AI',
    text: '납품 거래처를 알려 줄 수 있는지',
    targetLabel: '상대 회사',
    checked: false,
  },
  {
    itemId: 'Q:q-2',
    kind: 'QUESTION',
    source: 'CASE_FILE',
    text: '당진에서 직접 생산하는지',
    targetLabel: '거산',
    checked: true,
    checkedBy: 'park-lee',
    checkedAt: '2026-11-06T14:20:00+09:00',
  },
  {
    itemId: 'GAP:HOMEPAGE',
    kind: 'DATA_NOT_FOUND',
    source: 'RULE',
    text: '홈페이지를 찾지 못함',
    targetLabel: null,
    checked: false,
  },
  {
    itemId: 'GAP:ITEM:NEW_RECORD',
    kind: 'DATA_INSUFFICIENT',
    source: 'RULE',
    text: '납품 실적 근거 없음',
    targetLabel: null,
    checked: false,
  },
];

const config = {
  staff: [{ key: 'park-lee', displayName: '박 이사' }],
} as unknown as ConfigUi;

function envelope(data: ReviewCheckResponse): Envelope<ReviewCheckResponse> {
  return { data, meta: { updatedAt: '2026-11-06T14:30:00+09:00' } };
}

function renderArea(
  overrides: {
    staffKey?: string | null;
    canRecord?: boolean;
    evalId?: string | null;
    items?: ReviewItem[];
    onReplied?: () => void;
  } = {},
) {
  const { staffKey = 'park-lee', canRecord = true, evalId = 'eval-1' } = overrides;
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
        evalId={evalId}
        items={overrides.items ?? items}
        onReplied={overrides.onReplied}
      />
    </FrameContext.Provider>,
  );
}

describe('ReviewArea', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
    mockedReply.mockReset();
  });

  it('머리에 확인한 수와 전체 수가 보이고 줄마다 꼬리표가 붙는다', () => {
    renderArea();
    expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 1 / 4');
    const tags = screen.getAllByTestId('review-tag').map((tag) => tag.textContent);
    expect(tags).toEqual(['AI 질문·상대 회사', 'AI 질문·거산', '자료 못 찾음', '자료 부족']);
    expect(screen.getAllByTestId('review-item')).toHaveLength(4);
  });

  it('체크한 줄에는 체크한 사람 이름과 날짜가 보이고 체크 안 한 줄에는 없다', () => {
    renderArea();
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[1]).getByTestId('review-checked-by')).toHaveTextContent(
      '박 이사 · 11/6 확인',
    );
    expect(within(rows[0]).queryByTestId('review-checked-by')).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('checkbox')).toBeChecked();
  });

  it('체크하면 평가 ID와 함께 저장을 부르고 저장이 끝나면 확인 수와 이름이 바뀐다', async () => {
    mockedCheck.mockResolvedValueOnce(
      envelope({
        itemId: 'GAP:HOMEPAGE',
        checked: true,
        checkedBy: 'park-lee',
        checkedAt: '2026-11-06T14:30:00+09:00',
      }),
    );
    renderArea();
    const rows = screen.getAllByTestId('review-item');
    fireEvent.click(within(rows[2]).getByRole('checkbox'));
    await waitFor(() =>
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 2 / 4'),
    );
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'GAP:HOMEPAGE',
      { checked: true, evalId: 'eval-1' },
      'park-lee',
    );
    expect(
      within(screen.getAllByTestId('review-item')[2]).getByTestId('review-checked-by'),
    ).toHaveTextContent('박 이사 · 11/6 확인');
  });

  it('체크를 해제해도 저장을 부르고 확인 수가 줄어든다(지우기가 아니라 새 기록)', async () => {
    mockedCheck.mockResolvedValueOnce(
      envelope({ itemId: 'Q:q-2', checked: false, checkedBy: null, checkedAt: null }),
    );
    renderArea();
    fireEvent.click(within(screen.getAllByTestId('review-item')[1]).getByRole('checkbox'));
    await waitFor(() =>
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 0 / 4'),
    );
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      'Q:q-2',
      { checked: false, evalId: 'eval-1' },
      'park-lee',
    );
    expect(screen.queryByTestId('review-checked-by')).not.toBeInTheDocument();
  });

  it('저장이 실패하면 쉬운 말 오류를 보이고 체크 모양은 그대로 둔다', async () => {
    mockedCheck.mockRejectedValueOnce(
      new ApiError(403, {
        message: '기록 권한이 없습니다.',
        nextAction: '담당자를 고르세요',
        ref: 'r-1',
      }),
    );
    renderArea();
    fireEvent.click(within(screen.getAllByTestId('review-item')[0]).getByRole('checkbox'));
    const alert = await screen.findByTestId('review-error');
    expect(alert).toHaveTextContent(reviewArea.saveFailed);
    expect(alert).toHaveTextContent('기록 권한이 없습니다.');
    expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 1 / 4');
    expect(within(screen.getAllByTestId('review-item')[0]).getByRole('checkbox')).not.toBeChecked();
  });

  it('담당자를 고르지 않았거나 평가 ID가 없으면 체크 상자가 잠기고 안내가 보인다', () => {
    renderArea({ staffKey: null, canRecord: false });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByTestId('review-pick-staff-text')).toHaveTextContent(
      reviewArea.pickStaffFirst,
    );
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('평가 ID가 없으면 담당자를 골라도 체크 상자가 잠긴다', () => {
    renderArea({ evalId: null });
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
  });

  describe('답 적기', () => {
    const answered: ReviewItem[] = [
      {
        ...items[0],
        replyText: '2024년에 KS 인증 받았다고 함',
        repliedAt: '2026-11-06',
        repliedBy: 'park-lee',
      },
      items[1],
      items[2],
    ];

    function replyEnvelope(data: ReplyResponse) {
      return { data, meta: {} };
    }

    it('질문 줄에만 단추가 있고, 답이 있으면 [답 고치기], 없으면 [답 적기]이며 자료 줄에는 없다', () => {
      renderArea({ items: answered });
      const rows = screen.getAllByTestId('review-item');
      expect(within(rows[0]).getByTestId('review-reply-button')).toHaveTextContent(
        reviewArea.replyEdit,
      );
      expect(within(rows[1]).getByTestId('review-reply-button')).toHaveTextContent(
        reviewArea.replyAdd,
      );
      expect(within(rows[2]).queryByTestId('review-reply-button')).not.toBeInTheDocument();
    });

    it('답이 있는 줄 아래에 "답: …"과 답한 사람·날짜가 보인다', () => {
      renderArea({ items: answered });
      const reply = within(screen.getAllByTestId('review-item')[0]).getByTestId('review-reply');
      expect(reply).toHaveTextContent('답: 2024년에 KS 인증 받았다고 함');
      expect(reply).toHaveTextContent('박 이사 · 11/6');
    });

    it('[답 적기]를 누르면 줄 아래에 입력칸이 열리고 저장하면 질문 번호·글·날짜가 간다', async () => {
      const onReplied = vi.fn();
      mockedReply.mockResolvedValueOnce(
        replyEnvelope({
          questionId: 'q-2',
          replyText: '직접 생산한다고 함',
          repliedAt: '2026-11-06',
          repliedBy: 'park-lee',
        }),
      );
      renderArea({ items: answered, onReplied });
      const row = screen.getAllByTestId('review-item')[1];
      fireEvent.click(within(row).getByTestId('review-reply-button'));
      fireEvent.change(within(row).getByTestId('review-reply-input'), {
        target: { value: '  직접 생산한다고 함  ' },
      });
      fireEvent.click(within(row).getByTestId('review-reply-save'));
      await waitFor(() =>
        expect(
          within(screen.getAllByTestId('review-item')[1]).getByTestId('review-reply'),
        ).toHaveTextContent('답: 직접 생산한다고 함'),
      );
      expect(mockedReply).toHaveBeenCalledWith(
        'q-2',
        {
          replyText: '직접 생산한다고 함',
          repliedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
        'park-lee',
      );
      expect(onReplied).toHaveBeenCalledTimes(1);
      // 입력칸은 닫히고 단추는 [답 고치기]로 바뀐다. 답을 저장해도 체크는 그대로다.
      expect(screen.queryByTestId('review-reply-editor')).not.toBeInTheDocument();
      expect(
        within(screen.getAllByTestId('review-item')[1]).getByTestId('review-reply-button'),
      ).toHaveTextContent(reviewArea.replyEdit);
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 1 / 3');
      expect(mockedCheck).not.toHaveBeenCalled();
    });

    it('[답 고치기]는 기존 답을 채워서 열고 저장하면 최신 답으로 바뀐다', async () => {
      mockedReply.mockResolvedValueOnce(
        replyEnvelope({
          questionId: 'q-1',
          replyText: '2025년에 갱신했다고 함',
          repliedAt: '2026-11-07',
          repliedBy: 'park-lee',
        }),
      );
      renderArea({ items: answered });
      const row = screen.getAllByTestId('review-item')[0];
      fireEvent.click(within(row).getByTestId('review-reply-button'));
      expect(within(row).getByTestId('review-reply-input')).toHaveValue(
        '2024년에 KS 인증 받았다고 함',
      );
      fireEvent.change(within(row).getByTestId('review-reply-input'), {
        target: { value: '2025년에 갱신했다고 함' },
      });
      fireEvent.click(within(row).getByTestId('review-reply-save'));
      await waitFor(() =>
        expect(
          within(screen.getAllByTestId('review-item')[0]).getByTestId('review-reply'),
        ).toHaveTextContent('답: 2025년에 갱신했다고 함'),
      );
      expect(
        within(screen.getAllByTestId('review-item')[0]).getByTestId('review-reply'),
      ).not.toHaveTextContent('2024년');
    });

    it('글이 비어 있으면 [답 저장]이 잠기고, 500자 상한과 글자 수가 보인다', () => {
      renderArea({ items: answered });
      const row = screen.getAllByTestId('review-item')[1];
      fireEvent.click(within(row).getByTestId('review-reply-button'));
      expect(within(row).getByTestId('review-reply-save')).toBeDisabled();
      expect(within(row).getByTestId('review-reply-input')).toHaveAttribute('maxlength', '500');
      fireEvent.change(within(row).getByTestId('review-reply-input'), { target: { value: '네' } });
      expect(within(row).getByTestId('review-reply-counter')).toHaveTextContent('1 / 500자');
      expect(within(row).getByTestId('review-reply-save')).toBeEnabled();
    });

    it('저장이 실패하면 쉬운 말 오류를 보이고 입력한 글과 입력칸을 그대로 둔다', async () => {
      mockedReply.mockRejectedValueOnce(
        new ApiError(403, { message: '기록 권한이 없습니다.', nextAction: '', ref: 'r-1' }),
      );
      const onReplied = vi.fn();
      renderArea({ items: answered, onReplied });
      const row = screen.getAllByTestId('review-item')[1];
      fireEvent.click(within(row).getByTestId('review-reply-button'));
      fireEvent.change(within(row).getByTestId('review-reply-input'), { target: { value: '답' } });
      fireEvent.click(within(row).getByTestId('review-reply-save'));
      const alert = await screen.findByTestId('review-reply-error');
      expect(alert).toHaveTextContent(reviewArea.replySaveFailed);
      expect(alert).toHaveTextContent('기록 권한이 없습니다.');
      expect(screen.getByTestId('review-reply-input')).toHaveValue('답');
      expect(screen.queryByTestId('review-reply')).toBeInTheDocument(); // 첫 줄의 기존 답은 그대로
      expect(onReplied).not.toHaveBeenCalled();
    });

    it('[취소]를 누르면 저장 없이 입력칸이 닫힌다', () => {
      renderArea({ items: answered });
      const row = screen.getAllByTestId('review-item')[1];
      fireEvent.click(within(row).getByTestId('review-reply-button'));
      fireEvent.click(within(row).getByTestId('review-reply-cancel'));
      expect(screen.queryByTestId('review-reply-editor')).not.toBeInTheDocument();
      expect(mockedReply).not.toHaveBeenCalled();
    });

    it('담당자를 고르지 않았거나 평가 ID가 없으면 [답 적기]가 잠긴다', () => {
      renderArea({ items: answered, staffKey: null, canRecord: false });
      for (const button of screen.getAllByTestId('review-reply-button')) {
        expect(button).toBeDisabled();
      }
      expect(mockedReply).not.toHaveBeenCalled();
    });
  });
});
