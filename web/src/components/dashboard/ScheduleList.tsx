// 일정: 기한 지남이 맨 위, 그다음 날짜순. 서버가 이미 이 순서로 주지만 화면에서도 한 번 더 맞춘다.
import { Link } from 'react-router-dom';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

/** 기한 지남(overdue) 먼저, 같은 묶음 안에서는 날짜 빠른 순. 원본 배열은 바꾸지 않는다. */
export function sortSchedule(items: DashboardScheduleItem[]): DashboardScheduleItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueAt.localeCompare(b.dueAt);
  });
}

export default function ScheduleList({ items }: { items: DashboardScheduleItem[] }) {
  if (items.length === 0) {
    return (
      <p data-testid="dashboard-schedule-empty" style={{ color: colors.textSecondary }}>
        {dashboardTexts.scheduleEmpty}
      </p>
    );
  }
  return (
    <ol
      data-testid="dashboard-schedule"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}
    >
      {sortSchedule(items).map((item) => (
        <li key={`${item.oppId}-${item.dueAt}-${item.note}`} data-testid="dashboard-schedule-item">
          <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>
            {item.overdue ? (
              <span
                data-testid="dashboard-schedule-overdue"
                style={{
                  background: statusPalette.no.bg,
                  color: statusPalette.no.fg,
                  borderRadius: 4,
                  padding: '0 6px',
                  marginRight: 6,
                  fontSize: typography.fontSizeSecondary,
                }}
              >
                {dashboardTexts.scheduleOverdue}
              </span>
            ) : null}
            {formatMonthDay(item.dueAt)} {item.customerName} {item.note}
          </Link>
        </li>
      ))}
    </ol>
  );
}
