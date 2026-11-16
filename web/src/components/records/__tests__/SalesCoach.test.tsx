// 영업 코치(#742, PM 결정 2026-11-14): 확인사항 → 메모 [보내기] → 확인 화면 → [이대로 저장]/[고치기].
// 서버 호출(getSalesQuestions·postCoach·postOutcome·postNote)은 가짜로 바꾼 확인이며 실제 서버·실제 AI 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import type { ChoiceMarks } from '../ChoiceQuestion';
import { coachChecklist, coachStepAfter } from '../SalesCoach';
import { getSalesQuestions, postNote, postOutcome } from '../../../api/client';
import { postCoach } from '../../../api/coach';
import type { CoachResult } from '../../../api/coach';
import type { ConfigUi, OutcomeRecord, SalesQuestions, SalesStepView } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { coachTexts } from '../../../labels/ko';
import { todayKst } from '../../../utils/time';
import { addDays } from '../../../test/pickCalendarDate';

vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  postOutcome: vi.fn(),
  postNote: vi.fn(),
  getSalesQuestions: vi.fn(),
}));
vi.mock('../../../api/coach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/coach')>()),
  postCoach: vi.fn(),
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
      coach: { fill: 'AI', required: true, keyword: '지금 도금 방식' },
      answers: [
        { answerId: 'IN_HOUSE', label: '직접 함' },
        { answerId: 'OUTSOURCED', label: '외주 줌', reaches: 'DEMAND_CONFIRMED' },
      ],
    },
    {
      questionId: 'NEED_PROCESS',
      text: '거산이 맡을 수 있는 공정이 있나요?',
      step: 'REACHED',
      showWhen: { answers: { PLATING_NOW: ['IN_HOUSE'] } },
      coach: { fill: 'SUGGEST', required: true, keyword: '맡길 공정 있나' },
      answers: [
        { answerId: 'YES', label: '있음', reaches: 'DEMAND_CONFIRMED' },
        { answerId: 'NO', label: '없음' },
      ],
    },
    {
      questionId: 'CONFIRM_PROCESS',
      text: '어떤 공정을 맡길 수 있나요?',
      step: 'REACHED',
      choices: 'PROCESS',
      coach: {
        fill: 'SUGGEST',
        required: true,
        requiredWhen: { answers: { NEED_PROCESS: ['YES'] } },
        keyword: '맡길 공정',
      },
      answers: [
        { answerId: 'ZINC_PLATING', label: '아연도금' },
        { answerId: 'ANODIZING', label: '아노다이징' },
      ],
    },
    {
      questionId: 'SWITCH_INTENT',
      text: '외주처를 바꿀 생각이 있나요?',
      step: 'DEMAND_CONFIRMED',
      showWhen: { answers: { PLATING_NOW: ['OUTSOURCED'] } },
      coach: { fill: 'STAFF', required: true, keyword: '외주처 바꿀 생각' },
      answers: [
        { answerId: 'YES', label: '있음' },
        { answerId: 'NOT_NOW', label: '지금은 없음' },
      ],
    },
    {
      questionId: 'WHO_FIRST',
      text: '누가 먼저 연락했나요?',
      step: 'ALL',
      coach: { fill: 'AI', required: false },
      answers: [
        { answerId: 'OURS', label: '우리가', default: true },
        { answerId: 'THEIRS', label: '상대가' },
      ],
    },
    {
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      coach: { fill: 'AI', required: true, keyword: '다음 할 일' },
      answers: [
        { answerId: 'SEND_MATERIAL', label: '자료 보내기' },
        { answerId: 'RECONTACT', label: '다시 연락' },
        { answerId: 'END', label: '끝' },
      ],
    },
    {
      questionId: 'CLOSE_RESULT',
      text: '어떻게 끝났나요?',
      step: 'ALL',
      showWhen: { answers: { NEXT_ACTION: ['END'] } },
      coach: { fill: 'SUGGEST', required: true, keyword: '끝난 결과' },
      answers: [
        { answerId: 'WON', label: '성사', closes: 'WON' },
        { answerId: 'LOST', label: '거절', closes: 'LOST' },
      ],
    },
    {
      questionId: 'LOST_REASON',
      text: '거절 이유는?',
      step: 'ALL',
      showWhen: { answers: { CLOSE_RESULT: ['LOST'] } },
      coach: { fill: 'SUGGEST', required: true, keyword: '거절 이유' },
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

const NO_MARKS: ChoiceMarks = { process: {}, industries: [], industriesSource: null };
const LATER = addDays(todayKst(), 3);

function frameWith(enabled: boolean): FrameValue {
  return {
    config: { staff: [], assistant: { enabled, questionMaxLength: 300 } } as unknown as ConfigUi,
    staffKey: 'park-lee',
    setStaffKey: () => {},
    canRecord: true,
    setBannerMeta: () => {},
    setPageTitle: () => {},
  };
}

const CURRENT: OutcomeRecord = {
  version: 1,
  updatedBy: 'park-lee',
  updatedAt: '2026-11-10T00:00:00Z',
  status: 'IN_PROGRESS',
};

const RESULT: CoachResult = {
  answers: [
    { questionId: 'PLATING_NOW', answerIds: ['OUTSOURCED'], quote: '외주 줌', fill: 'AI' },
    { questionId: 'NEXT_ACTION', answerIds: ['RECONTACT'], quote: '금요일 다시 전화', fill: 'AI' },
    { questionId: 'CONFIRM_PROCESS', answerIds: ['ZINC_PLATING'], quote: '아연', fill: 'SUGGEST' },
  ],
  nextSchedule: { actionId: 'RECONTACT', date: LATER },
  feedback: ['10/28에 물어본 납기에 아직 답을 못 줬어요.', '샘플 요청이 있었는지 확인해 보세요.'],
  nextCall: ['외주처는 어디인가요?', '방문 날짜를 정할 수 있을까요?'],
  summary: '외주 중, 금요일 다시 연락',
  missingRequired: ['SWITCH_INTENT'],
  stepBefore: 'REACHED',
  stepAfter: 'DEMAND_CONFIRMED',
  aiGenerated: true,
  removedNames: 1,
  removedContacts: 0,
};

function renderArea(enabled = true, props: Partial<React.ComponentProps<typeof RecordsArea>> = {}) {
  render(
    <FrameContext.Provider value={frameWith(enabled)}>
      <RecordsArea
        oppId="opp-1"
        salesStep={STEP}
        outcome={CURRENT}
        choiceMarks={NO_MARKS}
        {...props}
      />
    </FrameContext.Provider>,
  );
}

async function reachAndSend(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
  await user.type(
    await screen.findByTestId('records-contact-memo'),
    '김 과장 통화. 외주 줌. 금요일 다시 전화',
  );
  await user.click(screen.getByTestId('coach-send'));
  return screen.findByTestId('coach-review');
}

beforeEach(() => {
  vi.mocked(postOutcome).mockReset();
  vi.mocked(postNote).mockReset();
  vi.mocked(postCoach).mockReset();
  vi.mocked(postOutcome).mockResolvedValue({
    data: {
      version: 2,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-14T12:15:00Z',
      status: 'IN_PROGRESS',
    },
    meta: {},
  });
  vi.mocked(postNote).mockResolvedValue({
    data: {
      noteId: 'note-9',
      version: 3,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-14T12:16:00Z',
    },
    meta: {},
  });
  vi.mocked(postCoach).mockResolvedValue({ data: RESULT, meta: {} });
  vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
});

describe('확인사항 (규칙, AI 아님)', () => {
  it('지금 세부 단계의 필수 질문 가운데 아직 답이 없고 보이는 것과 접촉마다 묻는 것의 짧은 말이다', () => {
    expect(coachChecklist(QUESTIONS, STEP)).toEqual(['지금 도금 방식', '다음 할 일']);
    const known: SalesStepView = {
      ...STEP,
      known: [
        {
          questionId: 'PLATING_NOW',
          question: '',
          answerId: 'IN_HOUSE',
          answer: '직접 함',
          at: '2026-11-10',
          by: 'park-lee',
        },
      ],
    };
    // 직접 함 → 꼬리 "맡길 공정 있나"가 열린다. 맡길 공정은 "있음"일 때만 필수라 아직 없다.
    expect(coachChecklist(QUESTIONS, known)).toEqual(['맡길 공정 있나', '다음 할 일']);
    expect(coachChecklist(null, STEP)).toEqual([]);
  });
});

describe('코치 확인 화면의 단계 (#748, 규칙)', () => {
  const WITH_FIRST: SalesQuestions = {
    ...QUESTIONS,
    questions: [
      {
        questionId: 'WHO_TALKED',
        text: '누구와 이야기했나요?',
        step: 'NOT_REACHED',
        coach: { fill: 'AI', required: true, keyword: '통화 상대' },
        answers: [
          { answerId: 'RIGHT_PERSON', label: '담당 부서', reaches: 'REACHED' },
          { answerId: 'OTHER_DEPT', label: '다른 부서' },
          { answerId: 'GUIDE_ONLY', label: '안내만' },
        ],
      },
      ...QUESTIONS.questions,
    ],
  };

  it('"연결됨" 접촉은 답이 없어도 연결됨까지, 다른 부서·안내만이면 그대로다', () => {
    expect(coachStepAfter(WITH_FIRST, 'NOT_REACHED', {})).toBe('REACHED');
    expect(coachStepAfter(WITH_FIRST, 'NOT_REACHED', { WHO_TALKED: ['OTHER_DEPT'] })).toBe(
      'NOT_REACHED',
    );
    expect(coachStepAfter(WITH_FIRST, 'NOT_REACHED', { WHO_TALKED: ['GUIDE_ONLY'] })).toBe(
      'NOT_REACHED',
    );
    expect(coachStepAfter(WITH_FIRST, 'NOT_REACHED', { PLATING_NOW: ['OUTSOURCED'] })).toBe(
      'DEMAND_CONFIRMED',
    );
    // 앞으로만 간다.
    expect(coachStepAfter(WITH_FIRST, 'DEMAND_CONFIRMED', {})).toBe('DEMAND_CONFIRMED');
  });
});

describe('상세 › 기록 남기기 › 영업 코치 (#742)', () => {
  it('스위치가 켜져 있고 "연결됨"이면 꼬리 질문 대신 확인사항·메모·[보내기]가 보인다', async () => {
    const user = userEvent.setup();
    renderArea();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    expect(await screen.findByTestId('coach-checklist')).toHaveTextContent(
      '확인사항: 지금 도금 방식 · 다음 할 일',
    );
    expect(screen.queryByTestId('sales-question-PLATING_NOW')).not.toBeInTheDocument();
    expect(screen.queryByTestId('records-contact-save-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('coach-send')).toBeDisabled();
    await user.type(screen.getByTestId('records-contact-memo'), '외주 줌');
    expect(screen.getByTestId('coach-send')).toBeEnabled();
  });

  it('[보내기]를 누르면 AI가 채운 답·제안·빠진 필수 질문·피드백이 보이고, 아무것도 저장되지 않는다', async () => {
    const user = userEvent.setup();
    renderArea();
    const review = await reachAndSend(user);
    expect(postCoach).toHaveBeenCalledWith(
      'opp-1',
      {
        memo: '김 과장 통화. 외주 줌. 금요일 다시 전화',
        method: 'CALL',
        attemptedAt: todayKst(),
      },
      'park-lee',
    );
    expect(within(review).getByTestId('coach-filled-PLATING_NOW')).toHaveTextContent(
      `외주 줌 ${coachTexts.filledMark}`,
    );
    expect(within(review).getByTestId('coach-schedule')).toHaveTextContent('다시 연락');
    // 제안은 미리 고르지 않는다.
    expect(within(review).getByTestId('coach-suggest-pick-CONFIRM_PROCESS')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(review).getByTestId('coach-missing-SWITCH_INTENT')).toBeInTheDocument();
    expect(within(review).getAllByTestId('coach-feedback-line')).toHaveLength(2);
    // (#750) 피드백은 고르지 않는다. 다음 통화에 물어볼 것이 같은 화면에 보인다.
    expect(within(review).queryByRole('button', { name: /보고서에 남기기/ })).toBeNull();
    expect(within(review).getByTestId('coach-feedback-saved')).toHaveTextContent(
      coachTexts.feedbackSaved,
    );
    expect(
      within(review)
        .getAllByTestId('coach-next-call-line')
        .map((item) => item.textContent),
    ).toEqual(['외주처는 어디인가요?', '방문 날짜를 정할 수 있을까요?']);
    // (#748) 저장하면 갈 단계: 연결됨 + "외주 줌" → 수요 확인.
    expect(within(review).getByTestId('coach-step')).toHaveTextContent(
      '단계: 연결됨 → 수요 확인 (저장하면)',
    );
    expect(within(review).getByText(coachTexts.missingHint)).toBeInTheDocument();
    expect(postOutcome).not.toHaveBeenCalled();
    expect(postNote).not.toHaveBeenCalled();
    // 받은 정리와 저장할 메모가 어긋나지 않게 메모는 잠긴다.
    expect(screen.getByTestId('records-contact-memo')).toBeDisabled();
  });

  it('[이대로 저장]은 답마다 누가 채웠는지 싣고, 피드백 모두와 다음 통화 준비를 남긴다 (#750)', async () => {
    const user = userEvent.setup();
    const onRecorded = vi.fn();
    renderArea(true, { onRecorded });
    const review = await reachAndSend(user);
    await user.click(within(review).getByTestId('coach-suggest-pick-CONFIRM_PROCESS'));
    await user.click(
      within(within(review).getByTestId('coach-missing-SWITCH_INTENT')).getByText('있음'),
    );
    await user.click(within(review).getByTestId('coach-save'));
    await waitFor(() => expect(postNote).toHaveBeenCalledTimes(3));
    const body = vi.mocked(postOutcome).mock.calls[0][1];
    expect(body).toMatchObject({
      status: 'IN_PROGRESS',
      method: 'CALL',
      result: 'REACHED',
      memo: '김 과장 통화. 외주 줌. 금요일 다시 전화',
      nextScheduleAt: LATER,
      nextScheduleNote: '다시 연락',
    });
    expect(body.answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'OURS', filledBy: 'STAFF' },
      { questionId: 'PLATING_NOW', answerId: 'OUTSOURCED', filledBy: 'AI_CONFIRMED' },
      { questionId: 'CONFIRM_PROCESS', answerId: 'ZINC_PLATING', filledBy: 'STAFF' },
      { questionId: 'SWITCH_INTENT', answerId: 'YES', filledBy: 'STAFF' },
      { questionId: 'NEXT_ACTION', answerId: 'RECONTACT', filledBy: 'AI_CONFIRMED' },
    ]);
    expect(vi.mocked(postNote).mock.calls.map((call) => call[1])).toEqual([
      { text: '10/28에 물어본 납기에 아직 답을 못 줬어요.', kind: 'ADVICE' },
      { text: '샘플 요청이 있었는지 확인해 보세요.', kind: 'ADVICE' },
      { text: '외주처는 어디인가요?\n방문 날짜를 정할 수 있을까요?', kind: 'CALL_PREP' },
    ]);
    await waitFor(() => expect(screen.queryByTestId('coach-review')).not.toBeInTheDocument());
    expect(onRecorded).toHaveBeenCalled();
  });

  it('[고치기]는 AI 답이 골라진 지금 양식을 열고, 바꾼 AI 답은 AI_CHANGED로 저장한다', async () => {
    const user = userEvent.setup();
    renderArea();
    const review = await reachAndSend(user);
    await user.click(within(review).getByTestId('coach-edit'));
    const plating = await screen.findByTestId('sales-question-PLATING_NOW');
    expect(within(plating).getByRole('radio', { name: '외주 줌' })).toBeChecked();
    await user.click(within(plating).getByText('직접 함'));
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    const answers = vi.mocked(postOutcome).mock.calls[0][1].answers ?? [];
    // AI가 채운 답을 다른 보기로 바꾸면 AI_CHANGED(바뀜 #742 PM 결정 2026-11-14, 전에는 STAFF).
    expect(answers).toContainEqual({
      questionId: 'PLATING_NOW',
      answerId: 'IN_HOUSE',
      filledBy: 'AI_CHANGED',
    });
    expect(answers).toContainEqual({
      questionId: 'NEXT_ACTION',
      answerId: 'RECONTACT',
      filledBy: 'AI_CONFIRMED',
    });
    // (#750) [고치기] 뒤 저장해도 코치가 준 피드백과 다음 통화 준비가 남는다.
    await waitFor(() =>
      expect(vi.mocked(postNote).mock.calls.map((call) => call[1].kind)).toEqual([
        'ADVICE',
        'ADVICE',
        'CALL_PREP',
      ]),
    );
  });

  it('(#750) 다음 통화에 물어볼 것이 없으면 통화 준비는 남기지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockResolvedValueOnce({
      data: { ...RESULT, feedback: [], nextCall: [] },
      meta: {},
    });
    renderArea();
    const review = await reachAndSend(user);
    expect(within(review).getByTestId('coach-next-call')).toHaveTextContent(
      coachTexts.nextCallNone,
    );
    await user.click(
      within(within(review).getByTestId('coach-missing-SWITCH_INTENT')).getByText('있음'),
    );
    await user.click(within(review).getByTestId('coach-save'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('coach-review')).not.toBeInTheDocument());
    expect(postNote).not.toHaveBeenCalled();
  });

  it('스위치가 꺼져 있으면 코치는 보이지 않고 지금 양식 그대로다(외부 AI를 부르지 않는다)', async () => {
    const user = userEvent.setup();
    renderArea(false);
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    expect(await screen.findByTestId('sales-question-PLATING_NOW')).toBeInTheDocument();
    expect(screen.queryByTestId('coach-send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('coach-checklist')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-contact-save-button')).toBeInTheDocument();
    expect(postCoach).not.toHaveBeenCalled();
  });

  it('코치가 실패하면 그 이유가 보이고 [직접 고르기]로 지금 양식을 쓸 수 있다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockRejectedValueOnce(new Error('network'));
    renderArea();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await user.type(await screen.findByTestId('records-contact-memo'), '외주 줌');
    await user.click(screen.getByTestId('coach-send'));
    expect(await screen.findByTestId('coach-error')).toHaveTextContent(coachTexts.failed);
    await user.click(screen.getByTestId('coach-direct'));
    expect(await screen.findByTestId('sales-question-PLATING_NOW')).toBeInTheDocument();
    expect(postOutcome).not.toHaveBeenCalled();
  });

  it('제안된 "거절"을 고르면 거절 이유를 고르기 전에는 저장할 수 없다', async () => {
    const user = userEvent.setup();
    vi.mocked(postCoach).mockResolvedValueOnce({
      data: {
        ...RESULT,
        answers: [
          { questionId: 'NEXT_ACTION', answerIds: ['END'], quote: '끝', fill: 'AI' },
          { questionId: 'CLOSE_RESULT', answerIds: ['LOST'], quote: '안 한다', fill: 'SUGGEST' },
        ],
        nextSchedule: null,
        missingRequired: [],
      },
      meta: {},
    });
    renderArea();
    const review = await reachAndSend(user);
    await user.click(within(review).getByTestId('coach-suggest-pick-CLOSE_RESULT'));
    expect(within(review).getByTestId('coach-save')).toBeDisabled();
    await user.click(
      within(within(review).getByTestId('coach-missing-LOST_REASON')).getByText('가격'),
    );
    await user.click(within(review).getByTestId('coach-save'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalled());
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'LOST',
      lostReasonCode: 'PRICE',
    });
  });
});
