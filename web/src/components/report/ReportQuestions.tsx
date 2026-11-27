// 회사별 보고서 "4. 확인 질문과 지금까지의 답"(#972): 왼쪽 카드 "지금까지 들은 답" | 오른쪽 카드 "방문·통화 때 물을 것".
// 직접 적은 답 글은 싣지 않고 답한 날만 적는다(#565).
import { companyReport, reportView, reviewItemSourceLabels } from '../../labels/ko';
import { formatDate } from '../../utils/time';
import type { ReportModel } from './reportModel';
import { Mark, ReportSection } from './reportParts';

const texts = companyReport;
const labels = texts.questions;
const view = reportView.questions;

export default function ReportQuestions({ known, ask }: Pick<ReportModel, 'known' | 'ask'>) {
  return (
    <ReportSection id="report-questions" card={false} className="report-qa">
      <div className="report-card">
        <h2 id="report-questions-heading" className="report-eyebrow">
          {texts.sections.questions}
        </h2>
        <h3>{labels.knownTitle}</h3>
        {known.length === 0 ? (
          <p data-testid="report-known-none">{labels.knownNone}</p>
        ) : (
          <ul className="report-lines" data-testid="report-known-list">
            {known.map((row) => (
              <li key={row.questionId} data-testid="report-known">
                {row.question} <strong>{row.answers.join(', ')}</strong>
                {formatDate(row.at) ? (
                  <span className="report-dim"> · {formatDate(row.at)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="report-dim report-foot-note">{view.knownHint}</p>
      </div>
      <div className="report-card">
        <p className="report-eyebrow">{labels.askTitle}</p>
        <h3 id="report-ask-heading" data-testid="report-ask-left">
          {view.left(ask.length)}
        </h3>
        {ask.length === 0 ? (
          <p data-testid="report-ask-none">{labels.askNone}</p>
        ) : (
          <ul className="report-lines" data-testid="report-ask-list">
            {ask.map((row) => (
              <li key={row.key} data-testid="report-ask" data-line={row.key}>
                <span className="report-ask-text">
                  {row.topic ? <strong>{row.topic} — </strong> : null}
                  {row.text}
                  {row.source ? (
                    <Mark testId="report-ask-source">{reviewItemSourceLabels[row.source]}</Mark>
                  ) : null}
                </span>
                {row.answered ? (
                  <span className="report-dim report-ask-sub" data-testid="report-ask-answered">
                    {labels.answered(formatDate(row.answeredAt))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ReportSection>
  );
}
