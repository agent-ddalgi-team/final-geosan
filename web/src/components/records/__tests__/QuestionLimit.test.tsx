// #691(PM 결정 2026-11-13) 꼬리 질문은 한 통화에 설정한 수(records.questionsPerContact, 초기 6)까지만 보이고
// 넘는 것은 "다음 통화에서 물을 것 n개 · [지금 더 묻기]"로 접힌다. 질문 파일은 화면이 한 번만 받아 두므로 이 시험은 파일을 따로 둔다.
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import type { ChoiceMarks } from '../ChoiceQuestion';
import { foldedQuestionIds, isTalkQuestion, visibleQuestions } from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type {
  OutcomeRecord,
  OutcomeStatus,
  SalesQuestions,
  SalesStepView,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOutcome: vi.fn(),
  getSalesQuestions: vi.fn(),
}));

const QUESTIONS: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'IN_PROGRESS' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [
    {
      questionId: 'PLATING_NOW',
      text: '지금 도금은 어떻게 하나요?',
      step: 'REACHED',
      answers: [
        { answerId: 'IN_HOUSE', label: '직접 함' },
        { answerId: 'OUTSOURCED', label: '외주 줌', reaches: 'DEMAND_CONFIRMED' },
      ],
    },
    {
      questionId: 'CONFIRM_PROCESS',
      text: '어떤 공정을 맡길 수 있나요?',
      step: 'REACHED',
      choices: 'PROCESS',
      answers: [
        { answerId: 'ZINC_PLATING', label: '아연도금' },
        { answerId: 'ANODIZING', label: '아노다이징' },
      ],
    },
    {
      questionId: 'WHO_FIRST',
      text: '누가 먼저 연락했나요?',
      step: 'ALL',
      answers: [
        { answerId: 'OURS', label: '우리가', default: true },
        { answerId: 'THEIRS', label: '상대가' },
      ],
    },
    {
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      answers: [
        { answerId: 'SEND_MATERIAL', label: '자료 보내기' },
        { answerId: 'QUOTE', label: '견적' },
        { answerId: 'RECONTACT', label: '다시 연락' },
        { answerId: 'END', label: '끝' },
      ],
    },
    {
      questionId: 'CLOSE_RESULT',
      text: '어떻게 끝났나요?',
      step: 'ALL',
      showWhen: { answers: { NEXT_ACTION: ['END'] } },
      answers: [
        { answerId: 'WON', label: '성사', closes: 'WON' },
        { answerId: 'LOST', label: '거절', closes: 'LOST' },
        { answerId: 'ON_HOLD', label: '보류 · 나중에 다시', closes: 'ON_HOLD' },
      ],
    },
    {
      questionId: 'LOST_REASON',
      text: '거절 이유는?',
      step: 'ALL',
      showWhen: { answers: { CLOSE_RESULT: ['LOST'] } },
      answers: [
        { answerId: 'PRICE', label: '가격', lostReason: 'PRICE' },
        { answerId: 'OTHER', label: '기타', lostReason: 'OTHER' },
      ],
    },
  ],
};

const STEP: SalesStepView = {
  code: 'REACHED',
  since: '2026-11-10',
  overridden: false,
  known: [],
  openQuestions: ['PLATING_NOW', 'CONFIRM_PROCESS', 'WHO_FIRST', 'NEXT_ACTION'],
};

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

const NO_MARKS: ChoiceMarks = { process: {}, industries: [], industriesSource: null };

function outcome(partial: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-10T00:00:00Z',
    status: 'IN_PROGRESS',
    ...partial,
  };
}

function reply(status: OutcomeStatus = 'IN_PROGRESS') {
  return {
    data: { version: 2, updatedBy: 'park-lee', updatedAt: '2026-11-13T12:15:00Z', status },
    meta: {},
  };
}

async function setResult(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.selectOptions(screen.getByTestId('records-contact-result'), label);
}

async function pick(user: ReturnType<typeof userEvent.setup>, questionId: string, label: string) {
  const question = await screen.findByTestId(`sales-question-${questionId}`);
  await user.click(within(question).getByText(label));
}

function sentBody(call = 0) {
  return vi.mocked(postOutcome).mock.calls[call][1];
}

/** a가 문서에서 b보다 앞에 있는가. */
function before(a: HTMLElement, b: HTMLElement): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  vi.mocked(postOutcome).mockReset();
  vi.mocked(postOutcome).mockResolvedValue(reply());
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
});

describe('꼬리 질문은 한 통화에 설정한 수까지만 (#691)', () => {
  /** 통화 내용 질문 8개(T1~T8, T2는 T1 답의 꼬리) + 공정 확인 + 누가 먼저 + 다음 할 일. */
  const talk = (n: number): SalesQuestions['questions'][number] => ({
    questionId: `T${n}`,
    text: `통화 질문 ${n}`,
    step: 'REACHED',
    ...(n === 2 ? { showWhen: { answers: { T1: ['YES'] } } } : {}),
    answers: [
      { answerId: 'YES', label: `예${n}` },
      { answerId: 'NO', label: `아니오${n}` },
    ],
  });
  const MANY: SalesQuestions = {
    ...QUESTIONS,
    questions: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(talk),
      ...QUESTIONS.questions.filter((item) => item.questionId !== 'PLATING_NOW'),
    ],
  };
  const withLimit = (questionsPerContact?: number): FrameValue => ({
    ...frame,
    config: {
      records: {
        approvalEnabled: false,
        noteMaxLength: 200,
        ...(questionsPerContact === undefined ? {} : { questionsPerContact }),
      },
    } as FrameValue['config'],
  });

  function renderMany(value: FrameValue) {
    render(
      <FrameContext.Provider value={value}>
        <RecordsArea oppId="opp-1" salesStep={STEP} outcome={outcome()} choiceMarks={NO_MARKS} />
      </FrameContext.Provider>,
    );
  }

  const talkShown = () =>
    screen
      .queryAllByTestId(/^sales-question-T\d$/)
      .map((item) => item.getAttribute('data-testid')?.replace('sales-question-', ''));

  beforeEach(() => {
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: MANY, meta: {} });
  });

  it('어느 질문을 접을지: 순서대로 앞에서 limit개, 답한 질문은 접지 않고, 공정 확인·다음 할 일은 세지 않는다', () => {
    const shown = visibleQuestions(MANY, STEP, {});
    expect(shown.filter(isTalkQuestion).map((item) => item.questionId)).toEqual([
      'T1',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'T8',
    ]);
    expect(foldedQuestionIds(shown, {}, 6)).toEqual(['T8']);
    expect(foldedQuestionIds(shown, {}, 3)).toEqual(['T5', 'T6', 'T7', 'T8']);
    expect(foldedQuestionIds(shown, { T7: 'YES' }, 3)).toEqual(['T5', 'T6', 'T8']);
    // 설정 값이 없으면 접지 않는다.
    expect(foldedQuestionIds(shown, {}, null)).toEqual([]);
    expect(foldedQuestionIds(shown, {}, undefined)).toEqual([]);
  });

  it('설정이 6이면 통화 내용 질문 6개만 보이고 나머지는 "다음 통화에서 물을 것 1개 · [지금 더 묻기]"로 접힌다', async () => {
    const user = userEvent.setup();
    renderMany(withLimit(6));
    await setResult(user, '연결됨');
    await screen.findByTestId('sales-questions');
    expect(talkShown()).toEqual(['T1', 'T3', 'T4', 'T5', 'T6', 'T7']);
    const more = screen.getByTestId('sales-questions-more');
    expect(more).toHaveTextContent('다음 통화에서 물을 것 1개');
    expect(screen.getByTestId('sales-questions-more-button')).toHaveTextContent('지금 더 묻기');
    // 세지 않는 것은 늘 보인다: 공정 확인, 다음 할 일, 종류 옆 "누가 먼저".
    expect(screen.getByTestId('sales-question-CONFIRM_PROCESS')).toBeInTheDocument();
    expect(screen.getByTestId('sales-question-NEXT_ACTION')).toBeInTheDocument();
    expect(screen.getByTestId('records-contact-question-WHO_FIRST')).toBeInTheDocument();
    // 접는 한 줄은 묶음 맨 끝에 있다.
    expect(before(screen.getByTestId('sales-question-NEXT_ACTION'), more)).toBe(true);
  });

  it('답에 따라 새 꼬리 질문이 열려 수를 넘으면 넘는 것부터 접히고, 이미 답한 질문은 사라지지 않는다', async () => {
    const user = userEvent.setup();
    renderMany(withLimit(6));
    await setResult(user, '연결됨');
    await pick(user, 'T7', '예7');
    // T1에 "예"를 고르면 꼬리 T2가 열려 통화 내용 질문이 8개가 된다: 앞 6개(T1~T6)만, T7은 답했으니 남는다.
    await pick(user, 'T1', '예1');
    expect(talkShown()).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
    expect(screen.getByTestId('sales-questions-more')).toHaveTextContent(
      '다음 통화에서 물을 것 1개',
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    // 접힌 질문(T8)의 답은 가지 않는다. 서버에는 답이 없으니 다음 통화에서 다시 묻는다.
    expect(sentBody().answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'OURS' },
      { questionId: 'T1', answerId: 'YES' },
      { questionId: 'T7', answerId: 'YES' },
    ]);
  });

  it('[지금 더 묻기]를 누르면 나머지가 펼쳐져 다 물을 수 있다', async () => {
    const user = userEvent.setup();
    renderMany(withLimit(6));
    await setResult(user, '연결됨');
    await user.click(await screen.findByTestId('sales-questions-more-button'));
    expect(talkShown()).toEqual(['T1', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
    expect(screen.queryByTestId('sales-questions-more')).not.toBeInTheDocument();
    await pick(user, 'T8', '아니오8');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody().answers).toContainEqual({ questionId: 'T8', answerId: 'NO' });
  });

  it('설정 값을 3으로 바꾸면 3개만 보이고, 설정 값이 없으면 접지 않는다', async () => {
    const user = userEvent.setup();
    renderMany(withLimit(3));
    await setResult(user, '연결됨');
    await screen.findByTestId('sales-questions');
    expect(talkShown()).toEqual(['T1', 'T3', 'T4']);
    expect(screen.getByTestId('sales-questions-more')).toHaveTextContent(
      '다음 통화에서 물을 것 4개',
    );
    cleanup();
    renderMany(withLimit());
    await setResult(user, '연결됨');
    await screen.findByTestId('sales-questions');
    expect(talkShown()).toHaveLength(7);
    expect(screen.queryByTestId('sales-questions-more')).not.toBeInTheDocument();
  });
});
