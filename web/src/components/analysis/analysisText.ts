// 영업 분석표(#608)의 칸 글자를 만드는 순수 함수. 숫자는 서버가 계산한 값 그대로이고 여기서는 쉬운 말로만 바꾼다.
// 표본이 설정 기준보다 적으면(서버가 ratios를 null로 줌) 비율을 지어내지 않고 "표본 n건"만 보인다.
import type { AnalysisStats, CompanyAnalysisRow, ContactMethodCode } from '../../api/salesAnalysis';
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
export function reachText(stats: AnalysisStats): string {
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
