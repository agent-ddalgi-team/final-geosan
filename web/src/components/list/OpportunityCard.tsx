// 추천 카드(S1, BR10.1~BR10.3, interaction-spec 2.1): 순위·기업/기회·분류(쉬운 말)·점수·추천 이유·막는 조건·
// 다음 할 일 + 의견 영역 + [관심] 단추 + [자세히 보기]. 전문 용어(E/P/R)는 카드에 쓰지 않는다(BR10.9).
// [관심](#357)은 영업 단계가 아니라 켜고 끄는 표시다. 카드에서 검토 의견을 저장하면 서버가 관심을 켜므로 그 뒤 관심 값을 다시 읽는다.
import type { ReactNode } from 'react';
import { Button, Card, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import type { OpportunityCard as CardData } from '../../api/types';
import BookmarkButton from '../common/BookmarkButton';
import StatusTag from '../common/StatusTag';
import ScoreLine from '../common/ScoreLine';
import { useBookmark } from '../common/useBookmark';
import OpinionArea from '../opinion/OpinionArea';
import {
  candidateSearch,
  cardRows,
  classificationLabels,
  classificationTone,
  coreEvidenceRecheckLabel,
  frame,
  labelFor,
  listFilters,
  outcomeStatusLabels,
  outcomeStatusTone,
  ownPlatingLine,
} from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
export interface OpportunityCardProps {
  card: CardData;
  /** 서버 앱 설정(/config/ui)의 분류 문구. 있으면 기본 대응표보다 먼저 쓴다. */
  classificationOverrides?: Record<string, string>;
  /** 공정 코드 → 공정 이름(목록 응답 meta.processCounts). 없으면 공정 꼬리표를 보이지 않는다. */
  processNames?: Record<string, string>;
  /**
   * 순위 번호를 보일지(#361, PM 결정 2026-11-06). 공정 하나를 고른 목록에서만 보인다.
   * 검색 결과·관심 기업 목록·대시보드 칸으로 넘어온 목록은 공정이 섞여 있어 번호를 숨긴다.
   */
  showRank?: boolean;
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

export default function OpportunityCard({
  card,
  classificationOverrides,
  processNames,
  showRank = true,
}: OpportunityCardProps) {
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
  // 막는 조건은 서버 문구 그대로 보인다. "(승인 …)" 꼬리표를 화면에서 덧붙이지 않는다(#160, #171).
  const blocker = card.blocker.text;
  // 영업 단계 꼬리표(U5): 서버가 카드 records.outcome.status를 주면 보인다. 미접촉은 꼬리표를 달지 않는다.
  const stageStatus = card.records.outcome?.status ?? null;
  // 후보 찾기로 들어온 회사(#316): 고른 이유가 있고 점수가 아직 없으면 "점수 전"으로 보인다.
  // 사례 파일 18곳은 고른 이유가 없어서 서버 점수 글자("--" 포함)가 지금처럼 그대로 보인다.
  const pickReason = card.pickReason?.trim() ? card.pickReason : null;
  const beforeScore = pickReason !== null && card.scoreState === 'NONE';
  const newInBatchDate = card.isNewInLatestBatch ? formatMonthDay(card.ingestedAt) : null;
  // 표면처리를 직접 하는 회사일 수 있음(#319): 서버가 참으로 준 회사에만 꼬리표를 붙인다. 회사를 빼거나 순서를 바꾸지 않는다.
  // 근거 한 줄은 표시가 참일 때만 보이고, 없으면 꼬리표만 보인다.
  const ownPlating = card.ownPlatingLineSuspected === true;
  const ownPlatingBasis =
    ownPlating && card.ownPlatingLineBasis?.trim() ? card.ownPlatingLineBasis : null;
  const bookmarkState = useBookmark(card.oppId, card, card.records.bookmark ?? null);

  return (
    <Card
      hoverable
      data-testid="opportunity-card"
      styles={{ body: { padding: spacing.cardPadding } }}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          {showRank ? (
            <span
              data-testid="card-rank"
              role="img"
              aria-label={`${cardRows.rankPrefix} ${card.rank}`}
              style={{ fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
            >
              {card.rank}
            </span>
          ) : null}
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
          {(card.processCodes ?? []).map((code) =>
            processNames?.[code] ? (
              <StatusTag key={code} tone="neutral" data-testid="card-process-tag">
                {processNames[code]}
              </StatusTag>
            ) : null,
          )}
          {/* 서버가 지역·산업 칸을 주면 값이 없을 때 "미확인/미확정"을 보인다. 칸 자체가 없으면(옛 응답) 아무것도 안 보인다. */}
          {card.region !== undefined ? (
            <StatusTag tone="neutral" data-testid="card-region-tag">
              {card.region ?? listFilters.regionUnknown}
            </StatusTag>
          ) : null}
          {card.industries !== undefined ? (
            card.industries.length > 0 ? (
              card.industries.map((industry) => (
                <StatusTag key={industry} tone="neutral" data-testid="card-industry-tag">
                  {industry}
                </StatusTag>
              ))
            ) : (
              <StatusTag tone="neutral" data-testid="card-industry-tag">
                {listFilters.industryUnknown}
              </StatusTag>
            )
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
          {stageStatus && stageStatus !== 'NOT_EXECUTED' ? (
            <StatusTag tone={outcomeStatusTone[stageStatus] ?? 'neutral'}>
              <span data-testid="card-stage-tag">{outcomeStatusLabels[stageStatus]}</span>
            </StatusTag>
          ) : null}
          {card.reevaluated ? (
            <StatusTag tone="ok" data-testid="card-reevaluated-tag">
              {cardRows.reevaluated}
            </StatusTag>
          ) : null}
          {card.isNewInLatestBatch ? (
            <StatusTag tone="ask" data-testid="card-new-in-batch-tag">
              {newInBatchDate
                ? candidateSearch.newInBatchWithDate(newInBatchDate)
                : candidateSearch.newInBatch}
            </StatusTag>
          ) : null}
          {ownPlating ? (
            <StatusTag tone="ask" data-testid="card-own-plating-tag">
              {ownPlatingLine.tag}
            </StatusTag>
          ) : null}
          {beforeScore ? (
            <span
              data-testid="card-score"
              data-score-state={card.scoreState}
              style={{ color: colors.textDimmed, fontSize: typography.fontSizeSecondary }}
            >
              {candidateSearch.beforeScore}
            </span>
          ) : (
            <ScoreLine
              scoreDisplay={card.scoreDisplay}
              scoreState={card.scoreState}
              relationStatus={card.relationStatus}
              classificationCode={card.classificationCode}
              testId="card-score"
            />
          )}
        </div>

        {ownPlatingBasis ? (
          <Row label={ownPlatingLine.basisLabel} title={ownPlatingBasis}>
            <span data-testid="card-own-plating-basis">{ownPlatingBasis}</span>
          </Row>
        ) : null}
        {pickReason ? (
          <Row label={candidateSearch.pickReasonRow} title={pickReason}>
            <span data-testid="card-pick-reason">{pickReason}</span>
          </Row>
        ) : null}
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
            onSaved={() => void bookmarkState.sync()}
          />
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 12,
            }}
          >
            <BookmarkButton
              oppId={card.oppId}
              bookmark={bookmarkState.bookmark}
              onChanged={bookmarkState.change}
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
      </div>
    </Card>
  );
}
