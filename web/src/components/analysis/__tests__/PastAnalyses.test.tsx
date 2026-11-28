// #918 영업 분석 "지난 분석" 탭: 받을 때마다 저장된 AI 분석을 줄로 보이고 누르면 그때 본문이 열린다.
// 서버(fetch)만 가짜다. 실제 서버·실제 AI 연결 확인이 아니다. 모든 자료는 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SalesAnalysisPage from '../../../pages/SalesAnalysisPage';
import { SAMPLE } from '../../../test/analysisSample';
import { pastAnalysisTexts } from '../../../labels/ko';

const ITEMS = [
  {
    feedbackId: 'feedback-2',
    periodFrom: null,
    periodTo: null,
    generatedAt: '2026-11-25T05:02:00Z',
    generatedBy: 'park-lee',
    headline: '견적 전에 물량을 먼저 묻는다.',
    nextCount: 2,
    costUsd: 0.01,
  },
  {
    feedbackId: 'feedback-1',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-20',
    generatedAt: '2026-11-20T01:00:00Z',
    generatedBy: 'ghost-key',
    headline: '',
    nextCount: 0,
    costUsd: null,
  },
];

const ONE = {
  feedbackId: 'feedback-1',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-20',
  generatedAt: '2026-11-20T01:00:00Z',
  generatedBy: 'ghost-key',
  model: 'fake',
  promptVersion: 'analysis-v3',
  inputHash: 'x',
  costUsd: null,
  failure: {
    where: [{ text: '자료·견적에서 멈춘 곳이 많다.', evidence: ['자료·견적: 3곳'] }],
    why: [],
    signals: [],
    vsSuccess: [],
    next: [],
  },
  success: { where: [], why: [], signals: [] },
  next: [],
  heldBack: [],
  comparedToPrevious: null,
  lookBack: [],
  lookBackFrom: null,
  suggestions: [],
  aiGenerated: true,
};

function installFetch({ history = ITEMS, failOne = false } = {}) {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('/api/v1', '');
      paths.push(path);
      if (path === '/sales-analysis/feedback/history') {
        return new Response(JSON.stringify({ data: { items: history }, meta: {} }));
      }
      if (path.startsWith('/sales-analysis/feedback/history/')) {
        if (failOne) {
          return new Response(
            JSON.stringify({
              error: {
                message: '지난 분석을 찾을 수 없습니다.',
                nextAction: '목록으로 돌아가 다시 골라 주세요.',
                ref: 'r1',
              },
            }),
            { status: 404 },
          );
        }
        return new Response(JSON.stringify({ data: ONE, meta: {} }));
      }
      if (path.startsWith('/sales-analysis/feedback')) {
        return new Response(
          JSON.stringify({ data: { feedback: null, current: false, switchOn: true }, meta: {} }),
        );
      }
      if (path.startsWith('/sales-analysis')) {
        return new Response(JSON.stringify({ data: SAMPLE, meta: {} }));
      }
      if (path === '/dashboard') {
        return new Response(
          JSON.stringify({
            data: { counts: {}, schedule: [], recentActivity: [], asOf: SAMPLE.asOf },
            meta: {},
          }),
        );
      }
      throw new Error(`예상하지 못한 요청: ${path}`);
    }),
  );
  return paths;
}

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/sales-analysis"
          element={
            <>
              <SalesAnalysisPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('영업 분석 › 지난 분석 탭 (#918)', () => {
  it('Given 분석 화면 When [지난 분석] 탭을 누르면 Then 주소에 남고 받은 분석이 최근 것부터 줄로 보인다', async () => {
    const user = userEvent.setup();
    installFetch();
    renderAt('/sales-analysis');
    await user.click(await screen.findByRole('tab', { name: pastAnalysisTexts.tabPast }));
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=past');
    const rows = await screen.findAllByTestId('past-analysis-row');
    expect(rows).toHaveLength(2);
    // #974: 머리의 [AI 분석 받기 ↓]는 내려갈 카드가 있는 [분석] 탭에서만 보인다.
    expect(screen.queryByTestId('analysis-feedback-jump')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('견적 전에 물량을 먼저 묻는다.');
    expect(rows[0]).toHaveTextContent('전체 기간');
    expect(rows[0]).toHaveTextContent('다음 할 일 2개');
    // 다음엔이 없던 분석은 빈 제목 대신 안내, 모르는 담당자 키는 키 그대로.
    expect(rows[1]).toHaveTextContent(pastAnalysisTexts.noHeadline);
    expect(rows[1]).toHaveTextContent('11/1 ~ 11/20');
    expect(rows[1]).toHaveTextContent('ghost-key');
  });

  it('Given 지난 분석 줄 When 누르면 Then 그때 받은 본문이 열리고 AI를 부르지 않으며, 다시 누르면 접힌다', async () => {
    const user = userEvent.setup();
    const paths = installFetch();
    renderAt('/sales-analysis?tab=past');
    const rows = await screen.findAllByTestId('past-analysis-row');
    await user.click(rows[1]);
    const body = await screen.findByTestId('past-analysis-body');
    expect(await within(body).findByText('자료·견적에서 멈춘 곳이 많다.')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true');
    expect(paths).toContain('/sales-analysis/feedback/history/feedback-1');
    // 읽기만 한다: 분석을 새로 받는 요청(POST)은 없다.
    const calls = vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][];
    expect(calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(rows[1]);
    expect(screen.queryByTestId('past-analysis-body')).toBeNull();
  });

  it('Given 열기 실패 When 줄을 누르면 Then 그 줄 아래에 서버의 쉬운 말이 보인다', async () => {
    const user = userEvent.setup();
    installFetch({ failOne: true });
    renderAt('/sales-analysis?tab=past');
    const rows = await screen.findAllByTestId('past-analysis-row');
    await user.click(rows[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('지난 분석을 찾을 수 없습니다.');
  });

  it('Given 받은 분석이 없음 When 지난 분석 탭 Then [분석] 탭에서 받으라는 안내가 보인다', async () => {
    installFetch({ history: [] });
    renderAt('/sales-analysis?tab=past');
    expect(await screen.findByText(pastAnalysisTexts.empty)).toBeInTheDocument();
  });
});
