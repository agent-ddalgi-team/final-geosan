// 추천 목록(S1): 빈 상태 / 불러오는 중 / 오류+다시 시도 / 카드 내용 / "참고 N" / 쪽 넘김.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage, { PAGE_SIZE } from '../OpportunityListPage';
import { ApiError, getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { cardRows, listFilters, pagination, scoreTags, states } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;
/** "근거 있음" 묶음의 카드로 바꾼다(#675). 점수는 이 묶음 카드에만 보인다. 가짜 응답의 A정밀은 거래 중이라 "끝난 회사" 묶음이다. */
const ready = (card: OpportunityCard): OpportunityCard => ({
  ...card,
  bucket: 'EVIDENCE_READY',
  bucketBasis: 'EVIDENCE_ENOUGH',
});

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...meta } };
}

/** 조건이 하나도 없을 때 getOpportunities의 네 번째 인자. */
const NO_FILTERS = {
  process: null,
  region: null,
  industry: null,
  stage: null,
  filter: null,
  q: null,
  // 추천 순은 근거 상태 묶음 순(#610·#675)으로 달라고 한다.
  sort: 'contact',
};

/** 평소 목록(공정 하나·공정별 묶음·전체 보기)이 보내는 조건: 관심으로 고른 회사는 빼 달라고 한다(#675). */
const HOME_FILTERS = { ...NO_FILTERS, hideBookmarked: 'true' };

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '전기아연도금', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 10 },
];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(initial = '/opportunities') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
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
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('OpportunityListPage', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
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
    mockedGet.mockResolvedValueOnce(reply([ready(apjeong)]));
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
    // 후속 조치는 카드에 없고 상세에서만 읽는다(#647).
    expect(view.queryByTestId('card-next-action')).not.toBeInTheDocument();
    expect(view.queryByText('응모 전 피막 두께 요구 확인')).not.toBeInTheDocument();
    expect(view.getByTestId('card-virtual-tag')).toHaveTextContent(cardRows.virtualTag);
    expect(view.getByTestId('card-view-detail-link')).toHaveAttribute(
      'href',
      `/opportunities/${apjeong.oppId}`,
    );
    // 전문 용어는 카드에 쓰지 않는다(BR10.9).
    expect(card).not.toHaveTextContent(/E 77|P 95|R 82/);
    expect(view.getByTestId('opinion-area')).toBeInTheDocument();
  });

  it('카드에 영업 단계 꼬리표가 보이고, 미접촉이거나 기록이 없으면 꼬리표가 없다', async () => {
    const withStage = (status: string | null): OpportunityCard =>
      ({
        ...apjeong,
        records: {
          ...apjeong.records,
          outcome: status
            ? { version: 1, updatedBy: 'park-lee', updatedAt: '2026-11-04T00:00:00Z', status }
            : null,
        },
      }) as unknown as OpportunityCard;
    mockedGet.mockResolvedValueOnce(
      reply([
        { ...withStage('ON_HOLD'), oppId: 'a' },
        { ...withStage('IN_PROGRESS'), oppId: 'b' },
        { ...withStage('NOT_EXECUTED'), oppId: 'c' },
        { ...withStage(null), oppId: 'd' },
      ]),
    );
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(within(cards[0]).getByTestId('card-stage-tag')).toHaveTextContent('보류');
    expect(within(cards[1]).getByTestId('card-stage-tag')).toHaveTextContent('접촉');
    expect(within(cards[2]).queryByTestId('card-stage-tag')).not.toBeInTheDocument();
    expect(within(cards[3]).queryByTestId('card-stage-tag')).not.toBeInTheDocument();
  });

  it('목록 맨 위에 전체 곳 수를 보이고, 비어 있으면 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong], { total: 18 }));
    renderPage();
    expect(await screen.findByTestId('list-total')).toHaveTextContent(pagination.totalLine(18));
  });

  it('거산 확인 전 묶음은 "참고 N"을 보이고 막는 조건에 승인 꼬리표를 덧붙이지 않으며, 점수가 없으면 "--"를 보인다', async () => {
    const brochure: OpportunityCard = {
      ...ready(apjeong),
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
    // 분류 꼬리표 "필수조건 확인 필요"는 무엇을 확인하라는 말인지 알 수 없어 카드에서 뺐다(#659).
    expect(within(cards[0]).queryByTestId('card-classification')).not.toBeInTheDocument();
    expect(cards[0]).not.toHaveTextContent('필수조건 확인 필요');
    expect(within(cards[1]).getByTestId('card-score')).toHaveTextContent(/^점수 --$/);
    expect(within(cards[1]).getByTestId('card-score')).toHaveAttribute(
      'aria-label',
      '점수 산정 전',
    );
  });

  it('카드: 거래 확인 전 점수는 흐리게 "거래 확인 전" 꼬리표가 붙고, 확정·점수 없음에는 붙지 않는다 (#264)', async () => {
    const pending: OpportunityCard = {
      ...ready(apjeong),
      oppId: 'opp-2',
      rank: 2,
      scoreState: 'PENDING',
      // 서버는 거래 확인 전 점수를 분류가 필수조건 확인 대기일 때만 준다. 그 밖의 PENDING은 AI 제안이다(#498).
      classificationCode: 'FILTER_PENDING',
      relationStatus: 'UNCONFIRMED',
      scoreDisplay: '50점 · 3/8',
    };
    const none: OpportunityCard = {
      ...pending,
      oppId: 'opp-3',
      rank: 3,
      scoreState: 'NONE',
      scoreDisplay: '--',
    };
    const confirmed: OpportunityCard = { ...ready(apjeong), relationStatus: 'NEW_CONFIRMED' };
    mockedGet.mockResolvedValueOnce(
      reply([confirmed, pending, none, { ...apjeong, oppId: 'opp-existing' }]),
    );
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    // 확정: 진한 점수, 꼬리표 없음.
    expect(within(cards[0]).getByTestId('card-score')).toHaveAttribute(
      'data-score-state',
      'CONFIRMED',
    );
    expect(within(cards[0]).queryByTestId('card-score-pending-tag')).not.toBeInTheDocument();
    expect(within(cards[0]).queryByTestId('card-score-existing-tag')).not.toBeInTheDocument();
    // 거래 중인 회사는 "끝난 회사" 묶음이라(#675) 점수 줄과 "기존 거래처" 대신 끝난 이유 "거래 중"이 보인다.
    expect(within(cards[3]).queryByTestId('card-score')).not.toBeInTheDocument();
    expect(within(cards[3]).queryByTestId('card-score-existing-tag')).not.toBeInTheDocument();
    expect(within(cards[3]).getByTestId('card-bucket-basis')).toHaveTextContent('거래 중');
    // 거래 확인 전: 점수 글자는 서버 그대로, 흐림 표시와 꼬리표.
    expect(within(cards[1]).getByTestId('card-score')).toHaveTextContent(/^50점 · 3\/8$/);
    expect(within(cards[1]).getByTestId('card-score')).toHaveAttribute(
      'data-score-state',
      'PENDING',
    );
    expect(within(cards[1]).getByTestId('card-score-pending-tag')).toHaveTextContent(
      scoreTags.pending,
    );
    expect(within(cards[1]).queryByTestId('card-score-existing-tag')).not.toBeInTheDocument();
    // 점수 없음: "점수 --" 그대로, 꼬리표 없음.
    expect(within(cards[2]).getByTestId('card-score')).toHaveTextContent(/^점수 --$/);
    expect(within(cards[2]).queryByTestId('card-score-pending-tag')).not.toBeInTheDocument();
    expect(within(cards[2]).queryByTestId('card-score-existing-tag')).not.toBeInTheDocument();
  });

  it('카드: AI 제안으로 계산된 점수(확정 전인데 분류가 확인 대기가 아님)는 흐리게 "AI 제안 · 확인 전"이 붙는다 (#498)', async () => {
    const proposed: OpportunityCard = {
      ...ready(apjeong),
      oppId: 'opp-ai',
      rank: 2,
      scoreState: 'PENDING',
      classificationCode: 'CONTACT_REVIEW',
      relationStatus: 'UNCONFIRMED',
      scoreDisplay: '참고 50점 · 3/8',
    };
    mockedGet.mockResolvedValueOnce(reply([ready(apjeong), proposed]));
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(within(cards[1]).getByTestId('card-score')).toHaveAttribute(
      'data-score-state',
      'PENDING',
    );
    expect(within(cards[1]).getByTestId('card-score-ai-proposal-tag')).toHaveTextContent(
      'AI 제안 · 확인 전',
    );
    expect(within(cards[1]).queryByTestId('card-score-pending-tag')).not.toBeInTheDocument();
    // 확정된 카드에는 어느 꼬리표도 없다.
    expect(within(cards[0]).queryByTestId('card-score-ai-proposal-tag')).not.toBeInTheDocument();
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
    // 조건이 하나도 없으면 모두 null로 서버에 간다(client가 빈 값은 주소에 싣지 않는다).
    expect(mockedGet).toHaveBeenLastCalledWith(2, PAGE_SIZE, expect.any(AbortSignal), HOME_FILTERS);
    expect(screen.getAllByTestId('card-rank')[0]).toHaveTextContent('21');
  });

  // 공정은 탭에서 선택란으로 바뀌었다(#361, 2026-11-06 PM 결정). 검사의 뜻은 그대로 두고 선택란 기준으로 본다.
  describe('카드 검토사항 줄이 무엇을 확인할지 말한다 (#659)', () => {
    const pending: OpportunityCard = {
      ...apjeong,
      classificationCode: 'FILTER_PENDING',
      bucket: 'EVIDENCE_SOME',
      bucketBasis: 'EVIDENCE_FEW',
      coreEvidenceRecheck: false,
      blocker: { text: '필수조건 확인 필요', blocksApproval: true },
      checkPoints: ['아노다이징 적용 부품의 소재'],
      checkKinds: ['MATERIAL'],
      coreEvidenceGaps: [],
    };

    // PM 지시 2026-11-13: 카드는 긴 문장 대신 낱말("공정"·"소재"·"근거 부족")로만 적는다.
    it('소재만 모르는 회사는 꼬리표 대신 검토사항 줄에 "소재" 한 낱말을 적는다', async () => {
      mockedGet.mockResolvedValue(reply([pending]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-classification')).not.toBeInTheDocument();
      expect(within(card).queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
      expect(card).not.toHaveTextContent('필수조건 확인 필요');
      expect(card).not.toHaveTextContent('필수조건 확인 전');
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 소재$/);
    });

    it('공정·소재는 낱말로 줄이고 필수 요구는 이름 그대로 앞 3개만 적고 "외 n개"로 줄인다', async () => {
      const many: OpportunityCard = {
        ...pending,
        checkPoints: [
          '거산 아노다이징 공정(거산 확인 전)',
          '거산 아노다이징의 처리 소재',
          '공정 2개 적용 부품의 소재',
          '방산 납품 자격',
          'RoHS',
          'ISO 9001',
          'Nadcap(필요 시점 미확인)',
        ],
        checkKinds: [
          'PROCESS',
          'MATERIAL',
          'MATERIAL',
          'REQUIREMENT',
          'REQUIREMENT',
          'REQUIREMENT',
          'REQUIREMENT',
        ],
      };
      mockedGet.mockResolvedValue(reply([many]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(
        /^확인할 것: 공정 · 소재 · 방산 납품 자격 · RoHS · ISO 9001 외 1개$/,
      );
    });

    it('종류 칸이 없는 옛 응답이면 글자로 추측하지 않고 서버 글자를 이름 그대로 적는다', async () => {
      const old: OpportunityCard = { ...pending };
      delete old.checkKinds;
      mockedGet.mockResolvedValue(reply([old]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(
        /^확인할 것: 아노다이징 적용 부품의 소재$/,
      );
    });

    it('평가 전 회사는 "평가 전" 꼬리표 없이 검토사항 줄에 낱말만 적는다', async () => {
      const notEvaluated: OpportunityCard = {
        ...apjeong,
        classificationCode: 'NOT_EVALUATED',
        bucket: 'NOT_RESEARCHED',
        bucketBasis: 'RESEARCH_NOT_RUN',
        coreEvidenceRecheck: true,
        blocker: { text: '점수 입력 전 · 필수조건 확인 전', blocksApproval: true },
        processCodes: ['ANODIZING', 'ZINC_PLATING'],
        confirmedProcessCodes: [],
        proposedProcessCount: 2,
        checkPoints: ['공정 2개 적용 부품의 소재'],
        checkKinds: ['MATERIAL'],
        coreEvidenceGaps: [],
      };
      const bare: OpportunityCard = {
        ...notEvaluated,
        oppId: 'opp-bare',
        processCodes: ['ANODIZING'],
        confirmedProcessCodes: ['ANODIZING'],
        proposedProcessCount: 0,
        checkPoints: [],
        checkKinds: [],
      };
      mockedGet.mockResolvedValue(reply([notEvaluated, bare], { processCounts: [], total: 2 }));
      renderPage();
      const cards = await screen.findAllByTestId('opportunity-card');
      for (const card of cards) {
        expect(within(card).queryByTestId('card-classification')).not.toBeInTheDocument();
        expect(within(card).queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
        expect(card).not.toHaveTextContent('평가 전');
        expect(card).not.toHaveTextContent('점수 입력 전');
      }
      expect(within(cards[0]).getByTestId('card-blocker')).toHaveTextContent(
        /^확인할 것: 공정 · 소재 · 근거 부족$/,
      );
      // 공정이 확정돼 있고 확인 전 조건이 없으면 있는 것만 적는다.
      expect(within(cards[1]).getByTestId('card-blocker')).toHaveTextContent(
        /^확인할 것: 근거 부족$/,
      );
    });

    it('핵심 근거 재확인 회사는 꼬리표 두 개 대신 검토사항 줄에 "근거 부족" 한 낱말을 적는다', async () => {
      const recheck: OpportunityCard = {
        ...apjeong,
        classificationCode: 'WATCH',
        bucket: 'EVIDENCE_READY',
        bucketBasis: 'EVIDENCE_ENOUGH',
        coreEvidenceRecheck: true,
        blocker: { text: '없음 — 지금 단계 필수 요구 통과', blocksApproval: false },
        checkPoints: [],
        coreEvidenceGaps: ['표면처리가 필요한 제품·부품 생산 근거: 약한 추정뿐'],
      };
      mockedGet.mockResolvedValue(reply([recheck]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
      expect(card).not.toHaveTextContent('핵심 근거 재확인');
      // 다른 분류 꼬리표는 그대로 보인다.
      expect(within(card).getByTestId('card-classification')).toHaveTextContent('동향 모니터링');
      // "없음 — …" 뒤에 붙이면 말이 어긋나므로 낱말만 보인다. 약한 추정뿐·근거 없음은 구분하지 않는다.
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 근거 부족$/);
      expect(card).not.toHaveTextContent('약한 추정뿐');
      expect(card).not.toHaveTextContent('없음 — 지금 단계 필수 요구 통과');
    });

    it('둘 다 해당하고 AI 제안만 있는 회사는 공정 · 소재 · 근거 부족 순으로 한 줄에 적는다', async () => {
      const both: OpportunityCard = {
        ...pending,
        coreEvidenceRecheck: true,
        processCodes: ['ANODIZING', 'ZINC_PLATING'],
        confirmedProcessCodes: [],
        proposedProcessCount: 2,
        checkPoints: ['공정 2개 적용 부품의 소재'],
        checkKinds: ['MATERIAL'],
        coreEvidenceGaps: [
          '표면처리가 필요한 제품·부품 생산 근거: 약한 추정뿐',
          '소재와 보유 공정 일치 근거 없음',
          '대조한 거산 아노다이징 값이 거산 확인 전',
        ],
      };
      mockedGet.mockResolvedValue(reply([both], { processCounts: [], total: 1 }));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(card).not.toHaveTextContent('핵심 근거 재확인');
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(
        /^확인할 것: 공정 · 소재 · 근거 부족$/,
      );
      expect(card).not.toHaveTextContent('AI 제안 2개');
      expect(within(card).getByTitle('확인할 것: 공정 · 소재 · 근거 부족')).toBeInTheDocument();
    });

    it('서버가 구체적인 말을 주지 않으면(재료 없음·옛 응답) 서버 문장을 그대로 보인다', async () => {
      const plain: OpportunityCard = { ...pending };
      delete plain.checkPoints;
      delete plain.checkKinds;
      delete plain.coreEvidenceGaps;
      mockedGet.mockResolvedValue(reply([plain]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(/^필수조건 확인 필요$/);
    });

    // 묶음 이유 꼬리표("필수조건 통과")는 근거 상태 묶음(#675)에서 없어졌다. 그 자리에는 적합도 하나만 보인다.
    it('평소 회사는 분류 꼬리표와 검토사항 문장이 그대로이고 묶음 이유 꼬리표는 없다', async () => {
      const usual: OpportunityCard = {
        ...apjeong,
        bucket: 'EVIDENCE_READY',
        bucketBasis: 'EVIDENCE_ENOUGH',
        checkPoints: [],
        coreEvidenceGaps: [],
      };
      mockedGet.mockResolvedValue(reply([usual]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).getByTestId('card-classification')).toHaveTextContent(
        '지금 바로 연락 검토',
      );
      expect(within(card).queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(apjeong.blocker.text);
    });
  });

  describe('공정·지역·산업 선택란 (#210, #361)', () => {
    // 처음 열 때의 규칙이 바뀌었다(#368 → #383, 2026-11-07 PM 결정): 프로그램이 첫 공정을 대신 고르지 않고,
    // 공정을 고르기 전에는 공정별 묶음으로 보인다. 자세한 검사는 OpportunityListPage.header.test.tsx에 있다.
    it('조건 없이 처음 열면 공정을 대신 고르지 않고 공정별 묶음으로 보이며, 고른 뒤에는 그 공정만 다시 불러온다', async () => {
      const user = userEvent.setup();
      mockedGet.mockImplementation((_page, _size, _signal, filters) =>
        Promise.resolve(
          reply([{ ...apjeong, oppId: `opp-${filters?.process ?? 'all'}` }], {
            processCounts: TABS,
            total: 9,
          }),
        ),
      );
      renderPage();
      // 첫 요청(조건 없음)은 선택지·곳 수를 받고, 회사가 있는 공정마다 그 공정으로 따로 부른다.
      await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(3));
      expect(mockedGet.mock.calls[0][3]).toEqual(HOME_FILTERS);
      expect(mockedGet.mock.calls[1][3]).toEqual({ ...HOME_FILTERS, process: 'ZINC_PLATING' });
      expect(mockedGet.mock.calls[2][3]).toEqual({ ...HOME_FILTERS, process: 'ANODIZING' });
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities$/);
      expect(await screen.findAllByTestId('process-group-title')).toHaveLength(2);
      expect(screen.getAllByTestId('opportunity-card')).toHaveLength(2);
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(select.value).toBe('');
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([listFilters.processGrouped, '전기아연도금 9', '아노다이징 10']);
      mockedGet.mockClear();
      await user.selectOptions(select, 'ZINC_PLATING');
      await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
      expect(mockedGet.mock.calls[0][3]).toEqual({ ...HOME_FILTERS, process: 'ZINC_PLATING' });
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/opportunities?process=ZINC_PLATING',
      );
      await screen.findByTestId('opportunity-card');
      expect(screen.queryByTestId('process-group-title')).not.toBeInTheDocument();
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe(
        'ZINC_PLATING',
      );
    });

    it('공정을 고르면 그 공정으로 다시 불러오고 지역·산업은 전체로 돌아간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(
        reply([apjeong], {
          processCounts: TABS,
          regionCounts: [{ region: '아산시', count: 3 }],
          industryCounts: [{ industry: '자동차 부품', count: 2 }],
        }),
      );
      renderPage('/opportunities?process=ZINC_PLATING&region=아산시&industry=자동차 부품');
      await screen.findByTestId('opportunity-card');
      await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
      await waitFor(() =>
        expect(mockedGet).toHaveBeenLastCalledWith(1, PAGE_SIZE, expect.any(AbortSignal), {
          ...HOME_FILTERS,
          process: 'ANODIZING',
        }),
      );
      expect(screen.getByTestId('location')).toHaveTextContent('/opportunities?process=ANODIZING');
      expect(screen.getByTestId('location')).not.toHaveTextContent('region');
      expect(screen.getByTestId('location')).not.toHaveTextContent('industry');
    });

    it('주소에 있는 조건을 서버에 그대로 보내고, 드롭다운에 고른 값이 보인다 (새로 고침해도 유지)', async () => {
      mockedGet.mockResolvedValue(
        reply([apjeong], {
          processCounts: TABS,
          regionCounts: [
            { region: '천안 인근', count: 8 },
            { region: '아산시', count: 3 },
          ],
          industryCounts: [{ industry: '자동차 부품', count: 2 }],
        }),
      );
      renderPage('/opportunities?process=ANODIZING&region=아산시&industry=자동차 부품');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0][3]).toEqual({
        ...HOME_FILTERS,
        process: 'ANODIZING',
        region: '아산시',
        industry: '자동차 부품',
      });
      expect((screen.getByTestId('list-region-select') as HTMLSelectElement).value).toBe('아산시');
      expect((screen.getByTestId('list-industry-select') as HTMLSelectElement).value).toBe(
        '자동차 부품',
      );
    });

    it('지역·산업을 고르면 주소에 남기고 다시 불러오며, 전체로 돌리면 조건이 빠진다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(
        reply([apjeong], {
          processCounts: TABS,
          regionCounts: [
            { region: '천안 인근', count: 8 },
            { region: '아산시', count: 3 },
          ],
          industryCounts: [{ industry: '자동차 부품', count: 2 }],
        }),
      );
      renderPage('/opportunities?process=ZINC_PLATING');
      await screen.findByTestId('opportunity-card');
      expect(
        within(screen.getByTestId('list-region-select'))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['전체', '천안 인근 8', '아산시 3']);
      await user.selectOptions(screen.getByTestId('list-region-select'), '아산시');
      await waitFor(() =>
        expect(mockedGet.mock.calls.at(-1)?.[3]).toEqual({
          ...HOME_FILTERS,
          process: 'ZINC_PLATING',
          region: '아산시',
        }),
      );
      await user.selectOptions(screen.getByTestId('list-industry-select'), '자동차 부품');
      await waitFor(() =>
        expect(mockedGet.mock.calls.at(-1)?.[3]).toEqual({
          ...HOME_FILTERS,
          process: 'ZINC_PLATING',
          region: '아산시',
          industry: '자동차 부품',
        }),
      );
      expect(screen.getByTestId('location')).toHaveTextContent(
        'process=ZINC_PLATING&region=%EC%95%84%EC%82%B0%EC%8B%9C',
      );
      await user.selectOptions(screen.getByTestId('list-region-select'), listFilters.all);
      await waitFor(() =>
        expect(mockedGet.mock.calls.at(-1)?.[3]).toEqual({
          ...HOME_FILTERS,
          process: 'ZINC_PLATING',
          industry: '자동차 부품',
        }),
      );
      expect(screen.getByTestId('location')).not.toHaveTextContent('region');
    });

    it.each([
      ['/opportunities?stage=IN_PROGRESS', { stage: 'IN_PROGRESS' }],
      ['/opportunities?filter=SCHEDULE_DUE', { filter: 'SCHEDULE_DUE' }],
      ['/opportunities?q=A정밀', { q: 'A정밀' }],
    ])(
      '대시보드에서 %s 로 넘어오면 조건을 서버에 보내고 공정 선택란 없이 전체를 보인다',
      async (url, expected) => {
        mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
        renderPage(url);
        await screen.findByTestId('opportunity-card');
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, ...expected });
        expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent(url);
      },
    );

    it('걸러서 0건이면 조건을 바꿔 보라는 문구를 보이고, 공정·지역 선택란은 그대로 남는다', async () => {
      mockedGet.mockResolvedValue(
        reply([], {
          processCounts: TABS,
          regionCounts: [{ region: '아산시', count: 3 }],
          industryCounts: [],
          total: 0,
        }),
      );
      renderPage('/opportunities?process=ANODIZING&region=아산시');
      expect(await screen.findByText(listFilters.filteredEmpty)).toBeInTheDocument();
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe(
        'ANODIZING',
      );
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
    });

    it('대시보드 조건(단계)으로 걸러서 0건이면 "이 조건에 맞는 후보가 없습니다."를 보인다', async () => {
      mockedGet.mockResolvedValue(reply([], { total: 0 }));
      renderPage('/opportunities?stage=WON');
      expect(await screen.findByText(listFilters.noMatch)).toBeInTheDocument();
    });

    it('카드에 확정된 공정 이름·산업 꼬리표가 붙고 지역 꼬리표는 없다. 산업이 비면 "산업 미확정"이 보인다(#659)', async () => {
      const filled: OpportunityCard = {
        ...apjeong,
        processCodes: ['ANODIZING'],
        confirmedProcessCodes: ['ANODIZING'],
        proposedProcessCount: 0,
        region: '아산시',
        industries: ['자동차 부품', '방위산업'],
      };
      const empty: OpportunityCard = {
        ...apjeong,
        oppId: 'opp-2',
        rank: 2,
        processCodes: ['ZINC_PLATING'],
        confirmedProcessCodes: ['ZINC_PLATING'],
        proposedProcessCount: 0,
        region: null,
        industries: [],
      };
      mockedGet.mockResolvedValue(reply([filled, empty], { processCounts: TABS, total: 2 }));
      renderPage('/opportunities?process=ANODIZING');
      const cards = await screen.findAllByTestId('opportunity-card');
      expect(within(cards[0]).getByTestId('card-process-tag')).toHaveTextContent('아노다이징');
      expect(
        within(cards[0])
          .getAllByTestId('card-industry-tag')
          .map((tag) => tag.textContent),
      ).toEqual(['자동차 부품', '방위산업']);
      expect(within(cards[1]).getByTestId('card-process-tag')).toHaveTextContent('전기아연도금');
      expect(within(cards[1]).getByTestId('card-industry-tag')).toHaveTextContent(
        listFilters.industryUnknown,
      );
      // 지역은 목록 머리 선택란과 겹쳐 카드에서 뺐다. 값이 있든 없든 꼬리표가 없다.
      for (const card of cards) {
        expect(within(card).queryByTestId('card-region-tag')).not.toBeInTheDocument();
        expect(card).not.toHaveTextContent('아산시');
        expect(card).not.toHaveTextContent(listFilters.regionUnknown);
        expect(within(card).getByTestId('card-blocker')).not.toHaveTextContent('공정');
      }
    });

    it('AI 제안만 있는 회사는 공정 꼬리표가 없고 검토사항 줄에 "공정" 한 낱말이 보인다(#659)', async () => {
      const proposedOnly: OpportunityCard = {
        ...apjeong,
        processCodes: ['ANODIZING', 'ZINC_PLATING'],
        confirmedProcessCodes: [],
        proposedProcessCount: 2,
        blocker: { text: '없음 — 필수조건 통과', blocksApproval: false },
      };
      mockedGet.mockResolvedValue(reply([proposedOnly], { processCounts: TABS, total: 1 }));
      renderPage('/opportunities?process=ANODIZING');
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-process-tag')).not.toBeInTheDocument();
      // PM 지시 2026-11-13: "없음 — …" 뒤에 긴 문장을 붙이지 않고 낱말만 적는다(제안 개수는 카드에 쓰지 않는다).
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(/^확인할 것: 공정$/);
      expect(card).not.toHaveTextContent('AI 제안 2개');
      expect(within(card).getByTitle('확인할 것: 공정')).toBeInTheDocument();
    });

    it('확정과 AI 제안이 섞인 회사는 확정된 공정 꼬리표만 보이고 검토사항 줄에 덧붙이지 않는다(#659)', async () => {
      const mixed: OpportunityCard = {
        ...apjeong,
        processCodes: ['ANODIZING', 'ZINC_PLATING'],
        confirmedProcessCodes: ['ANODIZING'],
        proposedProcessCount: 1,
      };
      mockedGet.mockResolvedValue(reply([mixed], { processCounts: TABS, total: 1 }));
      renderPage('/opportunities?process=ANODIZING');
      const card = await screen.findByTestId('opportunity-card');
      expect(
        within(card)
          .getAllByTestId('card-process-tag')
          .map((tag) => tag.textContent),
      ).toEqual(['아노다이징']);
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(apjeong.blocker.text);
    });

    it('확정된 공정 칸이 없는 옛 응답이면 공정 코드가 있어도 꼬리표를 붙이지 않는다(#659)', async () => {
      const old: OpportunityCard = { ...apjeong, processCodes: ['ANODIZING'] };
      mockedGet.mockResolvedValue(reply([old], { processCounts: TABS, total: 1 }));
      renderPage('/opportunities?process=ANODIZING');
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-process-tag')).not.toBeInTheDocument();
      expect(within(card).getByTestId('card-blocker')).toHaveTextContent(apjeong.blocker.text);
    });

    it('서버가 지역·산업 칸을 주지 않는 옛 응답이면 꼬리표 자리에 아무것도 붙지 않는다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage();
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-region-tag')).not.toBeInTheDocument();
      expect(within(card).queryByTestId('card-industry-tag')).not.toBeInTheDocument();
      expect(within(card).queryByTestId('card-process-tag')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-filter-bar')).toBeInTheDocument();
    });

    it('조건이 바뀌면 1쪽부터 다시 본다', async () => {
      const user = userEvent.setup();
      const many = Array.from({ length: PAGE_SIZE }, (_, index) => ({
        ...apjeong,
        oppId: `opp-${index}`,
        rank: index + 1,
      }));
      mockedGet.mockResolvedValue(
        reply(many, {
          total: 45,
          processCounts: TABS,
          regionCounts: [{ region: '아산시', count: 3 }],
          industryCounts: [],
        }),
      );
      renderPage('/opportunities?process=ZINC_PLATING');
      await screen.findAllByTestId('opportunity-card');
      await user.click(screen.getByRole('listitem', { name: '2' }));
      await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[0]).toBe(2));
      await user.selectOptions(screen.getByTestId('list-region-select'), '아산시');
      await waitFor(() =>
        expect(mockedGet.mock.calls.at(-1)?.[3]).toMatchObject({ region: '아산시' }),
      );
      expect(mockedGet.mock.calls.at(-1)?.[0]).toBe(1);
    });
  });
});
