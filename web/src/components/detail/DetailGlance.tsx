// 상세 "한눈에" 상자(#674, PM 결정 2026-11-13): 어떤 회사 / 거산과 맞는 점 / 근거 상태 / 확인할 것 / 영업 상태.
// 전에는 머리에 흩어져 있던 홈페이지 줄·대표번호 줄·공장 정보 줄·산업 꼬리표·접촉 횟수를 이 상자 한 곳에 모은다.
// 모두 상세 응답에 이미 있는 값이고 읽기만 한다(단추·입력 없음. 링크는 새 창).
// 예외 하나(#677): 확정한 공정과 다른 AI 공정 제안이 있으면 공정 줄 아래에 [확정 값 유지]·[○○도 추가]가 보인다.
// 값이 없는 줄은 줄째 빼거나 "확인 전"·"아직 조사 전"으로 적는다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ContactCount,
  DetailHeader,
  DetailMap,
  EvidenceView,
  KnownSalesAnswer,
  ProcessLinkView,
  RequirementCheckView,
  ReviewItem,
  ScoreItemView,
} from '../../api/types';
import {
  cardRows,
  companyGlance,
  companySummary,
  detailReport,
  factoryProfileLabels,
  filterStateLabels,
  glanceVisual,
  homepageLinkLabel,
  labelFor,
  mapLinkLabels,
  materialLabels,
  recordsArea,
  supplyTierLabels,
} from '../../labels/ko';
import {
  colors,
  detailTheme,
  radius,
  spacing,
  statusPalette,
  typography,
} from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { daysAgo, formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { buildMapLinks } from '../common/mapLinks';
import { useFrame } from '../frame/FrameContext';
import { choiceMarksOf } from '../records/ChoiceQuestion';
import { processNameOf, REVIEW_FOLD_NAME_LIMIT } from '../review/ReviewArea';
import { pickGlanceLink } from './CompanyGlance';
import DetailMiniMap from './DetailMiniMap';
import ProcessFix from './ProcessFix';
import type { ProcessOption } from './ProcessFix';
import ProcessDifference from './ProcessDifference';
import type { ProcessProposal } from './ProcessDifference';

const texts = detailReport.glance;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 } as const;

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value) && /^https?:\/\/\S+$/.test(value as string);
}

/** 확정된 공정 연결(같은 공정은 한 번)과 AI가 제안만 한 공정 이름. "왜 추천했나" 줄(#659)과 같은 기준이다. */
export function processStateOf(
  header: DetailHeader,
  processLinks: ProcessLinkView[],
  reviewItems: ReviewItem[],
): { confirmed: ProcessLinkView[]; proposedNames: string[]; proposals: ProcessProposal[] } {
  const marks = choiceMarksOf({ processLinks, reviewItems, header }).process;
  const seen = new Set<string>();
  const confirmed = processLinks.filter((link) => {
    if (marks[link.processCode] !== 'CONFIRMED' || seen.has(link.processCode)) return false;
    seen.add(link.processCode);
    return true;
  });
  const nameOfLink = new Map(
    processLinks.map((link) => [link.processCode, link.processName || link.processCode]),
  );
  const proposals: ProcessProposal[] = [];
  for (const item of reviewItems) {
    if (item.kind !== 'PROCESS_LINK_PROPOSAL') continue;
    if (proposals.some((entry) => entry.itemId === item.itemId)) continue;
    const code = item.itemId.replace(/^PL:/, '');
    proposals.push({
      itemId: item.itemId,
      name: nameOfLink.get(code) ?? processNameOf(item) ?? code,
    });
  }
  const proposedNames = [...new Set(proposals.map((entry) => entry.name))];
  return { confirmed, proposedNames, proposals };
}

export interface DetailCheckWords {
  process: boolean;
  material: boolean;
  evidence: boolean;
  /** 이름 그대로 보이는 조건(확인이 필요한 요구 이름). */
  names: string[];
}

/**
 * "확인할 것" 낱말(카드 #659와 같은 말: 공정 · 소재 · 근거 부족 + 요구 이름).
 * 카드는 서버가 준 종류로 만들지만 상세 응답에는 그 칸이 없어, 상세에 있는 값으로 만든다:
 * 공정 = 확정된 공정이 없음(AI 제안뿐이거나 평가 전), 소재 = 판정 대기인 공정 연결에 적용 소재가 없음,
 * 근거 부족 = 핵심 근거 재확인 표시이거나 평가 전, 이름 = 판정이 "확인 필요"인 요구.
 */
export function detailCheckWordsOf(
  header: DetailHeader,
  processLinks: ProcessLinkView[],
  reviewItems: ReviewItem[],
  requirements: RequirementCheckView[],
): DetailCheckWords {
  const notEvaluated = header.classificationCode === 'NOT_EVALUATED';
  const { confirmed, proposedNames } = processStateOf(header, processLinks, reviewItems);
  return {
    process: confirmed.length === 0 && (proposedNames.length > 0 || notEvaluated),
    material: processLinks.some(
      (link) => !link.appliedMaterial && (link.result === 'PENDING' || !link.result),
    ),
    evidence: header.coreEvidenceRecheck || notEvaluated,
    names: [
      ...new Set(
        requirements.filter((row) => row.result === 'QUESTION_NEEDED').map((row) => row.name),
      ),
    ],
  };
}

function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
      {children}
    </a>
  );
}

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px minmax(0, 1fr)',
        borderTop: `1px solid ${detailTheme.border}`,
      }}
    >
      {/* #759: 칸 나눔 표처럼 이름표 칸은 옅은 바탕, 값 칸은 흰 바탕. */}
      <dt
        style={{
          fontWeight: 600,
          color: colors.textSecondary,
          fontSize: typography.fontSizeSecondary,
          background: detailTheme.cellBg,
          padding: '10px 14px',
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, display: 'grid', gap: 4, padding: '10px 14px', minWidth: 0 }}>
        {children}
      </dd>
    </div>
  );
}

/**
 * "거산과 맞는 점"의 상태 표시(PM 지시 2026-11-13). 색으로만 구분하지 않게 모양과 글자를 함께 둔다.
 * confirmed = 사람이 확인한 값(사례 파일·담당자 확정): 초록 ✓ + "확인됨"(소재는 "통과").
 * ai = AI가 제안만 한 값: 회색 ○ + "AI 제안 · 확인 전". 초록을 쓰지 않는다.
 */
function FitMark({ kind, text }: { kind: 'confirmed' | 'ai'; text: string }) {
  const palette = kind === 'confirmed' ? statusPalette.ok : statusPalette.neutral;
  return (
    <span
      role="img"
      aria-label={kind === 'confirmed' ? texts.markConfirmedAria(text) : texts.markAiAria}
      data-testid="glance-fit-mark"
      data-mark={kind}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 10px',
        borderRadius: radius.pill,
        background: palette.bg,
        color: palette.fg,
        fontSize: typography.fontSizeSecondary,
        fontWeight: kind === 'confirmed' ? 600 : 400,
      }}
    >
      <span aria-hidden="true">{kind === 'confirmed' ? '✓' : '○'}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

function FitLine({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div style={line} data-testid={testId}>
      <span style={{ ...secondary, minWidth: 40 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export interface DetailGlanceProps {
  header: DetailHeader;
  processLinks: ProcessLinkView[];
  evidence: EvidenceView[];
  reviewItems?: ReviewItem[];
  requirements?: RequirementCheckView[];
  contactCount?: ContactCount | null;
  /** 마지막 접촉 날짜(YYYY-MM-DD). 없으면 그 말을 빼고 접촉 횟수만 보인다. */
  lastContactAt?: string | null;
  /** 아래 "2. 통화에서 확인할 것"에 보이는 줄 수(#691). 낱말이 없어도 줄이 있으면 "n가지"로 적는다. */
  callCheckCount?: number;
  /** 시험이 현재 시각에 기대지 않게 지금 시각을 받을 수 있다. */
  now?: Date;
  /**
   * 공정 줄 아래 "AI는 다르게 봄"에서 고를 때 쓰는 값(#677). 넘기지 않으면 그 줄을 그리지 않는다.
   * 이 상자에서 단추가 있는 곳은 그 줄뿐이다.
   */
  processChoice?: {
    oppId: string;
    evalId: string | null;
    onSaved: () => void;
    /** #847: 공정 줄 [고치기]의 보기(거산 공정 목록). 없으면 [고치기]를 보이지 않는다. */
    options?: ProcessOption[];
  };
  /** #803: 산업 칸 안에 바로 놓는 [확정]·[고치기] 칩(전에는 아래 "회사 소개 · 산업군" 카드). 없으면 글로만 보인다. */
  industryEditor?: ReactNode;
  /** #803: 근거 상태 막대(점수 8항목 가운데 근거가 붙은 항목 수). 없으면 막대를 그리지 않는다. */
  scoreItems?: ScoreItemView[];
  /** #803: 작은 지도 좌표(서버 detail.map). 없거나 지도를 못 그리면 거리 그림으로 대신한다. */
  map?: DetailMap | null;
  /** 시험용 지도 화면 키. 넘기지 않으면 환경 변수 값을 쓴다. */
  mapClientId?: string;
  /** #860: 통화에서 들은 "도금 업체는 누가 정하나요?" 답. 있으면 공급망 위치 줄에서 AI 추정보다 먼저 보인다. */
  plateDecider?: KnownSalesAnswer | null;
}

/** #860 공급망 위치 줄: 통화 답이 먼저, 그다음 AI 추정(2·3차·1차)과 근거·출처. 둘 다 없으면 그리지 않는다. */
function SupplyTierLine({
  header,
  plateDecider,
}: {
  header: DetailHeader;
  plateDecider?: KnownSalesAnswer | null;
}) {
  const tier =
    header.supplyTier === 'TIER2_3' || header.supplyTier === 'TIER1' ? header.supplyTier : null;
  // #890: AI가 "모름"으로 판단한 회사는 검토할 일로 보인다(통화 답이 있으면 그 답만).
  const unclear = header.supplyTier === 'UNKNOWN' && !plateDecider;
  if (!tier && !plateDecider && !unclear) return null;
  const hint = tier ? supplyTierLabels.hint[tier] : '';
  return (
    <div style={line} data-testid="glance-supply-tier">
      <span style={secondary}>{supplyTierLabels.label}</span>
      {plateDecider ? (
        <strong data-testid="glance-supply-tier-call">
          {supplyTierLabels.called(plateDecider.answer, formatMonthDay(plateDecider.at) ?? '')}
        </strong>
      ) : null}
      {tier ? (
        <span
          data-testid="glance-supply-tier-ai"
          data-tier={tier}
          style={plateDecider ? secondary : undefined}
        >
          {[supplyTierLabels.value[tier], hint, header.supplyTierBasis?.trim()]
            .filter((part) => part)
            .join(' · ')}
        </span>
      ) : null}
      {unclear ? (
        <span data-testid="glance-supply-tier-unclear">
          <strong>{supplyTierLabels.unclear}</strong>
          {' · '}
          {header.supplyTierBasis?.trim() || supplyTierLabels.unclearDefault}
          <span style={secondary}> — {supplyTierLabels.unclearAsk}</span>
        </span>
      ) : null}
      {tier && header.supplyTierSource ? (
        <span style={secondary}>({supplyTierLabels.source[header.supplyTierSource]})</span>
      ) : null}
    </div>
  );
}

/** #803 근거 상태 막대: 근거가 붙은 항목 수를 길이로. */
function EvidenceBar({ items }: { items: ScoreItemView[] }) {
  const total = items.length;
  if (total === 0) return null;
  const withEvidence = items.filter((item) => (item.evidenceIds ?? []).length > 0).length;
  const percent = Math.round((withEvidence / total) * 100);
  return (
    <div
      data-testid="glance-evidence-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}
    >
      <span
        role="img"
        aria-label={glanceVisual.evidenceBar(withEvidence, total)}
        style={{
          position: 'relative',
          width: 140,
          height: 8,
          borderRadius: radius.pill,
          background: detailTheme.bandTodo,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            width: `${percent}%`,
            background: detailTheme.accentBar,
          }}
        />
      </span>
      <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
        {glanceVisual.evidenceBar(withEvidence, total)}
      </span>
    </div>
  );
}

/** #803 거리 그림: 거산 ●───── 8.2km ─────● 이 회사 (좌표 없이 숫자만으로 그린다). */
function DistanceLine({ km }: { km: number }) {
  const dot = {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    background: detailTheme.lineDone,
    flexShrink: 0,
  } as const;
  const bar = { flex: 1, height: 2, background: detailTheme.lineTodo, minWidth: 16 } as const;
  return (
    <span
      aria-hidden="true"
      data-testid="glance-distance-line"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 320,
        color: colors.textSecondary,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      <span>{glanceVisual.hq}</span>
      <span style={dot} />
      <span style={bar} />
      <span>{`${km.toFixed(1)}km`}</span>
      <span style={bar} />
      <span style={dot} />
      <span>{glanceVisual.company}</span>
    </span>
  );
}

export default function DetailGlance({
  header,
  processLinks,
  evidence,
  reviewItems = [],
  requirements = [],
  contactCount,
  lastContactAt,
  callCheckCount = 0,
  now,
  processChoice,
  industryEditor,
  scoreItems,
  map = null,
  mapClientId,
  plateDecider = null,
}: DetailGlanceProps) {
  const { config } = useFrame();
  // #803: 지도를 못 그리면(키 없음·인증 실패) 거리 그림으로 돌아간다.
  const [mapFailed, setMapFailed] = useState(false);

  // ── 어떤 회사
  const summary = header.summaryLine?.trim() || null;
  const item = header.opportunityItem?.trim() || null;
  const industries = header.industries ?? [];
  const factoryIntro = item ? companyGlance.produces(item) : null;
  const factoryLine = factoryProfileText(header.factoryProfile);
  const address = header.address?.trim() || null;
  const mapLinks = buildMapLinks(header.address);
  const link = pickGlanceLink(header, evidence);
  const phone = header.mainPhone ?? null;
  const telHref =
    phone && /^[0-9+()\-\s]+$/.test(phone) ? `tel:${phone.replace(/[^0-9+]/g, '')}` : null;
  const phoneSourceUrl = isHttpUrl(header.mainPhoneSourceUrl) ? header.mainPhoneSourceUrl : null;
  const phoneConfirmedName =
    config?.staff.find((entry) => entry.key === header.mainPhoneConfirmedBy)?.displayName ??
    header.mainPhoneConfirmedBy ??
    '';
  const highlights = header.highlights ?? [];
  const isAi = header.researchSource === 'AI';

  // ── 거산과 맞는 점
  const { confirmed, proposedNames, proposals } = processStateOf(header, processLinks, reviewItems);
  const firstLink = confirmed[0] ?? null;
  // #677: 사람이 확정한 공정이 있는데 AI가 다른 공정을 제안했다. 덮어쓰지 않고 줄로 알린다.
  const showDifference = Boolean(processChoice) && confirmed.length > 0 && proposals.length > 0;
  const materialLink = confirmed.find((row) => row.appliedMaterial) ?? null;
  // 사람이 확인한 산업(사례 파일·담당자 확정)만 초록 체크다. AI가 붙인 값은 중립 표시.
  const industryConfirmed =
    header.industriesSource === 'CASE_FILE' || header.industriesSource === 'STAFF';
  const distance = header.distanceKm ?? null;

  // ── 근거 상태
  const researched = Boolean(header.researchedAt) || evidence.length > 0;
  const homepageText =
    header.researchState === 'RUNNING'
      ? texts.researchRunning
      : header.homepageStatus === 'NOT_FOUND'
        ? header.homepageClosedReason
          ? texts.homepageClosed(header.homepageClosedReason)
          : texts.homepageNotFound
        : isHttpUrl(header.homepageUrl)
          ? texts.homepageFound
          : researched
            ? texts.homepageNone
            : texts.notResearched;
  // #511: 공식 홈페이지 대신 찾은 공개 페이지면 주소 옆에 "확인 필요 · 이유 · 확신도"를 보인다.
  const unofficialText =
    header.homepagePageKind && header.homepageStatus === 'NEEDS_CONFIRMATION'
      ? [
          companyGlance.needsConfirm,
          companyGlance.unofficialPage[header.homepagePageKind],
          typeof header.homepageConfidence === 'number'
            ? companyGlance.confidence(header.homepageConfidence)
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
      : null;
  const researchedDate = formatMonthDay(header.researchedAt);
  const ago = daysAgo(header.researchedAt, now);
  const researchedText =
    header.researchedAt && researchedDate
      ? header.researchSource === 'CASE_FILE'
        ? `${companySummary.caseFileBasis} · ${researchedDate}`
        : companySummary.researched(
            researchedDate,
            ago === null ? '' : ago === 0 ? companySummary.today : companySummary.daysAgo(ago),
          )
      : null;
  const evidenceParts = [
    texts.evidenceCount(evidence.length),
    homepageText,
    header.fitLevel
      ? header.fitBasis === 'HOMEPAGE'
        ? // #793: 홈페이지로 다시 정한 적합도는 기준과 처음(생산품 기준) 값을 함께 보인다.
          companyGlance.fitFromHomepage(
            companyGlance.fit[header.fitLevel],
            header.previousFitLevel && header.previousFitLevel !== header.fitLevel
              ? companyGlance.fitShort[header.previousFitLevel]
              : null,
          )
        : companyGlance.fit[header.fitLevel]
      : null,
    researchedText,
  ].filter((part): part is string => part !== null);

  // ── 확인할 것
  const check = detailCheckWordsOf(header, processLinks, reviewItems, requirements);
  const words: string[] = [];
  if (check.process) words.push(cardRows.checkWords.process);
  if (check.material) words.push(cardRows.checkWords.material);
  if (check.evidence) words.push(cardRows.checkWords.evidence);
  const checkText =
    words.length > 0 || check.names.length > 0
      ? texts.checkWords(words, check.names)
      : callCheckCount > 0
        ? texts.checkCallCount(callCheckCount)
        : texts.checkNone;

  // ── 영업 상태
  const lastContact = formatMonthDay(lastContactAt);
  const salesParts = contactCount
    ? [
        recordsArea.contactCount(
          contactCount.total,
          contactCount.call,
          contactCount.email,
          contactCount.visit,
        ),
        contactCount.total > 0 && lastContact ? texts.lastContact(lastContact) : null,
      ].filter((part): part is string => part !== null)
    : [];

  return (
    <section
      aria-labelledby="detail-glance-heading"
      data-testid="detail-glance"
      style={{
        display: 'grid',
        gap: 12,
        padding: spacing.cardPadding,
        background: colors.bgContainer,
        border: `1px solid ${detailTheme.border}`,
        borderRadius: detailTheme.radius,
      }}
    >
      <h2
        id="detail-glance-heading"
        style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        {texts.title}
      </h2>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          border: `1px solid ${detailTheme.border}`,
          borderTop: 0,
          borderRadius: detailTheme.radius,
          overflow: 'hidden',
        }}
      >
        <Row label={texts.company} testId="glance-company">
          <div
            data-testid="glance-company-layout"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}
          >
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid', gap: 8 }}>
              <div
                style={line}
                data-testid={summary ? 'company-summary-line' : 'glance-factory-intro'}
              >
                {summary ? (
                  <>
                    <span>{summary}</span>
                    {isAi ? <StatusTag tone="ask">{companySummary.aiSuggestion}</StatusTag> : null}
                  </>
                ) : factoryIntro ? (
                  <>
                    <span>{factoryIntro}</span>
                    <span style={secondary}>({companyGlance.factoryBasis})</span>
                  </>
                ) : (
                  <span style={secondary} data-testid="glance-not-researched">
                    {texts.notResearched}
                  </span>
                )}
              </div>
              {address || factoryLine ? (
                <div style={line} data-testid="glance-factory-profile">
                  <span>{[address, factoryLine].filter((part) => part).join(' · ')}</span>
                  {/* 주소와 나란히 거산 본사까지의 직선거리(#666, PM 요청: 주소와 같이 보고 비교). 계산한 숫자라 확인 표시는 없다. */}
                  {address && distance !== null ? (
                    <strong data-testid="detail-distance">
                      {companySummary.distance(distance)}
                    </strong>
                  ) : null}
                  {address && distance !== null && (!map || mapFailed) ? (
                    <DistanceLine km={distance} />
                  ) : null}
                  {factoryLine && header.factoryProfile ? (
                    <span style={secondary}>
                      (
                      {factoryProfileLabels.basis(
                        formatMonthDay(header.factoryProfile.fileDate) ?? '',
                      )}
                      )
                    </span>
                  ) : null}
                  {mapLinks ? (
                    <span
                      data-testid="detail-map-links"
                      style={{ display: 'inline-flex', gap: 12 }}
                    >
                      <a
                        href={mapLinks.naver}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'underline' }}
                        data-testid="detail-map-naver"
                      >
                        {mapLinkLabels.naver} ↗
                      </a>
                      <a
                        href={mapLinks.kakao}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'underline' }}
                        data-testid="detail-map-kakao"
                      >
                        {mapLinkLabels.kakao} ↗
                      </a>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <SupplyTierLine header={header} plateDecider={plateDecider} />
              <div style={line} data-testid="glance-homepage">
                <span style={secondary}>{companyGlance.homepage}</span>
                {link?.kind === 'homepage' ? (
                  <span data-testid="detail-homepage">
                    <ExternalLink url={link.url}>
                      {homepageLinkLabel} ↗ {link.url}
                    </ExternalLink>
                    {unofficialText ? (
                      <span style={secondary} data-testid="glance-homepage-unofficial">
                        {' '}
                        {unofficialText}
                      </span>
                    ) : null}
                  </span>
                ) : header.homepageStatus === 'NOT_FOUND' && header.homepageClosedReason ? (
                  // #793: 조사가 홈페이지를 닫힌 것으로 봤다. 닫힌 사이트의 옛 근거 주소 대신 이유를 보인다.
                  <span style={secondary} data-testid="glance-homepage-closed">
                    {companyGlance.homepageClosed(header.homepageClosedReason)}
                  </span>
                ) : link ? (
                  <span data-testid="glance-fallback-link" data-kind={link.kind}>
                    <ExternalLink url={link.url}>
                      {link.kind === 'search'
                        ? companyGlance.searchPage
                        : companyGlance.evidencePage}{' '}
                      ↗ {link.url}
                    </ExternalLink>
                  </span>
                ) : (
                  <span style={secondary} data-testid="glance-no-homepage">
                    {researched || header.homepageStatus === 'NOT_FOUND'
                      ? companyGlance.noHomepage
                      : texts.notResearched}
                  </span>
                )}
              </div>
              {phone ? (
                <div style={line} data-testid="company-phone">
                  <span style={secondary}>{texts.phone}</span>
                  {telHref ? (
                    <a href={telHref} data-testid="company-phone-link">
                      {phone}
                    </a>
                  ) : (
                    <span>{phone}</span>
                  )}
                  {phoneSourceUrl ? (
                    <span style={secondary}>
                      {companySummary.phoneSource}:{' '}
                      <a
                        href={phoneSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="company-phone-source"
                      >
                        {companySummary.phoneSourceHomepage} ↗
                      </a>
                    </span>
                  ) : header.mainPhoneSource === 'CSV' ? (
                    <span style={secondary} data-testid="company-phone-source">
                      {companySummary.phoneSource}: {companySummary.phoneSourceCsv}
                    </span>
                  ) : null}
                  <span style={secondary} data-testid="company-phone-status">
                    {header.mainPhoneConfirmedAt
                      ? companySummary.phoneConfirmed(
                          formatMonthDay(header.mainPhoneConfirmedAt) ?? '',
                          phoneConfirmedName,
                        )
                      : companySummary.phoneUnconfirmed}
                  </span>
                </div>
              ) : null}
              {highlights.length > 0 ? (
                <div style={line} data-testid="company-highlights">
                  <span style={secondary}>{texts.highlights}</span>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {highlights.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  {isAi ? <StatusTag tone="ask">{companySummary.aiSuggestion}</StatusTag> : null}
                </div>
              ) : null}
            </div>
            {map && !mapFailed ? (
              <DetailMiniMap
                map={map}
                href={mapLinks?.naver ?? null}
                onUnavailable={() => setMapFailed(true)}
                {...(mapClientId !== undefined ? { clientId: mapClientId } : {})}
              />
            ) : null}
          </div>
        </Row>

        <Row label={texts.fit} testId="glance-fit">
          <FitLine label={texts.process} testId="glance-fit-process">
            {firstLink ? (
              <>
                {firstLink.processName || firstLink.processCode}{' '}
                <FitMark kind="confirmed" text={texts.markConfirmed} />
                {confirmed.length > 1 ? ` ${texts.moreCount(confirmed.length - 1)}` : null}
              </>
            ) : proposedNames.length > 0 ? (
              <>
                {texts.processProposedNames(
                  proposedNames.slice(0, REVIEW_FOLD_NAME_LIMIT),
                  Math.max(0, proposedNames.length - REVIEW_FOLD_NAME_LIMIT),
                )}{' '}
                <FitMark kind="ai" text={texts.markAi} />
              </>
            ) : (
              texts.pending
            )}
            {processChoice?.options ? (
              <ProcessFix
                oppId={processChoice.oppId}
                current={confirmed.map((row) => row.processCode)}
                options={processChoice.options}
                onSaved={processChoice.onSaved}
              />
            ) : null}
          </FitLine>
          {showDifference && processChoice ? (
            <ProcessDifference
              oppId={processChoice.oppId}
              evalId={processChoice.evalId}
              proposals={proposals}
              confirmedNames={confirmed.map((row) => row.processName || row.processCode)}
              onSaved={processChoice.onSaved}
            />
          ) : null}
          <FitLine label={texts.material} testId="glance-fit-material">
            {materialLink?.appliedMaterial ? (
              <>
                {labelFor(materialLabels, materialLink.appliedMaterial)}{' '}
                {materialLink.result === 'PASS' ? (
                  <FitMark kind="confirmed" text={filterStateLabels.PASS} />
                ) : materialLink.result ? (
                  `· ${labelFor(filterStateLabels, materialLink.result)}`
                ) : null}
              </>
            ) : (
              texts.pending
            )}
          </FitLine>
          <FitLine label={texts.industry} testId="glance-fit-industry">
            {industryEditor ? (
              industryEditor
            ) : industries.length > 0 ? (
              <>
                {industries.join(', ')}{' '}
                {industryConfirmed ? (
                  <FitMark kind="confirmed" text={texts.markConfirmed} />
                ) : (
                  <FitMark kind="ai" text={texts.markAi} />
                )}
              </>
            ) : (
              texts.pending
            )}
          </FitLine>
        </Row>

        <Row label={texts.evidence} testId="glance-evidence">
          <div style={line}>
            <span data-testid="glance-evidence-text">{evidenceParts.join(' · ')}</span>
            {header.researchStale ? (
              <StatusTag tone="recheck" data-testid="company-stale-tag">
                {companySummary.stale}
              </StatusTag>
            ) : null}
            {header.researchSuggestAgain ? (
              <StatusTag tone="ask" data-testid="company-suggest-again-tag">
                {companySummary.suggestAgainTag}
              </StatusTag>
            ) : null}
          </div>
          {scoreItems ? <EvidenceBar items={scoreItems} /> : null}
        </Row>

        <Row label={texts.check} testId="glance-check">
          <span data-testid="glance-check-text">{checkText}</span>
        </Row>

        {salesParts.length > 0 ? (
          <Row label={texts.sales} testId="glance-sales">
            <span data-testid="detail-contact-count">{salesParts.join(' · ')}</span>
          </Row>
        ) : null}
      </dl>
    </section>
  );
}
