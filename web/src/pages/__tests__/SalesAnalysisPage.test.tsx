// 영업 분석 화면(#608): 서버(fetch)만 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// 공통 틀(AppFrame)과 함께 그려 메뉴·가상 띠·표 두 개·빈 상태·상세 링크를 본다. 회사 이름은 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SalesAnalysisPage from '../SalesAnalysisPage';
import AppFrame from '../../components/frame/AppFrame';
import type { DashboardBreakdown } from '../../api/dashboardTypes';
import type { AnalysisStats, SalesAnalysis } from '../../api/salesAnalysis';
import {
  banner,
  dashboardTexts,
  frame,
  peersArea,
  salesAnalysisTexts as texts,
} from '../../labels/ko';
import configFixture from '../../test/fixtures/config-ui.json';

function stats(overrides: Partial<AnalysisStats> = {}): AnalysisStats {
  return {
    contactedCount: 3,
    inProgressCount: 1,
    onHoldCount: 0,
    wonCount: 1,
    lostCount: 1,
    avgContactsToWon: 4.5,
    contactReach: {
      CALL: { reached: 2, tried: 3 },
      EMAIL: { reached: 0, tried: 1 },
      VISIT: { reached: 0, tried: 0 },
    },
    lostReasons: [{ code: 'INCUMBENT_SUPPLIER', count: 1 }],
    ratios: null,
    ...overrides,
  };
}

const ANALYSIS: SalesAnalysis = {
  asOf: '2026-11-13T09:00:00+09:00',
  basis: { minSampleForRatio: 10, closedWindowDays: 365, companyCount: 3, olderClosedExcluded: 0 },
  byProcess: [
    {
      processCode: 'ZINC_PLATING',
      processName: '아연도금',
      ...stats(),
      byIndustry: [{ industry: '자동차 부품', ...stats({ contactedCount: 2, lostCount: 0 }) }],
    },
  ],
  companies: [
    {
      oppId: 'opp-1',
      name: '가상정밀',
      processCodes: ['ZINC_PLATING'],
      industries: ['자동차 부품'],
      contactCount: { total: 4, call: 3, email: 0, visit: 1 },
      outcomeStatus: 'WON',
      salesStep: null,
      lostReasonCode: null,
      firstContactAt: '2026-10-20',
      lastContactAt: '2026-11-05',
      daysSinceFirstContact: 24,
      outcomeAt: '2026-11-10',
      daysToOutcome: 21,
    },
    {
      oppId: 'opp-2',
      name: '가상금속',
      processCodes: ['ZINC_PLATING'],
      industries: [],
      contactCount: { total: 1, call: 0, email: 1, visit: 0 },
      outcomeStatus: 'LOST',
      salesStep: null,
      lostReasonCode: 'INCUMBENT_SUPPLIER',
      firstContactAt: '2026-10-21',
      lastContactAt: '2026-10-21',
      daysSinceFirstContact: 23,
      outcomeAt: '2026-10-27',
      daysToOutcome: 6,
    },
    {
      oppId: 'opp-3',
      name: '가상산업',
      processCodes: ['ZINC_PLATING'],
      industries: ['자동차 부품'],
      contactCount: { total: 2, call: 2, email: 0, visit: 0 },
      outcomeStatus: 'IN_PROGRESS',
      salesStep: 'DEMAND_CONFIRMED',
      lostReasonCode: null,
      firstContactAt: '2026-11-01',
      lastContactAt: '2026-11-03',
      daysSinceFirstContact: 12,
      outcomeAt: null,
      daysToOutcome: null,
    },
  ],
};

const EMPTY: SalesAnalysis = {
  ...ANALYSIS,
  basis: { ...ANALYSIS.basis, companyCount: 0 },
  byProcess: [],
  companies: [],
};

// 대시보드 집계의 막대 값(#679 "관심 기업 분포"). 가상 회사·가상 숫자다.
const BREAKDOWN: DashboardBreakdown = {
  basis: {
    statuses: ['INTERESTED', 'IN_PROGRESS', 'SAMPLE_OR_REGISTRATION_APPROVED', 'WON_LAST_12M'],
    total: 4,
  },
  byProcess: [
    { processCode: 'ZINC_PLATING', processName: '아연도금', count: 1, ratio: 0.25 },
    { processCode: 'ANODIZING', processName: '아노다이징', count: 4, ratio: 1 },
    { processCode: 'PASSIVATION', processName: '부동태', count: 0, ratio: 0 },
  ],
  byIndustry: [
    { industry: '방위산업', count: 2, ratio: 0.5, includesProposed: true },
    { industry: '반도체', count: 0, ratio: 0, includesProposed: false },
    { industry: '미확정', count: 2, ratio: 0.5, includesProposed: false },
  ],
};

function installFetch(
  analysis: SalesAnalysis | 'fail',
  meta: object = {},
  breakdown: DashboardBreakdown | null | 'fail' = null,
) {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace('/api/v1', '');
      paths.push(`${init?.method ?? 'GET'} ${path}`);
      if (path === '/config/ui') {
        return new Response(JSON.stringify({ data: configFixture.data, meta: {} }));
      }
      if (path === '/dashboard') {
        if (breakdown === 'fail') {
          const error = { message: '잠시 뒤 다시 해 주세요.', nextAction: '다시 시도', ref: 'r2' };
          return new Response(JSON.stringify({ error }), { status: 500 });
        }
        const data = {
          counts: {},
          schedule: [],
          recentActivity: [],
          asOf: ANALYSIS.asOf,
          breakdown,
        };
        return new Response(JSON.stringify({ data, meta: {} }));
      }
      if (path === '/sales-analysis') {
        if (analysis === 'fail') {
          const error = { message: '잠시 뒤 다시 해 주세요.', nextAction: '다시 시도', ref: 'r1' };
          return new Response(JSON.stringify({ error }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: analysis, meta }));
      }
      throw new Error(`예상하지 못한 요청: ${path}`);
    }),
  );
  return paths;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sales-analysis']}>
      <AppFrame title={frame.pageTitleSalesAnalysis}>
        <Routes>
          <Route path="/sales-analysis" element={<SalesAnalysisPage />} />
          <Route path="/opportunities/:oppId" element={<p data-testid="detail-page">상세</p>} />
          <Route path="/opportunities" element={<p data-testid="list-page">목록</p>} />
        </Routes>
      </AppFrame>
    </MemoryRouter>,
  );
}

describe('영업 분석 화면 (#608)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('메뉴에 [영업 분석]이 있고 지금 보는 화면으로 표시되며, 내부 참고 문구가 보인다', async () => {
    installFetch(ANALYSIS);
    renderPage();
    const link = screen.getByTestId('nav-sales-analysis-link');
    expect(link).toHaveTextContent(frame.menuSalesAnalysis);
    expect(link).toHaveAttribute('href', '/sales-analysis');
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('영업 분석');
    expect(screen.getByTestId('analysis-internal-note')).toHaveTextContent(peersArea.internalNote);
    await screen.findByTestId('analysis-process-table');
  });

  it('공정별 표: 공정 줄과 그 아래 산업군 줄에 건수·평균·방법별 연결·거절 이유가 보인다', async () => {
    installFetch(ANALYSIS);
    renderPage();
    const table = await screen.findByTestId('analysis-process-table');
    const row = within(table).getByTestId('analysis-process-row');
    expect(row).toHaveTextContent(
      '아연도금3곳1곳0곳1곳1곳4.5번전화 2/3 · 메일 0/1기존 거래처 유지 1표본 3건',
    );
    const industry = within(table).getByTestId('analysis-industry-row');
    expect(industry).toHaveTextContent('└ 자동차 부품2곳');
    expect(screen.getByTestId('analysis-basis')).toHaveTextContent(
      '11/13 09:00 기준 · 접촉 기록이 있는 회사 3곳 · 성사·거절은 최근 365일 안의 것만',
    );
    expect(screen.getByTestId('analysis-count-rule')).toHaveTextContent('표본이 10건보다 적은 줄');
  });

  it('표본이 기준보다 적으면 비율(%) 없이 "표본 n건"만 보인다', async () => {
    installFetch(ANALYSIS);
    renderPage();
    const table = await screen.findByTestId('analysis-process-table');
    for (const cell of within(table).getAllByTestId('analysis-ratio-cell')) {
      expect(cell.textContent).toMatch(/^표본 \d+건$/);
    }
    expect(table.textContent).not.toContain('%');
  });

  it('표본이 기준 이상이면 서버가 준 비율을 %로 보인다', async () => {
    const enough = stats({
      contactedCount: 12,
      ratios: { won: 0.17, reach: { CALL: 0.67, EMAIL: 0, VISIT: null } },
    });
    installFetch({
      ...ANALYSIS,
      byProcess: [{ ...ANALYSIS.byProcess[0], ...enough, byIndustry: [] }],
    });
    renderPage();
    const table = await screen.findByTestId('analysis-process-table');
    expect(within(table).getByTestId('analysis-ratio-cell')).toHaveTextContent(
      '성사 17% · 전화 연결 67% · 메일 연결 0%',
    );
  });

  it('회사별 표: 방법별 횟수·지금 단계·첫/마지막 접촉·지난 날·결과가 한 줄에 보인다', async () => {
    installFetch(ANALYSIS);
    renderPage();
    const table = await screen.findByTestId('analysis-company-table');
    const rows = within(table).getAllByTestId('analysis-company-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(
      '가상정밀아연도금자동차 부품전화 3 · 방문 1성사10/2011/524일첫 접촉 뒤 21일 만에 성사 (11/10)',
    );
    expect(rows[1]).toHaveTextContent('거절 · 기존 거래처 유지');
    expect(rows[1]).toHaveTextContent('첫 접촉 뒤 6일 만에 거절 (10/27)');
    expect(rows[2]).toHaveTextContent('접촉 · 수요 확인');
    expect(rows[2]).toHaveTextContent('12일—');
  });

  it('회사 이름을 누르면 그 회사 상세로 간다', async () => {
    installFetch(ANALYSIS);
    renderPage();
    const link = await screen.findByRole('link', { name: texts.openCompanyLabel('가상금속') });
    expect(link).toHaveAttribute('href', '/opportunities/opp-2');
    await userEvent.click(link);
    expect(await screen.findByTestId('detail-page')).toBeInTheDocument();
  });

  it('접촉 기록이 없으면 표 대신 빈 상태 문구와 목록으로 가는 링크가 보인다', async () => {
    installFetch(EMPTY);
    renderPage();
    expect(await screen.findByTestId('analysis-empty')).toHaveTextContent(
      '아직 접촉 기록이 없습니다',
    );
    expect(screen.queryByTestId('analysis-process-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-company-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('analysis-empty-link')).toHaveAttribute('href', '/opportunities');
  });

  it('가상 묶음이면 띠에 가상 표시가 보인다', async () => {
    installFetch(ANALYSIS, { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' });
    renderPage();
    await screen.findByTestId('analysis-process-table');
    expect(await screen.findByTestId('banner-virtual-data')).toHaveTextContent(banner.virtualData);
  });

  it('오래된 성사·거절이 빠졌으면 몇 곳이 빠졌는지 알린다', async () => {
    installFetch({ ...ANALYSIS, basis: { ...ANALYSIS.basis, olderClosedExcluded: 2 } });
    renderPage();
    expect(await screen.findByTestId('analysis-basis')).toHaveTextContent(
      '그보다 오래된 성사·거절 2곳은 표에서 빠졌습니다.',
    );
  });

  it('못 불러오면 오류와 [다시 시도]를 보이고, 다시 누르면 표가 나온다', async () => {
    installFetch('fail');
    renderPage();
    expect(await screen.findByTestId('analysis-error')).toHaveTextContent(texts.loadError);
    installFetch(ANALYSIS);
    await userEvent.click(screen.getByTestId('analysis-retry-button'));
    expect(await screen.findByTestId('analysis-company-table')).toBeInTheDocument();
  });

  it('읽기만 한다: 저장 요청·담당자 키·내보내기 단추가 없다', async () => {
    const paths = installFetch(ANALYSIS);
    renderPage();
    await screen.findByTestId('analysis-company-table');
    expect(paths.filter((path) => !path.startsWith('GET '))).toEqual([]);
    expect(paths.filter((path) => path.endsWith('/sales-analysis'))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /엑셀|내보내기|AI/ })).not.toBeInTheDocument();
  });

  describe('관심 기업 분포 (#679: 대시보드에서 옮겨 온 공정별·산업군별 막대)', () => {
    it('표 위쪽에 제목과 함께 서버가 집계한 값(#627)을 그대로 보인다', async () => {
      installFetch(ANALYSIS, {}, BREAKDOWN);
      renderPage();
      const section = await screen.findByTestId('analysis-breakdown');
      expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
        texts.breakdownTitle,
      );
      expect(screen.getByTestId('analysis-breakdown-basis')).toHaveTextContent(
        dashboardTexts.breakdownBasis(4),
      );
      const processRows = within(screen.getByTestId('analysis-by-process')).getAllByTestId(
        'analysis-by-process-row',
      );
      expect(processRows.map((row) => row.textContent)).toEqual([
        '아연도금1곳 (25%)',
        '아노다이징4곳 (100%)',
        '부동태0곳 (0%)',
      ]);
      const industry = screen.getByTestId('analysis-by-industry');
      expect(within(industry).getByTestId('analysis-by-industry-proposed')).toHaveTextContent(
        dashboardTexts.breakdownProposed,
      );
      expect(
        within(industry)
          .getAllByTestId('analysis-by-industry-row')
          .map((row) => row.textContent),
      ).toEqual(['방위산업2곳 (50%)', '반도체0곳 (0%)', '미확정2곳 (50%)']);
      // 막대는 공정별·회사별 표보다 위에 있다.
      const table = await screen.findByTestId('analysis-process-table');
      expect(
        section.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('막대 아래에 아래 표와 세는 기준이 다르다는 한 줄을 붙인다', async () => {
      installFetch(ANALYSIS, {}, BREAKDOWN);
      renderPage();
      expect(await screen.findByTestId('analysis-breakdown-note')).toHaveTextContent(
        texts.breakdownNote,
      );
      expect(texts.breakdownNote).toContain('AI가 제안한 공정·산업도 함께');
      expect(texts.breakdownNote).toContain('확정된 공정·산업만');
    });

    it('AI 제안이 하나도 없으면 "AI 제안 포함"을 보이지 않는다', async () => {
      const noProposed = {
        ...BREAKDOWN,
        byIndustry: BREAKDOWN.byIndustry.map((item) => ({ ...item, includesProposed: false })),
      };
      installFetch(ANALYSIS, {}, noProposed);
      renderPage();
      await screen.findByTestId('analysis-by-industry');
      expect(screen.queryByTestId('analysis-by-industry-proposed')).not.toBeInTheDocument();
    });

    it('대상이 0곳이면 막대 대신 안내와 [추천 목록 가기]를 보인다', async () => {
      installFetch(
        ANALYSIS,
        {},
        { basis: { statuses: [], total: 0 }, byProcess: [], byIndustry: [] },
      );
      renderPage();
      expect(await screen.findByTestId('analysis-breakdown-empty')).toHaveTextContent(
        dashboardTexts.breakdownEmptyText,
      );
      expect(screen.queryByTestId('analysis-by-process')).not.toBeInTheDocument();
      const link = screen.getByTestId('analysis-breakdown-empty-link');
      expect(link).toHaveAttribute('href', '/opportunities');
      expect(link).toHaveTextContent(dashboardTexts.breakdownEmptyAction);
    });

    it('서버가 막대 없음(null)으로 보내면(가상 묶음) 구역을 숨기고 표는 그대로 보인다', async () => {
      installFetch(ANALYSIS, {}, null);
      renderPage();
      await screen.findByTestId('analysis-company-table');
      expect(screen.queryByTestId('analysis-breakdown')).not.toBeInTheDocument();
    });

    it('접촉 기록이 없어 표가 비어도 관심 기업 분포는 보인다', async () => {
      installFetch(EMPTY, {}, BREAKDOWN);
      renderPage();
      expect(await screen.findByTestId('analysis-empty')).toBeInTheDocument();
      expect(await screen.findByTestId('analysis-by-process')).toBeInTheDocument();
    });

    it('막대 값을 못 읽으면 숨기지 않고 못 불러왔다고 알리며, 표는 그대로 보인다', async () => {
      installFetch(ANALYSIS, {}, 'fail');
      renderPage();
      expect(await screen.findByTestId('analysis-breakdown-error')).toHaveTextContent(
        texts.breakdownLoadError,
      );
      expect(await screen.findByTestId('analysis-company-table')).toBeInTheDocument();
    });

    it('새 경로를 만들지 않고 대시보드 집계를 담당자 키 없이 한 번 읽는다', async () => {
      const paths = installFetch(ANALYSIS, {}, BREAKDOWN);
      renderPage();
      await screen.findByTestId('analysis-by-process');
      expect(paths.filter((path) => path === 'GET /dashboard')).toHaveLength(1);
      const calls = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith('/dashboard'));
      const headers = new Headers((calls[0][1] as RequestInit | undefined)?.headers);
      expect(headers.has('X-Staff-Key')).toBe(false);
    });
  });
});
