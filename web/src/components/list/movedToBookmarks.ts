// 관심 기업을 뺀 평소 목록(#675)에서 [관심]을 눌러 방금 관심 기업으로 옮긴 카드를 화면에서 뺀다.
// 서버 응답은 그 카드를 담은 채 와 있으므로, 카드와 함께 곳 수·묶음별 곳 수도 그만큼 줄여 보인다.
// 목록을 다시 불러오면 서버가 뺀 숫자를 주므로 이 계산은 "지금 보고 있는 응답"에만 쓴다.
import type { Meta, OpportunityCard } from '../../api/types';

export interface WithoutMoved {
  items: OpportunityCard[];
  total: number;
  bucketCounts: Meta['bucketCounts'];
}

export function withoutMoved(
  items: OpportunityCard[],
  total: number,
  bucketCounts: Meta['bucketCounts'],
  movedIds: ReadonlySet<string>,
): WithoutMoved {
  const moved = items.filter((card) => movedIds.has(card.oppId));
  if (moved.length === 0) return { items, total, bucketCounts };
  const counts = bucketCounts ? { ...bucketCounts } : bucketCounts;
  if (counts) {
    for (const card of moved) {
      if (card.bucket && counts[card.bucket] > 0) counts[card.bucket] -= 1;
    }
  }
  return {
    items: items.filter((card) => !movedIds.has(card.oppId)),
    total: Math.max(0, total - moved.length),
    bucketCounts: counts,
  };
}
