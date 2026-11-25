// 영업 분석 "월별 추세"(#802, PM 지시 2026-11-22). 서버가 센 최근 12개월 접촉·성사·거절 회사 수를
// 달마다 막대 셋으로 보인다. 기간 선택과 상관없고 AI를 쓰지 않는다. 옛 서버(칸 없음)면 그리지 않는다.
import type { MonthTrendRow } from '../../api/salesAnalysis';
import { monthlyTrendTexts as t } from '../../labels/ko';
import { chartTheme, radius } from '../../theme/tokens';
import ChartFrame, { chartSecondary as secondary } from '../common/ChartFrame';
import { monthlyReading } from './chartSummaries';

// #898: 청회색 판 위에 접촉은 흰 막대, 성사는 연노랑, 거절은 먹색.
const CONTACTED = chartTheme.barSoft;
const WON = chartTheme.bar;
const LOST = chartTheme.barStrong;

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        marginRight: 4,
        verticalAlign: 'middle',
      }}
    />
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const height = max > 0 ? Math.round((value / max) * 120) : 0;
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height,
        minHeight: value > 0 ? 4 : 0,
        background: color,
        borderRadius: radius.pill,
      }}
    />
  );
}

export default function MonthlyTrend({ rows }: { rows?: MonthTrendRow[] }) {
  if (!rows || rows.length === 0) return null;
  const max = Math.max(0, ...rows.map((row) => Math.max(row.contacted, row.won, row.lost)));
  const reading = max === 0 ? null : monthlyReading(rows);
  return (
    <ChartFrame
      id="monthly-trend"
      title={t.title}
      callout={reading?.callout ?? null}
      summary={reading?.summary ?? null}
      legend={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, ...secondary }}>
          <span>{t.note}</span>
          <span>
            <Swatch color={CONTACTED} />
            {t.legend.contacted} <Swatch color={WON} />
            {t.legend.won} <Swatch color={LOST} />
            {t.legend.lost}
          </span>
        </div>
      }
    >
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
              <span style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                <Bar value={row.contacted} max={max} color={CONTACTED} />
                <Bar value={row.won} max={max} color={WON} />
                <Bar value={row.lost} max={max} color={LOST} />
              </span>
              <span style={secondary}>{t.monthLabel(row.month)}</span>
            </li>
          ))}
        </ol>
      )}
    </ChartFrame>
  );
}
