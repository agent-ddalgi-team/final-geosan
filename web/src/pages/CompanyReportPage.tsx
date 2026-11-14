// 회사별 보고서(#565, PM 결정 2026-11-14): 상세의 [보고서]로 (새 창에) 여는 인쇄용 한 쪽 화면. 브라우저 인쇄로 PDF로 저장한다.
// 상세가 이미 부르는 응답 둘(상세 GET /opportunities/{id}, 꼬리 질문 파일 GET /sales-questions)만 읽는다.
// 저장된 값만 쓰고 AI를 다시 부르지 않으며, 값이 없는 칸은 지어내지 않고 "확인 필요"로 둔다.
// 영업 메모·대표번호·직접 적은 답 글은 싣지 않는다: 화면은 reportModelOf가 고른 값만 그린다.
// 메뉴·담당자 고르기가 있는 공통 틀 없이 그려서 인쇄에 그대로 맞고, 단추·링크 줄은 인쇄할 때 숨긴다(.no-print).
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getOpportunityDetail, getSalesQuestions } from '../api/client';
import type { OpportunityDetail, SalesQuestions } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import StatusTag from '../components/common/StatusTag';
import { reportModelOf } from '../components/report/reportModel';
import type { ReportModel } from '../components/report/reportModel';
import {
  banner,
  certaintyLabels,
  companyGlance,
  companyReport,
  labelFor,
  lostReasonLabels,
  outcomeStatusLabels,
  recordsArea,
  reviewItemSourceLabels,
  salesQuestionTexts,
  salesStepLabels,
  scoreStateLabels,
} from '../labels/ko';
import { colors, typography } from '../theme/tokens';
import { formatMonthDay, todayKst } from '../utils/time';

const texts = companyReport;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const cell = {
  padding: '4px 8px',
  textAlign: 'left',
  verticalAlign: 'top',
  borderBottom: `1px solid ${colors.borderSecondary}`,
} as const;

interface Loaded {
  key: string;
  detail?: OpportunityDetail;
  hasVirtualData?: boolean;
  /** 꼬리 질문 파일. 못 받았으면 null이고 questionsFailed가 참이다. */
  questions?: SalesQuestions | null;
  questionsFailed?: boolean;
  error?: unknown;
}

function Mark({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <span data-testid={testId} style={secondary}>
      {' '}
      ({children})
    </span>
  );
}

function NeedCheck({ testId }: { testId?: string }) {
  return (
    <strong data-testid={testId ?? 'report-need-check'} className="report-need-check">
      {texts.needCheck}
    </strong>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} data-testid={id} className="report-section">
      <h2 id={`${id}-heading`}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="report-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Glance({ glance }: { glance: ReportModel['glance'] }) {
  const labels = texts.glance;
  return (
    <dl className="report-rows">
      <Row label={labels.name} testId="report-name">
        {glance.name}
      </Row>
      <Row label={labels.item} testId="report-item">
        {glance.item}
      </Row>
      <Row label={labels.address} testId="report-address">
        {glance.address ?? <NeedCheck />}
      </Row>
      <Row label={labels.homepage} testId="report-homepage">
        {glance.homepageUrl ? (
          <>
            <a href={glance.homepageUrl} target="_blank" rel="noopener noreferrer">
              {glance.homepageUrl}
            </a>
            {glance.homepageMark === 'AI' ? (
              <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
            ) : null}
            {glance.homepageMark === 'NEED_CHECK' ? (
              <Mark testId="report-homepage-check">{texts.needCheck}</Mark>
            ) : null}
          </>
        ) : (
          <NeedCheck />
        )}
      </Row>
      <Row label={labels.intro} testId="report-intro">
        {glance.summaryLine ? (
          <>
            {glance.summaryLine}
            {glance.summaryIsAi ? <Mark testId="report-ai-mark">{texts.aiProposal}</Mark> : null}
          </>
        ) : (
          <NeedCheck />
        )}
      </Row>
      {glance.fitLevel ? (
        <Row label={labels.fit} testId="report-fit">
          {companyGlance.fit[glance.fitLevel]}
          <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
        </Row>
      ) : null}
      {glance.pickReason ? (
        <Row label={labels.pickReason} testId="report-pick-reason">
          {glance.pickReason}
          <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
        </Row>
      ) : null}
      {glance.reason ? (
        <Row label={labels.reason} testId="report-reason">
          {glance.reason}
        </Row>
      ) : null}
      <Row label={labels.process} testId="report-process">
        {glance.processConfirmed.length > 0 ? (
          <span data-testid="report-process-confirmed">
            {glance.processConfirmed.join(', ')}
            <Mark testId="report-confirmed-mark">{texts.confirmed}</Mark>
          </span>
        ) : null}
        {glance.processConfirmed.length > 0 && glance.processProposed.length > 0 ? ' · ' : null}
        {glance.processProposed.length > 0 ? (
          <span data-testid="report-process-proposed">
            {glance.processProposed.join(', ')}
            <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
          </span>
        ) : null}
        {glance.processConfirmed.length === 0 && glance.processProposed.length === 0 ? (
          <NeedCheck />
        ) : null}
      </Row>
      <Row label={labels.industry} testId="report-industry">
        {glance.industries.length > 0 ? (
          <>
            {glance.industries.join(', ')}
            {glance.industriesConfirmed ? (
              <Mark testId="report-confirmed-mark">{texts.confirmed}</Mark>
            ) : (
              <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
            )}
          </>
        ) : (
          <NeedCheck />
        )}
      </Row>
      <Row label={labels.score} testId="report-score">
        {glance.scoreText}
      </Row>
    </dl>
  );
}

function ScoreTable({ scores }: { scores: ReportModel['scores'] }) {
  if (!scores) return <p data-testid="report-scores-none">{texts.scores.none}</p>;
  const columns = texts.scores.columns;
  return (
    <table data-testid="report-scores-table" className="report-table">
      <thead>
        <tr>
          {Object.values(columns).map((name) => (
            <th key={name} scope="col" style={cell}>
              {name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {scores.map((row) => (
          <tr key={row.code} data-testid="report-score-row" data-item={row.code}>
            <th scope="row" style={{ ...cell, fontWeight: 400 }}>
              {row.label}
              {row.fact ? <span style={secondary}> — {row.fact}</span> : null}
              {row.aiProposed ? <Mark testId="report-ai-mark">{texts.aiProposal}</Mark> : null}
            </th>
            <td style={cell}>{row.weight}</td>
            <td style={cell} data-testid="report-score-value">
              {row.score === null ? <NeedCheck /> : row.score}
            </td>
            <td style={cell}>{labelFor(scoreStateLabels, row.state)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvidenceList({ evidence }: { evidence: ReportModel['evidence'] }) {
  if (evidence.length === 0) return <p data-testid="report-evidence-none">{texts.evidence.none}</p>;
  return (
    <ol className="report-list" data-testid="report-evidence-list">
      {evidence.map((row) => {
        const date = formatMonthDay(row.occurredAt);
        return (
          <li key={row.id} data-testid="report-evidence">
            <span>“{row.quote}”</span>
            {row.aiProposed ? <Mark testId="report-ai-mark">{texts.aiProposal}</Mark> : null}
            <div style={secondary}>
              {texts.evidence.source}:{' '}
              {row.source.map((part, index) =>
                part.href ? (
                  <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
                    {part.text}
                  </a>
                ) : (
                  <span key={index}>{part.text}</span>
                ),
              )}
              {' · '}
              {labelFor(certaintyLabels, row.certainty)}
              {date ? ` · ${texts.evidence.date(date)}` : ''}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Questions({ known, ask }: Pick<ReportModel, 'known' | 'ask'>) {
  const labels = texts.questions;
  return (
    <>
      <h3>{labels.knownTitle}</h3>
      {known.length === 0 ? (
        <p data-testid="report-known-none">{labels.knownNone}</p>
      ) : (
        <ul className="report-list" data-testid="report-known-list">
          {known.map((row) => (
            <li key={row.questionId} data-testid="report-known">
              {row.question} <strong>{row.answers.join(', ')}</strong>
              {formatMonthDay(row.at) ? (
                <span style={secondary}> · {formatMonthDay(row.at)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <h3>{labels.askTitle}</h3>
      {ask.length === 0 ? (
        <p data-testid="report-ask-none">{labels.askNone}</p>
      ) : (
        <ul className="report-list" data-testid="report-ask-list">
          {ask.map((row) => (
            <li key={row.key} data-testid="report-ask" data-line={row.key}>
              {row.topic ? <strong>{row.topic} — </strong> : null}
              {row.text}
              {row.source ? (
                <Mark testId="report-ask-source">{reviewItemSourceLabels[row.source]}</Mark>
              ) : null}
              {row.answered ? (
                <span data-testid="report-ask-answered" style={secondary}>
                  {' '}
                  · {labels.answered(formatMonthDay(row.answeredAt))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Sales({ sales }: { sales: ReportModel['sales'] }) {
  const labels = texts.sales;
  const count = sales.contactCount;
  return (
    <dl className="report-rows">
      <Row label={labels.stage} testId="report-stage">
        {outcomeStatusLabels[sales.status]}
      </Row>
      <Row label={labels.step} testId="report-step">
        {sales.step
          ? salesQuestionTexts.stepSince(salesStepLabels[sales.step], sales.stepSince)
          : labels.stepNone}
      </Row>
      {sales.lostReasonCode ? (
        <Row label={labels.lostReason} testId="report-lost-reason">
          {lostReasonLabels[sales.lostReasonCode]}
        </Row>
      ) : null}
      <Row label={labels.contacts} testId="report-contacts">
        {count
          ? recordsArea.contactCount(count.total, count.call, count.email, count.visit)
          : recordsArea.contactCount(0, 0, 0, 0)}
      </Row>
      <Row label={labels.lastContact} testId="report-last-contact">
        {formatMonthDay(sales.lastContactAt) ?? labels.none}
      </Row>
      <Row label={labels.nextSchedule} testId="report-next-schedule">
        {sales.nextScheduleAt ?? labels.none}
      </Row>
    </dl>
  );
}

export default function CompanyReportPage() {
  const { oppId = '' } = useParams();
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const requestKey = `${oppId}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    // 꼬리 질문 파일을 못 받아도 보고서는 만들 수 있다. 다만 빠진 줄이 있다고 화면에 알린다.
    const questions = Promise.resolve()
      .then(() => getSalesQuestions())
      .then((envelope) => ({ data: envelope.data, failed: false }))
      .catch(() => ({ data: null, failed: true }));
    Promise.all([getOpportunityDetail(oppId, controller.signal), questions])
      .then(([envelope, asked]) =>
        setLoaded({
          key: requestKey,
          detail: envelope.data,
          hasVirtualData: Boolean(envelope.meta?.hasVirtualData),
          questions: asked.data,
          questionsFailed: asked.failed,
        }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [oppId, requestKey]);

  const retry = useCallback(() => setReload((n) => n + 1), []);
  const current = loaded?.key === requestKey ? loaded : null;
  const notFound = current?.error instanceof ApiError && current.error.status === 404;
  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (notFound) state = 'empty';
  else if (current.error) state = 'error';

  const model = current?.detail
    ? reportModelOf(current.detail, Boolean(current.hasVirtualData), current.questions ?? null)
    : null;
  const detailPath = `/opportunities/${encodeURIComponent(oppId)}`;

  return (
    <main id="main" className="report-page" data-testid="report-page">
      <div className="no-print report-actions" data-testid="report-actions">
        <Link to={detailPath} data-testid="report-back-link">
          {texts.backToDetail}
        </Link>
        {model ? (
          <button type="button" onClick={() => window.print()} data-testid="report-print-button">
            {texts.print}
          </button>
        ) : null}
      </div>
      <FiveStates
        state={state}
        data-testid="report-states"
        emptyText={texts.notFound}
        errorTitle={texts.loadError}
        error={current?.error}
        onRetry={retry}
        partialNotice={current?.questionsFailed ? texts.questionsFailed : undefined}
      >
        {model ? (
          <article data-testid="company-report">
            <p className="report-marks" data-testid="report-marks">
              <StatusTag tone="neutral" bold data-testid="report-internal">
                {texts.internal}
              </StatusTag>
              {model.isVirtual ? (
                <StatusTag tone="wait" data-testid="report-virtual">
                  {banner.virtualData}
                </StatusTag>
              ) : null}
            </p>
            <h1>
              {texts.pageTitle} — {model.title}
            </h1>
            <p style={secondary} data-testid="report-made-at">
              {texts.madeAt(todayKst())}
            </p>
            <Section id="report-glance" title={texts.sections.glance}>
              <Glance glance={model.glance} />
            </Section>
            <Section id="report-scores" title={texts.sections.scores}>
              <ScoreTable scores={model.scores} />
            </Section>
            <Section id="report-evidence-section" title={texts.sections.evidence}>
              <EvidenceList evidence={model.evidence} />
            </Section>
            <Section id="report-questions" title={texts.sections.questions}>
              <Questions known={model.known} ask={model.ask} />
            </Section>
            <Section id="report-sales" title={texts.sections.sales}>
              <Sales sales={model.sales} />
            </Section>
          </article>
        ) : null}
      </FiveStates>
    </main>
  );
}
