// #921(PM 결정 2026-11-25): 영업 홈 "누가 봐도 · 진행 중인 회사" 표.
// 다른 사람이 봐도 회사마다 지금 단계 · 누가 마지막으로 접촉했나 · 다음 할 일이 펼치지 않고 보이게 한다.
//   회사 | 단계 | 담당 | 마지막 접촉 "11/20 대면 · 5일 전" | 다음 일정 "11/25 방문" / "⚠ 다음 일정 없음 · 멈춤"
// 기본은 접촉 · 견적·샘플 · 성사 칸의 회사. 맨 위 단계 칩을 누르면 그 단계(미접촉·보류 포함)만 보인다.
// 데이터는 대시보드 응답의 progressCompanies(#800, #921 칸 더함) 그대로다. 메모·연락처는 오지 않는다.
// 순서: 멈춘 회사 → 다음 일정 가까운 순 → 마지막 접촉 오래된 순 → 이름. 앞 8곳만 보이고 [모두 보기]로 편다.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import type { Dashboard, ProgressBandKey, ProgressCompany } from '../../api/dashboardTypes';
import { contactMethodLabels, dashboardTexts as t } from '../../labels/ko';
import { colors, radius, spacing, statusPalette, tone, typography } from '../../theme/tokens';
import { daysBetween } from './ProgressCompanyList';
import { stageName } from './StageChips';

export const TABLE_SHOWN = 8;
/** 단계를 고르지 않았을 때 보이는 칸. */
export const DEFAULT_BANDS: ProgressBandKey[] = ['IN_CONTACT', 'QUOTE_SAMPLE', 'WON'];

const STAGE_TONES: Record<ProgressBandKey, keyof typeof statusPalette> = {
  NOT_CONTACTED: 'neutral',
  IN_CONTACT: 'ask',
  QUOTE_SAMPLE: 'recheck',
  WON: 'ok',
  ON_HOLD: 'neutral',
};

type Filter = 'all' | 'mine' | 'stalled';

export interface TableRow extends ProgressCompany {
  band: ProgressBandKey;
}

function monthDay(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}/${Number(match[2])}` : value;
}

/** 칸별 회사를 한 표 줄로 모으고 정렬한다. */
export function tableRows(
  companies: Dashboard['progressCompanies'],
  bands: ProgressBandKey[],
): TableRow[] {
  const rows = bands.flatMap((band) => (companies?.[band] ?? []).map((row) => ({ ...row, band })));
  const far = '9999-12-31';
  return rows.sort(
    (a, b) =>
      Number(b.stalled) - Number(a.stalled) ||
      (a.nextScheduleAt ?? far).localeCompare(b.nextScheduleAt ?? far) ||
      (a.lastContactAt ?? far).localeCompare(b.lastContactAt ?? far) ||
      a.customerName.localeCompare(b.customerName, 'ko') ||
      a.oppId.localeCompare(b.oppId),
  );
}

export function lastContactText(row: ProgressCompany, today: string): string {
  if (!row.lastContactAt) return t.tableNoContact;
  const method = row.lastContactMethod ? contactMethodLabels[row.lastContactMethod] : null;
  const days = daysBetween(row.lastContactAt, today);
  return [
    [monthDay(row.lastContactAt), method].filter(Boolean).join(' '),
    days === null ? null : t.tableDaysAgo(days),
  ]
    .filter(Boolean)
    .join(' · ');
}

function NextCell({ row, today }: { row: ProgressCompany; today: string }): ReactNode {
  const warn = { color: statusPalette.recheck.fg, fontWeight: 600 } as const;
  if (row.nextScheduleAt && row.nextScheduleAt < today) {
    return <span style={warn}>{t.tableOverdue(monthDay(row.nextScheduleAt))}</span>;
  }
  if (row.nextScheduleAt) {
    return [monthDay(row.nextScheduleAt), row.nextScheduleNote].filter(Boolean).join(' ');
  }
  if (row.stalled) return <span style={warn}>{t.tableStalled}</span>;
  return <span style={{ color: colors.textSecondary }}>—</span>;
}

const th: CSSProperties = {
  textAlign: 'left',
  fontSize: typography.fontSizeSecondary,
  color: colors.textSecondary,
  fontWeight: 600,
  padding: '6px 8px',
  borderBottom: `1px solid ${colors.borderSecondary}`,
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '8px',
  borderBottom: `1px solid ${colors.borderSecondary}`,
  verticalAlign: 'middle',
};

export default function ProgressTable({
  companies,
  today,
  stage,
  onClearStage,
  staffKey,
  badge = null,
}: {
  companies: Dashboard['progressCompanies'];
  /** 오늘(YYYY-MM-DD, 한국). */
  today: string;
  /** 맨 위 칩으로 고른 단계. 없으면 기본 칸들. */
  stage: ProgressBandKey | null;
  onClearStage: () => void;
  /** 고른 담당자. 있으면 [내 회사만]이 보인다. */
  staffKey: string | null;
  badge?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [all, setAll] = useState(false);
  if (companies === undefined) return null;
  const every = tableRows(companies, stage ? [stage] : DEFAULT_BANDS);
  const rows = every.filter((row) =>
    filter === 'stalled'
      ? row.stalled
      : filter === 'mine'
        ? row.lastContactStaffKey === staffKey
        : true,
  );
  const shown = all ? rows : rows.slice(0, TABLE_SHOWN);
  const filters: Filter[] = staffKey ? ['all', 'mine', 'stalled'] : ['all', 'stalled'];
  const filterName = {
    all: t.tableFilterAll,
    mine: t.tableFilterMine,
    stalled: t.tableFilterStalled,
  };

  return (
    <section
      id="dashboard-progress-table"
      aria-labelledby="dashboard-progress-table-title"
      data-testid="dashboard-progress-table"
      style={{
        display: 'grid',
        gap: 8,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.lg,
        padding: spacing.cardPadding,
      }}
    >
      <h2
        id="dashboard-progress-table-title"
        style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
      >
        {badge}
        {t.tableTitle}{' '}
        <small
          data-testid="dashboard-progress-table-count"
          style={{
            fontSize: typography.fontSizeSecondary,
            color: colors.textSecondary,
            fontWeight: 400,
          }}
        >
          {t.tableCount(every.length)}
        </small>
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {filters.map((key) => (
          <Button
            key={key}
            size="small"
            type={filter === key ? 'primary' : 'default'}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            data-testid={`dashboard-progress-filter-${key}`}
          >
            {filterName[key]}
          </Button>
        ))}
        {stage ? (
          <span
            data-testid="dashboard-progress-stage"
            style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
          >
            {t.tableStageOnly(stageName(stage))}{' '}
            <Button type="link" size="small" onClick={onClearStage}>
              {t.tableStageClear}
            </Button>
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p
          data-testid="dashboard-progress-table-empty"
          style={{ margin: 0, color: colors.textSecondary }}
        >
          {t.tableEmpty}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>{t.tableColumns.company}</th>
                <th style={th}>{t.tableColumns.stage}</th>
                <th style={th}>{t.tableColumns.staff}</th>
                <th style={th}>{t.tableColumns.last}</th>
                <th style={th}>{t.tableColumns.next}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const palette = statusPalette[STAGE_TONES[row.band]];
                return (
                  <tr
                    key={`${row.band}-${row.oppId}`}
                    data-testid="dashboard-progress-row"
                    data-stalled={row.stalled ? 'true' : undefined}
                    style={{ background: row.stalled ? tone.lemonSoft : undefined }}
                  >
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <Link to={`/opportunities/${encodeURIComponent(row.oppId)}`}>
                        {row.customerName}
                      </Link>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '1px 9px',
                          borderRadius: 999,
                          background: palette.bg,
                          color: palette.fg,
                          fontSize: typography.fontSizeSecondary,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stageName(row.band)}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {row.lastContactStaffName ?? (
                        <span style={{ color: colors.textSecondary }}>—</span>
                      )}
                    </td>
                    <td
                      style={{ ...td, whiteSpace: 'nowrap' }}
                      data-testid="dashboard-progress-last"
                    >
                      {lastContactText(row, today)}
                    </td>
                    <td style={td} data-testid="dashboard-progress-next">
                      <NextCell row={row} today={today} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > TABLE_SHOWN ? (
        <div style={{ textAlign: 'right' }}>
          <Button
            type="link"
            size="small"
            onClick={() => setAll((open) => !open)}
            data-testid="dashboard-progress-show-all"
          >
            {all ? t.tableShowLess : t.tableShowAll(rows.length)}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
