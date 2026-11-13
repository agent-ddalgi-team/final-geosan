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
  factoryProfileLabels,
  classificationTone,
  contactBuckets,
  frame,
  labelFor,
  listFilters,
  lostReasonLabels,
  outcomeStatusLabels,
  salesStepLabels,
  outcomeStatusTone,
  ownPlatingLine,
} from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { formatMonthDay } from '../../utils/time';
export interface OpportunityCardProps {
  card: CardData;
  /** 서버 앱 설정(/config/ui)의 분류 문구. 있으면 기본 대응표보다 먼저 쓴다. */
  classificationOverrides?: Record<string, string>;
  /** 공정 코드 → 공정 이름(목록 응답 meta.processCounts). 없으면 공정 꼬리표를 보이지 않는다. 꼬리표는 확정된 공정만(#659). */
  processNames?: Record<string, string>;
  /**
   * 순위 번호를 보일지(#361, PM 결정 2026-11-06). 공정 하나를 고른 목록에서만 보인다.
   * 검색 결과·관심 기업 목록·대시보드 칸으로 넘어온 목록은 공정이 섞여 있어 번호를 숨긴다.
   */
  showRank?: boolean;
  /**
   * [관심] 단추로 관심을 켰을 때 알린다(#675). 관심 기업을 뺀 평소 목록이 이 카드를 목록에서 빼고
   * "관심 기업으로 옮겼습니다" 안내를 보이는 데 쓴다. 끌 때와 검토 의견 저장으로 켜질 때는 알리지 않는다.
   */
  onBookmarkedOn?: (card: CardData) => void;
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
  onBookmarkedOn,
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
  // 검토사항 줄(#659, PM 지시 2026-11-13): 긴 문장 대신 "확인할 것: 공정 · 소재 · 근거 부족"처럼 낱말로 보인다.
  // 종류는 서버가 알려 준다(checkKinds). 문장을 글자로 맞춰 추측하지 않는다. "(승인 …)" 꼬리표도 덧붙이지 않는다(#160, #171).
  const notEvaluated = card.classificationCode === 'NOT_EVALUATED';
  const checkPoints = card.checkPoints ?? [];
  const checkKinds = card.checkKinds ?? [];
  // 종류가 줄 수와 맞을 때만 쓴다. 안 맞으면(옛 응답) 서버 글자를 그대로 이름으로 보인다.
  const kindsUsable = checkKinds.length === checkPoints.length;
  // 공정 꼬리표는 확정된 공정만(#659, PM 결정 2026-11-13). AI가 제안만 한 공정은 꼬리표로 보이지 않는다.
  const confirmedProcessCodes = card.confirmedProcessCodes ?? [];
  const proposedProcessCount = card.proposedProcessCount ?? 0;
  // "공정": 확정된 공정이 없고 AI 제안만 있거나(평가 전 회사는 제안이 없어도), 거산 공정 값이 확인 전일 때.
  const processUnconfirmed =
    card.confirmedProcessCodes !== undefined &&
    confirmedProcessCodes.length === 0 &&
    (proposedProcessCount > 0 || notEvaluated);
  const checkWords = [
    processUnconfirmed || (kindsUsable && checkKinds.includes('PROCESS'))
      ? cardRows.checkWords.process
      : null,
    kindsUsable && checkKinds.includes('MATERIAL') ? cardRows.checkWords.material : null,
    // 평가 전 회사는 점수 항목이 아직 하나도 없어서 근거 부족이다.
    (card.coreEvidenceGaps ?? []).length > 0 || notEvaluated ? cardRows.checkWords.evidence : null,
  ].filter((word) => word !== null);
  const checkNames = kindsUsable
    ? checkPoints.filter((_, index) => !['PROCESS', 'MATERIAL'].includes(checkKinds[index]))
    : checkPoints;
  const checkLine =
    checkWords.length > 0 || checkNames.length > 0
      ? cardRows.checkWordsLine(checkWords, checkNames)
      : null;
  // 서버 문장이 이미 요구 이름을 말하는 회사(승인을 막는데 확인 전 조건을 따로 주지 않음)는 그 문장을 남기고 뒤에 잇는다.
  // "없음 — …"이나 평가 전 문장("점수 입력 전 …")은 낱말 줄이 대신한다.
  const keepServerText = card.blocker.blocksApproval && checkPoints.length === 0 && !notEvaluated;
  const blockerLine =
    checkLine === null
      ? card.blocker.text
      : keepServerText
        ? `${card.blocker.text} · ${checkLine}`
        : checkLine;
  // 머리 줄에서 빼는 꼬리표(#659): "필수조건 확인 필요"·"필수조건 확인 전"·"핵심 근거 재확인"은 무엇을
  // 확인하라는 말인지 알 수 없어 보이지 않고, 검토사항 줄이 대신 말한다. 묶음 제목은 그대로다.
  // "평가 전"·"평가 전 · 적합도 상/낮음"도 보이지 않는다(PM 지시 2026-11-13): 점수가 없다는 것은 점수 자리에서 안다.
  const showClassification = card.classificationCode !== 'FILTER_PENDING' && !notEvaluated;
  // 영업 단계 꼬리표(U5): 서버가 카드 records.outcome.status를 주면 보인다. 미접촉은 꼬리표를 달지 않는다.
  const stageStatus = card.records.outcome?.status ?? null;
  // 후보 찾기로 들어온 회사(#316): 고른 이유가 있고 점수가 아직 없으면 "점수 전"으로 보인다.
  // 사례 파일 18곳은 고른 이유가 없어서 서버 점수 글자("--" 포함)가 지금처럼 그대로 보인다.
  const pickReason = card.pickReason?.trim() ? card.pickReason : null;
  const beforeScore = pickReason !== null && card.scoreState === 'NONE';
  // 점수 전 회사는 서버가 고른 이유를 추천 근거 칸에 그대로 넣는다(#555). 같은 문장이면 고른 이유 한 줄만 보인다.
  const reasonSameAsPick = pickReason !== null && pickReason.trim() === card.reason.trim();
  // 들어온 날짜 꼬리표(#516): 후보 찾기로 들어온 시각이 있으면 "11/9 들어옴". 마지막 회차인지와 무관하다.
  const ingestedOn = formatMonthDay(card.ingestedAt);
  // 표면처리를 직접 하는 회사일 수 있음(#319): 서버가 참으로 준 회사에만 꼬리표를 붙인다. 회사를 빼거나 순서를 바꾸지 않는다.
  // 근거 한 줄은 표시가 참일 때만 보이고, 없으면 꼬리표만 보인다.
  const factoryLine = factoryProfileText(card.factoryProfile);
  const ownPlating = card.ownPlatingLineSuspected === true;
  const ownPlatingBasis =
    ownPlating && card.ownPlatingLineBasis?.trim() ? card.ownPlatingLineBasis : null;
  // 근거 상태 묶음(#675, PM 결정 2026-11-13): 묶음 이유 꼬리표 자리에는 공정 적합도 하나("적합도 상")를 보인다.
  // 끝난 회사만 끝난 이유("거래 중"·"성사·거절·보류"·"검토 대상 제외"·"필수조건 탈락")를 그 자리에 보인다.
  const closed = card.bucket === 'CLOSED';
  const closedBasis = closed && card.bucketBasis ? contactBuckets.basis[card.bucketBasis] : null;
  const fitTag = !closed && card.bucket && card.fitLevel ? contactBuckets.fit[card.fitLevel] : null;
  // 점수와 "순서 조정" 줄은 점수를 매길 근거가 있는 "근거 있음" 묶음 카드에만 보인다.
  // 서버가 묶음 칸을 주지 않으면(옛 응답) 지금처럼 보인다.
  const evidenceReady = card.bucket === undefined || card.bucket === 'EVIDENCE_READY';
  // 조정 단계가 0이면(표본 부족이거나 성사·거절이 서로 지움) 순서가 그대로라 줄을 보이지 않는다.
  const adjust =
    evidenceReady && card.rankAdjust && card.rankAdjust.level !== 0 ? card.rankAdjust : null;
  const adjustLine = adjust
    ? contactBuckets.adjustLine({
        level: adjust.level,
        processName: adjust.processName,
        industry: adjust.industry,
        wonCount: adjust.wonCount,
        lostCount: adjust.lostCount,
        lostReasons: adjust.countedLostReasons.map((code) => lostReasonLabels[code]),
        windowDays: adjust.windowDays,
      })
    : null;
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
          {showClassification ? (
            <span
              role="group"
              aria-label={`분류: ${classification}`}
              data-testid="card-classification"
            >
              <StatusTag tone={tone} bold={card.classificationCode === 'CONTACT_URGENT'}>
                {classification}
              </StatusTag>
            </span>
          ) : null}
          {closedBasis ? (
            <StatusTag tone="neutral" data-testid="card-bucket-basis">
              {closedBasis}
            </StatusTag>
          ) : null}
          {fitTag ? (
            <StatusTag tone="neutral" data-testid="card-fit-level">
              {fitTag}
            </StatusTag>
          ) : null}
          {confirmedProcessCodes.map((code) =>
            processNames?.[code] ? (
              <StatusTag key={code} tone="neutral" data-testid="card-process-tag">
                {processNames[code]}
              </StatusTag>
            ) : null,
          )}
          {/* 지역 꼬리표는 두지 않는다(#659): 목록 머리의 지역 선택란과 겹친다. */}
          {/* 서버가 산업 칸을 주면 값이 없을 때 "산업 미확정"을 보인다. 칸 자체가 없으면(옛 응답) 아무것도 안 보인다. */}
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
              <span data-testid="card-stage-tag">
                {outcomeStatusLabels[stageStatus]}
                {card.salesStep ? ` · ${salesStepLabels[card.salesStep]}` : ''}
              </span>
            </StatusTag>
          ) : null}
          {card.reevaluated ? (
            <StatusTag tone="ok" data-testid="card-reevaluated-tag">
              {cardRows.reevaluated}
            </StatusTag>
          ) : null}
          {ingestedOn ? (
            <StatusTag tone="ask" data-testid="card-ingested-tag">
              {candidateSearch.ingestedOn(ingestedOn)}
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
              {card.researchState ? (
                <span data-testid="card-research-state" data-research-state={card.researchState}>
                  {' · '}
                  {card.researchState === 'RUNNING'
                    ? candidateSearch.researchRunning
                    : candidateSearch.researchStopped}
                </span>
              ) : null}
            </span>
          ) : evidenceReady ? (
            <ScoreLine
              scoreDisplay={card.scoreDisplay}
              scoreState={card.scoreState}
              relationStatus={card.relationStatus}
              classificationCode={card.classificationCode}
              testId="card-score"
            />
          ) : null}
        </div>

        {adjustLine ? (
          <Row label={contactBuckets.adjustRow} title={adjustLine}>
            <span data-testid="card-rank-adjust">{adjustLine}</span>
          </Row>
        ) : null}
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
        {factoryLine ? (
          <Row label={factoryProfileLabels.row} title={factoryLine}>
            <span data-testid="card-factory-profile">{factoryLine}</span>
          </Row>
        ) : null}
        {reasonSameAsPick ? null : (
          <Row label={cardRows.reason} title={card.reason}>
            <span data-testid="card-reason">{card.reason}</span>
          </Row>
        )}
        <Row label={cardRows.blocker} title={blockerLine}>
          <span data-testid="card-blocker">{blockerLine}</span>
        </Row>
        {/* 후속 조치는 카드에 두지 않고 상세 "1. 추천 근거와 후속 조치"에서 읽는다(#647, PM 결정 2026-11-13). */}

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
              onChanged={(next) => {
                bookmarkState.change(next);
                if (next.active) onBookmarkedOn?.(card);
              }}
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
