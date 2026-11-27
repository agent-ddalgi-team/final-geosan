// 회사별 보고서 "5. 영업 단계와 다음 일정"과 "6. 영업 방향"(#972).
// 단계 그림은 기업 상세와 같은 부품(SalesProgressBar)을 그대로 가져다 쓴다. 그 부품에는 reportModelOf가 고른
// 값(단계·거절 이유 코드, 알아낸 답의 번호, 접촉 수)만 넘긴다: 일정의 할 일 글·담당자 키는 넘기지 않는다.
// 영업 방향은 저장된 코치 피드백을 읽기만 한다(입력 칸·[피드백 남기기]는 만들지 않는다).
import type { ReactNode } from 'react';
import type { SalesQuestions } from '../../api/types';
import {
  companyReport,
  lostReasonLabels,
  outcomeStatusLabels,
  reportView,
  salesStepLabels,
} from '../../labels/ko';
import { warn } from '../../theme/tokens';
import { formatDate } from '../../utils/time';
import SalesProgressBar from '../detail/SalesProgressBar';
import type { ReportModel } from './reportModel';
import { ReportHeading, ReportSection } from './reportParts';

const texts = companyReport;

function Stat({
  label,
  testId,
  value,
  sub,
  alert = false,
}: {
  label: string;
  testId: string;
  value: ReactNode;
  sub?: ReactNode;
  /** 놓친 일정처럼 주의색으로 보일 칸. 색만으로 알리지 않게 글자("놓친 일정")가 함께 있다. */
  alert?: boolean;
}) {
  return (
    <div data-testid={testId} style={alert ? { color: warn.text } : undefined}>
      <span className="report-stat-label">{label}</span> <b>{value}</b>
      {sub ? (
        <span className={alert ? 'report-stat-sub' : 'report-stat-sub report-dim'}> {sub}</span>
      ) : null}
    </div>
  );
}

export function ReportSales({
  sales,
  progress,
  questions,
}: Pick<ReportModel, 'sales' | 'progress'> & {
  /** 서버 질문 파일(단계 이름·순서). 못 받았으면 null이고 단계 그림은 코드표 순서로 그린다. */
  questions: SalesQuestions | null;
}) {
  const labels = texts.sales;
  const view = reportView.sales;
  const count = sales.contactCount;
  return (
    <ReportSection id="report-sales">
      <ReportHeading
        id="report-sales-heading"
        title={texts.sections.sales}
        note={
          <span data-testid="report-step">
            {labels.step} ·{' '}
            {sales.step
              ? labels.stepSince(salesStepLabels[sales.step], formatDate(sales.stepSince))
              : labels.stepNone}
          </span>
        }
      />
      <div className="report-progress" data-testid="report-progress">
        <SalesProgressBar
          salesStep={progress.salesStep}
          outcome={progress.outcome}
          contactTotal={progress.contactTotal}
          questions={questions}
        />
      </div>
      <div className="report-stats">
        <Stat
          label={labels.contacts}
          testId="report-contacts"
          value={view.contactTotal(count?.total ?? 0)}
          sub={
            count ? view.contactParts(count.call, count.email, count.visit) || undefined : undefined
          }
        />
        <Stat
          label={labels.lastContact}
          testId="report-last-contact"
          value={formatDate(sales.lastContactAt) ?? labels.none}
        />
        {sales.nextScheduleAt === null ? (
          <Stat label={labels.nextSchedule} testId="report-next-schedule" value={labels.none} />
        ) : sales.nextScheduleMissed ? (
          <Stat
            label={labels.nextSchedule}
            testId="report-next-schedule"
            value={view.missed}
            sub={sales.nextScheduleAt}
            alert
          />
        ) : (
          <Stat
            label={labels.nextSchedule}
            testId="report-next-schedule"
            value={sales.nextScheduleAt}
            sub={view.upcoming}
          />
        )}
        <Stat
          label={labels.stage}
          testId="report-stage"
          value={outcomeStatusLabels[sales.status]}
          sub={
            sales.lostReasonCode ? (
              <span data-testid="report-lost-reason">
                {labels.lostReason} · {lostReasonLabels[sales.lostReasonCode]}
              </span>
            ) : undefined
          }
        />
      </div>
    </ReportSection>
  );
}

/** (#742) 영업 방향: 남긴 코치 피드백 줄. (#750) 그 아래 가장 최근 다음 통화에 물어볼 것. 읽기 전용. */
export function ReportDirection({
  lines,
  nextCall,
}: {
  lines: ReportModel['direction'];
  nextCall: ReportModel['nextCall'];
}) {
  return (
    <ReportSection id="report-direction-section">
      <ReportHeading
        id="report-direction-section-heading"
        title={texts.sections.direction}
        note={lines.length > 0 ? texts.direction.mark : undefined}
      />
      {lines.length === 0 ? (
        <p className="report-dim" data-testid="report-direction-none">
          {texts.direction.none}
        </p>
      ) : (
        <ul className="report-lines" data-testid="report-direction">
          {lines.map((line, index) => (
            <li key={`${line.at ?? ''}-${index}`}>
              {line.at ? <span className="report-dim">{line.at} · </span> : null}
              {line.text}
            </li>
          ))}
        </ul>
      )}
      {nextCall ? (
        <>
          <h3>{texts.direction.nextCall(nextCall.at)}</h3>
          <ul className="report-lines" data-testid="report-next-call">
            {nextCall.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
    </ReportSection>
  );
}
