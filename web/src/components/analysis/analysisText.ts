// 영업 분석표(#608)의 칸 글자를 만드는 순수 함수. 숫자는 서버가 계산한 값 그대로이고 여기서는 쉬운 말로만 바꾼다.
// 표본이 설정 기준보다 적으면(서버가 ratios를 null로 줌) 비율을 지어내지 않고 "표본 n건"만 보인다.
import type {
  AnalysisStats,
  CompanyAnalysisRow,
  ContactMethodCode,
  ProposalHit,
  StepAnalysisRow,
} from '../../api/salesAnalysis';
import {
  contactMethodLabels,
  labelFor,
  lostReasonLabels,
  outcomeStatusLabels,
  salesAnalysisTexts as texts,
  salesStepLabels,
} from '../../labels/ko';
import { formatMonthDay } from '../../utils/time';

const METHODS: ContactMethodCode[] = ['CALL', 'EMAIL', 'VISIT'];
const percent = (ratio: number) => Math.round(ratio * 100);

/** "전화 2/3 · 방문 1/1" — 시도가 없는 방법은 빼고, 하나도 없으면 "—". */
export function reachText(stats: Pick<AnalysisStats, 'contactReach'>): string {
  const parts = METHODS.filter((method) => stats.contactReach[method].tried > 0).map((method) =>
    texts.reach(
      contactMethodLabels[method],
      stats.contactReach[method].reached,
      stats.contactReach[method].tried,
    ),
  );
  return parts.length > 0 ? parts.join(' · ') : texts.none;
}

/** "기존 거래처 유지 5 · 가격 2" — 거절 이유가 없으면 "—". */
export function lostReasonsText(stats: AnalysisStats): string {
  if (stats.lostReasons.length === 0) return texts.none;
  return stats.lostReasons
    .map((item) => texts.reasonCount(labelFor(lostReasonLabels, item.code), item.count))
    .join(' · ');
}

/** 표본이 적으면 "표본 3건", 충분하면 "성사 33% · 전화 연결 67%". */
export function ratioText(stats: AnalysisStats): string {
  const { ratios } = stats;
  if (!ratios) return texts.sampleOnly(stats.contactedCount);
  const reach = METHODS.flatMap((method) => {
    const ratio = ratios.reach[method];
    return ratio === null ? [] : [texts.reachRatio(contactMethodLabels[method], percent(ratio))];
  });
  return [texts.wonRatio(percent(ratios.won)), ...reach].join(' · ');
}

/** (#684) "평균 3.5번 (6곳)" — 표본이 적으면 평균 없이 "2곳 · 모두 7번", 이른 회사가 없으면 "—". */
export function stepToReachText(row: StepAnalysisRow): string {
  if (row.reachedCount === 0) return texts.none;
  return row.avgContactsToReach === null
    ? texts.stepToReachSum(row.reachedCount, row.contactsToReach)
    : texts.stepToReachAvg(row.avgContactsToReach, row.reachedCount);
}

/** (#684) "3곳 · 접촉 8번" — 그 단계에 머무는 동안 접촉이 없으면 "—". */
export function stepContactsText(row: StepAnalysisRow): string {
  if (row.contactCount === 0) return texts.none;
  return texts.stepContacts(row.contactedCount, row.contactCount);
}

/** (#684) 표본이 적으면 "표본 3건", 충분하면 "전화 연결 67% · 메일 연결 100%". */
export function stepRatioText(row: StepAnalysisRow): string {
  if (row.contactCount === 0) return texts.none;
  const ratios = row.reachRatios;
  if (!ratios) return texts.sampleOnly(row.contactedCount);
  const parts = METHODS.flatMap((method) => {
    const ratio = ratios[method];
    return ratio === null ? [] : [texts.reachRatio(contactMethodLabels[method], percent(ratio))];
  });
  return parts.length > 0 ? parts.join(' · ') : texts.none;
}

/** (#678) "AI 제안 적중 — 공정 12/15 (80%) (…)" — 표본이 적으면 비율 없이 건수만, 확정한 회사가 없으면 null. */
export function proposalHitText(process: ProposalHit): string | null {
  if (process.confirmedCount <= 0) return null;
  const count = texts.hitCount(texts.hitProcess, process.hitCount, process.confirmedCount);
  const part = process.ratio === null ? count : texts.hitWithRatio(count, percent(process.ratio));
  return texts.hitLine(part);
}

export function avgToWonText(stats: AnalysisStats): string {
  return stats.avgContactsToWon === null ? texts.none : texts.times(stats.avgContactsToWon);
}

/** "전화 3 · 방문 1" — 0번인 방법은 뺀다. */
export function contactsText(row: CompanyAnalysisRow): string {
  const counts: [ContactMethodCode, number][] = [
    ['CALL', row.contactCount.call],
    ['EMAIL', row.contactCount.email],
    ['VISIT', row.contactCount.visit],
  ];
  return counts
    .filter(([, count]) => count > 0)
    .map(([method, count]) => texts.methodCount(contactMethodLabels[method], count))
    .join(' · ');
}

/** "접촉 · 수요 확인" / "거절 · 가격" / "성사". */
export function stageText(row: CompanyAnalysisRow): string {
  const stage = labelFor(outcomeStatusLabels, row.outcomeStatus);
  if (row.salesStep) return texts.stageWithDetail(stage, labelFor(salesStepLabels, row.salesStep));
  if (row.lostReasonCode) {
    return texts.stageWithDetail(stage, labelFor(lostReasonLabels, row.lostReasonCode));
  }
  return stage;
}

/** 성사·거절이면 "첫 접촉 뒤 21일 만에 성사 (11/10)", 아직 진행 중이면 "—". */
export function outcomeText(row: CompanyAnalysisRow): string {
  if (row.daysToOutcome === null) return texts.none;
  return texts.outcomeAfter(
    row.daysToOutcome,
    labelFor(outcomeStatusLabels, row.outcomeStatus),
    formatMonthDay(row.outcomeAt),
  );
}
