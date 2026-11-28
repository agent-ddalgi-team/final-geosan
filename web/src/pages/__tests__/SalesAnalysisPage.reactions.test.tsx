// 영업 분석 화면 › 상대 반응 카드(#985): 기간 고르기와 같은 기간으로 읽는지, 이 카드를 못 읽어도 다른 표는 보이는지 본다.
// 서버(fetch)만 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다. 회사 이름·숫자는 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SalesAnalysisPage from '../SalesAnalysisPage';
import { SAMPLE } from '../../test/analysisSample';
import { REACTION_QUESTIONS, REACTION_SAMPLE } from '../../test/reactionSample';
import { todayKst } from '../../utils/time';

function installFetch(reactions: 'ok' | 'fail' = 'ok') {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('/api/v1', '');
      paths.push(path);
      const route = path.split('?')[0];
      if (route === '/sales-analysis') {
        // 기간 시험(#760)의 가짜 서버처럼, 받은 기간을 기준 칸에 그대로 비춰 준다.
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        const from = query.get('from');
        const to = query.get('to');
        const data = {
          ...SAMPLE,
          basis: { ...SAMPLE.basis, from, to: from || to ? (to ?? todayKst()) : null },
        };
        return new Response(JSON.stringify({ data, meta: {} }));
      }
      if (route === '/sales-analysis/reactions') {
        if (reactions === 'fail') {
          const error = { message: '잠시 뒤 다시 해 주세요.', nextAction: '다시 시도', ref: 'r9' };
          return new Response(JSON.stringify({ error }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: REACTION_SAMPLE, meta: {} }));
      }
      if (route === '/sales-questions') {
        return new Response(JSON.stringify({ data: REACTION_QUESTIONS, meta: {} }));
      }
      if (route === '/dashboard') {
        return new Response(
          JSON.stringify({
            data: { counts: {}, schedule: [], recentActivity: [], asOf: SAMPLE.asOf },
            meta: {},
          }),
        );
      }
      // 이 시험이 보지 않는 다른 카드(기록에서 배우기 · AI 분석 피드백 등)의 요청은 실패로 둔다.
      throw new Error(`예상하지 못한 요청: ${path}`);
    }),
  );
  return paths;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/sales-analysis" element={<SalesAnalysisPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('영업 분석 화면 › 상대 반응 카드 (#985)', () => {
  beforeEach(() => vi.stubEnv('VITE_USE_FIXTURES', '0'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('Given 주소에 기간이 있을 때 When 화면을 열면 Then 반응도 그 기간으로 묻고, 카드는 그림 묶음 아래 · 기록에서 배우기 위에 있다', async () => {
    const paths = installFetch();
    renderAt('/sales-analysis?from=2026-10-01&to=2026-10-31');
    await screen.findByTestId('reaction-pies');
    const card = screen.getByTestId('reaction-card');
    expect(paths).toContain('/sales-analysis/reactions?from=2026-10-01&to=2026-10-31');
    expect(within(card).getByTestId('reaction-basis')).toHaveTextContent(
      '통화 · 메일 · 대면 41건 가운데 반응을 남긴 34건',
    );
    const charts = screen.getByTestId('analysis-charts');
    const patterns = screen.getByTestId('patterns-layout');
    expect(charts.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(patterns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Given 기간 없이 연 화면 When [이번 달]을 고르면 Then 반응도 같은 기간으로 다시 읽는다', async () => {
    const paths = installFetch();
    renderAt('/sales-analysis');
    await screen.findByTestId('reaction-pies');
    // 기간이 없으면 기간 없이 묻는다(영업 분석표와 같은 규칙).
    expect(paths).toContain('/sales-analysis/reactions');
    expect(paths.some((path) => path.startsWith('/sales-analysis/reactions?'))).toBe(false);
    // When
    await userEvent.click(screen.getByTestId('period-picker-button'));
    await userEvent.click(screen.getByTestId('period-preset-THIS_MONTH'));
    // Then
    const today = todayKst();
    const from = `${today.slice(0, 8)}01`;
    await screen.findByTestId('analysis-period-rule');
    await screen.findByTestId('reaction-pies');
    expect(paths).toContain(`/sales-analysis?from=${from}&to=${today}`);
    expect(paths).toContain(`/sales-analysis/reactions?from=${from}&to=${today}`);
  });

  it('Given 반응 읽기가 실패할 때 When 화면을 열면 Then 그 카드 안에만 안내가 뜨고 숫자 카드 · 그림 · 표는 그대로 보인다', async () => {
    installFetch('fail');
    renderAt('/sales-analysis');
    expect(await screen.findByTestId('reaction-error')).toHaveTextContent(
      '상대 반응을 불러오지 못했습니다',
    );
    const card = screen.getByTestId('reaction-card');
    expect(within(card).getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    // 다른 표는 그대로다(화면 전체 오류로 바뀌지 않는다).
    expect(screen.queryByTestId('analysis-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('analysis-number-cards')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-charts')).toBeInTheDocument();
    expect(screen.getByTestId('chart-funnel')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-process-table')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-company-table')).toBeInTheDocument();
  });
});
