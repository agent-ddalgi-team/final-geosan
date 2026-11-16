// 영업 분석 기간(#760): 주소의 기간으로 서버에 묻고, 기간을 고르면 주소와 요청이 바뀐다. 서버(fetch)만 가짜다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SalesAnalysisPage from '../SalesAnalysisPage';
import { SAMPLE } from '../../test/analysisSample';
import { todayKst } from '../../utils/time';

function installFetch() {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = String(url).replace('/api/v1', '');
      paths.push(path);
      if (path.startsWith('/sales-analysis')) {
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        const from = query.get('from');
        const to = query.get('to');
        const data = {
          ...SAMPLE,
          basis: { ...SAMPLE.basis, from, to: from || to ? (to ?? todayKst()) : null },
        };
        return new Response(JSON.stringify({ data, meta: {} }));
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
  const location = useLocation();
  return <span data-testid="where">{location.search}</span>;
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

describe('영업 분석 기간 (#760)', () => {
  beforeEach(() => vi.stubEnv('VITE_USE_FIXTURES', '0'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('주소에 기간이 있으면 그 기간으로 묻고, 기준 줄과 기간 칸에 그 기간이 보인다', async () => {
    const paths = installFetch();
    renderAt('/sales-analysis?from=2026-10-01&to=2026-10-31');
    expect(await screen.findByTestId('analysis-basis')).toHaveTextContent(
      '2026년 10월 1일 ~ 10월 31일 안에 접촉한 회사 12곳',
    );
    expect(paths).toContain('/sales-analysis?from=2026-10-01&to=2026-10-31');
    expect(screen.getByTestId('period-picker-text')).toHaveTextContent(
      '2026년 10월 1일 ~ 10월 31일',
    );
    expect(screen.getByTestId('analysis-period-rule')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-charts')).toBeInTheDocument();
  });

  it('기간이 없으면 전처럼 묻고 [이번 달]을 고르면 주소와 요청이 그 기간으로 바뀐다', async () => {
    const paths = installFetch();
    renderAt('/sales-analysis');
    expect(await screen.findByTestId('analysis-basis')).toHaveTextContent('성사·거절은 최근 365일');
    expect(paths).toContain('/sales-analysis');
    expect(screen.queryByTestId('analysis-period-rule')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('period-picker-button'));
    await userEvent.click(screen.getByTestId('period-preset-THIS_MONTH'));
    const today = todayKst();
    const from = `${today.slice(0, 8)}01`;
    expect(await screen.findByTestId('analysis-period-rule')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`?from=${from}&to=${today}`);
    expect(paths).toContain(`/sales-analysis?from=${from}&to=${today}`);
  });

  it('주소의 날짜 모양이 틀리면 버리고 기간 없이 묻는다', async () => {
    const paths = installFetch();
    renderAt('/sales-analysis?from=어제&to=2026-13');
    await screen.findByTestId('analysis-basis');
    expect(paths).toContain('/sales-analysis');
    expect(paths.some((path) => path.includes('from='))).toBe(false);
  });
});
