// 검토사항의 "표면처리를 직접 하는 회사일 수 있음" 줄(#319, #316 할 일 7번): 서버가 준 줄을 그대로 보이고 체크할 수 있다.
// 서버 호출(postReviewCheck)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewArea from '../ReviewArea';
import { postReviewCheck } from '../../../api/client';
import type { ConfigUi, ReviewItem } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import { reviewItemKindTagLabels } from '../../../labels/ko';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postReviewCheck: vi.fn(),
  postQuestionReply: vi.fn(),
}));

const mockedCheck = vi.mocked(postReviewCheck);

const OWN: ReviewItem = {
  itemId: 'FLAG:OWN_PLATING_LINE_SUSPECTED',
  kind: 'OWN_PLATING_LINE_SUSPECTED',
  source: 'AI',
  text: '표면처리를 직접 하는 회사일 수 있음: 생산품 "알루미늄 아노다이징"',
  targetLabel: null,
  checked: false,
};
const QUESTION: ReviewItem = {
  itemId: 'Q:q-1',
  kind: 'QUESTION',
  source: 'AI',
  text: '납품 거래처를 알려 줄 수 있는지',
  targetLabel: '상대 회사',
  checked: false,
};
const GAP: ReviewItem = {
  itemId: 'GAP:HOMEPAGE',
  kind: 'DATA_NOT_FOUND',
  source: 'RULE',
  text: '홈페이지를 찾지 못함',
  targetLabel: null,
  checked: false,
};

const config = { staff: [{ key: 'park-lee', displayName: '박 이사' }] } as unknown as ConfigUi;

function renderArea(items: ReviewItem[]) {
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey: 'park-lee',
        setStaffKey: () => {},
        canRecord: true,
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <ReviewArea oppId="opp-1" evalId="eval-1" items={items} />
    </FrameContext.Provider>,
  );
}

describe('ReviewArea · 표면처리를 직접 하는 회사일 수 있음 줄 (#319)', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
  });

  it('서버가 준 순서·개수 그대로 보이고 새 줄에 "표면처리 직접 · 확인 필요" 꼬리표가 붙는다', () => {
    renderArea([QUESTION, OWN, GAP]);
    expect(screen.getAllByTestId('review-item')).toHaveLength(3);
    expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 0 / 3');
    const tags = screen.getAllByTestId('review-tag').map((tag) => tag.textContent);
    expect(tags).toEqual(['AI 질문·상대 회사', '표면처리 직접 · 확인 필요', '자료 못 찾음']);
    expect(reviewItemKindTagLabels.OWN_PLATING_LINE_SUSPECTED).toBe('표면처리 직접 · 확인 필요');
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[1]).getByTestId('review-text')).toHaveTextContent(
      '표면처리를 직접 하는 회사일 수 있음: 생산품 "알루미늄 아노다이징"',
    );
  });

  it('새 줄에는 [답 적기]가 없다(질문 줄에만 있음)', () => {
    renderArea([QUESTION, OWN]);
    const rows = screen.getAllByTestId('review-item');
    expect(within(rows[0]).getByTestId('review-reply-button')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('review-reply-button')).not.toBeInTheDocument();
  });

  it('담당자가 체크하면 평가 ID와 함께 그 줄의 번호로 저장을 부르고 확인 수가 바뀐다', async () => {
    mockedCheck.mockResolvedValueOnce({
      data: {
        itemId: OWN.itemId,
        checked: true,
        checkedBy: 'park-lee',
        checkedAt: '2026-11-06T17:30:00+09:00',
      },
      meta: { updatedAt: '2026-11-06T17:30:00+09:00' },
    });
    renderArea([QUESTION, OWN]);
    const rows = screen.getAllByTestId('review-item');
    fireEvent.click(within(rows[1]).getByRole('checkbox'));
    await waitFor(() =>
      expect(screen.getByTestId('review-progress')).toHaveTextContent('확인 1 / 2'),
    );
    expect(mockedCheck).toHaveBeenCalledWith(
      'opp-1',
      OWN.itemId,
      { checked: true, evalId: 'eval-1' },
      'park-lee',
    );
    // 화면이 줄을 빼거나 순서를 바꾸지 않는다.
    expect(screen.getAllByTestId('review-item')).toHaveLength(2);
  });

  it('새 줄이 없으면(표시 없는 회사) 지금과 같은 꼬리표만 보인다', () => {
    renderArea([QUESTION, GAP]);
    const tags = screen.getAllByTestId('review-tag').map((tag) => tag.textContent);
    expect(tags).toEqual(['AI 질문·상대 회사', '자료 못 찾음']);
  });
});
