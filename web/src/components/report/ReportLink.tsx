// 상세 화면의 [보고서] 링크(#565). 누르면 새 창에서 인쇄용 보고서 화면이 열린다.
// 새 창으로 여는 이유: 상세 아래 "적는 곳"에 쓰던 글이 사라지지 않고, 읽는 곳에는 새 창 링크만 더한다(#674).
import { Link } from 'react-router-dom';
import { companyReport } from '../../labels/ko';

export default function ReportLink({ oppId }: { oppId: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Link
        to={`/opportunities/${encodeURIComponent(oppId)}/report`}
        target="_blank"
        rel="noopener noreferrer"
        title={companyReport.linkHint}
        data-testid="detail-report-link"
        style={{ textDecoration: 'underline' }}
      >
        {companyReport.link} ↗
      </Link>
    </div>
  );
}
