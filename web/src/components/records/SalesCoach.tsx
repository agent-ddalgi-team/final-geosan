// 영업 코치(#742, PM 결정 2026-11-14): 상세 › 기록 남기기의 "확인사항"과 [보내기] 뒤 확인 화면.
// 확인사항은 규칙이다(AI 아님, 0원): 질문 파일의 coach.required로 지금 세부 단계에서 확인할 것의 짧은 말을 보인다.
// 확인 화면은 AI가 채운 답("AI가 채움"), AI 제안(미리 고르지 않음, [이대로 고르기]), 빠진 필수 질문(단추),
// 코치 피드백·다음 통화에 물어볼 것(#750, 고르지 않고 저장 때 모두 남김), 그리고 [이대로 저장]/[고치기]를 보인다.
// 아무것도 저절로 저장하지 않는다. [이대로 저장]을 눌러야 부모(기록 칸)가 기존 저장 창구를 부른다.
import { useState } from 'react';
import { Button, Typography } from 'antd';
import type { CoachResult } from '../../api/coach';
import type { SalesQuestion, SalesQuestions, SalesStep, SalesStepView } from '../../api/types';
import { coachTexts as texts, memoReadTexts, salesQuestionTexts } from '../../labels/ko';
import { colors, radius, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { STEP_ORDER, closingPick, nextActionPick } from './SalesQuestions';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } as const;

function met(conditions: Record<string, string[]>, basis: Record<string, string[]>): boolean {
  return Object.entries(conditions).every(([target, values]) =>
    values.some((value) => (basis[target] ?? []).includes(value)),
  );
}

function order(step: SalesStep): number {
  return STEP_ORDER.indexOf(step);
}

/**
 * (#748) 이 "연결됨" 접촉을 저장하면 갈 세부 단계. 서버 계산과 같은 규칙:
 * 연결 전 질문에 단계를 올리지 않는 보기("다른 부서"·"안내만")를 고르지 않았으면 "연결됨"까지,
 * 그리고 고른 보기의 reaches로 앞으로만 간다.
 */
export function coachStepAfter(
  questions: SalesQuestions,
  before: SalesStep,
  chosen: Record<string, string[]>,
): SalesStep {
  const first = STEP_ORDER[0];
  const reached = STEP_ORDER[1];
  let step = before;
  const held = questions.questions.some(
    (question) =>
      question.step === first &&
      !question.choices &&
      (chosen[question.questionId] ?? []).some((answerId) => {
        const option = question.answers.find((item) => item.answerId === answerId);
        return option !== undefined && !option.reaches;
      }),
  );
  if (!held && order(reached) > order(step)) step = reached;
  for (const question of questions.questions) {
    if (question.choices) continue;
    for (const answerId of chosen[question.questionId] ?? []) {
      const option = question.answers.find((item) => item.answerId === answerId);
      if (option?.reaches && order(option.reaches) > order(step)) step = option.reaches;
    }
  }
  return step;
}

/**
 * 확인사항(규칙, AI 아님): 지금 세부 단계의 필수 질문 가운데 아직 답이 없고 보이는(showWhen) 것,
 * requiredWhen이 맞는 것, 그리고 접촉마다 묻는 필수 질문(조건 없는 것)의 짧은 말. 질문 파일 순서.
 */
export function coachChecklist(
  questions: SalesQuestions | null,
  step: SalesStepView | null,
): string[] {
  const base: SalesStep = step?.code ?? 'NOT_REACHED';
  const known: Record<string, string[]> = {};
  for (const item of step?.known ?? []) {
    (known[item.questionId] ??= []).push(item.answerId);
  }
  return (questions?.questions ?? [])
    .filter((question) => {
      const rule = question.coach;
      if (!rule?.required || !rule.keyword) return false;
      if (question.step === 'ALL') return !question.showWhen;
      const atStep = question.choices
        ? order(question.step) <= order(base)
        : question.step === base;
      if (!atStep || question.questionId in known) return false;
      if (question.showWhen && !met(question.showWhen.answers, known)) return false;
      return !rule.requiredWhen || met(rule.requiredWhen.answers, known);
    })
    .map((question) => question.coach?.keyword ?? '');
}

export function CoachChecklist({
  questions,
  step,
}: {
  questions: SalesQuestions | null;
  step: SalesStepView | null;
}) {
  const keywords = coachChecklist(questions, step);
  if (keywords.length === 0) return null;
  return (
    <div data-testid="coach-checklist" aria-label={texts.checklistLabel}>
      {texts.checklist(keywords)}
    </div>
  );
}

/** 확인 화면에서 고른 것. 부모가 저장 요청이나 [고치기] 양식으로 바꾼다. */
export interface CoachSelection {
  /** 보기 하나를 고르는 질문의 답. */
  single: Record<string, string>;
  /** 공정·산업처럼 여러 개를 고르는 질문의 답. */
  many: Record<string, string[]>;
  /** AI가 채운 답. 그대로 저장하면 "AI가 채움(AI_CONFIRMED)"으로 남는다. */
  aiFilled: Record<string, string[]>;
  /** 다음 일정 날짜(YYYY-MM-DD). 없으면 빈 값. */
  nextDate: string;
  /** 저장 때 남길 피드백 줄(#750부터 코치가 준 줄 모두). */
  advice: string[];
  /** (#750) 저장 때 다음 통화 준비로 남길 줄. */
  nextCall: string[];
}

function labelOf(question: SalesQuestion | undefined, answerId: string): string {
  return question?.answers.find((option) => option.answerId === answerId)?.label ?? answerId;
}

export interface CoachReviewProps {
  questions: SalesQuestions;
  result: CoachResult;
  disabled?: boolean;
  saving?: boolean;
  onSave: (selection: CoachSelection) => void;
  onEdit: (selection: CoachSelection) => void;
}

export function CoachReview({
  questions,
  result,
  disabled,
  saving,
  onSave,
  onEdit,
}: CoachReviewProps) {
  const byId = new Map(questions.questions.map((question) => [question.questionId, question]));
  const filled = result.answers.filter((item) => item.fill === 'AI' && byId.has(item.questionId));
  const suggested = result.answers.filter(
    (item) => item.fill === 'SUGGEST' && byId.has(item.questionId),
  );
  // 담당자가 고른 것: 제안을 받아들임 / 빠진 필수 질문의 답. 피드백·다음 통화는 고르지 않는다(#750).
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const [answered, setAnswered] = useState<Record<string, string[]>>({});

  const aiFilled: Record<string, string[]> = {};
  for (const item of filled) aiFilled[item.questionId] = item.answerIds;
  const chosen: Record<string, string[]> = { ...aiFilled };
  for (const item of suggested)
    if (taken[item.questionId]) chosen[item.questionId] = item.answerIds;
  for (const [questionId, values] of Object.entries(answered)) {
    if (values.length > 0) chosen[questionId] = values;
    else delete chosen[questionId];
  }
  const single: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  for (const [questionId, values] of Object.entries(chosen)) {
    if (byId.get(questionId)?.choices) many[questionId] = values;
    else if (values[0]) single[questionId] = values[0];
  }

  // 빠진 필수 질문: 서버가 규칙으로 계산한 것 + 지금 고른 답으로 새로 열린 "접촉마다" 필수 질문(거절 이유 등).
  const suggestedIds = new Set(suggested.map((item) => item.questionId));
  const missingIds = [
    ...result.missingRequired,
    ...questions.questions
      .filter(
        (question) =>
          question.step === 'ALL' &&
          question.coach?.required &&
          question.showWhen &&
          met(question.showWhen.answers, chosen) &&
          !result.missingRequired.includes(question.questionId),
      )
      .map((question) => question.questionId),
  ].filter(
    (questionId) => byId.has(questionId) && !suggestedIds.has(questionId) && !aiFilled[questionId],
  );
  const missing = missingIds.map((questionId) => byId.get(questionId) as SalesQuestion);

  const closing = closingPick(questions.questions, single);
  const closingNeedsReason = closing?.status === 'LOST' && closing.lostReasonCode === null;
  const nextAction = nextActionPick(questions, questions.questions, single);
  const schedule = result.nextSchedule;
  const scheduleMatches = Boolean(
    schedule && nextAction && single[nextAction.questionId] === schedule.actionId && !closing,
  );

  const selection: CoachSelection = {
    single,
    many,
    aiFilled,
    nextDate: scheduleMatches && schedule?.date ? schedule.date : '',
    advice: result.feedback,
    nextCall: result.nextCall ?? [],
  };

  const stepAfter = coachStepAfter(questions, result.stepBefore, chosen);
  const stepLabel = (code: SalesStep) =>
    questions.steps.find((item) => item.code === code)?.label ?? code;

  function pickMissing(question: SalesQuestion, answerId: string) {
    setAnswered((previous) => {
      const current = previous[question.questionId] ?? [];
      if (!question.choices) {
        return {
          ...previous,
          [question.questionId]: current[0] === answerId ? [] : [answerId],
        };
      }
      return {
        ...previous,
        [question.questionId]: current.includes(answerId)
          ? current.filter((value) => value !== answerId)
          : [...current, answerId],
      };
    });
  }

  return (
    <section
      data-testid="coach-review"
      aria-label={texts.title}
      style={{
        display: 'grid',
        gap: 12,
        padding: 12,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
      }}
    >
      <Typography.Text strong>{texts.title}</Typography.Text>
      {result.summary ? (
        <span data-testid="coach-summary">{texts.summary(result.summary)}</span>
      ) : null}
      <span data-testid="coach-step">
        {stepAfter === result.stepBefore
          ? texts.stepSame(stepLabel(result.stepBefore))
          : texts.stepMove(stepLabel(result.stepBefore), stepLabel(stepAfter))}
      </span>
      {result.removedNames + result.removedContacts > 0 ? (
        <span style={secondary} data-testid="coach-removed">
          {memoReadTexts.removed(result.removedNames, result.removedContacts)}
        </span>
      ) : null}

      <div style={{ display: 'grid', gap: 4 }}>
        <Typography.Text>{texts.filledTitle}</Typography.Text>
        {filled.length === 0 ? (
          <span style={secondary}>{texts.noFilled}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }} data-testid="coach-filled">
            {filled.map((item) => {
              const question = byId.get(item.questionId);
              return (
                <li key={item.questionId} data-testid={`coach-filled-${item.questionId}`}>
                  {question?.text}{' '}
                  <strong>
                    {item.answerIds.map((answerId) => labelOf(question, answerId)).join(', ')}
                  </strong>{' '}
                  <span
                    data-testid="coach-filled-mark"
                    style={{ ...secondary, border: `1px solid ${colors.border}`, padding: '0 4px' }}
                  >
                    {texts.filledMark}
                  </span>{' '}
                  {item.quote ? <span style={secondary}>{texts.quote(item.quote)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        {schedule && nextAction && scheduleMatches ? (
          <span data-testid="coach-schedule">
            {schedule.date
              ? texts.schedule(formatMonthDay(schedule.date) ?? schedule.date, nextAction.label)
              : texts.scheduleNoDate(nextAction.label)}
          </span>
        ) : null}
      </div>

      {suggested.length > 0 ? (
        <div style={{ display: 'grid', gap: 4 }} data-testid="coach-suggestions">
          <Typography.Text>{texts.suggestTitle}</Typography.Text>
          {suggested.map((item) => {
            const question = byId.get(item.questionId);
            const on = Boolean(taken[item.questionId]);
            return (
              <div
                key={item.questionId}
                style={rowStyle}
                data-testid={`coach-suggest-${item.questionId}`}
              >
                <span>
                  {question?.text}{' '}
                  <strong>
                    {item.answerIds.map((answerId) => labelOf(question, answerId)).join(', ')}
                  </strong>{' '}
                  <span style={secondary}>
                    {texts.suggestMark} {item.quote ? texts.quote(item.quote) : ''}
                  </span>
                </span>
                <Button
                  size="small"
                  type={on ? 'primary' : 'default'}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => setTaken((previous) => ({ ...previous, [item.questionId]: !on }))}
                  data-testid={`coach-suggest-pick-${item.questionId}`}
                >
                  {on ? texts.suggestPicked : texts.suggestPick}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 4 }} data-testid="coach-missing">
        <Typography.Text>{texts.missingTitle}</Typography.Text>
        {missing.length === 0 ? (
          <span style={secondary}>{texts.missingNone}</span>
        ) : (
          missing.map((question) => (
            <div
              key={question.questionId}
              role="group"
              aria-label={question.text}
              style={rowStyle}
              data-testid={`coach-missing-${question.questionId}`}
            >
              <span>{question.text}</span>
              {question.answers.map((option) => {
                const on = (answered[question.questionId] ?? []).includes(option.answerId);
                return (
                  <Button
                    key={option.answerId}
                    size="small"
                    type={on ? 'primary' : 'default'}
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => pickMissing(question, option.answerId)}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'grid', gap: 4 }} data-testid="coach-feedback">
        <Typography.Text>{texts.feedbackTitle}</Typography.Text>
        {result.feedback.length === 0 ? (
          <span style={secondary}>{texts.feedbackNone}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {result.feedback.map((line) => (
              <li key={line} data-testid="coach-feedback-line">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(result.lookups ?? []).length > 0 ? (
        <span style={secondary} data-testid="coach-lookups">
          {texts.lookups(result.lookups.map((item) => item.label))}
        </span>
      ) : null}

      {(result.similarCases ?? []).length > 0 ? (
        <div style={{ display: 'grid', gap: 4 }} data-testid="coach-similar">
          <Typography.Text>{texts.similarTitle}</Typography.Text>
          {(result.similarAdvice ?? []).length === 0 ? (
            <span style={secondary}>{texts.similarNone}</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.similarAdvice.map((item) => (
                <li key={item.text} data-testid="coach-similar-line">
                  {/* 저장 전 확인 화면이라 같은 창으로 옮기면 코치 답이 사라진다: 새 창으로 연다. */}
                  <a
                    href={`/opportunities/${encodeURIComponent(item.oppId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={texts.similarOpen(item.name)}
                  >
                    {item.name}
                  </a>
                  {' · '}
                  {item.text}
                </li>
              ))}
            </ul>
          )}
          <span style={secondary} data-testid="coach-similar-basis">
            {texts.similarBasis(
              result.similarCases.map((item) => {
                const shared = [...item.sharedProcesses, ...item.sharedIndustries];
                return shared.length > 0 ? `${item.name}(${shared.join(', ')})` : item.name;
              }),
            )}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 4 }} data-testid="coach-next-call">
        <Typography.Text>{texts.nextCallTitle}</Typography.Text>
        {selection.nextCall.length === 0 ? (
          <span style={secondary}>{texts.nextCallNone}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {selection.nextCall.map((line) => (
              <li key={line} data-testid="coach-next-call-line">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      {closingNeedsReason ? (
        <span data-testid="coach-close-blocked" style={{ color: colors.error }}>
          {salesQuestionTexts.closeNeedsReason}
        </span>
      ) : null}
      {result.feedback.length > 0 || selection.nextCall.length > 0 ? (
        <span style={secondary} data-testid="coach-saved-where">
          {texts.savedWhere}
        </span>
      ) : null}
      <div style={rowStyle}>
        <Button
          type="primary"
          disabled={disabled || closingNeedsReason}
          loading={saving}
          onClick={() => onSave(selection)}
          data-testid="coach-save"
        >
          {texts.save}
        </Button>
        <Button disabled={disabled} onClick={() => onEdit(selection)} data-testid="coach-edit">
          {texts.edit}
        </Button>
      </div>
    </section>
  );
}
