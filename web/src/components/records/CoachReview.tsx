// 영업 코치 확인 화면(#742 → #985, PM 결정 2026-11-29 시안 "기록 남기기 — 만들 흐름" 다 · 라).
// [보내기 유료] 뒤 "AI가 정리한 것 · 확인 전" 상자. 아무것도 저절로 저장하지 않는다 — [이대로 저장]을 눌러야
// 부모(기록 칸)가 기존 저장 창구(/outcomes)를 부른다. 모달 · 서랍 없이 그 자리에서 편다.
//   사실 줄: 요약 / 방향(발신 · 수신, [수신으로 바꾸기] — 비용 없음) / 날짜("11/29 (오늘)" [바꾸기], 오늘까지만)
//           / 반응(영업 코치가 메모에서 읽었을 때만, [바꾸기]) / 다음("12/4 (금) 다시 연락 (메모에서 읽음)" [바꾸기])
//   AI가 채운 답(위 사실 줄에 올린 것은 뺀 나머지) · AI 제안([이대로 고르기], 미리 고르지 않음)
//   끝난 결과 제안 상자: "제안: 이 회사를 거절로 끝낼까요? [이대로 고르기] [아니요, 계속 진행]" — AI가 혼자 끝내지 않는다.
//   빠진 것: 질문마다 보기 단추 + [×](건너뛰기) → "건너뜀 [되돌리기]". 건너뛴 질문의 답은 싣지 않는다.
//           모두 건너뛰어도 저장된다. 거절 이유를 건너뛰면 거절로 넘기지 않고 접촉만 저장한다.
//   상대 반응의 "기타"를 고르면 한 줄 입력 칸 → 저장할 때 메모 끝에 " / 좋게 본 부분: {글}"로 덧붙인다(약속 변경 없음).
//   코치 피드백 · 찾아본 것 · 비슷한 성사 사례 · 다음 통화에 물어볼 것(#750 · #915 · #916)은 전과 같다.
// 질문 id는 되도록 화면에 고정하지 않는다(끝난 결과 · 다음 할 일 · 방향은 질문 파일의 모양으로 찾는다).
// 상대 반응 질문만은 모양으로 가릴 표시가 없어 id(REACTION)로 찾는다 — 꼬리 질문 파일의 id는 한 번 쓰면 바꾸지 않는다.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Typography } from 'antd';
import type { CoachResult } from '../../api/coach';
import type { ContactMethod, SalesQuestion, SalesQuestions, SalesStep } from '../../api/types';
import {
  coachTexts as texts,
  memoReadTexts,
  quickRecordTexts as quick,
  salesQuestionTexts,
} from '../../labels/ko';
import { accent, colors, neutralChip, radius, typography, warn } from '../../theme/tokens';
import { formatMonthDay, todayKst } from '../../utils/time';
import ChoiceChips, { choiceChipStyle } from './ChoiceChips';
import { findContact } from './contactGuard';
import QuickDate from './QuickDate';
import { coachStepAfter, met } from './SalesCoach';
import { closingPick, closingRouteOf, contactQuestionsOf, nextActionPick } from './SalesQuestions';

/** 상대 반응 질문(#985)의 id. 그 꼬리(좋게 본 부분 · 걸린 부분)는 showWhen이 이 질문을 가리키는 질문이다. */
export const REACTION_QUESTION_ID = 'REACTION';
/** 상대 반응 꼬리 질문의 "기타" 보기 id. 고르면 한 줄 입력 칸이 열린다. */
export const OTHER_ANSWER_ID = 'OTHER';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const small = { color: colors.textDimmed, fontSize: typography.fontSizeSecondary - 1.5 } as const;
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } as const;
const linkStyle: CSSProperties = {
  flex: 'none',
  border: 0,
  padding: 0,
  background: 'none',
  color: accent.text,
  font: 'inherit',
  fontSize: typography.fontSizeSecondary - 1,
  textDecoration: 'underline',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function buttonStyle(primary: boolean, off: boolean): CSSProperties {
  return {
    padding: '6px 12px',
    borderRadius: radius.controlSm,
    border: primary ? 0 : `1px solid ${colors.border}`,
    background: primary ? accent.bg : colors.bgContainer,
    color: primary ? accent.onBg : colors.text,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    whiteSpace: 'nowrap',
    cursor: off ? 'not-allowed' : 'pointer',
    opacity: off ? 0.55 : 1,
  };
}

/** "12/4 (금)" */
function dayLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${formatMonthDay(date) ?? date} (${salesQuestionTexts.weekdays[weekday]})`;
}

/** 확인 화면에서 고른 것. 부모가 저장 요청이나 [고치기] 양식으로 바꾼다. */
export interface CoachSelection {
  /** 보기 하나를 고르는 질문의 답(방향 "누가 먼저 연락했나" 포함). 건너뛴 질문은 없다. */
  single: Record<string, string>;
  /** 공정·산업처럼 여러 개를 고르는 질문의 답. */
  many: Record<string, string[]>;
  /** AI가 채운 답. 그대로 저장하면 "AI가 채움(AI_CONFIRMED)", 바꿨으면 AI_CHANGED로 남는다. */
  aiFilled: Record<string, string[]>;
  /** 다음 일정 날짜(YYYY-MM-DD). 없으면 빈 값. */
  nextDate: string;
  /** 저장 때 남길 피드백 줄(#750부터 코치가 준 줄 모두). */
  advice: string[];
  /** (#750) 저장 때 다음 통화 준비로 남길 줄. */
  nextCall: string[];
  /** 접촉 날짜(YYYY-MM-DD, 오늘까지). */
  attemptedAt: string;
  /** 메모 끝에 덧붙일 글(상대 반응 "기타" 한 줄). 없으면 빈 글. */
  memoAdd: string;
}

function labelOf(question: SalesQuestion | undefined, answerId: string): string {
  return question?.answers.find((option) => option.answerId === answerId)?.label ?? answerId;
}

function sameIds(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value) => right.includes(value));
}

export interface CoachReviewProps {
  questions: SalesQuestions;
  result: CoachResult;
  /** 이 기록의 종류(통화 · 메일 · 대면). 방향의 쉬운 말을 고른다. */
  method: ContactMethod;
  /** 저장할 메모(다듬은 글). 기타 글을 덧붙였을 때 상한을 넘는지 본다. */
  memo: string;
  memoMax: number;
  /** 종류 [메모]에서 보냈을 때 제목에 붙는 종류 이름("대면"). */
  asKind?: string | null;
  /** 오늘(YYYY-MM-DD, 한국). 안 주면 지금 시각으로 센다. */
  today?: string;
  disabled?: boolean;
  saving?: boolean;
  onSave: (selection: CoachSelection) => void;
  onEdit: (selection: CoachSelection) => void;
}

export function CoachReview({
  questions,
  result,
  method,
  memo,
  memoMax,
  asKind = null,
  today: todayProp,
  disabled = false,
  saving = false,
  onSave,
  onEdit,
}: CoachReviewProps) {
  const today = todayProp ?? todayKst();
  const byId = new Map(questions.questions.map((question) => [question.questionId, question]));
  const filled = result.answers.filter((item) => item.fill === 'AI' && byId.has(item.questionId));
  const suggested = result.answers.filter(
    (item) => item.fill === 'SUGGEST' && byId.has(item.questionId),
  );
  // 끝난 결과("끝 → 어떻게 끝났나요?")와 그 꼬리(거절 이유)는 제안 상자로 따로 다룬다.
  const route = closingRouteOf(questions);
  const closingItem = route
    ? suggested.find((item) => item.questionId === route.closingId)
    : undefined;
  const closingFamily = new Set<string>();
  if (route) {
    closingFamily.add(route.closingId);
    for (const question of questions.questions) {
      if (question.showWhen && route.closingId in question.showWhen.answers) {
        closingFamily.add(question.questionId);
      }
    }
  }
  const genericSuggested = suggested.filter((item) => !closingFamily.has(item.questionId));
  const genericSuggestedIds = new Set(genericSuggested.map((item) => item.questionId));
  const reactionFamily = new Set<string>(
    byId.has(REACTION_QUESTION_ID)
      ? [
          REACTION_QUESTION_ID,
          ...questions.questions
            .filter(
              (question) => question.showWhen && REACTION_QUESTION_ID in question.showWhen.answers,
            )
            .map((question) => question.questionId),
        ]
      : [],
  );
  const direction = contactQuestionsOf(questions)[0] ?? null;

  // 담당자가 고른 것: 제안을 받아들임 / 끝난 결과 제안의 답 / 질문의 답 / 건너뛴 질문 / 방향 · 날짜 · 다음 일정.
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const [closeChoice, setCloseChoice] = useState<'TAKEN' | 'DECLINED' | null>(null);
  const [answered, setAnswered] = useState<Record<string, string[]>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [directionPick, setDirectionPick] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [dateOpen, setDateOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(false);
  // null이면 영업 코치가 메모에서 읽은 날짜를 그대로 쓴다. 한 번 손대면 그 값(빈 글 = 날짜 없음).
  const [nextDateEdit, setNextDateEdit] = useState<string | null>(null);
  const [nextNone, setNextNone] = useState(false);
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const aiFilled: Record<string, string[]> = {};
  for (const item of filled) aiFilled[item.questionId] = item.answerIds;
  const isEnd = (values: string[] | undefined) =>
    Boolean(route && (values ?? []).some((value) => route.endAnswerIds.includes(value)));

  const chosen: Record<string, string[]> = { ...aiFilled };
  for (const item of genericSuggested) {
    if (taken[item.questionId]) chosen[item.questionId] = item.answerIds;
  }
  if (route && closingItem) {
    if (closeChoice === 'TAKEN') {
      chosen[route.closingId] = closingItem.answerIds;
      // 서버는 끝내는 답을 "다음 할 일 = 끝"과 같은 요청에서만 받는다(#643). 없으면 화면이 함께 싣는다.
      if (!isEnd(chosen[route.openerId])) chosen[route.openerId] = [route.endAnswerIds[0]];
    } else if (closeChoice === 'DECLINED' && isEnd(chosen[route.openerId])) {
      // 계속 진행이면 "끝"은 맞지 않는다: 빼고 "다음 할 일"을 다시 묻는다.
      delete chosen[route.openerId];
    }
  }
  for (const [questionId, values] of Object.entries(answered)) {
    if (values.length > 0) chosen[questionId] = values;
    else delete chosen[questionId];
  }
  for (const [questionId, on] of Object.entries(skipped)) {
    if (on) delete chosen[questionId];
  }
  // 접촉마다 묻는 꼬리(좋게 본 부분 · 거절 이유 등)는 앞 답이 바뀌면 함께 빠진다.
  for (let changed = true; changed;) {
    changed = false;
    for (const question of questions.questions) {
      if (
        question.step === 'ALL' &&
        question.showWhen &&
        chosen[question.questionId] &&
        !met(question.showWhen.answers, chosen)
      ) {
        delete chosen[question.questionId];
        changed = true;
      }
    }
  }
  const directionDefault =
    direction?.answers.find((option) => option.default)?.answerId ??
    direction?.answers[0]?.answerId ??
    null;
  const directionAi = direction ? aiFilled[direction.questionId]?.[0] : undefined;
  const directionNow = directionPick ?? directionAi ?? directionDefault;
  if (direction && directionNow) chosen[direction.questionId] = [directionNow];

  const single: Record<string, string> = {};
  const many: Record<string, string[]> = {};
  for (const [questionId, values] of Object.entries(chosen)) {
    if (byId.get(questionId)?.choices) many[questionId] = values;
    else if (values[0]) single[questionId] = values[0];
  }

  const closing = closingPick(questions.questions, single);
  const reasonQuestion = questions.questions.find((question) =>
    question.answers.some((option) => option.lostReason),
  );
  // 거절 이유를 건너뛰면 거절로 넘기지 않는다: 끝난 결과와 "끝"을 저장에서 빼고 접촉만 남긴다.
  const reasonSkipped = Boolean(
    route &&
    reasonQuestion &&
    skipped[reasonQuestion.questionId] &&
    closing?.status === 'LOST' &&
    closing.lostReasonCode === null,
  );
  const closingNeedsReason =
    closing?.status === 'LOST' && closing.lostReasonCode === null && !reasonSkipped;
  const nextAction = nextActionPick(questions, questions.questions, single);
  const schedule = result.nextSchedule;
  const scheduleMatches = Boolean(
    schedule && nextAction && single[nextAction.questionId] === schedule.actionId && !closing,
  );
  const coachDate = scheduleMatches && schedule?.date ? schedule.date : '';
  const nextDate = nextAction && !closing ? (nextDateEdit ?? coachDate) : '';

  // 빠진 것: 서버가 규칙으로 계산한 것 + 지금 답으로 새로 열린 "접촉마다" 필수 질문 + [바꾸기]로 편 상대 반응
  // + "계속 진행"을 골라 다시 묻는 "다음 할 일". 질문 파일 순서(상대 반응을 고르면 그 꼬리가 바로 아래 열린다).
  const openerReasked = Boolean(
    route && closingItem && closeChoice === 'DECLINED' && isEnd(aiFilled[route.openerId]),
  );
  const listed = questions.questions.filter((question) => {
    const id = question.questionId;
    if (direction && id === direction.questionId) return false;
    if (genericSuggestedIds.has(id)) return false;
    if (route && closingItem && id === route.closingId) return false;
    const everyContact = question.step === 'ALL' && Boolean(question.showWhen);
    if (everyContact && !met(question.showWhen?.answers ?? {}, chosen)) return false;
    const reopened = reactionOpen && reactionFamily.has(id);
    const reasked = openerReasked && id === route?.openerId;
    if (reopened || reasked) return true;
    if (aiFilled[id]) return false;
    return (
      result.missingRequired.includes(id) || (everyContact && Boolean(question.coach?.required))
    );
  });
  const listedIds = new Set(listed.map((question) => question.questionId));

  // 사실 줄에 올린 답(방향 · 반응 · 다음)과 바뀐 답은 "AI가 채운 답" 목록에서 뺀다.
  const reactionRead = Boolean(aiFilled[REACTION_QUESTION_ID]);
  const filledShown = filled.filter((item) => {
    const id = item.questionId;
    if (direction && id === direction.questionId) return false;
    if (reactionFamily.has(id)) return false;
    if (nextAction && id === nextAction.questionId) return false;
    return sameIds(chosen[id], item.answerIds);
  });

  // 상대 반응 "기타" 한 줄: 저장할 때 메모 끝에 덧붙인다.
  const otherParts = questions.questions
    .filter(
      (question) =>
        reactionFamily.has(question.questionId) &&
        question.questionId !== REACTION_QUESTION_ID &&
        (chosen[question.questionId] ?? []).includes(OTHER_ANSWER_ID) &&
        (otherText[question.questionId] ?? '').trim() !== '',
    )
    .map((question) => ({
      keyword: question.coach?.keyword ?? question.text,
      text: (otherText[question.questionId] ?? '').trim(),
    }));
  const memoAdd = otherParts.map((part) => quick.otherMemo(part.keyword, part.text)).join('');
  const memoOverBy = memo.length + memoAdd.length - memoMax;
  const memoOver = memoAdd !== '' && memoOverBy > 0;
  const otherTyped = otherParts.reduce((sum, part) => sum + part.text.length, 0);
  const otherHasContact = otherParts.some((part) => findContact(part.text) !== null);

  const dateError = date === '' ? quick.dateEmpty : date > today ? quick.dateFuture : null;

  const saveSingle = { ...single };
  if (reasonSkipped && route) {
    delete saveSingle[route.closingId];
    if (route.endAnswerIds.includes(saveSingle[route.openerId])) delete saveSingle[route.openerId];
  }
  const selection: CoachSelection = {
    single: saveSingle,
    many,
    aiFilled,
    nextDate,
    advice: result.feedback,
    nextCall: result.nextCall ?? [],
    attemptedAt: date,
    memoAdd,
  };

  const stepAfter = coachStepAfter(questions, result.stepBefore, chosen);
  const stepLabel = (code: SalesStep) =>
    questions.steps.find((item) => item.code === code)?.label ?? code;
  const directionLabel = (answerId: string) =>
    salesQuestionTexts.contactDirectionLabels[method]?.[answerId] ??
    labelOf(direction ?? undefined, answerId);
  const directionOther =
    direction && directionNow
      ? (direction.answers.find((option) => option.answerId !== directionNow)?.answerId ?? null)
      : null;

  function pick(question: SalesQuestion, answerId: string) {
    const current = chosen[question.questionId] ?? [];
    // 여러 개를 고르는 것은 공정 · 산업뿐이다(소재는 하나, #958).
    const multiple = question.choices === 'PROCESS' || question.choices === 'INDUSTRY';
    const next = multiple
      ? current.includes(answerId)
        ? current.filter((value) => value !== answerId)
        : [...current, answerId]
      : current[0] === answerId
        ? []
        : [answerId];
    setAnswered((previous) => ({ ...previous, [question.questionId]: next }));
  }

  function fact(key: string, label: string, value: ReactNode, action?: ReactNode) {
    return (
      <div
        data-testid={`coach-fact-${key}`}
        style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}
      >
        <span style={{ ...small, flex: 'none', width: 44 }}>{label}</span>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
        {action}
      </div>
    );
  }

  const reactionValues = [...reactionFamily]
    .filter((id) => chosen[id])
    .map((id) => (chosen[id] ?? []).map((answerId) => labelOf(byId.get(id), answerId)).join(', '));
  const reactionUntouched = [...reactionFamily].every(
    (id) => !chosen[id] || sameIds(chosen[id], aiFilled[id]),
  );
  const saveBlocked =
    disabled || closingNeedsReason || dateError !== null || memoOver || otherHasContact;
  // "제안: 이 회사를 거절로 끝낼까요?" — 끝난 결과의 쉬운 말(성사 · 거절 · 보류).
  const closeAskText =
    route && closingItem
      ? quick.closeAsk(
          closingItem.answerIds
            .map(
              (answerId) =>
                quick.closeLabels[
                  route.options.find((option) => option.answerId === answerId)?.closes ?? ''
                ] ?? labelOf(byId.get(route.closingId), answerId),
            )
            .join(', '),
        )
      : '';

  return (
    <section
      data-testid="coach-review"
      aria-label={texts.title}
      style={{
        display: 'grid',
        gap: 10,
        padding: 12,
        border: `1px solid ${accent.border}`,
        borderRadius: radius.control,
        background: accent.soft,
        minWidth: 0,
      }}
    >
      <Typography.Text strong data-testid="coach-review-title">
        {texts.title}
        {asKind ? quick.titleAs(asKind) : ''}
      </Typography.Text>

      <div style={{ display: 'grid', gap: 5, fontSize: typography.fontSizeSecondary }}>
        {result.summary ? (
          <div data-testid="coach-summary" style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <span style={{ ...small, flex: 'none', width: 44 }}>{quick.factSummary}</span>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{result.summary}</span>
          </div>
        ) : null}
        {direction && directionNow
          ? fact(
              'direction',
              quick.factDirection,
              <>
                {directionLabel(directionNow)}{' '}
                {directionPick === null && directionAi ? (
                  <span style={small}>{quick.fromMemo}</span>
                ) : directionNow === directionDefault ? (
                  <span style={small}>{quick.directionOurs}</span>
                ) : null}
              </>,
              directionOther ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setDirectionPick(directionOther)}
                  data-testid="coach-direction-switch"
                  style={linkStyle}
                >
                  {quick.directionSwitch(directionLabel(directionOther))}
                </button>
              ) : null,
            )
          : null}
        {fact(
          'date',
          quick.factDate,
          <>
            {date === '' ? '—' : (formatMonthDay(date) ?? date)}
            {date === today ? ` ${quick.today}` : ''}
          </>,
          <button
            type="button"
            disabled={disabled}
            aria-expanded={dateOpen}
            onClick={() => setDateOpen((open) => !open)}
            data-testid="coach-date-change"
            style={linkStyle}
          >
            {dateOpen ? quick.changeClose : quick.change}
          </button>,
        )}
        {dateOpen ? (
          <input
            type="date"
            aria-label={quick.dateLabel}
            aria-invalid={dateError ? 'true' : undefined}
            value={date}
            max={today}
            disabled={disabled}
            onChange={(event) => setDate(event.target.value)}
            data-testid="coach-date-input"
            style={{
              justifySelf: 'start',
              padding: '5px 8px',
              border: `1px solid ${dateError ? colors.error : colors.border}`,
              borderRadius: radius.controlSm,
              background: colors.bgContainer,
              color: colors.text,
              font: 'inherit',
              fontSize: typography.fontSizeSecondary,
            }}
          />
        ) : null}
        {dateError ? (
          <span role="alert" data-testid="coach-date-error" style={{ color: colors.error }}>
            {dateError}
          </span>
        ) : null}
        {reactionRead
          ? fact(
              'reaction',
              quick.factReaction,
              <>
                {reactionValues.length > 0
                  ? reactionValues.join(' · ')
                  : skipped[REACTION_QUESTION_ID]
                    ? quick.skipped
                    : '—'}{' '}
                {reactionValues.length > 0 && reactionUntouched ? (
                  <span style={small}>{quick.fromMemo}</span>
                ) : null}
              </>,
              <button
                type="button"
                disabled={disabled}
                aria-expanded={reactionOpen}
                onClick={() => setReactionOpen((open) => !open)}
                data-testid="coach-reaction-change"
                style={linkStyle}
              >
                {reactionOpen ? quick.changeClose : quick.change}
              </button>,
            )
          : null}
        {nextAction && !closing
          ? fact(
              'next',
              quick.factNext,
              <>
                {nextDate
                  ? `${dayLabel(nextDate)} ${nextAction.label}`
                  : `${nextAction.label} · ${quick.nextNoDate}`}{' '}
                {nextDate !== '' && nextDateEdit === null ? (
                  <span style={small}>{quick.fromMemo}</span>
                ) : null}
              </>,
              <button
                type="button"
                disabled={disabled}
                aria-expanded={nextOpen}
                onClick={() => setNextOpen((open) => !open)}
                data-testid="coach-next-change"
                style={linkStyle}
              >
                {nextOpen ? quick.changeClose : nextDate ? quick.change : quick.nextSetDate}
              </button>,
            )
          : null}
        {nextAction && !closing && nextOpen ? (
          <div data-testid="coach-next-editor" style={{ display: 'grid', gap: 8 }}>
            {/* 다음 할 일이 "빠진 것"에 나와 있으면 거기서 고르고, 여기서는 날짜만 고른다. */}
            {listedIds.has(nextAction.questionId) ? null : (
              <ChoiceChips
                label={quick.nextActionLabel}
                value={single[nextAction.questionId] ?? null}
                disabled={disabled}
                onChange={(value) =>
                  setAnswered((previous) => ({ ...previous, [nextAction.questionId]: [value] }))
                }
                options={(byId.get(nextAction.questionId)?.answers ?? [])
                  .filter((option) => !route?.endAnswerIds.includes(option.answerId))
                  .map((option) => ({ value: option.answerId, label: option.label }))}
                testId="coach-next-action"
              />
            )}
            <QuickDate
              value={nextDate}
              onChange={setNextDateEdit}
              from={today}
              min={today}
              none={nextNone}
              onNone={setNextNone}
              disabled={disabled}
              label={quick.nextDateLabel}
              testId="coach-next-quick"
            />
          </div>
        ) : null}
      </div>

      <span data-testid="coach-step" style={secondary}>
        {stepAfter === result.stepBefore
          ? texts.stepSame(stepLabel(result.stepBefore))
          : texts.stepMove(stepLabel(result.stepBefore), stepLabel(stepAfter))}
      </span>
      {result.removedNames + result.removedContacts > 0 ? (
        <span style={secondary} data-testid="coach-removed">
          {memoReadTexts.removed(result.removedNames, result.removedContacts)}
        </span>
      ) : null}

      {filledShown.length > 0 ? (
        <div style={{ display: 'grid', gap: 4 }}>
          <Typography.Text>{texts.filledTitle}</Typography.Text>
          <ul style={{ margin: 0, paddingLeft: 20 }} data-testid="coach-filled">
            {filledShown.map((item) => {
              const question = byId.get(item.questionId);
              return (
                <li key={item.questionId} data-testid={`coach-filled-${item.questionId}`}>
                  {question?.text}{' '}
                  <strong>
                    {item.answerIds.map((answerId) => labelOf(question, answerId)).join(', ')}
                  </strong>{' '}
                  <span
                    data-testid="coach-filled-mark"
                    style={{
                      ...secondary,
                      border: `1px solid ${colors.border}`,
                      borderRadius: radius.tag,
                      padding: '0 4px',
                      background: colors.bgContainer,
                    }}
                  >
                    {texts.filledMark}
                  </span>{' '}
                  {item.quote ? <span style={secondary}>{texts.quote(item.quote)}</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {route && closingItem ? (
        <div
          role="group"
          aria-label={closeAskText}
          data-testid={`coach-suggest-${route.closingId}`}
          style={{
            display: 'grid',
            gap: 6,
            padding: '9px 10px',
            borderRadius: radius.controlSm,
            border: `1px solid ${warn.border}`,
            background: warn.bg,
          }}
        >
          <span>
            {closeAskText}{' '}
            {closingItem.quote ? <span style={small}>{texts.quote(closingItem.quote)}</span> : null}
          </span>
          <div style={rowStyle}>
            <button
              type="button"
              aria-pressed={closeChoice === 'TAKEN'}
              disabled={disabled}
              onClick={() => {
                const on = closeChoice !== 'TAKEN';
                setCloseChoice(on ? 'TAKEN' : null);
                // "계속 진행"에서 고른 다음 할 일은 "끝"과 맞지 않으니 지운다.
                if (on) {
                  setAnswered((previous) => {
                    const next = { ...previous };
                    delete next[route.openerId];
                    return next;
                  });
                }
              }}
              data-testid={`coach-suggest-pick-${route.closingId}`}
              style={buttonStyle(closeChoice === 'TAKEN', disabled)}
            >
              {closeChoice === 'TAKEN' ? texts.suggestPicked : texts.suggestPick}
            </button>
            <button
              type="button"
              aria-pressed={closeChoice === 'DECLINED'}
              disabled={disabled}
              onClick={() => setCloseChoice(closeChoice === 'DECLINED' ? null : 'DECLINED')}
              data-testid={`coach-suggest-decline-${route.closingId}`}
              style={{
                ...buttonStyle(false, disabled),
                ...(closeChoice === 'DECLINED'
                  ? { borderColor: accent.border, color: accent.text, fontWeight: 600 }
                  : {}),
              }}
            >
              {quick.closeDecline}
            </button>
          </div>
        </div>
      ) : null}

      {genericSuggested.length > 0 ? (
        <div style={{ display: 'grid', gap: 4 }} data-testid="coach-suggestions">
          <Typography.Text>{texts.suggestTitle}</Typography.Text>
          {genericSuggested.map((item) => {
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
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => setTaken((previous) => ({ ...previous, [item.questionId]: !on }))}
                  data-testid={`coach-suggest-pick-${item.questionId}`}
                  style={choiceChipStyle(on, disabled)}
                >
                  {on ? texts.suggestPicked : texts.suggestPick}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {listed.length > 0 ? (
        <div data-testid="coach-missing" style={{ display: 'grid' }}>
          <span
            style={{
              color: warn.text,
              fontSize: typography.fontSizeSecondary - 1,
              fontWeight: 600,
            }}
          >
            {quick.missingTitle}
          </span>
          {listed.map((question) => {
            const id = question.questionId;
            const rowBase: CSSProperties = {
              padding: '8px 0',
              borderTop: `1px solid ${colors.borderSecondary}`,
              marginTop: 6,
            };
            if (skipped[id]) {
              return (
                <div
                  key={id}
                  role="group"
                  aria-label={question.text}
                  data-testid={`coach-missing-${id}`}
                  data-skipped="true"
                  style={{ ...rowBase, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span style={{ ...secondary, textDecoration: 'line-through' }}>
                    {question.text}
                  </span>
                  <span
                    style={{
                      fontSize: typography.fontSizeSecondary - 2,
                      color: neutralChip.text,
                      background: neutralChip.bg,
                      borderRadius: radius.tag,
                      padding: '0 6px',
                    }}
                  >
                    {quick.skipped}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setSkipped((previous) => ({ ...previous, [id]: false }))}
                    data-testid={`coach-skip-undo-${id}`}
                    style={{ ...linkStyle, marginLeft: 'auto' }}
                  >
                    {quick.undoSkip}
                  </button>
                </div>
              );
            }
            const values = chosen[id] ?? [];
            const hint = suggested.find((item) => item.questionId === id);
            const otherOn =
              reactionFamily.has(id) &&
              id !== REACTION_QUESTION_ID &&
              values.includes(OTHER_ANSWER_ID);
            return (
              <div
                key={id}
                role="group"
                aria-label={question.text}
                data-testid={`coach-missing-${id}`}
                style={rowBase}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {question.text}{' '}
                    {id === REACTION_QUESTION_ID ? (
                      <span
                        data-testid="coach-must-tag"
                        style={{
                          fontSize: typography.fontSizeSecondary - 2.5,
                          color: warn.text,
                          background: warn.bg,
                          borderRadius: radius.tag,
                          padding: '0 5px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {quick.mustTag}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label={quick.skip}
                    title={quick.skip}
                    disabled={disabled}
                    onClick={() => setSkipped((previous) => ({ ...previous, [id]: true }))}
                    data-testid={`coach-skip-${id}`}
                    style={{
                      flex: 'none',
                      width: 26,
                      height: 26,
                      padding: 0,
                      borderRadius: 7,
                      border: `1px solid ${colors.border}`,
                      background: colors.bgContainer,
                      color: colors.textSecondary,
                      font: 'inherit',
                      fontSize: typography.fontSizeSecondary,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {quick.skipMark}
                  </button>
                </div>
                {hint ? (
                  <div style={small} data-testid={`coach-suggest-hint-${id}`}>
                    {quick.suggestHint(
                      hint.answerIds.map((answerId) => labelOf(question, answerId)).join(', '),
                    )}{' '}
                    {hint.quote ? texts.quote(hint.quote) : ''}
                  </div>
                ) : null}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {question.answers.map((option) => {
                    const on = values.includes(option.answerId);
                    return (
                      <button
                        key={option.answerId}
                        type="button"
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => pick(question, option.answerId)}
                        style={choiceChipStyle(on, disabled)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {otherOn ? (
                  <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                    <input
                      type="text"
                      aria-label={quick.otherLabel}
                      value={otherText[id] ?? ''}
                      maxLength={memoMax}
                      disabled={disabled}
                      onChange={(event) =>
                        setOtherText((previous) => ({ ...previous, [id]: event.target.value }))
                      }
                      data-testid={`coach-other-${id}`}
                      style={{
                        boxSizing: 'border-box',
                        width: '100%',
                        padding: '7px 10px',
                        border: `1px solid ${
                          findContact(otherText[id] ?? '') ? warn.text : accent.border
                        }`,
                        borderRadius: radius.controlSm,
                        background: colors.bgContainer,
                        color: colors.text,
                        font: 'inherit',
                        fontSize: typography.fontSizeSecondary,
                      }}
                    />
                    <span style={small}>{quick.otherHint}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

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

      {otherHasContact ? (
        <div
          role="alert"
          data-testid="coach-other-contact"
          style={{
            padding: '8px 10px',
            border: `1px solid ${warn.border}`,
            borderRadius: radius.controlSm,
            background: warn.bg,
            color: warn.text,
          }}
        >
          <strong>{quick.contactAlertTitle}</strong> {quick.contactAlertBody}
        </div>
      ) : null}
      {memoOver ? (
        <span role="alert" data-testid="coach-memo-over" style={{ color: colors.error }}>
          {quick.memoOver(memoMax, Math.max(0, otherTyped - memoOverBy), memoOverBy)}
        </span>
      ) : null}
      {closingNeedsReason ? (
        <span data-testid="coach-close-blocked" style={{ color: colors.error }}>
          {salesQuestionTexts.closeNeedsReason}
        </span>
      ) : null}
      {closing?.status === 'LOST' && route ? (
        <span
          data-testid="coach-close-skip-notice"
          data-active={reasonSkipped ? 'true' : undefined}
          style={reasonSkipped ? { color: warn.text, fontWeight: 600 } : small}
        >
          {quick.closeSkipNotice}
        </span>
      ) : null}
      {result.feedback.length > 0 || selection.nextCall.length > 0 ? (
        <span style={secondary} data-testid="coach-saved-where">
          {texts.savedWhere}
        </span>
      ) : null}
      <div style={rowStyle}>
        <button
          type="button"
          disabled={saveBlocked || saving}
          aria-busy={saving}
          onClick={() => onSave(selection)}
          data-testid="coach-save"
          style={buttonStyle(true, saveBlocked || saving)}
        >
          {texts.save}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit(selection)}
          data-testid="coach-edit"
          style={buttonStyle(false, disabled)}
        >
          {texts.edit}
        </button>
      </div>
      <span style={small} data-testid="coach-save-hint">
        {quick.saveHint}
      </span>
    </section>
  );
}
