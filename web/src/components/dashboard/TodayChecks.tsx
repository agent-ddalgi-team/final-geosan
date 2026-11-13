// 대시보드 맨 위 "오늘 확인할 것"(#679, PM 결정 2026-11-13). 서버가 저장된 값으로 센 줄 목록을 그대로 보인다(AI 없음).
// 줄마다 "이름 n건"과 한 줄 설명(앞 2건 + "외 n"). 0건인 줄은 서버가 보내지 않고, 줄이 하나도 없으면 안내 한 줄.
// 일정 줄은 누르면 줄 아래에 회사 상세로 가는 작은 목록이 펴지고, 걸러 볼 값이 있는 줄은 그 회사들만 걸러진 목록으로 간다.
// 줄 종류는 뒤에 늘어난다(#677 "다시 조사할 때"·"AI와 다른 값"). 이름표에 없는 종류는 보이지 않는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TodayCheckItem, TodayCheckKind, TodayCheckRow } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

const SHOWN_IN_LINE = 2;

function isKnownKind(kind: string): kind is TodayCheckKind {
  return kind in dashboardTexts.todayRowNames;
}

function itemText(item: TodayCheckItem): string {
  return [item.customerName, item.note].filter(Boolean).join(' ');
}

/** "A정밀 견적 · B금속 방문 외 1": 앞 2건만 적는다. 남은 수는 건수에서 뺀다. */
export function todayRowSummary(row: TodayCheckRow): string {
  const shown = row.items.slice(0, SHOWN_IN_LINE).map(itemText).join(' · ');
  const rest = row.count - Math.min(row.items.length, SHOWN_IN_LINE);
  return rest > 0 ? `${shown} ${dashboardTexts.todayMore(rest)}`.trim() : shown;
}

const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 8,
  width: '100%',
  padding: '8px 0',
  border: 0,
  background: 'none',
  font: 'inherit',
  color: colors.text,
  textAlign: 'left',
  cursor: 'pointer',
} as const;

function RowText({ row, kind }: { row: TodayCheckRow; kind: TodayCheckKind }) {
  return (
    <>
      <strong data-testid={`dashboard-today-count-${kind}`}>
        {dashboardTexts.todayRowNames[kind]} {row.count}
        {dashboardTexts.todayRowUnits[kind]}
      </strong>
      <span
        data-testid={`dashboard-today-summary-${kind}`}
        style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
      >
        {todayRowSummary(row)}
      </span>
    </>
  );
}

export interface TodayChecksProps {
  /** 서버의 줄 목록. 옛 서버라 칸이 없으면(undefined) 구역을 그리지 않는다. */
  rows: TodayCheckRow[] | undefined;
  /**
   * 영업 비서(#680)가 한두 문장으로 정리해 줄 자리. 지금은 아무도 넘기지 않아 아무것도 보이지 않는다
   * (빈 상자·안내 문구 없음). 영업 비서가 생기면 이 값만 채우면 줄 목록 위에 보인다.
   */
  assistantSummary?: string | null;
}

export default function TodayChecks({ rows, assistantSummary = null }: TodayChecksProps) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  if (rows === undefined) return null;
  const known = rows.filter((row) => isKnownKind(row.kind) && row.count > 0);
  return (
    <section
      aria-labelledby="dashboard-today-title"
      data-testid="dashboard-today"
      style={{
        display: 'grid',
        gap: 8,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 12,
        padding: '16px 20px',
      }}
    >
      <h2 id="dashboard-today-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
        {dashboardTexts.todayTitle}
      </h2>
      {assistantSummary ? (
        <p data-testid="dashboard-today-assistant" style={{ margin: 0 }}>
          {assistantSummary}
        </p>
      ) : null}
      {known.length === 0 ? (
        <p data-testid="dashboard-today-empty" style={{ margin: 0, color: colors.textSecondary }}>
          {dashboardTexts.todayEmpty}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {known.map((row) => {
            const kind = row.kind as TodayCheckKind;
            const open = openKind === kind;
            return (
              <li
                key={kind}
                data-testid="dashboard-today-row"
                style={{ borderTop: `1px solid ${colors.borderSecondary}` }}
              >
                {row.listFilter ? (
                  <Link
                    to={`/opportunities?filter=${encodeURIComponent(row.listFilter)}`}
                    data-testid={`dashboard-today-link-${kind}`}
                    style={{ ...rowStyle, textDecoration: 'none' }}
                  >
                    <RowText row={row} kind={kind} />
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`dashboard-today-items-${kind}`}
                      onClick={() => setOpenKind(open ? null : kind)}
                      data-testid={`dashboard-today-toggle-${kind}`}
                      style={rowStyle}
                    >
                      <RowText row={row} kind={kind} />
                    </button>
                    {open ? (
                      <ol
                        id={`dashboard-today-items-${kind}`}
                        data-testid={`dashboard-today-items-${kind}`}
                        style={{
                          listStyle: 'none',
                          margin: 0,
                          padding: '0 0 12px',
                          display: 'grid',
                          gap: 6,
                        }}
                      >
                        {row.items.map((item) => (
                          <li key={`${item.oppId}-${item.dueAt ?? ''}-${item.note ?? ''}`}>
                            <Link
                              to={`/opportunities/${encodeURIComponent(item.oppId)}`}
                              data-testid="dashboard-today-item"
                            >
                              {[formatMonthDay(item.dueAt), itemText(item)]
                                .filter(Boolean)
                                .join(' ')}
                            </Link>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
