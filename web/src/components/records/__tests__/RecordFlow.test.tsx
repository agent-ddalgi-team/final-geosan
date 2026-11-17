// #691(PM 결정 2026-11-13) 통화 기록을 덜 누르고 덜 오르내리게:
// 저장 단추는 맨 끝, 종류 기본 "전화", "누가 먼저 연락했나"는 종류 옆에 기본 "우리가",
// 날짜는 펼쳐진 달력에서 바로 고르고 [없음]으로 지나가기(#740에서 2주 단추 → 달력 하나), 통화 없이 일정만 잡기, 확정된 공정·산업은 한 줄, 거절이면 바로 마무리.
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import type { ChoiceMarks } from '../ChoiceQuestion';
import { quickDateLabel } from '../QuickDate';
import {
  SalesStepSummary,
  closingRouteOf,
  contactDefaults,
  visibleQuestions,
} from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type {
  OutcomeRecord,
  OutcomeStatus,
  SalesQuestions,
  SalesStepView,
} from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import type { FrameValue } from '../../frame/FrameContext';
import { todayKst } from '../../../utils/time';
import { addDays, pickCalendarDate } from '../../../test/pickCalendarDate';

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

function renderArea(
  props: Partial<React.ComponentProps<typeof RecordsArea>> = {},
  current: OutcomeRecord = outcome(),
) {
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea
        oppId="opp-1"
        salesStep={STEP}
        outcome={current}
        choiceMarks={NO_MARKS}
        {...props}
      />
    </FrameContext.Provider>,
  );
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

describe('질문 파일에서 읽는 것 (#691)', () => {
  it('기본 보기가 있는 질문은 접촉 자체에 대한 질문이라 꼬리 질문 묶음에서 빠지고, 기본 답이 골라져 있다', () => {
    expect(contactDefaults(QUESTIONS)).toEqual({ WHO_FIRST: 'OURS' });
    expect(visibleQuestions(QUESTIONS, STEP, {}).map((item) => item.questionId)).toEqual([
      'PLATING_NOW',
      'CONFIRM_PROCESS',
      'NEXT_ACTION',
    ]);
    expect(contactDefaults(null)).toEqual({});
  });

  it('"끝 → 어떻게 끝났나요?" 길을 질문 id 없이 찾는다', () => {
    expect(closingRouteOf(QUESTIONS)).toEqual({
      openerId: 'NEXT_ACTION',
      endAnswerIds: ['END'],
      closingId: 'CLOSE_RESULT',
      options: [
        { answerId: 'WON', label: '성사', closes: 'WON' },
        { answerId: 'LOST', label: '거절', closes: 'LOST' },
        { answerId: 'ON_HOLD', label: '보류 · 나중에 다시', closes: 'ON_HOLD' },
      ],
    });
    // 마무리 질문이 없는 파일이면 길이 없다(화면은 전처럼 질문을 차례로 보인다).
    const plain = { ...QUESTIONS, questions: QUESTIONS.questions.slice(0, 4) };
    expect(closingRouteOf(plain)).toBeNull();
    expect(closingRouteOf(null)).toBeNull();
  });

  it('"알아낸 것" 요약에 "누가 먼저 연락했나요?" 답은 섞이지 않는다', () => {
    const step: SalesStepView = {
      ...STEP,
      known: [
        {
          questionId: 'WHO_FIRST',
          question: '누가 먼저 연락했나요?',
          answerId: 'THEIRS',
          answer: '상대가',
          at: '2026-11-12',
          by: 'park-lee',
        },
        {
          questionId: 'PLATING_NOW',
          question: '지금 도금은 어떻게 하나요?',
          answerId: 'IN_HOUSE',
          answer: '직접 함',
          at: '2026-11-12',
          by: 'park-lee',
        },
      ],
    };
    render(<SalesStepSummary step={step} status="IN_PROGRESS" questions={QUESTIONS} />);
    expect(screen.getByTestId('sales-step-known')).toHaveTextContent(
      /^알아낸 것: 지금 도금은 어떻게 하나요\? 직접 함$/,
    );
    // "아직 모르는 것"에도 없다(모든 단계 질문은 넣지 않는다).
    expect(screen.getByTestId('sales-step-unknown')).not.toHaveTextContent('누가 먼저');
  });

  // #740: 2주 날짜 단추를 없애 "2주를 센다"는 확인은 뺐다. 요일 붙이기는 고른 날짜 글에 그대로 쓴다.
  it('고른 날짜 글은 "11/20(금)"처럼 요일을 붙인다', () => {
    expect(quickDateLabel('2026-11-20')).toBe('11/20(금)');
  });
});

describe('기록 남기기 칸 (#691)', () => {
  it('종류는 "전화"로 시작하고, 저장 단추는 꼬리 질문·날짜·한 줄 메모 아래 맨 끝에 있다', async () => {
    const user = userEvent.setup();
    renderArea();
    expect(screen.getByTestId('records-kind')).toHaveValue('CALL');
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    const save = screen.getByTestId('records-contact-save-button');
    for (const id of ['sales-questions', 'sales-next-date-field', 'records-contact-memo']) {
      expect(before(screen.getByTestId(id), save)).toBe(true);
    }
    // 저장 단추 뒤에는 접힌 "단계 고치기"·"일정" 한 줄만 있다.
    expect(before(save, screen.getByTestId('records-stage-fix'))).toBe(true);
  });

  it('저장하면 그 자리(저장 단추 옆)에 "저장됨 21:15"가 남고 종류는 "전화" 그대로다', async () => {
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await user.click(screen.getByTestId('records-contact-save-button'));
    const saved = await screen.findByTestId('records-contact-saved');
    expect(saved).toHaveTextContent('저장됨 21:15');
    expect(saved.parentElement).toContainElement(screen.getByTestId('records-contact-save-button'));
    expect(screen.getByTestId('records-kind')).toHaveValue('CALL');
    // 다음 기록을 위해 결과와 고른 답은 비워진다.
    expect(screen.getByTestId('records-contact-result')).toHaveValue('');
  });
});

// #847(PM 결정 2026-11-17): "누가 먼저 연락했나요?"는 따로 고르는 칸이 아니라 종류 칸에 합쳤다.
// "전화 · 발신 / 전화 · 수신 / 메일 · 발신 / 메일 · 수신 / 대면 · 외근 / 대면 · 내방 / 메모". 보내는 답은 전과 같다.
const KIND_OPTIONS = [
  '전화 · 발신',
  '전화 · 수신',
  '메일 · 발신',
  '메일 · 수신',
  '대면 · 외근',
  '대면 · 내방',
  '메모',
];

describe('누가 먼저 연락했나 — 종류 칸에 합침 (#691 → #847)', () => {
  it('종류 칸 한 곳에서 고르고 기본 "전화 · 발신"이라 누르지 않아도 "우리가" 답이 실린다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    const kind = screen.getByTestId('records-kind');
    expect(
      within(kind)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(KIND_OPTIONS);
    expect(kind).toHaveValue('CALL');
    expect(screen.queryByTestId('records-contact-question-WHO_FIRST')).not.toBeInTheDocument();
    await setResult(user, '연결됨');
    // 꼬리 질문 묶음에는 없다.
    await screen.findByTestId('sales-questions');
    expect(screen.queryByTestId('sales-question-WHO_FIRST')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({
      method: 'CALL',
      result: 'REACHED',
      answers: [{ questionId: 'WHO_FIRST', answerId: 'OURS' }],
    });
  });

  it('걸려 온 전화는 "전화 · 수신"을 고르면 "상대가"로 저장되고, 저장 뒤에는 다시 "전화 · 발신"으로 돌아온다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await user.selectOptions(screen.getByTestId('records-kind'), '전화 · 수신');
    await setResult(user, '연결됨');
    await pick(user, 'PLATING_NOW', '직접 함');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ method: 'CALL' });
    expect(sentBody().answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'THEIRS' },
      { questionId: 'PLATING_NOW', answerId: 'IN_HOUSE' },
    ]);
    await waitFor(() => expect(screen.getByTestId('records-kind')).toHaveValue('CALL'));
  });

  it('부재로 끝난 접촉에도 이 답 하나는 실린다(다른 꼬리 질문은 없다)', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await setResult(user, '부재');
    expect(screen.queryByTestId('sales-questions')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ result: 'ABSENT' });
    expect(sentBody().answers).toEqual([{ questionId: 'WHO_FIRST', answerId: 'OURS' }]);
  });

  it('"대면 · 내방"은 방법 VISIT + "상대가"로 보낸다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '대면 · 내방' });
    await user.selectOptions(screen.getByTestId('records-kind'), '대면 · 내방');
    expect(screen.getByTestId('records-kind')).toHaveValue('VISIT:THEIRS');
    await setResult(user, '부재');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ method: 'VISIT' });
    expect(sentBody().answers).toEqual([{ questionId: 'WHO_FIRST', answerId: 'THEIRS' }]);
  });

  it('"메모"를 고르면 결과·날짜 대신 글 칸이 나온다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await user.selectOptions(screen.getByTestId('records-kind'), '메모');
    expect(screen.queryByTestId('records-contact-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-note-input')).toBeInTheDocument();
  });
});

describe('다음 일정: 펼쳐진 달력에서 바로 고르고 [없음]으로 지나가기 (#691·#740)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('"다음 할 일"을 고르면 이번 달 달력이 펼쳐져 있고, 날짜를 누르면 그 날짜로 일정이 실린다', async () => {
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    const today = todayKst();
    const day = addDays(today, 7);
    const field = screen.getByTestId('sales-next-date-field');
    // 달력을 눌러 열지 않아도 이번 달이 펼쳐져 있고, 2주 단추·"다른 날짜" 칸은 없다.
    expect(screen.getByTestId('sales-next-quick')).toHaveAttribute('data-month', today.slice(0, 7));
    expect(screen.getByTestId(`sales-next-quick-day-${today}`)).toHaveAccessibleName(/오늘$/);
    expect(within(field).queryByText('다른 날짜')).not.toBeInTheDocument();
    await pickCalendarDate(user, 'sales-next-quick', day);
    expect(screen.getByTestId(`sales-next-quick-day-${day}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('sales-next-quick-picked')).toHaveTextContent(
      `고른 날짜: ${quickDateLabel(day)}`,
    );
    expect(screen.getByTestId('records-next-date-preview')).toHaveTextContent(
      '견적(으)로 잡힙니다',
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ nextScheduleAt: day, nextScheduleNote: '견적' });
  });

  it('다음 달 날짜는 달력의 [다음 달]로 넘겨 고른다', async () => {
    // 오늘을 2099-10-20(한국 시간)으로 둔다. 날짜 계산만 바꾸고 다른 시계는 그대로다.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2099-10-20T03:00:00Z') });
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    await user.click(screen.getByTestId('sales-next-quick-next'));
    await user.click(screen.getByTestId('sales-next-quick-day-2099-11-20'));
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ nextScheduleAt: '2099-11-20', nextScheduleNote: '견적' });
  });

  it('오늘보다 앞 날짜는 달력에서 눌러도 골라지지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2099-10-20T03:00:00Z') });
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    const past = screen.getByTestId('sales-next-quick-day-2099-10-19');
    expect(past).toBeDisabled();
    await user.click(past);
    expect(past).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-next-quick-prev')).toBeDisabled();
    expect(screen.getByTestId('sales-next-quick-day-2099-10-20')).toBeEnabled();
  });

  it('[없음]을 누르면 고른 날짜가 비고 "다음 일정은 잡지 않습니다"라고 알리며 일정 없이 저장된다', async () => {
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    const day = addDays(todayKst(), 3);
    await pickCalendarDate(user, 'sales-next-quick', day);
    await user.click(screen.getByTestId('sales-next-quick-none'));
    expect(screen.getByTestId('sales-next-quick-none')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`sales-next-quick-day-${day}`)).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('sales-next-quick-picked')).not.toHaveTextContent('고른 날짜');
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-next-none-preview')).toHaveTextContent(
      /^다음 일정은 잡지 않습니다\.$/,
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).not.toHaveProperty('nextScheduleAt');
    expect(sentBody()).not.toHaveProperty('nextScheduleNote');
  });

  it('[없음]이어도 있던 일정은 그대로 실어 보내고(#683 규칙), 그렇게 된다고 미리 알린다', async () => {
    const user = userEvent.setup();
    renderArea({}, outcome({ nextScheduleAt: '2099-12-01', nextScheduleNote: '방문' }));
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '다시 연락');
    await user.click(screen.getByTestId('sales-next-quick-none'));
    expect(screen.getByTestId('records-next-none-preview')).toHaveTextContent(
      '다음 일정은 잡지 않습니다. 지금 일정 12/1 방문은(는) 그대로 둡니다.',
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ nextScheduleAt: '2099-12-01', nextScheduleNote: '방문' });
  });

  it('[없음] 뒤에 날짜를 고르면 [없음]이 풀린다', async () => {
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    await pick(user, 'NEXT_ACTION', '견적');
    await user.click(screen.getByTestId('sales-next-quick-none'));
    const day = addDays(todayKst(), 1);
    await pickCalendarDate(user, 'sales-next-quick', day);
    expect(screen.getByTestId('sales-next-quick-none')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('records-next-none-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-next-date-preview')).toBeInTheDocument();
  });
});

describe('통화 없이 일정만 잡기 (#691)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[일정 잡기]를 열면 종류와 날짜를 고르고, 종류의 쉬운 말이 내용으로 채워져 접촉 없이 일정만 저장된다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await user.click(screen.getByTestId('records-schedule-toggle'));
    const kinds = screen.getAllByTestId('records-schedule-kind').map((item) => item.textContent);
    // 대면·전화·메일 + 질문 파일 "다음 할 일"의 끝이 아닌 보기. #847: "방문" → "대면".
    expect(kinds).toEqual(['대면', '전화', '메일', '자료 보내기', '견적', '다시 연락']);
    await user.click(screen.getByRole('button', { name: '대면' }));
    expect(screen.getByTestId('records-schedule-note')).toHaveValue('대면');
    const day = addDays(todayKst(), 5);
    await pickCalendarDate(user, 'records-schedule-quick', day);
    await user.click(screen.getByTestId('records-schedule-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body).toMatchObject({
      status: 'IN_PROGRESS',
      nextScheduleAt: day,
      nextScheduleNote: '대면',
    });
    // 통화 기록이 아니다: 접촉 방법·결과·답이 없다.
    for (const key of ['method', 'result', 'attemptedAt', 'answers']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  // #740(PM 세션 결정 2026-11-14): 전에는 이 칸의 "다른 날짜"로 지난 날짜도 넣을 수 있었다. 이제 꼬리 질문과 같이 막는다.
  it('일정만 잡기 달력에서도 오늘보다 앞 날짜는 눌리지 않고 이전 달로 넘어가지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2099-11-10T03:00:00Z') });
    const user = userEvent.setup();
    renderArea();
    await user.click(screen.getByTestId('records-schedule-toggle'));
    const past = screen.getByTestId('records-schedule-quick-day-2099-11-09');
    expect(past).toBeDisabled();
    await user.click(past);
    expect(past).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('records-schedule-quick-prev')).toBeDisabled();
    expect(screen.getByTestId('records-schedule-quick-day-2099-11-10')).toBeEnabled();
    expect(screen.getByTestId('records-schedule-save-button')).toBeDisabled();
  });

  it('채워진 내용은 고쳐 쓸 수 있고, 날짜를 안 고르면 저장할 수 없다', async () => {
    // 오늘을 2099-11-01(한국 시간)으로 둬 달력이 2099년 11월을 펼치게 한다. 날짜 계산만 바꾼다.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2099-11-01T03:00:00Z') });
    const user = userEvent.setup();
    renderArea();
    await user.click(screen.getByTestId('records-schedule-toggle'));
    await user.click(screen.getByRole('button', { name: '대면' }));
    expect(screen.getByTestId('records-schedule-save-button')).toBeDisabled();
    fireEvent.change(screen.getByTestId('records-schedule-note'), {
      target: { value: '방문 · 샘플 들고 감' },
    });
    await pickCalendarDate(user, 'records-schedule-quick', '2099-11-20');
    await user.click(screen.getByTestId('records-schedule-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({
      nextScheduleAt: '2099-11-20',
      nextScheduleNote: '방문 · 샘플 들고 감',
    });
  });
});

describe('이미 확정된 공정·산업은 다시 묻지 않는다 (#691)', () => {
  const CONFIRMED: ChoiceMarks = {
    process: { ZINC_PLATING: 'CONFIRMED', ANODIZING: 'AI' },
    industries: [],
    industriesSource: null,
  };

  // #719 (PM 결정 2026-11-14): [바꾸기] 단계를 없앴다. "공정: 아연도금" 줄과 지금 값이 고른 채로 보인다.
  it('"공정: 아연도금" 한 줄과 지금 값이 고른 채로 보이고, 건드리지 않고 저장하면 그 질문의 답을 보내지 않는다', async () => {
    const user = userEvent.setup();
    const onCompanyConfirmed = vi.fn();
    renderArea({ choiceMarks: CONFIRMED, onCompanyConfirmed });
    await setResult(user, '연결됨');
    const line = await screen.findByTestId('sales-choice-confirmed-CONFIRM_PROCESS');
    expect(line).toHaveTextContent(/^공정: 아연도금$/);
    expect(screen.queryByTestId('sales-choice-change-CONFIRM_PROCESS')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-choice-CONFIRM_PROCESS-ZINC_PLATING')).toBeChecked();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    // 누가 먼저 연락했나만 실린다. 공정 답이 없으니 남은 AI 제안은 그대로다.
    expect(sentBody().answers).toEqual([{ questionId: 'WHO_FIRST', answerId: 'OURS' }]);
    expect(onCompanyConfirmed).not.toHaveBeenCalled();
  });

  it('다른 공정을 한 번 누르면 "변경됨"이 보이고, 다시 눌러 되돌리면 답을 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderArea({ choiceMarks: CONFIRMED });
    await setResult(user, '연결됨');
    await user.click(await screen.findByTestId('sales-choice-CONFIRM_PROCESS-ANODIZING'));
    expect(screen.getByTestId('sales-choice-changed-CONFIRM_PROCESS')).toHaveTextContent(
      /^변경됨: 아연도금 → 아연도금, 아노다이징$/,
    );
    await user.click(screen.getByTestId('sales-choice-CONFIRM_PROCESS-ANODIZING'));
    expect(screen.queryByTestId('sales-choice-changed-CONFIRM_PROCESS')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-choice-confirmed-CONFIRM_PROCESS')).toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody().answers).toEqual([{ questionId: 'WHO_FIRST', answerId: 'OURS' }]);
  });

  it('확정된 값이 없으면(AI 제안뿐) 전처럼 질문과 고르기가 바로 보인다', async () => {
    const user = userEvent.setup();
    renderArea({
      choiceMarks: { process: { ANODIZING: 'AI' }, industries: [], industriesSource: null },
    });
    await setResult(user, '연결됨');
    await screen.findByTestId('sales-choice-CONFIRM_PROCESS-ANODIZING');
    expect(screen.queryByTestId('sales-choice-confirmed-CONFIRM_PROCESS')).not.toBeInTheDocument();
  });
});

describe('접촉 결과가 "거절"이면 바로 마무리 (#691)', () => {
  it('"어떻게 할까요?" 한 번 + "거절 이유는?"으로 끝나고, "끝 → 거절 → 가격" 답을 대신 실어 보낸다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('LOST'));
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await setResult(user, '거절');
    const decline = screen.getByTestId('records-decline');
    expect(decline).toHaveTextContent('어떻게 할까요?');
    expect(
      within(decline)
        .getAllByRole('radio')
        .map((item) => item.closest('label')?.textContent),
    ).toEqual(['거절로 마무리', '보류 · 나중에 다시', '아직 끝 아님 · 다시 연락']);
    // "다음 할 일"·"어떻게 끝났나요?"는 묻지 않는다.
    expect(screen.queryByTestId('sales-question-NEXT_ACTION')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sales-question-CLOSE_RESULT')).not.toBeInTheDocument();
    await user.click(within(decline).getByText('거절로 마무리'));
    expect(screen.queryByTestId('sales-question-CLOSE_RESULT')).not.toBeInTheDocument();
    // 이유를 고르기 전에는 저장할 수 없다(기존 규칙).
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
    await pick(user, 'LOST_REASON', '가격');
    expect(screen.getByTestId('records-close-preview')).toHaveTextContent("'거절 · 가격'");
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({
      status: 'LOST',
      result: 'DECLINED',
      lostReasonCode: 'PRICE',
      answers: [
        { questionId: 'WHO_FIRST', answerId: 'OURS' },
        { questionId: 'NEXT_ACTION', answerId: 'END' },
        { questionId: 'CLOSE_RESULT', answerId: 'LOST' },
        { questionId: 'LOST_REASON', answerId: 'PRICE' },
      ],
    });
  });

  it('"아직 끝 아님 · 다시 연락"이면 "끝"이 빠진 다음 할 일과 날짜를 묻고, 마무리 답은 보내지 않는다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await setResult(user, '거절');
    await user.click(
      within(screen.getByTestId('records-decline')).getByText('아직 끝 아님 · 다시 연락'),
    );
    const next = await screen.findByTestId('sales-question-NEXT_ACTION');
    expect(within(next).queryByText('끝')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-questions-step')).toHaveTextContent(
      '거절이지만 끝이 아니라면 다음 할 일과 날짜를 골라 주세요.',
    );
    await pick(user, 'NEXT_ACTION', '다시 연락');
    const day = addDays(todayKst(), 6);
    await pickCalendarDate(user, 'sales-next-quick', day);
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({
      status: 'IN_PROGRESS',
      result: 'DECLINED',
      nextScheduleAt: day,
      nextScheduleNote: '다시 연락',
    });
    expect(sentBody().answers).toEqual([
      { questionId: 'WHO_FIRST', answerId: 'OURS' },
      { questionId: 'NEXT_ACTION', answerId: 'RECONTACT' },
    ]);
  });

  it('아무것도 고르지 않으면 "저장해도 단계는 바뀌지 않는다"고 저장 전에 알리고, 접촉만 저장된다', async () => {
    const user = userEvent.setup();
    renderArea();
    await screen.findByRole('option', { name: '전화 · 수신' });
    await setResult(user, '거절');
    expect(screen.getByTestId('records-decline-unpicked')).toHaveTextContent(
      '이대로 저장하면 접촉만 남고 영업 단계는 바뀌지 않습니다.',
    );
    await user.click(within(screen.getByTestId('records-decline')).getByText('보류 · 나중에 다시'));
    expect(screen.queryByTestId('records-decline-unpicked')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-close-preview')).toHaveTextContent("'보류'");
    // 결과를 다시 고르면 선택과 대신 실은 답이 비워진다.
    await setResult(user, '연결됨');
    await setResult(user, '거절');
    expect(screen.getByTestId('records-decline-unpicked')).toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ status: 'IN_PROGRESS', result: 'DECLINED' });
    expect(sentBody().answers).toEqual([{ questionId: 'WHO_FIRST', answerId: 'OURS' }]);
  });

  it('결과가 "연결됨"이면 "어떻게 할까요?"는 없고 전처럼 "다음 할 일 → 끝 → 어떻게 끝났나요?"로 묻는다', async () => {
    const user = userEvent.setup();
    renderArea();
    await setResult(user, '연결됨');
    expect(screen.queryByTestId('records-decline')).not.toBeInTheDocument();
    await pick(user, 'NEXT_ACTION', '끝');
    expect(await screen.findByTestId('sales-question-CLOSE_RESULT')).toHaveTextContent('성사');
  });
});
