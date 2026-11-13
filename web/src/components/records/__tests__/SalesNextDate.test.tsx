// #683(PM 결정 2026-11-13): 꼬리 질문 "다음 할 일은?"에서 끝이 아닌 할 일을 고르면 날짜를 이어서 묻고,
// 접촉 저장과 같은 요청에 다음 일정(날짜 + 고른 할 일의 쉬운 말)을 싣는다. 따로 있는 "다음 일정" 칸은 접어 둔다.
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { nextActionPick, visibleQuestions } from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type { OutcomeRecord, SalesQuestions, SalesStepView } from '../../../api/types';
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
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      answers: [
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
        { answerId: 'ON_HOLD', label: '보류 · 나중에 다시', closes: 'ON_HOLD' },
      ],
    },
  ],
};

const STEP: SalesStepView = {
  code: 'REACHED',
  since: '2026-11-10',
  overridden: false,
  known: [],
  openQuestions: ['PLATING_NOW', 'NEXT_ACTION'],
};

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

// 오늘보다 뒤인 날짜와 지난 날짜. 시험이 오늘 날짜에 기대지 않게 멀리 잡는다.
const FUTURE = '2099-11-20';
const PAST = '2020-01-01';

function outcome(partial: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    version: 1,
    updatedBy: 'park-lee',
    updatedAt: '2026-11-10T00:00:00Z',
    status: 'IN_PROGRESS',
    ...partial,
  };
}

function reply() {
  return {
    data: {
      version: 2,
      updatedBy: 'park-lee',
      updatedAt: '2026-11-13T01:00:00Z',
      status: 'IN_PROGRESS' as const,
    },
    meta: {},
  };
}

function renderArea(current: OutcomeRecord = outcome()) {
  const onOutcomeSaved = vi.fn();
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea
        oppId="opp-1"
        salesStep={STEP}
        outcome={current}
        onOutcomeSaved={onOutcomeSaved}
      />
    </FrameContext.Provider>,
  );
  return { onOutcomeSaved };
}

async function startCall(user: ReturnType<typeof userEvent.setup>, result = '연결됨') {
  await user.selectOptions(screen.getByTestId('records-kind'), '전화');
  await user.selectOptions(screen.getByTestId('records-contact-result'), result);
}

async function pick(user: ReturnType<typeof userEvent.setup>, questionId: string, label: string) {
  const question = await screen.findByTestId(`sales-question-${questionId}`);
  await user.click(within(question).getByText(label));
}

function shown(picked: Record<string, string>) {
  return visibleQuestions(QUESTIONS, STEP, picked);
}

describe('"다음 할 일" 읽기 (#683)', () => {
  it('끝이 아닌 할 일을 골랐을 때만 그 할 일의 쉬운 말을 돌려준다', () => {
    expect(nextActionPick(QUESTIONS, shown({}), {})).toBeNull();
    const quote = { NEXT_ACTION: 'QUOTE' };
    expect(nextActionPick(QUESTIONS, shown(quote), quote)).toEqual({
      questionId: 'NEXT_ACTION',
      label: '견적',
    });
    const end = { NEXT_ACTION: 'END' };
    expect(nextActionPick(QUESTIONS, shown(end), end)).toBeNull();
    // 마무리 질문을 여는 질문이 아니면(다른 질문의 답) 날짜를 묻지 않는다.
    const other = { PLATING_NOW: 'IN_HOUSE' };
    expect(nextActionPick(QUESTIONS, shown(other), other)).toBeNull();
  });
});

describe('꼬리 질문에서 다음 일정까지 잡는다 (#683)', () => {
  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('할 일을 고르면 "언제 할까요?" 날짜 칸이 그 질문 바로 아래에 보이고, 고르기 전과 "끝"에서는 없다', async () => {
    const user = userEvent.setup();
    renderArea();
    await startCall(user);
    await screen.findByTestId('sales-question-NEXT_ACTION');
    expect(screen.queryByTestId('sales-next-date')).not.toBeInTheDocument();

    await pick(user, 'NEXT_ACTION', '견적');
    const question = screen.getByTestId('sales-question-NEXT_ACTION');
    expect(within(question).getByTestId('sales-next-date-field')).toHaveTextContent('언제 할까요?');
    expect(within(question).getByTestId('sales-next-date')).toHaveAttribute('type', 'date');
    // 날짜는 선택 사항이라 비워 둬도 저장 단추는 켜져 있고, 미리 알림은 없다.
    expect(screen.getByTestId('records-contact-save-button')).toBeEnabled();
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();

    await pick(user, 'NEXT_ACTION', '끝');
    expect(screen.queryByTestId('sales-next-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-question-CLOSE_RESULT')).toBeInTheDocument();
  });

  it('날짜를 넣으면 "저장하면 다음 일정이 11/20 견적(으)로 잡힙니다."라고 미리 알린다', async () => {
    const user = userEvent.setup();
    renderArea();
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    fireEvent.change(screen.getByTestId('sales-next-date'), { target: { value: FUTURE } });
    expect(screen.getByTestId('records-next-date-preview')).toHaveTextContent(
      '저장하면 다음 일정이 11/20 견적(으)로 잡힙니다.',
    );
    // 할 일을 바꾸면 미리 알림의 내용도 따라 바뀐다.
    await pick(user, 'NEXT_ACTION', '다시 연락');
    expect(screen.getByTestId('records-next-date-preview')).toHaveTextContent(
      '저장하면 다음 일정이 11/20 다시 연락(으)로 잡힙니다.',
    );
  });

  it('날짜를 넣고 저장하면 접촉과 같은 요청 하나에 다음 일정(날짜 + 고른 할 일)이 실린다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    const { onOutcomeSaved } = renderArea(
      outcome({ nextScheduleAt: '2099-10-01', nextScheduleNote: '자료 회신 확인' }),
    );
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    fireEvent.change(screen.getByTestId('sales-next-date'), { target: { value: FUTURE } });
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(postOutcome).mock.calls[0];
    expect(body).toMatchObject({
      status: 'IN_PROGRESS',
      method: 'CALL',
      result: 'REACHED',
      answers: [{ questionId: 'NEXT_ACTION', answerId: 'QUOTE' }],
      nextScheduleAt: FUTURE,
      nextScheduleNote: '견적',
    });
    // 저장 뒤: 상세 맨 위가 읽는 값과 접힌 일정 줄이 새 일정으로 바뀌고, 날짜 칸은 비워진다.
    await waitFor(() =>
      expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
        '지금 일정: 11/20 견적',
      ),
    );
    expect(onOutcomeSaved).toHaveBeenCalledWith(
      expect.objectContaining({ nextScheduleAt: FUTURE, nextScheduleNote: '견적' }),
    );
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();
  });

  it('날짜를 안 넣고 저장하면 있던 일정을 그대로 실어 보내 지워지지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    renderArea(outcome({ nextScheduleAt: '2099-10-01', nextScheduleNote: '자료 회신 확인' }));
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      answers: [{ questionId: 'NEXT_ACTION', answerId: 'QUOTE' }],
      nextScheduleAt: '2099-10-01',
      nextScheduleNote: '자료 회신 확인',
    });
    await waitFor(() =>
      expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
        '지금 일정: 10/1 자료 회신 확인',
      ),
    );
  });

  it('일정이 없던 회사에서 날짜를 안 넣으면 요청에 일정 칸이 아예 없다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    renderArea();
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    const [, body] = vi.mocked(postOutcome).mock.calls[0];
    expect(body).not.toHaveProperty('nextScheduleAt');
    expect(body).not.toHaveProperty('nextScheduleNote');
  });

  it('날짜를 넣은 뒤 "끝"으로 바꾸면 그 날짜는 보내지 않고 있던 일정을 그대로 싣는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    renderArea(outcome({ nextScheduleAt: '2099-10-01', nextScheduleNote: '자료 회신 확인' }));
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    fireEvent.change(screen.getByTestId('sales-next-date'), { target: { value: FUTURE } });
    await pick(user, 'NEXT_ACTION', '끝');
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();
    await pick(user, 'CLOSE_RESULT', '보류 · 나중에 다시');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'ON_HOLD',
      nextScheduleAt: '2099-10-01',
      nextScheduleNote: '자료 회신 확인',
    });
  });

  it('지난 날짜를 넣으면 안내가 보이고 저장 단추가 꺼진다', async () => {
    const user = userEvent.setup();
    renderArea();
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '견적');
    fireEvent.change(screen.getByTestId('sales-next-date'), { target: { value: PAST } });
    expect(screen.getByTestId('records-next-date-error')).toHaveTextContent(
      '다음 일정은 오늘이나 그 뒤 날짜로 넣어 주세요.',
    );
    expect(screen.queryByTestId('records-next-date-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
    expect(postOutcome).not.toHaveBeenCalled();
  });

  it('접촉 결과가 부재면 꼬리 질문도 날짜 칸도 없고, 아래 접힌 일정 칸으로 잡는다', async () => {
    const user = userEvent.setup();
    renderArea();
    await startCall(user, '부재');
    expect(screen.queryByTestId('sales-questions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sales-next-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-schedule-toggle')).toBeInTheDocument();
  });
});

describe('따로 있는 "다음 일정" 칸은 접어 둔다 (#683)', () => {
  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('일정이 있으면 "지금 일정: 11/20 견적" 한 줄과 [일정만 바꾸기]만 보이고 입력 칸은 숨겨져 있다', () => {
    renderArea(outcome({ nextScheduleAt: FUTURE, nextScheduleNote: '견적' }));
    expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
      '지금 일정: 11/20 견적',
    );
    const toggle = screen.getByTestId('records-schedule-toggle');
    expect(toggle).toHaveTextContent('일정만 바꾸기');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const id of [
      'records-schedule-date',
      'records-schedule-note',
      'records-schedule-save-button',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it('일정이 없으면 "다음 일정 없음"과 [일정 잡기]가 보인다', () => {
    renderArea();
    expect(screen.getByTestId('records-schedule-current')).toHaveTextContent('다음 일정 없음');
    expect(screen.getByTestId('records-schedule-toggle')).toHaveTextContent('일정 잡기');
  });

  it('[일정만 바꾸기]를 누르면 지금 일정이 든 칸이 그 자리에서 펼쳐지고, 고쳐 저장하면 한 줄이 새 값으로 바뀐다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    renderArea(outcome({ nextScheduleAt: FUTURE, nextScheduleNote: '견적' }));
    await user.click(screen.getByTestId('records-schedule-toggle'));
    expect(screen.getByTestId('records-schedule-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('records-schedule-toggle')).toHaveTextContent('접기');
    expect(screen.getByTestId('records-schedule-date')).toHaveValue(FUTURE);
    expect(screen.getByTestId('records-schedule-note')).toHaveValue('견적');

    fireEvent.change(screen.getByTestId('records-schedule-date'), {
      target: { value: '2099-12-05' },
    });
    fireEvent.change(screen.getByTestId('records-schedule-note'), {
      target: { value: '견적 회신 확인' },
    });
    await user.click(screen.getByTestId('records-schedule-save-button'));
    await waitFor(() =>
      expect(postOutcome).toHaveBeenCalledWith(
        'opp-1',
        { status: 'IN_PROGRESS', nextScheduleAt: '2099-12-05', nextScheduleNote: '견적 회신 확인' },
        'park-lee',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
        '지금 일정: 12/5 견적 회신 확인',
      ),
    );
    expect(screen.getByTestId('records-schedule-saved')).toBeInTheDocument();

    // 다시 누르면 접힌다.
    await user.click(screen.getByTestId('records-schedule-toggle'));
    expect(screen.queryByTestId('records-schedule-date')).not.toBeInTheDocument();
    expect(screen.getByTestId('records-schedule-toggle')).toHaveTextContent('일정만 바꾸기');
  });

  it('꼬리 질문으로 잡은 일정이 펼친 칸에도 들어 있다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply());
    renderArea();
    await startCall(user);
    await pick(user, 'NEXT_ACTION', '다시 연락');
    fireEvent.change(screen.getByTestId('sales-next-date'), { target: { value: FUTURE } });
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() =>
      expect(screen.getByTestId('records-schedule-current')).toHaveTextContent(
        '지금 일정: 11/20 다시 연락',
      ),
    );
    await user.click(screen.getByTestId('records-schedule-toggle'));
    expect(screen.getByTestId('records-schedule-date')).toHaveValue(FUTURE);
    expect(screen.getByTestId('records-schedule-note')).toHaveValue('다시 연락');
  });
});
