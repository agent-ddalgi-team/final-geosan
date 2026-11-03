// 건수 5개(미접촉 / 관심 / 접촉 중 / 견적·샘플 / 이번 주 일정). 누르면 그 조건으로 걸러진 추천 목록으로 간다.
// 목록 화면이 stage·filter 조건을 읽는 것은 서버(#209)·목록 연결 작업이 붙은 뒤다.
import { Link } from 'react-router-dom';
import type { DashboardCountKey, DashboardCounts } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

export const COUNT_ORDER: DashboardCountKey[] = [
  'NOT_CONTACTED',
  'INTERESTED',
  'IN_CONTACT',
  'QUOTE_SAMPLE',
  'SCHEDULE_DUE',
];

/** 건수 → 이동할 목록 주소(계약 C1: 영업 단계는 ?stage=, 이번 주 일정은 ?filter=SCHEDULE_DUE). */
export function countTarget(key: DashboardCountKey): string {
  switch (key) {
    case 'NOT_CONTACTED':
      return '/opportunities?stage=NOT_EXECUTED';
    case 'INTERESTED':
      return '/opportunities?stage=INTERESTED';
    case 'IN_CONTACT':
      return '/opportunities?stage=IN_PROGRESS';
    case 'QUOTE_SAMPLE':
      return '/opportunities?stage=SAMPLE_OR_REGISTRATION_APPROVED';
    case 'SCHEDULE_DUE':
      return '/opportunities?filter=SCHEDULE_DUE';
  }
}

export default function CountCards({ counts }: { counts: DashboardCounts }) {
  return (
    <ul
      aria-label={dashboardTexts.countsLabel}
      data-testid="dashboard-counts"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: spacing.cardGap,
      }}
    >
      {COUNT_ORDER.map((key) => {
        const name = dashboardTexts.countNames[key];
        const unit = dashboardTexts.countUnits[key];
        const value = counts[key] ?? 0;
        return (
          <li key={key}>
            <Link
              to={countTarget(key)}
              data-testid={`dashboard-count-${key}`}
              aria-label={`${name} ${value}${unit}`}
              style={{
                display: 'block',
                padding: spacing.cardPadding,
                background: colors.bgContainer,
                border: `1px solid ${colors.borderSecondary}`,
                borderRadius: 8,
                color: colors.text,
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  display: 'block',
                  color: colors.textSecondary,
                  fontSize: typography.fontSizeSecondary,
                }}
              >
                {name}
              </span>
              <span style={{ fontSize: typography.fontSizeH1, fontWeight: 600 }}>
                {value}
                <span style={{ fontSize: typography.fontSizeSecondary, fontWeight: 400 }}>
                  {unit}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
