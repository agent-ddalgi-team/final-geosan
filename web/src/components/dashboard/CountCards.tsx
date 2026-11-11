// 건수 두 구역(#357, 2026-11-06 PM 결정): 대시보드는 관심으로 고른 회사만 센다.
//  ① "관심 기업": 관심 기업 전체(큰 칸) / 의견 전 / 추가 확인 필요
//     (검토 대상 제외로 저장한 회사는 관심 기업에서 빠져 칸이 없다, #536)
//  ② "영업 진행": 미접촉(검토 권고 · 접촉 전) / 접촉 중 / 견적·샘플 / 보류 / 완료 + 이번 주 일정
// 칸을 누르면 그 조건으로 걸러진 추천 목록으로 간다(관심 기업은 ?bookmarked=true, 나머지는 ?filter=<칸 이름표>).
// 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다. 옛 집계(관심 기업 건수가 없음)면 두 구역 대신 안내를 보인다.
import { Link } from 'react-router-dom';
import type { DashboardCountKey, DashboardCounts } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

/** ① "관심 기업" 구역의 칸 순서. 맨 앞 BOOKMARKED가 큰 칸이다. */
export const BOOKMARK_ORDER: DashboardCountKey[] = ['BOOKMARKED', 'NO_OPINION', 'NEED_CHECK'];

/** ② "영업 진행" 구역의 칸 순서. 이번 주 일정은 진행 단계 뒤에 둔다. */
export const PROGRESS_ORDER: DashboardCountKey[] = [
  'NOT_CONTACTED',
  'IN_CONTACT',
  'QUOTE_SAMPLE',
  'ON_HOLD',
  'DONE',
  'SCHEDULE_DUE',
];

/** 칸 → 이동할 목록 주소(계약 C1: 관심 기업은 ?bookmarked=true, 나머지 칸은 ?filter=<이름표>). */
export function countTarget(key: DashboardCountKey): string {
  return key === 'BOOKMARKED' ? '/opportunities?bookmarked=true' : `/opportunities?filter=${key}`;
}

const listStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: spacing.cardGap,
} as const;

const sectionStyle = { display: 'grid', gap: 12, alignContent: 'start' } as const;
// "영업 진행" 구역은 흰 카드 하나로 묶는다.
const cardSectionStyle = {
  ...sectionStyle,
  boxSizing: 'border-box',
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: spacing.cardPadding,
} as const;
const titleStyle = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
const smallStyle = {
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
  fontWeight: 400,
} as const;

interface CellProps {
  countKey: DashboardCountKey;
  value: number;
  /** 구역의 대표 칸("관심 기업 N곳")이면 두 칸 너비에 굵은 테두리로 크게 보인다. */
  large?: boolean;
  /** 칸 이름 아래 작은 풀이. */
  hint?: string;
}

function CountCell({ countKey, value, large = false, hint }: CellProps) {
  const name = dashboardTexts.countNames[countKey];
  const unit = dashboardTexts.countUnits[countKey];
  return (
    <li style={large ? { gridColumn: 'span 2' } : undefined}>
      <Link
        to={countTarget(countKey)}
        data-testid={`dashboard-count-${countKey}`}
        aria-label={hint ? `${name} ${value}${unit} (${hint})` : `${name} ${value}${unit}`}
        style={{
          display: 'block',
          // 높이 100%에 안쪽 여백이 더해져 칸이 줄 밖으로 삐져나오지 않게 한다(아래 구역 제목과 겹쳤음).
          boxSizing: 'border-box',
          height: '100%',
          padding: spacing.cardPadding,
          background: colors.bgContainer,
          border: `1px solid ${colors.borderSecondary}`,
          borderRadius: 12,
          color: colors.text,
          textDecoration: 'none',
        }}
      >
        <span
          style={{
            display: 'block',
            color: large ? colors.text : colors.textSecondary,
            fontSize: typography.fontSizeSecondary,
            fontWeight: large ? 700 : 400,
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: typography.fontSizeH1, fontWeight: 700 }}>
          {value}
          <span style={{ fontSize: typography.fontSizeSecondary, fontWeight: 400 }}>{unit}</span>
        </span>
        {hint ? (
          <span
            data-testid={`dashboard-count-${countKey}-hint`}
            style={{ display: 'block', ...smallStyle }}
          >
            {hint}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/** 서버가 숫자로 준 칸만 고른다. 없는 칸은 0으로 채우지 않는다. */
function present(counts: DashboardCounts, order: DashboardCountKey[]) {
  return order.flatMap((key) => {
    const value = counts[key];
    return typeof value === 'number' ? [{ key, value }] : [];
  });
}

export default function CountCards({ counts }: { counts: DashboardCounts }) {
  // 옛 집계에는 관심 기업 건수가 없다. 그때의 미접촉·접촉 중 숫자는 뜻이 달라(전체 회사 기준) 새 칸에 넣지 않는다.
  if (typeof counts.BOOKMARKED !== 'number') {
    const schedule = present(counts, ['SCHEDULE_DUE']);
    return (
      <div data-testid="dashboard-counts" style={sectionStyle}>
        <p
          role="status"
          data-testid="dashboard-counts-outdated"
          style={{ margin: 0, color: colors.textSecondary }}
        >
          {dashboardTexts.countsOutdated}
        </p>
        {schedule.length > 0 ? (
          <ul style={listStyle}>
            {schedule.map((cell) => (
              <CountCell key={cell.key} countKey={cell.key} value={cell.value} />
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const bookmarkCells = present(counts, BOOKMARK_ORDER);
  const progressCells = present(counts, PROGRESS_ORDER);

  return (
    <div data-testid="dashboard-counts" style={{ display: 'grid', gap: spacing.sectionGap }}>
      <section
        aria-labelledby="dashboard-bookmark-title"
        data-testid="dashboard-section-bookmark"
        style={sectionStyle}
      >
        <h2 id="dashboard-bookmark-title" style={titleStyle}>
          {dashboardTexts.bookmarkSectionTitle}
        </h2>
        <ul aria-labelledby="dashboard-bookmark-title" style={listStyle}>
          {bookmarkCells.map((cell) => (
            <CountCell
              key={cell.key}
              countKey={cell.key}
              value={cell.value}
              large={cell.key === 'BOOKMARKED'}
            />
          ))}
        </ul>
        {counts.BOOKMARKED === 0 ? (
          <p
            data-testid="dashboard-bookmark-empty"
            style={{ margin: 0, color: colors.textSecondary }}
          >
            {dashboardTexts.bookmarkEmptyLead}{' '}
            <Link to="/opportunities" data-testid="dashboard-bookmark-empty-link">
              {dashboardTexts.bookmarkEmptyLink}
            </Link>
            {dashboardTexts.bookmarkEmptyTail}
          </p>
        ) : null}
      </section>
      {progressCells.length > 0 ? (
        <section
          aria-labelledby="dashboard-progress-title"
          data-testid="dashboard-section-progress"
          style={cardSectionStyle}
        >
          <h2 id="dashboard-progress-title" style={titleStyle}>
            {dashboardTexts.progressSectionTitle}{' '}
            <small data-testid="dashboard-progress-hint" style={{ marginLeft: 8, ...smallStyle }}>
              {dashboardTexts.progressSectionHint}
            </small>
          </h2>
          <ul aria-label={dashboardTexts.progressSectionTitle} style={listStyle}>
            {progressCells.map((cell) => (
              <CountCell
                key={cell.key}
                countKey={cell.key}
                value={cell.value}
                hint={cell.key === 'NOT_CONTACTED' ? dashboardTexts.notContactedHint : undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
