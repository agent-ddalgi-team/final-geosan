// 최근 내 기록 10건(요청의 담당자 키로 서버가 거른다). 화면은 받은 순서대로, 많아도 10건까지만 보인다.
import { Link } from 'react-router-dom';
import type { RecentActivityItem } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

export const RECENT_LIMIT = 10;

export default function RecentActivityList({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p data-testid="dashboard-recent-empty" style={{ color: colors.textSecondary }}>
        {dashboardTexts.recentEmpty}
      </p>
    );
  }
  return (
    <ol
      data-testid="dashboard-recent"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
    >
      {items.slice(0, RECENT_LIMIT).map((item) => (
        <li key={`${item.at}-${item.oppId}-${item.kind}`} data-testid="dashboard-recent-item">
          <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>
            {formatMonthDay(item.at)} {item.customerName} ·{' '}
            {dashboardTexts.activityKinds[item.kind]}
          </Link>
          <span
            style={{
              display: 'block',
              color: colors.textSecondary,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {item.summary}
          </span>
        </li>
      ))}
    </ol>
  );
}
