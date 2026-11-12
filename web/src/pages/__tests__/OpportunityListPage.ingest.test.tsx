// 후보 찾기 화면(#316) 1차: 카드의 고른 이유·점수 전·들어온 날짜, 목록 머리 수집 요약.
// "이번 수집만/전체" 전환은 없애고 정렬 "최근 들어온 순"으로 바꿨다(#516, 2026-11-09).
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// [새 후보 가져오기] 단추와 조건 고르는 칸은 서버(POST /ingest)가 합쳐진 뒤 이어서 만든다(이 시험 범위 밖).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, LatestIngest, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { candidateSearch, cardRows } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

/** 후보 찾기로 들어온 회사: 고른 이유가 있고 점수는 아직 없다. */
const found: OpportunityCard = {
  ...apjeong,
  oppId: 'opp-found',
  rank: 19,
  title: '새한볼트 · 볼트·너트',
  scoreDisplay: '--',
  scoreState: 'NONE',
  scoreS: null,
  pickReason: '볼트·너트를 만들어 전기아연도금이 필요할 가능성이 높음',
  isNewInLatestBatch: true,
  ingestedAt: '2026-11-20T01:00:00Z',
};

function reply(
  items: OpportunityCard[],
  latestIngest?: LatestIngest | null,
): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...(latestIngest ? { latestIngest } : {}) } };
}

const RUNNING: LatestIngest = {
  batchId: 'batch-1',
  status: 'RUNNING',
  scannedCount: 3672,
  pickedCount: 12,
  researchDoneCount: 3,
};

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

describe('추천 목록 · 후보 찾기 카드 표시(#316)', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  it('찾은 회사 카드에 고른 이유·"점수 전"·"날짜 들어옴"이 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByText(candidateSearch.pickReasonRow)).toBeInTheDocument();
    expect(card.getByTestId('card-pick-reason')).toHaveTextContent(
      '볼트·너트를 만들어 전기아연도금이 필요할 가능성이 높음',
    );
    expect(card.getByTestId('card-score')).toHaveTextContent(candidateSearch.beforeScore);
    expect(card.getByTestId('card-score')).not.toHaveTextContent('--');
    expect(card.getByTestId('card-ingested-tag')).toHaveTextContent('11/20 들어옴');
  });

  it.each([
    ['RUNNING', '점수 전 · 조사 중'],
    ['NO_SCORE_EVIDENCE', '점수 전 · 조사 중단'],
    ['NOT_FOUND', '점수 전 · 조사 중단'],
    ['READ_FAILED', '점수 전 · 조사 중단'],
    ['NOT_TRIED', '점수 전 · 조사 중단'],
  ] as const)('조사 상태 %s면 카드에는 "%s"만 보인다(이유는 상세, #596)', async (state, text) => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, researchState: state }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-score')).toHaveTextContent(text);
    expect(card.getByTestId('card-research-state')).toHaveAttribute('data-research-state', state);
  });

  it('조사 상태가 없으면(점수가 났거나 옛 응답) "점수 전"만 보이고 꼬리표가 없다(#596)', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, researchState: null }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-score')).toHaveTextContent(candidateSearch.beforeScore);
    expect(card.queryByTestId('card-research-state')).not.toBeInTheDocument();
  });

  it('들어온 시각을 모르면 날짜 꼬리표가 없고 고른 이유는 계속 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, ingestedAt: null }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.queryByTestId('card-ingested-tag')).not.toBeInTheDocument();
    expect(card.getByTestId('card-pick-reason')).toBeInTheDocument();
  });

  it('예전 회차에 들어온 회사도 날짜 꼬리표가 보인다(마지막 회차인지와 무관, #516)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([{ ...found, isNewInLatestBatch: false, ingestedAt: '2026-11-09T02:19:00Z' }]),
    );
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-ingested-tag')).toHaveTextContent('11/9 들어옴');
  });

  it('점수가 이미 있는 찾은 회사는 "점수 전" 대신 서버 점수 글자를 그대로 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([{ ...found, scoreState: 'PENDING', scoreDisplay: '참고 50점 · 3/8', scoreS: 50 }]),
    );
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-score')).toHaveTextContent('참고 50점 · 3/8');
    expect(card.getByTestId('card-score')).not.toHaveTextContent(candidateSearch.beforeScore);
    expect(card.getByTestId('card-pick-reason')).toBeInTheDocument();
  });

  it('사례 파일 회사(고른 이유 없음)는 점수가 없어도 지금처럼 "점수 --"이고 새 줄·꼬리표가 없다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([{ ...apjeong, scoreDisplay: '--', scoreState: 'NONE', scoreS: null }]),
    );
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    // 기존 목록 시험(점수 없음 카드)과 같은 모양이다: 글자 "점수 --", 낭독 "점수 산정 전".
    expect(card.getByTestId('card-score')).toHaveTextContent(/^점수 --$/);
    expect(card.getByTestId('card-score')).toHaveAttribute('aria-label', '점수 산정 전');
    expect(card.queryByText(candidateSearch.beforeScore)).not.toBeInTheDocument();
    expect(card.queryByText(candidateSearch.pickReasonRow)).not.toBeInTheDocument();
    expect(card.queryByTestId('card-pick-reason')).not.toBeInTheDocument();
    expect(card.queryByTestId('card-ingested-tag')).not.toBeInTheDocument();
  });

  it('추천 근거가 고른 이유와 같은 문장이면 고른 이유 한 줄만 보인다(#555)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([{ ...found, reason: ' 볼트·너트를 만들어 전기아연도금이 필요할 가능성이 높음 ' }]),
    );
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-pick-reason')).toHaveTextContent(
      '볼트·너트를 만들어 전기아연도금이 필요할 가능성이 높음',
    );
    expect(card.queryByTestId('card-reason')).not.toBeInTheDocument();
    expect(card.queryByText(cardRows.reason)).not.toBeInTheDocument();
  });

  it('조사 뒤 추천 근거가 고른 이유와 다르면 두 줄이 모두 보인다(#555)', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([{ ...found, reason: '홈페이지에 "아연도금 볼트 월 30만 개 생산" 확인' }]),
    );
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-pick-reason')).toBeInTheDocument();
    expect(card.getByTestId('card-reason')).toHaveTextContent('아연도금 볼트 월 30만 개 생산');
  });

  it('고른 이유가 공백뿐이면 줄을 그리지 않고 점수 전도 아니다', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, pickReason: '   ' }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.queryByTestId('card-pick-reason')).not.toBeInTheDocument();
    expect(card.queryByText(candidateSearch.beforeScore)).not.toBeInTheDocument();
  });
});

describe('추천 목록 · 후보 수집 요약(#316)과 정렬 "최근 들어온 순"(#516)', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  it('가져오는 중이면 안내와 "훑어본 ○곳 · 고른 ○곳 · 조사 ○/○"를 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found], RUNNING));
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(summary).toHaveAttribute('data-status', 'RUNNING');
    expect(within(summary).getByTestId('ingest-running')).toHaveTextContent(
      candidateSearch.running,
    );
    expect(within(summary).getByTestId('ingest-counts')).toHaveTextContent(
      '훑어본 공장 3,672곳 · 고른 공장 12곳 · 조사 3/12',
    );
  });

  it('끝났으면 "지금 더하는 중" 없이 건수만 보이고, 이름이 비슷한 회사가 있으면 "확인 필요"를 더한다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([found], { ...RUNNING, status: 'DONE', researchDoneCount: 12, mergeCandidateCount: 2 }),
    );
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).queryByTestId('ingest-running')).not.toBeInTheDocument();
    expect(within(summary).getByTestId('ingest-counts')).toHaveTextContent(
      '훑어본 공장 3,672곳 · 고른 공장 12곳 · 조사 12/12 · 확인 필요 2곳',
    );
  });

  it('실패했으면 쉬운 말 안내만 보이고 건수는 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found], { ...RUNNING, status: 'FAILED' }));
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).getByTestId('ingest-failed')).toHaveTextContent(candidateSearch.failed);
    expect(within(summary).queryByTestId('ingest-counts')).not.toBeInTheDocument();
    expect(within(summary).queryByTestId('ingest-running')).not.toBeInTheDocument();
  });

  it('서버가 건수 칸을 안 주면 그 칸은 지어내지 않고 뺀다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found], { batchId: 'b', status: 'DONE' }));
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).queryByTestId('ingest-counts')).not.toBeInTheDocument();
    expect(summary).not.toHaveTextContent('0곳');
  });

  it('고른 회사는 있는데 조사 건수를 모르면 "조사"는 빼고 나머지만 보인다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([found], { batchId: 'b', status: 'RUNNING', scannedCount: 100, pickedCount: 5 }),
    );
    renderPage();
    const counts = await screen.findByTestId('ingest-counts');
    expect(counts).toHaveTextContent('훑어본 공장 100곳 · 고른 공장 5곳');
    expect(counts).not.toHaveTextContent('조사');
  });

  it('한 번도 가져온 적이 없으면(latestIngest 없음) 요약이 보이지 않고, 정렬은 그래도 고를 수 있다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong]));
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('ingest-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-sort-recent')).toBeInTheDocument();
  });

  it('수집 요약 줄에 "이번 수집만 / 전체" 전환 단추가 더 이상 없다(#516)', async () => {
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage();
    await screen.findByTestId('ingest-summary');
    expect(screen.queryByTestId('ingest-scope')).not.toBeInTheDocument();
    expect(screen.queryByText('이번 수집만')).not.toBeInTheDocument();
  });

  it('처음에는 "추천 순"이고 요청에 sort가 없다. "최근 들어온 순"을 누르면 주소와 요청에 sort=recent가 들어가며 1쪽부터 다시 본다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage();
    await screen.findByTestId('ingest-summary');
    expect(screen.getByTestId('list-sort-rank')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('list-sort-recent')).toHaveAttribute('aria-pressed', 'false');
    // 추천 순 요청에는 sort 칸이 아예 없다(기존 요청 모양 그대로).
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('sort');
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('batch');

    await user.click(screen.getByTestId('list-sort-recent'));
    await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[3]).toMatchObject({ sort: 'recent' }));
    expect(mockedGet.mock.calls.at(-1)?.[0]).toBe(1);
    expect(screen.getByTestId('location')).toHaveTextContent('sort=recent');
    expect(screen.getByTestId('list-sort-recent')).toHaveAttribute('aria-pressed', 'true');
  });

  it('주소에 sort=recent가 있으면 "최근 들어온 순"으로 열리고, "추천 순"을 누르면 sort가 빠진다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage('/opportunities?sort=recent');
    await screen.findByTestId('ingest-summary');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ sort: 'recent' });
    expect(screen.getByTestId('list-sort-recent')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('list-sort-rank'));
    await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[3]).not.toHaveProperty('sort'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('sort');
  });

  it('sort가 recent가 아닌 다른 값이면 추천 순으로 읽고 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage('/opportunities?sort=other');
    await screen.findByTestId('ingest-summary');
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('sort');
    expect(screen.getByTestId('list-sort-rank')).toHaveAttribute('aria-pressed', 'true');
  });

  it('예전 주소의 batch=latest는 더 이상 읽지 않고 서버에도 보내지 않는다(#516)', async () => {
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage('/opportunities?batch=latest');
    await screen.findByTestId('ingest-summary');
    for (const call of mockedGet.mock.calls) expect(call[3]).not.toHaveProperty('batch');
    expect(screen.getByTestId('card-ingested-tag')).toBeInTheDocument();
  });

  it('공정별 묶음 보기에서 "최근 들어온 순"이면 묶음 요청마다 sort=recent가 들어간다', async () => {
    mockedGet.mockResolvedValue({
      data: [found],
      meta: {
        total: 1,
        processCounts: [
          { processCode: 'ZINC_PLATING', processName: '아연도금(전기아연도금)', count: 1 },
          { processCode: 'ANODIZING', processName: '아노다이징', count: 1 },
        ],
      },
    });
    renderPage('/opportunities?sort=recent');
    await waitFor(() =>
      expect(
        mockedGet.mock.calls.filter((call) => call[3]?.process === 'ANODIZING').length,
      ).toBeGreaterThan(0),
    );
    for (const call of mockedGet.mock.calls) expect(call[3]).toMatchObject({ sort: 'recent' });
  });

  it('요약 줄은 읽어 주는 영역(role=status)이라 진행이 바뀌면 낭독된다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found], RUNNING));
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).getByRole('status')).toHaveTextContent(candidateSearch.summaryTitle);
  });
});
