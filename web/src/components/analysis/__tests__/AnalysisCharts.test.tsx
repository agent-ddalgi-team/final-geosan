// 영업 분석 그림(#801, PM 지시 2026-11-16: 네 그림 — 깔때기·거절 이유·공정 × 산업·회사별 타임라인).
// 서버 숫자를 세기만 하는지 글자로 확인한다(색은 보지 않는다). 회사 이름·숫자는 모두 가상이다.
import { fireEvent, render, screen, within } from '@testing-library/react';
import AnalysisCharts, {
  funnelRank,
  funnelStages,
  gridIndustries,
  timelineDots,
  timelineEnd,
} from '../AnalysisCharts';
import type { CompanyAnalysisRow, SalesAnalysis } from '../../../api/salesAnalysis';
import { SAMPLE, sampleStats } from '../../../test/analysisSample';

function company(overrides: Partial<CompanyAnalysisRow>): CompanyAnalysisRow {
  return {
    oppId: `opp-${overrides.name ?? 'x'}`,
    name: '가상',
    processCodes: [],
    industries: [],
    contactCount: { total: 1, call: 1, email: 0, visit: 0 },
    outcomeStatus: 'IN_PROGRESS',
    salesStep: 'NOT_REACHED',
    lostReasonCode: null,
    firstContactAt: '2026-10-01',
    lastContactAt: '2026-10-01',
    daysSinceFirstContact: 10,
    outcomeAt: null,
    daysToOutcome: null,
    furthestStep: 'NOT_REACHED',
    timeline: [],
    ...overrides,
  };
}

// 가상 6곳: 성사 1 · 수요 확인에서 거절 2(가격·납기) · 연결에서 보류 1 · 견적 진행 1 · 연결 전 1
const SIX: CompanyAnalysisRow[] = [
  company({ name: '가성사', outcomeStatus: 'WON', salesStep: null, furthestStep: 'VISIT_SAMPLE' }),
  company({
    name: '나거절',
    outcomeStatus: 'LOST',
    salesStep: null,
    furthestStep: 'DEMAND_CONFIRMED',
    lostReasonCode: 'PRICE',
  }),
  company({
    name: '다거절',
    outcomeStatus: 'LOST',
    salesStep: null,
    furthestStep: 'DEMAND_CONFIRMED',
    lostReasonCode: 'LEAD_TIME',
  }),
  company({ name: '라보류', outcomeStatus: 'ON_HOLD', salesStep: null, furthestStep: 'REACHED' }),
  company({ name: '마견적', salesStep: 'MATERIAL_QUOTE', furthestStep: 'MATERIAL_QUOTE' }),
  company({ name: '바연결전' }),
];

function withCompanies(companies: CompanyAnalysisRow[], min = 10): SalesAnalysis {
  return {
    ...SAMPLE,
    basis: { ...SAMPLE.basis, minSampleForRatio: min, companyCount: companies.length },
    companies,
  };
}

describe('AnalysisCharts › 어디서 빠지나(깔때기)', () => {
  it('회사마다 이른 가장 먼 단계로 세고, 끝난 회사는 그때 머문 칸에서 멈춘 것으로 센다', () => {
    const stages = funnelStages(SIX);
    expect(stages.map((stage) => [stage.key, stage.count])).toEqual([
      ['CONTACTED', 6],
      ['REACHED', 5],
      ['DEMAND', 4],
      ['QUOTE', 2],
      ['WON', 1],
    ]);
    expect(stages[1].stopped).toEqual({ lost: 0, reasons: [], hold: 1, open: 0 });
    expect(stages[2].stopped.lost).toBe(2);
    expect(stages[2].stopped.reasons.map((item) => item.code).sort()).toEqual([
      'LEAD_TIME',
      'PRICE',
    ]);
    expect(stages[3].stopped).toEqual({ lost: 0, reasons: [], hold: 0, open: 1 });
    expect(stages[4].pass).toBeNull();
  });

  it('가장 먼 단계 칸이 없는 옛 응답이면 지금 세부 단계로 센다(성사는 늘 끝 칸)', () => {
    const old = company({ salesStep: 'DEMAND_CONFIRMED' });
    delete old.furthestStep;
    expect(funnelRank(old)).toBe(2);
    expect(funnelRank(company({ outcomeStatus: 'WON', furthestStep: null, salesStep: null }))).toBe(
      4,
    );
    expect(funnelRank(company({ furthestStep: null, salesStep: null }))).toBe(0);
  });

  it('칸마다 곳 수, 사이에 넘어간 비율과 멈춘 회사(거절 이유·보류·진행 중)를 글로 보인다', () => {
    render(<AnalysisCharts data={withCompanies(SIX, 1)} />);
    const funnel = screen.getByTestId('chart-funnel');
    expect(
      within(funnel)
        .getAllByTestId('chart-funnel-count')
        .map((el) => el.textContent),
    ).toEqual(['6곳', '5곳', '4곳', '2곳', '1곳']);
    const gaps = within(funnel)
      .getAllByTestId('chart-funnel-gap')
      .map((el) => el.textContent);
    expect(gaps).toEqual([
      '↓ 83% 넘어감 · 여기서 멈춤 1곳 · 진행 중 1',
      '↓ 80% 넘어감 · 여기서 멈춤 1곳 · 보류 1',
      '↓ 50% 넘어감 · 여기서 멈춤 2곳 · 거절 2(가격 1 · 납기 1)',
      '↓ 50% 넘어감 · 여기서 멈춤 1곳 · 진행 중 1',
    ]);
  });

  it('칸의 곳 수가 표본 기준보다 적으면 비율을 지어내지 않고 "표본 적음"', () => {
    render(<AnalysisCharts data={withCompanies(SIX, 10)} />);
    const gaps = screen.getAllByTestId('chart-funnel-gap').map((el) => el.textContent);
    expect(gaps.every((text) => text?.startsWith('↓ 표본 적음'))).toBe(true);
    expect(gaps.join('')).not.toContain('%');
  });
});

describe('AnalysisCharts › 거절 이유', () => {
  it('거절 이유 가로 막대는 이름과 곳 수를 글로 보인다', () => {
    render(<AnalysisCharts data={SAMPLE} />);
    const lost = screen.getAllByTestId('chart-lost-row');
    expect(lost.map((row) => row.textContent)).toEqual(['가격 (2곳)', '기존 거래처 유지 (1곳)']);
  });
});

describe('AnalysisCharts › 어느 조합에서 잘 되나(공정 × 산업)', () => {
  const ROWS: SalesAnalysis['byProcess'] = [
    {
      ...SAMPLE.byProcess[0],
      byIndustry: [
        {
          industry: '자동차 부품',
          overlapCount: 0,
          ...sampleStats({
            contactedCount: 12,
            wonCount: 3,
            ratios: { won: 0.25, reach: { CALL: null, EMAIL: null, VISIT: null } },
          }),
        },
        {
          industry: '방위산업',
          overlapCount: 0,
          ...sampleStats({ contactedCount: 3, wonCount: 1 }),
        },
      ],
    },
    {
      ...SAMPLE.byProcess[1],
      byIndustry: [
        {
          industry: '방위산업',
          overlapCount: 0,
          ...sampleStats({ contactedCount: 2, wonCount: 0 }),
        },
      ],
    },
  ];

  it('산업 칸은 공정 줄에 처음 나온 순서로 한 번씩', () => {
    expect(gridIndustries(ROWS)).toEqual(['자동차 부품', '방위산업']);
  });

  it('칸에 접촉·성사 곳 수, 표본 기준 이상만 성사율, 기준 밑은 회색 칸, 없는 조합은 "-"', () => {
    render(<AnalysisCharts data={{ ...SAMPLE, byProcess: ROWS }} />);
    const grid = screen.getByTestId('chart-grid');
    const cells = within(grid).getAllByTestId('chart-grid-cell');
    expect(cells.map((cell) => [cell.textContent, cell.dataset.small])).toEqual([
      ['12곳성사 3 · 성사율 25%', 'false'],
      ['3곳성사 1', 'true'],
      ['2곳성사 0', 'true'],
    ]);
    expect(within(grid).getAllByRole('row')[2]).toHaveTextContent('아노다이징-2곳성사 0');
    expect(cells[1]).toHaveAttribute('title', '아연도금 × 방위산업 · 접촉 3곳 · 성사 1곳');
    expect(grid).toHaveTextContent('회색 칸은 접촉한 회사가 10곳보다 적어');
  });
});

describe('AnalysisCharts › 회사별로 어디서 멈췄나(타임라인)', () => {
  const TIMED = company({
    name: '가상정밀',
    outcomeStatus: 'LOST',
    salesStep: null,
    lostReasonCode: 'PRICE',
    furthestStep: 'DEMAND_CONFIRMED',
    firstContactAt: '2026-09-20',
    lastContactAt: '2026-10-08',
    timeline: [
      {
        at: '2026-09-20',
        method: 'CALL',
        result: 'ABSENT',
        stepAfter: 'NOT_REACHED',
        status: 'IN_PROGRESS',
      },
      {
        at: '2026-10-02',
        method: 'VISIT',
        result: 'REACHED',
        stepAfter: 'REACHED',
        status: 'IN_PROGRESS',
      },
      {
        at: '2026-10-05',
        method: null,
        result: null,
        stepAfter: 'DEMAND_CONFIRMED',
        status: 'IN_PROGRESS',
      },
      {
        at: '2026-10-08',
        method: 'EMAIL',
        result: 'REACHED',
        stepAfter: 'DEMAND_CONFIRMED',
        status: 'IN_PROGRESS',
      },
      {
        at: '2026-10-10',
        method: null,
        result: null,
        stepAfter: 'DEMAND_CONFIRMED',
        status: 'LOST',
      },
    ],
  });

  it('점은 접촉 행과 단계가 처음 올라간 행만(같은 단계에 머문 결과 행은 뺀다)', () => {
    expect(timelineDots(TIMED).map((dot) => [dot.at, dot.method, dot.stepUp])).toEqual([
      ['2026-09-20', 'CALL', null],
      ['2026-10-02', 'VISIT', 'REACHED'],
      ['2026-10-05', null, 'DEMAND_CONFIRMED'],
      ['2026-10-08', 'EMAIL', null],
    ]);
  });

  it('행 줄이 없는 옛 응답이면 첫·마지막 접촉 두 점만', () => {
    const old = company({ firstContactAt: '2026-09-01', lastContactAt: '2026-09-30' });
    delete old.timeline;
    expect(timelineDots(old).map((dot) => dot.at)).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('줄 끝: 거절은 이유, 성사·보류는 그 말, 진행 중은 지금 세부 단계', () => {
    expect(timelineEnd(TIMED)).toBe('거절 · 가격');
    expect(timelineEnd(company({ outcomeStatus: 'WON', salesStep: null }))).toBe('성사');
    expect(timelineEnd(company({ outcomeStatus: 'ON_HOLD', salesStep: null }))).toBe('보류');
    expect(timelineEnd(company({ salesStep: 'MATERIAL_QUOTE' }))).toBe('▶ 자료·견적');
  });

  it('점에 손을 올리면 날짜·방법·결과·올라간 단계가 뜨고, 고른 기간 앞 점은 흐리다', () => {
    render(
      <AnalysisCharts
        data={{
          ...withCompanies([TIMED]),
          basis: { ...SAMPLE.basis, from: '2026-10-01', to: '2026-10-31' },
        }}
      />,
    );
    const row = screen.getByTestId('chart-timeline-row');
    expect(row).toHaveTextContent('가상정밀');
    expect(within(row).getByTestId('chart-timeline-end')).toHaveTextContent('거절 · 가격');
    const dots = within(row).getAllByTestId('chart-timeline-dot');
    expect(dots.map((dot) => dot.getAttribute('title'))).toEqual([
      '9/20 · 전화 · 부재',
      '10/2 · 방문 · 연결됨 · → 연결됨',
      '10/5 · → 수요 확인',
      '10/8 · 메일 · 연결됨',
    ]);
    expect(dots[0].style.opacity).toBe('0.35');
    expect(dots[1].style.opacity).toBe('1');
    expect(screen.getByText('흐린 점은 고른 기간 앞의 기록입니다.')).toBeInTheDocument();
  });

  it('회사가 12곳보다 많으면 12줄만 보이고 [모두 보기]로 편다', () => {
    const many = Array.from({ length: 14 }, (_, index) => company({ name: `가상${index + 1}` }));
    render(<AnalysisCharts data={withCompanies(many)} />);
    expect(screen.getAllByTestId('chart-timeline-row')).toHaveLength(12);
    fireEvent.click(screen.getByTestId('chart-timeline-more'));
    expect(screen.getAllByTestId('chart-timeline-row')).toHaveLength(14);
    expect(screen.getByTestId('chart-timeline-more')).toHaveTextContent('접기');
  });
});

describe('AnalysisCharts › 빈 기록', () => {
  it('기록이 없으면 네 그림마다 "아직 셀 기록이 없습니다"', () => {
    render(
      <AnalysisCharts
        data={{
          ...SAMPLE,
          companies: [],
          byProcess: [],
          bySalesStep: [],
          total: sampleStats({ contactedCount: 0, lostReasons: [] }),
        }}
      />,
    );
    expect(screen.getAllByText('아직 셀 기록이 없습니다.')).toHaveLength(4);
    expect(screen.queryByTestId('kpi-contacted')).not.toBeInTheDocument();
  });
});
