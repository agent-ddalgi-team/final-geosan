// #802·#820 "기록에서 배우기": 서버가 센 값을 기준 숫자 없이 그대로 펼쳐 보이는지, 답 채움률을 맨 위에,
// 눈에 띔은 "결론 아님 · 사람 확인 전", 표본 밑은 회색 "표본 부족", 질문지는 "손볼 만함 · 승인 전"인지 본다.
// 숫자·이름은 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
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
  asOf: '2026-11-17T10:00:00Z',
  basis: { minSampleForRatio: 10, closedCount: 24, wonCount: 6, overallWonRatio: 0.25 },
  failure: {
    count: 18,
    onHoldCount: 2,
    byStep: [
      { step: null, count: 1 },
      { step: 'MATERIAL_QUOTE', count: 17 },
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
    count: 6,
    byStep: [{ step: 'VISIT_SAMPLE', count: 6 }],
    avgContactsToWon: 4.3,
    avgFirstVisitIndex: 2,
    failedAvgFirstVisitIndex: null,
  },
  contactsBeforeVisit: [
    { visited: true, bucket: 'ONE', won: 5, failed: 5, inProgress: 1, wonRatio: 0.5, judged: true },
    {
      visited: false,
      bucket: 'THREE',
      won: 0,
      failed: 3,
      inProgress: 0,
      wonRatio: null,
      judged: false,
    },
  ],
  longestGap: [
    { bucket: 'WITHIN_WEEK', won: 4, failed: 6, inProgress: 0, wonRatio: 0.4, judged: true },
    { bucket: 'SINGLE_CONTACT', won: 0, failed: 1, inProgress: 2, wonRatio: null, judged: false },
  ],
  answerOutcomes: [
    {
      questionId: 'INTEREST',
      answerId: 'LOW',
      won: 0,
      failed: 2,
      inProgress: 0,
      wonRatio: null,
      judged: false,
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
      onHold: 0,
      wonRatio: null,
    },
  ],
  standouts: [
    {
      table: 'CONTACTS_BEFORE_VISIT',
      won: 5,
      failed: 5,
      wonRatio: 0.5,
      overallWonRatio: 0.25,
      diff: 0.25,
      visited: true,
      bucket: 'ONE',
      questionId: null,
      answerId: null,
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
      answered: 9,
      ratio: 0.75,
      answers: [{ answerId: 'MEDIUM', count: 8 }],
      unknownShare: 0.25,
      topShare: 0.89,
    },
    {
      questionId: 'PLATING_NOW',
      step: 'REACHED',
      eligible: 0,
      answered: 0,
      ratio: null,
      answers: [],
      unknownShare: null,
      topShare: null,
    },
  ],
  questionnaireHints: [
    { questionId: 'INTEREST', kind: 'SAME_ANSWER', answerId: 'MEDIUM', share: 0.89 },
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

it('답 채움률을 맨 위에, 그다음 눈에 띔·실패에서 배우기·펼친 표 순서로 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  await screen.findByTestId('patterns');
  const order = [
    'patterns-fill',
    'patterns-standouts',
    'patterns-failure',
    'patterns-contacts',
    'patterns-gap',
    'patterns-answers',
    'patterns-success',
    'patterns-combos',
    'patterns-hints',
    'patterns-coach',
  ].map((id) => screen.getByTestId(id));
  for (let i = 1; i < order.length; i += 1) {
    expect(
      order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  expect(screen.getByTestId('patterns-basis')).toHaveTextContent(
    '끝난 회사 24곳(성사 6곳) · 전체 성사율 25% · 표본 기준 10곳',
  );
  expect(screen.getAllByTestId('patterns-fill-row')).toHaveLength(1); // 물을 자리 0인 질문은 뺀다
});

it('눈에 띔은 "결론 아님 · 사람 확인 전"이고 칸 이름·전체와의 차이를 보인다', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  expect(await screen.findByTestId('patterns-standouts-badge')).toHaveTextContent(
    '결론 아님 · 사람 확인 전',
  );
  expect(screen.getByTestId('patterns-standout')).toHaveTextContent(
    '방문 전 접촉 횟수별 · 방문함 1번 — 성사율 50% (전체 25%보다 +25%p) · 성사 5 · 실패 5',
  );
});

it('펼친 표는 기준 숫자 없이 칸마다 성사·실패를 보이고 표본 밑은 회색 "표본 부족"', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  const rows = await screen.findAllByTestId('patterns-contact-row');
  expect(rows[0]).toHaveAttribute('data-judged', 'true');
  expect(rows[0]).toHaveTextContent('방문함 · 1번');
  expect(rows[0]).toHaveTextContent('성사 5 · 실패 5 · 진행 1 · 성사율 50%');
  expect(rows[1]).toHaveAttribute('data-judged', 'false');
  expect(rows[1]).toHaveTextContent('방문 없음 · 3번');
  expect(rows[1]).toHaveTextContent('표본 부족');
  expect(screen.getAllByTestId('patterns-gap-row')[1]).toHaveTextContent('접촉 한 번');
  const answers = within(screen.getByTestId('patterns-answers'));
  expect(answers.getByText('관심 정도는?')).toBeInTheDocument();
  expect(answers.getByTestId('patterns-answer-row')).toHaveTextContent('낮음');
});

it('질문지 다듬기는 "손볼 만함 · 승인 전", 조합은 표본 밑이면 "표본 부족", 코치 효과는 한 줄', async () => {
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: SAMPLE, meta: {} } as never);
  renderPatterns();
  expect(await screen.findByTestId('patterns-hints-badge')).toHaveTextContent(
    '손볼 만함 · 승인 전',
  );
  expect(screen.getByTestId('patterns-hint')).toHaveTextContent(
    '관심 정도는? — 한 답(보통)이 89% — 갈림이 가장 적은 질문',
  );
  expect(screen.getByTestId('patterns-combo')).toHaveTextContent(
    '아연도금(전기아연도금) × 자동차 부품 × 천안·아산 — 접촉 5 · 성사 2 · 표본 부족',
  );
  expect(screen.getByTestId('patterns-coach-line')).toHaveTextContent(
    '코치 제안으로 넣은 일정 4건',
  );
});

it('기록이 없으면 눈에 띔 대신 안내, 전체 성사율 없이 "결론을 내지 않습니다"', async () => {
  const empty: Patterns = {
    ...SAMPLE,
    basis: { minSampleForRatio: 10, closedCount: 0, wonCount: 0, overallWonRatio: null },
    contactsBeforeVisit: [],
    longestGap: [],
    answerOutcomes: [],
    combos: [],
    standouts: [],
    questionnaireHints: [],
  };
  vi.mocked(getSalesPatterns).mockResolvedValueOnce({ data: empty, meta: {} } as never);
  renderPatterns();
  expect(await screen.findByTestId('patterns-standouts-empty')).toHaveTextContent(
    '표본 기준을 넘는 칸이 아직 없습니다',
  );
  expect(screen.getByTestId('patterns-basis')).toHaveTextContent('결론을 내지 않습니다');
  expect(screen.getByTestId('patterns-basis')).not.toHaveTextContent('전체 성사율');
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
