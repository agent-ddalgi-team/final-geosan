// #972 영업 분석 숫자 카드 4칸: 접촉 · 진행 중 · 성사 · 거절. 숫자는 분석 응답의 합계 그대로이고,
// 보조 글은 응답에 값이 있을 때만 보인다. 회사 이름·숫자는 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
import AnalysisNumberCards, { numberCards } from '../AnalysisNumberCards';
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
    ...overrides,
  };
}

// 가상: 진행 중 3곳(수요 확인 2 · 연결 1), 성사 1, 거절 1, 보류 1
const COMPANIES: CompanyAnalysisRow[] = [
  company({ name: '가', salesStep: 'DEMAND_CONFIRMED' }),
  company({ name: '나', salesStep: 'REACHED' }),
  company({ name: '다', salesStep: 'DEMAND_CONFIRMED' }),
  company({ name: '라', outcomeStatus: 'WON', salesStep: null }),
  company({ name: '마', outcomeStatus: 'LOST', salesStep: null, lostReasonCode: 'PRICE' }),
  company({ name: '바', outcomeStatus: 'ON_HOLD', salesStep: null }),
];

const MONTHLY = [
  { month: '2026-10', contacted: 11, won: 1, lost: 0 },
  { month: '2026-11', contacted: 8, won: 0, lost: 1 },
];

const DATA: SalesAnalysis = {
  ...SAMPLE,
  companies: COMPANIES,
  total: sampleStats({
    contactedCount: 18,
    inProgressCount: 6,
    onHoldCount: 2,
    wonCount: 5,
    lostCount: 5,
  }),
  monthly: MONTHLY,
};

function card(key: string) {
  return within(screen.getByTestId(`number-card-${key}`));
}

it('네 칸에 응답 합계의 접촉·진행 중·성사·거절 곳 수를 이름표와 함께 보인다', () => {
  render(<AnalysisNumberCards data={DATA} />);
  const cards = within(screen.getByTestId('analysis-number-cards')).getAllByRole('listitem');
  expect(cards.map((el) => el.textContent)).toEqual([
    '접촉18곳이번 달 8곳',
    '진행 중6곳수요 확인 단계 2곳',
    '성사5곳최근 365일',
    '거절5곳보류 2곳 별도',
  ]);
  expect(card('contacted').getByTestId('number-card-value')).toHaveTextContent('18곳');
  expect(card('inProgress').getByTestId('number-card-value')).toHaveTextContent('6곳');
  expect(card('won').getByTestId('number-card-value')).toHaveTextContent('5곳');
  expect(card('lost').getByTestId('number-card-value')).toHaveTextContent('5곳');
});

it('기간을 골랐으면 그 기간의 합계를 보이고, 기간과 상관없는 보조 글(이번 달 · 최근 365일)은 뺀다', () => {
  render(
    <AnalysisNumberCards
      data={{
        ...DATA,
        basis: { ...DATA.basis, from: '2026-10-01', to: '2026-10-31' },
        total: sampleStats({
          contactedCount: 7,
          inProgressCount: 3,
          onHoldCount: 1,
          wonCount: 2,
          lostCount: 1,
        }),
      }}
    />,
  );
  expect(card('contacted').getByTestId('number-card-value')).toHaveTextContent('7곳');
  expect(card('contacted').queryByTestId('number-card-sub')).not.toBeInTheDocument();
  expect(card('inProgress').getByTestId('number-card-sub')).toHaveTextContent('수요 확인 단계 2곳');
  expect(card('won').getByTestId('number-card-value')).toHaveTextContent('2곳');
  expect(card('won').queryByTestId('number-card-sub')).not.toBeInTheDocument();
  expect(card('lost').getByTestId('number-card-sub')).toHaveTextContent('보류 1곳 별도');
});

it('응답에 값이 없는 보조 글은 지어내지 않고 뺀다(옛 서버의 월별 칸 없음 · 진행 중 없음 · 보류 0곳)', () => {
  const cards = numberCards({
    ...DATA,
    monthly: undefined,
    companies: COMPANIES.filter((row) => row.outcomeStatus !== 'IN_PROGRESS'),
    total: sampleStats({
      contactedCount: 2,
      inProgressCount: 0,
      onHoldCount: 0,
      wonCount: 1,
      lostCount: 1,
    }),
  });
  expect(cards.map((item) => [item.key, item.value, item.sub])).toEqual([
    ['contacted', 2, null],
    ['inProgress', 0, null],
    ['won', 1, '최근 365일'],
    ['lost', 1, null],
  ]);
});

it('기록이 0곳이어도 네 칸을 0곳으로 보인다', () => {
  render(
    <AnalysisNumberCards
      data={{
        ...DATA,
        companies: [],
        monthly: [],
        total: sampleStats({
          contactedCount: 0,
          inProgressCount: 0,
          onHoldCount: 0,
          wonCount: 0,
          lostCount: 0,
        }),
      }}
    />,
  );
  for (const key of ['contacted', 'inProgress', 'won', 'lost']) {
    expect(card(key).getByTestId('number-card-value')).toHaveTextContent('0곳');
  }
});
