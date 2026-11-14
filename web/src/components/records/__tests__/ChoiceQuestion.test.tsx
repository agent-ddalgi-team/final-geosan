// #652 꼬리 질문의 공정·산업 확인: 여러 개 고르기, AI 제안·확정 표시, 저장 전 미리 알림, 보내는 답.
// 서버 호출(getSalesQuestions·postOutcome)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsArea from '../RecordsArea';
import {
  KEEP_CHOICE,
  UNKNOWN_CHOICE,
  choiceAnswerIds,
  choiceMarksOf,
  choicePreview,
} from '../ChoiceQuestion';
import type { ChoiceMarks } from '../ChoiceQuestion';
import { SalesStepSummary, visibleQuestions } from '../SalesQuestions';
import { getSalesQuestions, postOutcome } from '../../../api/client';
import type {
  OpportunityDetail,
  SalesQuestion,
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

const PROCESS: SalesQuestion = {
  questionId: 'CONFIRM_PROCESS',
  text: '어떤 공정을 맡길 수 있나요?',
  step: 'REACHED',
  choices: 'PROCESS',
  answers: [
    { answerId: 'ZINC_PLATING', label: '아연도금' },
    { answerId: 'ANODIZING', label: '아노다이징' },
    { answerId: 'CHROMATE', label: '크로메이트' },
    { answerId: 'PASSIVATION', label: '부동태' },
  ],
};
const INDUSTRY: SalesQuestion = {
  questionId: 'CONFIRM_INDUSTRY',
  text: '어느 산업인가요?',
  step: 'REACHED',
  choices: 'INDUSTRY',
  answers: ['방위산업', '반도체', '자동차 부품', '기계·설비'].map((name) => ({
    answerId: name,
    label: name,
  })),
};
const QUESTIONS: SalesQuestions = {
  version: 1,
  steps: [
    { code: 'NOT_REACHED', label: '연결 전', stage: 'IN_PROGRESS' },
    { code: 'REACHED', label: '연결됨', stage: 'IN_PROGRESS' },
    { code: 'DEMAND_CONFIRMED', label: '수요 확인', stage: 'IN_PROGRESS' },
    { code: 'MATERIAL_QUOTE', label: '자료·견적', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
    { code: 'VISIT_SAMPLE', label: '방문·샘플', stage: 'SAMPLE_OR_REGISTRATION_APPROVED' },
  ],
  questions: [PROCESS, INDUSTRY],
};

/** AI가 공정 3개(아연도금·아노다이징·크로메이트)와 산업군 2개를 제안한 회사. */
const AI_ONLY: ChoiceMarks = {
  process: { ZINC_PLATING: 'AI', ANODIZING: 'AI', CHROMATE: 'AI' },
  industries: ['반도체', '기계·설비'],
  industriesSource: 'AI',
};

const STEP: SalesStepView = {
  code: 'REACHED',
  since: '2026-11-10',
  overridden: false,
  known: [],
  openQuestions: ['CONFIRM_PROCESS', 'CONFIRM_INDUSTRY'],
};

const frame: FrameValue = {
  config: null,
  staffKey: 'park-lee',
  setStaffKey: () => {},
  canRecord: true,
  setBannerMeta: () => {},
  setPageTitle: () => {},
};

function renderArea(marks: ChoiceMarks, handlers: Record<string, () => void> = {}) {
  render(
    <FrameContext.Provider value={frame}>
      <RecordsArea oppId="opp-1" salesStep={STEP} choiceMarks={marks} {...handlers} />
    </FrameContext.Provider>,
  );
}

async function openQuestions(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId('records-kind'), '전화');
  await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
  return screen.findByTestId('sales-question-CONFIRM_PROCESS');
}

/** 이미 확정된 값이 있는 질문은 "확정됨: … [바꾸기]" 한 줄이다(#691). [바꾸기]를 눌러야 고르기가 펼쳐진다. */
async function change(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.click(screen.getByTestId(`sales-choice-change-${question}`));
}

const box = (question: string, id: string) =>
  screen.getByTestId(`sales-choice-${question}-${id}`) as HTMLInputElement;

describe('상세 응답에서 공정·산업군 표시를 뽑는다 (#652)', () => {
  it('검토사항의 공정 연결 제안 줄은 AI 제안, 나머지 연결은 확정이다', () => {
    const detail = {
      processLinks: [
        { linkId: 'l1', processCode: 'ANODIZING' },
        { linkId: 'l2', processCode: 'ZINC_PLATING' },
      ],
      reviewItems: [
        {
          itemId: 'PL:ZINC_PLATING',
          kind: 'PROCESS_LINK_PROPOSAL',
          source: 'AI',
          text: '',
          checked: false,
        },
        {
          itemId: 'PL:CHROMATE',
          kind: 'PROCESS_LINK_PROPOSAL',
          source: 'AI',
          text: '',
          checked: false,
        },
        {
          itemId: 'II:NEW_MATERIAL',
          kind: 'ITEM_INPUT_PROPOSAL',
          source: 'AI',
          text: '',
          checked: false,
        },
      ],
      header: { industries: ['반도체'], industriesSource: 'AI' },
    } as unknown as OpportunityDetail;
    expect(choiceMarksOf(detail)).toEqual({
      process: { ANODIZING: 'CONFIRMED', ZINC_PLATING: 'AI', CHROMATE: 'AI' },
      industries: ['반도체'],
      industriesSource: 'AI',
    });
  });
});

describe('보낼 답과 저장 전 미리 알림 (#652)', () => {
  it('고른 공정만 보내고, 안 고른 AI 제안 수를 미리 알린다', () => {
    expect(choiceAnswerIds(PROCESS, ['ZINC_PLATING'], AI_ONLY)).toEqual(['ZINC_PLATING']);
    expect(choicePreview(PROCESS, ['ZINC_PLATING'], AI_ONLY)).toBe(
      "저장하면 이 회사의 공정이 '아연도금'(으)로 확정되고 다른 AI 제안 2개는 빠집니다.",
    );
  });

  it('이미 확정된 공정은 새로 고른 공정과 함께 보내고, 혼자서는 보내지 않는다', () => {
    const marks: ChoiceMarks = { ...AI_ONLY, process: { ANODIZING: 'CONFIRMED', CHROMATE: 'AI' } };
    expect(choiceAnswerIds(PROCESS, [], marks)).toEqual([]);
    expect(choicePreview(PROCESS, [], marks)).toBeNull();
    expect(choiceAnswerIds(PROCESS, ['PASSIVATION'], marks)).toEqual(['ANODIZING', 'PASSIVATION']);
    expect(choicePreview(PROCESS, ['PASSIVATION'], marks)).toBe(
      "저장하면 이 회사의 공정이 '아노다이징, 부동태'(으)로 확정되고 다른 AI 제안 1개는 빠집니다.",
    );
  });

  it('"아직 모름"이면 답을 보내지 않고 바뀌지 않는다고 알린다', () => {
    expect(choiceAnswerIds(PROCESS, [UNKNOWN_CHOICE], AI_ONLY)).toEqual([]);
    expect(choicePreview(PROCESS, [UNKNOWN_CHOICE], AI_ONLY)).toContain('바뀌지 않고');
  });

  it('산업은 고른 값을 설정 순서로 보내고 그 값으로 확정된다고 알린다', () => {
    expect(choiceAnswerIds(INDUSTRY, ['기계·설비', '방위산업'], AI_ONLY)).toEqual([
      '방위산업',
      '기계·설비',
    ]);
    expect(choicePreview(INDUSTRY, ['반도체'], AI_ONLY)).toBe(
      "저장하면 이 회사의 산업이 '반도체'(으)로 확정됩니다.",
    );
  });
});

describe('알아낸 것 요약 (#652)', () => {
  it('여러 값을 고른 질문은 한 줄에 쉼표로 이어 보인다', () => {
    const known = ['아연도금', '크로메이트'].map((answer, index) => ({
      questionId: 'CONFIRM_PROCESS',
      question: PROCESS.text,
      answerId: ['ZINC_PLATING', 'CHROMATE'][index],
      answer,
      at: '2026-11-10',
      by: 'park-lee',
    }));
    render(
      <SalesStepSummary step={{ ...STEP, known }} status="IN_PROGRESS" questions={QUESTIONS} />,
    );
    expect(screen.getByTestId('sales-step-known')).toHaveTextContent(
      '알아낸 것: 어떤 공정을 맡길 수 있나요? 아연도금, 크로메이트',
    );
  });
});

describe('접촉 기록에서 공정·산업을 확인한다 (#652)', () => {
  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(postOutcome).mockResolvedValue({
      data: {
        version: 2,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-13T01:00:00Z',
        status: 'IN_PROGRESS',
      },
      meta: {},
    });
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('AI 제안은 먼저 보이되 미리 고르지 않고, 고른 공정·산업을 값마다 답 하나로 보낸다', async () => {
    const user = userEvent.setup();
    const onCompanyConfirmed = vi.fn();
    const onSalesStepChanged = vi.fn();
    renderArea(AI_ONLY, { onCompanyConfirmed, onSalesStepChanged });
    const process = await openQuestions(user);
    // AI 제안 3개가 먼저, "AI 제안" 표시와 함께. 미리 골라 둔 것은 없다.
    const labels = [...process.querySelectorAll('label')].map((item) => item.textContent);
    expect(labels).toEqual([
      '아연도금AI 제안',
      '아노다이징AI 제안',
      '크로메이트AI 제안',
      '부동태',
      '아직 모름',
    ]);
    expect(process.querySelectorAll('input:checked')).toHaveLength(0);
    expect(screen.getByTestId('sales-question-CONFIRM_INDUSTRY')).toHaveTextContent(
      '반도체AI 제안',
    );

    await user.click(box('CONFIRM_PROCESS', 'ZINC_PLATING'));
    expect(screen.getByTestId('sales-choice-preview-CONFIRM_PROCESS')).toHaveTextContent(
      "저장하면 이 회사의 공정이 '아연도금'(으)로 확정되고 다른 AI 제안 2개는 빠집니다.",
    );
    await user.click(box('CONFIRM_INDUSTRY', '반도체'));
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).toMatchObject({
      method: 'CALL',
      result: 'REACHED',
      answers: [
        { questionId: 'CONFIRM_PROCESS', answerId: 'ZINC_PLATING' },
        { questionId: 'CONFIRM_INDUSTRY', answerId: '반도체' },
      ],
    });
    // 공정·산업을 확정했으면 상세 전체를 다시 불러오게 알린다.
    await waitFor(() => expect(onCompanyConfirmed).toHaveBeenCalledTimes(1));
    expect(onSalesStepChanged).not.toHaveBeenCalled();
  });

  it('"아직 모름"을 고르면 다른 선택이 풀리고 답을 보내지 않는다', async () => {
    const user = userEvent.setup();
    const onCompanyConfirmed = vi.fn();
    const onSalesStepChanged = vi.fn();
    renderArea(AI_ONLY, { onCompanyConfirmed, onSalesStepChanged });
    await openQuestions(user);
    await user.click(box('CONFIRM_PROCESS', 'ZINC_PLATING'));
    await user.click(box('CONFIRM_PROCESS', 'unknown'));
    expect(box('CONFIRM_PROCESS', 'ZINC_PLATING')).not.toBeChecked();
    expect(screen.getByTestId('sales-choice-preview-CONFIRM_PROCESS')).toHaveTextContent(
      '바뀌지 않고',
    );
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).not.toHaveProperty('answers');
    await waitFor(() => expect(onSalesStepChanged).toHaveBeenCalledTimes(1));
    expect(onCompanyConfirmed).not.toHaveBeenCalled();
  });

  it('이미 확정된 공정은 고른 채로 잠겨 있고, 산업군은 3개까지만 고를 수 있다', async () => {
    const user = userEvent.setup();
    renderArea({
      process: { ANODIZING: 'CONFIRMED', CHROMATE: 'AI' },
      industries: ['방위산업'],
      industriesSource: 'CASE_FILE',
    });
    const process = await openQuestions(user);
    await change(user, 'CONFIRM_PROCESS');
    await change(user, 'CONFIRM_INDUSTRY');
    expect(box('CONFIRM_PROCESS', 'ANODIZING')).toBeChecked();
    expect(box('CONFIRM_PROCESS', 'ANODIZING')).toBeDisabled();
    expect(process).toHaveTextContent('아노다이징확정됨');
    expect(process).toHaveTextContent('이미 확정된 공정은 그대로 둡니다.');
    expect(screen.getByTestId('sales-question-CONFIRM_INDUSTRY')).toHaveTextContent(
      '방위산업사례 파일',
    );
    for (const name of ['방위산업', '반도체', '자동차 부품']) {
      await user.click(box('CONFIRM_INDUSTRY', name));
    }
    expect(box('CONFIRM_INDUSTRY', '기계·설비')).toBeDisabled();
    expect(box('CONFIRM_INDUSTRY', '반도체')).not.toBeDisabled();
  });
});

describe('확인될 때까지 묻고, 확정된 것만 맞아도 답할 수 있다 (#652 보완)', () => {
  const MIXED: ChoiceMarks = {
    process: { ANODIZING: 'CONFIRMED', ZINC_PLATING: 'AI', CHROMATE: 'AI' },
    industries: ['방위산업'],
    industriesSource: 'CASE_FILE',
  };

  beforeEach(() => {
    vi.mocked(postOutcome).mockReset();
    vi.mocked(postOutcome).mockResolvedValue({
      data: {
        version: 2,
        updatedBy: 'park-lee',
        updatedAt: '2026-11-13T01:00:00Z',
        status: 'IN_PROGRESS',
      },
      meta: {},
    });
    vi.mocked(getSalesQuestions).mockResolvedValue({ data: QUESTIONS, meta: {} });
  });

  it('"연결됨"을 지난 단계에서도 답이 없으면 보이고, 답이 있으면 안 보인다', () => {
    const later: SalesStepView = { ...STEP, code: 'MATERIAL_QUOTE' };
    const ids = (step: SalesStepView | null) =>
      visibleQuestions(QUESTIONS, step, {}).map((item) => item.questionId);
    expect(ids(later)).toEqual(['CONFIRM_PROCESS', 'CONFIRM_INDUSTRY']);
    // 아직 "연결 전"이면 묻지 않는다.
    expect(ids({ ...STEP, code: 'NOT_REACHED' })).toEqual([]);
    const answered: SalesStepView = {
      ...later,
      known: [
        {
          questionId: 'CONFIRM_PROCESS',
          question: PROCESS.text,
          answerId: 'ZINC_PLATING',
          answer: '아연도금',
          at: '2026-11-10',
          by: 'park-lee',
        },
      ],
    };
    expect(ids(answered)).toEqual(['CONFIRM_INDUSTRY']);
  });

  it('"지금 확정된 것이 맞음"이면 확정된 값만 답으로 보내고 빠질 AI 제안 수를 알린다', () => {
    expect(choiceAnswerIds(PROCESS, [KEEP_CHOICE], MIXED)).toEqual(['ANODIZING']);
    expect(choicePreview(PROCESS, [KEEP_CHOICE], MIXED)).toBe(
      "저장하면 확정된 공정 '아노다이징'이(가) 맞는 것으로 남고 남은 AI 제안 2개는 빠집니다.",
    );
    expect(choiceAnswerIds(INDUSTRY, [KEEP_CHOICE], MIXED)).toEqual(['방위산업']);
    // AI 제안뿐인 산업군은 확정된 값이 아니라 보낼 것이 없다.
    expect(choiceAnswerIds(INDUSTRY, [KEEP_CHOICE], AI_ONLY)).toEqual([]);
  });

  it('아무것도 고르지 않고 저장하면 답을 보내지 않고, "맞음"을 고르면 확정된 값을 보낸다', async () => {
    const user = userEvent.setup();
    const onCompanyConfirmed = vi.fn();
    renderArea(MIXED, { onCompanyConfirmed });
    const process = await openQuestions(user);
    // 처음에는 한 줄만 보인다. 누르지 않고 저장하면 답을 보내지 않는다.
    expect(process).toHaveTextContent('확정됨: 아노다이징');
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(1));
    expect(vi.mocked(postOutcome).mock.calls[0][1]).not.toHaveProperty('answers');
    expect(onCompanyConfirmed).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId('records-contact-result'), '연결됨');
    await screen.findByTestId('sales-question-CONFIRM_PROCESS');
    await change(user, 'CONFIRM_PROCESS');
    await change(user, 'CONFIRM_INDUSTRY');
    expect(screen.getByTestId('sales-question-CONFIRM_PROCESS')).toHaveTextContent(
      "확정된 공정이 맞으면 '지금 확정된 것이 맞음'을 고르고 저장하세요(남은 AI 제안 2개는 빠집니다).",
    );
    await user.click(box('CONFIRM_PROCESS', 'keep'));
    await user.click(box('CONFIRM_INDUSTRY', 'keep'));
    await user.click(screen.getByTestId('records-contact-save-button'));
    await waitFor(() => expect(postOutcome).toHaveBeenCalledTimes(2));
    expect(vi.mocked(postOutcome).mock.calls[1][1]).toMatchObject({
      answers: [
        { questionId: 'CONFIRM_PROCESS', answerId: 'ANODIZING' },
        { questionId: 'CONFIRM_INDUSTRY', answerId: '방위산업' },
      ],
    });
    await waitFor(() => expect(onCompanyConfirmed).toHaveBeenCalledTimes(1));
  });

  // #719: 아무도 확정하지 않은 사례 파일 값을 "확정됨"이라고 하지 않는다.
  it('산업이 사례 파일 값이면 "사례 파일 값: …"으로, 담당자가 확정했으면 "확정됨: …"으로 보인다', async () => {
    const user = userEvent.setup();
    renderArea(MIXED);
    await openQuestions(user);
    const caseFile = screen.getByTestId('sales-choice-confirmed-CONFIRM_INDUSTRY');
    expect(caseFile).toHaveTextContent(/^사례 파일 값: 방위산업$/);
    expect(screen.getByTestId('sales-choice-change-CONFIRM_INDUSTRY')).toHaveTextContent('바꾸기');
    cleanup();

    renderArea({ ...MIXED, industriesSource: 'STAFF' });
    await openQuestions(user);
    expect(screen.getByTestId('sales-choice-confirmed-CONFIRM_INDUSTRY')).toHaveTextContent(
      /^확정됨: 방위산업$/,
    );
  });

  it('"맞음"을 고른 뒤 다른 공정을 고르면 "맞음"이 풀린다', async () => {
    const user = userEvent.setup();
    renderArea(MIXED);
    await openQuestions(user);
    await change(user, 'CONFIRM_PROCESS');
    await user.click(box('CONFIRM_PROCESS', 'keep'));
    await user.click(box('CONFIRM_PROCESS', 'CHROMATE'));
    expect(box('CONFIRM_PROCESS', 'keep')).not.toBeChecked();
    expect(screen.getByTestId('sales-choice-preview-CONFIRM_PROCESS')).toHaveTextContent(
      "저장하면 이 회사의 공정이 '아노다이징, 크로메이트'(으)로 확정되고 다른 AI 제안 1개는 빠집니다.",
    );
  });
});
