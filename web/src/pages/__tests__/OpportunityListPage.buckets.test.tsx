// 추천 목록의 근거 상태 묶음(#675, 세 묶음 #610을 바꿈): 묶음 제목·건수, 카드의 적합도 꼬리표·끝난 이유,
// 점수와 영업 결과 조정 이유 한 줄은 "근거 있음" 묶음 카드에만, 관심으로 고른 회사 빼기와 "함께 보기" 스위치.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 가상 이름만 쓴다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities, putBookmark } from '../../api/client';
import type {
  BucketBasis,
  ContactBucket,
  Envelope,
  FitLevel,
  OpportunityCard,
  RankAdjust,
} from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
  putBookmark: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const mockedPut = vi.mocked(putBookmark);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '아연도금', count: 4 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 4 },
];
const COUNTS = {
  EVIDENCE_READY: 30,
  EVIDENCE_SOME: 25,
  NO_HOMEPAGE: 81,
  NOT_RESEARCHED: 44,
  CLOSED: 12,
};
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
  extra: { fitLevel?: FitLevel | null; rankAdjust?: RankAdjust | null } = {},
): OpportunityCard {
  return {
    ...apjeong,
    oppId: `opp-${id}`,
    evalId: `eval-${id}`,
    title: `가상 ${id} · 브래킷`,
    rank,
    bucket,
    bucketBasis,
    rankAdjust: null,
    ...extra,
  };
}

/** 서버가 묶음 순서대로 준 한 줄: 근거 있음 2곳 → 근거 조금 1곳 → 홈페이지 없음 1곳 → 조사 전 1곳 → 끝난 회사 1곳. */
function bucketedCards(prefix = '') {
  return [
    card(`${prefix}a`, 1, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', {
      fitLevel: 'HIGH',
      rankAdjust: UP,
    }),
    card(`${prefix}b`, 2, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', { fitLevel: 'MEDIUM' }),
    card(`${prefix}c`, 1, 'EVIDENCE_SOME', 'EVIDENCE_FEW', { fitLevel: 'HIGH' }),
    card(`${prefix}d`, 1, 'NO_HOMEPAGE', 'HOMEPAGE_NOT_FOUND', { fitLevel: 'LOW' }),
    card(`${prefix}e`, 1, 'NOT_RESEARCHED', 'RESEARCH_NOT_RUN'),
    card(`${prefix}f`, 1, 'CLOSED', 'CLOSED_OR_HOLD', { fitLevel: 'HIGH' }),
  ];
}

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return {
    data: items,
    meta: { total: items.length, processCounts: TABS, bucketCounts: COUNTS, ...meta },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
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
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const titles = (scope: HTMLElement = document.body) =>
  within(scope)
    .queryAllByTestId('bucket-title')
    .map((title) => title.textContent);
const lastFilters = () => mockedGet.mock.calls.at(-1)?.[3];
const ALL_TITLES = [
  '근거 있음 30곳',
  '근거 조금 25곳',
  '홈페이지 없음 81곳',
  '조사 전 44곳',
  '끝난 회사 12곳',
];

describe('추천 목록 · 근거 상태 묶음 (#675)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedPut.mockReset();
  });

  it('추천 순이면 묶음 순으로 달라고 하고, 묶음이 바뀌는 자리에 제목과 서버가 준 건수를 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ sort: 'contact', process: 'ZINC_PLATING' });
    expect(titles()).toEqual(ALL_TITLES);
    // 제목은 그 묶음의 첫 카드 바로 앞에 있다(제목 5개 + 카드 6장, 서버 순서 그대로).
    const list = screen.getByTestId('opportunity-list');
    expect(
      Array.from(list.children).map(
        (item) =>
          item.getAttribute('data-bucket') ??
          within(item as HTMLElement).getByTestId('card-title').textContent,
      ),
    ).toEqual([
      'EVIDENCE_READY',
      '가상 a · 브래킷',
      '가상 b · 브래킷',
      'EVIDENCE_SOME',
      '가상 c · 브래킷',
      'NO_HOMEPAGE',
      '가상 d · 브래킷',
      'NOT_RESEARCHED',
      '가상 e · 브래킷',
      'CLOSED',
      '가상 f · 브래킷',
    ]);
    // 공정 하나를 고른 목록의 번호는 서버가 준 묶음 안 순서 번호다.
    expect(screen.getAllByTestId('card-rank').map((rank) => rank.textContent)).toEqual([
      '1',
      '2',
      '1',
      '1',
      '1',
      '1',
    ]);
  });

  it('카드에는 적합도 하나를 보이고, 끝난 회사만 끝난 이유를 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    // 적합도가 없는 회사(사례 파일)는 꼬리표가 없고, 끝난 회사는 적합도 대신 끝난 이유다.
    expect(
      cards.map((item) => within(item).queryByTestId('card-fit-level')?.textContent ?? null),
    ).toEqual(['적합도 상', '적합도 중', '적합도 상', '적합도 하', null, null]);
    expect(
      cards.map((item) => within(item).queryByTestId('card-bucket-basis')?.textContent ?? null),
    ).toEqual([null, null, null, null, null, '성사·거절·보류']);
  });

  it.each([
    ['EXCLUDED_OPINION', '제외'],
    ['REQUIRED_FAILED', '필수조건 탈락'],
    ['EXISTING_CUSTOMER', '거래 중'],
    ['CLOSED_OR_HOLD', '성사·거절·보류'],
  ] as const)('끝난 회사의 이유 %s 는 "%s" 꼬리표로 보인다', async (basis, text) => {
    mockedGet.mockResolvedValue(reply([card('a', 1, 'CLOSED', basis, { fitLevel: 'HIGH' })]));
    renderPage('/opportunities?process=ZINC_PLATING');
    const item = await screen.findByTestId('opportunity-card');
    expect(within(item).getByTestId('card-bucket-basis')).toHaveTextContent(text);
    expect(within(item).queryByTestId('card-fit-level')).not.toBeInTheDocument();
  });

  it('점수는 "근거 있음" 묶음 카드에만 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(
      cards.map((item) => within(item).queryByTestId('card-score')?.textContent ?? null),
    ).toEqual(['77점 · 7/8', '77점 · 7/8', null, null, null, null]);
  });

  it('점수 전인 찾은 회사는 어느 묶음에서든 점수 자리에 조사 상태만 보인다', async () => {
    const found = {
      scoreDisplay: '--',
      scoreState: 'NONE' as const,
      scoreS: null,
      pickReason: '볼트·너트를 만들어 아연도금이 필요할 가능성이 높음',
    };
    mockedGet.mockResolvedValue(
      reply([
        {
          ...card('a', 1, 'NO_HOMEPAGE', 'HOMEPAGE_NOT_FOUND'),
          ...found,
          researchState: 'NOT_FOUND',
        },
        {
          ...card('b', 1, 'NOT_RESEARCHED', 'RESEARCH_NOT_RUN'),
          ...found,
          researchState: 'RUNNING',
        },
      ]),
    );
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(within(cards[0]).getByTestId('card-score')).toHaveTextContent('점수 전 · 조사 중단');
    expect(within(cards[1]).getByTestId('card-score')).toHaveTextContent('점수 전 · 조사 중');
  });

  it('"순서 조정" 줄은 "근거 있음" 묶음에서 조정이 있는 카드에만 보인다', async () => {
    mockedGet.mockResolvedValue(
      reply([
        card('a', 1, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', { rankAdjust: UP }),
        card('b', 2, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', { rankAdjust: DOWN }),
        card('c', 3, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH'),
        // 서버는 다른 묶음에 조정을 주지 않는다. 주더라도 화면은 보이지 않는다.
        card('d', 1, 'EVIDENCE_SOME', 'EVIDENCE_FEW', { rankAdjust: UP }),
        card('e', 1, 'CLOSED', 'CLOSED_OR_HOLD', { rankAdjust: DOWN }),
      ]),
    );
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(within(cards[0]).getByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 성사 2곳 → 위로',
    );
    expect(within(cards[1]).getByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 거절 3곳(수요 없음) → 아래로',
    );
    for (const item of cards.slice(2)) {
      expect(within(item).queryByTestId('card-rank-adjust')).not.toBeInTheDocument();
    }
  });

  it('성사와 거절이 서로 지워 조정 단계가 0이면 이유 줄을 보이지 않는다', async () => {
    const even = { ...UP, level: 0, wonCount: 2, lostCount: 3, countedLostReasons: ['NO_DEMAND'] };
    mockedGet.mockResolvedValue(
      reply([
        card('a', 1, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', { rankAdjust: even as RankAdjust }),
      ]),
    );
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('card-rank-adjust')).not.toBeInTheDocument();
    expect(titles()).toEqual(['근거 있음 30곳']);
  });

  it('성사와 거절이 함께 있으면 한 줄에 같이 적는다', async () => {
    const both: RankAdjust = {
      ...UP,
      wonCount: 3,
      lostCount: 2,
      countedLostReasons: ['NO_DEMAND'],
    };
    mockedGet.mockResolvedValue(
      reply([card('a', 1, 'EVIDENCE_READY', 'EVIDENCE_ENOUGH', { rankAdjust: both })]),
    );
    renderPage('/opportunities?process=ZINC_PLATING');
    expect(await screen.findByTestId('card-rank-adjust')).toHaveTextContent(
      '같은 공정·산업(아연도금 · 자동차 부품)에서 최근 12개월 성사 3곳 · 거절 2곳(수요 없음) → 위로',
    );
  });

  it('전체 보기(view=all)에서는 묶음 제목은 보이고 순위 번호는 숨긴다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?view=all');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toEqual(ALL_TITLES);
    expect(screen.queryByTestId('card-rank')).not.toBeInTheDocument();
    expect(lastFilters()).toMatchObject({ sort: 'contact', process: null });
  });

  it('관심 기업 보기에서도 묶음 제목은 보이고 순위 번호는 숨긴다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards()));
    renderPage('/opportunities?bookmarked=true');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toHaveLength(5);
    expect(screen.queryByTestId('card-rank')).not.toBeInTheDocument();
  });

  it('공정을 고르지 않은 공정별 묶음 보기에서는 공정마다 그 안에 묶음 제목과 그 공정의 건수를 보인다', async () => {
    const zinc = { ...COUNTS, EVIDENCE_READY: 2, EVIDENCE_SOME: 1 };
    const anodizing = { ...COUNTS, EVIDENCE_READY: 5, EVIDENCE_SOME: 7 };
    mockedGet.mockImplementation((_page, _size, _signal, filters) => {
      const code = filters?.process;
      if (!code) return Promise.resolve(reply([apjeong], { total: 12 }));
      return Promise.resolve(
        reply(bucketedCards(code === 'ZINC_PLATING' ? 'z' : 'n'), {
          bucketCounts: code === 'ZINC_PLATING' ? zinc : anodizing,
        }),
      );
    });
    renderPage('/opportunities');
    await waitFor(() => expect(screen.getAllByTestId('process-group-title')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('opportunity-card')).toHaveLength(12));
    expect(titles(screen.getByTestId('process-group-ZINC_PLATING')).slice(0, 2)).toEqual([
      '근거 있음 2곳',
      '근거 조금 1곳',
    ]);
    expect(titles(screen.getByTestId('process-group-ANODIZING')).slice(0, 2)).toEqual([
      '근거 있음 5곳',
      '근거 조금 7곳',
    ]);
    // 묶음 요청마다 근거 상태 묶음 순으로, 관심으로 고른 회사는 빼고 달라고 한다.
    for (const call of mockedGet.mock.calls) {
      expect(call[3]).toMatchObject({ sort: 'contact', hideBookmarked: 'true' });
    }
    expect(screen.getAllByTestId('card-rank')).toHaveLength(12);
  });

  it('"최근 들어온 순"에서는 묶음 순서가 아니라서 제목을 끼우지 않고, 꼬리표와 점수 규칙은 그대로다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards().reverse()));
    renderPage('/opportunities?process=ZINC_PLATING&sort=recent');
    await screen.findAllByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ sort: 'recent' });
    expect(titles()).toEqual([]);
    expect(screen.getAllByTestId('card-fit-level')).toHaveLength(4);
    expect(screen.getAllByTestId('card-bucket-basis')).toHaveLength(1);
    expect(screen.getAllByTestId('card-score')).toHaveLength(2);
  });

  it('서버가 묶음 칸을 주지 않으면(옛 응답) 제목도 꼬리표도 없이 점수는 지금처럼 보인다', async () => {
    const old = { ...apjeong, fitLevel: 'HIGH' as const };
    delete old.bucket;
    delete old.bucketBasis;
    delete old.rankAdjust;
    mockedGet.mockResolvedValue({ data: [old], meta: { total: 1, processCounts: TABS } });
    renderPage('/opportunities?process=ANODIZING');
    await screen.findByTestId('opportunity-card');
    expect(titles()).toEqual([]);
    expect(screen.queryByTestId('card-bucket-basis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-fit-level')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-score')).toHaveTextContent('77점 · 7/8');
  });

  it('서버가 묶음별 건수를 주지 않으면 이 줄에 있는 카드 수로 센다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bucketCounts: null }));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    expect(titles()).toEqual([
      '근거 있음 2곳',
      '근거 조금 1곳',
      '홈페이지 없음 1곳',
      '조사 전 1곳',
      '끝난 회사 1곳',
    ]);
  });
});

describe('추천 목록 · 관심으로 고른 회사는 평소 목록에서 뺀다 (#675)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedPut.mockReset();
  });

  it.each([
    ['공정 하나를 고른 목록', '/opportunities?process=ZINC_PLATING'],
    ['전체 보기', '/opportunities?view=all'],
    ['공정별 묶음 보기', '/opportunities'],
  ])(
    '%s 은 관심으로 고른 회사를 빼 달라고 하고, 머리에 "관심 기업 ○곳" 링크와 꺼진 스위치를 보인다',
    async (_name, url) => {
      mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 3 }));
      renderPage(url);
      await screen.findAllByTestId('opportunity-card');
      for (const call of mockedGet.mock.calls) {
        expect(call[3]).toMatchObject({ hideBookmarked: 'true' });
        expect(call[3]).not.toHaveProperty('bookmarked');
      }
      const link = screen.getByTestId('list-bookmarked-count-link');
      expect(link).toHaveTextContent('관심 기업 3곳');
      expect(link).toHaveAttribute('href', '/opportunities?bookmarked=true');
      expect(screen.getByTestId('list-with-bookmarked')).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText('관심 기업도 함께 보기')).toBeInTheDocument();
      expect(screen.queryByTestId('list-moved-notice')).not.toBeInTheDocument();
    },
  );

  it('관심 기업이 0곳이면 링크는 없고 스위치만 보인다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 0 }));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    expect(screen.queryByTestId('list-bookmarked-count-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-with-bookmarked')).toBeInTheDocument();
  });

  it('"관심 기업도 함께 보기"를 켜면 주소에 남기고 빼 달라는 조건 없이 다시 부른다. 끄면 되돌아간다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 3 }));
    renderPage('/opportunities?process=ZINC_PLATING');
    await screen.findAllByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-with-bookmarked'));
    await waitFor(() => expect(lastFilters()).not.toHaveProperty('hideBookmarked'));
    expect(lastFilters()).toMatchObject({ process: 'ZINC_PLATING', sort: 'contact' });
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/opportunities?process=ZINC_PLATING&withBookmarked=true',
    );
    await waitFor(() =>
      expect(screen.getByTestId('list-with-bookmarked')).toHaveAttribute('aria-checked', 'true'),
    );
    await user.click(screen.getByTestId('list-with-bookmarked'));
    await waitFor(() => expect(lastFilters()).toMatchObject({ hideBookmarked: 'true' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/opportunities\?process=ZINC_PLATING$/,
    );
  });

  it('주소에 withBookmarked=true가 있으면(새로 고침) 스위치가 켜진 채 열리고 빼 달라고 하지 않는다', async () => {
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 3 }));
    renderPage('/opportunities?process=ZINC_PLATING&withBookmarked=true');
    await screen.findAllByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('hideBookmarked');
    expect(screen.getByTestId('list-with-bookmarked')).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    ['관심 기업 보기', '/opportunities?bookmarked=true'],
    ['제외한 회사 보기', '/opportunities?excluded=true'],
    ['대시보드 칸에서 넘어온 보기', '/opportunities?filter=NEED_CHECK'],
    ['영업 단계로 넘어온 보기', '/opportunities?stage=IN_PROGRESS'],
    ['검색 결과', '/opportunities?q=가상'],
  ])('%s 에는 빼 달라는 조건을 보내지 않고 스위치·링크도 없다', async (_name, url) => {
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 3 }));
    renderPage(url);
    await screen.findAllByTestId('opportunity-card');
    for (const call of mockedGet.mock.calls) expect(call[3]).not.toHaveProperty('hideBookmarked');
    expect(screen.queryByTestId('list-bookmarked-line')).not.toBeInTheDocument();
  });

  it('[관심]을 누르면 그 카드가 목록에서 빠지고 곳 수가 줄며 "관심 기업으로 옮겼습니다 · 관심 기업 보기"가 보인다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply(bucketedCards(), { total: 192, bookmarkedCount: 3 }));
    mockedPut.mockResolvedValue({
      data: { active: true, version: 1, source: 'MANUAL' },
      meta: {},
    } as unknown as Awaited<ReturnType<typeof putBookmark>>);
    renderPage('/opportunities?process=ZINC_PLATING');
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(cards).toHaveLength(6);
    await user.click(within(cards[0]).getByTestId('bookmark-button'));
    await waitFor(() => expect(screen.getAllByTestId('opportunity-card')).toHaveLength(5));
    expect(mockedPut).toHaveBeenCalledWith(
      'opp-a',
      expect.objectContaining({ active: true }),
      'park-lee',
    );
    expect(screen.queryByText('가상 a · 브래킷')).not.toBeInTheDocument();
    // 곳 수와 그 묶음의 곳 수가 한 곳씩 줄고, 관심 기업은 한 곳 는다.
    expect(titles()[0]).toBe('근거 있음 29곳');
    expect(screen.getByTestId('list-total')).toHaveTextContent('191');
    expect(screen.getByTestId('list-bookmarked-count-link')).toHaveTextContent('관심 기업 4곳');
    const notice = screen.getByTestId('list-moved-notice');
    expect(notice).toHaveTextContent('관심 기업으로 옮겼습니다 · 관심 기업 보기');
    expect(within(notice).getByTestId('list-moved-link')).toHaveAttribute(
      'href',
      '/opportunities?bookmarked=true',
    );
    // 목록을 다시 부르지는 않는다(서버 응답 한 번).
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('"함께 보기"를 켠 목록에서는 [관심]을 눌러도 카드가 그대로 있고 안내가 없다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply(bucketedCards(), { bookmarkedCount: 3 }));
    mockedPut.mockResolvedValue({
      data: { active: true, version: 1, source: 'MANUAL' },
      meta: {},
    } as unknown as Awaited<ReturnType<typeof putBookmark>>);
    renderPage('/opportunities?process=ZINC_PLATING&withBookmarked=true');
    const cards = await screen.findAllByTestId('opportunity-card');
    await user.click(within(cards[0]).getByTestId('bookmark-button'));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(screen.getAllByTestId('opportunity-card')).toHaveLength(6);
    expect(screen.queryByTestId('list-moved-notice')).not.toBeInTheDocument();
    expect(titles()[0]).toBe('근거 있음 30곳');
  });
});
