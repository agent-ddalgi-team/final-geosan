// 추천 목록에 조건 칸을 연결한 동작(#316): 선택지가 없으면 안 보이고, 있으면 보이며, 가져오는 중에는 진행을 조용히 다시 읽고
// 끝나면 목록을 한 번 다시 불러온다. 서버 호출(getOpportunities·postIngest)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OpportunityListPage, { INGEST_POLL_MS } from '../OpportunityListPage';
import { getOpportunities, postIngest } from '../../api/client';
import type { Envelope, LatestIngest, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import type { IngestOptions } from '../../components/list/IngestForm';
import { useIngestOptions } from '../../components/list/useIngestOptions';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
  postIngest: vi.fn(),
}));
vi.mock('../../components/list/useIngestOptions', () => ({ useIngestOptions: vi.fn() }));

const mockedGet = vi.mocked(getOpportunities);
const mockedPost = vi.mocked(postIngest);
const mockedOptions = vi.mocked(useIngestOptions);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

const OPTIONS: IngestOptions = {
  processes: [{ code: 'ZINC_PLATING', name: '전기아연도금' }],
  regions: ['충남'],
  industries: ['방위산업'],
};

function reply(
  items: OpportunityCard[],
  latestIngest?: LatestIngest | null,
): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...(latestIngest ? { latestIngest } : {}) } };
}

const running = (picked: number): LatestIngest => ({
  batchId: 'b1',
  status: 'RUNNING',
  scannedCount: 100,
  pickedCount: picked,
  researchDoneCount: 0,
});

/** 목록 요청(20건)과 진행만 읽는 요청(1건)을 구분해 돌려준다. */
function routeReplies(
  list: () => Envelope<OpportunityCard[]>,
  poll: () => Envelope<OpportunityCard[]>,
) {
  mockedGet.mockImplementation(async (_page, size) => (size === 1 ? poll() : list()));
}

function renderPage(staffKey: string | null = 'park-lee') {
  return render(
    <MemoryRouter initialEntries={['/opportunities']}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== null && staffKey !== 'viewer',
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <OpportunityListPage />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('추천 목록 · 후보 가져오기 조건 칸 연결(#316)', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedOptions.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('선택지를 아직 못 받으면(null) 조건 칸과 단추를 그리지 않고 목록은 그대로다', async () => {
    mockedOptions.mockReturnValue(null);
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage();
    expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
  });

  it('선택지가 있으면 조건 칸이 목록 위에 보인다', async () => {
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage();
    expect(await screen.findByTestId('ingest-form')).toBeInTheDocument();
    expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
  });

  it('누르면 요청을 보내고, 진행만 다시 읽어 머리 요약이 "가져오는 중"으로 바뀐다(목록은 그대로)', async () => {
    const user = userEvent.setup();
    mockedOptions.mockReturnValue(OPTIONS);
    mockedPost.mockResolvedValueOnce({
      data: { batchId: 'b1', newCount: 0, mergeCandidateCount: 0, skippedCount: 0 },
      meta: {},
    });
    let started = false;
    routeReplies(
      () => reply([apjeong], started ? running(0) : { batchId: 'b0', status: 'DONE' }),
      () => reply([], started ? running(0) : { batchId: 'b0', status: 'DONE' }),
    );
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('ingest-summary')).toHaveAttribute('data-status', 'DONE');
    started = true;
    await user.click(screen.getByTestId('ingest-process-ZINC_PLATING'));
    await user.click(screen.getByTestId('ingest-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('ingest-summary')).toHaveAttribute('data-status', 'RUNNING'),
    );
    expect(mockedPost.mock.calls[0][0]).toEqual({ processCodes: ['ZINC_PLATING'] });
    // 진행만 읽는 요청은 1건짜리이고, 카드는 사라지지 않았다.
    expect(mockedGet.mock.calls.some((call) => call[1] === 1)).toBe(true);
    expect(screen.getByTestId('opportunity-card')).toBeInTheDocument();
    expect(screen.queryByTestId('five-states-loading')).not.toBeInTheDocument();
    // 가져오는 중이라 단추가 잠긴다.
    expect(screen.getByTestId('ingest-submit')).toBeDisabled();
  });

  it('가져오는 중이면 일정 간격으로 진행 건수를 다시 읽어 바꾸고, 목록은 깜박이지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedOptions.mockReturnValue(OPTIONS);
    let picked = 3;
    routeReplies(
      () => reply([apjeong], running(3)),
      () => reply([], running(picked)),
    );
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('ingest-counts')).toHaveTextContent('고른 공장 3곳');
    picked = 7;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INGEST_POLL_MS);
    });
    await waitFor(() =>
      expect(screen.getByTestId('ingest-counts')).toHaveTextContent('고른 공장 7곳'),
    );
    expect(screen.queryByTestId('five-states-loading')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('opportunity-list')).getAllByTestId('opportunity-card'),
    ).toHaveLength(1);
  });

  it('끝났다고 읽으면 목록을 한 번 다시 불러오고, 그 뒤로는 더 읽지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedOptions.mockReturnValue(OPTIONS);
    let done = false;
    const doneIngest: LatestIngest = { ...running(12), status: 'DONE', researchDoneCount: 12 };
    routeReplies(
      () => reply([apjeong], done ? doneIngest : running(12)),
      () => reply([], done ? doneIngest : running(12)),
    );
    renderPage();
    await screen.findByTestId('opportunity-card');
    const listCallsBefore = mockedGet.mock.calls.filter((c) => c[1] === 20).length;
    done = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INGEST_POLL_MS);
    });
    await waitFor(() =>
      expect(mockedGet.mock.calls.filter((c) => c[1] === 20).length).toBe(listCallsBefore + 1),
    );
    await waitFor(() =>
      expect(screen.getByTestId('ingest-summary')).toHaveAttribute('data-status', 'DONE'),
    );
    // 끝난 뒤에는 간격이 지나도 진행만 읽는 요청이 더 나가지 않는다.
    const pollCalls = mockedGet.mock.calls.filter((c) => c[1] === 1).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INGEST_POLL_MS * 3);
    });
    expect(mockedGet.mock.calls.filter((c) => c[1] === 1).length).toBe(pollCalls);
  });

  it('진행을 읽지 못해도(오류) 이전 표시를 그대로 두고 화면은 깨지지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockImplementation(async (_page, size) => {
      if (size === 1) throw new Error('network');
      return reply([apjeong], running(3));
    });
    renderPage();
    await screen.findByTestId('opportunity-card');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INGEST_POLL_MS);
    });
    expect(screen.getByTestId('ingest-counts')).toHaveTextContent('고른 공장 3곳');
    expect(screen.getByTestId('opportunity-card')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('보기 전용 계정에는 선택지가 있어도 조건 칸이 보이지 않는다', async () => {
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('viewer');
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
  });
});
