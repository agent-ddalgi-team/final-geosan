// 영업 분석 그림(#760 처음, #801 PM 지시 2026-11-16: 겹치는 숫자 칸 없이 네 그림으로 다시 짬).
// ① 어디서 빠지나(깔때기) ② 거절 이유 ③ 어느 조합에서 잘 되나(공정 × 산업 칸) ④ 회사별로 어디서 멈췄나(타임라인).
// 지금 상태 숫자(진행 중·보류)는 대시보드 몫이라 여기 두지 않는다. 숫자는 서버가 준 값을 세기만 한다(새로 지어내지 않는다).
// 그림 파일·라이브러리 없이 칸·SVG로 그린다. 색은 theme/tokens의 chartPalette만 쓰고, 색만으로 구분하지 않게
// 글자를 함께 둔다. 점·칸에 손을 올리면 이름과 값이 뜬다(title). 자세한 값은 아래 [표로 보기]에 그대로 있다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AnalysisStats, CompanyAnalysisRow, SalesAnalysis } from '../../api/salesAnalysis';
import {
  analysisCharts as texts,
  contactMethodLabels,
  contactResultLabels,
  labelFor,
  lostReasonLabels,
  outcomeStatusLabels,
  salesStepLabels,
} from '../../labels/ko';
import { chartPalette, colors, radius, typography } from '../../theme/tokens';

const [BLUE, ORANGE, AQUA] = chartPalette.series;
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
        {/* 제목은 줄지 않고, 좁으면 범례가 다음 줄로 내려간다. */}
        <h2 id={`${id}-title`} style={{ ...titleStyle, flex: '1 0 auto' }}>
          {title}
        </h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 가로 막대 목록: 거절 이유
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
                    borderRadius: radius.sm,
                    background: chartPalette.track,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${width}%`,
                      height: '100%',
                      borderRadius: radius.sm,
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

// ---------------------------------------------------------------------------
// ① 어디서 빠지나: 접촉 → 연결 → 수요 확인 → 견적·샘플 → 성사
// ---------------------------------------------------------------------------

export type FunnelKey = keyof typeof texts.funnelStages;
const FUNNEL_KEYS: FunnelKey[] = ['CONTACTED', 'REACHED', 'DEMAND', 'QUOTE', 'WON'];
/** 세부 단계 코드 → 깔때기 칸 순서. 자료·견적과 방문·샘플은 한 칸(견적·샘플)이다. */
const STEP_RANK: Record<string, number> = {
  NOT_REACHED: 0,
  REACHED: 1,
  DEMAND_CONFIRMED: 2,
  MATERIAL_QUOTE: 3,
  VISIT_SAMPLE: 3,
};

/** 회사가 이른 깔때기 칸(0~4). 성사면 끝 칸, 아니면 기록으로 이른 가장 먼 세부 단계(옛 서버면 지금 단계). */
export function funnelRank(company: CompanyAnalysisRow): number {
  if (company.outcomeStatus === 'WON') return 4;
  const step = company.furthestStep !== undefined ? company.furthestStep : company.salesStep;
  return step ? (STEP_RANK[step] ?? 0) : 0;
}

export interface FunnelStage {
  key: FunnelKey;
  /** 이 칸까지 온 회사 수(뒤 칸까지 간 회사 포함). */
  count: number;
  /** 다음 칸으로 넘어간 비율(0~1). 끝 칸이거나 이 칸이 0곳이면 null. */
  pass: number | null;
  /** 이 칸에서 멈춘 회사: 거절(이유별)·보류·진행 중. */
  stopped: { lost: number; reasons: { code: string; count: number }[]; hold: number; open: number };
}

/** 회사 줄로 깔때기 칸을 센다(서버 숫자를 세기만 함). 거절 이유는 많은 순, 같으면 먼저 나온 순. */
export function funnelStages(companies: CompanyAnalysisRow[]): FunnelStage[] {
  const ranks = companies.map((company) => ({ company, rank: funnelRank(company) }));
  return FUNNEL_KEYS.map((key, index) => {
    const count = ranks.filter((item) => item.rank >= index).length;
    const next = ranks.filter((item) => item.rank >= index + 1).length;
    const here = ranks.filter((item) => item.rank === index).map((item) => item.company);
    const lost = here.filter((company) => company.outcomeStatus === 'LOST');
    const reasons = new Map<string, number>();
    for (const company of lost) {
      if (company.lostReasonCode) {
        reasons.set(company.lostReasonCode, (reasons.get(company.lostReasonCode) ?? 0) + 1);
      }
    }
    const hold = here.filter((company) => company.outcomeStatus === 'ON_HOLD').length;
    return {
      key,
      count,
      pass: index < FUNNEL_KEYS.length - 1 && count > 0 ? next / count : null,
      stopped:
        index < FUNNEL_KEYS.length - 1
          ? {
              lost: lost.length,
              reasons: [...reasons.entries()]
                .map(([code, n]) => ({ code, count: n }))
                .sort((a, b) => b.count - a.count),
              hold,
              open: here.length - lost.length - hold,
            }
          : { lost: 0, reasons: [], hold: 0, open: 0 },
    };
  });
}

export function SalesFunnel({
  companies,
  minSample,
}: {
  companies: CompanyAnalysisRow[];
  minSample: number;
}) {
  const stages = funnelStages(companies);
  const top = Math.max(stages[0].count, 1);
  return (
    <ChartCard id="chart-funnel" title={texts.funnelTitle}>
      {stages[0].count === 0 ? (
        <p style={{ margin: 0, ...secondary }}>{texts.chartEmpty}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {stages.map((stage) => {
            const { lost, reasons, hold, open } = stage.stopped;
            const stoppedCount = lost + hold + open;
            const reasonText = reasons
              .map((item) => `${labelFor(lostReasonLabels, item.code)} ${item.count}`)
              .join(' · ');
            const parts = [
              lost > 0 ? texts.funnelLost(lost, reasonText) : null,
              hold > 0 ? texts.funnelHold(hold) : null,
              open > 0 ? texts.funnelOpen(open) : null,
            ].filter(Boolean);
            return (
              <li
                key={stage.key}
                data-testid="chart-funnel-stage"
                style={{ display: 'grid', gap: 4 }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '84px minmax(0, 1fr) 56px',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{texts.funnelStages[stage.key]}</span>
                  <div
                    aria-hidden="true"
                    style={{ height: 22, borderRadius: radius.sm, background: chartPalette.track }}
                  >
                    <div
                      style={{
                        width: `${Math.max((stage.count / top) * 100, stage.count > 0 ? 2 : 0)}%`,
                        height: '100%',
                        borderRadius: radius.sm,
                        background: stage.key === 'WON' ? ORANGE : BLUE,
                      }}
                    />
                  </div>
                  <strong data-testid="chart-funnel-count" style={{ textAlign: 'right' }}>
                    {stage.count}
                    {texts.unitCompany}
                  </strong>
                </div>
                {stage.pass !== null ? (
                  <p
                    data-testid="chart-funnel-gap"
                    style={{ margin: '0 0 6px 96px', ...secondary }}
                  >
                    {'↓ '}
                    {stage.count >= minSample
                      ? texts.funnelPass(percent(stage.pass))
                      : texts.funnelSmall}
                    {stoppedCount > 0
                      ? ` · ${texts.funnelStopped(stoppedCount)}${parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}`
                      : ''}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p style={{ margin: 0, ...secondary }}>{texts.funnelNote}</p>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// ③ 어느 조합에서 잘 되나: 공정(줄) × 산업(칸)
// ---------------------------------------------------------------------------

/** 칸 이름(산업)을 공정 줄에 나온 순서대로 한 번씩. */
export function gridIndustries(rows: SalesAnalysis['byProcess']): string[] {
  const names: string[] = [];
  for (const row of rows) {
    for (const item of row.byIndustry) {
      if (!names.includes(item.industry)) names.push(item.industry);
    }
  }
  return names;
}

export function ProcessIndustryGrid({
  rows,
  minSample,
}: {
  rows: SalesAnalysis['byProcess'];
  minSample: number;
}) {
  const industries = gridIndustries(rows);
  const most = Math.max(
    1,
    ...rows.flatMap((row) => row.byIndustry.map((item) => item.contactedCount)),
  );
  const cellStyle = {
    padding: '8px 6px',
    borderBottom: `1px solid ${colors.borderSecondary}`,
    textAlign: 'left' as const,
    verticalAlign: 'middle' as const,
    whiteSpace: 'nowrap' as const,
  };
  // 공정·산업 이름은 길면 꺾고(좁은 폭에서 칸이 옆으로 넘치지 않게), 숫자 칸은 꺾지 않는다.
  const headStyle = { whiteSpace: 'normal' as const, minWidth: 64, maxWidth: 120 };
  return (
    <ChartCard id="chart-grid" title={texts.gridTitle}>
      {rows.length === 0 || industries.length === 0 ? (
        <p style={{ margin: 0, ...secondary }}>{texts.chartEmpty}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              fontSize: typography.fontSizeSecondary,
            }}
          >
            <thead>
              <tr>
                <th scope="col" style={{ ...cellStyle, ...secondary, fontWeight: 400 }}>
                  {texts.gridCorner}
                </th>
                {industries.map((name) => (
                  <th key={name} scope="col" style={{ ...cellStyle, ...headStyle }}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.processCode ?? 'none'}>
                  <th scope="row" style={{ ...cellStyle, ...headStyle }}>
                    {row.processName}
                  </th>
                  {industries.map((name) => {
                    const item = row.byIndustry.find((entry) => entry.industry === name);
                    if (!item || item.contactedCount === 0) {
                      return (
                        <td key={name} style={{ ...cellStyle, ...secondary }}>
                          -
                        </td>
                      );
                    }
                    const small = item.contactedCount < minSample;
                    const size = 8 + Math.round((item.contactedCount / most) * 14);
                    return (
                      <td
                        key={name}
                        data-testid="chart-grid-cell"
                        data-small={small ? 'true' : 'false'}
                        title={texts.gridTip(
                          row.processName,
                          name,
                          item.contactedCount,
                          item.wonCount,
                        )}
                        style={{ ...cellStyle, background: small ? colors.bgLayout : undefined }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: size,
                              height: size,
                              borderRadius: '50%',
                              flex: 'none',
                              background: small ? colors.border : AQUA,
                            }}
                          />
                          <span style={{ display: 'grid' }}>
                            <strong>{texts.gridContacted(item.contactedCount)}</strong>
                            <span style={secondary}>
                              {texts.gridWon(item.wonCount)}
                              {!small && item.ratios
                                ? ` · ${texts.gridRate(percent(item.ratios.won))}`
                                : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: 0, ...secondary }}>{texts.gridNote(minSample)}</p>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// ④ 회사별로 어디서 멈췄나: 같은 날짜 축 위에 회사마다 기록 점 줄
// ---------------------------------------------------------------------------

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const monthDay = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}/${d}`;
};

interface Dot {
  at: string;
  method: string | null;
  result: string | null;
  /** 이 행에서 처음 이른 깔때기 칸이면 그 세부 단계(단계가 올라간 날 표시). */
  stepUp: string | null;
}

/** 회사 한 곳의 점: 접촉 행과 단계가 처음 올라간 행. 행 줄이 없는 옛 응답이면 첫·마지막 접촉 두 점. */
export function timelineDots(company: CompanyAnalysisRow): Dot[] {
  if (!company.timeline) {
    const first = { at: company.firstContactAt, method: null, result: null, stepUp: null };
    return company.lastContactAt === company.firstContactAt
      ? [first]
      : [first, { at: company.lastContactAt, method: null, result: null, stepUp: null }];
  }
  let best = 0;
  const dots: Dot[] = [];
  for (const event of company.timeline) {
    const rank = event.stepAfter ? (STEP_RANK[event.stepAfter] ?? 0) : 0;
    const stepUp = rank > best && event.stepAfter ? event.stepAfter : null;
    best = Math.max(best, rank);
    if (event.method || stepUp) {
      dots.push({ at: event.at, method: event.method, result: event.result, stepUp });
    }
  }
  return dots;
}

/** 줄 끝 글: 끝난 회사는 "성사"·"거절 · 가격"·"보류", 진행 중이면 "▶ 지금 세부 단계". */
export function timelineEnd(company: CompanyAnalysisRow): string {
  if (company.outcomeStatus === 'LOST') {
    return company.lostReasonCode
      ? `${outcomeStatusLabels.LOST} · ${labelFor(lostReasonLabels, company.lostReasonCode)}`
      : outcomeStatusLabels.LOST;
  }
  if (company.outcomeStatus === 'WON' || company.outcomeStatus === 'ON_HOLD') {
    return labelFor(outcomeStatusLabels, company.outcomeStatus);
  }
  return company.salesStep
    ? `▶ ${labelFor(salesStepLabels, company.salesStep)}`
    : `▶ ${labelFor(outcomeStatusLabels, company.outcomeStatus)}`;
}

const TIMELINE_ROWS = 12;

export function CompanyTimeline({
  companies,
  periodFrom,
}: {
  companies: CompanyAnalysisRow[];
  periodFrom: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = companies.map((company) => ({ company, dots: timelineDots(company) }));
  const shown = showAll ? rows : rows.slice(0, TIMELINE_ROWS);
  // 날짜 축은 보이는 줄의 점으로 정한다(접힌 줄의 오래된 기록 때문에 점이 한쪽에 몰리지 않게).
  const days = shown.flatMap((row) => row.dots.map((dot) => dayNumber(dot.at)));
  const start = days.length > 0 ? Math.min(...days) : 0;
  const end = days.length > 0 ? Math.max(...days) : 0;
  const span = Math.max(end - start, 1);
  const x = (iso: string) => ((dayNumber(iso) - start) / span) * 100;
  const fromDay = periodFrom ? dayNumber(periodFrom) : null;
  // 축 눈금: 범위 안의 달 첫날(너무 많으면 건너뜀).
  const ticks: { iso: string; label: string }[] = [];
  if (days.length > 0) {
    const first = new Date(start * 86_400_000);
    let y = first.getUTCFullYear();
    let m = first.getUTCMonth() + 1;
    for (;;) {
      const iso = `${y}-${String(m).padStart(2, '0')}-01`;
      if (dayNumber(iso) > end) break;
      if (dayNumber(iso) >= start) ticks.push({ iso, label: `${m}월` });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  const stepEvery = Math.max(1, Math.ceil(ticks.length / 6));
  // 좁은 폭에서도 점 줄이 120px 아래로 줄지 않게 이름·끝 칸이 먼저 준다.
  const columns = 'minmax(72px, 120px) minmax(120px, 1fr) minmax(96px, 150px)';
  const hasBefore =
    fromDay !== null && shown.some((row) => row.dots.some((dot) => dayNumber(dot.at) < fromDay));
  return (
    <ChartCard
      id="chart-timeline"
      title={texts.timelineTitle}
      legend={
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            ...secondary,
          }}
        >
          <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={dotStyle(true, false)} />
            {texts.timelineReached}
          </li>
          <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={dotStyle(false, false)} />
            {texts.timelineNotReached}
          </li>
          <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={dotStyle(true, true)} />
            {texts.timelineStep}
          </li>
        </ul>
      }
    >
      {rows.length === 0 ? (
        <p style={{ margin: 0, ...secondary }}>{texts.chartEmpty}</p>
      ) : (
        <div style={{ display: 'grid', gap: 2 }}>
          <div
            aria-hidden="true"
            style={{ display: 'grid', gridTemplateColumns: columns, gap: 12 }}
          >
            <span />
            <div style={{ position: 'relative', height: 18, ...secondary }}>
              {ticks
                .filter((_, index) => index % stepEvery === 0)
                .map((tick) => (
                  <span
                    key={tick.iso}
                    style={{
                      position: 'absolute',
                      left: `${x(tick.iso)}%`,
                      transform: 'translateX(-50%)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tick.label}
                  </span>
                ))}
            </div>
            <span />
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {shown.map(({ company, dots }) => (
              <li
                key={company.oppId}
                data-testid="chart-timeline-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: columns,
                  gap: 12,
                  alignItems: 'center',
                  minHeight: 30,
                }}
              >
                <span
                  title={company.name}
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {company.name}
                </span>
                <div style={{ position: 'relative', height: 22 }}>
                  {dots.length > 1 ? (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: 10,
                        height: 2,
                        left: `${x(dots[0].at)}%`,
                        width: `${x(dots[dots.length - 1].at) - x(dots[0].at)}%`,
                        background: chartPalette.grid,
                      }}
                    />
                  ) : null}
                  {dots.map((dot, index) => {
                    const methodText = dot.method
                      ? labelFor(contactMethodLabels, dot.method)
                      : null;
                    const resultText = dot.result
                      ? labelFor(contactResultLabels, dot.result)
                      : null;
                    const stepText = dot.stepUp ? labelFor(salesStepLabels, dot.stepUp) : null;
                    const faded = fromDay !== null && dayNumber(dot.at) < fromDay;
                    return (
                      <span
                        key={index}
                        data-testid="chart-timeline-dot"
                        title={texts.timelineTip(
                          monthDay(dot.at),
                          methodText,
                          resultText,
                          stepText,
                        )}
                        style={{
                          ...dotStyle(dot.result === 'REACHED' || !dot.method, Boolean(dot.stepUp)),
                          position: 'absolute',
                          top: 11,
                          left: `${x(dot.at)}%`,
                          transform: dot.stepUp
                            ? 'translate(-50%, -50%) rotate(45deg)'
                            : 'translate(-50%, -50%)',
                          opacity: faded ? 0.35 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                <span
                  data-testid="chart-timeline-end"
                  style={{ fontSize: typography.fontSizeSecondary }}
                >
                  {timelineEnd(company)}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > TIMELINE_ROWS ? (
            <button
              type="button"
              data-testid="chart-timeline-more"
              onClick={() => setShowAll((value) => !value)}
              style={{
                justifySelf: 'start',
                marginTop: 6,
                background: 'none',
                border: 'none',
                padding: 0,
                color: BLUE,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {showAll ? texts.timelineLess : texts.timelineMore(rows.length)}
            </button>
          ) : null}
          {hasBefore ? (
            <p style={{ margin: '6px 0 0', ...secondary }}>{texts.timelineBefore}</p>
          ) : null}
        </div>
      )}
    </ChartCard>
  );
}

/** 점 모양: 연결은 칠한 원, 연결 안 됨은 빈 원, 단계가 올라간 날은 칠한 마름모. */
function dotStyle(filled: boolean, step: boolean) {
  const size = step ? 11 : 12;
  return {
    display: 'inline-block',
    width: size,
    height: size,
    boxSizing: 'border-box' as const,
    borderRadius: step ? radius.sm : '50%',
    border: `2px solid ${step ? ORANGE : BLUE}`,
    background: filled ? (step ? ORANGE : BLUE) : colors.bgContainer,
    flex: 'none',
  };
}

/** 네 그림 묶음. 아래 [표로 보기]는 화면이 따로 그린다. */
export default function AnalysisCharts({ data }: { data: SalesAnalysis }) {
  const minSample = data.basis.minSampleForRatio;
  return (
    <div data-testid="analysis-charts" style={{ display: 'grid', gap: 16 }}>
      {/* 넓으면 깔때기 2 : 거절 이유 1(빠진 곳의 이유를 옆에서 본다), 좁으면 아래로 쌓인다. */}
      <div data-testid="analysis-bar-cards" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: '2 1 460px', minWidth: 0, display: 'grid' }}>
          <SalesFunnel companies={data.companies} minSample={minSample} />
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid' }}>
          <LostReasonBars total={data.total} />
        </div>
      </div>
      <ProcessIndustryGrid rows={data.byProcess} minSample={minSample} />
      <CompanyTimeline companies={data.companies} periodFrom={data.basis.from ?? null} />
    </div>
  );
}
