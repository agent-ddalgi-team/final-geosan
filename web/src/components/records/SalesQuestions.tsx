// 영업 꼬리 질문(#607, PM 결정 2026-11-12): 상세 기록 구역의 세부 단계 요약과 접촉 기록의 질문 칸.
// 문구·보기·갈라지는 조건은 서버의 질문 파일(GET /sales-questions)에서 오고, 답은 코드로만 보낸다.
// 세부 단계는 서버가 기록에서 계산한다. 화면은 지금 고른 답으로 다음 단계 질문을 미리 펼쳐 보일 뿐이다.
import { Button, Radio, Typography } from 'antd';
import type {
  OutcomeStatus,
  SalesQuestion,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import { outcomeStatusLabels, salesQuestionTexts, salesStepLabels } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

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
 */
export function visibleQuestions(
  questions: SalesQuestions,
  step: SalesStepView | null,
  picked: Record<string, string>,
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
  return questions.questions.filter((question) => {
    const inRange =
      question.step === 'ALL' ||
      (order(question.step) >= order(base) && order(question.step) <= order(reach));
    const unanswered = question.step === 'ALL' || !(question.questionId in known);
    const conditions = Object.entries(question.showWhen?.answers ?? {});
    const shown = conditions.every(([target, answerIds]) => answerIds.includes(chosen[target]));
    return inRange && unanswered && shown;
  });
}

export interface SalesQuestionFieldsProps {
  questions: SalesQuestions;
  step: SalesStepView | null;
  picked: Record<string, string>;
  onPick: (questionId: string, answerId: string | null) => void;
  disabled?: boolean;
}

/** 접촉 결과가 "연결됨"일 때 접촉 기록 칸 아래에 보이는 질문들. 고르지 않아도 저장된다. */
export function SalesQuestionFields({
  questions,
  step,
  picked,
  onPick,
  disabled,
}: SalesQuestionFieldsProps) {
  const shown = visibleQuestions(questions, step, picked);
  if (shown.length === 0) return null;
  return (
    <fieldset
      data-testid="sales-questions"
      style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, margin: 0 }}
    >
      <legend style={{ padding: '0 4px' }}>{salesQuestionTexts.questionsTitle}</legend>
      <Typography.Text type="secondary" style={{ fontSize: typography.fontSizeSecondary }}>
        {salesQuestionTexts.questionsHint}
      </Typography.Text>
      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        {shown.map((question) => (
          <div key={question.questionId} data-testid={`sales-question-${question.questionId}`}>
            <div id={`sales-question-label-${question.questionId}`} style={{ marginBottom: 4 }}>
              {question.text}
            </div>
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
          </div>
        ))}
      </div>
    </fieldset>
  );
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
          ? step.known.map((item) => `${item.question} ${item.answer}`).join(' · ')
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
