// 상세 "한눈에" 상자(#674, PM 결정 2026-11-13): 어떤 회사 / 거산과 맞는 점 / 근거 상태 / 확인할 것 / 영업 상태.
// 전에는 머리에 흩어져 있던 홈페이지 줄·대표번호 줄·공장 정보 줄·산업 꼬리표·접촉 횟수를 이 상자 한 곳에 모은다.
// 모두 상세 응답에 이미 있는 값이고 읽기만 한다(단추·입력 없음. 링크는 새 창).
// 값이 없는 줄은 줄째 빼거나 "확인 전"·"아직 조사 전"으로 적는다.
import type { ReactNode } from 'react';
import type {
  ContactCount,
  DetailHeader,
  EvidenceView,
  ProcessLinkView,
  RequirementCheckView,
  ReviewItem,
} from '../../api/types';
import {
  cardRows,
  companyGlance,
  companySummary,
  detailReport,
  factoryProfileLabels,
  filterStateLabels,
  homepageLinkLabel,
  labelFor,
  mapLinkLabels,
  materialLabels,
  recordsArea,
} from '../../labels/ko';
import { colors, spacing, statusPalette, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { daysAgo, formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { buildMapLinks } from '../common/mapLinks';
import { useFrame } from '../frame/FrameContext';
import { choiceMarksOf } from '../records/ChoiceQuestion';
import { processNameOf, REVIEW_FOLD_NAME_LIMIT } from '../review/ReviewArea';
import { pickGlanceLink } from './CompanyGlance';

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
): { confirmed: ProcessLinkView[]; proposedNames: string[] } {
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
  const proposedNames = [
    ...new Set(
      reviewItems
        .filter((item) => item.kind === 'PROCESS_LINK_PROPOSAL')
        .map((item) => {
          const code = item.itemId.replace(/^PL:/, '');
          return nameOfLink.get(code) ?? processNameOf(item) ?? code;
        }),
    ),
  ];
  return { confirmed, proposedNames };
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
      style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)', gap: 12 }}
    >
      <dt style={{ fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0, display: 'grid', gap: 4 }}>{children}</dd>
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
        borderRadius: 999,
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
}: DetailGlanceProps) {
  const { config } = useFrame();

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
  const { confirmed, proposedNames } = processStateOf(header, processLinks, reviewItems);
  const firstLink = confirmed[0] ?? null;
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
        ? texts.homepageNotFound
        : isHttpUrl(header.homepageUrl)
          ? texts.homepageFound
          : researched
            ? texts.homepageNone
            : texts.notResearched;
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
    header.fitLevel ? companyGlance.fit[header.fitLevel] : null,
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
        background: colors.bgLayout,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
      }}
    >
      <h2
        id="detail-glance-heading"
        style={{ margin: 0, fontSize: typography.fontSizeCardTitle, fontWeight: 600 }}
      >
        {texts.title}
      </h2>
      <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
        <Row label={texts.company} testId="glance-company">
          <div style={line} data-testid={summary ? 'company-summary-line' : 'glance-factory-intro'}>
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
              {factoryLine && header.factoryProfile ? (
                <span style={secondary}>
                  (
                  {factoryProfileLabels.basis(formatMonthDay(header.factoryProfile.fileDate) ?? '')}
                  )
                </span>
              ) : null}
              {mapLinks ? (
                <span data-testid="detail-map-links" style={{ display: 'inline-flex', gap: 12 }}>
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
          <div style={line} data-testid="glance-homepage">
            <span style={secondary}>{companyGlance.homepage}</span>
            {link?.kind === 'homepage' ? (
              <span data-testid="detail-homepage">
                <ExternalLink url={link.url}>
                  {homepageLinkLabel} ↗ {link.url}
                </ExternalLink>
              </span>
            ) : link ? (
              <span data-testid="glance-fallback-link" data-kind={link.kind}>
                <ExternalLink url={link.url}>
                  {link.kind === 'search' ? companyGlance.searchPage : companyGlance.evidencePage} ↗{' '}
                  {link.url}
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
          </FitLine>
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
            {industries.length > 0 ? (
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
          {distance !== null ? (
            <FitLine label={texts.distance} testId="company-distance">
              {companySummary.distance(distance)}
            </FitLine>
          ) : null}
        </Row>

        <Row label={texts.evidence} testId="glance-evidence">
          <div style={line}>
            <span data-testid="glance-evidence-text">{evidenceParts.join(' · ')}</span>
            {header.researchStale ? (
              <StatusTag tone="recheck" data-testid="company-stale-tag">
                {companySummary.stale}
              </StatusTag>
            ) : null}
          </div>
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
