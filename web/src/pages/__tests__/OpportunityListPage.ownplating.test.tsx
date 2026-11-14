// 카드의 "표면처리를 직접 하는 회사일 수 있음" 꼬리표와 근거 한 줄(#319, #316 할 일 7번).
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다(서버가 값을 채우기 전).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { candidateSearch, ownPlatingLine } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
// 점수는 "근거 있음" 묶음 카드에만 보인다(#675). 사례 파일 18곳은 근거가 3건 이상이라 그 묶음에 든다.
// 가짜 응답의 A정밀은 거래 중이라 "끝난 회사" 묶음이므로, 여기서는 근거 있음 묶음의 카드로 바꿔 쓴다.
const apjeong = {
  ...listFixture.data[0],
  bucket: 'EVIDENCE_READY',
  bucketBasis: 'EVIDENCE_ENOUGH',
} as unknown as OpportunityCard;

function card(oppId: string, rank: number, extra: Partial<OpportunityCard> = {}): OpportunityCard {
  return { ...apjeong, oppId, rank, title: `시험 회사 ${oppId}`, ...extra };
}

function reply(items: OpportunityCard[]): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/opportunities']}>
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

describe('카드 · 표면처리를 직접 하는 회사일 수 있음 (#319)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('표시가 참이고 근거가 있으면 꼬리표와 "확인 근거" 한 줄이 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1, {
          ownPlatingLineSuspected: true,
          ownPlatingLineBasis: '생산품 "알루미늄 아노다이징"',
        }),
      ]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.getByTestId('card-own-plating-tag')).toHaveTextContent(ownPlatingLine.tag);
    expect(view.getByTestId('card-own-plating-tag')).toHaveTextContent(
      '표면처리를 직접 하는 회사일 수 있음 · 확인 필요',
    );
    expect(view.getByText(ownPlatingLine.basisLabel)).toBeInTheDocument();
    expect(view.getByTestId('card-own-plating-basis')).toHaveTextContent(
      '생산품 "알루미늄 아노다이징"',
    );
  });

  it('표시가 참인데 근거가 없으면(null) 꼬리표만 보이고 근거 줄은 없다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([card('a', 1, { ownPlatingLineSuspected: true, ownPlatingLineBasis: null })]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.getByTestId('card-own-plating-tag')).toBeInTheDocument();
    expect(view.queryByTestId('card-own-plating-basis')).not.toBeInTheDocument();
    expect(view.queryByText(ownPlatingLine.basisLabel)).not.toBeInTheDocument();
  });

  it('근거가 공백뿐이면 근거 줄을 그리지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([card('a', 1, { ownPlatingLineSuspected: true, ownPlatingLineBasis: '   ' })]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.getByTestId('card-own-plating-tag')).toBeInTheDocument();
    expect(view.queryByTestId('card-own-plating-basis')).not.toBeInTheDocument();
  });

  it('표시가 거짓이면 근거가 있어도 꼬리표도 근거 줄도 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1, {
          ownPlatingLineSuspected: false,
          ownPlatingLineBasis: '생산품 "알루미늄 아노다이징"',
        }),
      ]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.queryByTestId('card-own-plating-tag')).not.toBeInTheDocument();
    expect(view.queryByTestId('card-own-plating-basis')).not.toBeInTheDocument();
  });

  it('사례 파일 18곳 같은 카드(칸 자체가 없음)는 지금과 똑같고 새 글자가 없다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong]));
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.queryByTestId('card-own-plating-tag')).not.toBeInTheDocument();
    expect(view.queryByTestId('card-own-plating-basis')).not.toBeInTheDocument();
    expect(view.queryByText(/표면처리를 직접/)).not.toBeInTheDocument();
    expect(view.getByTestId('card-score')).toHaveTextContent(/^77점 · 7\/8$/);
  });

  it('표시가 있는 회사도 목록에서 빼거나 순서를 바꾸지 않는다(서버가 준 그대로)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1),
        card('b', 2, { ownPlatingLineSuspected: true, ownPlatingLineBasis: '생산품 도금' }),
        card('c', 3),
      ]),
    );
    renderPage();
    const cards = await screen.findAllByTestId('opportunity-card');
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => within(c).getByTestId('card-title').textContent)).toEqual([
      '시험 회사 a',
      '시험 회사 b',
      '시험 회사 c',
    ]);
    // 꼬리표는 표시가 있는 둘째 카드에만 있다.
    expect(within(cards[0]).queryByTestId('card-own-plating-tag')).not.toBeInTheDocument();
    expect(within(cards[1]).getByTestId('card-own-plating-tag')).toBeInTheDocument();
    expect(within(cards[2]).queryByTestId('card-own-plating-tag')).not.toBeInTheDocument();
  });

  it('후보 찾기 표시(고른 이유·점수 전·들어온 날짜)와 한 카드에 함께 보일 수 있다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([
        card('a', 1, {
          scoreState: 'NONE',
          scoreDisplay: '--',
          pickReason: '볼트·너트를 만듦',
          isNewInLatestBatch: true,
          ingestedAt: '2026-11-20T01:00:00Z',
          ownPlatingLineSuspected: true,
          ownPlatingLineBasis: '생산품 "도금 가공"',
        }),
      ]),
    );
    renderPage();
    const view = within(await screen.findByTestId('opportunity-card'));
    expect(view.getByTestId('card-own-plating-tag')).toBeInTheDocument();
    expect(view.getByTestId('card-own-plating-basis')).toHaveTextContent('도금 가공');
    expect(view.getByTestId('card-pick-reason')).toHaveTextContent('볼트·너트를 만듦');
    expect(view.getByTestId('card-ingested-tag')).toHaveTextContent('11/20 들어옴');
    expect(view.getByTestId('card-score')).toHaveTextContent(candidateSearch.beforeScore);
  });
});
