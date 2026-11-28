// 영업 분석 › 상대 반응(#985) 파이 그래프의 계산만 모은 곳(그리기는 ReactionPie.tsx).
// 숫자는 서버가 준 값을 쓴다. 여기서 하는 일은 ① 조각의 각도·길 만들기 ② 6가지를 넘는 부분을 "그 밖"으로 묶기
// ③ 조각을 눌렀을 때 접촉 줄을 조건으로 고르고, 고른 줄을 공정별(또는 산업별)로 세기 — 이 세 가지뿐이다.
// 서버가 센 건수(전체 · 산업 줄 · 공정 줄)를 화면이 다시 세어 바꾸지 않는다.
import type { ReactionAnswerCount, ReactionContact } from '../../api/salesAnalysis';

/** 파이 한 조각의 값. */
export interface PieValue {
  key: string;
  value: number;
}

export interface PieSlice {
  key: string;
  value: number;
  /** 12시에서 시계 방향으로 잰 시작 각도(0~360). */
  startDeg: number;
  /** 조각이 차지하는 각도. */
  sweepDeg: number;
  /** 그린 조각들 합계에서 차지하는 몫(0~1). */
  share: number;
  /** SVG 길(path d). */
  path: string;
}

const round2 = (value: number) => value.toFixed(2);

/**
 * 12시부터 시계 방향으로 조각을 만든다. 0건(이하)인 값은 조각을 만들지 않는다.
 * 조각이 하나뿐이면 부채꼴이 아니라 온전한 원 하나를 그린다(부채꼴 길은 시작점과 끝점이 같아 그려지지 않는다).
 */
export function pieSlices(values: PieValue[], size: number): PieSlice[] {
  const shown = values.filter((item) => item.value > 0);
  const total = shown.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];
  const center = size / 2;
  const r = size / 2 - 1;
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: center + r * Math.sin(rad), y: center - r * Math.cos(rad) };
  };
  let startDeg = 0;
  return shown.map((item) => {
    const share = item.value / total;
    const sweepDeg = share * 360;
    let path: string;
    if (shown.length === 1) {
      path =
        `M${round2(center - r)} ${round2(center)}` +
        ` a${round2(r)} ${round2(r)} 0 1 0 ${round2(2 * r)} 0` +
        ` a${round2(r)} ${round2(r)} 0 1 0 ${round2(-2 * r)} 0 Z`;
    } else {
      const from = point(startDeg);
      const to = point(startDeg + sweepDeg);
      path =
        `M${round2(center)} ${round2(center)} L${round2(from.x)} ${round2(from.y)}` +
        ` A${round2(r)} ${round2(r)} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${round2(to.x)} ${round2(to.y)} Z`;
    }
    const slice = { key: item.key, value: item.value, startDeg, sweepDeg, share, path };
    startDeg += sweepDeg;
    return slice;
  });
}

/** 반올림한 비율(%). 합계가 0이면 0. */
export function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value * 100) / total) : 0;
}

/** "그 밖"으로 묶은 조각의 열쇠. 보기 id와 겹치지 않는 값이다. */
export const REST_KEY = '__rest__';

export interface PartGroup {
  /** 보기 id. "그 밖"이면 REST_KEY. */
  key: string;
  /** 이 조각에 든 보기 id(그 밖이면 여럿). 조각을 눌렀을 때 접촉 줄을 고르는 데 쓴다. */
  answerIds: string[];
  count: number;
  rest: boolean;
}

/**
 * 좋게 본 부분 · 걸린 부분을 서버가 준 순서(많은 순) 그대로 조각으로 만든다. 0건은 뺀다.
 * max가지를 넘으면 max번째부터는 "그 밖" 한 조각으로 묶고, 그 건수는 묶인 것들의 합이다.
 */
export function groupWithRest(items: ReactionAnswerCount[], max: number): PartGroup[] {
  const shown = items.filter((item) => item.count > 0);
  const toGroup = (item: ReactionAnswerCount): PartGroup => ({
    key: item.answerId,
    answerIds: [item.answerId],
    count: item.count,
    rest: false,
  });
  if (shown.length <= max) return shown.map(toGroup);
  const rest = shown.slice(max - 1);
  return [
    ...shown.slice(0, max - 1).map(toGroup),
    {
      key: REST_KEY,
      answerIds: rest.map((item) => item.answerId),
      count: rest.reduce((sum, item) => sum + item.count, 0),
      rest: true,
    },
  ];
}

/** 지금 골라 보는 묶음(산업 한 줄 또는 공정 한 줄). 공정 확인 전 줄은 processCode가 null이다. */
export type ReactionScope =
  { kind: 'industry'; industry: string } | { kind: 'process'; processCode: string | null };

/** 접촉 줄에 한 번이라도 적힌 산업 이름. 여기에 없는 산업 줄은 "산업이 없는 회사" 줄(산업 확인 전)이다. */
export function namedIndustries(contacts: ReactionContact[]): Set<string> {
  return new Set(contacts.flatMap((contact) => contact.industries));
}

/** 접촉 줄이 골라 보는 묶음에 드는가. 묶음이 없으면(전체) 모두 든다. */
export function inScope(
  contact: ReactionContact,
  scope: ReactionScope | null,
  named: Set<string>,
): boolean {
  if (!scope) return true;
  if (scope.kind === 'industry') {
    if (contact.industries.includes(scope.industry)) return true;
    // 산업이 없는 회사의 접촉은 서버가 맨 끝 "산업 확인 전" 줄에 센다. 그 줄 이름은 어느 접촉의 산업에도 없다.
    return contact.industries.length === 0 && !named.has(scope.industry);
  }
  if (scope.processCode === null) return contact.processCodes.length === 0;
  return contact.processCodes.includes(scope.processCode);
}

export type PieKind = 'reaction' | 'good' | 'bad';

/** 서버가 좋게 본 부분은 긍정적 접촉에서, 걸린 부분은 부정적 접촉에서만 센다(계약). 그 반응 보기 id. */
export const REACTION_IDS = {
  positive: 'POSITIVE',
  neutral: 'NEUTRAL',
  negative: 'NEGATIVE',
} as const;

/** 누른 조각에 해당하는 접촉 줄만 고른다(서버가 준 순서 = 최근 날짜 순 그대로). */
export function contactsOfSlice(
  contacts: ReactionContact[],
  pie: PieKind,
  answerIds: string[],
): ReactionContact[] {
  return contacts.filter((contact) => {
    if (pie === 'reaction') return answerIds.includes(contact.reaction);
    if (pie === 'good') {
      return (
        contact.reaction === REACTION_IDS.positive &&
        contact.good !== null &&
        answerIds.includes(contact.good)
      );
    }
    return (
      contact.reaction === REACTION_IDS.negative &&
      contact.bad !== null &&
      answerIds.includes(contact.bad)
    );
  });
}

export interface PartCount {
  /** 공정 코드 또는 산업 이름. 없는 회사의 접촉을 모은 줄은 null. */
  key: string | null;
  count: number;
}

/**
 * 고른 접촉 줄을 공정별(또는 산업별)로 센다. 공정(산업)이 여럿인 회사의 접촉은 줄마다 한 번씩,
 * 하나도 없는 회사의 접촉은 null 줄에 센다(서버의 나눠 보기 표와 같은 규칙).
 * 많은 순, 같으면 order(서버 표의 줄 순서)에 먼저 나온 순.
 */
export function countByPart(
  contacts: ReactionContact[],
  by: 'process' | 'industry',
  order: (string | null)[],
): PartCount[] {
  const counts = new Map<string | null, number>();
  for (const contact of contacts) {
    const keys: (string | null)[] = by === 'process' ? contact.processCodes : contact.industries;
    for (const key of keys.length > 0 ? keys : [null]) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const rank = (key: string | null) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || rank(a.key) - rank(b.key));
}
