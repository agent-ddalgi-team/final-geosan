// 회사별 보고서 "1. 회사 한눈에"(#972): 왼쪽 카드(회사·꼬리표·기본 정보 여섯 칸) + 오른쪽 카드(점수 동그라미·영업 요약 네 칸).
// 값은 reportModelOf가 고른 것만 그린다. 값이 없으면 "확인 필요", 사람이 확인하기 전 값에는 "AI 제안 · 확인 전"을 붙인다.
import type { ReactNode } from 'react';
import {
  banner,
  companyGlance,
  companyReport,
  labelFor,
  outcomeStatusLabels,
  reportView,
  salesStepLabels,
  scoreStateLabels,
} from '../../labels/ko';
import { accent, colors, warn } from '../../theme/tokens';
import { formatDate } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import type { ReportModel } from './reportModel';
import { Mark, NeedCheck, ReportSection, ReportTag } from './reportParts';

const texts = companyReport;
const view = reportView.glance;

function Fact({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="report-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Mini({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId}>
      <span className="report-mini-label">{label}</span> <b>{children}</b>
    </div>
  );
}

// 동그라미 크기(시안 값). 둘레는 반지름에서 계산한다.
const RING = { size: 118, center: 59, radius: 46, stroke: 9 } as const;
const RING_LENGTH = 2 * Math.PI * RING.radius;

/** 점수 동그라미: 합계 / 배점의 합. 색만으로 알리지 않게 옆에 숫자가 함께 있고, 그림에는 읽어 주는 이름을 단다. */
function ScoreRing({ total, max }: { total: number | null; max: number }) {
  const ratio = total !== null && max > 0 ? Math.min(Math.max(total / max, 0), 1) : 0;
  return (
    <svg
      width={RING.size}
      height={RING.size}
      viewBox={`0 0 ${RING.size} ${RING.size}`}
      role="img"
      aria-label={total !== null ? view.ringAria(total, max) : view.ringAriaNone}
      data-testid="report-score-ring"
      data-ratio={ratio.toFixed(2)}
      style={{ flex: 'none' }}
    >
      <circle
        cx={RING.center}
        cy={RING.center}
        r={RING.radius}
        fill="none"
        stroke={colors.borderSecondary}
        strokeWidth={RING.stroke}
      />
      {ratio > 0 ? (
        <circle
          cx={RING.center}
          cy={RING.center}
          r={RING.radius}
          fill="none"
          stroke={accent.bright}
          strokeWidth={RING.stroke}
          strokeLinecap="round"
          strokeDasharray={`${ratio * RING_LENGTH} ${RING_LENGTH}`}
          transform={`rotate(-90 ${RING.center} ${RING.center})`}
        />
      ) : null}
    </svg>
  );
}

export default function ReportGlance({
  isVirtual,
  glance,
  scoreSummary,
  sales,
}: Pick<ReportModel, 'isVirtual' | 'glance' | 'scoreSummary' | 'sales'>) {
  const labels = texts.glance;
  const hasProcess = glance.processConfirmed.length + glance.processProposed.length > 0;
  const count = sales.contactCount;
  return (
    <ReportSection id="report-glance" card={false} className="report-two">
      <div className="report-card">
        <p id="report-glance-heading" className="report-eyebrow">
          {texts.sections.glance}
        </p>
        <h1 data-testid="report-name">{glance.name}</h1>
        <p className="report-sub" data-testid="report-item">
          {view.item(labels.item, glance.item)}
        </p>
        <p className="report-marks" data-testid="report-marks">
          <StatusTag tone="neutral" bold data-testid="report-internal">
            {texts.internal}
          </StatusTag>
          {isVirtual ? (
            <StatusTag tone="wait" data-testid="report-virtual">
              {banner.virtualData}
            </StatusTag>
          ) : null}
          {glance.processConfirmed.length > 0 ? (
            <ReportTag tone="ok" testId="report-process-tag">
              {view.processConfirmed}
            </ReportTag>
          ) : null}
          {glance.needCheckCount > 0 ? (
            <ReportTag tone="warn" testId="report-need-check-count">
              {view.needCheckCount(texts.needCheck, glance.needCheckCount)}
            </ReportTag>
          ) : null}
        </p>
        <dl className="report-facts">
          <Fact label={labels.address} testId="report-address">
            {glance.address ?? <NeedCheck />}
          </Fact>
          <Fact label={labels.homepage} testId="report-homepage">
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
          </Fact>
          <Fact label={labels.process} testId="report-process">
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
            {hasProcess ? null : <NeedCheck />}
          </Fact>
          <Fact label={labels.industry} testId="report-industry">
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
          </Fact>
          {glance.fitLevel || glance.pickReason ? (
            <Fact label={view.fitAndReason} testId="report-fit-reason">
              {glance.fitLevel ? (
                <span data-testid="report-fit">
                  {companyGlance.fit[glance.fitLevel]}
                  <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
                </span>
              ) : null}
              {glance.fitLevel && glance.pickReason ? ' · ' : null}
              {glance.pickReason ? (
                <span data-testid="report-pick-reason">
                  {glance.pickReason}
                  <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
                </span>
              ) : null}
            </Fact>
          ) : null}
          <Fact label={labels.intro} testId="report-intro">
            {glance.summaryLine ? (
              <>
                {glance.summaryLine}
                {glance.summaryIsAi ? (
                  <Mark testId="report-ai-mark">{texts.aiProposal}</Mark>
                ) : null}
              </>
            ) : (
              <NeedCheck />
            )}
          </Fact>
        </dl>
      </div>
      <div className="report-card" data-testid="report-score-card">
        <p className="report-eyebrow">{labels.score}</p>
        <div className="report-ring-row">
          <ScoreRing total={scoreSummary?.total ?? null} max={scoreSummary?.max ?? 0} />
          <div>
            <div className="report-score-big" data-testid="report-score-total">
              {scoreSummary && scoreSummary.total !== null ? (
                <>
                  {scoreSummary.total}
                  <span>{view.outOf(scoreSummary.max)}</span>
                </>
              ) : (
                view.noScore
              )}
            </div>
            <p className="report-dim" data-testid="report-score">
              {glance.scoreText}
            </p>
            {scoreSummary ? (
              <p className="report-dim" data-testid="report-score-states">
                {scoreSummary.states
                  .map((row) => view.stateCount(labelFor(scoreStateLabels, row.state), row.count))
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="report-mini">
          <Mini label={texts.sales.stage} testId="report-glance-stage">
            {outcomeStatusLabels[sales.status]}
          </Mini>
          <Mini label={texts.sales.step} testId="report-glance-step">
            {sales.step ? salesStepLabels[sales.step] : texts.sales.stepNone}
          </Mini>
          <Mini label={texts.sales.contacts} testId="report-glance-contacts">
            {reportView.sales.contactTotal(count?.total ?? 0)}
          </Mini>
          <Mini label={texts.sales.lastContact} testId="report-glance-last-contact">
            {formatDate(sales.lastContactAt) ?? texts.sales.none}
          </Mini>
        </div>
        {sales.nextScheduleMissed && sales.nextScheduleAt ? (
          <div
            className="report-alert"
            data-testid="report-missed-alert"
            style={{ background: warn.bg, color: warn.text }}
          >
            <b>{reportView.sales.missed}</b>
            {view.missedHint(sales.nextScheduleAt)}
          </div>
        ) : null}
      </div>
    </ReportSection>
  );
}
