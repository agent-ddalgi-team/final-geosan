// "2. 통화에서 확인할 것"(#674): 읽기 전용 목록. 물을 말은 꼬리 질문 파일과 같은 문구를 쓰고,
// 줄마다의 단추·체크는 없으며, 공고·채용 "근거 없음" 줄은 보이지 않는다. 저장돼 있던 답·메모·확인 표시는 읽기 전용으로 남는다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  DetailHeader,
  ProcessLinkView,
  ReviewItem,
  SalesQuestions,
  SalesStepView,
} from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import CallChecklist, { callCheckCountOf, nextActionWithoutMissing } from '../CallChecklist';

const header = {
  ...(detailFixture.data.header as unknown as DetailHeader),
  classificationCode: 'FILTER_PENDING',
  industries: ['기계·설비'],
  industriesSource: 'AI',
} satisfies DetailHeader;

const questions: SalesQuestions = {
  version: 1,
  steps: [],
  questions: [
    {
      questionId: 'CONFIRM_PROCESS',
      text: '어떤 공정을 맡길 수 있나요?',
      step: 'REACHED',
      choices: 'PROCESS',
      answers: [],
    },
    {
      questionId: 'CONFIRM_INDUSTRY',
      text: '어느 산업인가요?',
      step: 'REACHED',
      choices: 'INDUSTRY',
      answers: [],
    },
    {
      questionId: 'SWITCH_INTENT',
      text: '외주처를 바꿀 생각이 있나요?',
      step: 'DEMAND_CONFIRMED',
      answers: [],
    },
    { questionId: 'NEXT_ACTION', text: '다음 할 일은?', step: 'ALL', answers: [] },
  ],
};

const pendingLink: ProcessLinkView = {
  linkId: 'l1',
  processCode: 'ZINC_PLATING',
  processName: '아연도금',
  appliedMaterial: null,
  result: 'PENDING',
};

function gap(code: string, text: string, patch: Partial<ReviewItem> = {}): ReviewItem {
  return {
    itemId: `GAP:ITEM:${code}`,
    kind: 'DATA_INSUFFICIENT',
    source: 'RULE',
    text,
    checked: false,
    ...patch,
  };
}

const reviewItems: ReviewItem[] = [
  {
    itemId: 'Q:q-1',
    kind: 'QUESTION',
    source: 'RULE',
    text: '대상 부품의 요구 성능은 무엇인가요?',
    targetLabel: '상대 회사',
    checked: true,
    checkedBy: 'park-lee',
    checkedAt: '2026-11-06T14:20:00+09:00',
    replyText: '내식성이라고 함',
    repliedAt: '2026-11-06',
    repliedBy: 'park-lee',
  },
  gap('NEW_RECORD', '유사 산업·부품 납품실적 근거 없음'),
  gap('SIG_EXPAND', '공장 증설·신규 생산라인 근거 없음'),
  gap('SIG_BID', '입찰·협력사 모집·구매 공고 근거 없음'),
  gap('SIG_HIRE', '관련 직무 채용(구매·품질·생산기술·표면처리) 근거 없음'),
  {
    itemId: 'II:NEW_PRODUCT',
    kind: 'ITEM_INPUT_PROPOSAL',
    source: 'AI',
    text: 'AI 제안 · 제품 — 해당(약한 추정)',
    checked: false,
    stepOptions: ['해당'],
  },
  {
    itemId: 'PL:ZINC_PLATING',
    kind: 'PROCESS_LINK_PROPOSAL',
    source: 'AI',
    text: 'AI 공정 연결 제안 · 아연도금 · 근거: 인용 없음',
    checked: false,
  },
];

const salesStep: SalesStepView = {
  code: 'DEMAND_CONFIRMED',
  since: '2026-11-12',
  overridden: false,
  known: [],
  openQuestions: ['CONFIRM_PROCESS', 'SWITCH_INTENT', 'NEXT_ACTION'],
};

function renderList(items = reviewItems) {
  render(
    <CallChecklist
      header={header}
      reasons={{
        reason: '이유',
        nextAction: '도금을 외주하는지 확인 · 자료 미확보: 납품실적·증설·공고·채용',
        questions: [],
      }}
      processLinks={[pendingLink]}
      reviewItems={items}
      requirements={[]}
      salesStep={salesStep}
      scoreItems={[
        {
          itemCode: 'NEW_RECORD',
          label: '유사 산업·부품 납품실적',
          state: 'UNAVAILABLE',
          weight: 10,
          summary: '납품 산업과 연결할 근거가 없어 미확보입니다.',
        },
      ]}
      questions={questions}
    />,
  );
}

describe('CallChecklist (#674)', () => {
  it('확인이 필요한 것만 물을 말 한 줄씩: 후속 조치 → 공정 → 소재 → 산업 → 아직 답이 없는 꼬리 질문 순서이고 꼬리 질문과 같은 말을 쓴다', () => {
    renderList();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2. 통화에서 확인할 것');
    const lines = screen.getAllByTestId('call-line').map((el) => el.textContent);
    expect(lines).toEqual([
      // "자료 미확보: …공고·채용" 조각은 뺀다(접힌 묶음이 같은 내용).
      '후속 조치 — 도금을 외주하는지 확인',
      '공정 — 어떤 공정을 맡길 수 있나요?',
      '소재 — 부품 소재가 무엇인가요?',
      '산업 — 어느 산업인가요?',
      // 공정 질문은 이미 위에 있어 두 번 적지 않고, 모든 단계 질문("다음 할 일은?")은 넣지 않는다.
      '외주처를 바꿀 생각이 있나요?',
    ]);
  });

  it('줄마다의 체크·[답 적기]·[메모 적기]·[붙여넣고 조사]·[확정]이 없고, AI 제안 줄은 목록에 없다', () => {
    renderList();
    const section = screen.getByTestId('detail-review');
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    // 단추는 접힌 묶음을 여는 것 하나뿐이다.
    expect(within(section).getAllByRole('button')).toHaveLength(1);
    for (const id of [
      'review-checkbox',
      'review-reply-button',
      'review-memo-button',
      'review-paste-button',
      'review-proposal-confirm',
      'review-proposal-fix',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(section).not.toHaveTextContent('AI 공정 연결 제안');
    expect(section).not.toHaveTextContent('AI 제안 · 제품');
  });

  it('저장돼 있던 답과 확인 표시는 그 줄 아래에 읽기 전용으로 계속 보인다', () => {
    renderList();
    const row = screen.getAllByTestId('review-item')[0];
    expect(row).toHaveTextContent('대상 부품의 요구 성능은 무엇인가요?');
    expect(within(row).getByTestId('review-reply')).toHaveTextContent('답: 내식성이라고 함');
    expect(within(row).getByTestId('review-checked-by')).toHaveTextContent(
      '✓ 확인함 — park-lee · 11/6',
    );
  });

  it('"근거 없음" 줄은 접혀 있고, 펼쳐도 공고·채용 줄은 보이지 않는다', async () => {
    const user = userEvent.setup();
    renderList();
    const toggle = screen.getByTestId('review-fold-toggle-gap');
    // 4줄 가운데 공고·채용 2줄을 뺀 2줄.
    expect(toggle).toHaveTextContent('▸ 아직 근거·자료가 없는 항목 2개 보기');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('review-item')).toHaveLength(1);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByTestId('review-item').map((el) => el.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain('유사 산업·부품 납품실적 근거 없음');
    // 그 항목의 설명(점수 항목 요약)이 줄 아래에 붙는다.
    expect(rows[1]).toContain('납품 산업과 연결할 근거가 없어 미확보입니다.');
    expect(rows[2]).toContain('공장 증설·신규 생산라인 근거 없음');
    const section = screen.getByTestId('detail-review');
    expect(section).not.toHaveTextContent('공고 근거 없음');
    expect(section).not.toHaveTextContent('채용');
    // 펼친 줄에도 단추·체크가 없다.
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(section).getAllByRole('button')).toHaveLength(1);
  });

  it('공고·채용 줄이라도 이미 메모가 저장돼 있으면 지우지 않고 읽기 전용으로 보인다', () => {
    renderList([
      gap('SIG_BID', '입찰·협력사 모집·구매 공고 근거 없음', {
        note: {
          text: '나라장터 공고 확인 https://example.invalid/bid',
          by: 'park-lee',
          at: '2026-11-12T10:00:00+09:00',
        },
      }),
      gap('SIG_HIRE', '관련 직무 채용(구매·품질·생산기술·표면처리) 근거 없음'),
    ]);
    const rows = screen.getAllByTestId('review-item');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId('review-memo')).toHaveTextContent(
      '메모: 나라장터 공고 확인',
    );
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('target', '_blank');
    // 기록이 없는 채용 줄만 남으면 접힌 묶음 자체가 없다.
    expect(screen.queryByTestId('review-fold-toggle-gap')).not.toBeInTheDocument();
  });

  it('질문 파일을 못 받았으면 화면 문구로 대신하고, 확인할 것이 없으면 "지금 확인할 것이 없습니다."', () => {
    const { unmount } = render(
      <CallChecklist
        header={header}
        reasons={{ reason: '이유', nextAction: '자료 미확보: 공고·채용', questions: [] }}
        processLinks={[pendingLink]}
        reviewItems={[]}
        requirements={[]}
        salesStep={null}
        questions={null}
      />,
    );
    expect(screen.getAllByTestId('call-line').map((el) => el.textContent)).toEqual([
      '소재 — 부품 소재가 무엇인가요?',
      '산업 — 어느 산업인가요?',
    ]);
    unmount();
    render(
      <CallChecklist
        header={{ ...header, industriesSource: 'STAFF' }}
        reasons={{ reason: '이유', nextAction: '자료 미확보: 공고·채용', questions: [] }}
        processLinks={[{ ...pendingLink, appliedMaterial: 'FE', result: 'PASS' }]}
        reviewItems={[]}
        requirements={[]}
        salesStep={null}
        questions={questions}
      />,
    );
    expect(screen.getByTestId('call-empty')).toHaveTextContent('지금 확인할 것이 없습니다.');
  });

  it('공정·산업이 이미 확정됐으면 서버가 꼬리 질문을 아직 답 없는 것으로 줘도 "어떤 공정·어느 산업" 줄이 없다 (#730)', () => {
    const withOptions: SalesQuestions = {
      ...questions,
      questions: questions.questions.map((question) =>
        question.choices === 'PROCESS'
          ? { ...question, answers: [{ answerId: 'ZINC_PLATING', label: '아연도금' }] }
          : question.choices === 'INDUSTRY'
            ? { ...question, answers: [{ answerId: '기계·설비', label: '기계·설비' }] }
            : question,
      ),
    };
    render(
      <CallChecklist
        header={{ ...header, industriesSource: 'CASE_FILE' }}
        reasons={{ reason: '이유', nextAction: '', questions: [] }}
        processLinks={[{ ...pendingLink, appliedMaterial: 'FE', result: 'PASS' }]}
        reviewItems={[]}
        requirements={[]}
        salesStep={{
          ...salesStep,
          openQuestions: ['CONFIRM_PROCESS', 'CONFIRM_INDUSTRY', 'SWITCH_INTENT'],
        }}
        questions={withOptions}
      />,
    );
    expect(screen.getAllByTestId('call-line').map((el) => el.textContent)).toEqual([
      '외주처를 바꿀 생각이 있나요?',
    ]);
  });

  it('후속 조치 문장에서 "자료 미확보: …" 조각만 뺀다', () => {
    expect(nextActionWithoutMissing('A 확인 · 자료 미확보: 공고·채용')).toBe('A 확인');
    expect(nextActionWithoutMissing('자료 미확보: 소재')).toBeNull();
    expect(nextActionWithoutMissing('응모 전 피막 두께 요구 확인')).toBe(
      '응모 전 피막 두께 요구 확인',
    );
  });
});

describe('"한눈에 › 확인할 것"과 같은 기준 (#691)', () => {
  it('목록에 보이는 줄 수(접힌 "근거 없음"은 빼고)를 그대로 센다', () => {
    renderList();
    const shown = screen.getByTestId('call-list').children.length;
    expect(shown).toBeGreaterThan(0);
    expect(
      callCheckCountOf(
        {
          header,
          reasons: {
            reason: '이유',
            nextAction: '도금을 외주하는지 확인 · 자료 미확보: 납품실적·증설·공고·채용',
            questions: [],
          },
          processLinks: [pendingLink],
          reviewItems,
          requirements: [],
          salesStep,
        },
        questions,
      ),
    ).toBe(shown);
  });

  it('물을 것이 없으면 0이다', () => {
    expect(
      callCheckCountOf(
        {
          header: { ...header, classificationCode: 'CONTACT_URGENT', industriesSource: 'STAFF' },
          reasons: { reason: '이유', nextAction: '', questions: [] },
          processLinks: [{ ...pendingLink, appliedMaterial: 'AL_CASTING', result: 'PASS' }],
          reviewItems: [],
          requirements: [],
          salesStep: null,
        },
        questions,
      ),
    ).toBe(0);
  });
});
