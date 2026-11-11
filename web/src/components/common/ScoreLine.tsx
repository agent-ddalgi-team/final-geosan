// 카드·상세 머리의 점수 한 줄(#264). 서버가 준 점수 글자(scoreDisplay)는 그대로 보이고,
// 확정 전(scoreState=PENDING)이면 글자를 흐리게 하고 바로 옆에 꼬리표를 붙인다.
// 꼬리표 글자는 PENDING의 이유로 가른다(#498, 약속 C1 #286): 분류가 필수조건·역량 확인 대기
// (FILTER_PENDING·OPS_PENDING)면 "거래 확인 전", 그 밖이면 AI 제안으로 계산된 점수라 "AI 제안 · 확인 전".
// 분류를 안 넘기면 예전처럼 "거래 확인 전"이다. 흐림 표시는 둘 다 같다.
// 거래 중으로 확인된 회사(relationStatus=EXISTING_CONFIRMED)는 "기존 거래처" 꼬리표를 붙인다.
// 점수가 없는 경우(NONE)는 서버 글자 "--"를 그대로 보이고 흐림·꼬리표를 더하지 않는다.
import type { ClassificationCode, RelationStatus, ScoreState } from '../../api/types';
import { scoreTags } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import StatusTag from './StatusTag';
import { scoreAriaLabel, scoreText } from './scoreDisplay';

export interface ScoreLineProps {
  scoreDisplay: string;
  scoreState?: ScoreState;
  relationStatus?: RelationStatus;
  /** 분류(#498). PENDING의 이유를 가르는 데 쓴다. 안 주면 "거래 확인 전"으로 본다. */
  classificationCode?: ClassificationCode;
  /** 점수 글자의 data-testid. 꼬리표는 `${testId}-pending-tag`(거래 확인 전), `${testId}-ai-proposal-tag`(AI 제안), `${testId}-existing-tag`. */
  testId: string;
}

/** 점수가 확정 전인 까닭이 "필수조건·역량 확인 대기"인 분류. 이 밖의 PENDING은 AI 제안으로 계산된 점수다. */
const CLASSIFICATION_PENDING: ReadonlySet<ClassificationCode> = new Set([
  'FILTER_PENDING',
  'OPS_PENDING',
]);

export default function ScoreLine({
  scoreDisplay,
  scoreState,
  relationStatus,
  classificationCode,
  testId,
}: ScoreLineProps) {
  const pending = scoreState === 'PENDING';
  const aiProposal =
    pending && classificationCode !== undefined && !CLASSIFICATION_PENDING.has(classificationCode);
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
        aiProposal ? (
          <StatusTag tone="ask" data-testid={`${testId}-ai-proposal-tag`}>
            {scoreTags.aiProposal}
          </StatusTag>
        ) : (
          <StatusTag tone="ask" data-testid={`${testId}-pending-tag`}>
            {scoreTags.pending}
          </StatusTag>
        )
      ) : null}
      {existing ? (
        <StatusTag tone="neutral" data-testid={`${testId}-existing-tag`}>
          {scoreTags.existing}
        </StatusTag>
      ) : null}
    </>
  );
}
