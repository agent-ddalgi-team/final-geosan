// 영업 분석 그래프(#760, PM 요청 2026-11-15 — 참고 그림처럼 숫자 칸·막대·도넛이 한눈에 들어오게).
// 숫자는 서버가 계산한 값 그대로다(새로 지어내지 않는다). 그림 파일·라이브러리 없이 SVG·칸으로 그린다.
// 색은 theme/tokens의 chartPalette(검사 도구로 색맹 구분을 확인한 순서)만 쓰고, 색만으로 구분하지 않게
// 범례·값 글자를 함께 둔다. 막대·조각에 손을 올리면 이름과 값이 뜬다(title). 자세한 값은 아래 표에 그대로 있다.
import type { ReactNode } from 'react';
import type { AnalysisStats, SalesAnalysis } from '../../api/salesAnalysis';
import {
  analysisCharts as texts,
  contactMethodLabels,
  labelFor,
  lostReasonLabels,
  salesStepLabels,
} from '../../labels/ko';
import { chartPalette, colors, typography } from '../../theme/tokens';

const [BLUE, ORANGE, AQUA, YELLOW] = chartPalette.series;
/** 막대 그래프의 기준 너비(viewBox). 실제로는 칸 너비에 맞춰 늘고 준다. */
const VIEW_WIDTH = 640;
const percent = (ratio: number) => Math.round(ratio * 100);

const cardStyle = {
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: chartPalette.cardRadius,
  padding: 20,
  display: 'grid',
  gap: 14,
  alignContent: 'start',
  minWidth: 0,
} as const;
const titleStyle = { margin: 0, fontSize: 18, fontWeight: 600 } as const;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

function ChartCard({
  id,
  title,
  legend,
  children,
}: {
  id: string;
  title: string;
  legend?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={id} style={cardStyle}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <h2 id={`${id}-title`} style={{ ...titleStyle, flex: 1 }}>
          {title}
        </h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
      }}
    >
      {items.map((item) => (
        <li
          key={item.label}
          style={{ display: 'flex', alignItems: 'center', gap: 6, ...secondary }}
        >
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 3, background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 숫자 칸 5개: 왼쪽 큰 칸(접촉한 회사) + 오른쪽 2×2. 오른쪽 영업 코치 칸이 있어 본문이 좁아도 한 칸만 아래로 떨어지지 않게(#760·#773).
// ---------------------------------------------------------------------------

function Tile({
  testId,
  label,
  value,
  sub,
  highlight = false,
}: {
  testId: string;
  label: string;
  value: number;
  sub: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        ...cardStyle,
        gap: 8,
        minWidth: 0,
        gridRow: highlight ? 'span 2' : undefined,
        background: highlight ? chartPalette.highlightBg : colors.bgContainer,
        color: highlight ? chartPalette.highlightFg : colors.text,
        borderColor: highlight ? chartPalette.highlightBg : colors.borderSecondary,
      }}
    >
      <span style={{ fontSize: typography.fontSize, opacity: highlight ? 0.85 : 1 }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <strong
          data-testid={`${testId}-value`}
          style={{ fontSize: 40, lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          {value}
        </strong>
        <span style={{ fontSize: typography.fontSize }}>{texts.unitCompany}</span>
      </span>
      {sub ? (
        <span
          data-testid={`${testId}-sub`}
          style={{
            fontSize: typography.fontSizeSecondary,
            color: highlight ? chartPalette.highlightAccent : colors.textSecondary,
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function KpiTiles({ total, minSample }: { total: AnalysisStats; minSample: number }) {
  const topLost = total.lostReasons[0];
  return (
    <div
      data-testid="analysis-kpis"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) repeat(2, minmax(0, 1fr))',
        gap: 16,
      }}
    >
      <Tile
        testId="kpi-contacted"
        label={texts.kpiContacted}
        value={total.contactedCount}
        sub={
          total.ratios
            ? texts.kpiWonRatio(percent(total.ratios.won))
            : texts.kpiSample(total.contactedCount, minSample)
        }
        highlight
      />
      <Tile
        testId="kpi-in-progress"
        label={texts.kpiInProgress}
        value={total.inProgressCount}
        sub={total.onHoldCount > 0 ? texts.kpiHold(total.onHoldCount) : texts.kpiInProgressNote}
      />
      {/* 완료(#766 PM 결정 2026-11-16: 대시보드의 "완료" 칸을 여기로 옮김) = 성사 + 거절. 서버 숫자를 더하기만 한다. */}
      <Tile
        testId="kpi-done"
        label={texts.kpiDone}
        value={total.wonCount + total.lostCount}
        sub={texts.kpiDoneSub(total.wonCount, total.lostCount)}
      />
      <Tile
        testId="kpi-won"
        label={texts.kpiWon}
        value={total.wonCount}
        sub={total.avgContactsToWon !== null ? texts.kpiAvgToWon(total.avgContactsToWon) : null}
      />
      <Tile
        testId="kpi-lost"
        label={texts.kpiLost}
        value={total.lostCount}
        sub={
          topLost ? texts.kpiLostTop(labelFor(lostReasonLabels, topLost.code), topLost.count) : null
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 공정별 접촉·성사: 세로 막대 두 개씩
// ---------------------------------------------------------------------------

/** 곳 수 눈금: 정수 간격(1·2·5·10…)으로 4칸 안팎. */
export function countTicks(value: number): number[] {
  const top = Math.max(value, 1);
  const raw = top / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = Math.max(1, [1, 2, 5, 10].map((n) => n * pow).find((n) => n >= raw) ?? 10 * pow);
  const max = Math.ceil(top / step) * step;
  return Array.from({ length: max / step + 1 }, (_, i) => i * step);
}

export function ProcessBars({ rows }: { rows: SalesAnalysis['byProcess'] }) {
  const series = [
    { key: 'contacted', label: texts.seriesContacted, color: BLUE },
    { key: 'won', label: texts.seriesWon, color: ORANGE },
  ] as const;
  const ticks = countTicks(Math.max(0, ...rows.map((row) => row.contactedCount)));
  const max = ticks[ticks.length - 1];
  const height = 220;
  const top = 18;
  const left = 32;
  // 칸 너비에 맞춰 늘어나게 viewBox로 그린다. 공정이 많으면 한 묶음 56px 아래로는 줄이지 않고 옆으로 넘긴다.
  const groupWidth = Math.max(56, (VIEW_WIDTH - left - 8) / Math.max(rows.length, 1));
  const width = left + Math.max(rows.length, 1) * groupWidth + 8;
  const y = (v: number) => top + height - (v / max) * height;
  const bar = 16;
  return (
    <ChartCard
      id="chart-process"
      title={texts.processChartTitle}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
    >
      {rows.length === 0 ? (
        <p style={{ margin: 0, ...secondary }}>{texts.chartEmpty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            role="img"
            aria-label={rows
              .map(
                (row) =>
                  `${row.processName} ${texts.seriesContacted} ${row.contactedCount}곳 ${texts.seriesWon} ${row.wonCount}곳`,
              )
              .join(', ')}
            viewBox={`0 0 ${width} ${top + height + 46}`}
            width="100%"
            style={{ display: 'block', minWidth: rows.length * 56 + left }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={width}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={chartPalette.grid}
                  strokeDasharray={t === 0 ? undefined : '3 4'}
                />
                <text
                  x={left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill={colors.textSecondary}
                >
                  {t}
                </text>
              </g>
            ))}
            {rows.map((row, i) => {
              const cx = left + i * groupWidth + groupWidth / 2;
              const values = [row.contactedCount, row.wonCount];
              return (
                <g key={row.processCode ?? 'none'} data-testid="chart-process-group">
                  {values.map((v, j) => {
                    const x = cx - bar - 1 + j * (bar + 2);
                    const h = Math.max(0, (v / max) * height);
                    return (
                      <g key={series[j].key}>
                        <rect
                          x={x}
                          y={top + height - h}
                          width={bar}
                          height={h}
                          rx={4}
                          fill={series[j].color}
                          data-testid={`chart-process-bar-${series[j].key}`}
                        >
                          <title>{texts.barTip(row.processName, series[j].label, v)}</title>
                        </rect>
                        {v > 0 ? (
                          <text
                            x={x + bar / 2}
                            y={top + height - h - 5}
                            textAnchor="middle"
                            fontSize="11"
                            fill={colors.textSecondary}
                          >
                            {v}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                  <text
                    x={cx}
                    y={top + height + 20}
                    textAnchor="middle"
                    fontSize="12"
                    fill={colors.text}
                  >
                    {row.processName.length > 6
                      ? `${row.processName.slice(0, 6)}…`
                      : row.processName}
                    <title>{row.processName}</title>
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 결과 나눔: 도넛
// ---------------------------------------------------------------------------

export function OutcomeDonut({ total }: { total: AnalysisStats }) {
  const parts = [
    { key: 'inProgress', label: texts.donutInProgress, value: total.inProgressCount, color: BLUE },
    { key: 'won', label: texts.donutWon, value: total.wonCount, color: ORANGE },
    { key: 'hold', label: texts.donutHold, value: total.onHoldCount, color: AQUA },
    { key: 'lost', label: texts.donutLost, value: total.lostCount, color: YELLOW },
  ];
  const sum = parts.reduce((acc, p) => acc + p.value, 0);
  const r = 70;
  const stroke = 26;
  const c = 2 * Math.PI * r;
  const gap = sum > 0 && parts.filter((p) => p.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <ChartCard id="chart-donut" title={texts.donutTitle}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
        <svg
          role="img"
          aria-label={parts.map((p) => `${p.label} ${p.value}곳`).join(', ')}
          width={(r + stroke) * 2}
          height={(r + stroke) * 2}
          viewBox={`0 0 ${(r + stroke) * 2} ${(r + stroke) * 2}`}
        >
          <g transform={`rotate(-90 ${r + stroke} ${r + stroke})`}>
            <circle
              cx={r + stroke}
              cy={r + stroke}
              r={r}
              fill="none"
              stroke={chartPalette.track}
              strokeWidth={stroke}
            />
            {sum > 0
              ? parts.map((p) => {
                  if (p.value === 0) return null;
                  const len = (p.value / sum) * c;
                  const dash = Math.max(len - gap, 0.1);
                  const el = (
                    <circle
                      key={p.key}
                      data-testid={`chart-donut-${p.key}`}
                      cx={r + stroke}
                      cy={r + stroke}
                      r={r}
                      fill="none"
                      stroke={p.color}
                      strokeWidth={stroke}
                      strokeDasharray={`${dash} ${c - dash}`}
                      strokeDashoffset={-offset}
                    >
                      <title>{texts.countTip(p.label, p.value, texts.unitCompany)}</title>
                    </circle>
                  );
                  offset += len;
                  return el;
                })
              : null}
          </g>
          <text
            x={r + stroke}
            y={r + stroke - 6}
            textAnchor="middle"
            fontSize="13"
            fill={colors.textSecondary}
          >
            {texts.donutCenter}
          </text>
          <text
            x={r + stroke}
            y={r + stroke + 24}
            textAnchor="middle"
            fontSize="30"
            fontWeight="700"
            fill={colors.text}
            data-testid="chart-donut-total"
          >
            {sum}
          </text>
        </svg>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '8px 20px',
            width: '100%',
          }}
        >
          {parts.map((p) => (
            <li
              key={p.key}
              data-testid={`chart-donut-legend-${p.key}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: p.color,
                  flex: 'none',
                }}
              />
              <span style={{ flex: 1, ...secondary }}>{p.label}</span>
              <strong>
                {p.value}
                {texts.unitCompany}
              </strong>
              {sum > 0 ? <span style={secondary}>{Math.round((p.value / sum) * 100)}%</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 가로 막대 목록: 세부 단계·연락 방법·거절 이유
// ---------------------------------------------------------------------------

interface HBarRow {
  key: string;
  label: string;
  value: number;
  /** 막대 길이를 정하는 바탕 값(연결/시도처럼 비율로 그릴 때). 없으면 가장 큰 값 기준. */
  of?: number;
  /** 막대 오른쪽 글. 없으면 "n번". */
  text: string;
  note?: string | null;
}

function HBars({
  id,
  title,
  rows,
  color,
}: {
  id: string;
  title: string;
  rows: HBarRow[];
  color: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.of ?? row.value));
  return (
    <ChartCard id={id} title={title}>
      {rows.length === 0 ? (
        <p style={{ margin: 0, ...secondary }}>{texts.chartEmpty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
          {rows.map((row) => {
            const base = row.of ?? max;
            const width = base > 0 ? Math.max((row.value / base) * 100, row.value > 0 ? 2 : 0) : 0;
            return (
              <li key={row.key} data-testid={`${id}-row`} title={`${row.label} · ${row.text}`}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span>
                    {row.label} <strong style={{ color: colors.text }}>({row.text})</strong>
                  </span>
                  {row.note ? <span style={secondary}>{row.note}</span> : null}
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    height: 12,
                    borderRadius: 4,
                    background: chartPalette.track,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: color,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

export function StepBars({ rows }: { rows: SalesAnalysis['bySalesStep'] }) {
  return (
    <HBars
      id="chart-steps"
      title={texts.stepChartTitle}
      color={BLUE}
      rows={rows.map((row) => ({
        key: row.step,
        label: labelFor(salesStepLabels, row.step),
        value: row.contactCount,
        text: `${row.contactCount}${texts.unitTimes}`,
        note: row.reachedCount > 0 ? texts.stepReached(row.reachedCount) : null,
      }))}
    />
  );
}

export function MethodBars({ total }: { total: AnalysisStats }) {
  const methods = (['CALL', 'EMAIL', 'VISIT'] as const).filter(
    (method) => total.contactReach[method].tried > 0,
  );
  return (
    <HBars
      id="chart-methods"
      title={texts.methodChartTitle}
      color={AQUA}
      rows={methods.map((method) => {
        const { reached, tried } = total.contactReach[method];
        return {
          key: method,
          label: contactMethodLabels[method],
          value: reached,
          of: tried,
          text: texts.methodValue(reached, tried),
        };
      })}
    />
  );
}

export function LostReasonBars({ total }: { total: AnalysisStats }) {
  return (
    <HBars
      id="chart-lost"
      title={texts.lostChartTitle}
      color={ORANGE}
      rows={total.lostReasons.map((item) => ({
        key: item.code,
        label: labelFor(lostReasonLabels, item.code),
        value: item.count,
        text: `${item.count}${texts.unitCompany}`,
      }))}
    />
  );
}

/** 숫자 칸 + 그래프 묶음. 아래 표는 화면이 따로 그린다. */
export default function AnalysisCharts({ data }: { data: SalesAnalysis }) {
  return (
    <div data-testid="analysis-charts" style={{ display: 'grid', gap: 16 }}>
      <KpiTiles total={data.total} minSample={data.basis.minSampleForRatio} />
      {/* 넓은 화면은 막대 2 : 도넛 1, 좁으면 아래로 쌓인다. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: '2 1 520px', minWidth: 0, display: 'grid' }}>
          <ProcessBars rows={data.byProcess} />
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'grid' }}>
          <OutcomeDonut total={data.total} />
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
        }}
      >
        <StepBars rows={data.bySalesStep} />
        <MethodBars total={data.total} />
        <LostReasonBars total={data.total} />
      </div>
    </div>
  );
}
