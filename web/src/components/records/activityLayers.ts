// 활동 이력 3층(#849, PM 결정 2026-11-17): 흐름 줄 · 내용 카드 · AI 피드백.
// 저장은 그대로이고 화면에서만 나눈다. 서버가 영업 기록 줄에 단계·방법·결과·다음 일정을, 메모 줄에 저장 종류를
// 따로 실어 준다(더한 칸). 그 값이 없는 옛 응답·다른 줄은 지금처럼 글(summary) 그대로 보인다.
//  - 흐름(FLOW)    단계나 다음 일정이 앞 기록과 달라진 영업 기록. "접촉 → 견적·샘플 · 다음 일정 11/18 방문"
//  - 접촉(CONTACT) 전화·메일·방문 기록. 카드 제목 "전화 연결됨", 본문은 그때 쓴 한 줄 메모
//  - 메모(MEMO)    메모·자료 조사·답 기록·전달 사항
//  - AI 피드백(AI) 남긴 피드백·다음 통화 준비. 같은 저장 묶음의 접촉 카드 안에 접혀 들어간다
//  - 확인한 사실·의견(FACT) 거래 관계·근거 등급·변경 기록·의견·분류·승인·관심
// 기록 취소 줄은 어느 층에도 넣지 않고 "전체"에서만 보인다(누가 언제 취소했는지가 기록).
import type { ActivityItem, OutcomeStatus } from '../../api/types';

export const TIMELINE_LAYERS = ['FLOW', 'CONTACT', 'MEMO', 'AI', 'FACT'] as const;
export type TimelineLayer = (typeof TIMELINE_LAYERS)[number];

const FACT_KINDS = new Set<string>([
  'RELATION_CONFIRMED',
  'EVIDENCE_GRADE_CONFIRMED',
  'CHANGE',
  'OPINION',
  'CLASSIFICATION',
  'APPROVAL',
  'BOOKMARK',
]);

/** 줄의 층. 기록 취소 줄과 서버가 모르는 종류는 null(전체에서만 보임). */
export function layerOf(item: ActivityItem): TimelineLayer | null {
  if (item.kind === 'CONTACT_ATTEMPT') return 'CONTACT';
  if (item.kind === 'OUTCOME') return 'FLOW';
  if (item.kind === 'NOTE' || item.kind === 'REPLY') return 'MEMO';
  if (item.kind === 'ADVICE') return 'AI';
  if (FACT_KINDS.has(item.kind)) return 'FACT';
  return null;
}

/** 서버가 단계 값을 따로 실어 준 영업 기록 줄인가(옛 응답이면 false → 글 그대로). */
export function isStructuredOutcome(item: ActivityItem): boolean {
  return item.recordKind === 'OUTCOME' && item.status != null;
}

/** 저장 종류가 실린 AI 피드백 줄인가(남긴 피드백·다음 통화 준비). */
export function isStructuredAdvice(item: ActivityItem): boolean {
  return item.kind === 'ADVICE' && (item.noteKind === 'ADVICE' || item.noteKind === 'CALL_PREP');
}

export interface FlowChange {
  /** 단계가 바뀌었으면 이전 단계, 다음 일정만 바뀌었으면 null. */
  from: OutcomeStatus | null;
  to: OutcomeStatus;
  schedule: string | null;
  scheduleNote: string | null;
}

/**
 * 영업 기록 줄 가운데 단계나 다음 일정이 바로 앞(접촉한 날 기준) 기록과 달라진 줄. items는 저장 최근 순이다.
 * 잘못 입력으로 표시된 줄은 흐름에서 빼고 건너뛴다(단계도 그 줄 전으로 되돌아갔다).
 * 처음 기록은 "미접촉"에서 시작한 것으로 본다.
 */
export function flowChanges(items: ActivityItem[]): Map<ActivityItem, FlowChange> {
  const changes = new Map<ActivityItem, FlowChange>();
  let previousStatus: OutcomeStatus = 'NOT_EXECUTED';
  let previousSchedule: string | null = null;
  // #849(PM 결정 2026-11-17): 흐름은 실제 접촉한 날 순서로 센다(같은 날이면 저장 순서).
  const chronological = [...items]
    .reverse()
    .map((item, index) => ({ item, index, day: displayDay(item) ?? '' }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.index - b.index))
    .map((entry) => entry.item);
  for (const item of chronological) {
    if (!isStructuredOutcome(item) || item.cancelled === true || item.status == null) continue;
    const schedule = item.nextScheduleAt ?? null;
    const statusChanged = item.status !== previousStatus;
    const scheduleChanged = schedule !== null && schedule !== previousSchedule;
    if (statusChanged || scheduleChanged) {
      changes.set(item, {
        from: statusChanged ? previousStatus : null,
        to: item.status,
        schedule,
        scheduleNote: item.nextScheduleNote ?? null,
      });
    }
    previousStatus = item.status;
    if (schedule !== null) previousSchedule = schedule;
  }
  return changes;
}

/** 고른 층에 보일 줄인가. 흐름을 고르면 단계·일정이 바뀐 접촉도 흐름 줄로만 보인다. */
export function inLayer(
  item: ActivityItem,
  layer: TimelineLayer | null,
  changes: Map<ActivityItem, FlowChange>,
): boolean {
  if (layer === null) return true;
  if (layer === 'FLOW' && item.kind === 'CONTACT_ATTEMPT') return changes.has(item);
  return layerOf(item) === layer;
}

/**
 * 한 묶음(같은 사람·같은 분) 안에서 접촉 카드를 먼저 놓고, AI 피드백은 그 묶음의 첫 접촉 카드 안에 넣는다.
 * 접촉 카드가 없거나 단계 값이 없는 옛 응답이면 AI 피드백은 따로 한 줄로 남는다(추측해서 다른 기록에 붙이지 않음).
 */
export function arrangeBlock(block: ActivityItem[]): {
  lines: ActivityItem[];
  nested: Map<ActivityItem, ActivityItem[]>;
} {
  const outcomes = block.filter(isStructuredOutcome);
  const rest = block.filter((item) => !isStructuredOutcome(item));
  const host = outcomes.find((item) => item.method != null);
  const nested = new Map<ActivityItem, ActivityItem[]>();
  const lines: ActivityItem[] = [...outcomes];
  for (const item of rest) {
    if (host && isStructuredAdvice(item)) {
      nested.set(host, [...(nested.get(host) ?? []), item]);
    } else {
      lines.push(item);
    }
  }
  return { lines, nested };
}

/** AI 피드백 글. 앞머리 없는 저장 글을 쓰고, 다음 통화 준비의 여러 줄은 " · "로 잇는다. */
export function adviceText(item: ActivityItem): string {
  const text = item.text ?? item.summary;
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ');
}

/** 한국 시각 기준 날짜 "YYYY-MM-DD". */
export function kstDay(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

/**
 * #849(PM 결정 2026-11-17) 날짜 구분선·정렬에 쓰는 날. 영업 기록 줄은 실제 접촉한 날(attemptedAt, 없으면 저장한 날),
 * 메모·AI 피드백·사실 줄은 저장한 날 그대로.
 */
export function displayDay(item: ActivityItem): string | null {
  if (isStructuredOutcome(item) && item.attemptedAt) return item.attemptedAt;
  return kstDay(item.at);
}

/**
 * 화면에 보일 순서와 묶음. items는 저장 최근 순(sortRecentFirst)이다.
 *  1) AI 피드백을 같은 저장 묶음(같은 사람·같은 분 저장)의 접촉 카드에 붙인다 — 저장 시각 기준 그대로.
 *  2) 남은 줄을 표시 날(displayDay) 최근 순으로 다시 늘어놓는다(같은 날이면 저장 순서 유지).
 *  3) 같은 날·같은 사람·같은 분 저장끼리 한 묶음으로 보인다.
 * 접촉 카드를 접촉한 날 아래로 옮겨도 그 카드에 붙은 AI 피드백은 카드 안에서 함께 간다.
 */
export function displayBlocks(
  items: ActivityItem[],
  sameMoment: (items: ActivityItem[]) => ActivityItem[][],
): { blocks: ActivityItem[][]; nested: Map<ActivityItem, ActivityItem[]> } {
  const nested = new Map<ActivityItem, ActivityItem[]>();
  const attached = new Set<ActivityItem>();
  for (const block of sameMoment(items)) {
    for (const [host, advices] of arrangeBlock(block).nested) {
      nested.set(host, advices);
      advices.forEach((advice) => attached.add(advice));
    }
  }
  const ordered = items
    .filter((item) => !attached.has(item))
    .map((item, index) => ({ item, index, day: displayDay(item) ?? '' }))
    .sort((a, b) => (a.day > b.day ? -1 : a.day < b.day ? 1 : a.index - b.index))
    .map((entry) => entry.item);
  const blocks: ActivityItem[][] = [];
  for (const block of sameMoment(ordered)) {
    // 같은 분에 저장했어도 접촉한 날이 다르면 다른 날 아래로 나눈다.
    let current: ActivityItem[] = [];
    for (const item of block) {
      if (current.length > 0 && displayDay(current[0]) !== displayDay(item)) {
        blocks.push(current);
        current = [];
      }
      current.push(item);
    }
    if (current.length > 0) blocks.push(current);
  }
  return { blocks, nested };
}
