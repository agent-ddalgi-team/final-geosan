// #643 마무리 꼬리 질문: "끝"을 고르면 "어떻게 끝났나요?"·"거절 이유는?"이 이어지고 그 답으로 단계가 정해진다.
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import { closingPick, visibleQuestions } from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type { OutcomeStatus, SalesQuestions, SalesStepView } from '../../../api/types';
import { recordsArea, salesQuestionTexts } from '../../../labels/ko';
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

function ids(picked: Record<string, string>, step = stepView(), allOnly = false) {
  return visibleQuestions(QUESTIONS, step, picked, allOnly).map((item) => item.questionId);
}

describe('마무리 질문 보이기 (#643)', () => {
  it('"끝"을 골라야 "어떻게 끝났나요?"가, "거절"을 골라야 "거절 이유는?"이 보인다', () => {
    expect(ids({})).toEqual(['PLATING_NOW', 'NEXT_ACTION']);
    expect(ids({ NEXT_ACTION: 'RECONTACT' })).toEqual(['PLATING_NOW', 'NEXT_ACTION']);
    expect(ids({ NEXT_ACTION: 'END' })).toEqual(['PLATING_NOW', 'NEXT_ACTION', 'CLOSE_RESULT']);
    expect(ids({ NEXT_ACTION: 'END', CLOSE_RESULT: 'WON' })).not.toContain('LOST_REASON');
    expect(ids({ NEXT_ACTION: 'END', CLOSE_RESULT: 'LOST' })).toContain('LOST_REASON');
  });

  it('지난 접촉의 "끝" 답이나 가려진 질문에 남은 선택으로는 열리지 않는다', () => {
    const before = stepView({
      known: [
        {
          questionId: 'NEXT_ACTION',
          question: '다음 할 일은?',
          answerId: 'END',
          answer: '끝',
          at: '2026-11-10',
          by: 'park-lee',
        },
      ],
    });
    expect(ids({}, before)).toEqual(['PLATING_NOW', 'NEXT_ACTION']);
    // "끝 → 거절 → 가격"을 골랐다가 "다시 연락"으로 바꾸면 꼬리 둘 다 닫히고 마무리 답도 없다.
    const stale = { NEXT_ACTION: 'RECONTACT', CLOSE_RESULT: 'LOST', LOST_REASON: 'PRICE' };
    expect(ids(stale)).toEqual(['PLATING_NOW', 'NEXT_ACTION']);
    expect(closingPick(visibleQuestions(QUESTIONS, stepView(), stale), stale)).toBeNull();
  });

  it('접촉 결과가 거절이면 "모든 단계" 질문과 그 꼬리만 보인다', () => {
    expect(ids({}, stepView(), true)).toEqual(['NEXT_ACTION']);
    expect(ids({ NEXT_ACTION: 'END', CLOSE_RESULT: 'LOST' }, stepView(), true)).toEqual([
      'NEXT_ACTION',
      'CLOSE_RESULT',
      'LOST_REASON',
    ]);
  });

  it('고른 마무리 답에서 단계와 거절 이유 코드를 읽는다', () => {
    const pick = (picked: Record<string, string>) =>
      closingPick(visibleQuestions(QUESTIONS, stepView(), picked), picked);
    expect(pick({ NEXT_ACTION: 'END' })).toBeNull();
    expect(pick({ NEXT_ACTION: 'END', CLOSE_RESULT: 'WON' })).toEqual({
      status: 'WON',
      lostReasonCode: null,
    });
    expect(pick({ NEXT_ACTION: 'END', CLOSE_RESULT: 'LOST' })).toEqual({
      status: 'LOST',
      lostReasonCode: null,
    });
    expect(pick({ NEXT_ACTION: 'END', CLOSE_RESULT: 'LOST', LOST_REASON: 'PRICE' })).toEqual({
      status: 'LOST',
      lostReasonCode: 'PRICE',
    });
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

function reply(status: OutcomeStatus) {
  return {
    data: { version: 2, updatedBy: 'park-lee', updatedAt: '2026-11-13T01:00:00Z', status },
    meta: {},
  };
}

function renderArea(status: OutcomeStatus = 'IN_PROGRESS') {
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea
        oppId="opp-1"
        salesStep={stepView()}
        outcome={{
          version: 1,
          updatedBy: 'park-lee',
          updatedAt: '2026-11-10T00:00:00Z',
          status,
        }}
      />
    </FrameContext.Provider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, questionId: string, label: string) {
  const question = await screen.findByTestId(`sales-question-${questionId}`);
  await user.click(within(question).getByText(label));
}

describe('마무리 답으로 단계를 저장한다 (#643)', () => {
  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('"끝 → 거절 → 가격"을 고르면 미리 알리고, 저장 뒤 현재 단계가 "거절 · 가격"이다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('LOST'));
    renderArea();
    // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
    fireEvent.click(screen.getByTestId('records-stage-toggle'));
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await pick(user, 'NEXT_ACTION', '끝');
    expect(screen.queryByTestId('records-close-preview')).not.toBeInTheDocument();
    await pick(user, 'CLOSE_RESULT', '거절');
    // 거절 이유를 고르기 전에는 저장할 수 없다.
    expect(screen.getByTestId('records-close-blocked')).toHaveTextContent(
      salesQuestionTexts.closeNeedsReason,
    );
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
    await pick(user, 'LOST_REASON', '가격');
    expect(screen.getByTestId('records-close-preview')).toHaveTextContent(
      "저장하면 영업 단계가 '거절 · 가격'(으)로 바뀝니다.",
    );
    expect(screen.queryByTestId('records-close-blocked')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    const body = vi.mocked(postOutcome).mock.calls[0][1];
    expect(body).toMatchObject({
      status: 'LOST',
      lostReasonCode: 'PRICE',
      method: 'CALL',
      result: 'REACHED',
      answers: [
        { questionId: 'NEXT_ACTION', answerId: 'END' },
        { questionId: 'CLOSE_RESULT', answerId: 'LOST' },
        { questionId: 'LOST_REASON', answerId: 'PRICE' },
      ],
    });
    expect(body).not.toHaveProperty('reason');
    await waitFor(() =>
      expect(screen.getByTestId('records-stage-current')).toHaveTextContent(
        '현재 단계: 거절 · 가격',
      ),
    );
    expect(screen.queryByTestId('records-close-preview')).not.toBeInTheDocument();
  });

  it('거절 이유가 기타면 한 줄 메모가 있어야 저장되고, 메모가 사유로도 간다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('LOST'));
    renderArea();
    await user.selectOptions(screen.getByTestId('records-kind'), '메일');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await pick(user, 'NEXT_ACTION', '끝');
    await pick(user, 'CLOSE_RESULT', '거절');
    await pick(user, 'LOST_REASON', '기타');
    expect(screen.getByTestId('records-close-blocked')).toHaveTextContent(
      salesQuestionTexts.closeOtherNeedsMemo,
    );
    expect(screen.getByTestId('records-contact-save-button')).toBeDisabled();
    await user.type(screen.getByTestId('records-contact-memo'), '내년 예산 없음(가상)');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'LOST',
      lostReasonCode: 'OTHER',
      reason: '내년 예산 없음(가상)',
      memo: '내년 예산 없음(가상)',
    });
  });

  it('접촉 결과가 거절이어도 "끝 → 보류"로 보류가 저장된다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('ON_HOLD'));
    renderArea();
    // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
    fireEvent.click(screen.getByTestId('records-stage-toggle'));
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '거절');
    await screen.findByTestId('sales-question-NEXT_ACTION');
    expect(screen.queryByTestId('sales-question-PLATING_NOW')).not.toBeInTheDocument();
    await pick(user, 'NEXT_ACTION', '끝');
    await pick(user, 'CLOSE_RESULT', '보류 · 나중에 다시');
    expect(screen.getByTestId('records-close-preview')).toHaveTextContent("'보류'");
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    const body = vi.mocked(postOutcome).mock.calls[0][1];
    expect(body).toMatchObject({
      status: 'ON_HOLD',
      result: 'DECLINED',
      answers: [
        { questionId: 'NEXT_ACTION', answerId: 'END' },
        { questionId: 'CLOSE_RESULT', answerId: 'ON_HOLD' },
      ],
    });
    expect(body).not.toHaveProperty('lostReasonCode');
    await waitFor(() =>
      expect(screen.getByTestId('records-stage-current')).toHaveTextContent('현재 단계: 보류'),
    );
  });

  it('"끝"을 "다시 연락"으로 바꾸면 가려진 마무리 답은 보내지 않고 단계도 그대로다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('IN_PROGRESS'));
    renderArea();
    await user.selectOptions(screen.getByTestId('records-kind'), '전화');
    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await pick(user, 'NEXT_ACTION', '끝');
    await pick(user, 'CLOSE_RESULT', '성사');
    await pick(user, 'NEXT_ACTION', '다시 연락');
    expect(screen.queryByTestId('records-close-preview')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      status: 'IN_PROGRESS',
      answers: [{ questionId: 'NEXT_ACTION', answerId: 'RECONTACT' }],
    });
    expect(vi.mocked(postOutcome).mock.calls[0][1].answers).toHaveLength(1);
  });

  it('영업 단계 칸에는 "잘못됐을 때만 고치세요" 안내가 보이고 직접 고르는 길은 그대로다', async () => {
    const user = userEvent.setup();
    vi.mocked(postOutcome).mockResolvedValueOnce(reply('ON_HOLD'));
    renderArea('WON');
    // 영업 단계 칸은 기본으로 접혀 있다(#674). [단계 고치기]를 눌러 펼친다.
    fireEvent.click(screen.getByTestId('records-stage-toggle'));
    expect(screen.getByTestId('records-stage-auto-hint')).toHaveTextContent(
      '단계는 꼬리 질문 답에 따라 저절로 저장됩니다. 잘못됐을 때만 여기서 고치세요.',
    );
    expect(recordsArea.stageAutoHint).toContain('잘못됐을 때만');
    await user.selectOptions(screen.getByTestId('records-stage-select'), '보류');
    await user.click(screen.getByTestId('records-stage-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({ status: 'ON_HOLD' });
  });
});
