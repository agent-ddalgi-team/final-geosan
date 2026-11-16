// 영업 분석 아래 "기록에서 배우기"(#802 1단계, PM 지시 2026-11-16 "쓸수록 좋아지는 분석").
// 서버가 저장된 영업 기록만으로 센 값(AI 없음)을 그림·표로 보인다. 실패에서 배우기를 먼저 둔다.
// 표본이 기준보다 적은 신호·조합은 회색 "판단 보류"로 두고, 질문지 다듬기는 "제안 · 승인 전"이다.
// 회사 이름·메모 글은 응답에 없다. 질문 문구·보기 이름은 질문 파일(GET /sales-questions)에서 읽고,
// 못 읽으면 코드 그대로 보인다(숫자는 그대로).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getSalesQuestions } from '../../api/client';
import type {
  AnalysisPeriod,
  PatternSignal,
  SalesPatterns as Patterns,
} from '../../api/salesAnalysis';
import { getSalesPatterns } from '../../api/salesAnalysis';
import type { SalesQuestions } from '../../api/types';
import {
  labelFor,
  lostReasonLabels,
  salesPatternsTexts as texts,
  salesStepLabels,
} from '../../labels/ko';
import { chartPalette, colors, typography } from '../../theme/tokens';

const [BLUE, ORANGE] = chartPalette.series;
const GREY = colors.borderSecondary;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const cardStyle = {
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: chartPalette.cardRadius,
  padding: 20,
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  minWidth: 0,
} as const;

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={id} style={cardStyle}>
      <h3 id={`${id}-title`} style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** 가로 막대 한 줄: 이름 · 막대 · 숫자. max가 0이면 막대 없이 숫자만. */
function Bar({
  label,
  value,
  max,
  color,
  text,
  testId,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  text: string;
  testId?: string;
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div
      data-testid={testId}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 30%) 1fr auto', gap: 8 }}
      title={`${label}: ${text}`}
    >
      <span style={{ overflowWrap: 'anywhere' }}>{label}</span>
      <span style={{ background: colors.bgLayout, borderRadius: 4, alignSelf: 'center' }}>
        <span
          style={{
            display: 'block',
            height: 10,
            width: `${width}%`,
            background: color,
            borderRadius: 4,
          }}
        />
      </span>
      <span style={secondary}>{text}</span>
    </div>
  );
}

function questionText(questions: SalesQuestions | null, id: string): string {
  return questions?.questions.find((q) => q.questionId === id)?.text ?? id;
}

function answerText(questions: SalesQuestions | null, questionId: string, answerId: string) {
  const question = questions?.questions.find((q) => q.questionId === questionId);
  return question?.answers.find((a) => a.answerId === answerId)?.label ?? answerId;
}

function stepText(step: string | null): string {
  return step === null ? texts.noStep : labelFor(salesStepLabels, step);
}

function signalName(signal: PatternSignal, questions: SalesQuestions | null): string {
  if (signal.code !== 'ANSWER' || !signal.questionId) {
    return texts.signalNames[signal.code] ?? signal.code;
  }
  const answers = signal.answerIds
    .map((id) => answerText(questions, signal.questionId as string, id))
    .join('·');
  return texts.answerSignal(questionText(questions, signal.questionId), answers);
}

export interface SalesPatternsProps {
  period: AnalysisPeriod;
  /** 위 분석표의 [다시 시도]와 같이 다시 읽는다. */
  reloadKey: number;
  /** 공정 코드 → 이름(위 분석표와 같은 이름). */
  processNames: Record<string, string>;
}

export default function SalesPatterns({ period, reloadKey, processNames }: SalesPatternsProps) {
  const periodKey = `${period.from ?? ''}~${period.to ?? ''}`;
  const [state, setState] = useState<{
    key: string;
    data?: Patterns;
    failed?: boolean;
  } | null>(null);
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);
  const key = `${reloadKey}|${periodKey}`;

  useEffect(() => {
    const controller = new AbortController();
    getSalesPatterns(controller.signal, period)
      .then((envelope) => {
        if (!controller.signal.aborted) setState({ key, data: envelope.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, failed: true });
      });
    return () => controller.abort();
    // key가 period·reloadKey를 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let alive = true;
    getSalesQuestions()
      .then((envelope) => {
        if (alive) setQuestions(envelope.data);
      })
      .catch(() => {
        // 문구를 못 읽어도 코드로 보인다(숫자는 그대로).
      });
    return () => {
      alive = false;
    };
  }, []);

  const current = state?.key === key ? state : null;
  if (!current) return null;
  // 옛 서버(패턴 경로 없음)나 모양이 다른 응답이면 숫자를 지어내지 않고 안내만 보인다.
  if (current.failed || !current.data || !current.data.failure || !current.data.signals) {
    return (
      <p data-testid="patterns-error" role="status" style={secondary}>
        {texts.loadError}
      </p>
    );
  }
  const data = current.data;
  const failure = data.failure;
  const success = data.success;
  const maxStep = Math.max(0, ...failure.byStep.map((row) => row.count));
  const maxReason = Math.max(0, ...failure.lostReasons.map((row) => row.count));
  const maxFill = Math.max(0, ...data.answerFill.map((row) => row.eligible));

  return (
    <section
      aria-labelledby="patterns-title"
      data-testid="patterns"
      style={{ display: 'grid', gap: 16 }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <h2 id="patterns-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          {texts.title}
        </h2>
        <p style={secondary}>{texts.intro}</p>
        <p data-testid="patterns-basis" style={{ margin: 0 }}>
          {texts.enough(data.basis.usableCount, data.basis.neededCount)}
          {data.basis.enough ? '' : ` · ${texts.notEnough}`}
        </p>
      </div>

      <Card id="patterns-failure" title={texts.failureTitle}>
        <p data-testid="patterns-failure-count" style={{ margin: 0 }}>
          {texts.failureCount(failure.count, failure.onHoldCount)}
        </p>
        <div style={{ display: 'grid', gap: 6 }}>
          <strong>{texts.whereDropped}</strong>
          {failure.byStep.map((row) => (
            <Bar
              key={row.step ?? 'none'}
              testId="patterns-failure-step"
              label={stepText(row.step)}
              value={row.count}
              max={maxStep}
              color={ORANGE}
              text={`${row.count}곳`}
            />
          ))}
        </div>
        {failure.lostReasons.length > 0 ? (
          <div style={{ display: 'grid', gap: 6 }}>
            <strong>{texts.why}</strong>
            {failure.lostReasons.map((row) => (
              <Bar
                key={row.code}
                testId="patterns-failure-reason"
                label={labelFor(lostReasonLabels, row.code)}
                value={row.count}
                max={maxReason}
                color={ORANGE}
                text={`${row.count}곳`}
              />
            ))}
          </div>
        ) : null}
        {failure.stepAnswers.length > 0 ? (
          <div style={{ display: 'grid', gap: 4 }}>
            <strong>{texts.stepAnswers}</strong>
            {failure.stepAnswers.map((row) => (
              <p
                key={`${row.step}-${row.questionId}`}
                data-testid="patterns-step-answers"
                style={{ margin: 0 }}
              >
                {stepText(row.step)} · {questionText(questions, row.questionId)} —{' '}
                {row.answers
                  .map((a) => `${answerText(questions, row.questionId, a.answerId)} ${a.count}`)
                  .join(' · ')}
              </p>
            ))}
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 8 }}>
          <strong>{texts.signalsTitle}</strong>
          <span style={secondary}>{texts.signalsNote}</span>
          {data.signals.map((signal) => (
            <div
              key={`${signal.code}-${signal.questionId ?? ''}`}
              data-testid="patterns-signal"
              data-judged={signal.judged}
              style={{ display: 'grid', gap: 4, opacity: signal.judged ? 1 : 0.55 }}
            >
              <span>
                {signalName(signal, questions)}
                {signal.judged ? '' : ` · ${texts.judgedLater}`}
              </span>
              <Bar
                label="실패 쪽"
                value={signal.failedShare ?? 0}
                max={1}
                color={signal.judged ? ORANGE : GREY}
                text={texts.failedSide(signal.failed, failure.count, signal.failedShare)}
              />
              <Bar
                label="성사 쪽"
                value={signal.wonShare ?? 0}
                max={1}
                color={signal.judged ? BLUE : GREY}
                text={texts.wonSide(signal.won, success.count, signal.wonShare)}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card id="patterns-success" title={texts.successTitle}>
        <p data-testid="patterns-success-count" style={{ margin: 0 }}>
          {texts.successCount(success.count, success.avgContactsToWon)}
        </p>
        <p data-testid="patterns-first-visit" style={{ margin: 0 }}>
          {texts.firstVisit(success.avgFirstVisitIndex, success.failedAvgFirstVisitIndex)}
        </p>
      </Card>

      <Card id="patterns-combos" title={texts.combosTitle}>
        {data.combos.length === 0 ? (
          <p style={secondary}>—</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {data.combos.map((row) => (
              <li
                key={`${row.processCode}-${row.industry}-${row.region}`}
                data-testid="patterns-combo"
                style={{ color: row.wonRatio === null ? colors.textSecondary : colors.text }}
              >
                {[
                  row.processCode
                    ? (processNames[row.processCode] ?? row.processCode)
                    : texts.comboUnknown,
                  row.industry ?? texts.comboUnknown,
                  row.region ?? texts.comboUnknown,
                ].join(' × ')}{' '}
                — {texts.comboLine(row.contacted, row.won, row.wonRatio)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="patterns-fill" title={texts.fillTitle}>
        {data.answerFill
          .filter((row) => row.eligible > 0)
          .map((row) => (
            <Bar
              key={row.questionId}
              testId="patterns-fill-row"
              label={questionText(questions, row.questionId)}
              value={row.answered}
              max={maxFill}
              color={BLUE}
              text={texts.fillLine(row.answered, row.eligible)}
            />
          ))}
      </Card>

      <Card id="patterns-hints" title={texts.hintsTitle}>
        <span data-testid="patterns-hints-badge" style={secondary}>
          {texts.hintsBadge} · {texts.hintsNote}
        </span>
        {data.questionnaireHints.length === 0 ? (
          <p style={secondary}>{texts.hintsEmpty}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {data.questionnaireHints.map((hint) => {
              const answer = hint.answerId
                ? answerText(questions, hint.questionId, hint.answerId)
                : '';
              const detail =
                hint.kind === 'SAME_ANSWER'
                  ? texts.hintKinds.SAME_ANSWER(answer, hint.share)
                  : hint.kind === 'UNKNOWN_MANY'
                    ? texts.hintKinds.UNKNOWN_MANY(hint.share)
                    : texts.hintKinds.SPLITS_OUTCOME(answer, hint.wonRatioHigh, hint.wonRatioLow);
              return (
                <li key={`${hint.questionId}-${hint.kind}`} data-testid="patterns-hint">
                  {questionText(questions, hint.questionId)} — {detail}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card id="patterns-coach" title={texts.coachTitle}>
        <p data-testid="patterns-coach-line" style={{ margin: 0 }}>
          {data.coachEffect.applied === 0
            ? texts.coachEmpty
            : texts.coachLine(
                data.coachEffect.applied,
                data.coachEffect.progressed,
                data.coachEffect.companies,
              )}
        </p>
      </Card>
    </section>
  );
}
