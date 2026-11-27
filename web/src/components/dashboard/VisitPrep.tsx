// 대시보드 "방문 준비"(#795, PM 결정 2026-11-16): 오늘부터 7일 안 일정이 잡힌 회사마다 한 줄.
// 회사 · 날짜 · 일정 글 + [보고서 ↗](상세의 인쇄용 한 쪽 보고서, 새 창) · [상세]와
// 지도 응답이 있으면 거리 화살표 "거산 ─8.2km→ 회사 ─1.5km→ 가장 가까운 관심 기업 · 같이 들를 곳 n곳".
// 새 API 없이 대시보드 일정(schedule)과 지도 응답(points·visitGroups)만 쓴다. 기한 지난 일정은
// "오늘 할 일"의 지난 일정 단추로 정리하므로 여기에는 넣지 않는다.
// #972(새 디자인): 왼쪽 날짜는 네모 칸(위 작은 글 "오늘"·요일, 아래 큰 날짜 숫자). 오늘 = 강조 바탕 + 흰 글자,
// 다른 날 = 강조 연한 바탕 + 강조 글자. 달이 넘어가도 헷갈리지 않게 온전한 날짜("11/30(월)")를 이름표로 둔다.
import { Link } from 'react-router-dom';
import type { DashboardMap } from '../../api/dashboardMapTypes';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, detailTheme, homePalette, radius, typography } from '../../theme/tokens';
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

const WEEKDAYS = '일월화수목금토';

/** 날짜 칸에 쓸 요일 글자와 날짜 숫자. 날짜 글이 아니면 null. */
export function dayParts(value: string): { weekday: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { weekday: WEEKDAYS[date.getDay()], day: date.getDate() };
}

const chip = {
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: radius.tag,
  background: detailTheme.bandTodo,
  color: colors.text,
} as const;
const arrow = { color: colors.textSecondary, whiteSpace: 'nowrap' } as const;
/** #927(시안): 거리 숫자는 굵게·청록으로 눈에 띄게. */
const km = { color: homePalette.teal, fontWeight: 700 } as const;

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
      <span style={arrow}>
        ─<span style={km}>{t.prepKm(point.distanceKm)}</span>→
      </span>
      <span style={{ ...chip, background: detailTheme.accentSoft, fontWeight: 600 }}>{name}</span>
      {first ? (
        <>
          <span style={arrow}>
            ─<span style={km}>{t.prepKm(first.distanceKm)}</span>→
          </span>
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
      {shown.map((item) => {
        const isToday = item.dueAt === today;
        const parts = dayParts(item.dueAt);
        // #927(시안) → #972: 왼쪽 날짜 네모 칸 · 가운데 회사 · 할 일과 거리 화살표 · 오른쪽 보고서·상세.
        return (
          <li
            key={`${item.oppId}-${item.dueAt}`}
            data-testid="dashboard-prep-item"
            style={{
              display: 'grid',
              gridTemplateColumns: '56px minmax(0, 1fr) auto',
              alignItems: 'center',
              columnGap: 12,
              paddingBottom: 10,
              borderBottom: `1px solid ${colors.borderSecondary}`,
            }}
          >
            <span
              data-testid="dashboard-prep-day"
              data-today={isToday ? 'true' : undefined}
              role="img"
              aria-label={isToday ? `${dayLabel(item.dueAt)} ${t.prepToday}` : dayLabel(item.dueAt)}
              title={dayLabel(item.dueAt)}
              style={{
                display: 'grid',
                justifyItems: 'center',
                padding: '5px 0',
                borderRadius: radius.control,
                background: isToday ? homePalette.blueStrong : homePalette.blueBg,
                color: isToday ? colors.bgContainer : homePalette.blueText,
                lineHeight: 1.25,
              }}
            >
              <span style={{ fontSize: typography.fontSizeSecondary - 2 }}>
                {isToday ? t.prepToday : (parts?.weekday ?? '')}
              </span>
              <b style={{ fontSize: 18, fontWeight: 700 }}>{parts ? parts.day : item.dueAt}</b>
            </span>
            <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <span>
                <strong style={{ fontWeight: 600 }}>{item.customerName}</strong>
                {item.note ? (
                  <span style={{ color: colors.textSecondary }}> · {item.note}</span>
                ) : null}
              </span>
              {map ? <Route oppId={item.oppId} name={item.customerName} map={map} /> : null}
            </span>
            <span style={{ display: 'flex', gap: 10, justifySelf: 'end' }}>
              <ReportLink oppId={item.oppId} inline testId="dashboard-prep-report" />
              <Link
                to={`/opportunities/${encodeURIComponent(item.oppId)}`}
                data-testid="dashboard-prep-detail"
              >
                {t.prepDetail}
              </Link>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
