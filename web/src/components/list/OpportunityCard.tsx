// 추천 카드(S1, BR10.1~BR10.3, interaction-spec 2.1): 순위·기업/기회·분류(쉬운 말)·점수·추천 이유·막는 조건·
// 다음 할 일 + 의견 영역 + [관심] 단추 + [자세히 보기]. 전문 용어(E/P/R)는 카드에 쓰지 않는다(BR10.9).
// #972(PM이 고른 시안 2026-11-27): 카드 한 장 대신 표 줄 모양이다.
// #981(PM 결정 2026-11-28): 거래처 후보 줄은 세 칸이다. 회사 이름(혼자 한 줄, 굵게) · 품목 · 산업 · "지역 · 거리" |
// 추천 근거 + 검토사항 + 꼬리표 | 점수(숫자만) · 적합도 · 관심 별, 그 아래 의견 고르기. [자세히 보기]는 없고 회사 이름을 누른다.
// [관심](#357)은 영업 단계가 아니라 켜고 끄는 표시다. 카드에서 검토 의견을 저장하면 서버가 관심을 켜므로 그 뒤 관심 값을 다시 읽는다.
import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import { Button, Typography } from 'antd';
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
  contactBuckets,
  dashboardTexts,
  frame,
  labelFor,
  listFilters,
  listTable,
  lostReasonLabels,
  outcomeStatusLabels,
  salesStepLabels,
  outcomeStatusTone,
  ownPlatingLine,
  preferenceLabels,
  reportView,
  supplyTierLabels,
} from '../../labels/ko';
import { accent, colors, listTheme, radius, typography } from '../../theme/tokens';
import { formatDate, formatMonthDay, todayKst } from '../../utils/time';

/**
 * 서버 제목 "회사 · 품목"을 첫 " · "에서 가른다(#981). 둘을 " · "로 이으면 서버 글자 그대로다(글자를 바꾸거나 지어내지 않는다).
 * 구분 글자가 없으면 통째로 회사 이름이다.
 */
export function splitTitle(title: string): { name: string; item: string | null } {
  const at = title.indexOf(' · ');
  return at < 0
    ? { name: title, item: null }
    : { name: title.slice(0, at), item: title.slice(at + 3) };
}

/** #793: 적합도 높낮이(오름·내림 화살표 계산에만 쓴다). */
const FIT_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;

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
  /** 이 줄에서 검토 의견을 저장했을 때 알린다(#981). 관심 기업 화면이 "의견 전" 띠의 곳 수를 다시 읽는 데 쓴다. */
  onOpinionSaved?: () => void;
  /**
   * 줄 모양(#972 → #981). "table"(기본, 거래처 후보)은 열 머리가 있는 세 칸 표 줄, "bookmark"(관심 기업)는 세 칸 줄이다:
   * 회사·품목·꼬리표 | 추천 근거 / 검토사항 | 큰 점수 · 다음 일정 · 의견 고르기 · [자세히 보기].
   * 보이는 정보와 테스트용 이름은 두 모양이 같다(관심 기업 줄은 지역 칸이 없어 거리를 꼬리표로 보인다).
   */
  layout?: 'table' | 'bookmark';
}

export default function OpportunityCard({
  card,
  classificationOverrides,
  processNames,
  showRank = true,
  onBookmarkedOn,
  onOpinionSaved,
  layout = 'table',
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
    // #890(PM 결정 2026-11-22): 1차인지 2·3차인지 분명하지 않으면(AI 판단 "모름") 검토사항에 넣는다.
    card.supplyTier === 'UNKNOWN' ? cardRows.checkWords.supplyTier : null,
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
  const ownPlating = card.ownPlatingLineSuspected === true;
  const ownPlatingBasis =
    ownPlating && card.ownPlatingLineBasis?.trim() ? card.ownPlatingLineBasis : null;
  // 근거 상태 묶음(#675, PM 결정 2026-11-13): 묶음 이유 꼬리표 자리에는 공정 적합도 하나("적합도 상")를 보인다.
  // 끝난 회사만 끝난 이유("거래 중"·"성사·거절·보류"·"제외"·"필수조건 탈락")를 그 자리에 보인다.
  const closed = card.bucket === 'CLOSED';
  const closedBasis = closed && card.bucketBasis ? contactBuckets.basis[card.bucketBasis] : null;
  // #793: 홈페이지로 다시 정해 처음(생산품 기준)보다 오르거나 내렸으면 화살표를 붙인다("적합도 상 ↑").
  const fitMove =
    card.fitBasis === 'HOMEPAGE' && card.fitLevel && card.previousFitLevel
      ? FIT_RANK[card.fitLevel] - FIT_RANK[card.previousFitLevel]
      : 0;
  const fitTag =
    !closed && card.bucket && card.fitLevel
      ? fitMove !== 0
        ? contactBuckets.fitMoved(contactBuckets.fit[card.fitLevel], fitMove > 0)
        : contactBuckets.fit[card.fitLevel]
      : null;
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
  // #943 승인한 담당자 선호로 올린 카드, 또는 선호 밖 회사로 남긴 자리.
  const preference = evidenceReady ? (card.preferenceAdjust ?? null) : null;
  const preferenceLine = preference
    ? preferenceLabels.cardLine(
        preferenceLabels.combo(preference),
        formatMonthDay(preference.approvedAt) ?? '',
      )
    : evidenceReady && card.exploreSlot
      ? preferenceLabels.exploreLine
      : null;
  const bookmarkState = useBookmark(card.oppId, card, card.records.bookmark ?? null);

  // 줄 안의 조각들(#972). 표 줄 모양에서 칸마다 나눠 놓는다. 카드 때 보이던 정보는 하나도 빼지 않는다.
  const labelStyle: CSSProperties = {
    color: listTheme.headFg,
    fontSize: typography.fontSizeSecondary,
  };
  const lineStyle: CSSProperties = { color: listTheme.bodyFg };
  // 관심 기업 줄 오른쪽 연보라 칸(#976)의 글자: 연한 바탕 위라 이름표보다 한 단계 진한 본문 색을 쓴다.
  const contactLineStyle: CSSProperties = {
    color: listTheme.bodyFg,
    fontSize: typography.fontSizeSecondary,
  };
  const rankEl = showRank ? (
    <span
      data-testid="card-rank"
      role="img"
      aria-label={`${cardRows.rankPrefix} ${card.rank}`}
      style={{ ...labelStyle, fontVariantNumeric: 'tabular-nums' }}
    >
      {card.rank}
    </span>
  ) : null;
  const threeColumns = layout === 'bookmark';
  // 제목(#981): 회사 이름만 굵게 한 줄, 품목은 그 아래 작은 글. 사이의 " · "는 눈에는 숨기고 화면 낭독기에는 읽힌다.
  const { name: companyName, item: itemName } = splitTitle(card.title);
  const titleEl = (
    <Typography.Title
      level={2}
      data-testid="card-title"
      style={{
        margin: 0,
        fontSize: threeColumns ? listTheme.titleSizeLarge : listTheme.titleSize,
        fontWeight: 700,
        lineHeight: 1.35,
      }}
    >
      {/* 회사 이름을 누르면 상세로 간다(#691). 거래처 후보 줄에는 [자세히 보기]가 따로 없다(#981). */}
      <a
        href={detailPath}
        onClick={(event) => {
          event.preventDefault();
          navigate(detailPath);
        }}
        className="cand-row__name"
        style={{ color: 'inherit' }}
        data-testid="card-title-link"
      >
        {companyName}
      </a>
      {itemName !== null ? (
        <>
          <span className="cand-row__sep"> · </span>
          <span
            data-testid="card-title-item"
            style={{
              display: 'block',
              marginTop: 2,
              color: listTheme.bodyFg,
              fontSize: typography.fontSizeSecondary,
              fontWeight: 400,
              lineHeight: 1.45,
            }}
          >
            {itemName}
          </span>
        </>
      ) : null}
    </Typography.Title>
  );
  const ingestedTag = ingestedOn ? (
    <StatusTag tone="ask" data-testid="card-ingested-tag">
      {candidateSearch.ingestedOn(ingestedOn)}
    </StatusTag>
  ) : null;
  // 산업은 회사 이름 아래 작은 글로 잇는다("자동차 부품 · 방위산업").
  // 서버가 산업 칸을 주면 값이 없을 때 "산업 미확정"을 보인다. 칸 자체가 없으면(옛 응답) 아무것도 안 보인다.
  const industryNames =
    card.industries === undefined
      ? null
      : card.industries.length > 0
        ? card.industries
        : [listFilters.industryUnknown];
  const industriesEl = industryNames ? (
    <div style={labelStyle}>
      {industryNames.map((industry, index) => (
        <Fragment key={industry}>
          {index > 0 ? ' · ' : null}
          <span data-testid="card-industry-tag">{industry}</span>
        </Fragment>
      ))}
    </div>
  ) : null;
  // 표 줄(#981): 산업 아래에 "지역 · 거리"를 한 줄로 둔다. 예: "아산시 · 거산에서 8.2km"
  const placeEl =
    card.region !== undefined || typeof card.distanceKm === 'number' ? (
      <div style={{ color: listTheme.bodyFg, fontSize: typography.fontSizeSecondary }}>
        <span className="cand-row__label" style={labelStyle}>
          {listTable.columns.region}
        </span>
        {card.region !== undefined ? (
          <span
            data-testid="card-region"
            style={card.region ? undefined : { color: listTheme.headFg }}
          >
            {card.region ?? listFilters.regionUnknown}
          </span>
        ) : null}
        {card.region !== undefined && typeof card.distanceKm === 'number' ? ' · ' : null}
        {typeof card.distanceKm === 'number' ? (
          <span data-testid="card-distance-tag">{listFilters.cardDistance(card.distanceKm)}</span>
        ) : null}
      </div>
    ) : null;
  // 검토사항 줄: 확인할 것이 있거나 승인을 막으면 주의 글자로 띄운다. "없음 — …"은 보통 글자에 이름표를 붙인다.
  const blockerNeedsCheck = checkLine !== null || card.blocker.blocksApproval;
  // 관심 기업 줄은 열 머리가 없어 "추천 근거"·"검토사항" 이름표를 글 위에 늘 보인다(시안 Bookmarks).
  const blockLabel: CSSProperties = { ...labelStyle, display: 'block' };
  const reasonLines = (
    <>
      {/* 공장 정보 줄(업종·원자재·규모)은 카드에서 빼고 상세 "한눈에"에서 본다(#798, PM 지시 2026-11-16). */}
      {reasonSameAsPick ? null : (
        <div style={lineStyle} title={card.reason}>
          <span
            className={threeColumns ? undefined : 'cand-row__label'}
            style={threeColumns ? blockLabel : labelStyle}
          >
            {cardRows.reason}
          </span>
          <span data-testid="card-reason">{card.reason}</span>
        </div>
      )}
      {pickReason ? (
        <div style={lineStyle} title={pickReason}>
          <span style={{ ...labelStyle, marginRight: 8 }}>{candidateSearch.pickReasonRow}</span>
          <span data-testid="card-pick-reason">{pickReason}</span>
        </div>
      ) : null}
      <div
        style={
          threeColumns
            ? lineStyle
            : {
                color: blockerNeedsCheck ? listTheme.checkFg : listTheme.bodyFg,
                fontSize: typography.fontSizeSecondary,
              }
        }
        title={blockerLine}
      >
        <span
          className={!threeColumns && checkLine !== null ? 'cand-row__label' : undefined}
          style={threeColumns ? blockLabel : { ...labelStyle, marginRight: 8 }}
        >
          {cardRows.blocker}
        </span>
        <span data-testid="card-blocker">{blockerLine}</span>
      </div>
      {/* 후속 조치는 카드에 두지 않고 상세 "1. 추천 근거와 후속 조치"에서 읽는다(#647, PM 결정 2026-11-13). */}
      {adjustLine ? (
        <div style={{ ...lineStyle, fontSize: typography.fontSizeSecondary }} title={adjustLine}>
          <span style={{ ...labelStyle, marginRight: 8 }}>{contactBuckets.adjustRow}</span>
          <span data-testid="card-rank-adjust">{adjustLine}</span>
        </div>
      ) : null}
      {preferenceLine ? (
        <div
          style={{ ...lineStyle, fontSize: typography.fontSizeSecondary }}
          title={preferenceLine}
        >
          <span style={{ ...labelStyle, marginRight: 8 }}>{contactBuckets.adjustRow}</span>
          <span data-testid="card-preference">{preferenceLine}</span>
        </div>
      ) : null}
      {ownPlatingBasis ? (
        <div
          style={{ ...lineStyle, fontSize: typography.fontSizeSecondary }}
          title={ownPlatingBasis}
        >
          <span style={{ ...labelStyle, marginRight: 8 }}>{ownPlatingLine.basisLabel}</span>
          <span data-testid="card-own-plating-basis">{ownPlatingBasis}</span>
        </div>
      ) : null}
    </>
  );
  const tags = [
    showClassification ? (
      <span
        key="classification"
        role="group"
        aria-label={`분류: ${classification}`}
        data-testid="card-classification"
      >
        <StatusTag tone={tone} bold={card.classificationCode === 'CONTACT_URGENT'}>
          {classification}
        </StatusTag>
      </span>
    ) : null,
    closedBasis ? (
      <StatusTag key="closed" tone="neutral" data-testid="card-bucket-basis">
        {closedBasis}
      </StatusTag>
    ) : null,
    // 적합도 꼬리표: 관심 기업 줄에서는 여기, 거래처 후보 줄에서는 점수 옆(#981)에 보인다.
    fitTag && threeColumns ? (
      <StatusTag key="fit" tone="neutral" data-testid="card-fit-level">
        {fitTag}
      </StatusTag>
    ) : null,
    ...confirmedProcessCodes.map((code) =>
      processNames?.[code] ? (
        <StatusTag key={`process-${code}`} tone="neutral" data-testid="card-process-tag">
          {processNames[code]}
        </StatusTag>
      ) : null,
    ),
    card.isVirtual ? (
      <StatusTag key="virtual" tone="wait" data-testid="card-virtual-tag">
        {cardRows.virtualTag}
      </StatusTag>
    ) : null,
    card.datasetKind === 'BROCHURE' ? (
      <StatusTag key="brochure" tone="ask" data-testid="card-brochure-tag">
        {cardRows.brochureTag}
      </StatusTag>
    ) : null,
    stageStatus && stageStatus !== 'NOT_EXECUTED' ? (
      <StatusTag key="stage" tone={outcomeStatusTone[stageStatus] ?? 'neutral'}>
        <span data-testid="card-stage-tag">
          {outcomeStatusLabels[stageStatus]}
          {card.salesStep ? ` · ${salesStepLabels[card.salesStep]}` : ''}
        </span>
      </StatusTag>
    ) : null,
    card.reevaluated ? (
      <StatusTag key="reevaluated" tone="ok" data-testid="card-reevaluated-tag">
        {cardRows.reevaluated}
      </StatusTag>
    ) : null,
    ownPlating ? (
      <StatusTag key="own-plating" tone="ask" data-testid="card-own-plating-tag">
        {ownPlatingLine.tag}
      </StatusTag>
    ) : null,
    // #860: 공급망 위치 AI 추정. 모름·판단 전이면 붙이지 않는다. 근거는 상세 "한눈에"에서.
    card.supplyTier === 'TIER2_3' || card.supplyTier === 'TIER1' ? (
      <span
        key="supply-tier"
        data-testid="card-supply-tier-tag"
        data-tier={card.supplyTier}
        title={card.supplyTierBasis ?? undefined}
      >
        <StatusTag tone="ask">{supplyTierLabels.tag[card.supplyTier]}</StatusTag>
      </span>
    ) : null,
  ].filter((tag) => tag !== null);
  const tagsEl =
    tags.length > 0 ? (
      <div
        role="group"
        aria-label={listTable.tagsLabel}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
      >
        {tags}
      </div>
    ) : null;
  // 점수 칸: 점수 전이면 "점수 전 · 조사 중", 근거 있음 묶음이면 서버 점수 글자(숫자만 크게), 그 밖에는 비운다.
  const scoreEl = (numberSize: number) =>
    beforeScore ? (
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
              : card.researchState === 'NOT_TRIED'
                ? candidateSearch.researchNotYet
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
        numberSize={numberSize}
        // #981: 거래처 후보 줄은 점수만 보인다("· 4/8"은 상세에서 본다).
        scoreOnly={!threeColumns}
        testId="card-score"
      />
    ) : null;
  const opinionEl = (
    <OpinionArea
      key={`${card.oppId}:${card.evalId}`}
      oppId={card.oppId}
      evalId={card.evalId}
      record={card.records.opinion ?? null}
      onSaved={() => {
        void bookmarkState.sync();
        onOpinionSaved?.();
      }}
      // #798: 카드는 단추 셋 대신 고르기 칸 하나로 줄인다.
      variant="select"
      // #981: 관심에 담았는데 의견을 아직 안 골랐으면 고르기 칸을 주황 테두리로 띄우고 한 줄로 알린다.
      // 이미 접촉·견적 단계로 간 회사는 알리지 않는다(영업 홈 "의견 전" 칸과 같은 기준).
      nudge={
        bookmarkState.bookmark?.active === true &&
        (stageStatus === null || stageStatus === 'NOT_EXECUTED')
      }
    />
  );
  const bookmarkEl = (
    <BookmarkButton
      oppId={card.oppId}
      bookmark={bookmarkState.bookmark}
      onChanged={(next) => {
        bookmarkState.change(next);
        if (next.active) onBookmarkedOn?.(card);
      }}
      // #972: 줄에서는 별 그림 단추. "담당자를 고르면" 안내는 의견 칸 아래 한 줄과 별의 손 올림 글이 대신한다.
      variant="star"
      hideStaffHint
    />
  );
  const detailEl = (
    <Button
      size="small"
      type={threeColumns ? 'primary' : 'default'}
      href={detailPath}
      onClick={(event) => {
        event.preventDefault();
        navigate(detailPath);
      }}
      // 단추 모양 링크라 밑줄을 긋지 않고, 줄 안에서는 작은 글자로 둔다.
      style={{ fontSize: typography.fontSizeSecondary, textDecoration: 'none' }}
      data-testid="card-view-detail-link"
    >
      {frame.viewDetail} <span aria-hidden="true">→</span>
    </Button>
  );
  const rowStyle: CSSProperties = {
    padding: '14px 0',
    borderBottom: `1px solid ${listTheme.rowLine}`,
  };
  const cellStack: CSSProperties = { display: 'grid', gap: 4, alignContent: 'start' };
  const titleWrap: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '2px 8px',
    minWidth: 0,
  };

  if (threeColumns) {
    // 다음 일정(영업 단계 기록의 nextScheduleAt): 응답에 있을 때만 보인다. 오늘(한국 날짜)보다 앞이면 "지난 일정"으로
    // 주의색 굵게. 값이 없으면 줄을 그리지 않는다(지어내지 않는다).
    const outcome = card.records.outcome ?? null;
    const scheduleDay = formatMonthDay(outcome?.nextScheduleAt);
    const scheduleDate = formatDate(outcome?.nextScheduleAt);
    const overdue = scheduleDate !== null && scheduleDate < todayKst();
    const scheduleNote = outcome?.nextScheduleNote?.trim() || null;
    // 접촉 요약(#976): 서버가 방법별 접촉 수를 줄 때만 만든다(옛 서버 응답이면 지어내지 않는다).
    const methods = card.contactByMethod ?? null;
    const contactTotal = methods ? methods.call + methods.email + methods.visit : 0;
    const lastContactDay = formatMonthDay(card.lastContactAt);
    // 두 조각("접촉 2회 (전화 1 · 메일 1)" · "마지막 접촉 11/25")은 저마다 한 줄로 두어, 칸이 좁으면 " · "에서 줄이 바뀐다.
    const contactLine = !methods ? null : contactTotal === 0 ? (
      listTable.contactNone
    ) : (
      <>
        <span style={{ whiteSpace: 'nowrap' }}>
          {listTable.contactTotal(
            contactTotal,
            reportView.sales.contactParts(methods.call, methods.email, methods.visit),
          )}
        </span>
        {lastContactDay ? (
          <>
            {' · '}
            <span style={{ whiteSpace: 'nowrap' }}>{listTable.contactLast(lastContactDay)}</span>
          </>
        ) : null}
      </>
    );
    // 다음 일정이 없을 때 "다음 일정 없음"은 접촉 요약을 주는 서버일 때만 적는다(일정이 정말 없다는 뜻).
    const scheduleLine = scheduleDay
      ? overdue
        ? dashboardTexts.tableOverdue(scheduleDay)
        : listTable.nextSchedule(scheduleDay, scheduleNote)
      : methods
        ? listTable.nextScheduleNone
        : null;
    const bigScore = scoreEl(listTheme.scoreSizeLarge);
    // 관심 기업 줄(#972 시안 Bookmarks): 회사·품목·꼬리표 | 추천 근거 / 검토사항 | 큰 점수 · 다음 일정 · 의견 · [자세히 보기].
    return (
      <article
        className="cand-row cand-row--three"
        data-testid="opportunity-card"
        data-layout="bookmark"
        style={{ ...rowStyle, padding: '20px 0' }}
      >
        <div className="cand-row__cell" style={{ ...cellStack, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            {rankEl}
            <div style={titleWrap}>{titleEl}</div>
          </div>
          {industriesEl}
          {tags.length > 0 || ingestedTag || typeof card.distanceKm === 'number' ? (
            <div
              role="group"
              aria-label={listTable.tagsLabel}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
            >
              {tags}
              {ingestedTag}
              {/* 지역 칸이 없는 줄이라 거리는 꼬리표로 보인다(#666). 좌표를 못 찾은 회사는 붙이지 않는다. */}
              {typeof card.distanceKm === 'number' ? (
                <StatusTag tone="neutral" data-testid="card-distance-tag">
                  {listFilters.cardDistance(card.distanceKm)}
                </StatusTag>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="cand-row__cell" style={{ ...cellStack, gap: 8 }}>
          {reasonLines}
        </div>
        <div className="cand-row__cell cand-row__side">
          {bigScore ? (
            <div data-testid="card-score-big" className="cand-row__side-score">
              {bigScore}
            </div>
          ) : null}
          {contactLine || scheduleLine ? (
            // 연보라 칸(#976 시안): 접촉 요약 한 줄 + 다음 일정 한 줄. 색만으로 알리지 않게 글자가 늘 함께 있다.
            <div
              role="group"
              aria-label={listTable.contactBoxLabel}
              data-testid="card-contact-box"
              style={{
                display: 'grid',
                gap: 2,
                padding: '8px 10px',
                borderRadius: radius.control,
                background: accent.soft,
              }}
            >
              {contactLine ? (
                <div data-testid="card-contact-summary" style={contactLineStyle}>
                  {contactLine}
                </div>
              ) : null}
              {scheduleLine ? (
                <div
                  data-testid="card-next-schedule"
                  data-overdue={overdue ? 'true' : undefined}
                  style={
                    overdue
                      ? {
                          color: listTheme.overdueFg,
                          fontSize: typography.fontSizeSecondary,
                          fontWeight: 600,
                        }
                      : contactLineStyle
                  }
                >
                  {scheduleLine}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="cand-row__actions-main">
            {opinionEl}
            {bookmarkEl}
          </div>
          {detailEl}
        </div>
      </article>
    );
  }

  const score = scoreEl(listTheme.scoreSize);
  // 거래처 후보 줄(#981 시안 "2-수정안"): 회사 이름 · 품목 · 산업 · 지역·거리 | 추천 근거 + 검토사항 + 꼬리표 |
  // 점수 · 적합도 · 관심 별 + 의견 고르기. 열 너비는 styles.css의 .cand-row가 줄마다 똑같이 잡는다.
  // 좁으면 칸이 세로로 쌓이고 칸 이름표가 보인다.
  return (
    <article
      className="cand-row"
      data-testid="opportunity-card"
      data-layout="table"
      style={rowStyle}
    >
      <div className="cand-row__cell" style={cellStack}>
        {/* 번호는 왼쪽에 고정하고, 긴 회사 이름은 그 옆에서 줄을 바꾼다. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {rankEl}
          <div style={{ ...cellStack, minWidth: 0 }}>
            {titleEl}
            {ingestedTag ? <div>{ingestedTag}</div> : null}
            {industriesEl}
            {placeEl}
          </div>
        </div>
      </div>
      <div className="cand-row__cell" style={{ ...cellStack, gap: 6 }}>
        {reasonLines}
        {tagsEl}
      </div>
      <div className="cand-row__cell cand-row__actions">
        <div className="cand-row__score-line">
          {/* 적합도는 점수 앞에 둔다(#981 PM 결정): 적합도가 없는 줄도 점수가 같은 자리(별 바로 왼쪽)에 온다. */}
          <div className="cand-row__score">
            {fitTag ? (
              <StatusTag
                tone={card.fitLevel === 'HIGH' ? 'ask' : 'neutral'}
                data-testid="card-fit-level"
              >
                {fitTag}
              </StatusTag>
            ) : null}
            {score ? (
              <span className="cand-row__label" style={labelStyle}>
                {listTable.scoreLabel}
              </span>
            ) : null}
            {score}
          </div>
          {bookmarkEl}
        </div>
        <div className="cand-row__actions-main">{opinionEl}</div>
      </div>
    </article>
  );
}
