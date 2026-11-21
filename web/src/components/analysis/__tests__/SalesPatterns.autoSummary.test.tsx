// #802(PM 결정 2026-11-20) "기록에서 배우기" 맨 위 자동 요약: 이미 받은 숫자로 문장을 만든다(AI 없음).
// 기간 양끝이 있으면 같은 길이의 앞 기간 합계를 한 번 더 읽어 ↑↓를 붙인다. 숫자는 모두 가상이다.
import { render, screen, waitFor } from '@testing-library/react';
import SalesPatterns, { previousPeriod } from '../SalesPatterns';
import { getSalesAnalysis, getSalesPatterns } from '../../../api/salesAnalysis';
import type { AnalysisStats, SalesPatterns as Patterns } from '../../../api/salesAnalysis';
import { getSalesQuestions } from '../../../api/client';

vi.mock('../../../api/salesAnalysis', async (original) => ({
  ...(await original<typeof import('../../../api/salesAnalysis')>()),
  getSalesPatterns: vi.fn(),
  getSalesAnalysis: vi.fn(),
}));
vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getSalesQuestions: vi.fn(),
}));

const reach = {
  CALL: { reached: 0, tried: 0 },
  EMAIL: { reached: 0, tried: 0 },
  VISIT: { reached: 0, tried: 0 },
};

function stats(contacted: number, won: number, lost: number, onHold: number): AnalysisStats {
  return {
    contactedCount: contacted,
    inProgressCount: contacted - won - lost - onHold,
    onHoldCount: onHold,
    wonCount: won,
    lostCount: lost,
    avgContactsToWon: null,
    contactReach: reach,
    lostReasons: [],
    ratios: null,
  };
}

const PATTERNS: Patterns = {
  asOf: '2026-11-20T10:00:00Z',
  basis: { minSampleForRatio: 10, closedCount: 6, wonCount: 2, overallWonRatio: null },
  failure: {
    count: 4,
    onHoldCount: 1,
    byStep: [
      { step: 'REACHED', count: 1 },
      { step: 'MATERIAL_QUOTE', count: 3 },
    ],
    lostReasons: [
      { code: 'LEAD_TIME', count: 1 },
      { code: 'PRICE', count: 2 },
    ],
    stepAnswers: [],
  },
  success: {
    count: 2,
    byStep: [{ step: 'VISIT_SAMPLE', count: 2 }],
    avgContactsToWon: 3.5,
    avgFirstVisitIndex: 2,
    failedAvgFirstVisitIndex: null,
  },
  contactsBeforeVisit: [],
  longestGap: [],
  answerOutcomes: [],
  combos: [],
  standouts: [
    {
      table: 'ANSWER',
      won: 7,
      failed: 3,
      wonRatio: 0.7,
      overallWonRatio: 0.38,
      diff: 0.32,
      visited: null,
      bucket: null,
      questionId: 'INTEREST',
      answerId: 'HIGH',
      processCode: null,
      industry: null,
      region: null,
    },
  ],
  answerFill: [
    {
      questionId: 'INTEREST',
      step: 'REACHED',
      eligible: 12,
      answered: 3,
      ratio: 0.25,
      answers: [],
      unknownShare: null,
      topShare: null,
    },
  ],
  questionnaireHints: [],
  coachEffect: { applied: 0, progressed: 0, companies: 0 },
};

const QUESTIONS = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'INTEREST',
      text: '관심 정도는?',
      step: 'REACHED',
      answers: [{ answerId: 'HIGH', label: '높음' }],
    },
  ],
};

beforeEach(() => {
  vi.mocked(getSalesPatterns).mockReset();
  vi.mocked(getSalesAnalysis).mockReset();
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} } as never);
  vi.mocked(getSalesPatterns).mockResolvedValue({ data: PATTERNS, meta: {} } as never);
});

function lines() {
  return screen.getAllByTestId('auto-summary-line').map((line) => line.textContent);
}

it('합계·실패 단계·거절 이유·성사·눈에 띔·답 채움률·결론 이름을 문장으로 보인다(AI 없음)', async () => {
  render(
    <SalesPatterns
      period={{ from: null, to: null }}
      reloadKey={0}
      processNames={{}}
      total={stats(12, 2, 3, 1)}
    />,
  );
  await screen.findByTestId('auto-summary-badge');
  expect(screen.getByTestId('auto-summary-badge')).toHaveTextContent('AI 없음 · 무료');
  await waitFor(() => expect(lines().join('\n')).toContain('관심 정도는? = 높음'));
  expect(lines()).toEqual([
    '접촉 12곳 · 성사 2 · 거절 3 · 보류 1 · 진행 중 6',
    "실패 4곳 가운데 3곳이 '자료·견적'에서 멈췄습니다.",
    '가장 많은 거절 이유: 가격 (2건)',
    '성사 2곳은 평균 3.5번 접촉했고 첫 방문은 평균 2번째 접촉이었습니다.',
    '관심 정도는? = 높음: 성사 7/10 (전체 38%) · 눈에 띔, 결론 아님',
    "'관심 정도는?' 답이 12번 물을 자리 중 3번만 채워졌습니다.",
    '끝난 회사가 6곳이라 아직 결론은 이릅니다(표본 기준 10곳).',
  ]);
  // 기간을 고르지 않았으면 앞 기간을 읽지 않는다.
  expect(getSalesAnalysis).not.toHaveBeenCalled();
});

it('기간을 고르면 같은 길이의 앞 기간 합계를 읽어 ↑↓를 붙인다', async () => {
  vi.mocked(getSalesAnalysis).mockResolvedValue({
    data: { total: stats(9, 2, 4, 0) },
    meta: {},
  } as never);
  render(
    <SalesPatterns
      period={{ from: '2026-11-11', to: '2026-11-20' }}
      reloadKey={0}
      processNames={{}}
      total={stats(12, 2, 3, 1)}
    />,
  );
  await waitFor(() =>
    expect(lines()).toContain('앞 기간(11/01~11/10) 대비 접촉 ↑3 · 성사 — · 거절 ↓1'),
  );
  expect(vi.mocked(getSalesAnalysis).mock.calls[0][1]).toEqual({
    from: '2026-11-01',
    to: '2026-11-10',
  });
});

it('앞 기간 계산: 양끝이 있을 때만, 같은 길이로 바로 앞', () => {
  expect(previousPeriod({ from: '2026-11-15', to: '2026-11-15' })).toEqual({
    from: '2026-11-14',
    to: '2026-11-14',
  });
  expect(previousPeriod({ from: '2026-11-01', to: null })).toBeNull();
  expect(previousPeriod({ from: null, to: null })).toBeNull();
});

it('기록이 없으면 빈 안내만 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValue({
    data: {
      ...PATTERNS,
      basis: { ...PATTERNS.basis, closedCount: 0 },
      failure: { ...PATTERNS.failure, count: 0, byStep: [], lostReasons: [] },
      success: { ...PATTERNS.success, count: 0 },
      standouts: [],
      answerFill: [],
    },
    meta: {},
  } as never);
  render(<SalesPatterns period={{ from: null, to: null }} reloadKey={0} processNames={{}} />);
  expect(await screen.findByTestId('auto-summary-empty')).toHaveTextContent(
    '이 기간에는 요약할 기록이 없습니다.',
  );
});
