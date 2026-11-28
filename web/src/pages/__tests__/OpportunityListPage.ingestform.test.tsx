// 추천 목록에 조건 칸을 연결한 동작(#316): 선택지가 없으면 안 보이고, 있으면 보이며, 가져오는 중에는 진행을 조용히 다시 읽고
// 끝나면 목록을 한 번 다시 불러온다. 서버 호출(getOpportunities·postIngest)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage, { INGEST_POLL_MS, type ListView } from '../OpportunityListPage';
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

  it('선택지가 있으면 제목 옆 버튼이 보이고, 누르기 전에는 목록만 보인다', async () => {
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage();
    const heading = screen.getByRole('heading', { name: '거래처 후보', level: 1 });
    const toggle = await screen.findByTestId('ingest-panel-toggle');
    expect(heading.parentElement).toContainElement(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
  });

  it('새 후보 발굴을 누르면 가운데 뜨는 창에서 조건과 이전 결과를 확인하고 닫을 수 있다', async () => {
    const user = userEvent.setup();
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockResolvedValue(
      reply([apjeong], {
        batchId: 'b1',
        status: 'DONE',
        scannedCount: 500,
        pickedCount: 20,
        researchDoneCount: 3,
      }),
    );
    renderPage();
    // #981: [새 후보 발굴]은 창만 여는 단추라 💰도 "유료" 꼬리표도 없다. 비용은 창 안 [발굴 시작]에서 든다.
    const toggle = await screen.findByRole('button', { name: '새 후보 발굴' });
    expect(toggle).toHaveAttribute('data-testid', 'ingest-panel-toggle');
    expect(within(toggle).queryByTestId('paid-tag')).not.toBeInTheDocument();
    await user.click(toggle);
    const panel = await screen.findByRole('dialog', { name: '새 후보 발굴' });
    // #972: 가운데 뜨는 창은 펼쳐지는 움직임이 끝나야 보이므로 그때까지 기다린다(기대는 그대로 "보인다").
    await waitFor(() => expect(within(panel).getByTestId('ingest-process')).toBeVisible());
    expect(within(panel).getByTestId('ingest-region')).toBeVisible();
    expect(within(panel).getByRole('button', { name: '발굴 시작 유료' })).toHaveAttribute(
      'data-testid',
      'ingest-submit',
    );
    expect(within(panel).getByTestId('ingest-industry-disclosure')).not.toHaveAttribute('open');
    await user.click(within(panel).getByText('산업으로 좁히기', { exact: false }));
    expect(within(panel).getByRole('checkbox', { name: '방위산업' })).toBeVisible();
    await user.click(within(panel).getByText('최근 발굴 결과'));
    expect(await within(panel).findByTestId('ingest-summary')).toHaveTextContent('500');
    await user.click(within(panel).getByRole('button', { name: /close/i }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 자주 안 쓰는 보기 조건은 접힌 [조건 더 보기] 안에 있다.
    const more = screen.getByTestId('list-more');
    expect(within(more).getByTestId('list-excluded-on')).toBeInTheDocument();
    expect(within(more).getByTestId('list-with-bookmarked')).toBeInTheDocument();
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
    await user.click(screen.getByTestId('ingest-panel-toggle'));
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
    act(() => screen.getByTestId('ingest-panel-toggle').click());
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
    expect(screen.queryByTestId('ingest-panel-toggle')).not.toBeInTheDocument();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(initial: string, staffKey: string | null = 'park-lee', view: ListView = 'all') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
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
        <OpportunityListPage view={view} />
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

describe('새 후보 발굴 창 · 주소로 열기와 닫기(#972)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedOptions.mockReset();
    mockedOptions.mockReturnValue(OPTIONS);
    mockedGet.mockResolvedValue(reply([apjeong], { batchId: 'b0', status: 'DONE' }));
  });

  it('주소에 newCandidates=1이 있으면(왼쪽 메뉴 [＋ 새 후보 발굴]) 창이 저절로 열리고 안의 내용은 그대로다', async () => {
    renderAt('/opportunities?newCandidates=1');
    const dialog = await screen.findByRole('dialog', { name: '새 후보 발굴' });
    expect(screen.getByTestId('ingest-panel-toggle')).toHaveAttribute('aria-expanded', 'true');
    // 이름으로 회사 넣기 → 조건 칸(공정·지역·산업) → 최근 발굴 결과 순서.
    const panel = within(dialog).getByTestId('ingest-panel');
    expect(Array.from(panel.children).map((child) => child.getAttribute('data-testid'))).toEqual([
      'company-add',
      'ingest-form',
      null,
    ]);
    // 뜨는 창이 펼쳐지는 움직임이 끝나면 보인다.
    await waitFor(() => expect(within(panel).getByTestId('ingest-process')).toBeVisible());
    expect(within(panel).getByTestId('ingest-submit')).toBeDisabled();
    expect(within(panel).getByTestId('ingest-summary')).toHaveAttribute('data-status', 'DONE');
    // 시안의 "찾을 회사 수"는 없는 기능이라 만들지 않았다.
    expect(dialog).not.toHaveTextContent('찾을 회사 수');
  });

  it('창을 닫으면 주소에서 newCandidates만 지우고 다른 조건은 그대로 둔다', async () => {
    const user = userEvent.setup();
    renderAt('/opportunities?process=ZINC_PLATING&region=%EC%B6%A9%EB%82%A8&newCandidates=1');
    const dialog = await screen.findByRole('dialog', { name: '새 후보 발굴' });
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/opportunities\?process=ZINC_PLATING&region=%EC%B6%A9%EB%82%A8$/,
      ),
    );
    expect(screen.getByTestId('ingest-panel-toggle')).toHaveAttribute('aria-expanded', 'false');
    // 목록은 그대로 보이고, 서버에 보내는 조건에 newCandidates는 끼지 않는다.
    expect(screen.getByTestId('opportunity-card')).toBeInTheDocument();
    for (const call of mockedGet.mock.calls) {
      expect(call[3]).not.toHaveProperty('newCandidates');
    }
  });

  it('닫은 뒤 목록 머리 [새 후보 발굴]로 다시 열고 닫아도 주소는 바뀌지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/opportunities?process=ZINC_PLATING&newCandidates=1');
    const dialog = await screen.findByRole('dialog', { name: '새 후보 발굴' });
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    const toggle = screen.getByTestId('ingest-panel-toggle');
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/opportunities\?process=ZINC_PLATING$/,
    );
    await user.click(
      within(screen.getByRole('dialog', { name: '새 후보 발굴' })).getByRole('button', {
        name: /close/i,
      }),
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/opportunities\?process=ZINC_PLATING$/,
    );
  });

  it('보기 전용 계정은 주소에 newCandidates=1이 있어도 창이 열리지 않는다', async () => {
    renderAt('/opportunities?newCandidates=1', 'viewer');
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-panel-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
  });

  it('관심 기업 화면에는 [새 후보 발굴] 단추도 창도 없다', async () => {
    renderAt('/bookmarks?newCandidates=1', 'park-lee', 'bookmarks');
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('ingest-panel-toggle')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('창이 열려 있는 동안에는 목록 위 "찾는 중" 줄을 겹쳐 보이지 않고, 진행은 창 안에서 본다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong], running(3)));
    renderAt('/opportunities?newCandidates=1');
    const dialog = await screen.findByRole('dialog', { name: '새 후보 발굴' });
    const summaries = screen.getAllByTestId('ingest-summary');
    expect(summaries).toHaveLength(1);
    expect(dialog).toContainElement(summaries[0]);
    expect(within(dialog).getByTestId('ingest-running')).toBeInTheDocument();
    expect(within(dialog).getByTestId('ingest-submit')).toBeDisabled();
  });
});
