// 회사별 보고서 "3. 근거"(#972): 원문 인용 카드 2열 + 출처. 묶음 거르기 단추("전체 · 제품 4 · 소재 2")는
// 응답의 근거 묶음으로 만든다. 걸러서 안 보이는 카드도 지우지 않고 숨기기만 해서, 인쇄할 때는 전체가 나온다.
import { useState } from 'react';
import { certaintyLabels, companyReport, labelFor, reportView } from '../../labels/ko';
import { formatDate } from '../../utils/time';
import type { ReportModel } from './reportModel';
import { Mark, ReportHeading, ReportSection, ReportTag } from './reportParts';

const texts = companyReport;
const view = reportView.evidence;

export default function ReportEvidence({
  evidence,
  groups,
}: {
  evidence: ReportModel['evidence'];
  groups: ReportModel['evidenceGroups'];
}) {
  /** 고른 묶음 코드. null이면 전체. */
  const [picked, setPicked] = useState<string | null>(null);
  // 묶음이 하나뿐이면 거를 것이 없다.
  const filters =
    groups.length > 1 ? (
      <div
        role="group"
        aria-label={view.filterAria}
        className="no-print report-chips"
        data-testid="report-evidence-filters"
      >
        <button
          type="button"
          className="report-chip"
          aria-pressed={picked === null}
          onClick={() => setPicked(null)}
          data-testid="report-evidence-filter"
          data-group="ALL"
        >
          {view.all}
        </button>
        {groups.map((group) => (
          <button
            key={group.code}
            type="button"
            className="report-chip"
            aria-pressed={picked === group.code}
            onClick={() => setPicked(group.code)}
            data-testid="report-evidence-filter"
            data-group={group.code}
          >
            {view.chip(labelFor(view.groups, group.code), group.count)}
          </button>
        ))}
      </div>
    ) : undefined;
  return (
    <ReportSection id="report-evidence-section">
      <ReportHeading
        id="report-evidence-section-heading"
        title={texts.sections.evidence}
        note={evidence.length > 0 ? view.count(evidence.length) : undefined}
        tools={filters}
      />
      {evidence.length === 0 ? (
        <p data-testid="report-evidence-none">{texts.evidence.none}</p>
      ) : (
        <ol className="report-evidence-grid" data-testid="report-evidence-list">
          {evidence.map((row) => {
            const date = formatDate(row.occurredAt);
            return (
              <li
                key={row.id}
                className="report-evidence-card"
                data-testid="report-evidence"
                data-group={row.group}
                hidden={picked !== null && row.group !== picked}
              >
                <span className="report-evidence-group">{labelFor(view.groups, row.group)}</span>
                <blockquote>
                  “{row.quote}”
                  {row.aiProposed ? <Mark testId="report-ai-mark">{texts.aiProposal}</Mark> : null}
                </blockquote>
                <div className="report-evidence-foot">
                  <ReportTag tone={row.certainty === 'CONFIRMED' ? 'ok' : 'neutral'}>
                    {labelFor(certaintyLabels, row.certainty)}
                  </ReportTag>
                  <span>
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
                    {date ? ` · ${texts.evidence.date(date)}` : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </ReportSection>
  );
}
