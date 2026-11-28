// 영업 코치(#742, PM 결정 2026-11-14): 상세 › 기록 남기기의 "확인사항"과 확인 화면이 같이 쓰는 규칙.
// 확인사항은 규칙이다(AI 아님, 0원): 질문 파일의 coach.required로 지금 세부 단계에서 확인할 것의 짧은 말을 보인다.
// [보내기] 뒤 확인 화면(AI가 채운 답 · 제안 · 빠진 것 · [이대로 저장]/[고치기])은 #985부터 CoachReview.tsx에 있다.
import type { SalesQuestions, SalesStep, SalesStepView } from '../../api/types';
import { coachTexts as texts } from '../../labels/ko';
import { STEP_ORDER } from './SalesQuestions';

/** 조건(showWhen · requiredWhen)의 질문마다 고른 답 가운데 하나라도 맞는가. */
export function met(
  conditions: Record<string, string[]>,
  basis: Record<string, string[]>,
): boolean {
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
