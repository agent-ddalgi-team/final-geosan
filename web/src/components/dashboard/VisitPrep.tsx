// 대시보드 "방문 준비"(#795, PM 결정 2026-11-16): 오늘부터 7일 안 일정이 잡힌 회사마다 한 줄.
// 회사 · 날짜 · 일정 글 + [보고서 ↗](상세의 인쇄용 한 쪽 보고서, 새 창) · [상세]와
// 지도 응답이 있으면 거리 화살표 "거산 ─8.2km→ 회사 ─1.5km→ 가장 가까운 관심 기업 · 같이 들를 곳 n곳".
// 새 API 없이 대시보드 일정(schedule)과 지도 응답(points·visitGroups)만 쓴다. 기한 지난 일정은
// "오늘 할 일"의 지난 일정 단추로 정리하므로 여기에는 넣지 않는다.
import { Link } from 'react-router-dom';
import type { DashboardMap } from '../../api/dashboardMapTypes';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, detailTheme, typography } from '../../theme/tokens';
import ReportLink from '../report/ReportLink';
import { dayLabel } from './TodayChecks';

/** 오늘부터 며칠 안 일정을 "방문 준비"에 보이나(오늘 포함 7일). */
export const PREP_DAYS = 7;

function dayIndex(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
}

/** 오늘(포함)부터 PREP_DAYS일 안의 지나지 않은 일정, 날짜 → 회사 이름 순. */
export function prepItems(items: DashboardScheduleItem[], today: string): DashboardScheduleItem[] {
  const start = dayIndex(today);
  if (start === null) return [];
  return items
    .filter((item) => {
      const day = dayIndex(item.dueAt);
      return !item.overdue && day !== null && day >= start && day < start + PREP_DAYS;
    })
    .sort((a, b) =>
      a.dueAt === b.dueAt
        ? a.customerName.localeCompare(b.customerName, 'ko')
        : a.dueAt.localeCompare(b.dueAt),
    );
}

const chip = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 999,
  background: detailTheme.bandTodo,
  color: colors.text,
} as const;
const arrow = { color: colors.textSecondary, whiteSpace: 'nowrap' } as const;

/** 거산 ─km→ 회사 ─km→ 가까운 관심 기업 · 같이 들를 곳 n곳. 좌표가 없는 회사면 그리지 않는다. */
function Route({ oppId, name, map }: { oppId: string; name: string; map: DashboardMap }) {
  const point = map.points.find((entry) => entry.oppId === oppId);
  if (!point) return null;
  const nearby = [...(map.visitGroups?.find((group) => group.oppId === oppId)?.nearby ?? [])].sort(
    (a, b) => a.distanceKm - b.distanceKm,
  );
  const first = nearby[0];
  return (
    <span
      data-testid="dashboard-prep-route"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      <span style={chip}>{t.prepHq}</span>
      <span style={arrow}>─{t.prepKm(point.distanceKm)}→</span>
      <span style={{ ...chip, background: detailTheme.accentSoft, fontWeight: 600 }}>{name}</span>
      {first ? (
        <>
          <span style={arrow}>─{t.prepKm(first.distanceKm)}→</span>
          <span style={chip}>{first.customerName}</span>
          <span style={{ color: colors.textSecondary }}>· {t.prepNearby(nearby.length)}</span>
        </>
      ) : null}
    </span>
  );
}

export default function VisitPrep({
  items,
  today,
  map,
}: {
  items: DashboardScheduleItem[];
  today: string;
  map: DashboardMap | undefined;
}) {
  const shown = prepItems(items, today);
  if (shown.length === 0) {
    return (
      <p data-testid="dashboard-prep-empty" style={{ margin: 0, color: colors.textSecondary }}>
        {t.prepEmpty}
      </p>
    );
  }
  return (
    <ul
      data-testid="dashboard-prep"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}
    >
      {shown.map((item) => (
        <li
          key={`${item.oppId}-${item.dueAt}`}
          data-testid="dashboard-prep-item"
          style={{
            display: 'grid',
            gap: 4,
            paddingBottom: 10,
            borderBottom: `1px solid ${colors.borderSecondary}`,
          }}
        >
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
            <strong>{item.customerName}</strong>
            <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
              {[item.dueAt === today ? t.prepToday : dayLabel(item.dueAt), item.note]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <ReportLink oppId={item.oppId} inline testId="dashboard-prep-report" />
              <Link
                to={`/opportunities/${encodeURIComponent(item.oppId)}`}
                data-testid="dashboard-prep-detail"
              >
                {t.prepDetail}
              </Link>
            </span>
          </span>
          {map ? <Route oppId={item.oppId} name={item.customerName} map={map} /> : null}
        </li>
      ))}
    </ul>
  );
}
