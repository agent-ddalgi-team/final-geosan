// 건수 두 구역(#357, 2026-11-06 PM 결정): 대시보드는 관심으로 고른 회사만 센다.
//  ① "관심 기업": 관심 기업 전체(큰 칸) / 의견 전 / 검토 중
//     (제외로 저장한 회사는 관심 기업에서 빠져 칸이 없다, #536)
//  ② "영업 진행": #766(PM 결정 2026-11-16)부터 상세(#763)와 같은 4칸 띠 미접촉 · 접촉 · 견적·샘플 · 성사,
//     띠 아래 "보류 n곳". "이번 주 일정"(달력·오늘 확인할 것과 같음)과 "완료"(영업 분석 #760)는 대시보드에서 뺐다.
// 칸을 누르면 그 조건으로 걸러진 추천 목록으로 간다(관심 기업은 /bookmarks 화면(#762), 나머지는 ?filter=<칸 이름표>).
// 서버가 주지 않은 칸은 0으로 지어내지 않고 뺀다. 옛 집계(관심 기업 건수가 없음)면 두 구역 대신 안내를 보인다.
// #795(PM 결정 2026-11-16): 대시보드는 "영업 진행" 띠를 맨 위 "오늘 브리핑"에(part="progress"),
// "관심 기업" 칸을 맨 아래 "더 보기"에(part="bookmark") 따로 놓는다. 띠 칸 사이에 → 를 그려 흐름으로 읽힌다.
// #800(PM 결정 2026-11-16): 서버가 칸별 회사(progressCompanies)를 주면 띠 칸·"보류 n곳"은 목록으로 가는 대신
// 그 단계 회사를 띠 아래에 편다(다시 누르면 접힘). 펴진 목록 끝 [목록에서 보기 →]가 예전 링크다.
// 옛 서버라 회사 목록이 없으면 지금처럼 칸이 목록 링크다.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  DashboardCountKey,
  DashboardCounts,
  Dashboard,
  ProgressBandKey,
} from '../../api/dashboardTypes';
import { chartSummaryTexts, dashboardTexts } from '../../labels/ko';
import { colors, detailTheme, radius, spacing, typography } from '../../theme/tokens';
import { ChartSummary } from '../common/ChartFrame';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import ProgressCompanyList from './ProgressCompanyList';

/** ① "관심 기업" 구역의 칸 순서. 맨 앞 BOOKMARKED가 큰 칸이다. */
export const BOOKMARK_ORDER: DashboardCountKey[] = ['BOOKMARKED', 'NO_OPINION', 'NEED_CHECK'];

/** ② "영업 진행" 4칸 띠의 순서(#766). */
export const PROGRESS_ORDER = ['NOT_CONTACTED', 'IN_CONTACT', 'QUOTE_SAMPLE', 'WON'] as const;

/** 칸 → 이동할 목록 주소(계약 C1: 관심 기업은 /bookmarks 화면(#762), 나머지 칸은 ?filter=<이름표>). */
export function countTarget(key: DashboardCountKey): string {
  return key === 'BOOKMARKED' ? BOOKMARKS_PATH : `${LIST_PATH}?filter=${key}`;
}

const listStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: spacing.cardGap,
} as const;

/**
 * "관심 기업" 구역 칸 틀(#787): 큰 칸 2 : 나머지 1씩으로 늘 한 줄에 둔다.
 * 예전 `auto-fit` + 큰 칸 두 칸 차지는 노트북 폭(영업 코치 칸이 열린 1280)에서 "검토 중"만 다음 줄로 떨어졌다.
 */
export function bookmarkGrid(count: number): string {
  return count <= 1 ? 'minmax(0, 1fr)' : `minmax(0, 2fr) repeat(${count - 1}, minmax(0, 1fr))`;
}

const sectionStyle = { display: 'grid', gap: 12, alignContent: 'start' } as const;
// "영업 진행" 구역은 흰 카드 하나로 묶는다.
const cardSectionStyle = {
  ...sectionStyle,
  boxSizing: 'border-box',
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: radius.lg,
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
  /** 구역의 대표 칸("관심 기업 N곳")이면 굵은 이름으로 보인다. 넓이는 구역의 칸 틀(`bookmarkGrid`)이 정한다. */
  large?: boolean;
  /** 칸 이름 아래 작은 풀이. */
  hint?: string;
}

function CountCell({ countKey, value, large = false, hint }: CellProps) {
  const name = dashboardTexts.countNames[countKey];
  const unit = dashboardTexts.countUnits[countKey];
  return (
    <li style={{ minWidth: 0 }}>
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
          borderRadius: radius.lg,
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

export interface CountCardsProps {
  counts: DashboardCounts;
  /** all = 두 구역 함께(예전), progress = "영업 진행" 띠만, bookmark = "관심 기업" 칸만(#795). */
  part?: 'all' | 'progress' | 'bookmark';
  /** #800: 칸별 회사. 있으면 띠 칸을 눌러 그 단계 회사를 편다. 없으면(옛 서버) 칸이 목록 링크다. */
  companies?: Dashboard['progressCompanies'];
  /** 오늘(YYYY-MM-DD). "마지막 접촉 n일 전"을 셀 때 쓴다. 안 주면 이 기기의 오늘. */
  today?: string;
}

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** #800 칸을 펴고 접는 단추. 회사 목록이 없으면 지금처럼 목록 링크. */
function BandCell({
  countKey,
  label,
  style,
  open,
  onToggle,
  children,
}: {
  countKey: ProgressBandKey;
  label: string;
  style: CSSProperties;
  /** 회사 목록이 없으면 undefined(링크로 그림). */
  open: boolean | undefined;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (open === undefined) {
    return (
      <Link
        to={countTarget(countKey)}
        data-testid={`dashboard-count-${countKey}`}
        aria-label={label}
        style={style}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-testid={`dashboard-count-${countKey}`}
      aria-label={label}
      aria-expanded={open}
      aria-controls="dashboard-progress-companies"
      onClick={onToggle}
      style={{
        ...style,
        width: '100%',
        border: open ? `2px solid ${detailTheme.accentLine}` : '2px solid transparent',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

/** #898 띠 아래 요약 문장: 영업 대상 가운데 접촉 이상 진행한 곳 · 견적·샘플 · 성사 · 미접촉. */
function progressSummary(counts: CountCardsProps['counts']): string | null {
  const n = (key: string) => {
    const value = (counts as Record<string, number | undefined>)[key];
    return typeof value === 'number' ? value : 0;
  };
  const total = n('NOT_CONTACTED') + n('IN_CONTACT') + n('QUOTE_SAMPLE') + n('WON');
  if (total === 0) return null;
  const moved = n('IN_CONTACT') + n('QUOTE_SAMPLE') + n('WON');
  const parts = [chartSummaryTexts.progressMoved(total, moved, n('QUOTE_SAMPLE'), n('WON'))];
  if (n('NOT_CONTACTED') > 0)
    parts.push(chartSummaryTexts.progressNotContacted(n('NOT_CONTACTED')));
  return parts.join(' ');
}

export default function CountCards({ counts, part = 'all', companies, today }: CountCardsProps) {
  const [openBand, setOpenBand] = useState<ProgressBandKey | null>(null);
  const toggle = (key: ProgressBandKey) => setOpenBand((now) => (now === key ? null : key));
  const openOf = (key: ProgressBandKey) => (companies ? openBand === key : undefined);
  // 옛 집계에는 관심 기업 건수가 없다. 그때의 미접촉·접촉 중 숫자는 뜻이 달라(전체 회사 기준) 새 칸에 넣지 않는다.
  if (typeof counts.BOOKMARKED !== 'number') {
    // 띠만 그리는 자리(#795)에서는 안내를 두 번 보이지 않는다. 안내는 bookmark·all 쪽에만.
    if (part === 'progress') return null;
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
  const progressCells = present(counts, [...PROGRESS_ORDER]) as {
    key: (typeof PROGRESS_ORDER)[number];
    value: number;
  }[];

  const bookmarkSection = (
    <section
      aria-labelledby="dashboard-bookmark-title"
      data-testid="dashboard-section-bookmark"
      style={sectionStyle}
    >
      <h2 id="dashboard-bookmark-title" style={titleStyle}>
        {dashboardTexts.bookmarkSectionTitle}
      </h2>
      <ul
        aria-labelledby="dashboard-bookmark-title"
        data-testid="dashboard-bookmark-cells"
        style={{ ...listStyle, gridTemplateColumns: bookmarkGrid(bookmarkCells.length) }}
      >
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
  );
  const progressSection =
    progressCells.length > 0 ? (
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
        <ol
          aria-label={dashboardTexts.progressSectionTitle}
          data-testid="dashboard-progress-band"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            // #795: 칸 사이에 → 를 그려 미접촉 → 접촉 → 견적·샘플 → 성사 흐름으로 읽힌다.
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          {progressCells.map((cell, index) => {
            const name = dashboardTexts.progressBandNames[cell.key];
            const unit = dashboardTexts.countUnits[cell.key];
            return [
              index > 0 ? (
                <li
                  key={`${cell.key}-arrow`}
                  aria-hidden="true"
                  data-testid="dashboard-progress-arrow"
                  style={{ flex: 'none', color: colors.textSecondary, padding: '0 2px' }}
                >
                  →
                </li>
              ) : null,
              <li key={cell.key} style={{ flex: '1 1 0', minWidth: 0 }}>
                <BandCell
                  countKey={cell.key}
                  label={`${name} ${cell.value}${unit}`}
                  open={openOf(cell.key)}
                  onToggle={() => toggle(cell.key)}
                  style={{
                    display: 'grid',
                    gap: 2,
                    justifyItems: 'center',
                    padding: '12px 8px',
                    // #898: 회사가 있는 단계는 진한 연노랑으로 또렷하게, 빈 단계는 옅은 회색.
                    background: cell.value > 0 ? detailTheme.accent : detailTheme.bandTodo,
                    borderRadius: detailTheme.radius,
                    color: colors.text,
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontSize: typography.fontSizeSecondary }}>{name}</span>
                  <span
                    style={{ fontSize: typography.fontSizeH1, fontWeight: 500, lineHeight: 1.3 }}
                  >
                    {cell.value}
                    <span style={{ fontSize: typography.fontSizeSecondary, fontWeight: 400 }}>
                      {unit}
                    </span>
                  </span>
                </BandCell>
              </li>,
            ];
          })}
        </ol>
        {typeof counts.ON_HOLD === 'number' && counts.ON_HOLD > 0 ? (
          <BandCell
            countKey="ON_HOLD"
            label={dashboardTexts.progressOnHold(counts.ON_HOLD)}
            open={openOf('ON_HOLD')}
            onToggle={() => toggle('ON_HOLD')}
            style={{
              ...smallStyle,
              justifySelf: 'start',
              background: 'none',
              padding: 0,
              ...(companies ? { width: 'auto', textDecoration: 'underline' } : {}),
            }}
          >
            {dashboardTexts.progressOnHold(counts.ON_HOLD)}
          </BandCell>
        ) : null}
        {progressSummary(counts) ? (
          <ChartSummary
            text={progressSummary(counts) as string}
            testId="dashboard-progress-summary"
          />
        ) : null}
        {companies ? (
          openBand ? (
            <ProgressCompanyList
              key={openBand}
              band={openBand}
              rows={companies[openBand] ?? []}
              today={today ?? localToday()}
              listHref={countTarget(openBand)}
            />
          ) : (
            <small data-testid="dashboard-progress-open-hint" style={smallStyle}>
              {dashboardTexts.progressOpenHint}
            </small>
          )
        ) : null}
      </section>
    ) : null;

  if (part === 'progress') return progressSection;
  return (
    <div data-testid="dashboard-counts" style={{ display: 'grid', gap: spacing.sectionGap }}>
      {bookmarkSection}
      {part === 'all' ? progressSection : null}
    </div>
  );
}
