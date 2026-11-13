// 영업 꼬리 질문(#607, PM 결정 2026-11-12): 상세 기록 구역의 세부 단계 요약과 접촉 기록의 질문 칸.
// 문구·보기·갈라지는 조건은 서버의 질문 파일(GET /sales-questions)에서 오고, 답은 코드로만 보낸다.
// 세부 단계는 서버가 기록에서 계산한다. 화면은 지금 고른 답으로 다음 단계 질문을 미리 펼쳐 보일 뿐이다.
import { useState } from 'react';
import { Button, Radio, Typography } from 'antd';
import type {
  LostReasonCode,
  OutcomeStatus,
  SalesQuestion,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import {
  outcomeStatusLabels,
  salesChoiceTexts,
  salesQuestionTexts,
  salesStepLabels,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { ChoiceQuestionField, confirmedLabels } from './ChoiceQuestion';
import type { ChoiceMarks } from './ChoiceQuestion';
import QuickDate from './QuickDate';

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
 * 접촉 자체에 대한 질문(#691 "누가 먼저 연락했나요?"): 보기에 기본 보기(default)가 있는 질문이다.
 * 꼬리 질문 묶음이 아니라 종류·결과 줄 옆에 보이고, "알아낸 것"·"아직 모르는 것"에 넣지 않는다.
 */
export function isContactQuestion(question: SalesQuestion): boolean {
  return !question.choices && question.answers.some((option) => option.default);
}

export function contactQuestionsOf(questions: SalesQuestions | null): SalesQuestion[] {
  return (questions?.questions ?? []).filter(isContactQuestion);
}

/** 접촉 질문마다 미리 골라 둘 보기(기본 "우리가"). */
export function contactDefaults(questions: SalesQuestions | null): Record<string, string> {
  const picks: Record<string, string> = {};
  for (const question of contactQuestionsOf(questions)) {
    const option = question.answers.find((item) => item.default);
    if (option) picks[question.questionId] = option.answerId;
  }
  return picks;
}

/**
 * 한 통화에 보이는 수를 세는 "통화 내용 질문"(#691): 세부 단계별 질문과 그 꼬리.
 * 공정·산업 확인(choices)과 모든 단계 질문(다음 할 일·마무리)은 세지 않고 늘 보인다.
 */
export function isTalkQuestion(question: SalesQuestion): boolean {
  return !question.choices && question.step !== 'ALL';
}

/**
 * 이번 통화에서 접어 둘 질문 ID(#691, PM 결정 2026-11-13). 화면에 나오는 순서대로 통화 내용 질문을
 * limit개까지 보이고 넘는 것을 접는다. 이미 답을 고른 질문은 접지 않는다. limit이 없으면 접지 않는다.
 */
export function foldedQuestionIds(
  shown: SalesQuestion[],
  picked: Record<string, string>,
  limit: number | null | undefined,
): string[] {
  if (!limit || limit < 1) return [];
  return shown
    .filter(isTalkQuestion)
    .filter((question, index) => index >= limit && !picked[question.questionId])
    .map((question) => question.questionId);
}

export interface ClosingRoute {
  /** "다음 할 일은?" 질문과, 마무리 질문을 여는 보기("끝"). */
  openerId: string;
  endAnswerIds: string[];
  /** 마무리 질문("어떻게 끝났나요?")과 그 보기 가운데 단계를 끝내는 것. */
  closingId: string;
  options: { answerId: string; label: string; closes: 'WON' | 'LOST' | 'ON_HOLD' }[];
}

/**
 * 질문 파일에서 "끝 → 어떻게 끝났나요?" 길을 찾는다(#691). 질문 id를 화면에 고정하지 않는다:
 * 보기에 closes가 있는 질문이 마무리 질문이고, 그 질문의 showWhen이 가리키는 질문·보기가 "다음 할 일"의 "끝"이다.
 * 그런 길이 하나로 정해지지 않으면 null(화면은 전처럼 질문을 차례로 보인다).
 */
export function closingRouteOf(questions: SalesQuestions | null): ClosingRoute | null {
  const closing = (questions?.questions ?? []).filter((question) =>
    question.answers.some((option) => option.closes),
  );
  if (closing.length !== 1) return null;
  const conditions = Object.entries(closing[0].showWhen?.answers ?? {});
  if (conditions.length !== 1 || conditions[0][1].length === 0) return null;
  return {
    openerId: conditions[0][0],
    endAnswerIds: conditions[0][1],
    closingId: closing[0].questionId,
    options: closing[0].answers.flatMap((option) =>
      option.closes
        ? [{ answerId: option.answerId, label: option.label, closes: option.closes }]
        : [],
    ),
  };
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
    // 접촉 자체에 대한 질문(#691)은 종류·결과 줄 옆에 따로 보인다.
    if (isContactQuestion(question)) return false;
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

export interface NextActionPick {
  /** "다음 할 일은?" 질문의 ID. */
  questionId: string;
  /** 고른 할 일의 쉬운 말("견적"). 다음 일정의 내용으로 쓴다. */
  label: string;
}

/**
 * 지금 고른 "다음 할 일"(#683). 끝이 아닌 할 일을 골랐을 때만 값이 있다.
 * 어느 질문이 "다음 할 일"인지는 질문 파일에서 읽는다: 마무리 질문(보기에 closes가 있는 질문)을
 * 여는 질문이 "다음 할 일"이고, 그 마무리 질문을 여는 보기("끝")는 날짜를 묻지 않는다.
 */
export function nextActionPick(
  questions: SalesQuestions,
  shown: SalesQuestion[],
  picked: Record<string, string>,
): NextActionPick | null {
  const ending = new Map<string, Set<string>>();
  for (const question of questions.questions) {
    if (!question.answers.some((option) => option.closes)) continue;
    for (const [target, answerIds] of Object.entries(question.showWhen?.answers ?? {})) {
      const ids = ending.get(target) ?? new Set<string>();
      for (const answerId of answerIds) ids.add(answerId);
      ending.set(target, ids);
    }
  }
  for (const question of shown) {
    const ends = ending.get(question.questionId);
    if (!ends || question.choices) continue;
    const option = question.answers.find((item) => item.answerId === picked[question.questionId]);
    if (option && !ends.has(option.answerId) && !option.closes) {
      return { questionId: question.questionId, label: option.label };
    }
  }
  return null;
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
  /** "다음 할 일" 아래 "언제 할까요?" 날짜(#683, YYYY-MM-DD 또는 빈 값). onNextDate가 있을 때만 칸이 보인다. */
  nextDate?: string;
  onNextDate?: (value: string) => void;
  /** 고를 수 있는 가장 이른 날짜(오늘, 한국 시간). */
  nextDateMin?: string;
  /** "언제 할까요?"에서 [없음]을 눌렀는지(#691). onNextNone이 있을 때만 단추가 보인다. */
  nextNone?: boolean;
  onNextNone?: (none: boolean) => void;
  /** 묶음에서 보이지 않게 할 질문(#691 거절 바로 마무리: 화면이 답을 대신 싣는 질문). 답은 그대로 보낸다. */
  hideQuestionIds?: string[];
  /** 질문별로 보이지 않게 할 보기(#691 "아직 끝 아님"에서는 "끝"을 뺀다). */
  hideAnswerIds?: Record<string, string[]>;
  /** 묶음 위 한 줄을 바꿔 쓸 때(#691). */
  stepLine?: string;
  /** 한 통화에 보이는 통화 내용 질문 수(#691, 설정 records.questionsPerContact). 없으면 접지 않는다. */
  limit?: number | null;
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
  nextDate = '',
  onNextDate,
  nextDateMin,
  nextNone = false,
  onNextNone,
  hideQuestionIds = [],
  hideAnswerIds = {},
  stepLine,
  limit = null,
}: SalesQuestionFieldsProps) {
  // [지금 더 묻기]를 눌렀는지(#691). 저장하면 묶음이 새로 그려져 다시 접힌다.
  const [askMore, setAskMore] = useState(false);
  // 이미 확정된 공정·산업은 다시 묻지 않고 한 줄로 보인다(#691). [바꾸기]를 누른 질문만 펼친다.
  const [changing, setChanging] = useState<string[]>([]);
  const all = visibleQuestions(questions, step, picked, allOnly);
  const unhidden = all.filter((question) => !hideQuestionIds.includes(question.questionId));
  const folded = askMore ? [] : foldedQuestionIds(unhidden, picked, limit);
  const shown = unhidden.filter((question) => !folded.includes(question.questionId));
  if (shown.length === 0 && folded.length === 0) return null;
  const nextAction = onNextDate ? nextActionPick(questions, all, picked) : null;
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
        {stepLine
          ? stepLine
          : allOnly
            ? salesQuestionTexts.stepLineDeclined
            : step?.code
              ? salesQuestionTexts.stepLine(stepLabel(step.code))
              : salesQuestionTexts.stepLineFirst(stepLabel('NOT_REACHED'))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: typography.fontSizeSecondary }}>
        {salesQuestionTexts.questionsHint}
      </Typography.Text>
      <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
        {shown.map((question) => {
          const confirmed = question.choices ? confirmedLabels(question, marks) : [];
          const isChanging = changing.includes(question.questionId);
          if (confirmed.length > 0 && !isChanging) {
            // 누르지 않고 저장하면 이 질문의 답을 보내지 않는다(남은 AI 제안은 그대로, #652 규칙).
            return (
              <div
                key={question.questionId}
                data-testid={`sales-question-${question.questionId}`}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
              >
                <span data-testid={`sales-choice-confirmed-${question.questionId}`}>
                  {salesChoiceTexts.confirmedLine(confirmed.join(', '))}
                </span>
                <Button
                  size="small"
                  disabled={disabled}
                  aria-label={`${question.text} ${salesChoiceTexts.change}`}
                  onClick={() => setChanging((ids) => [...ids, question.questionId])}
                  data-testid={`sales-choice-change-${question.questionId}`}
                >
                  {salesChoiceTexts.change}
                </Button>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: typography.fontSizeSecondary }}
                >
                  {question.text}
                </Typography.Text>
              </div>
            );
          }
          return (
            <div key={question.questionId} data-testid={`sales-question-${question.questionId}`}>
              <div
                id={`sales-question-label-${question.questionId}`}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}
              >
                <span>{question.text}</span>
                {confirmed.length > 0 ? (
                  <Button
                    size="small"
                    type="link"
                    disabled={disabled}
                    onClick={() => {
                      onPickMany?.(question.questionId, []);
                      setChanging((ids) => ids.filter((id) => id !== question.questionId));
                    }}
                    data-testid={`sales-choice-keep-${question.questionId}`}
                    style={{ padding: 0, height: 'auto' }}
                  >
                    {salesChoiceTexts.changeClose}
                  </Button>
                ) : null}
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
                    options={question.answers
                      .filter(
                        (option) =>
                          !(hideAnswerIds[question.questionId] ?? []).includes(option.answerId),
                      )
                      .map((option) => ({ value: option.answerId, label: option.label }))}
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
              {/* 끝이 아닌 할 일을 고르면 날짜를 이어서 묻는다(#683). 날짜는 눌러 여는 달력 대신 바로 고르게
                펼쳐 보이고, 없으면 [없음]으로 지나간다(#691). 비워 두면 일정은 그대로다. */}
              {nextAction?.questionId === question.questionId ? (
                <div
                  data-testid="sales-next-date-field"
                  style={{ display: 'grid', gap: 4, marginTop: 8 }}
                >
                  <span>{salesQuestionTexts.nextDateLabel}</span>
                  <QuickDate
                    value={nextDate}
                    onChange={(value) => onNextDate?.(value)}
                    from={nextDateMin ?? ''}
                    inputMin={nextDateMin}
                    none={nextNone}
                    onNone={onNextNone}
                    disabled={disabled}
                    label={salesQuestionTexts.nextDateLabel}
                    inputTestId="sales-next-date"
                    testId="sales-next-quick"
                  />
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: typography.fontSizeSecondary }}
                  >
                    {salesQuestionTexts.nextDateHint}
                  </Typography.Text>
                </div>
              ) : null}
            </div>
          );
        })}
        {/* 넘는 질문은 접어 둔다(#691). 답이 없으니 다음 통화에서 다시 나온다. 지금 다 물어도 된다. */}
        {folded.length > 0 ? (
          <div
            data-testid="sales-questions-more"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
          >
            <Typography.Text type="secondary" style={{ fontSize: typography.fontSizeSecondary }}>
              {salesQuestionTexts.moreQuestions(folded.length)}
            </Typography.Text>
            <Button
              size="small"
              disabled={disabled}
              onClick={() => setAskMore(true)}
              data-testid="sales-questions-more-button"
            >
              {salesQuestionTexts.askMoreNow}
            </Button>
          </div>
        ) : null}
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
  // 접촉 자체에 대한 답("누가 먼저 연락했나요?" #691)은 회사에 대해 알아낸 것이 아니라서 뺀다.
  const aboutContact = new Set(contactQuestionsOf(questions).map((item) => item.questionId));
  const known = (step?.known ?? []).filter((item) => !aboutContact.has(item.questionId));
  return (
    <div data-testid="sales-step-summary" style={{ display: 'grid', gap: 4 }}>
      <span>
        <strong>{salesQuestionTexts.summaryTitle}</strong>:{' '}
        <span data-testid="sales-step-current">{current}</span>
        {step?.overridden ? <span style={hint}> ({salesQuestionTexts.overridden})</span> : null}
      </span>
      <span data-testid="sales-step-known">
        {salesQuestionTexts.known}:{' '}
        {known.length > 0 ? knownLines(known).join(' · ') : salesQuestionTexts.knownNone}
      </span>
      {unknown.length > 0 ? (
        <span data-testid="sales-step-unknown" style={hint}>
          {salesQuestionTexts.unknown}: {unknown.join(' · ')}
        </span>
      ) : null}
    </div>
  );
}
