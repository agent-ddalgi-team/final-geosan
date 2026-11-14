// 영업 분석 › 공정별 표(#608): 공정 줄 아래에 산업군 줄을 들여 쓴다. 진짜 표(th scope)로 그린다.
// 확정된 공정·산업군만 센다(#652). 확정된 값이 여러 개인 회사는 줄마다 세므로 줄의 합이 회사 수보다 클 수 있다.
// 그래서 맨 위 "전체" 줄은 회사를 한 번씩만 센 합계이고, 줄마다 다른 줄에도 든 회사 수를 알린다(#684).
import { Fragment } from 'react';
import type { AnalysisStats, ProcessAnalysisRow } from '../../api/salesAnalysis';
import { salesAnalysisTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { avgToWonText, lostReasonsText, ratioText, reachText } from './analysisText';

export const analysisCell = {
  padding: '8px 12px',
  textAlign: 'left',
  verticalAlign: 'top',
  borderBottom: `1px solid ${colors.borderSecondary}`,
} as const;
export const analysisHead = {
  ...analysisCell,
  background: colors.bgLayout,
  fontWeight: 600,
  whiteSpace: 'nowrap',
} as const;

function StatCells({ stats }: { stats: AnalysisStats }) {
  return (
    <>
      <td style={analysisCell}>{texts.places(stats.contactedCount)}</td>
      <td style={analysisCell}>{texts.places(stats.inProgressCount)}</td>
      <td style={analysisCell}>{texts.places(stats.onHoldCount)}</td>
      <td style={analysisCell}>{texts.places(stats.wonCount)}</td>
      <td style={analysisCell}>{texts.places(stats.lostCount)}</td>
      <td style={analysisCell}>{avgToWonText(stats)}</td>
      <td style={analysisCell}>{reachText(stats)}</td>
      <td style={analysisCell}>{lostReasonsText(stats)}</td>
      <td style={analysisCell} data-testid="analysis-ratio-cell">
        {ratioText(stats)}
      </td>
    </>
  );
}

/** "이 중 다른 공정에도 든 회사 2곳" — 0곳이면 보이지 않는다. */
function Overlap({ kind, count }: { kind: string; count: number }) {
  if (count <= 0) return null;
  return (
    <div
      data-testid="analysis-overlap"
      style={{
        fontWeight: 400,
        color: colors.textSecondary,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      {texts.overlap(kind, count)}
    </div>
  );
}

export interface ProcessAnalysisTableProps {
  rows: ProcessAnalysisRow[];
  /** 회사를 한 번씩만 센 합계(#684). 표 맨 위 "전체" 줄. */
  total: AnalysisStats;
}

export default function ProcessAnalysisTable({ rows, total }: ProcessAnalysisTableProps) {
  const columns = texts.processColumns;
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={texts.processTableLabel}
      style={{ overflowX: 'auto' }}
    >
      <table
        data-testid="analysis-process-table"
        style={{ width: '100%', borderCollapse: 'collapse' }}
      >
        <thead>
          <tr>
            {Object.values(columns).map((name) => (
              <th key={name} scope="col" style={analysisHead}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr data-testid="analysis-total-row" style={{ background: colors.bgLayout }}>
            <th scope="row" style={{ ...analysisCell, fontWeight: 600 }}>
              {texts.totalRow}
            </th>
            <StatCells stats={total} />
          </tr>
          {rows.map((row) => (
            <Fragment key={row.processCode ?? 'none'}>
              <tr data-testid="analysis-process-row">
                <th scope="row" style={{ ...analysisCell, fontWeight: 600 }}>
                  {row.processName}
                  <Overlap kind={texts.overlapProcess} count={row.overlapCount} />
                </th>
                <StatCells stats={row} />
              </tr>
              {row.byIndustry.map((item) => (
                <tr
                  key={item.industry}
                  data-testid="analysis-industry-row"
                  style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
                >
                  <th scope="row" style={{ ...analysisCell, fontWeight: 400, paddingLeft: 28 }}>
                    {texts.industryPrefix}
                    {item.industry}
                    <Overlap kind={texts.overlapIndustry} count={item.overlapCount} />
                  </th>
                  <StatCells stats={item} />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
