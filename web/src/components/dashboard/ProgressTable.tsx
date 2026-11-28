// #921(PM 결정 2026-11-25): 영업 홈 "누가 봐도 · 진행 중인 회사" 표.
// 다른 사람이 봐도 회사마다 지금 단계 · 누가 마지막으로 접촉했나 · 다음 할 일이 펼치지 않고 보이게 한다.
//   회사 | 단계 | 담당 | 마지막 접촉 "11/20 대면 · 5일 전" | 다음 일정 "11/25 방문" / "⚠ 다음 일정 없음 · 멈춤"
// #972(새 디자인): 제목 줄 오른쪽에 거르기 단추(고른 단추 = 강조 연한 바탕), 멈춘 회사는 노란 줄 대신
//   회사 이름 옆 "멈춘 회사" 주의 꼬리표, 단계 꼬리표는 보라(성사만 초록, 미접촉·보류는 중립).
// 기본은 접촉 · 견적·샘플 · 성사 칸의 회사. 맨 위 단계 칩을 누르면 그 단계(미접촉·보류 포함)만 보인다.
// 데이터는 대시보드 응답의 progressCompanies(#800, #921 칸 더함) 그대로다. 메모·연락처는 오지 않는다.
// 순서: 멈춘 회사 → 다음 일정 가까운 순 → 마지막 접촉 오래된 순 → 이름. 앞 8곳만 보이고 [모두 보기]로 편다.
// #983(PM이 고른 시안 2026-11-28):
//   - 카드 머리 아래에 작은 단계 칸(stages)을 끼운다. 맨 위에 따로 있던 큰 단계 카드 5칸을 이 카드로 합쳤다.
//   - 다음 일정 칸에서 바로 일정을 잡고 바꾼다: 일정이 없으면 "일정 없음" + [일정 잡기], 있으면 지금 글 + [바꾸기].
//     누르면 그 줄의 같은 칸 아래에 바로 일정 잡기 칸(ScheduleQuickEdit)이 펴진다. 한 번에 한 줄만 펴진다.
//     보기 전용 · 담당자를 고르기 전에는 단추가 눌리지 않고 표 위에 "먼저 담당자를 고르세요"가 보인다.
// #992(PM이 고른 수정안 3, 2026-11-29):
//   - 영업 단계 칸 묶음(stages)을 제목 줄 안, 제목 "진행 중인 회사 12곳" 바로 옆에 둔다. 거르기 단추는 같은 줄 오른쪽 끝
//     (좁으면 다음 줄로 내려간다). #983에서는 제목 줄 아래 한 줄을 통째로 썼다.
//   - 제목 줄 아래 설명 한 줄: "영업 단계 칸을 누르면 아래 목록이 그 단계 회사만 보입니다 · 지금 "접촉" 4곳을 보는 중
//     [모든 단계 보기] · 숫자 옆 "+2"는 이번 주에 들어온 곳". 가운데는 단계를 골랐을 때만, 끝은 "+n" 꼬리표가 보일 때만.
//     (#983의 칸 옆 안내 글과 표 위 "○○만 보는 중" 줄을 이 한 줄로 합쳤다.)
import { Fragment, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import type { Dashboard, ProgressBandKey, ProgressCompany } from '../../api/dashboardTypes';
import { contactMethodLabels, dashboardTexts as t } from '../../labels/ko';
import {
  choiceChip,
  colors,
  homePalette,
  radius,
  spacing,
  tagPalette,
  typography,
} from '../../theme/tokens';
import ScheduleQuickEdit from '../schedule/ScheduleQuickEdit';
import { daysBetween } from './ProgressCompanyList';
import { stageName } from './StageChips';

export const TABLE_SHOWN = 8;
/** 단계를 고르지 않았을 때 보이는 칸. */
export const DEFAULT_BANDS: ProgressBandKey[] = ['IN_CONTACT', 'QUOTE_SAMPLE', 'WON'];

/**
 * #972: 단계 꼬리표 색. 접촉 · 견적·샘플 = 강조(보라), 성사 = 확인(초록), 미접촉·보류 = 중립.
 * 주의색은 뜻이 있을 때만(멈춘 회사 · 지난 일정) 쓰므로 견적·샘플에 쓰지 않는다.
 */
export const STAGE_COLORS: Record<ProgressBandKey, { bg: string; fg: string }> = {
  NOT_CONTACTED: tagPalette.neutral,
  IN_CONTACT: tagPalette.accent,
  QUOTE_SAMPLE: tagPalette.accent,
  WON: tagPalette.ok,
  ON_HOLD: tagPalette.neutral,
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
  const warn = { color: homePalette.orangeText, fontWeight: 600 } as const;
  if (row.nextScheduleAt && row.nextScheduleAt < today) {
    return <span style={warn}>{t.tableOverdue(monthDay(row.nextScheduleAt))}</span>;
  }
  if (row.nextScheduleAt) {
    return [monthDay(row.nextScheduleAt), row.nextScheduleNote].filter(Boolean).join(' ');
  }
  // 일정이 없다: 멈춘 회사는 주의색으로 굵게, 그 밖은 보조 글자색.
  return (
    <span style={row.stalled ? warn : { color: colors.textSecondary }}>{t.progressNoSchedule}</span>
  );
}

const th: CSSProperties = {
  textAlign: 'left',
  fontSize: typography.fontSizeSecondary,
  color: colors.textDimmed,
  fontWeight: 400,
  padding: '8px 10px',
  borderBottom: `1px solid ${colors.borderSecondary}`,
  whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: '12px 10px',
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
  stages = null,
  stagesLegend = null,
  onReload,
}: {
  companies: Dashboard['progressCompanies'];
  /** 오늘(YYYY-MM-DD, 한국). */
  today: string;
  /** 작은 단계 칸으로 고른 단계. 없으면 기본 칸들. */
  stage: ProgressBandKey | null;
  onClearStage: () => void;
  /** 기록할 수 있는 고른 담당자. 있으면 [내 회사만]이 보이고 일정 단추가 눌린다. 없으면(보기 전용 · 미선택) 잠긴다. */
  staffKey: string | null;
  badge?: ReactNode;
  /** #983 → #992 제목 바로 옆 영업 단계 칸 묶음(StageChips). 회사 목록이 없어도(옛 서버) 이 칸은 보인다. */
  stages?: ReactNode;
  /** #992 단계 칸 꼬리표 풀이(숫자 옆 "+2"는 …). 단계 칸에 "+n" 꼬리표가 보일 때만 준다. 설명 줄 끝에 붙는다. */
  stagesLegend?: string | null;
  /** #983 일정 저장이 그 사이 다른 기록 때문에 막혔을 때 [다시 읽기]가 부른다(영업 홈 다시 읽기). */
  onReload?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [all, setAll] = useState(false);
  // 바로 일정 잡기 칸을 편 줄(단계-회사 번호). 한 번에 한 줄만.
  const [editing, setEditing] = useState<string | null>(null);
  if (companies === undefined && !stages) return null;
  const hasTable = companies !== undefined;
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
  // #992 설명 줄: 누르면 무엇이 되는지(단계 칸이 있을 때) · 지금 보는 단계(골랐을 때) · 꼬리표 풀이(꼬리표가 보일 때).
  const hintParts: Array<{ key: string; node: ReactNode }> = [];
  if (stages) hintParts.push({ key: 'how', node: t.stageCellHint });
  if (hasTable && stage) {
    hintParts.push({
      key: 'now',
      node: (
        <span data-testid="dashboard-progress-stage">
          {t.tableStageOnly(stageName(stage), every.length)}{' '}
          {/* 설명 줄 글 크기 · 높이에 맞춘다(단추 때문에 줄이 높아지지 않게). */}
          <Button
            type="link"
            size="small"
            onClick={onClearStage}
            style={{ height: 'auto', padding: 0, fontSize: 'inherit' }}
          >
            {t.tableStageClear}
          </Button>
        </span>
      ),
    });
  }
  if (stages && stagesLegend) hintParts.push({ key: 'legend', node: stagesLegend });

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
        borderRadius: radius.card,
        padding: spacing.cardPadding,
      }}
    >
      {/* #972 → #992(시안): 제목 · 곳 수 | 영업 단계 칸 묶음 | 거르기 단추(오른쪽 끝). 좁으면 차례로 다음 줄로 내려간다. */}
      <div
        data-testid="dashboard-progress-head"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 12px', alignItems: 'center' }}
      >
        <h2
          id="dashboard-progress-table-title"
          style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
        >
          {badge}
          {t.tableTitle}
          {hasTable ? (
            <>
              {' '}
              <small
                data-testid="dashboard-progress-table-count"
                style={{
                  fontSize: typography.fontSizeSecondary,
                  color: colors.textDimmed,
                  fontWeight: 400,
                }}
              >
                {t.tableCount(every.length)}
              </small>
            </>
          ) : null}
        </h2>
        {stages}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            marginLeft: 'auto',
          }}
        >
          {(hasTable ? filters : []).map((key) => {
            const chip = filter === key ? choiceChip.selected : choiceChip.idle;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                data-testid={`dashboard-progress-filter-${key}`}
                style={{
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: typography.fontSizeSecondary,
                  fontWeight: filter === key ? choiceChip.selected.fontWeight : 400,
                  padding: '4px 12px',
                  borderRadius: radius.controlSm,
                  border: `1px solid ${chip.border}`,
                  background: chip.bg,
                  color: chip.fg,
                }}
              >
                {filterName[key]}
              </button>
            );
          })}
        </div>
      </div>
      {hintParts.length > 0 ? (
        <p
          data-testid="dashboard-stage-hint"
          style={{
            margin: 0,
            fontSize: typography.fontSizeSecondary - 1,
            color: colors.textDimmed,
          }}
        >
          {hintParts.map((part, index) => (
            <Fragment key={part.key}>
              {index > 0 ? ' · ' : null}
              {part.node}
            </Fragment>
          ))}
        </p>
      ) : null}
      {/* 일정 단추가 잠겨 있는 까닭. 보일 줄이 있을 때만 알린다. */}
      {hasTable && rows.length > 0 && staffKey === null ? (
        <span
          id="dashboard-progress-pick-staff"
          data-testid="dashboard-progress-pick-staff"
          style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
        >
          {t.tablePickStaffFirst}
        </span>
      ) : null}
      {!hasTable ? null : rows.length === 0 ? (
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
                {/* 다음 일정 칸은 바로 일정 잡기 칸이 펴질 자리라 넉넉히 잡는다. */}
                <th style={{ ...th, width: '34%' }}>{t.tableColumns.next}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const palette = STAGE_COLORS[row.band];
                const rowKey = `${row.band}-${row.oppId}`;
                const open = editing === rowKey;
                // 일정 잡기 칸이 펴진 줄은 다른 칸 글이 위쪽에 붙게 한다(아래로 길어지므로).
                const cell: CSSProperties = open ? { ...td, verticalAlign: 'top' } : td;
                return (
                  <tr
                    key={rowKey}
                    data-testid="dashboard-progress-row"
                    data-stalled={row.stalled ? 'true' : undefined}
                  >
                    <td style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <Link
                        to={`/opportunities/${encodeURIComponent(row.oppId)}`}
                        style={{ color: colors.text }}
                      >
                        {row.customerName}
                      </Link>
                      {row.stalled ? (
                        <span
                          data-testid="dashboard-progress-stalled-tag"
                          style={{
                            display: 'inline-block',
                            marginLeft: 8,
                            padding: '1px 9px',
                            borderRadius: radius.tag,
                            background: tagPalette.warn.bg,
                            color: tagPalette.warn.fg,
                            fontSize: typography.fontSizeSecondary - 1,
                            fontWeight: 400,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t.tableStalledTag}
                        </span>
                      ) : null}
                    </td>
                    <td style={cell}>
                      <span
                        data-testid="dashboard-progress-stage-tag"
                        style={{
                          display: 'inline-block',
                          padding: '1px 9px',
                          borderRadius: radius.tag,
                          background: palette.bg,
                          color: palette.fg,
                          fontSize: typography.fontSizeSecondary,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stageName(row.band)}
                      </span>
                    </td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                      {row.lastContactStaffName ?? (
                        <span style={{ color: colors.textSecondary }}>—</span>
                      )}
                    </td>
                    <td
                      style={{ ...cell, whiteSpace: 'nowrap' }}
                      data-testid="dashboard-progress-last"
                    >
                      {lastContactText(row, today)}
                    </td>
                    <td style={cell} data-testid="dashboard-progress-next">
                      <span
                        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
                      >
                        <span data-testid="dashboard-progress-next-text">
                          <NextCell row={row} today={today} />
                        </span>
                        <button
                          type="button"
                          disabled={staffKey === null}
                          aria-expanded={open}
                          aria-label={
                            row.nextScheduleAt
                              ? t.tableScheduleChangeLabel(row.customerName)
                              : t.tableScheduleNewLabel(row.customerName)
                          }
                          aria-describedby={
                            staffKey === null ? 'dashboard-progress-pick-staff' : undefined
                          }
                          title={staffKey === null ? t.tablePickStaffFirst : undefined}
                          onClick={() => setEditing(open ? null : rowKey)}
                          data-testid="dashboard-progress-schedule-button"
                          style={{
                            cursor: staffKey === null ? 'not-allowed' : 'pointer',
                            font: 'inherit',
                            fontSize: typography.fontSizeSecondary - 1,
                            padding: '3px 10px',
                            borderRadius: radius.controlSm,
                            border: `1px solid ${colors.borderSecondary}`,
                            background: colors.bgContainer,
                            color: staffKey === null ? colors.textDimmed : colors.text,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.nextScheduleAt ? t.tableScheduleChange : t.tableScheduleNew}
                        </button>
                      </span>
                      {open ? (
                        <div style={{ marginTop: 8 }}>
                          <ScheduleQuickEdit
                            oppId={row.oppId}
                            currentScheduleAt={row.nextScheduleAt}
                            currentScheduleNote={row.nextScheduleNote}
                            today={today}
                            onSaved={() => setEditing(null)}
                            onCancel={() => setEditing(null)}
                            onReload={onReload}
                          />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasTable && rows.length > TABLE_SHOWN ? (
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
