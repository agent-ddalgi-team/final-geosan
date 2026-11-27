// 회사별 보고서 "2. 점수 8항목"(#972): 줄마다 이름 · 막대 · 점수/배점 · 상태 꼬리표. 줄을 누르면 이유가 펼쳐진다.
// 항목 이름·배점·상태 말은 응답 그대로다. 인쇄할 때는 접힌 이유도 모두 펼쳐 나온다(styles.css의 인쇄 규칙).
// 어느 줄이 펼쳐졌는지는 보고서 화면이 갖고 있다(맨 위 [근거 설명 모두 펼치기]가 같은 값을 바꾼다).
import { companyReport, labelFor, reportView, scoreStateLabels } from '../../labels/ko';
import { accent, neutralChip } from '../../theme/tokens';
import type { ReportModel, ReportScoreRow } from './reportModel';
import { Mark, NeedCheck, ReportHeading, ReportSection, ReportTag } from './reportParts';
import type { ReportTagTone } from './reportParts';

const texts = companyReport;
const view = reportView.scores;

/** 상태 꼬리표 색. 색은 보조 신호이고 상태 말이 늘 함께 있다. 표에 없는 상태는 중립. */
const STATE_TONE: Record<string, ReportTagTone> = {
  CONFIRMED: 'ok',
  STRONG: 'accent',
  WEAK: 'accent',
  NO_BONUS: 'warn',
  MISMATCH: 'warn',
};

/** 펼칠 이유(판정 요지)가 있는 줄인가. 없는 줄은 누르는 단추가 아니다. */
export function hasScoreReason(row: ReportScoreRow): boolean {
  return row.fact !== null;
}

function ScoreLine({ row }: { row: ReportScoreRow }) {
  const ratio =
    row.score !== null && row.weight > 0 ? Math.min(Math.max(row.score / row.weight, 0), 1) : 0;
  return (
    <>
      <span className="report-score-name">
        {row.label}
        {row.aiProposed ? <Mark testId="report-ai-mark">{texts.aiProposal}</Mark> : null}
      </span>
      <span className="report-bar" aria-hidden="true" style={{ background: neutralChip.bg }}>
        <span style={{ width: `${ratio * 100}%`, background: accent.bright }} />
      </span>
      <span className="report-score-num report-nowrap" data-testid="report-score-value">
        {row.score === null ? <NeedCheck /> : row.score}
        <span>{view.ofWeight(row.weight)}</span>
      </span>
      <span className="report-score-state">
        <ReportTag tone={STATE_TONE[row.state] ?? 'neutral'} testId="report-score-state">
          {labelFor(scoreStateLabels, row.state)}
        </ReportTag>
      </span>
    </>
  );
}

export default function ReportScores({
  scores,
  summary,
  open,
  onToggle,
}: {
  scores: ReportModel['scores'];
  summary: ReportModel['scoreSummary'];
  /** 이유가 펼쳐진 항목 코드. */
  open: ReadonlySet<string>;
  onToggle: (code: string) => void;
}) {
  return (
    <ReportSection id="report-scores">
      <ReportHeading
        id="report-scores-heading"
        title={texts.sections.scores}
        note={scores ? <span className="no-print">{view.hint}</span> : undefined}
      />
      {scores ? (
        <>
          <div className="report-score-rows" data-testid="report-scores-table">
            {scores.map((row) => {
              const expandable = hasScoreReason(row);
              const expanded = expandable && open.has(row.code);
              const reasonId = `report-score-why-${row.code}`;
              return (
                <div
                  key={row.code}
                  className="report-score-row"
                  data-testid="report-score-row"
                  data-item={row.code}
                >
                  {expandable ? (
                    <button
                      type="button"
                      className="report-score-head"
                      aria-expanded={expanded}
                      aria-controls={reasonId}
                      onClick={() => onToggle(row.code)}
                      data-testid="report-score-toggle"
                    >
                      <ScoreLine row={row} />
                      <span
                        className="report-chevron"
                        aria-hidden="true"
                        data-open={expanded ? 'true' : 'false'}
                      >
                        ›
                      </span>
                    </button>
                  ) : (
                    <div className="report-score-head">
                      <ScoreLine row={row} />
                    </div>
                  )}
                  {expandable ? (
                    <p
                      id={reasonId}
                      className="report-score-why"
                      hidden={!expanded}
                      data-testid="report-score-why"
                    >
                      {row.fact}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {summary ? (
            <div className="report-score-total" data-testid="report-score-summary">
              {summary.total !== null ? (
                <span>
                  {view.total}{' '}
                  <b>
                    {summary.total}
                    {view.ofWeight(summary.max)}
                  </b>
                </span>
              ) : null}
              <span>
                {view.earned} <b>{view.earnedCount(summary.earned)}</b>
              </span>
              {summary.biggestGap ? (
                <span>
                  {view.biggestGap}{' '}
                  <b>
                    {view.gap(
                      summary.biggestGap.label,
                      summary.biggestGap.score,
                      summary.biggestGap.weight,
                    )}
                  </b>
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p data-testid="report-scores-none">{texts.scores.none}</p>
      )}
    </ReportSection>
  );
}
