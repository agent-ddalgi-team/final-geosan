// 카드 목록 한 줄(#610·#675): 추천 순일 때 묶음(근거 있음 / 근거 조금 / 홈페이지 없음 / 조사 전 / 끝난 회사)이
// 바뀌는 자리에 제목과 건수를 끼운다. 예: "근거 있음 30곳".
// 순서는 서버가 준 그대로다. 화면은 순서를 바꾸지 않고, 앞 카드와 묶음이 달라지는 자리만 찾는다.
// 건수는 서버가 준 "거른 조건 안의 묶음별 건수"다(쪽 넘김과 무관). 서버가 주지 않았으면 이 줄에 있는 카드 수로 센다.
// #972: 카드가 표 줄 모양이 되어, 묶음 제목 바로 아래(묶음 제목이 없으면 맨 위 한 번)에 부모가 준 열 머리를 끼운다.
import type { ReactNode } from 'react';
import type { ContactBucket, Meta, OpportunityCard as CardData } from '../../api/types';
import { contactBuckets } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import { shownInBucket } from './bucketRemainder';

export interface BucketedCardsProps {
  items: CardData[];
  /** 목록 응답 meta.bucketCounts. */
  bucketCounts?: Meta['bucketCounts'];
  /** 묶음 제목을 보일지. 추천 순일 때만 참이다(최근 들어온 순은 묶음 순서가 아니다). */
  showBuckets: boolean;
  /**
   * 이 줄이 전체의 일부만 실은 것인지(공정별 묶음 보기의 50곳 상한, #719). 참이면 카드가 일부만 실린 묶음의
   * 제목에 "(22곳만 보임)"을 덧붙인다. 쪽을 넘겨 다 볼 수 있는 목록(공정 하나·전체 보기)에는 쓰지 않는다.
   */
  truncated?: boolean;
  /**
   * 표 줄의 열 머리(#972). 주면 묶음 제목마다 그 아래에, 묶음 제목이 없는 줄(정렬이 추천 순이 아닐 때 등)은
   * 맨 위에 한 번 보인다. 안 주면(관심 기업 세 칸 줄) 열 머리가 없다.
   */
  columnHead?: ReactNode;
  renderCard: (card: CardData) => ReactNode;
}

export default function BucketedCards({
  items,
  bucketCounts,
  showBuckets,
  truncated = false,
  columnHead,
  renderCard,
}: BucketedCardsProps) {
  const countOf = (bucket: ContactBucket) => bucketCounts?.[bucket] ?? shownInBucket(items, bucket);
  const titleOf = (bucket: ContactBucket) => {
    const count = countOf(bucket);
    const shown = shownInBucket(items, bucket);
    return truncated && shown < count
      ? contactBuckets.titlePartial(bucket, count, shown)
      : contactBuckets.title(bucket, count);
  };
  return (
    <ol
      className="cand-list"
      data-testid="opportunity-list"
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      {items.flatMap((card, index) => {
        const bucket = card.bucket;
        const starts = showBuckets && bucket && bucket !== items[index - 1]?.bucket;
        // 열 머리: 묶음이 시작하는 자리마다, 묶음 제목 없이 시작하는 줄은 맨 위에 한 번.
        const head =
          columnHead && (starts || index === 0) ? (
            <li key={`head-${card.oppId}`} aria-hidden="true">
              {columnHead}
            </li>
          ) : null;
        return [
          starts ? (
            <li
              key={`bucket-${bucket}-${card.oppId}`}
              data-testid="bucket-title"
              data-bucket={bucket}
            >
              <h3
                style={{
                  margin: index === 0 ? '0 0 4px' : `${spacing.cardGap + 4}px 0 4px`,
                  fontSize: typography.fontSizeSecondary,
                  fontWeight: 600,
                  color: colors.text,
                }}
              >
                {titleOf(bucket)}
              </h3>
            </li>
          ) : null,
          head,
          <li key={card.oppId}>{renderCard(card)}</li>,
        ];
      })}
    </ol>
  );
}
