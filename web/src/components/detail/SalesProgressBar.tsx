// 상세 영업 단계 그림(#674 → #972 새 시안): 큰 단계 4칸(미접촉 · 접촉 · 견적·샘플 · 성사)을 같은 너비로 놓고,
// 칸마다 바로 아래에 그 칸의 세부 단계를 점으로 놓아 한 줄 선으로 잇는다.
//   미접촉 = 연결 전 / 접촉 = 연결됨 · 수요 확인 / 견적·샘플 = 자료·견적 · 방문·샘플 / 성사 = 성사
// 큰 칸: 지나온 칸 = 강조 연한 바탕 + 강조 글자, 지금 칸 = 강조 바탕 + 흰 글자, 아직 = 중립.
// 점: 지나온 점 = 강조 밝은 쪽(글자를 올리지 않는다), 지금 점 = 흰 가운데 + 강조 고리 + 아래 "지금 (11/12부터)", 아직 = 옅은 회보라.
// 선: 처음 점부터 끝 점까지 한 줄. 지나온 구간은 강조 흐린 선, 나머지는 옅은 회보라.
// 끝난 회사: 거절은 멈춘 자리까지 회색으로 채우고 끝에 "✕ 거절 (가격)", 보류는 주의색 + "⏸ 보류", 성사는 끝까지 채운다.
// 색으로만 구분하지 않는다: 지금 점은 고리 모양 + "지금" 글, 끝난 회사는 끝 점 아래 "✕ 거절"·"⏸ 보류"·"✓ 성사" 글,
// 그림 전체는 "6단계 중 3단계 수요 확인" 같은 글로도 알린다. 지나온 점과 아직인 점은 밝기 차이가 커서 색을 못 가려도 갈린다.
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
import {
  accent,
  colors,
  neutralChip,
  progressTheme,
  radius,
  statusPalette,
  typography,
  warn,
} from '../../theme/tokens';
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
 * 세부 단계 자리(0부터)가 속한 큰 단계 칸(0부터). #898(PM 2026-11-23): "연결 전"은 미접촉 칸,
 * 연결됨·수요 확인은 접촉 칸, 자료·견적·방문·샘플은 견적·샘플 칸. 끝 "성사" 점은 성사 칸이다.
 */
export function bandIndexOfStep(index: number): number {
  return index >= QUOTE_STEP_INDEX ? 2 : index >= 1 ? 1 : 0;
}

/**
 * 띠 칸마다의 상태. 진행 중이면 서버의 큰 단계(outcome.status)를 지금 칸으로 쓰고, 없으면 세부 단계로 짐작한다.
 * 거절·보류는 멈춘 세부 단계로 어느 칸까지 왔는지 정하고 마지막 칸을 거절·보류로 바꾼다.
 */
export function bandStatesOf(
  progress: SalesProgress,
  status: OutcomeStatus | null | undefined,
): BandState[] {
  const byStep = bandIndexOfStep;
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
  /**
   * 그림 위 제목 "영업 단계"를 숨긴다(#972, 선택). 이미 같은 제목이 있는 칸(회사별 보고서 등)에 넣을 때 쓴다.
   * 기본은 보인다. 그림을 읽어 주는 글("영업 단계: 6단계 중 …")은 그대로 남는다.
   */
  hideTitle?: boolean;
  /**
   * 축소판(#996, PM 결정 2026-11-29): 모양은 그대로 두고 점·줄·글자·간격만 줄여 반 폭 칸(기업 상세 둘째 줄 왼쪽)에
   * 들어가게 한다. 큰 단계 4칸 · 세부 단계 점 · "지금 (11/7부터)" · 다음 일정 줄이 모두 그대로 보인다.
   */
  compact?: boolean;
}

// #972 새 시안: 점은 작게(글자 16px 기준 14px), 선은 2px. 점 둘레의 흰 띠가 선을 끊어 점이 또렷하게 보인다.
const LINE = 2;
/** 그림 크기. 보통(가로 전체 · 회사별 보고서)과 축소판(#996 반 폭 칸). */
export const PROGRESS_SIZES = {
  normal: {
    dot: 14,
    ring: 3,
    row: 20,
    bandMinHeight: 40,
    bandPadding: '8px',
    bandGap: 3,
    bandFont: typography.fontSizeSecondary,
    stepFont: typography.fontSizeSecondary,
    nowFont: typography.fontSizeSecondary,
    titleFont: typography.fontSizeCardTitle,
    gap: 12,
  },
  compact: {
    dot: 11,
    ring: 3,
    row: 14,
    bandMinHeight: 30,
    bandPadding: '5px 4px',
    bandGap: 2,
    bandFont: 13,
    stepFont: 11.5,
    nowFont: 11.5,
    titleFont: 17,
    gap: 8,
  },
} as const;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface StepPlacement {
  /** 이 점이 놓이는 큰 단계 칸(0부터). */
  band: number;
  /** 격자에서 시작하는 줄(1부터)과 차지하는 칸 수. */
  start: number;
  span: number;
  /** 그림 전체 너비에서 점 가운데의 위치(%). 선의 시작·끝을 정할 때 쓴다. */
  center: number;
}

/**
 * 세부 단계 점들과 끝 "성사" 점을 큰 단계 칸 아래에 나눠 놓는다. 큰 칸 4개는 같은 너비이고,
 * 한 칸 안의 점들은 그 칸을 똑같이 나눠 가운데에 선다(1개면 칸 가운데, 2개면 1/4·3/4 자리).
 * 돌려주는 배열의 마지막이 끝 점이다.
 */
export function stepPlacementsOf(stepCount: number): { columns: number; dots: StepPlacement[] } {
  const bands = [
    ...Array.from({ length: stepCount }, (_, index) => bandIndexOfStep(index)),
    BANDS.length - 1,
  ];
  const counts = BANDS.map((_, band) => bands.filter((value) => value === band).length);
  const perBand = counts.reduce(
    (acc, count) => (count > 0 ? (acc * count) / gcd(acc, count) : acc),
    1,
  );
  const columns = BANDS.length * perBand;
  const seen = BANDS.map(() => 0);
  const dots = bands.map((band) => {
    const span = perBand / counts[band];
    const start = band * perBand + seen[band] * span + 1;
    seen[band] += 1;
    return { band, start, span, center: ((start - 1 + span / 2) / columns) * 100 };
  });
  return { columns, dots };
}

export default function SalesProgressBar({
  salesStep,
  outcome,
  contactTotal,
  questions,
  hideTitle = false,
  compact = false,
}: SalesProgressBarProps) {
  const size = compact ? PROGRESS_SIZES.compact : PROGRESS_SIZES.normal;
  // 축소판에서만 쓰는 줄바꿈 규칙. 보통 크기는 전과 같다.
  const compactWrap = compact
    ? ({ wordBreak: 'keep-all', overflowWrap: 'anywhere', maxWidth: '100%' } as const)
    : {};
  const DOT = size.dot;
  const DOT_RING = size.ring;
  const ROW = size.row;
  const progress = salesProgressOf(salesStep, outcome, contactTotal, questions);
  const { steps, currentIndex, reachedIndex, end } = progress;
  const total = steps.length + 1;
  const since = formatMonthDay(salesStep?.since);
  const lostReason = outcome?.lostReasonCode
    ? labelFor(lostReasonLabels, outcome.lostReasonCode)
    : null;
  // 지나온 점·선의 색. 거절·보류로 끝났으면 회색·주의색으로 멈춘 느낌을 준다.
  const filledTone =
    end === 'lost'
      ? { dot: statusPalette.neutral.fg, line: statusPalette.neutral.fg }
      : end === 'hold'
        ? { dot: warn.dot, line: warn.dot }
        : { dot: progressTheme.dotDone, line: progressTheme.doneLine };
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
  const nextDate = formatMonthDay(outcome?.nextScheduleAt);

  const stateOf = (index: number): DotState =>
    index === currentIndex ? 'current' : index <= reachedIndex ? 'done' : 'todo';
  const bands = bandStatesOf(progress, outcome?.status);
  const bandLabel = (index: number, state: BandState) =>
    state === 'lost'
      ? texts.bandLost(lostReason)
      : state === 'hold'
        ? outcomeStatusLabels.ON_HOLD
        : outcomeStatusLabels[BANDS[index]];
  const currentBand = bands.findIndex((state) => state !== 'done' && state !== 'todo');

  // 점 자리: 큰 칸 아래에 그 칸의 세부 단계. 선은 처음 점 가운데부터 끝 점 가운데까지 한 줄이다.
  const { columns, dots } = stepPlacementsOf(steps.length);
  const endDot = dots[dots.length - 1];
  const lineStart = dots[0].center;
  const lineEnd = endDot.center;
  // 지나온 구간: 처음 점부터 멈춘(지금) 점까지. 성사는 끝까지. 첫 점에 머물러 있으면 채울 구간이 없다.
  const filledEnd = end === 'won' ? lineEnd : reachedIndex >= 1 ? dots[reachedIndex].center : null;

  const bandStyle = (state: BandState) => {
    if (state === 'current') {
      return { background: progressTheme.current, color: progressTheme.currentFg, fontWeight: 600 };
    }
    if (state === 'done') return { background: accent.soft, color: accent.text, fontWeight: 400 };
    if (state === 'lost') {
      return {
        background: statusPalette.neutral.bg,
        color: statusPalette.neutral.fg,
        fontWeight: 700,
        boxShadow: `inset 0 0 0 1.5px ${statusPalette.neutral.fg}`,
      };
    }
    if (state === 'hold') {
      return {
        background: statusPalette.recheck.bg,
        color: statusPalette.recheck.fg,
        fontWeight: 700,
        boxShadow: `inset 0 0 0 1.5px ${warn.dot}`,
      };
    }
    return { background: neutralChip.bg, color: neutralChip.text, fontWeight: 400 };
  };

  function dotStyle(state: DotState | EndState) {
    const base = {
      width: DOT,
      height: DOT,
      borderRadius: '50%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      flex: 'none',
      position: 'relative',
      // 점 둘레의 흰 띠: 뒤로 지나가는 선을 끊어 점이 또렷하게 보인다.
      boxShadow: `0 0 0 ${DOT_RING}px ${colors.bgContainer}`,
    } as const;
    if (state === 'current') {
      // "지금" 점: 흰 가운데 + 강조 고리.
      return {
        ...base,
        background: colors.bgContainer,
        border: `${DOT_RING}px solid ${progressTheme.current}`,
      };
    }
    if (state === 'todo') return { ...base, background: progressTheme.dotTodo };
    // 지나온 점(끝 점의 성사·거절·보류 포함): 채운 점. 점 위에는 글자를 올리지 않는다.
    return { ...base, background: filledTone.dot };
  }

  const itemStyle = (dot: StepPlacement) =>
    ({
      gridColumn: `${dot.start} / span ${dot.span}`,
      display: 'grid',
      gap: 5,
      justifyItems: 'center',
      alignContent: 'start',
      textAlign: 'center',
      minWidth: 0,
      // 축소판: 점 · 이름 · "지금" 세 줄을 모든 칸이 같이 쓴다(subgrid). 좁은 칸에서 옆 이름이 두 줄로 꺾여도
      // "지금 (11/7부터)"는 그 아래 셋째 줄에 놓여 옆 이름과 겹치지 않는다.
      // 칸 폭은 격자 칸 그대로 둔다(한 줄로 둔 "지금 …"이 칸보다 넓어도 점과 이름이 밀리지 않고, 양옆으로 고르게 넘친다).
      ...(compact
        ? {
            gridRow: 'span 3',
            gridTemplateRows: 'subgrid',
            gridTemplateColumns: 'minmax(0, 1fr)',
          }
        : {}),
    }) as const;
  const dotRow = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: ROW,
  } as const;
  const lineStyle = (from: number, to: number, color: string) =>
    ({
      position: 'absolute',
      top: (ROW - LINE) / 2,
      height: LINE,
      left: `${from}%`,
      width: `${to - from}%`,
      background: color,
    }) as const;

  return (
    <div
      data-testid="sales-progress"
      data-end={end}
      data-size={compact ? 'compact' : 'normal'}
      style={{ display: 'grid', gap: size.gap }}
    >
      {hideTitle ? null : (
        <div style={{ fontSize: size.titleFont, fontWeight: compact ? 700 : 600 }}>
          {texts.title}
        </div>
      )}
      <div style={{ display: 'grid', gap: size.gap }}>
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
              data-band={BANDS[index]}
              style={{
                // 칸 사이 틈 6px. 아래 점 격자는 틈 없이 같은 너비라 점이 칸 가운데(또는 1/4·3/4 자리)에 선다.
                margin: `0 ${size.bandGap}px`,
                borderRadius: radius.controlSm,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                minHeight: size.bandMinHeight,
                padding: size.bandPadding,
                boxSizing: 'border-box',
                fontSize: size.bandFont,
                // 축소판: 좁은 칸에서 "견적·샘플"이 글자 중간에서 꺾이지 않게 낱말 단위로 줄을 바꾼다
                // (그래도 칸을 넘으면 글자 단위로 꺾어 옆 칸과 겹치지 않게 한다).
                ...compactWrap,
                ...bandStyle(state),
              }}
            >
              {bandLabel(index, state)}
            </span>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          {/* 선은 칸 경계를 넘어 처음 점부터 끝 점까지 한 줄이다. 지나온 구간만 색이 다르다. */}
          <span
            aria-hidden="true"
            data-testid="sales-progress-line"
            style={lineStyle(lineStart, lineEnd, progressTheme.line)}
          />
          {filledEnd !== null ? (
            <span
              aria-hidden="true"
              data-testid="sales-progress-line-done"
              style={lineStyle(lineStart, filledEnd, filledTone.line)}
            />
          ) : null}
          <ol
            aria-label={`${texts.title}: ${ariaLabel}`}
            data-testid="sales-progress-steps"
            style={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              ...(compact ? { gridTemplateRows: 'auto auto auto', rowGap: 4 } : {}),
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
                  data-band={BANDS[dots[index].band]}
                  aria-current={state === 'current' ? 'step' : undefined}
                  title={texts.dot(step.label, texts.stateText[state])}
                  style={itemStyle(dots[index])}
                >
                  <div style={dotRow}>
                    <span aria-hidden="true" data-dot={state} style={dotStyle(state)} />
                  </div>
                  <span
                    style={{
                      padding: '0 2px',
                      fontSize: size.stepFont,
                      ...compactWrap,
                      fontWeight: state === 'current' ? 600 : 400,
                      color:
                        state === 'current'
                          ? colors.text
                          : state === 'done'
                            ? colors.textSecondary
                            : colors.textDimmed,
                    }}
                  >
                    {step.label}
                  </span>
                  {state === 'current' ? (
                    <span
                      data-testid="sales-progress-now"
                      style={{
                        fontSize: size.nowFont,
                        fontWeight: 500,
                        color: accent.text,
                        // 축소판: 칸이 좁아도 "지금 (11/7부터)"를 한 줄로 둔다(옆 점 아래는 빈 자리라 겹치지 않는다).
                        whiteSpace: compact ? 'nowrap' : undefined,
                      }}
                    >
                      {texts.now(since)}
                    </span>
                  ) : null}
                </li>
              );
            })}
            <li
              data-testid="sales-progress-end"
              data-state={end}
              data-band={BANDS[endDot.band]}
              title={endText}
              style={itemStyle(endDot)}
            >
              <div style={dotRow}>
                <span aria-hidden="true" data-dot={end} style={dotStyle(end)} />
              </div>
              <span
                data-testid="sales-progress-end-text"
                style={{
                  padding: '0 2px',
                  fontSize: size.stepFont,
                  ...compactWrap,
                  fontWeight: end === 'todo' ? 400 : 600,
                  color: end === 'todo' ? colors.textDimmed : colors.text,
                }}
              >
                {endText}
              </span>
            </li>
          </ol>
        </div>
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
        <span
          data-testid="sales-progress-next"
          style={
            compact
              ? {
                  paddingTop: 8,
                  borderTop: `1px solid ${colors.borderSecondary}`,
                  fontSize: typography.fontSizeSecondary,
                }
              : undefined
          }
        >
          {texts.nextSchedule(nextDate, outcome?.nextScheduleNote?.trim() || null)}
        </span>
      ) : null}
    </div>
  );
}
