// 영업 분석 "월별 추세"(#802, PM 지시 2026-11-22). 서버가 센 최근 12개월 접촉·성사·거절 회사 수를
// 달마다 막대 셋으로 보인다. 기간 선택과 상관없고 AI를 쓰지 않는다. 옛 서버(칸 없음)면 그리지 않는다.
import type { MonthTrendRow } from '../../api/salesAnalysis';
import { monthlyTrendTexts as t } from '../../labels/ko';
import { chartPalette, colors, radius, typography } from '../../theme/tokens';

const [BLUE, ORANGE] = chartPalette.series;
const GREY = chartPalette.base;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const height = max > 0 ? Math.round((value / max) * 80) : 0;
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height,
        minHeight: value > 0 ? 2 : 0,
        background: color,
        borderRadius: radius.sm,
      }}
    />
  );
}

export default function MonthlyTrend({ rows }: { rows?: MonthTrendRow[] }) {
  if (!rows || rows.length === 0) return null;
  const max = Math.max(0, ...rows.map((row) => Math.max(row.contacted, row.won, row.lost)));
  return (
    <section
      aria-labelledby="monthly-trend-title"
      data-testid="monthly-trend"
      style={{
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: chartPalette.cardRadius,
        padding: 20,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h2 id="monthly-trend-title" style={{ margin: 0, fontSize: typography.fontSizeCardTitle }}>
          {t.title}
        </h2>
        <span style={secondary}>{t.note}</span>
        <span style={secondary}>
          <span style={{ color: GREY }}>■</span> {t.legend.contacted}{' '}
          <span style={{ color: BLUE }}>■</span> {t.legend.won}{' '}
          <span style={{ color: ORANGE }}>■</span> {t.legend.lost}
        </span>
      </div>
      {max === 0 ? (
        <p data-testid="monthly-trend-empty" style={{ ...secondary, margin: 0 }}>
          {t.empty}
        </p>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${rows.length}, minmax(28px, 1fr))`,
            gap: 4,
            alignItems: 'end',
          }}
        >
          {rows.map((row) => (
            <li
              key={row.month}
              data-testid="monthly-trend-month"
              aria-label={t.row(t.monthLabel(row.month), row.contacted, row.won, row.lost)}
              title={t.row(t.monthLabel(row.month), row.contacted, row.won, row.lost)}
              style={{ display: 'grid', justifyItems: 'center', gap: 4 }}
            >
              <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                <Bar value={row.contacted} max={max} color={GREY} />
                <Bar value={row.won} max={max} color={BLUE} />
                <Bar value={row.lost} max={max} color={ORANGE} />
              </span>
              <span style={secondary}>{t.monthLabel(row.month)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
