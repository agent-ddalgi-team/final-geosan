// 추천 목록의 세 묶음(#610): 묶음 제목·건수, 카드의 묶음 이유 꼬리표, 영업 결과 조정 이유 한 줄.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 가상 이름만 쓴다.
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type {
  BucketBasis,
  ContactBucket,
  Envelope,
  OpportunityCard,
  RankAdjust,
} from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '아연도금', count: 4 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 4 },
];
const COUNTS = { NOW: 9, CHECK: 122, LATER: 49 };
const UP: RankAdjust = {
  level: 1,
  processCode: 'ZINC_PLATING',
  processName: '아연도금',
  industry: '자동차 부품',
  wonCount: 2,
  lostCount: 0,
  countedLostReasons: [],
  windowDays: 365,
};
const DOWN: RankAdjust = {
  ...UP,
  level: -1,
  wonCount: 0,
  lostCount: 3,
  countedLostReasons: ['NO_DEMAND'],
};

function card(
  id: string,
  rank: number,
  bucket: ContactBucket,
  bucketBasis: BucketBasis,
  rankAdjust: RankAdjust | null = null,
): OpportunityCard {
  return {
    ...apjeong,
    oppId: `opp-${id}`,
    evalId: `eval-${id}`,
    title: `가상 ${id} · 브래킷`,
    rank,
    bucket,
    bucketBasis,
    rankAdjust,
  };
}

/** 서버가 묶음 순서대로 준 한 줄: 지금 연락 2곳 → 확인 필요 1곳 → 나중 1곳. */
function bucketedCards(prefix = '') {
  return [
    card(`${prefix}a`, 1, 'NOW', 'REQUIRED_PASSED', UP),
    card(`${prefix}b`, 2, 'NOW', 'IN_PROGRESS'),
    card(`${prefix}c`, 1, 'CHECK', 'NOT_EVALUATED_HIGH_FIT'),
    card(`${prefix}d`, 1, 'LATER', 'MONITOR', DOWN),
  ];
}

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return {
    data: items,
    meta: { total: items.length, processCounts: TABS, bucketCounts: COUNTS, ...meta },
  };
}

function renderPage(initial: string) {
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
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const titles = (scope: HTMLElement = document.body) =>
  within(scope)
    .queryAllByTestId('bucket-title')
    .map((title) => title.textContent);

describe('추천 목록 · 세 묶음 (#610)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  it('추천 순이면 세 묶음 순으로 달라고 하고, 묶음이 바뀌는 자리에 제목과 서버가 준 건수를 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ sort: 'contact', process: 'ZINC_PLATING' });
    expect(titles()).toEqual(['지금 연락할 곳 9곳', '확인 필요 122곳', '나중 49곳']);
    // 제목은 그 묶음의 첫 카드 바로 앞에 있다(제목 3개 + 카드 4장, 서버 순서 그대로).
    const list = screen.getByTestId('opportunity-list');
    expect(
      Array.from(list.children).map(
        (item) =>
          item.getAttribute('data-bucket') ??
          within(item as HTMLElement).getByTestId('card-title').textContent,
      ),
    ).toEqual([
      'NOW',
      '가상 a · 브래킷',
      '가상 b · 브래킷',
      'CHECK',
      '가상 c · 브래킷',
      'LATER',
      '가상 d · 브래킷',
    ]);
    // 공정 하나를 고른 목록의 번호는 서버가 준 묶음 안 순서 번호다.
    expect(screen.getAllByTestId('card-rank').map((rank) => rank.textContent)).toEqual([
      '1',
      '2',
      '1',
      '1',
    ]);
  });

  it('카드에 묶음 이유 꼬리표를 보이고, 조정이 있는 카드에만 이유 한 줄을 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(cards.map((item) => within(item).getByTestId('card-bucket-basis').textContent)).toEqual([
      '필수조건 통과',
      '접촉 진행 중',
      '평가 전 · 적합도 상',
      '지켜보기',
    ]);
    expect(within(cards[0]).getByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 성사 2곳 → 위로',
    );
    expect(within(cards[3]).getByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 거절 3곳(수요 없음) → 아래로',
    );
    expect(within(cards[1]).queryByTestId('card-rank-adjust')).not.toBeInTheDocument();
    expect(within(cards[2]).queryByTestId('card-rank-adjust')).not.toBeInTheDocument();
  });

  it('성사와 거절이 서로 지워 조정 단계가 0이면 이유 줄을 보이지 않는다', async () => {
    const even = { ...UP, level: 0, wonCount: 2, lostCount: 3, countedLostReasons: ['NO_DEMAND'] };
    mockedGet.mockResolvedValue(
      reply([card('a', 1, 'NOW', 'REQUIRED_PASSED', even as RankAdjust)]),
    );
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('card-rank-adjust')).not.toBeInTheDocument();
    expect(titles()).toEqual(['지금 연락할 곳 9곳']);
  });

  it('성사와 거절이 함께 있으면 한 줄에 같이 적는다', async () => {
    const both: RankAdjust = {
      ...UP,
      wonCount: 3,
      lostCount: 2,
      countedLostReasons: ['NO_DEMAND'],
    };
    mockedGet.mockResolvedValue(reply([card('a', 1, 'NOW', 'REQUIRED_PASSED', both)]));
    renderPage('/opportunities?process=ZINC_PLATING');
    expect(await screen.findByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 성사 3곳 · 거절 2곳(수요 없음) → 위로',
    );
  });

  it('전체 보기(view=all)에서는 묶음 제목은 보이고 순위 번호는 숨긴다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?view=all');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toEqual(['지금 연락할 곳 9곳', '확인 필요 122곳', '나중 49곳']);
    expect(screen.queryByTestId('card-rank')).not.toBeInTheDocument();
    expect(mockedGet.mock.calls.at(-1)?.[3]).toMatchObject({ sort: 'contact', process: null });
  });

  it('관심 기업 보기에서도 묶음 제목은 보이고 순위 번호는 숨긴다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?bookmarked=true');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toHaveLength(3);
    expect(screen.queryByTestId('card-rank')).not.toBeInTheDocument();
  });

  it('공정을 고르지 않은 공정별 묶음 보기에서는 공정마다 그 안에 세 묶음 제목과 그 공정의 건수를 보인다', async () => {
    mockedGet.mockImplementation((_page, _size, _signal, filters) => {
      const code = filters?.process;
      if (!code) return Promise.resolve(reply([apjeong], { total: 8 }));
      return Promise.resolve(
        reply(bucketedCards(code === 'ZINC_PLATING' ? 'z' : 'n'), {
          bucketCounts:
            code === 'ZINC_PLATING'
              ? { NOW: 2, CHECK: 1, LATER: 1 }
              : { NOW: 5, CHECK: 7, LATER: 3 },
        }),
      );
    });
    renderPage('/opportunities');
    await waitFor(() => expect(screen.getAllByTestId('process-group-title')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('opportunity-card')).toHaveLength(8));
    expect(titles(screen.getByTestId('process-group-ZINC_PLATING'))).toEqual([
      '지금 연락할 곳 2곳',
      '확인 필요 1곳',
      '나중 1곳',
    ]);
    expect(titles(screen.getByTestId('process-group-ANODIZING'))).toEqual([
      '지금 연락할 곳 5곳',
      '확인 필요 7곳',
      '나중 3곳',
    ]);
    // 묶음 요청마다 세 묶음 순으로 달라고 한다.
    for (const call of mockedGet.mock.calls) expect(call[3]).toMatchObject({ sort: 'contact' });
    expect(screen.getAllByTestId('card-rank')).toHaveLength(8);
  });

  it('"최근 들어온 순"에서는 묶음 순서가 아니라서 제목을 끼우지 않고, 꼬리표는 그대로 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards().reverse()));
    renderPage('/opportunities?process=ZINC_PLATING&sort=recent');
    await screen.findAllByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ sort: 'recent' });
    expect(titles()).toEqual([]);
    expect(screen.getAllByTestId('card-bucket-basis')).toHaveLength(4);
  });

  it('서버가 묶음 칸을 주지 않으면(옛 응답) 제목도 꼬리표도 없이 지금처럼 보인다', async () => {
    const old = { ...apjeong };
    delete old.bucket;
    delete old.bucketBasis;
    delete old.rankAdjust;
    mockedGet.mockResolvedValue({ data: [old], meta: { total: 1, processCounts: TABS } });
    renderPage('/opportunities?process=ANODIZING');
    await screen.findByTestId('opportunity-card');
    expect(titles()).toEqual([]);
    expect(screen.queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
  });

  it('서버가 묶음별 건수를 주지 않으면 이 줄에 있는 카드 수로 센다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bucketCounts: null }));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toEqual(['지금 연락할 곳 2곳', '확인 필요 1곳', '나중 1곳']);
  });
});
