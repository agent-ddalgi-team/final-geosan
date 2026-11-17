// 대시보드 맨 위 "오늘 브리핑"(#795, PM 결정 2026-11-16): AI 오늘 정리 몇 줄 + 주제별 칸.
//   📅 일정 "지난 1 · 오늘 2"  ·  📬 전달 사항 "확인 전 1곳"(있을 때만)  ·  📈 영업 진행 띠(미접촉 → 접촉 → 견적·샘플 → 성사)
// 숫자는 "오늘 확인할 것" 줄(todayChecks)과 건수(counts)를 그대로 쓴다. 서버는 0건인 줄을 보내지 않으므로
// 줄이 없으면 0이다. 새 계산·새 API 없음.
import type { ReactNode } from 'react';
import type { Dashboard, DashboardCounts, TodayCheckRow } from '../../api/dashboardTypes';
import { dashboardTexts as t } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import CountCards from './CountCards';

const card = {
  boxSizing: 'border-box',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: spacing.cardPadding,
} as const;
const cardTitle = { margin: 0, fontSize: typography.fontSize, fontWeight: 600 } as const;
const big = { fontSize: typography.fontSizeCardTitle, fontWeight: 700 } as const;

function countOf(rows: TodayCheckRow[] | undefined, kind: TodayCheckRow['kind']): number {
  return rows?.find((row) => row.kind === kind)?.count ?? 0;
}

export default function DashboardBrief({
  rows,
  counts,
  companies,
  today: todayDate,
  assistantSummary = null,
}: {
  rows: TodayCheckRow[] | undefined;
  counts: DashboardCounts;
  /** #800: 진행 띠 칸별 회사. 있으면 칸을 눌러 편다. */
  companies?: Dashboard['progressCompanies'];
  /** 오늘(YYYY-MM-DD, 한국). */
  today?: string;
  /** AI 오늘 정리(#743). 스위치가 꺼져 있거나 담당자를 안 골랐으면 넘기지 않는다. */
  assistantSummary?: ReactNode;
}) {
  const overdue = countOf(rows, 'SCHEDULE_OVERDUE');
  const today = countOf(rows, 'SCHEDULE_TODAY');
  const handoff = countOf(rows, 'HANDOFF_FOR_ME');
  // #854: 내가 보냈는데 받는 사람이 아직 확인하지 않은 것. 보낸 사람 본인에게만 온다.
  const sent = countOf(rows, 'HANDOFF_FROM_ME');
  return (
    <section
      aria-labelledby="dashboard-brief-title"
      data-testid="dashboard-brief"
      style={{ display: 'grid', gap: 12 }}
    >
      <h2 id="dashboard-brief-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
        {t.briefTitle}
      </h2>
      {assistantSummary ? (
        <div data-testid="dashboard-today-assistant">{assistantSummary}</div>
      ) : null}
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'stretch' }}
      >
        <div data-testid="dashboard-brief-schedule" style={{ ...card, flex: '1 1 160px' }}>
          <h3 style={cardTitle}>
            <span aria-hidden="true">📅 </span>
            {t.briefScheduleTitle}
          </h3>
          <span
            style={{ ...big, color: overdue > 0 ? colors.error : colors.text }}
            data-testid="dashboard-brief-schedule-counts"
          >
            {overdue + today > 0 ? t.briefScheduleCounts(overdue, today) : t.briefScheduleNone}
          </span>
        </div>
        {handoff + sent > 0 ? (
          <div data-testid="dashboard-brief-handoff" style={{ ...card, flex: '1 1 160px' }}>
            <h3 style={cardTitle}>
              <span aria-hidden="true">📬 </span>
              {t.briefHandoffTitle}
            </h3>
            {handoff > 0 ? (
              <span style={big} data-testid="dashboard-brief-handoff-received">
                {t.briefHandoffReceived(handoff)}
              </span>
            ) : null}
            {sent > 0 ? (
              <span
                style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
                data-testid="dashboard-brief-handoff-sent"
              >
                {t.briefHandoffSent(sent)}
              </span>
            ) : null}
          </div>
        ) : null}
        <div data-testid="dashboard-brief-progress" style={{ flex: '3 1 360px', minWidth: 0 }}>
          <CountCards counts={counts} part="progress" companies={companies} today={todayDate} />
        </div>
      </div>
    </section>
  );
}
