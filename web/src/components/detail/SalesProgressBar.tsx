// 상세 맨 위 단계 진행 막대(#674, PM 결정 2026-11-13): 세부 단계 5개 + 끝 "성사"를 점과 선으로 그린다.
// 지나온 단계는 연한 강조색으로 채운 점(✓), 지금 단계는 진한 강조색 큰 점 + "지금 (11/12부터)", 아직인 단계는 빈 점.
// 끝난 회사: 거절은 멈춘 자리까지 채우고 끝에 "✕ 거절 (가격)"(회색), 보류는 "⏸ 보류"(주황), 성사는 끝까지 채우고 초록.
// 색으로만 구분하지 않는다: 점 모양·글자를 함께 쓰고 막대 전체를 "6단계 중 3단계 수요 확인" 같은 글로도 알린다.
// 그림 파일 없이 코드로 그린다. 단계 이름·순서는 서버 질문 파일(GET /sales-questions의 steps)에서 오고,
// 못 받았으면 코드표(C0 salesStep) 순서와 쉬운 말 대응표로 그린다. 읽기만 하는 부품이라 단추가 없다.
import type { OutcomeRecord, SalesQuestions, SalesStep, SalesStepView } from '../../api/types';
import { brand } from '../../config/brand';
import { detailReport, labelFor, lostReasonLabels, salesStepLabels } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

const texts = detailReport.progress;

/** 질문 파일을 못 받았을 때 쓰는 세부 단계 순서(코드표 C0 salesStep). */
const FALLBACK_STEPS: SalesStep[] = [
  'NOT_REACHED',
  'REACHED',
  'DEMAND_CONFIRMED',
  'MATERIAL_QUOTE',
  'VISIT_SAMPLE',
];

type DotState = 'done' | 'current' | 'todo';
type EndState = 'todo' | 'won' | 'lost' | 'hold';

export interface SalesProgress {
  steps: { code: SalesStep; label: string }[];
  /** 지금 세부 단계 자리(0부터). 진행 중이 아니면 -1. */
  currentIndex: number;
  /** 채울 마지막 자리(0부터). 아무 단계도 안 지났으면 -1. */
  reachedIndex: number;
  end: EndState;
  /** 접촉 기록이 하나도 없고 끝나지도 않은 회사. */
  noContact: boolean;
}

/**
 * 막대에 그릴 값. 끝난 회사(보류·성사·거절)는 서버가 세부 단계를 주지 않으므로, 알아낸 답이 닿게 한 가장 먼 단계
 * (질문 파일의 reaches)를 멈춘 자리로 쓴다. 답이 없고 접촉만 있었으면 첫 단계("연결 전")까지다.
 */
export function salesProgressOf(
  salesStep: SalesStepView | null | undefined,
  outcome: OutcomeRecord | null | undefined,
  contactTotal: number,
  questions: SalesQuestions | null,
): SalesProgress {
  const steps =
    questions && questions.steps.length > 0
      ? questions.steps.map((step) => ({ code: step.code, label: step.label }))
      : FALLBACK_STEPS.map((code) => ({ code, label: salesStepLabels[code] }));
  const indexOf = (code: SalesStep | null | undefined) =>
    code ? steps.findIndex((step) => step.code === code) : -1;
  const status = outcome?.status ?? null;
  const end: EndState =
    status === 'WON' ? 'won' : status === 'LOST' ? 'lost' : status === 'ON_HOLD' ? 'hold' : 'todo';
  if (end === 'won') {
    return { steps, currentIndex: -1, reachedIndex: steps.length - 1, end, noContact: false };
  }
  if (end === 'todo') {
    const currentIndex = indexOf(salesStep?.code);
    return {
      steps,
      currentIndex,
      reachedIndex: currentIndex,
      end,
      noContact: currentIndex < 0,
    };
  }
  let reachedIndex = contactTotal > 0 ? 0 : -1;
  for (const known of salesStep?.known ?? []) {
    const option = questions?.questions
      .find((question) => question.questionId === known.questionId)
      ?.answers.find((answer) => answer.answerId === known.answerId);
    reachedIndex = Math.max(reachedIndex, indexOf(option?.reaches));
  }
  return { steps, currentIndex: -1, reachedIndex, end, noContact: false };
}

export interface SalesProgressBarProps {
  salesStep: SalesStepView | null | undefined;
  outcome: OutcomeRecord | null | undefined;
  /** 접촉 시도 수(전화·메일·방문). 끝난 회사의 멈춘 자리를 정할 때만 쓴다. */
  contactTotal: number;
  /** 서버 질문 파일. 아직 못 받았거나 실패했으면 null(코드표 순서로 그린다). */
  questions: SalesQuestions | null;
}

const DOT = 18;
const DOT_CURRENT = 26;
const ROW = 28;

export default function SalesProgressBar({
  salesStep,
  outcome,
  contactTotal,
  questions,
}: SalesProgressBarProps) {
  const progress = salesProgressOf(salesStep, outcome, contactTotal, questions);
  const { steps, currentIndex, reachedIndex, end } = progress;
  const total = steps.length + 1;
  const since = formatMonthDay(salesStep?.since);
  const lostReason = outcome?.lostReasonCode
    ? labelFor(lostReasonLabels, outcome.lostReasonCode)
    : null;
  const accent = brand.colorPrimary;
  const filledTone =
    end === 'won'
      ? { bg: statusPalette.ok.bg, fg: statusPalette.ok.fg }
      : end === 'lost'
        ? { bg: statusPalette.neutral.bg, fg: statusPalette.neutral.fg }
        : end === 'hold'
          ? { bg: statusPalette.recheck.bg, fg: statusPalette.recheck.fg }
          : { bg: statusPalette.ask.bg, fg: accent };
  const stopLabel = reachedIndex >= 0 ? steps[reachedIndex].label : null;
  const ariaLabel =
    end === 'won'
      ? texts.ariaWon(total)
      : end === 'lost'
        ? texts.ariaLost(total, reachedIndex + 1, stopLabel, lostReason)
        : end === 'hold'
          ? texts.ariaHold(total, reachedIndex + 1, stopLabel)
          : currentIndex >= 0
            ? texts.ariaCurrent(total, currentIndex + 1, steps[currentIndex].label, since)
            : texts.ariaNoContact(total);
  const endText =
    end === 'won'
      ? texts.wonDone
      : end === 'lost'
        ? texts.lost(lostReason)
        : end === 'hold'
          ? texts.hold
          : texts.won;
  const endGlyph = end === 'won' ? '✓' : end === 'lost' ? '✕' : end === 'hold' ? '⏸' : '';
  const nextDate = formatMonthDay(outcome?.nextScheduleAt);

  const stateOf = (index: number): DotState =>
    index === currentIndex ? 'current' : index <= reachedIndex ? 'done' : 'todo';
  // 점 뒤에 붙는 선: 양쪽 점이 모두 지나온 자리면(성사는 끝까지) 굵고 진하게, 아니면 가늘고 연하게.
  const lineFilled = (index: number) => end === 'won' || index < reachedIndex;

  function dotStyle(state: DotState | EndState) {
    const size = state === 'current' ? DOT_CURRENT : DOT;
    const base = {
      width: size,
      height: size,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      fontSize: 12,
      lineHeight: 1,
      flex: 'none',
    } as const;
    if (state === 'current') {
      return {
        ...base,
        background: accent,
        color: colors.bgContainer,
        boxShadow: `0 0 0 4px ${statusPalette.ask.bg}`,
      };
    }
    if (state === 'todo') {
      return { ...base, background: colors.bgContainer, border: `2px solid ${colors.border}` };
    }
    return {
      ...base,
      background: filledTone.bg,
      color: filledTone.fg,
      border: `2px solid ${filledTone.fg}`,
    };
  }

  return (
    <div data-testid="sales-progress" data-end={end} style={{ display: 'grid', gap: 8 }}>
      <ol
        aria-label={`${texts.title}: ${ariaLabel}`}
        data-testid="sales-progress-steps"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))`,
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {steps.map((step, index) => {
          const state = stateOf(index);
          return (
            <li
              key={step.code}
              data-testid="sales-progress-step"
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
              title={texts.dot(step.label, texts.stateText[state])}
              style={{ display: 'grid', gap: 4, justifyItems: 'start' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: ROW }}>
                <span aria-hidden="true" style={dotStyle(state)}>
                  {state === 'done' ? '✓' : state === 'current' ? '●' : ''}
                </span>
                <span
                  aria-hidden="true"
                  style={{
                    flex: 1,
                    height: lineFilled(index) ? 3 : 2,
                    background: lineFilled(index) ? filledTone.fg : colors.borderSecondary,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: typography.fontSizeSecondary,
                  fontWeight: state === 'current' ? 700 : 400,
                  color: state === 'todo' ? colors.textSecondary : colors.text,
                }}
              >
                {step.label}
              </span>
              {state === 'current' ? (
                <span
                  data-testid="sales-progress-now"
                  style={{ fontSize: typography.fontSizeSecondary, fontWeight: 700, color: accent }}
                >
                  <span aria-hidden="true">▲ </span>
                  {texts.now(since)}
                </span>
              ) : null}
            </li>
          );
        })}
        <li
          data-testid="sales-progress-end"
          data-state={end}
          title={endText}
          style={{ display: 'grid', gap: 4, justifyItems: 'start' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', height: ROW }}>
            <span aria-hidden="true" style={dotStyle(end)}>
              {endGlyph}
            </span>
          </div>
          <span
            data-testid="sales-progress-end-text"
            style={{
              fontSize: typography.fontSizeSecondary,
              fontWeight: end === 'todo' ? 400 : 700,
              color: end === 'todo' ? colors.textSecondary : filledTone.fg,
            }}
          >
            {endText}
          </span>
        </li>
      </ol>
      {progress.noContact ? (
        <span
          data-testid="sales-progress-empty"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {texts.noContact}
        </span>
      ) : null}
      {nextDate ? (
        <span data-testid="sales-progress-next">
          {texts.nextSchedule(nextDate, outcome?.nextScheduleNote?.trim() || null)}
        </span>
      ) : null}
    </div>
  );
}
