// 영업 분석 아래 "기록에서 배우기"(#802, #820 PM 결정 2026-11-17 "섞어 쓰기").
// 서버가 저장된 영업 기록만으로 센 값(AI 없음)을 미리 정한 기준 없이 펼쳐 보인다. 맨 위는 지금 기록이 없어도
// 쓸모 있는 "답 채움률", 그다음 "눈에 띔"(결론 아님 · 사람 확인 전), 실패에서 배우기, 펼친 표 순서다.
// 끝난 회사가 표본 기준보다 적은 칸은 회색 "표본 부족"이고, 질문지 다듬기는 "손볼 만함 · 승인 전"이다.
// 회사 이름·메모 글은 응답에 없다. 질문 문구·보기 이름은 질문 파일(GET /sales-questions)에서 읽고,
// 못 읽으면 코드 그대로 보인다(숫자는 그대로).
// #972(새 시안): beside를 주면 [beside(AI 분석 피드백) | 기록에서 배우기 머리 + 자동 요약]을 한 줄에 나란히 두고,
// 나머지 카드는 그 아래에 전처럼 쌓는다. 내용·순서·숫자는 그대로다.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getSalesQuestions } from '../../api/client';
import type {
  AnalysisPeriod,
  AnalysisStats,
  PatternOutcomeCells,
  PatternStandout,
  SalesPatterns as Patterns,
} from '../../api/salesAnalysis';
import { getSalesAnalysis, getSalesPatterns } from '../../api/salesAnalysis';
import type { SalesQuestions } from '../../api/types';
import {
  analysisToneTexts,
  autoSummaryTexts,
  labelFor,
  lostReasonLabels,
  salesPatternsTexts as texts,
  salesStepLabels,
} from '../../labels/ko';
import { chartPalette, colors, radius, typography } from '../../theme/tokens';

// 막대 색(#972): 성사·채움 = 보라(BLUE는 옛 이름), 실패 = 주의 점색(ORANGE는 옛 이름), 표본 부족 = 옅은 회보라.
const [BLUE, ORANGE] = chartPalette.series;
const GREY = chartPalette.base;
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

function Card({
  id,
  title,
  bare = false,
  children,
}: {
  id: string;
  title: string;
  /** 이미 흰 카드 안에 들어갈 때: 테두리·바탕·안쪽 여백 없이 내용만. */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={id}
      style={bare ? { display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 } : cardStyle}
    >
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
      <span
        style={{ background: chartPalette.track, borderRadius: radius.tag, alignSelf: 'center' }}
      >
        <span
          style={{
            display: 'block',
            height: 10,
            width: `${width}%`,
            background: color,
            borderRadius: radius.tag,
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

/** 보기 id → 질문 파일의 보기 글. 질문 파일을 못 읽었거나 없는 보기면 id 그대로(#985 상대 반응 카드도 쓴다). */
export function answerText(questions: SalesQuestions | null, questionId: string, answerId: string) {
  const question = questions?.questions.find((q) => q.questionId === questionId);
  return question?.answers.find((a) => a.answerId === answerId)?.label ?? answerId;
}

function stepText(step: string | null): string {
  return step === null ? texts.noStep : labelFor(salesStepLabels, step);
}

/** 펼친 표 한 줄. 표본 부족이면 회색. */
function CellRow({
  label,
  row,
  testId,
}: {
  label: string;
  row: PatternOutcomeCells;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-judged={row.judged}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(90px, 30%) 1fr',
        gap: 8,
        color: row.judged ? colors.text : colors.textSecondary,
      }}
    >
      <span style={{ overflowWrap: 'anywhere' }}>{label}</span>
      <span style={{ display: 'grid', gap: 2 }}>
        <span
          aria-hidden="true"
          style={{ display: 'flex', height: 10, borderRadius: radius.tag, overflow: 'hidden' }}
        >
          <span style={{ flex: row.won, background: row.judged ? BLUE : GREY }} />
          <span style={{ flex: row.failed, background: row.judged ? ORANGE : GREY }} />
          <span style={{ flex: row.inProgress, background: chartPalette.track }} />
        </span>
        <span style={secondary}>
          {texts.cells(row.won, row.failed, row.inProgress, row.wonRatio)}
        </span>
      </span>
    </div>
  );
}

function standoutName(
  item: PatternStandout,
  questions: SalesQuestions | null,
  processNames: Record<string, string>,
): string {
  if (item.table === 'CONTACTS_BEFORE_VISIT') {
    const visited = item.visited ? texts.contactVisited : texts.contactNoVisit;
    return `${texts.contactsTitle} · ${visited} ${texts.contactBuckets[item.bucket ?? ''] ?? item.bucket}`;
  }
  if (item.table === 'LONGEST_GAP') {
    return `${texts.gapTitle} · ${texts.gapBuckets[item.bucket ?? ''] ?? item.bucket}`;
  }
  if (item.table === 'ANSWER' && item.questionId && item.answerId) {
    return `${questionText(questions, item.questionId)} = ${answerText(questions, item.questionId, item.answerId)}`;
  }
  return [
    item.processCode ? (processNames[item.processCode] ?? item.processCode) : texts.comboUnknown,
    item.industry ?? texts.comboUnknown,
    item.region ?? texts.comboUnknown,
  ].join(' × ');
}

/** #802: 고른 기간과 같은 길이의 바로 앞 기간(서버의 AI 분석 비교와 같은 규칙). 양끝이 있을 때만. */
export function previousPeriod(period: AnalysisPeriod): AnalysisPeriod | null {
  if (!period.from || !period.to) return null;
  const day = 24 * 60 * 60 * 1000;
  const from = Date.parse(`${period.from}T00:00:00Z`);
  const to = Date.parse(`${period.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  const prevTo = from - day;
  const prevFrom = prevTo - (to - from);
  const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

function arrow(now: number, before: number): string {
  if (now === before) return '—';
  return now > before ? `↑${now - before}` : `↓${before - now}`;
}

/** #802(PM 결정 2026-11-20) 자동 요약: 이미 받은 숫자로 문장만 만든다. AI·새 계산 없음. */
function AutoSummary({
  data,
  total,
  previous,
  questions,
  processNames,
  bare = false,
}: {
  data: Patterns;
  total?: AnalysisStats;
  previous: { period: AnalysisPeriod; total: AnalysisStats } | null;
  questions: SalesQuestions | null;
  processNames: Record<string, string>;
  bare?: boolean;
}) {
  const t = autoSummaryTexts;
  const lines: string[] = [];
  if (total) {
    lines.push(
      t.totals(
        total.contactedCount,
        total.wonCount,
        total.lostCount,
        total.onHoldCount,
        total.inProgressCount,
      ),
    );
    if (previous) {
      const before = previous.total;
      const range = `${previous.period.from?.slice(5).replace('-', '/')}~${previous.period.to
        ?.slice(5)
        .replace('-', '/')}`;
      lines.push(
        t.compared(range, [
          `${t.compareNames.contacted} ${arrow(total.contactedCount, before.contactedCount)}`,
          `${t.compareNames.won} ${arrow(total.wonCount, before.wonCount)}`,
          `${t.compareNames.lost} ${arrow(total.lostCount, before.lostCount)}`,
        ]),
      );
    }
  }
  const failure = data.failure;
  const topStep = [...failure.byStep].sort((a, b) => b.count - a.count)[0];
  if (failure.count > 0 && topStep && topStep.count > 0) {
    lines.push(t.failedAt(stepText(topStep.step), topStep.count, failure.count));
  }
  const topReason = [...failure.lostReasons].sort((a, b) => b.count - a.count)[0];
  if (topReason && topReason.count > 0) {
    lines.push(t.topReason(labelFor(lostReasonLabels, topReason.code), topReason.count));
  }
  if (data.success.count > 0) {
    lines.push(
      t.success(data.success.count, data.success.avgContactsToWon, data.success.avgFirstVisitIndex),
    );
  }
  for (const item of data.standouts.slice(0, 2)) {
    lines.push(
      t.standout(
        standoutName(item, questions, processNames),
        item.won,
        item.won + item.failed,
        item.overallWonRatio,
      ),
    );
  }
  const lowFill = data.answerFill
    .filter((row) => row.eligible > 0 && row.answered < row.eligible)
    .sort((a, b) => a.answered / a.eligible - b.answered / b.eligible)[0];
  if (lowFill) {
    lines.push(
      t.lowFill(questionText(questions, lowFill.questionId), lowFill.answered, lowFill.eligible),
    );
  }
  if (data.basis.overallWonRatio === null && data.basis.closedCount > 0) {
    lines.push(t.early(data.basis.closedCount, data.basis.minSampleForRatio));
  }
  return (
    <Card id="patterns-auto-summary" title={t.title} bare={bare}>
      <span data-testid="auto-summary-badge" style={secondary}>
        {t.badge}
      </span>
      {lines.length === 0 ? (
        <p data-testid="auto-summary-empty" style={secondary}>
          {t.empty}
        </p>
      ) : (
        // 시안: 점 없이 줄마다 얇은 선으로 나눈다.
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {lines.map((line, index) => (
            <li
              key={index}
              data-testid="auto-summary-line"
              style={{
                padding: '10px 0',
                borderTop: index === 0 ? undefined : `1px solid ${colors.borderSecondary}`,
              }}
            >
              {line}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export interface SalesPatternsProps {
  period: AnalysisPeriod;
  /** 위 분석표의 [다시 시도]와 같이 다시 읽는다. */
  reloadKey: number;
  /** 공정 코드 → 이름(위 분석표와 같은 이름). */
  processNames: Record<string, string>;
  /** #802 자동 요약 첫 줄: 위 분석표의 합계(회사를 한 번씩 센 값). 없으면 그 줄을 빼고 보인다. */
  total?: AnalysisStats;
  /**
   * (#972) 머리 + 자동 요약 왼쪽에 나란히 둘 칸(영업 분석 화면은 AI 분석 피드백을 넣는다).
   * 읽는 중·못 읽었을 때도 이 칸은 같은 자리에 그대로 보인다. 비우면 전처럼 한 줄기로 쌓는다.
   */
  beside?: ReactNode;
}

export default function SalesPatterns({
  period,
  reloadKey,
  processNames,
  total,
  beside,
}: SalesPatternsProps) {
  const periodKey = `${period.from ?? ''}~${period.to ?? ''}`;
  const [state, setState] = useState<{
    key: string;
    data?: Patterns;
    failed?: boolean;
  } | null>(null);
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);
  const key = `${reloadKey}|${periodKey}`;
  // #802: 앞 기간 합계(같은 길이, 기간 양끝이 있을 때만). 못 읽으면 비교 줄만 뺀다.
  const [before, setBefore] = useState<{
    key: string;
    value: { period: AnalysisPeriod; total: AnalysisStats } | null;
  } | null>(null);

  useEffect(() => {
    const span = previousPeriod(period);
    if (!span) return;
    const controller = new AbortController();
    getSalesAnalysis(controller.signal, span)
      .then((envelope) => {
        if (!controller.signal.aborted)
          setBefore({ key, value: { period: span, total: envelope.data.total } });
      })
      .catch(() => {
        // 앞 기간을 못 읽어도 요약의 나머지는 보인다.
      });
    return () => controller.abort();
    // key가 period·reloadKey를 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

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
  // beside가 있으면 읽는 중·못 읽었을 때도 그 칸을 같은 자리에 둔다(옆 칸만 비거나 안내가 들어간다).
  const sideBySide = (right: ReactNode, below: ReactNode = null) => (
    <div data-testid="patterns-layout" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'grid' }}>{beside}</div>
        <div style={{ flex: '1 1 380px', minWidth: 0, display: 'grid' }}>{right}</div>
      </div>
      {below}
    </div>
  );
  if (!current) return beside === undefined ? null : sideBySide(null);
  // 옛 서버(패턴 경로 없음)나 모양이 다른 응답이면 숫자를 지어내지 않고 안내만 보인다.
  if (
    current.failed ||
    !current.data ||
    !current.data.failure ||
    !current.data.contactsBeforeVisit
  ) {
    const errorLine = (
      <p data-testid="patterns-error" role="status" style={{ ...secondary, margin: 0 }}>
        {texts.loadError}
      </p>
    );
    return beside === undefined ? errorLine : sideBySide(errorLine);
  }
  const data = current.data;
  const failure = data.failure;
  const success = data.success;
  const maxStep = Math.max(0, ...failure.byStep.map((row) => row.count));
  const maxReason = Math.max(0, ...failure.lostReasons.map((row) => row.count));
  const maxFill = Math.max(0, ...data.answerFill.map((row) => row.eligible));
  const basis = data.basis;
  const answerQuestions = [...new Set(data.answerOutcomes.map((row) => row.questionId))];

  const head = (
    <div style={{ display: 'grid', gap: 4 }}>
      <h2 id="patterns-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
        {texts.title}
      </h2>
      <p style={{ ...secondary, margin: 0 }}>{texts.intro}</p>
      <p data-testid="patterns-basis" style={{ margin: 0 }}>
        {texts.basis(
          basis.closedCount,
          basis.wonCount,
          basis.overallWonRatio,
          basis.minSampleForRatio,
        )}
        {basis.overallWonRatio === null ? ` · ${texts.notEnough}` : ''}
      </p>
    </div>
  );
  const summary = (bare: boolean) => (
    <AutoSummary
      data={data}
      total={total}
      previous={before?.key === key ? before.value : null}
      questions={questions}
      processNames={processNames}
      bare={bare}
    />
  );
  const details = (
    <>
      <Card id="patterns-fill" title={texts.fillTitle}>
        <span style={secondary}>{texts.fillNote}</span>
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

      <Card id="patterns-standouts" title={texts.standoutsTitle}>
        <span data-testid="patterns-standouts-badge" style={secondary}>
          {texts.standoutsBadge} · {texts.standoutsNote}
        </span>
        {data.standouts.length === 0 ? (
          <p data-testid="patterns-standouts-empty" style={secondary}>
            {texts.standoutsEmpty}
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {data.standouts.map((item, index) => (
              <li key={index} data-testid="patterns-standout">
                <strong>{standoutName(item, questions, processNames)}</strong> —{' '}
                {texts.standoutLine(
                  item.wonRatio,
                  item.overallWonRatio,
                  item.diff,
                  item.won,
                  item.failed,
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

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
      </Card>

      <Card id="patterns-contacts" title={texts.contactsTitle}>
        <span style={secondary}>{texts.contactsNote}</span>
        {data.contactsBeforeVisit.map((row) => (
          <CellRow
            key={`${row.visited}-${row.bucket}`}
            testId="patterns-contact-row"
            label={`${row.visited ? texts.contactVisited : texts.contactNoVisit} · ${
              texts.contactBuckets[row.bucket] ?? row.bucket
            }`}
            row={row}
          />
        ))}
      </Card>

      <Card id="patterns-gap" title={texts.gapTitle}>
        <span style={secondary}>{texts.gapNote}</span>
        {data.longestGap.map((row) => (
          <CellRow
            key={row.bucket}
            testId="patterns-gap-row"
            label={texts.gapBuckets[row.bucket] ?? row.bucket}
            row={row}
          />
        ))}
      </Card>

      <Card id="patterns-answers" title={texts.answersTitle}>
        <span style={secondary}>{texts.answersNote}</span>
        {answerQuestions.map((questionId) => (
          <div key={questionId} style={{ display: 'grid', gap: 4 }}>
            <strong>{questionText(questions, questionId)}</strong>
            {data.answerOutcomes
              .filter((row) => row.questionId === questionId)
              .map((row) => (
                <CellRow
                  key={row.answerId}
                  testId="patterns-answer-row"
                  label={answerText(questions, questionId, row.answerId)}
                  row={row}
                />
              ))}
          </div>
        ))}
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

      <Card id="patterns-hints" title={texts.hintsTitle}>
        <span data-testid="patterns-hints-badge" style={secondary}>
          {texts.hintsBadge} · {texts.hintsNote}
        </span>
        {data.questionnaireHints.length === 0 ? (
          <p style={secondary}>{texts.hintsEmpty}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {data.questionnaireHints.map((hint) => {
              const detail =
                hint.kind === 'SAME_ANSWER'
                  ? texts.hintKinds.SAME_ANSWER(
                      hint.answerId ? answerText(questions, hint.questionId, hint.answerId) : '',
                      hint.share,
                    )
                  : texts.hintKinds.UNKNOWN_MANY(hint.share);
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
    </>
  );

  if (beside === undefined) {
    return (
      <section
        aria-labelledby="patterns-title"
        data-testid="patterns"
        style={{ display: 'grid', gap: 16 }}
      >
        {head}
        {summary(false)}
        {details}
      </section>
    );
  }
  // 시안: 왼쪽 AI 분석 피드백 | 오른쪽 흰 카드 하나에 "기록에서 배우기" 머리와 자동 요약. 나머지 카드는 그 아래.
  return sideBySide(
    <section
      aria-labelledby="patterns-title"
      data-testid="patterns"
      style={{ ...cardStyle, gap: 16 }}
    >
      {head}
      {summary(true)}
    </section>,
    <div
      role="group"
      aria-label={analysisToneTexts.patternDetails}
      data-testid="patterns-details"
      style={{ display: 'grid', gap: 16 }}
    >
      {details}
    </div>,
  );
}
