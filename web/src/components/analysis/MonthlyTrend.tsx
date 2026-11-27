// 영업 분석 "월별 추세"(#802, PM 지시 2026-11-22). 서버가 센 최근 12개월 접촉·성사·거절 회사 수를 보인다.
// 기간 선택과 상관없고 AI를 쓰지 않는다. 옛 서버(칸 없음)면 그리지 않는다.
// #972(새 시안): 달마다 막대 셋 → 접촉한 회사 수의 선 + 옅은 면. 성사·거절 값은 그리지 않고, 달에 손을 올리면 뜨는 글과
// 화면 읽기용 글("11월: 접촉 5 · 성사 1 · 거절 2"), 그림 아래 요약 문장으로 그대로 전한다.
// 영업 홈도 이 부품을 그대로 쓰므로 이름과 props({ rows })는 바꾸지 않는다.
import type { MonthTrendRow } from '../../api/salesAnalysis';
import { monthlyTrendTexts as t } from '../../labels/ko';
import { accent } from '../../theme/tokens';
import ChartFrame, { chartSecondary as secondary } from '../common/ChartFrame';
import { monthlyReading } from './chartSummaries';

/** 선 그림의 그리는 칸(SVG 좌표). 가로는 화면 폭에 맞춰 늘어나고 세로는 170px 고정이다. */
const VIEW = { width: 600, height: 170, base: 162, top: 24 } as const;

export interface TrendPoint {
  month: string;
  /** 접촉한 회사 수(선이 그리는 값). */
  value: number;
  x: number;
  y: number;
}

/**
 * 달마다 선이 지나는 점. 가로는 그 달 칸의 가운데(아래 달 이름·손 올림 칸과 맞춘다),
 * 세로는 접촉한 회사 수(가장 많은 달이 맨 위, 0곳이면 바닥). 값을 새로 만들지 않는다.
 */
export function trendPoints(rows: MonthTrendRow[]): TrendPoint[] {
  const max = Math.max(0, ...rows.map((row) => row.contacted));
  const column = VIEW.width / Math.max(rows.length, 1);
  return rows.map((row, index) => ({
    month: row.month,
    value: row.contacted,
    x: round(column * (index + 0.5)),
    y: round(max > 0 ? VIEW.base - (row.contacted / max) * (VIEW.base - VIEW.top) : VIEW.base),
  }));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 선(M x y L x y …). */
export function trendLinePath(points: TrendPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

/** 선 아래 옅은 면: 선을 따라간 뒤 바닥으로 내려 닫는다. */
function trendAreaPath(points: TrendPoint[]): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${trendLinePath(points)} L${last.x} ${VIEW.height} L${first.x} ${VIEW.height} Z`;
}

/** 선 + 옅은 면 + 달 이름 축. 틀(제목·요약) 없이 그림만 쓸 때. */
export function MonthlyTrendChart({ rows }: { rows: MonthTrendRow[] }) {
  const points = trendPoints(rows);
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ position: 'relative', minWidth: rows.length * 28 }}>
        {/* 값은 아래 달 칸의 글(aria-label·title)이 전하므로 그림 자체는 화면 읽기에서 뺀다. */}
        <svg
          aria-hidden="true"
          data-testid="monthly-trend-line"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: VIEW.height,
            display: 'block',
            pointerEvents: 'none',
          }}
        >
          <path data-testid="monthly-trend-area" d={trendAreaPath(points)} fill={accent.soft} />
          <path
            data-testid="monthly-trend-path"
            d={trendLinePath(points)}
            fill="none"
            stroke={accent.bright}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <ol
          style={{
            position: 'relative',
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${rows.length}, minmax(28px, 1fr))`,
          }}
        >
          {rows.map((row) => {
            const text = t.row(t.monthLabel(row.month), row.contacted, row.won, row.lost);
            return (
              <li
                key={row.month}
                data-testid="monthly-trend-month"
                data-contacted={row.contacted}
                aria-label={text}
                title={text}
                style={{ display: 'grid', justifyItems: 'center', gap: 6 }}
              >
                {/* 선 위 빈 칸: 이 달 어디에 손을 올려도 값이 뜬다. */}
                <span aria-hidden="true" style={{ display: 'block', height: VIEW.height }} />
                <span style={secondary}>{t.monthLabel(row.month)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
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
      fill
      legend={
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', ...secondary }}>
          <span>{t.note}</span>
          <span data-testid="monthly-trend-legend">
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 14,
                height: 3,
                borderRadius: 2,
                background: accent.bright,
                marginRight: 6,
                verticalAlign: 'middle',
              }}
            />
            {t.lineLegend}
          </span>
        </div>
      }
    >
      {max === 0 ? (
        <p data-testid="monthly-trend-empty" style={{ ...secondary, margin: 0 }}>
          {t.empty}
        </p>
      ) : (
        <MonthlyTrendChart rows={rows} />
      )}
    </ChartFrame>
  );
}
