// 영업 분석 › 단계별 접촉 표(#684): 세부 단계마다 그 단계에 이르기까지 걸린 접촉과, 그 단계에 머무는 동안의 접촉.
// 숫자는 서버가 기록 행과 꼬리 질문 답으로 다시 계산한 값 그대로다. 표본이 적으면 평균·비율 없이 건수만 보인다.
import type { StepAnalysisRow } from '../../api/salesAnalysis';
import { labelFor, salesAnalysisTexts as texts, salesStepLabels } from '../../labels/ko';
import { reachText, stepContactsText, stepRatioText, stepToReachText } from './analysisText';
import { analysisCell, analysisHead } from './ProcessAnalysisTable';

export default function StepAnalysisTable({ rows }: { rows: StepAnalysisRow[] }) {
  const columns = texts.stepColumns;
  return (
    <div tabIndex={0} role="region" aria-label={texts.stepTableLabel} style={{ overflowX: 'auto' }}>
      <table
        data-testid="analysis-step-table"
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
          {rows.map((row) => (
            <tr key={row.step} data-testid="analysis-step-row">
              <th scope="row" style={{ ...analysisCell, fontWeight: 600 }}>
                {labelFor(salesStepLabels, row.step)}
              </th>
              <td style={analysisCell}>{stepToReachText(row)}</td>
              <td style={analysisCell}>{stepContactsText(row)}</td>
              <td style={analysisCell}>{row.contactCount > 0 ? reachText(row) : texts.none}</td>
              <td style={analysisCell} data-testid="analysis-step-ratio-cell">
                {stepRatioText(row)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
