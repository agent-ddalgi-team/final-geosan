// 추천 목록(S1): 빈 상태 / 불러오는 중 / 오류+다시 시도 / 카드 내용 / "참고 N" / 쪽 넘김.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage, { PAGE_SIZE } from '../OpportunityListPage';
import { ApiError, getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { cardRows, pagination, states } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...meta } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <OpportunityListPage />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('OpportunityListPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('추천이 하나도 없으면 왜 비었는지 문구를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([]));
    renderPage();
    expect(await screen.findByText(states.listEmpty)).toBeInTheDocument();
    expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-pagination')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-total')).not.toBeInTheDocument();
  });

  it('불러오는 동안 자리표시(Skeleton)를 보이고 끝나면 카드로 바뀐다', async () => {
    let resolve: (value: Envelope<OpportunityCard[]>) => void = () => {};
    mockedGet.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderPage();
    expect(screen.getByTestId('five-states-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument();
    resolve(reply([apjeong]));
    expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
    expect(screen.queryByTestId('five-states-loading')).not.toBeInTheDocument();
  });

  it('불러오지 못하면 쉬운 말 오류와 [다시 시도]를 보이고, 누르면 다시 불러온다', async () => {
    mockedGet.mockRejectedValueOnce(
      new ApiError(500, {
        message: '목록을 가져오는 중 문제가 생겼습니다.',
        nextAction: '잠시 뒤 다시 시도해 주세요.',
        ref: 'r-1',
        kind: 'INTERNAL_ERROR',
      }),
    );
    mockedGet.mockResolvedValueOnce(reply([apjeong]));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(states.listError);
    expect(alert).toHaveTextContent('목록을 가져오는 중 문제가 생겼습니다.');
    expect(alert).not.toHaveTextContent('INTERNAL_ERROR');

    await userEvent.click(screen.getByRole('button', { name: states.retry }));
    expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('A정밀 카드에 순위·분류(쉬운 말)·점수·추천 이유·막는 조건 글자·다음 할 일·자세히 보기가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong]));
    renderPage();
    const card = await screen.findByTestId('opportunity-card');
    const view = within(card);
    expect(view.getByTestId('card-rank')).toHaveTextContent('1');
    expect(view.getByRole('heading', { level: 2 })).toHaveTextContent(
      'A정밀 · 밸브 바디 아노다이징',
    );
    expect(view.getByTestId('card-classification')).toHaveTextContent('지금 바로 연락 검토');
    expect(view.getByLabelText('분류: 지금 바로 연락 검토')).toBeInTheDocument();
    // 서버 문자열 그대로: "점수 "를 앞에 붙이지 않아 "점수"가 두 번 보이지 않는다(#183).
    expect(view.getByTestId('card-score')).toHaveTextContent(/^77점 · 7\/8$/);
    expect(view.getByTestId('card-score')).toHaveAttribute(
      'aria-label',
      '점수 77점, 8개 항목 중 7개 조사',
    );
    expect(view.getByTestId('card-reason')).toHaveTextContent('아노다이징 외주 협력사 모집 공고');
    expect(view.getByTestId('card-blocker')).toHaveTextContent(
      /^없음 — 지금 단계 꼭 필요한 요구\(ISO 9001\) 통과$/,
    );
    expect(view.getByTestId('card-next-action')).toHaveTextContent('응모 전 피막 두께 요구 확인');
    expect(view.getByTestId('card-virtual-tag')).toHaveTextContent(cardRows.virtualTag);
    expect(view.getByTestId('card-view-detail-link')).toHaveAttribute(
      'href',
      `/opportunities/${apjeong.oppId}`,
    );
    // 전문 용어는 카드에 쓰지 않는다(BR10.9).
    expect(card).not.toHaveTextContent(/E 77|P 95|R 82/);
    expect(view.getByTestId('opinion-area')).toBeInTheDocument();
  });

  it('목록 맨 위에 전체 곳 수를 보이고, 비어 있으면 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong], { total: 18 }));
    renderPage();
    expect(await screen.findByTestId('list-total')).toHaveTextContent(pagination.totalLine(18));
  });

  it('거산 확인 전 묶음은 "참고 N"을 보이고 막는 조건에 승인 꼬리표를 덧붙이지 않으며, 점수가 없으면 "--"를 보인다', async () => {
    const brochure: OpportunityCard = {
      ...apjeong,
      oppId: 'opp-2',
      rank: 2,
      classificationCode: 'FILTER_PENDING',
      scoreDisplay: '참고 50점 · 3/8',
      datasetKind: 'BROCHURE',
      blocker: { text: '거래 관계 확인 전', blocksApproval: true },
    };
    const noScore: OpportunityCard = { ...brochure, oppId: 'opp-3', rank: 3, scoreDisplay: '--' };
    mockedGet.mockResolvedValueOnce(reply([brochure, noScore]));
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(within(cards[0]).getByTestId('card-score')).toHaveTextContent(/^참고 50점 · 3\/8$/);
    expect(within(cards[0]).getByTestId('card-score')).toHaveAttribute(
      'aria-label',
      '참고 점수 50점, 8개 항목 중 3개 조사',
    );
    expect(within(cards[0]).getByTestId('card-brochure-tag')).toHaveTextContent(
      cardRows.brochureTag,
    );
    expect(within(cards[0]).getByTestId('card-blocker')).toHaveTextContent(/^거래 관계 확인 전$/);
    expect(within(cards[0]).getByTestId('card-classification')).toHaveTextContent(
      '기다리는 중 (확인 필요)',
    );
    expect(within(cards[1]).getByTestId('card-score')).toHaveTextContent(/^점수 --$/);
    expect(within(cards[1]).getByTestId('card-score')).toHaveAttribute(
      'aria-label',
      '점수 산정 전',
    );
  });

  it.each([true, false])(
    '막는 조건은 승인 판정(blocksApproval=%s)과 관계없이 서버 문구 그대로 보인다',
    async (blocksApproval) => {
      const text = '거래 여부와 거산의 아연도금(전기아연도금) 공정이 아직 확인 전';
      mockedGet.mockResolvedValueOnce(reply([{ ...apjeong, blocker: { text, blocksApproval } }]));
      renderPage();
      const blocker = await screen.findByTestId('card-blocker');
      expect(blocker).toHaveTextContent(new RegExp(`^${text.replace(/[()]/g, '\\$&')}$`));
      expect(blocker).not.toHaveTextContent('(승인');
    },
  );

  it('20건을 넘으면 "1~20 / N건"과 쪽 번호가 보이고 다음 쪽을 누르면 그 쪽을 불러온다', async () => {
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      ...apjeong,
      oppId: `opp-${i + 1}`,
      rank: i + 1,
    }));
    const page2 = Array.from({ length: 20 }, (_, i) => ({
      ...apjeong,
      oppId: `opp-${i + 21}`,
      rank: i + 21,
    }));
    mockedGet.mockResolvedValueOnce(reply(page1, { total: 45 }));
    mockedGet.mockResolvedValueOnce(reply(page2, { total: 45 }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('list-range-text')).toHaveTextContent(pagination.total(1, 20, 45)),
    );
    expect(screen.getAllByTestId('opportunity-card')).toHaveLength(20);

    await userEvent.click(screen.getByTitle('2'));
    await waitFor(() =>
      expect(screen.getByTestId('list-range-text')).toHaveTextContent(pagination.total(21, 40, 45)),
    );
    expect(mockedGet).toHaveBeenLastCalledWith(2, PAGE_SIZE, expect.any(AbortSignal));
    expect(screen.getAllByTestId('card-rank')[0]).toHaveTextContent('21');
  });
});
