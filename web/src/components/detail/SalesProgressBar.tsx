// 상세 맨 위 단계 진행 막대(#674, PM 결정 2026-11-13): 세부 단계 5개 + 끝 "성사"를 점과 선으로 그린다.
// #898(PM 2026-11-23): 지나온 단계는 초록 원 + 흰 ✓, 지금은 옅은 보라 원, 아직은 점선 원. 큰 단계 띠는 그 아래 점들과
// 같은 너비(미접촉 1칸 · 접촉 3칸 · 견적·샘플 2칸 · 성사 1칸)로 맞추고 칸마다 테두리를 둔다.
// 지나온 단계는 연한 강조색으로 채운 점(✓), 지금 단계는 진한 강조색 큰 점 + "지금 (11/12부터)", 아직인 단계는 빈 점.
// 끝난 회사: 거절은 멈춘 자리까지 채우고 끝에 "✕ 거절 (가격)"(회색), 보류는 "⏸ 보류"(주황), 성사는 끝까지 채우고 초록.
// 색으로만 구분하지 않는다: 점 모양·글자를 함께 쓰고 막대 전체를 "6단계 중 3단계 수요 확인" 같은 글로도 알린다.
// #759(PM 2026-11-15): 점 줄 위에 큰 단계 띠 4칸(미접촉 · 접촉 · 견적·샘플 · 성사)을 둔다. 지금 칸은 연두,
// 지나온 칸은 옅은 연두, 아직인 칸은 회색. 거절·보류로 끝나면 마지막 칸이 "거절 (가격)"·"보류"가 된다.
// 그림 파일 없이 코드로 그린다. 단계 이름·순서는 서버 질문 파일(GET /sales-questions의 steps)에서 오고,
// 못 받았으면 코드표(C0 salesStep) 순서와 쉬운 말 대응표로 그린다. 읽기만 하는 부품이라 단추가 없다.
import type {
  OutcomeRecord,
  OutcomeStatus,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import {
  detailReport,
  labelFor,
  lostReasonLabels,
  outcomeStatusLabels,
  salesStepLabels,
} from '../../labels/ko';
import { colors, progressTheme, radius, statusPalette, typography } from '../../theme/tokens';
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

/** 큰 단계 띠 4칸(코드표 C0 outcomeStatus의 앞으로 가는 순서). 보류·거절은 마지막 칸 자리에 보인다. */
const BANDS: OutcomeStatus[] = [
  'NOT_EXECUTED',
  'IN_PROGRESS',
  'SAMPLE_OR_REGISTRATION_APPROVED',
  'WON',
];
/** 이 세부 단계 자리(0부터)부터는 큰 단계 "견적·샘플"이다(자료·견적). */
const QUOTE_STEP_INDEX = 3;

export type BandState = 'done' | 'current' | 'todo' | 'lost' | 'hold';

/**
 * 띠 칸마다의 상태. 진행 중이면 서버의 큰 단계(outcome.status)를 지금 칸으로 쓰고, 없으면 세부 단계로 짐작한다.
 * 거절·보류는 멈춘 세부 단계로 어느 칸까지 왔는지 정하고 마지막 칸을 거절·보류로 바꾼다.
 */
export function bandStatesOf(
  progress: SalesProgress,
  status: OutcomeStatus | null | undefined,
): BandState[] {
  // #898(PM 2026-11-23): "연결 전"은 미접촉 칸, 연결됨·수요 확인은 접촉 칸, 자료·견적·방문·샘플은 견적·샘플 칸.
  const byStep = (index: number) => (index >= QUOTE_STEP_INDEX ? 2 : index >= 1 ? 1 : 0);
  const last = BANDS.length - 1;
  if (progress.end === 'won') return BANDS.map((_, i) => (i === last ? 'current' : 'done'));
  if (progress.end === 'lost' || progress.end === 'hold') {
    const stop = byStep(progress.reachedIndex);
    return BANDS.map((_, i) =>
      i === last ? progress.end : i <= stop ? 'done' : 'todo',
    ) as BandState[];
  }
  const fromStatus = status ? BANDS.indexOf(status) : -1;
  const current =
    fromStatus >= 0 && fromStatus < last
      ? fromStatus
      : progress.noContact
        ? 0
        : byStep(progress.currentIndex);
  return BANDS.map((_, i) => (i < current ? 'done' : i === current ? 'current' : 'todo'));
}

export interface SalesProgressBarProps {
  salesStep: SalesStepView | null | undefined;
  outcome: OutcomeRecord | null | undefined;
  /** 접촉 시도 수(전화·메일·방문). 끝난 회사의 멈춘 자리를 정할 때만 쓴다. */
  contactTotal: number;
  /** 서버 질문 파일. 아직 못 받았거나 실패했으면 null(코드표 순서로 그린다). */
  questions: SalesQuestions | null;
}

// #898(PM 2026-11-23): 점은 참고 그림처럼 크게, 지나온 단계는 초록 ✓, 지금은 보라 원, 아직은 점선 원.
const DOT = 30;
const DOT_CURRENT = 34;
const ROW = 38;
const LINE = 3;

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
  // 지나온 점은 연두 + 진한 ✓. 거절·보류로 끝났으면 지나온 점도 회색·주황으로 멈춘 느낌을 준다.
  const filledTone =
    end === 'lost'
      ? {
          bg: statusPalette.neutral.bg,
          fg: statusPalette.neutral.fg,
          line: statusPalette.neutral.fg,
        }
      : end === 'hold'
        ? {
            bg: statusPalette.recheck.bg,
            fg: statusPalette.recheck.fg,
            line: statusPalette.recheck.fg,
          }
        : { bg: progressTheme.done, fg: progressTheme.doneFg, line: progressTheme.doneLine };
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
  const bands = bandStatesOf(progress, outcome?.status);
  const bandLabel = (index: number, state: BandState) =>
    state === 'lost'
      ? texts.bandLost(lostReason)
      : state === 'hold'
        ? outcomeStatusLabels.ON_HOLD
        : outcomeStatusLabels[BANDS[index]];
  const currentBand = bands.findIndex((state) => state !== 'done' && state !== 'todo');

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
      fontSize: 16,
      lineHeight: 1,
      flex: 'none',
      position: 'relative',
      zIndex: 1,
    } as const;
    if (state === 'current') {
      // "지금" 점: 진한 회색 원 + 가운데 흰 점(그림 안 글자는 없다).
      return {
        ...base,
        background: progressTheme.current,
        backgroundImage: `radial-gradient(circle, ${progressTheme.currentFg} 0 5px, transparent 5.5px)`,
      };
    }
    if (state === 'todo') {
      return {
        ...base,
        background: colors.bgContainer,
        border: `1.5px solid ${progressTheme.todoBorder}`,
      };
    }
    return { ...base, background: filledTone.bg, color: filledTone.fg, fontWeight: 700 };
  }

  // 큰 단계 띠 4칸은 같은 너비(#898, PM 2026-11-23). 점 줄은 띠 1칸을 2칸으로 나눈 8칸 위에 놓는다:
  // 미접촉 칸 가운데 "연결 전", 접촉 칸에 "연결됨·수요 확인", 견적·샘플 칸에 "자료·견적·방문·샘플", 성사 칸 가운데 "성사".
  // 세부 단계가 5개가 아니면(질문 파일이 바뀐 경우) 점을 고른 칸에 놓는다.
  const standard = steps.length === 5 && QUOTE_STEP_INDEX === 3;
  const stepColumns = standard ? BANDS.length * 2 : total;
  const stepSpan = (index: number) => (standard && index === 0 ? 2 : 1);
  const endSpan = standard ? 2 : 1;
  const bandBorder = (state: BandState) =>
    state === 'current'
      ? `2px solid ${progressTheme.current}`
      : state === 'done'
        ? `1.5px solid ${progressTheme.bandBorderDone}`
        : state === 'lost'
          ? `1.5px solid ${statusPalette.neutral.fg}`
          : state === 'hold'
            ? `1.5px solid ${statusPalette.recheck.fg}`
            : `1.5px solid ${progressTheme.bandBorder}`;
  /** 점 뒤(오른쪽) 반쪽 선과 앞(왼쪽) 반쪽 선. 지나온 구간은 초록(거절·보류는 그 색), 나머지 옅은 회색. */
  const halfLine = (side: 'left' | 'right', filled: boolean) => (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: (ROW - LINE) / 2,
        height: LINE,
        left: side === 'left' ? 0 : '50%',
        right: side === 'left' ? '50%' : 0,
        background: filled ? filledTone.line : progressTheme.line,
      }}
    />
  );

  return (
    <div data-testid="sales-progress" data-end={end} style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}>{texts.title}</div>
      <div
        role="group"
        aria-label={texts.bandAria(
          currentBand >= 0 ? bandLabel(currentBand, bands[currentBand]) : '',
        )}
        data-testid="sales-progress-bands"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${BANDS.length}, minmax(0, 1fr))`,
        }}
      >
        {bands.map((state, index) => (
          <span
            key={BANDS[index]}
            data-testid="sales-progress-band"
            data-state={state}
            style={{
              margin: '0 3px',
              border: bandBorder(state),
              borderRadius: radius.sm,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              minHeight: 44,
              padding: '6px 8px',
              boxSizing: 'border-box',
              background:
                state === 'current'
                  ? progressTheme.current
                  : state === 'done'
                    ? progressTheme.done
                    : state === 'lost'
                      ? statusPalette.neutral.bg
                      : state === 'hold'
                        ? statusPalette.recheck.bg
                        : progressTheme.todo,
              color:
                state === 'current'
                  ? progressTheme.currentFg
                  : state === 'lost'
                    ? statusPalette.neutral.fg
                    : state === 'hold'
                      ? statusPalette.recheck.fg
                      : state === 'todo'
                        ? colors.textSecondary
                        : colors.text,
              fontWeight: state === 'done' || state === 'todo' ? 400 : 700,
              fontSize: typography.fontSize,
            }}
          >
            {bandLabel(index, state)}
          </span>
        ))}
      </div>
      <div>
        <ol
          aria-label={`${texts.title}: ${ariaLabel}`}
          data-testid="sales-progress-steps"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${stepColumns}, minmax(0, 1fr))`,
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
                style={{
                  gridColumn: `span ${stepSpan(index)}`,
                  display: 'grid',
                  gap: 6,
                  justifyItems: 'center',
                  alignContent: 'start',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: ROW,
                  }}
                >
                  {index > 0 ? halfLine('left', lineFilled(index - 1)) : null}
                  {halfLine('right', lineFilled(index))}
                  <span aria-hidden="true" style={dotStyle(state)}>
                    {state === 'done' ? '✓' : ''}
                  </span>
                </div>
                <span
                  style={{
                    padding: '0 2px',
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
                    style={{
                      fontSize: typography.fontSizeSecondary,
                      fontWeight: 700,
                      color: colors.text,
                    }}
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
            style={{
              gridColumn: `span ${endSpan}`,
              display: 'grid',
              gap: 6,
              justifyItems: 'center',
              alignContent: 'start',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: ROW,
              }}
            >
              {steps.length > 0 ? halfLine('left', lineFilled(steps.length - 1)) : null}
              <span aria-hidden="true" style={dotStyle(end)}>
                {endGlyph}
              </span>
            </div>
            <span
              data-testid="sales-progress-end-text"
              style={{
                fontSize: typography.fontSizeSecondary,
                fontWeight: end === 'todo' ? 400 : 700,
                color: end === 'todo' ? colors.textSecondary : colors.text,
              }}
            >
              {endText}
            </span>
          </li>
        </ol>
      </div>
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
