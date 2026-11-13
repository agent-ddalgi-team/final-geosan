// 영업 분석 › 회사별 표(#608): 회사 이름을 누르면 그 회사 상세로 간다. 메모 글·사람 이름은 서버가 주지 않는다.
import { Link } from 'react-router-dom';
import type { CompanyAnalysisRow } from '../../api/salesAnalysis';
import { salesAnalysisTexts as texts } from '../../labels/ko';
import { formatMonthDay } from '../../utils/time';
import { contactsText, outcomeText, stageText } from './analysisText';
import { analysisCell, analysisHead } from './ProcessAnalysisTable';

export interface CompanyAnalysisTableProps {
  rows: CompanyAnalysisRow[];
  /** 공정 코드 → 쉬운 이름(공정별 표의 이름과 같은 값). 없는 코드는 코드 그대로 보인다. */
  processNames: Record<string, string>;
}

export default function CompanyAnalysisTable({ rows, processNames }: CompanyAnalysisTableProps) {
  const columns = texts.companyColumns;
  const list = (items: string[]) => (items.length > 0 ? items.join(' · ') : texts.none);
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={texts.companyTableLabel}
      style={{ overflowX: 'auto' }}
    >
      <table
        data-testid="analysis-company-table"
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
            <tr key={row.oppId} data-testid="analysis-company-row">
              <th scope="row" style={{ ...analysisCell, fontWeight: 600 }}>
                <Link
                  to={`/opportunities/${row.oppId}`}
                  aria-label={texts.openCompanyLabel(row.name)}
                  data-testid="analysis-company-link"
                >
                  {row.name}
                </Link>
              </th>
              <td style={analysisCell}>
                {list(row.processCodes.map((code) => processNames[code] ?? code))}
              </td>
              <td style={analysisCell}>{list(row.industries)}</td>
              <td style={analysisCell}>{contactsText(row)}</td>
              <td style={analysisCell}>{stageText(row)}</td>
              <td style={analysisCell}>{formatMonthDay(row.firstContactAt) ?? texts.none}</td>
              <td style={analysisCell}>{formatMonthDay(row.lastContactAt) ?? texts.none}</td>
              <td style={analysisCell}>{texts.days(row.daysSinceFirstContact)}</td>
              <td style={analysisCell}>{outcomeText(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
