// #802 1단계 "기록에서 배우기": 서버가 센 값을 그대로 보이는지, 실패를 먼저 두는지,
// 표본 밑은 "판단 보류", 질문지 다듬기는 "제안 · 승인 전"인지 본다. 숫자·이름은 모두 가상이다.
import { render, screen, waitFor, within } from '@testing-library/react';
import SalesPatterns from '../SalesPatterns';
import { getSalesPatterns } from '../../../api/salesAnalysis';
import type { SalesPatterns as Patterns } from '../../../api/salesAnalysis';
import { getSalesQuestions } from '../../../api/client';

vi.mock('../../../api/salesAnalysis', async (original) => ({
  ...(await original<typeof import('../../../api/salesAnalysis')>()),
  getSalesPatterns: vi.fn(),
}));
vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getSalesQuestions: vi.fn(),
}));

const SAMPLE: Patterns = {
  asOf: '2026-11-16T10:00:00Z',
  basis: { minSampleForRatio: 10, usableCount: 12, neededCount: 30, enough: false },
  failure: {
    count: 9,
    onHoldCount: 2,
    byStep: [
      { step: null, count: 1 },
      { step: 'MATERIAL_QUOTE', count: 8 },
    ],
    lostReasons: [
      { code: 'PRICE', count: 3 },
      { code: 'LEAD_TIME', count: 1 },
    ],
    stepAnswers: [
      {
        step: 'REACHED',
        questionId: 'PLATING_NOW',
        answers: [{ answerId: 'IN_HOUSE', count: 2 }],
      },
    ],
  },
  success: {
    count: 3,
    byStep: [{ step: 'VISIT_SAMPLE', count: 3 }],
    avgContactsToWon: 4.3,
    avgFirstVisitIndex: 2,
    failedAvgFirstVisitIndex: null,
  },
  signals: [
    {
      code: 'CALL_ONLY',
      questionId: null,
      answerIds: [],
      withSignal: 4,
      failed: 4,
      won: 0,
      failedShare: 0.44,
      wonShare: 0,
      judged: false,
    },
    {
      code: 'ANSWER',
      questionId: 'INTEREST',
      answerIds: ['LOW', 'NONE'],
      withSignal: 10,
      failed: 8,
      won: 2,
      failedShare: 0.89,
      wonShare: 0.67,
      judged: true,
    },
  ],
  combos: [
    {
      processCode: 'ZINC_PLATING',
      industry: '자동차 부품',
      region: '천안·아산',
      contacted: 5,
      won: 2,
      lost: 2,
      onHold: 1,
      wonRatio: null,
    },
  ],
  answerFill: [
    { questionId: 'PLATING_NOW', step: 'REACHED', eligible: 12, answered: 9, ratio: 0.75 },
    { questionId: 'NEED_PROCESS', step: 'REACHED', eligible: 0, answered: 0, ratio: null },
  ],
  questionnaireHints: [
    {
      questionId: 'INTEREST',
      kind: 'SAME_ANSWER',
      answerId: 'MEDIUM',
      share: 0.92,
      wonRatioHigh: null,
      wonRatioLow: null,
    },
  ],
  coachEffect: { applied: 4, progressed: 2, companies: 3 },
};

const QUESTIONS = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'INTEREST',
      text: '관심 정도는?',
      step: 'REACHED',
      answers: [
        { answerId: 'MEDIUM', label: '보통' },
        { answerId: 'LOW', label: '낮음' },
        { answerId: 'NONE', label: '없음' },
      ],
    },
    {
      questionId: 'PLATING_NOW',
      text: '지금 도금은 어떻게 하나요?',
      step: 'REACHED',
      answers: [{ answerId: 'IN_HOUSE', label: '직접 함' }],
    },
  ],
};

function renderPatterns() {
  render(
    <SalesPatterns
      period={{ from: null, to: null }}
      reloadKey={0}
      processNames={{ ZINC_PLATING: '아연도금(전기아연도금)' }}
    />,
  );
}

beforeEach(() => {
  vi.mocked(getSalesPatterns).mockReset();
  vi.mocked(getSalesQuestions).mockReset();
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} } as never);
});

it('실패에서 배우기를 먼저, 그다음 성공·조합·충분도·제안·코치 순서로 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  const section = await screen.findByTestId('patterns');
  const ids = Array.from(section.querySelectorAll('section[data-testid]')).map((node) =>
    node.getAttribute('data-testid'),
  );
  expect(ids).toEqual([
    'patterns-failure',
    'patterns-success',
    'patterns-combos',
    'patterns-fill',
    'patterns-hints',
    'patterns-coach',
  ]);
  expect(screen.getByTestId('patterns-basis')).toHaveTextContent(
    '패턴 판단에 쓸 수 있는 기록 12곳 / 필요 30곳 · 아직 기록이 적어',
  );
  expect(screen.getByTestId('patterns-failure-count')).toHaveTextContent(
    '거절·보류 9곳 (보류 2곳)',
  );
  const reasons = screen.getAllByTestId('patterns-failure-reason');
  expect(reasons[0]).toHaveTextContent('가격');
  expect(reasons[0]).toHaveTextContent('3곳');
  expect(screen.getAllByTestId('patterns-failure-step')[0]).toHaveTextContent('연결 전');
  await waitFor(() =>
    expect(screen.getByTestId('patterns-step-answers')).toHaveTextContent(
      '연결됨 · 지금 도금은 어떻게 하나요? — 직접 함 2',
    ),
  );
});

it('표본 밑 신호는 "판단 보류"로 흐리게, 판단한 신호는 실패·성사 몫을 함께 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  const signals = await screen.findAllByTestId('patterns-signal');
  expect(signals[0]).toHaveAttribute('data-judged', 'false');
  expect(signals[0]).toHaveTextContent('전화만·방문 없음 · 판단 보류');
  expect(signals[1]).toHaveAttribute('data-judged', 'true');
  await waitFor(() => expect(signals[1]).toHaveTextContent('관심 정도는? = 낮음·없음'));
  expect(signals[1]).toHaveTextContent('실패 9곳 중 8곳 (89%)');
  expect(signals[1]).toHaveTextContent('성사 3곳 중 2곳 (67%)');
});

it('조합은 공정 이름 × 산업 × 권역, 표본 밑이면 판단 보류. 물을 자리 0인 질문은 채움률에서 뺀다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  expect(await screen.findByTestId('patterns-combo')).toHaveTextContent(
    '아연도금(전기아연도금) × 자동차 부품 × 천안·아산 — 접촉 5 · 성사 2 · 판단 보류',
  );
  const fill = screen.getAllByTestId('patterns-fill-row');
  expect(fill).toHaveLength(1);
  expect(fill[0]).toHaveTextContent('12번 물을 자리 중 9번 답함');
  expect(screen.getByTestId('patterns-success-count')).toHaveTextContent(
    '성사 3곳 · 평균 4.3번 접촉',
  );
  expect(screen.getByTestId('patterns-first-visit')).toHaveTextContent(
    '처음 방문한 접촉 순번 — 성사 2번째 · 실패 방문 없음',
  );
});

it('질문지 다듬기는 "제안 · 승인 전"이고 코치 제안 효과를 한 줄로 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  const hints = await screen.findByTestId('patterns-hints');
  expect(within(hints).getByTestId('patterns-hints-badge')).toHaveTextContent('제안 · 승인 전');
  await waitFor(() =>
    expect(within(hints).getByTestId('patterns-hint')).toHaveTextContent(
      '관심 정도는? — 한 답(보통)이 92%',
    ),
  );
  expect(screen.getByTestId('patterns-coach-line')).toHaveTextContent(
    '코치 제안으로 넣은 일정 4건 → 그 뒤 단계가 앞으로 가거나 성사 2건 (회사 3곳)',
  );
});

it('질문 파일을 못 읽어도 코드로 보이고, 패턴을 못 읽으면 안내만 보인다', async () => {
  vi.mocked(getSalesQuestions).mockReset();
  vi.mocked(getSalesQuestions).mockRejectedValue(new Error('x'));
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  expect(await screen.findByTestId('patterns-step-answers')).toHaveTextContent(
    'PLATING_NOW — IN_HOUSE 2',
  );
  vi.mocked(getSalesPatterns).mockRejectedValueOnce(new Error('down'));
  render(
    <SalesPatterns period={{ from: '2026-11-01', to: null }} reloadKey={1} processNames={{}} />,
  );
  expect(await screen.findByTestId('patterns-error')).toHaveTextContent(
    '패턴을 불러오지 못했습니다',
  );
});
