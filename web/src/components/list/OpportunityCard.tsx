// 추천 카드(S1, BR10.1~BR10.3, interaction-spec 2.1): 순위·기업/기회·분류(쉬운 말)·점수·추천 이유·막는 조건·
// 다음 할 일 + 의견 영역 + [자세히 보기]. 전문 용어(E/P/R)는 카드에 쓰지 않는다(BR10.9).
import type { ReactNode } from 'react';
import { Button, Card, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { OpportunityCard as CardData } from '../../api/types';
import StatusTag from '../common/StatusTag';
import OpinionArea from '../opinion/OpinionArea';
import {
  cardRows,
  classificationLabels,
  classificationTone,
  coreEvidenceRecheckLabel,
  frame,
  labelFor,
} from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

export interface OpportunityCardProps {
  card: CardData;
  /** 서버 앱 설정(/config/ui)의 분류 문구. 있으면 기본 대응표보다 먼저 쓴다. */
  classificationOverrides?: Record<string, string>;
}

function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ flex: '0 0 88px', color: colors.textSecondary }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }} title={title}>
        {children}
      </span>
    </div>
  );
}

/** 서버 문구에 이미 "(승인 …)"이 붙어 있으면 한 번 더 붙이지 않는다. */
export function blockerText(text: string, blocksApproval: boolean): string {
  const suffix = blocksApproval ? cardRows.blocksApproval : cardRows.notBlocksApproval;
  return text.includes(suffix) ? text : `${text} ${suffix}`;
}

function scoreText(scoreDisplay: string): string {
  // "참고 81"(거산 확인 전 묶음)은 그대로, 나머지는 "점수 81" / "점수 --".
  return scoreDisplay.startsWith(cardRows.referenceScorePrefix)
    ? scoreDisplay
    : `${cardRows.scorePrefix} ${scoreDisplay}`;
}

export default function OpportunityCard({ card, classificationOverrides }: OpportunityCardProps) {
  const navigate = useNavigate();
  const detailPath = `/opportunities/${encodeURIComponent(card.oppId)}`;
  const classification = labelFor(
    classificationLabels,
    card.classificationCode,
    classificationOverrides,
  );
  const tone =
    card.classificationCode in classificationTone
      ? classificationTone[card.classificationCode]
      : 'neutral';
  const blocker = blockerText(card.blocker.text, card.blocker.blocksApproval);

  return (
    <Card
      hoverable
      data-testid="opportunity-card"
      styles={{ body: { padding: spacing.cardPadding } }}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span
            data-testid="card-rank"
            role="img"
            aria-label={`${cardRows.rankPrefix} ${card.rank}`}
            style={{ fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
          >
            {card.rank}
          </span>
          <Typography.Title
            level={2}
            data-testid="card-title"
            style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
          >
            {card.title}
          </Typography.Title>
          <span
            role="group"
            aria-label={`분류: ${classification}`}
            data-testid="card-classification"
          >
            <StatusTag tone={tone} bold={card.classificationCode === 'CONTACT_URGENT'}>
              {classification}
            </StatusTag>
          </span>
          {card.coreEvidenceRecheck ? (
            <StatusTag tone="recheck">{coreEvidenceRecheckLabel}</StatusTag>
          ) : null}
          {card.isVirtual ? (
            <StatusTag tone="wait" data-testid="card-virtual-tag">
              {cardRows.virtualTag}
            </StatusTag>
          ) : null}
          {card.datasetKind === 'BROCHURE' ? (
            <StatusTag tone="ask" data-testid="card-brochure-tag">
              {cardRows.brochureTag}
            </StatusTag>
          ) : null}
          {card.reevaluated ? (
            <StatusTag tone="ok" data-testid="card-reevaluated-tag">
              {cardRows.reevaluated}
            </StatusTag>
          ) : null}
          <span
            data-testid="card-score"
            style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
          >
            {scoreText(card.scoreDisplay)}
          </span>
        </div>

        <Row label={cardRows.reason} title={card.reason}>
          <span data-testid="card-reason">{card.reason}</span>
        </Row>
        <Row label={cardRows.blocker} title={blocker}>
          <span data-testid="card-blocker">{blocker}</span>
        </Row>
        <Row label={cardRows.nextAction} title={card.nextAction}>
          <span data-testid="card-next-action">{card.nextAction}</span>
        </Row>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <OpinionArea
            key={`${card.oppId}:${card.evalId}`}
            oppId={card.oppId}
            evalId={card.evalId}
            record={card.records.opinion ?? null}
          />
          <Button
            href={detailPath}
            onClick={(event) => {
              event.preventDefault();
              navigate(detailPath);
            }}
            data-testid="card-view-detail-link"
          >
            {frame.viewDetail} <span aria-hidden="true">→</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}
