// 카드·상세 머리의 점수 한 줄(#264). 서버가 준 점수 글자(scoreDisplay)는 그대로 보이고,
// 거래 확인 전(scoreState=PENDING)이면 글자를 흐리게 하고 바로 옆에 "거래 확인 전" 꼬리표를 붙인다.
// 거래 중으로 확인된 회사(relationStatus=EXISTING_CONFIRMED)는 "기존 거래처" 꼬리표를 붙인다.
// 점수가 없는 경우(NONE)는 서버 글자 "--"를 그대로 보이고 흐림·꼬리표를 더하지 않는다.
import type { RelationStatus, ScoreState } from '../../api/types';
import { scoreTags } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import StatusTag from './StatusTag';
import { scoreAriaLabel, scoreText } from './scoreDisplay';

export interface ScoreLineProps {
  scoreDisplay: string;
  scoreState?: ScoreState;
  relationStatus?: RelationStatus;
  /** 점수 글자의 data-testid. 꼬리표는 `${testId}-pending-tag`, `${testId}-existing-tag`. */
  testId: string;
}

export default function ScoreLine({
  scoreDisplay,
  scoreState,
  relationStatus,
  testId,
}: ScoreLineProps) {
  const pending = scoreState === 'PENDING';
  const existing = relationStatus === 'EXISTING_CONFIRMED';
  return (
    <>
      <span
        role="group"
        aria-label={scoreAriaLabel(scoreDisplay)}
        data-testid={testId}
        data-score-state={scoreState}
        style={{
          color: pending ? colors.textDimmed : colors.textSecondary,
          fontSize: typography.fontSizeSecondary,
        }}
      >
        {scoreText(scoreDisplay)}
      </span>
      {pending ? (
        <StatusTag tone="ask" data-testid={`${testId}-pending-tag`}>
          {scoreTags.pending}
        </StatusTag>
      ) : null}
      {existing ? (
        <StatusTag tone="neutral" data-testid={`${testId}-existing-tag`}>
          {scoreTags.existing}
        </StatusTag>
      ) : null}
    </>
  );
}
