// 후보 찾기 화면(#316) 1차: 카드의 고른 이유·점수 전·이번에 들어옴, 목록 머리 수집 요약, "이번 수집만/전체" 전환.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// [새 후보 가져오기] 단추와 조건 고르는 칸은 서버(POST /ingest)가 합쳐진 뒤 이어서 만든다(이 시험 범위 밖).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, LatestIngest, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { candidateSearch } from '../../labels/ko';
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

  it('찾은 회사 카드에 고른 이유·"점수 전"·"이번에 들어옴 · 날짜"가 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByText(candidateSearch.pickReasonRow)).toBeInTheDocument();
    expect(card.getByTestId('card-pick-reason')).toHaveTextContent(
      '볼트·너트를 만들어 전기아연도금이 필요할 가능성이 높음',
    );
    expect(card.getByTestId('card-score')).toHaveTextContent(candidateSearch.beforeScore);
    expect(card.getByTestId('card-score')).not.toHaveTextContent('--');
    expect(card.getByTestId('card-new-in-batch-tag')).toHaveTextContent('이번에 들어옴 · 11/20');
  });

  it('들어온 날짜를 모르면 꼬리표는 날짜 없이 "이번에 들어옴"만 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, ingestedAt: null }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.getByTestId('card-new-in-batch-tag')).toHaveTextContent(/^이번에 들어옴$/);
  });

  it('이번 수집이 아닌 찾은 회사는 꼬리표가 없고 고른 이유는 계속 보인다', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, isNewInLatestBatch: false }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.queryByTestId('card-new-in-batch-tag')).not.toBeInTheDocument();
    expect(card.getByTestId('card-pick-reason')).toBeInTheDocument();
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
    expect(card.queryByTestId('card-new-in-batch-tag')).not.toBeInTheDocument();
  });

  it('고른 이유가 공백뿐이면 줄을 그리지 않고 점수 전도 아니다', async () => {
    mockedGet.mockResolvedValueOnce(reply([{ ...found, pickReason: '   ' }]));
    renderPage();
    const card = within(await screen.findByTestId('opportunity-card'));
    expect(card.queryByTestId('card-pick-reason')).not.toBeInTheDocument();
    expect(card.queryByText(candidateSearch.beforeScore)).not.toBeInTheDocument();
  });
});

describe('추천 목록 · 후보 수집 요약과 보기 전환(#316)', () => {
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
      '훑어본 회사 3,672곳 · 고른 회사 12곳 · 조사 3/12',
    );
  });

  it('끝났으면 "지금 가져오는 중" 없이 건수만 보이고, 이름이 비슷한 회사가 있으면 "확인 필요"를 더한다', async () => {
    mockedGet.mockResolvedValueOnce(
      reply([found], { ...RUNNING, status: 'DONE', researchDoneCount: 12, mergeCandidateCount: 2 }),
    );
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).queryByTestId('ingest-running')).not.toBeInTheDocument();
    expect(within(summary).getByTestId('ingest-counts')).toHaveTextContent(
      '훑어본 회사 3,672곳 · 고른 회사 12곳 · 조사 12/12 · 확인 필요 2곳',
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
    expect(counts).toHaveTextContent('훑어본 회사 100곳 · 고른 회사 5곳');
    expect(counts).not.toHaveTextContent('조사');
  });

  it('한 번도 가져온 적이 없으면(latestIngest 없음) 요약과 전환이 보이지 않는다', async () => {
    mockedGet.mockResolvedValueOnce(reply([apjeong]));
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('ingest-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-scope')).not.toBeInTheDocument();
  });

  it('처음에는 "전체"가 눌려 있고, "이번 수집만"을 누르면 주소와 요청에 batch=latest가 들어가며 1쪽부터 다시 본다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage();
    await screen.findByTestId('ingest-summary');
    expect(screen.getByTestId('ingest-scope-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ingest-scope-latest')).toHaveAttribute('aria-pressed', 'false');
    // 전체 보기 요청에는 batch 칸이 아예 없다.
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('batch');

    await user.click(screen.getByTestId('ingest-scope-latest'));
    await waitFor(() =>
      expect(mockedGet.mock.calls.at(-1)?.[3]).toMatchObject({ batch: 'latest' }),
    );
    expect(mockedGet.mock.calls.at(-1)?.[0]).toBe(1);
    expect(screen.getByTestId('location')).toHaveTextContent('batch=latest');
    expect(screen.getByTestId('ingest-scope-latest')).toHaveAttribute('aria-pressed', 'true');
  });

  it('주소에 batch=latest가 있으면 "이번 수집만"으로 열리고, "전체"를 누르면 batch가 빠진다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage('/opportunities?batch=latest');
    await screen.findByTestId('ingest-summary');
    expect(mockedGet.mock.calls[0][3]).toMatchObject({ batch: 'latest' });
    expect(screen.getByTestId('ingest-scope-latest')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByTestId('ingest-scope-all'));
    await waitFor(() => expect(mockedGet.mock.calls.at(-1)?.[3]).not.toHaveProperty('batch'));
    expect(screen.getByTestId('location')).not.toHaveTextContent('batch');
  });

  it('batch가 latest가 아닌 다른 값이면 전체로 읽고 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([found], RUNNING));
    renderPage('/opportunities?batch=other');
    await screen.findByTestId('ingest-summary');
    expect(mockedGet.mock.calls[0][3]).not.toHaveProperty('batch');
    expect(screen.getByTestId('ingest-scope-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('"이번 수집만"인데 새로 들어온 회사가 없으면 보기를 "전체"로 바꾸라는 안내가 보인다', async () => {
    mockedGet.mockResolvedValue(reply([], { ...RUNNING, status: 'DONE', pickedCount: 0 }));
    renderPage('/opportunities?batch=latest');
    expect(await screen.findByText(candidateSearch.latestEmpty)).toBeInTheDocument();
    // 목록이 비어도 전환 단추는 남아서 다시 전체로 돌아갈 수 있다.
    expect(screen.getByTestId('ingest-scope-all')).toBeInTheDocument();
  });

  it('요약 줄은 읽어 주는 영역(role=status)이라 진행이 바뀌면 낭독된다', async () => {
    mockedGet.mockResolvedValueOnce(reply([found], RUNNING));
    renderPage();
    const summary = await screen.findByTestId('ingest-summary');
    expect(within(summary).getByRole('status')).toHaveTextContent(candidateSearch.summaryTitle);
  });
});
