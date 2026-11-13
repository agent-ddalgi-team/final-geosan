// 상세 점수표의 표시 묶음 대응표(#611, PM 결정 2026-11-14).
// 계산·배점·규칙 설정은 그대로다. 서버가 준 8항목을 화면에서 다섯 묶음으로 "묶어 보이기만" 한다.
// 항목 코드 → 묶음 대응은 이 파일 한 곳에만 둔다. 묶음 이름은 labels/ko.ts의 scoreGroups.titles.
import type { ScoreItemView } from '../../api/types';

export type ScoreGroupKey = 'PROCESS' | 'OUTSOURCE' | 'DISTANCE' | 'FIT' | 'TIMING' | 'OTHER';

/** 화면에 보이는 묶음 순서 ①→⑤. "그 밖"은 대응표에 없는 항목이 있을 때만 맨 아래에 붙는다. */
export const SCORE_GROUP_ORDER: readonly ScoreGroupKey[] = [
  'PROCESS',
  'OUTSOURCE',
  'DISTANCE',
  'FIT',
  'TIMING',
];

/**
 * 항목 코드(examples/rule-config.yaml의 itemCode) → 표시 묶음.
 * ③ 가까운가(DISTANCE)에는 점수 항목이 없다. 거리는 점수가 아니라 따로 보이는 값이다(#222).
 */
export const SCORE_GROUP_OF_ITEM: Readonly<Record<string, ScoreGroupKey>> = {
  NEW_PRODUCT: 'PROCESS', // 표면처리가 필요한 제품·부품 생산 근거
  NEW_PERF: 'PROCESS', // 처리 목적·성능 태그 일치
  SIG_BID: 'OUTSOURCE', // 구매·외주 의향(옛 공고 자리, #685)
  NEW_MATERIAL: 'FIT', // 소재와 보유 공정 일치
  NEW_RECORD: 'FIT', // 유사 산업·부품 납품실적
  SIG_EXPAND: 'TIMING', // 공장 증설·신규 생산라인
  SIG_ORDER: 'TIMING', // 신규 수주·제품 출시·사업 확대
  SIG_HIRE: 'TIMING', // 관심(옛 채용 자리, #685)
};

export interface ScoreGroup {
  key: ScoreGroupKey;
  items: ScoreItemView[];
  /** 이 묶음 항목 점수의 합(점수가 없는 항목은 0으로 센다). */
  score: number;
  /** 이 묶음 항목 배점의 합. */
  weight: number;
}

export interface ScoreGrouping {
  /** 아는 항목 코드가 하나라도 있어 묶어 보일 수 있는지. 아니면(다른 점수 틀) 전처럼 한 줄씩 보인다. */
  grouped: boolean;
  groups: ScoreGroup[];
}

/** 더한 값의 소수 꼬리(0.1+0.2 같은 것)를 떼어 낸다. */
function tidy(value: number): number {
  return Number(value.toFixed(2));
}

/** 항목을 묶음별로 나눈다. 묶음 안에서는 서버가 준 순서를 지킨다. */
export function groupScoreItems(items: readonly ScoreItemView[]): ScoreGrouping {
  const byKey = new Map<ScoreGroupKey, ScoreItemView[]>();
  let known = 0;
  for (const item of items) {
    const key = SCORE_GROUP_OF_ITEM[item.itemCode] ?? 'OTHER';
    if (key !== 'OTHER') known += 1;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  const keys: ScoreGroupKey[] = byKey.has('OTHER')
    ? [...SCORE_GROUP_ORDER, 'OTHER']
    : [...SCORE_GROUP_ORDER];
  const groups = keys.map((key) => {
    const groupItems = byKey.get(key) ?? [];
    return {
      key,
      items: groupItems,
      score: tidy(groupItems.reduce((sum, item) => sum + (item.score ?? 0), 0)),
      weight: tidy(groupItems.reduce((sum, item) => sum + item.weight, 0)),
    };
  });
  return { grouped: known > 0, groups };
}

/**
 * 묶음 소계를 보여도 되는지: 소계의 합(= 항목 점수의 합)이 서버 총점 E와 같을 때만.
 * 반올림 등으로 어긋나면 소계를 보이지 않는다(어긋나는 숫자를 화면에 두지 않는다).
 */
export function subtotalsMatchTotal(groups: readonly ScoreGroup[], total: number): boolean {
  const sum = tidy(groups.reduce((acc, group) => acc + group.score, 0));
  return Math.abs(sum - total) < 0.005;
}
