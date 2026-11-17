// 공정별 묶음 보기는 공정마다 50곳까지만 싣는다(#383). 묶음 제목의 곳 수는 그 공정 전체 숫자라서,
// 실린 카드가 그보다 적으면 어느 묶음이 몇 곳 안 보이는지 센다(#719).
// 예: 150곳 가운데 50곳만 실렸으면 "홈페이지 없음 99곳 · 끝난 회사 1곳"이 나머지다.
import type { ContactBucket, Meta, OpportunityCard } from '../../api/types';

/** 화면에 보이는 묶음 순서(#675). 서버가 주는 순서와 같다. */
const BUCKET_ORDER: ContactBucket[] = [
  'EVIDENCE_READY',
  'EVIDENCE_SOME',
  'NO_HOMEPAGE',
  'NOT_RESEARCHED',
  'CLOSED',
];

export interface BucketRest {
  bucket: ContactBucket;
  /** 그 묶음에서 이 줄에 실리지 않은 곳 수. */
  count: number;
}

/** 그 묶음의 카드가 이 줄에 몇 장 실렸는지. */
export function shownInBucket(items: OpportunityCard[], bucket: ContactBucket): number {
  return items.filter((card) => card.bucket === bucket).length;
}

/** 묶음별로 이 줄에 실리지 않은 곳 수(0곳인 묶음은 뺀다). 서버가 묶음별 곳 수를 안 줬으면 빈 배열. */
export function bucketRest(
  items: OpportunityCard[],
  bucketCounts: Meta['bucketCounts'],
): BucketRest[] {
  if (!bucketCounts) return [];
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: (bucketCounts[bucket] ?? 0) - shownInBucket(items, bucket),
  })).filter((rest) => rest.count > 0);
}
