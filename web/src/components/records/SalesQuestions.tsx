// 영업 꼬리 질문(#607, PM 결정 2026-11-12): 상세 기록 구역의 세부 단계 요약과 접촉 기록의 질문 칸.
// 문구·보기·갈라지는 조건은 서버의 질문 파일(GET /sales-questions)에서 오고, 답은 코드로만 보낸다.
// 세부 단계는 서버가 기록에서 계산한다. 화면은 지금 고른 답으로 다음 단계 질문을 미리 펼쳐 보일 뿐이다.
import { Button, Radio, Typography } from 'antd';
import type {
  LostReasonCode,
  OutcomeStatus,
  SalesQuestion,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import { outcomeStatusLabels, salesQuestionTexts, salesStepLabels } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { ChoiceQuestionField } from './ChoiceQuestion';
import type { ChoiceMarks } from './ChoiceQuestion';

export const STEP_ORDER: SalesStep[] = [
  'NOT_REACHED',
  'REACHED',
  'DEMAND_CONFIRMED',
  'MATERIAL_QUOTE',
  'VISIT_SAMPLE',
];

const CLOSED: OutcomeStatus[] = ['ON_HOLD', 'WON', 'LOST'];

function order(step: SalesStep): number {
  return STEP_ORDER.indexOf(step);
}

/**
 * 이번 접촉에서 보일 질문. 지금 세부 단계부터, 지금 고른 답이 데려가는 단계까지의 질문 가운데
 * 아직 답이 없는 것과 "모든 단계" 질문을 보인다. 꼬리 질문은 앞 답(지난 답 + 지금 고른 답)이 맞을 때만.
 * "모든 단계" 질문은 접촉마다 다시 묻는 것이라, 그 꼬리(마무리 질문)는 지금 고른 답만 본다(#643).
 * allOnly면 "모든 단계" 질문과 그 꼬리만 보인다(접촉 결과가 "거절"일 때).
 */
export function visibleQuestions(
  questions: SalesQuestions,
  step: SalesStepView | null,
  picked: Record<string, string>,
  allOnly = false,
): SalesQuestion[] {
  const base: SalesStep = step?.code ?? 'NOT_REACHED';
  const known: Record<string, string> = {};
  for (const item of step?.known ?? []) known[item.questionId] = item.answerId;
  let reach = base;
  for (const question of questions.questions) {
    const option = question.answers.find((item) => item.answerId === picked[question.questionId]);
    if (option?.reaches && order(option.reaches) > order(reach)) reach = option.reaches;
  }
  const chosen = { ...known, ...picked };
  const askedEveryTime = new Set(
    questions.questions.filter((item) => item.step === 'ALL').map((item) => item.questionId),
  );
  const shownIds = new Set<string>();
  // 질문 파일 순서대로 본다. 꼬리는 앞 질문이 지금 보일 때만 보인다(가려진 질문의 옛 선택으로 열리지 않게).
  return questions.questions.filter((question) => {
    // 공정·산업 확인(#652 choices)은 그 단계부터 답이 생길 때까지 뒤 단계에서도 계속 묻는다.
    const inRange =
      question.step === 'ALL' ||
      (!allOnly &&
        (Boolean(question.choices) || order(question.step) >= order(base)) &&
        order(question.step) <= order(reach));
    const unanswered = question.step === 'ALL' || !(question.questionId in known);
    const conditions = Object.entries(question.showWhen?.answers ?? {});
    const shown = conditions.every(([target, answerIds]) =>
      askedEveryTime.has(target)
        ? shownIds.has(target) && answerIds.includes(picked[target])
        : answerIds.includes(chosen[target]),
    );
    const visible = inRange && unanswered && shown;
    if (visible) shownIds.add(question.questionId);
    return visible;
  });
}

export interface ClosingPick {
  /** 지금 고른 답이 끝내는 큰 단계. */
  status: 'WON' | 'LOST' | 'ON_HOLD';
  /** 거절이면 고른 거절 이유 코드(아직 안 골랐으면 null). */
  lostReasonCode: LostReasonCode | null;
}

/** 지금 보이는 질문에서 고른 답 가운데 단계를 끝내는 답(#643). 없으면 null. */
export function closingPick(
  shown: SalesQuestion[],
  picked: Record<string, string>,
): ClosingPick | null {
  let status: ClosingPick['status'] | null = null;
  let lostReasonCode: LostReasonCode | null = null;
  for (const question of shown) {
    const option = question.answers.find((item) => item.answerId === picked[question.questionId]);
    if (option?.closes) status = option.closes;
    if (option?.lostReason) lostReasonCode = option.lostReason;
  }
  if (!status) return null;
  return { status, lostReasonCode: status === 'LOST' ? lostReasonCode : null };
}

export interface SalesQuestionFieldsProps {
  questions: SalesQuestions;
  step: SalesStepView | null;
  picked: Record<string, string>;
  onPick: (questionId: string, answerId: string | null) => void;
  disabled?: boolean;
  /** 접촉 결과가 "거절"이면 "모든 단계" 질문과 그 꼬리만 보인다(#643). */
  allOnly?: boolean;
  /** 여러 개를 고르는 질문(#652 공정·산업 확인)에서 고른 값. */
  pickedMany?: Record<string, string[]>;
  onPickMany?: (questionId: string, values: string[]) => void;
  /** 이 회사에 붙어 있는 공정·산업군 표시(AI 제안·확정). */
  marks?: ChoiceMarks | null;
}

/** 접촉 결과가 "연결됨"·"거절"일 때 접촉 기록 칸 아래에 보이는 질문들. 고르지 않아도 저장된다. */
export function SalesQuestionFields({
  questions,
  step,
  picked,
  onPick,
  disabled,
  allOnly = false,
  pickedMany = {},
  onPickMany,
  marks = null,
}: SalesQuestionFieldsProps) {
  const shown = visibleQuestions(questions, step, picked, allOnly);
  if (shown.length === 0) return null;
  // 단계 이름은 질문 파일의 것을 먼저 쓰고, 없으면 쉬운 말 대응표.
  const stepLabel = (code: SalesStep) =>
    questions.steps?.find((item) => item.code === code)?.label ?? salesStepLabels[code];
  return (
    <fieldset
      data-testid="sales-questions"
      style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, margin: 0 }}
    >
      <legend style={{ padding: '0 4px' }}>{salesQuestionTexts.questionsTitle}</legend>
      {/* 왜 이 질문들이 나오는지 한 줄(#674): 질문은 세부 단계마다 다르고 "모든 단계" 질문은 늘 나온다. */}
      <div data-testid="sales-questions-step" style={{ marginBottom: 4 }}>
        {allOnly
          ? salesQuestionTexts.stepLineDeclined
          : step?.code
            ? salesQuestionTexts.stepLine(stepLabel(step.code))
            : salesQuestionTexts.stepLineFirst(stepLabel('NOT_REACHED'))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: typography.fontSizeSecondary }}>
        {salesQuestionTexts.questionsHint}
      </Typography.Text>
      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        {shown.map((question) => (
          <div key={question.questionId} data-testid={`sales-question-${question.questionId}`}>
            <div id={`sales-question-label-${question.questionId}`} style={{ marginBottom: 4 }}>
              {question.text}
            </div>
            {question.choices ? (
              <ChoiceQuestionField
                question={question}
                picked={pickedMany[question.questionId] ?? []}
                marks={marks}
                onChange={(values) => onPickMany?.(question.questionId, values)}
                disabled={disabled}
              />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Radio.Group
                  aria-labelledby={`sales-question-label-${question.questionId}`}
                  optionType="button"
                  value={picked[question.questionId] ?? null}
                  disabled={disabled}
                  onChange={(event) => onPick(question.questionId, event.target.value as string)}
                  options={question.answers.map((option) => ({
                    value: option.answerId,
                    label: option.label,
                  }))}
                />
                {picked[question.questionId] ? (
                  <Button
                    size="small"
                    type="link"
                    disabled={disabled}
                    onClick={() => onPick(question.questionId, null)}
                    data-testid={`sales-question-clear-${question.questionId}`}
                  >
                    {salesQuestionTexts.clearAnswer}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** "질문 답" 줄들. 여러 값을 고른 질문(#652)은 같은 질문의 답을 쉼표로 이어 한 줄로 만든다. */
function knownLines(known: SalesStepView['known']): string[] {
  const answers = new Map<string, { question: string; values: string[] }>();
  for (const item of known) {
    const found = answers.get(item.questionId);
    if (found) found.values.push(item.answer);
    else answers.set(item.questionId, { question: item.question, values: [item.answer] });
  }
  return [...answers.values()].map((item) => `${item.question} ${item.values.join(', ')}`);
}

export interface SalesStepSummaryProps {
  step: SalesStepView | null;
  status: OutcomeStatus | null;
  questions: SalesQuestions | null;
}

/** 기록 구역 맨 위 요약: 지금 세부 단계 · 알아낸 것 · 아직 모르는 것. */
export function SalesStepSummary({ step, status, questions }: SalesStepSummaryProps) {
  const hint = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
  let current: string;
  if (step?.code) {
    const big = status ? `${outcomeStatusLabels[status]} · ` : '';
    current = `${big}${salesQuestionTexts.stepSince(salesStepLabels[step.code], step.since)}`;
  } else if (status && CLOSED.includes(status)) {
    current = salesQuestionTexts.stepClosed;
  } else {
    current = salesQuestionTexts.stepNone;
  }
  const unknown = (step?.openQuestions ?? [])
    .map((id) => questions?.questions.find((item) => item.questionId === id))
    .filter((item): item is SalesQuestion => item !== undefined && item.step !== 'ALL')
    .map((item) => item.text);
  return (
    <div data-testid="sales-step-summary" style={{ display: 'grid', gap: 4 }}>
      <span>
        <strong>{salesQuestionTexts.summaryTitle}</strong>:{' '}
        <span data-testid="sales-step-current">{current}</span>
        {step?.overridden ? <span style={hint}> ({salesQuestionTexts.overridden})</span> : null}
      </span>
      <span data-testid="sales-step-known">
        {salesQuestionTexts.known}:{' '}
        {step && step.known.length > 0
          ? knownLines(step.known).join(' · ')
          : salesQuestionTexts.knownNone}
      </span>
      {unknown.length > 0 ? (
        <span data-testid="sales-step-unknown" style={hint}>
          {salesQuestionTexts.unknown}: {unknown.join(' · ')}
        </span>
      ) : null}
    </div>
  );
}
