// 카드 목록 한 줄(#610): 추천 순일 때 묶음(지금 연락할 곳 / 확인 필요 / 나중)이 바뀌는 자리에 제목과 건수를 끼운다.
// 순서는 서버가 준 그대로다. 화면은 순서를 바꾸지 않고, 앞 카드와 묶음이 달라지는 자리만 찾는다.
// 건수는 서버가 준 "거른 조건 안의 묶음별 건수"다(쪽 넘김과 무관). 서버가 주지 않았으면 이 줄에 있는 카드 수로 센다.
import type { ReactNode } from 'react';
import type { ContactBucket, Meta, OpportunityCard as CardData } from '../../api/types';
import { contactBuckets } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

export interface BucketedCardsProps {
  items: CardData[];
  /** 목록 응답 meta.bucketCounts. */
  bucketCounts?: Meta['bucketCounts'];
  /** 묶음 제목을 보일지. 추천 순일 때만 참이다(최근 들어온 순은 묶음 순서가 아니다). */
  showBuckets: boolean;
  renderCard: (card: CardData) => ReactNode;
}

export default function BucketedCards({
  items,
  bucketCounts,
  showBuckets,
  renderCard,
}: BucketedCardsProps) {
  const countOf = (bucket: ContactBucket) =>
    bucketCounts?.[bucket] ?? items.filter((card) => card.bucket === bucket).length;
  return (
    <ol
      data-testid="opportunity-list"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gap: spacing.cardGap,
      }}
    >
      {items.flatMap((card, index) => {
        const bucket = card.bucket;
        const starts = showBuckets && bucket && bucket !== items[index - 1]?.bucket;
        return [
          starts ? (
            <li
              key={`bucket-${bucket}-${card.oppId}`}
              data-testid="bucket-title"
              data-bucket={bucket}
            >
              <h3
                style={{
                  margin: index === 0 ? 0 : `${spacing.cardGap}px 0 0`,
                  fontSize: typography.fontSize,
                  color: colors.textSecondary,
                }}
              >
                {contactBuckets.title(bucket, countOf(bucket))}
              </h3>
            </li>
          ) : null,
          <li key={card.oppId}>{renderCard(card)}</li>,
        ];
      })}
    </ol>
  );
}
