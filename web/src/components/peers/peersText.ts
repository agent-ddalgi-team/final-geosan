// 비슷한 회사 참고(#269)의 문장 만들기. 서버가 준 코드를 쉬운 말로 바꾸고, 0건 묶음은 줄에서 뺀다.
import type { ContactMethod, PeerCompany, PeersSummary } from '../../api/types';
import {
  contactMethodLabels,
  labelFor,
  lostReasonLabels,
  outcomeStatusLabels,
  peersArea,
} from '../../labels/ko';
import { formatMonthDayTime } from '../../utils/time';

/** 요약 줄에서 단계를 보이는 순서(영업이 앞선 쪽이 뒤로 가는 흐름 그대로). 모르는 단계는 맨 뒤에 붙인다. */
const STAGE_ORDER = [
  'NOT_EXECUTED',
  'IN_PROGRESS',
  'SAMPLE_OR_REGISTRATION_APPROVED',
  'ON_HOLD',
  'WON',
  'LOST',
] as const;

const REACH_ORDER: ContactMethod[] = ['CALL', 'EMAIL', 'VISIT'];

/**
 * 요약 줄. 예: "같은 공정 4곳 · 산업군 2곳 | 접촉 1 · 거절 1(가격) | 전화 연결 3/5".
 * 건수가 0인 묶음은 빼고, 보일 것이 하나도 없으면 빈 글을 준다.
 */
export function peersSummaryText(summary: PeersSummary): string {
  const groups: string[] = [];
  if (summary.processCount > 0 || summary.industryCount > 0) {
    groups.push(peersArea.summaryCounts(summary.processCount, summary.industryCount));
  }

  const known = STAGE_ORDER.filter((code) => (summary.stageCounts[code] ?? 0) > 0);
  const unknown = Object.keys(summary.stageCounts).filter(
    (code) => !(STAGE_ORDER as readonly string[]).includes(code) && summary.stageCounts[code] > 0,
  );
  const stageParts = [...known, ...unknown].map((code) => {
    const count = summary.stageCounts[code];
    const label = labelFor(outcomeStatusLabels, code);
    if (code !== 'LOST' || summary.topLostReasons.length === 0) {
      return peersArea.stageCount(label, count);
    }
    // 이유가 하나뿐이고 그 건수가 거절 전체와 같으면 "거절 1(가격)"처럼 숫자를 생략한다. 아니면 이유마다 건수를 붙인다.
    const only = summary.topLostReasons.length === 1 ? summary.topLostReasons[0] : null;
    const reasons =
      only && only.count === count
        ? labelFor(lostReasonLabels, only.code)
        : summary.topLostReasons
            .map((item) => peersArea.reasonCount(labelFor(lostReasonLabels, item.code), item.count))
            .join(' · ');
    return peersArea.stageCount(label, count, reasons);
  });
  if (stageParts.length > 0) groups.push(stageParts.join(' · '));

  const reachParts = REACH_ORDER.flatMap((method) => {
    const reach = summary.contactReach[method];
    if (!reach || reach.tried <= 0) return [];
    return [peersArea.reachCount(contactMethodLabels[method], reach.reached, reach.tried)];
  });
  if (reachParts.length > 0) groups.push(reachParts.join(' · '));

  return groups.join(peersArea.summaryDivider);
}

/** 영업 단계 글. 기록이 없으면 "영업 기록 없음", 거절이면 "거절 · 가격". */
export function peerStageText(company: PeerCompany): string {
  if (!company.outcomeStatus) return peersArea.noStage;
  const stage = labelFor(outcomeStatusLabels, company.outcomeStatus);
  if (company.outcomeStatus === 'LOST' && company.lostReasonCode) {
    return peersArea.lostWithReason(stage, labelFor(lostReasonLabels, company.lostReasonCode));
  }
  return stage;
}

/** 마지막 접촉 "11/06 전화". 접촉이 없으면 null. */
export function peerLastContactText(company: PeerCompany): string | null {
  const date = formatMonthDayTime(company.lastContactAt)?.slice(0, 5);
  if (!date) return null;
  const method = company.lastContactMethod ? contactMethodLabels[company.lastContactMethod] : '';
  return peersArea.lastContact(date, method ?? '');
}

/** 메모 한 줄은 120자에서 자르고 "…"를 붙인다(서버가 이미 잘랐어도 한 번 더 지킨다). */
export function truncateNote(text: string, max: number = peersArea.noteMaxLength): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
