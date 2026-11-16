// 상세 화면의 [보고서] 링크(#565). 누르면 새 창에서 인쇄용 보고서 화면이 열린다.
// 새 창으로 여는 이유: 상세 아래 "적는 곳"에 쓰던 글이 사라지지 않고, 읽는 곳에는 새 창 링크만 더한다(#674).
import { Link } from 'react-router-dom';
import { companyReport } from '../../labels/ko';

// #795: 대시보드 "방문 준비" 줄에서도 같은 링크를 쓴다(inline이면 오른쪽 정렬 칸 없이 링크만).
export default function ReportLink({
  oppId,
  inline = false,
  testId = 'detail-report-link',
}: {
  oppId: string;
  inline?: boolean;
  testId?: string;
}) {
  const link = (
    <Link
      to={`/opportunities/${encodeURIComponent(oppId)}/report`}
      target="_blank"
      rel="noopener noreferrer"
      title={companyReport.linkHint}
      data-testid={testId}
      style={{ textDecoration: 'underline' }}
    >
      {companyReport.link} ↗
    </Link>
  );
  if (inline) return link;
  return <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{link}</div>;
}
