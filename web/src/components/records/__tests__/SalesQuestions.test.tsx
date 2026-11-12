// #607 꼬리 질문: 보일 질문 고르기, 요약, 접촉 저장에 답·한 줄 메모 싣기, [단계 고치기].
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { SalesStepSummary, visibleQuestions } from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type { SalesQuestions, SalesStepView } from '../../../api/types';
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
      questionId: 'WHO_TALKED',
      text: '누구와 이야기했나요?',
      step: 'NOT_REACHED',
      answers: [
        { answerId: 'RIGHT_PERSON', label: '담당 부서', reaches: 'REACHED' },
        { answerId: 'OTHER_DEPT', label: '다른 부서' },
      ],
    },
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
      questionId: 'SWITCH_INTENT',
      text: '외주처를 바꿀 생각이 있나요?',
      step: 'DEMAND_CONFIRMED',
      showWhen: { answers: { PLATING_NOW: ['OUTSOURCED'] } },
      answers: [
        { answerId: 'YES', label: '있음' },
        { answerId: 'NOT_NOW', label: '지금은 없음' },
      ],
    },
    {
      questionId: 'NEXT_ACTION',
      text: '다음 할 일은?',
      step: 'ALL',
      answers: [
        { answerId: 'RECONTACT', label: '다시 연락' },
        { answerId: 'END', label: '끝' },
      ],
    },
  ],
};

function stepView(partial: Partial<SalesStepView> = {}): SalesStepView {
  return {
    code: 'REACHED',
    since: '2026-11-10',
    overridden: false,
    known: [],
    openQuestions: ['PLATING_NOW', 'NEXT_ACTION'],
    ...partial,
  };
}

const ids = (list: { questionId: string }[]) => list.map((item) => item.questionId);

describe('보일 꼬리 질문 고르기 (#607)', () => {
  it('첫 접촉이면 연결 전 질문과 모든 단계 질문만 보인다', () => {
    expect(ids(visibleQuestions(QUESTIONS, null, {}))).toEqual(['WHO_TALKED', 'NEXT_ACTION']);
  });

  it('지금 고른 답이 단계를 넘기면 다음 단계 질문과 꼬리 질문이 바로 펼쳐진다', () => {
    const picked = { PLATING_NOW: 'OUTSOURCED' };
    expect(ids(visibleQuestions(QUESTIONS, stepView(), picked))).toEqual([
      'PLATING_NOW',
      'SWITCH_INTENT',
      'NEXT_ACTION',
    ]);
    expect(ids(visibleQuestions(QUESTIONS, stepView(), { PLATING_NOW: 'IN_HOUSE' }))).toEqual([
      'PLATING_NOW',
      'NEXT_ACTION',
    ]);
  });

  it('이미 답한 질문은 다시 묻지 않지만 지난 답으로 꼬리 질문은 열린다', () => {
    const step = stepView({
      code: 'DEMAND_CONFIRMED',
      known: [
        {
          questionId: 'PLATING_NOW',
          question: '지금 도금은 어떻게 하나요?',
          answerId: 'OUTSOURCED',
          answer: '외주 줌',
          at: '2026-11-10',
          by: 'park-lee',
        },
      ],
    });
    expect(ids(visibleQuestions(QUESTIONS, step, {}))).toEqual(['SWITCH_INTENT', 'NEXT_ACTION']);
  });
});

describe('세부 단계 요약 (#607)', () => {
  it('큰 단계 · 세부 단계(날짜부터), 알아낸 것, 아직 모르는 것을 보인다', () => {
    render(
      <SalesStepSummary
        step={stepView({
          known: [
            {
              questionId: 'WHO_TALKED',
              question: '누구와 이야기했나요?',
              answerId: 'RIGHT_PERSON',
              answer: '담당 부서',
              at: '2026-11-10',
              by: 'park-lee',
            },
          ],
        })}
        status="IN_PROGRESS"
        questions={QUESTIONS}
      />,
    );
    expect(screen.getByTestId('sales-step-current')).toHaveTextContent('접촉 · 연결됨 (11/10부터)');
    expect(screen.getByTestId('sales-step-known')).toHaveTextContent(
      '알아낸 것: 누구와 이야기했나요? 담당 부서',
    );
    expect(screen.getByTestId('sales-step-unknown')).toHaveTextContent(
      '아직 모르는 것: 지금 도금은 어떻게 하나요?',
    );
  });

  it('보류·성사·거절이면 세부 단계가 없다고 알린다', () => {
    render(
      <SalesStepSummary
        step={stepView({ code: null, openQuestions: [] })}
        status="WON"
        questions={QUESTIONS}
      />,
    );
    expect(screen.getByTestId('sales-step-current')).toHaveTextContent('세부 단계가 없습니다');
  });
});

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

function reply(status: 'IN_PROGRESS' | 'SAMPLE_OR_REGISTRATION_APPROVED') {
  return {
    data: { version: 2, updatedBy: 'park-lee', updatedAt: '2026-11-12T01:00:00Z', status },
    meta: {},
  };
}

describe('접촉 기록에 꼬리 질문 답과 한 줄 메모를 싣는다 (#607)', () => {
  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('연결됨을 고르면 질문이 보이고, 고른 답과 한 줄 메모를 코드로 보낸 뒤 비운다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('IN_PROGRESS'));
    const onSalesStepChanged = vi.fn();
    render(
      <FrameContext.Provider value={frame}>
        <RecordsArea
          oppId="opp-1"
          salesStep={stepView()}
          outcome={{
            version: 1,
            updatedBy: 'park-lee',
            updatedAt: '2026-11-10T00:00:00Z',
            status: 'IN_PROGRESS',
          }}
          onSalesStepChanged={onSalesStepChanged}
        />
      </FrameContext.Provider>,
    );
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    expect(screen.queryByTestId('sales-questions')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    const plating = await screen.findByTestId('sales-question-PLATING_NOW');
    await user.click(within(plating).getByText('외주 줌'));
    const tail = await screen.findByTestId('sales-question-SWITCH_INTENT');
    await user.click(within(tail).getByText('있음'));
    await user.type(screen.getByTestId('records-contact-memo'), '다음 달 새 라인');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'IN_PROGRESS',
      method: 'CALL',
      result: 'REACHED',
      memo: '다음 달 새 라인',
      answers: [
        { questionId: 'PLATING_NOW', answerId: 'OUTSOURCED' },
        { questionId: 'SWITCH_INTENT', answerId: 'YES' },
      ],
    });
    await waitFor(() => expect(onSalesStepChanged).toHaveBeenCalledTimes(1));
    // 저장하면 결과·답·메모를 비운다. 다시 연결됨을 고르면 빈 칸에서 시작한다.
    expect(screen.queryByTestId('records-contact-memo')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    expect(screen.getByTestId('records-contact-memo')).toHaveValue('');
    expect(
      within(await screen.findByTestId('sales-question-PLATING_NOW')).getByLabelText('외주 줌'),
    ).not.toBeChecked();
  });

  it('부재면 질문을 보이지 않고 답을 보내지 않는다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('IN_PROGRESS'));
    render(
      <FrameContext.Provider value={frame}>
        <RecordsArea oppId="opp-1" salesStep={stepView()} />
      </FrameContext.Provider>,
    );
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '부재');
    expect(screen.queryByTestId('sales-questions')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).not.toHaveProperty('answers');
  });

  it('[단계 고치기]는 고른 세부 단계를 지금 큰 단계와 함께 보낸다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('IN_PROGRESS'));
    const onSalesStepChanged = vi.fn();
    render(
      <FrameContext.Provider value={frame}>
        <RecordsArea
          oppId="opp-1"
          salesStep={stepView({ code: 'DEMAND_CONFIRMED' })}
          outcome={{
            version: 1,
            updatedBy: 'park-lee',
            updatedAt: '2026-11-10T00:00:00Z',
            status: 'IN_PROGRESS',
          }}
          onSalesStepChanged={onSalesStepChanged}
        />
      </FrameContext.Provider>,
    );
    await user.selectOptions(screen.getByTestId('records-step-override'), '연결됨');
    await user.click(screen.getByTestId('records-step-override-save'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'IN_PROGRESS',
      stepOverride: 'REACHED',
    });
    expect(vi.mocked(postOutcome).mock.calls[0][1]).not.toHaveProperty('method');
    await waitFor(() => expect(onSalesStepChanged).toHaveBeenCalledTimes(1));
  });
});
