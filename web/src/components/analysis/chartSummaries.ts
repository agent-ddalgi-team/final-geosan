// 그림 아래 요약 문장과 말풍선 값(#898). 그림이 그리는 값과 같은 값을 세기만 하고 새 숫자를 지어내지 않는다.
// 표본이 기준(minSampleForRatio)보다 적으면 비율을 말하지 않는다. AI를 쓰지 않는다.
import type {
  AnalysisStats,
  CompanyAnalysisRow,
  MonthTrendRow,
  SalesAnalysis,
} from '../../api/salesAnalysis';
import type { DashboardBreakdown } from '../../api/dashboardTypes';
import {
  analysisCharts,
  chartSummaryTexts as t,
  labelFor,
  lostReasonLabels,
  monthlyTrendTexts,
  salesStepLabels,
} from '../../labels/ko';
import type { ChartCallout } from '../common/ChartFrame';
import type { FunnelStage } from './AnalysisCharts';

export interface ChartReading {
  summary: string;
  callout: ChartCallout | null;
}

const unit = analysisCharts.unitCompany;
const percent = (ratio: number) => Math.round(ratio * 100);

/** 깔때기: 어디까지 갔나 + 가장 많이 멈춘 단계(그 단계의 넘어간 비율은 표본이 될 때만). */
export function funnelReading(stages: FunnelStage[], minSample: number): ChartReading | null {
  const contacted = stages[0]?.count ?? 0;
  if (contacted === 0) return null;
  const parts: string[] = [];
  // 접촉 다음 칸부터, 회사가 있는 가장 먼 칸(성사 칸은 따로 말한다).
  const deepest = [...stages.slice(1, -1)].reverse().find((stage) => stage.count > 0);
  parts.push(
    deepest
      ? t.funnelReached(contacted, analysisCharts.funnelStages[deepest.key], deepest.count)
      : t.funnelNoneReached(contacted),
  );
  const won = stages[stages.length - 1]?.count ?? 0;
  parts.push(won > 0 ? t.funnelWon(won) : t.funnelNoWon);
  let callout: ChartCallout | null = null;
  const stoppedOf = (stage: FunnelStage) =>
    stage.stopped.lost + stage.stopped.hold + stage.stopped.open;
  const most = stages
    .slice(0, -1)
    .reduce<FunnelStage | null>(
      (best, stage) => (stoppedOf(stage) > (best ? stoppedOf(best) : 0) ? stage : best),
      null,
    );
  if (most) {
    const name = analysisCharts.funnelStages[most.key];
    parts.push(t.funnelMostStopped(name, stoppedOf(most)));
    if (most.pass !== null && most.count >= minSample) {
      parts.push(t.funnelPassRate(percent(most.pass)));
    } else if (contacted < minSample) {
      parts.push(t.smallSample(minSample));
    }
    callout = { value: `${stoppedOf(most)}${unit}`, label: t.funnelCalloutLabel(name) };
  }
  return { summary: parts.join(' '), callout };
}

/** 거절 이유: 가장 많은 이유 하나. */
export function lostReading(total: AnalysisStats): ChartReading | null {
  const sum = total.lostReasons.reduce((acc, item) => acc + item.count, 0);
  // 빈 그림은 판 안 "아직 셀 기록이 없습니다"로 충분하다(같은 말을 두 번 하지 않는다).
  if (sum === 0) return null;
  const top = total.lostReasons.reduce((best, item) => (item.count > best.count ? item : best));
  const reason = labelFor(lostReasonLabels, top.code);
  return {
    summary: t.lostTop(sum, reason, top.count),
    callout: { value: `${top.count}${unit}`, label: reason },
  };
}

/** 공정 × 산업 칸: 가장 많이 접촉한 조합 + 성사가 가장 많은 조합. */
export function gridReading(
  rows: SalesAnalysis['byProcess'],
  minSample: number,
): ChartReading | null {
  const cells = rows.flatMap((row) =>
    row.byIndustry
      .filter((item) => item.contactedCount > 0)
      .map((item) => ({
        process: row.processName,
        industry: item.industry,
        // "공정 확인 전"·"산업 확인 전" 칸은 고른 조합이 아니므로, 확인된 조합이 있으면 그쪽을 말한다.
        confirmed: row.processCode !== null && item.industry !== t.unconfirmedIndustry,
        contacted: item.contactedCount,
        won: item.wonCount,
      })),
  );
  if (cells.length === 0) return null;
  const confirmed = cells.filter((cell) => cell.confirmed);
  const pool = confirmed.length > 0 ? confirmed : cells;
  const most = pool.reduce((best, cell) => (cell.contacted > best.contacted ? cell : best));
  // 같은 수의 조합이 여럿이면 하나를 "가장 많다"고 하지 않고 몇 개가 같은지 말한다.
  const ties = pool.filter((cell) => cell.contacted === most.contacted).length;
  const parts = [
    ties > 1
      ? t.gridTie(most.contacted, ties, most.process, most.industry)
      : t.gridMost(most.process, most.industry, most.contacted),
  ];
  const wonCells = pool.filter((cell) => cell.won > 0);
  if (wonCells.length > 0) {
    const best = wonCells.reduce((a, b) => (b.won > a.won ? b : a));
    parts.push(t.gridWon(best.process, best.industry, best.won));
  } else {
    parts.push(t.gridNoWon);
  }
  if (cells.every((cell) => cell.contacted < minSample)) parts.push(t.gridAllSmall(minSample));
  return {
    summary: parts.join(' '),
    callout: {
      value: `${most.contacted}${unit}`,
      label:
        ties > 1 ? t.gridTieCalloutLabel(ties) : t.gridCalloutLabel(most.process, most.industry),
    },
  };
}

/** 아직 끝나지 않은(성사·거절·보류가 아닌) 회사. */
function openCompanies(companies: CompanyAnalysisRow[]): CompanyAnalysisRow[] {
  return companies.filter((company) => !['WON', 'LOST', 'ON_HOLD'].includes(company.outcomeStatus));
}

/** 진행 중인 회사가 가장 많이 머문 세부 단계(같은 수면 먼저 나온 단계). 진행 중이 없거나 단계가 없으면 null. */
export function topOpenStep(
  companies: CompanyAnalysisRow[],
): { step: string; count: number } | null {
  const steps = new Map<string, number>();
  for (const company of openCompanies(companies)) {
    if (company.salesStep) steps.set(company.salesStep, (steps.get(company.salesStep) ?? 0) + 1);
  }
  const top = [...steps.entries()].reduce<[string, number] | null>(
    (best, entry) => (!best || entry[1] > best[1] ? entry : best),
    null,
  );
  return top ? { step: top[0], count: top[1] } : null;
}

/** 회사별 타임라인: 끝난 상태별 수 + 진행 중 회사가 가장 많이 머문 세부 단계. */
export function timelineReading(companies: CompanyAnalysisRow[]): ChartReading | null {
  if (companies.length === 0) return null;
  const count = (status: string) =>
    companies.filter((company) => company.outcomeStatus === status).length;
  const won = count('WON');
  const lost = count('LOST');
  const hold = count('ON_HOLD');
  const open = openCompanies(companies);
  const parts = [t.timelineStatus(companies.length, open.length, won, lost, hold)];
  const top = topOpenStep(companies);
  if (top) parts.push(t.timelineOpenStep(labelFor(salesStepLabels, top.step), top.count));
  return {
    summary: parts.join(' '),
    callout: { value: `${open.length}${unit}`, label: t.timelineCalloutLabel },
  };
}

/** 월별 추세: 이번 달 접촉과 지난달 차이 + 가장 많았던 달 + 12개월 성사·거절. */
export function monthlyReading(rows: MonthTrendRow[]): ChartReading | null {
  if (rows.length === 0) return null;
  const busiest = rows.reduce((best, row) => (row.contacted > best.contacted ? row : best));
  if (busiest.contacted === 0 && rows.every((row) => row.won === 0 && row.lost === 0)) return null;
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const diff = prev ? last.contacted - prev.contacted : 0;
  const month = monthlyTrendTexts.monthLabel(last.month);
  const parts = [t.monthChange(month, last.contacted, diff)];
  if (busiest.contacted > 0 && busiest.month !== last.month) {
    parts.push(t.monthPeak(monthlyTrendTexts.monthLabel(busiest.month), busiest.contacted));
  }
  const won = rows.reduce((acc, row) => acc + row.won, 0);
  const lost = rows.reduce((acc, row) => acc + row.lost, 0);
  parts.push(t.monthTotals(won, lost));
  return {
    summary: parts.join(' '),
    callout: { value: `${last.contacted}${unit}`, label: t.monthCalloutLabel(month, diff) },
  };
}

/** 관심 기업 분포: 가장 많은 공정과 산업군. */
export function breakdownReading(breakdown: DashboardBreakdown): ChartReading | null {
  const topOf = <T extends { count: number }>(rows: T[]) =>
    rows.length === 0 ? null : rows.reduce((best, row) => (row.count > best.count ? row : best));
  const process = topOf(breakdown.byProcess);
  if (!process) return null;
  const industry = topOf(breakdown.byIndustry);
  const parts = [
    industry
      ? t.breakdownTop(
          process.processName,
          process.count,
          percent(process.ratio),
          industry.industry,
          industry.count,
        )
      : t.breakdownProcessOnly(process.processName, process.count, percent(process.ratio)),
  ];
  if (breakdown.byProcess.length > 1) parts.push(t.breakdownSpread(breakdown.byProcess.length));
  return {
    summary: parts.join(' '),
    callout: { value: `${percent(process.ratio)}%`, label: process.processName },
  };
}
