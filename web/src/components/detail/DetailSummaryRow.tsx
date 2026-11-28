// 기업 상세 머리의 요약 줄(#996, PM 결정 2026-11-29): 산업 · 공정 · 소재 · 위치와 거리 · 홈페이지를 연보라 칸 한 줄에.
// 전에는 "한눈에 › 거산과 맞는 점"과 "어떤 회사"에 흩어져 있던 값이다. 값과 확인 표시(✓ 확인됨 · ○ AI 제안 · 확인 전 ·
// 확인 전)는 그때와 같다. 좁으면 줄이 바뀐다.
// 줄 끝 [정보 고치기]를 누르면 바로 아래에 지금의 고치기 부품(공정 · 소재 · 산업)이 펼쳐지고 다시 누르면 접힌다.
// 고치기 동작 · 저장 · 안내는 그 부품들이 지금처럼 한다. 주소 고치기는 "한눈에"의 위치 줄에 있다.
// 예외(#677): 확정한 공정과 다른 AI 공정 제안이 있으면 접힌 칸 안이 아니라 요약 줄 바로 아래에 늘 보인다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DetailHeader, EvidenceView, ProcessLinkView, ReviewItem } from '../../api/types';
import {
  companyGlance,
  companySummary,
  detailCompose,
  detailReport,
  filterStateLabels,
  labelFor,
  materialLabels,
} from '../../labels/ko';
import { accent, colors, detailLayout, radius, typography } from '../../theme/tokens';
import { shortenProvince } from '../common/mapLinks';
import { REVIEW_FOLD_NAME_LIMIT } from '../review/ReviewArea';
import { pickGlanceLink } from './CompanyGlance';
import FitMark from './FitMark';
import MaterialFix from './MaterialFix';
import type { MaterialOption } from './MaterialFix';
import ProcessDifference from './ProcessDifference';
import ProcessFix from './ProcessFix';
import type { ProcessOption } from './ProcessFix';
import { processStateOf } from './glanceState';

const texts = detailCompose.summary;
const glance = detailReport.glance;
const small = { color: colors.textDimmed, fontSize: detailLayout.smallFont } as const;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/** 줄여 쓴 도 이름. 뒤에 시·군이 따라오면 요약 줄에서는 뺀다("충남 천안시 동남구" → "천안시 동남구"). */
const SHORT_PROVINCES = new Set([
  '충남',
  '충북',
  '경남',
  '경북',
  '전남',
  '전북',
  '경기',
  '강원',
  '제주',
]);
/** 줄여 쓴 특별시·광역시 이름. 뒤의 구 이름과 함께 남긴다("서울 강남구"). */
const SHORT_METROS = new Set(['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종']);
const DISTRICT = /(시|군|구)$/;

/**
 * 요약 줄에 보일 짧은 위치: "충청남도 천안시 동남구 성남면 …" → "천안시 동남구".
 * 도 이름은 빼고, 그 뒤 시·군·구로 끝나는 낱말을 두 개까지 모은다(읍·면·동·길 앞에서 멈춘다).
 * 그런 낱말이 없으면 받은 주소를 그대로 돌려준다.
 */
export function shortLocationOf(address: string): string {
  const words = shortenProvince(address)
    .split(/\s+/)
    .filter((word) => word);
  const picked: string[] = [];
  if (SHORT_PROVINCES.has(words[0])) words.shift();
  else if (SHORT_METROS.has(words[0])) picked.push(words.shift() as string);
  for (const word of words) {
    if (!DISTRICT.test(word) || picked.length >= 2) break;
    picked.push(word);
  }
  const districts = picked.filter((word) => DISTRICT.test(word));
  return districts.length > 0 ? picked.join(' ') : address.trim();
}

function Chip({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}
    >
      <span style={small}>{label}</span>
      <span>{children}</span>
    </span>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 1, height: 16, background: detailLayout.summaryBorder, flex: 'none' }}
    />
  );
}

function FixRow({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: '64px minmax(0, 1fr)',
        columnGap: 12,
        alignItems: 'baseline',
        padding: '8px 0',
        borderTop: `1px solid ${colors.borderSecondary}`,
      }}
    >
      <span style={small}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export interface DetailSummaryRowProps {
  oppId: string;
  /** 본 평가 ID. "AI는 다르게 봄"에서 고를 때 쓴다. */
  evalId: string | null;
  header: DetailHeader;
  processLinks: ProcessLinkView[];
  evidence: EvidenceView[];
  reviewItems?: ReviewItem[];
  /** 공정 [고치기]의 보기(거산 공정 목록). 없으면 [고치기]를 보이지 않는다. */
  processOptions?: ProcessOption[];
  /** 소재 [고치기]의 보기(거산 처리 소재). 없으면 [고치기]를 보이지 않는다. */
  materialOptions?: MaterialOption[];
  /** 산업 [확정]·[고치기] 칩(IndustryChips). 고치기 칸의 산업 줄에 놓는다. */
  industryEditor?: ReactNode;
  /** 공정·소재를 고쳐 저장한 뒤(다시 평가되므로 상세와 활동 이력을 새로 불러오게). */
  onSaved: () => void;
}

export default function DetailSummaryRow({
  oppId,
  evalId,
  header,
  processLinks,
  evidence,
  reviewItems = [],
  processOptions,
  materialOptions,
  industryEditor,
  onSaved,
}: DetailSummaryRowProps) {
  const [fixOpen, setFixOpen] = useState(false);
  const panelId = `detail-summary-fix-${oppId}`;

  const industries = header.industries ?? [];
  // 사람이 확인한 산업(사례 파일·담당자 확정)만 초록 체크다. AI가 붙인 값은 중립 표시.
  const industryConfirmed =
    header.industriesSource === 'CASE_FILE' || header.industriesSource === 'STAFF';
  const { confirmed, proposedNames, proposals } = processStateOf(header, processLinks, reviewItems);
  const firstLink = confirmed[0] ?? null;
  const materialLink = confirmed.find((row) => row.appliedMaterial) ?? null;
  // #677: 사람이 확정한 공정이 있는데 AI가 다른 공정을 제안했다. 덮어쓰지 않고 줄로 알린다.
  const showDifference = confirmed.length > 0 && proposals.length > 0;
  const address = header.address?.trim() || null;
  const distance = header.distanceKm ?? null;
  const link = pickGlanceLink(header, evidence);
  const researched = Boolean(header.researchedAt) || evidence.length > 0;
  // #511: 공식 홈페이지 대신 찾은 공개 페이지면 링크 옆에 "확인 필요 · 이유 · 확신도"를 보인다.
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

  const processValue = firstLink ? (
    <>
      {firstLink.processName || firstLink.processCode}{' '}
      <FitMark kind="confirmed" text={glance.markConfirmed} />
      {confirmed.length > 1 ? ` ${glance.moreCount(confirmed.length - 1)}` : null}
    </>
  ) : proposedNames.length > 0 ? (
    <>
      {glance.processProposedNames(
        proposedNames.slice(0, REVIEW_FOLD_NAME_LIMIT),
        Math.max(0, proposedNames.length - REVIEW_FOLD_NAME_LIMIT),
      )}{' '}
      <FitMark kind="ai" text={glance.markAi} />
    </>
  ) : (
    glance.pending
  );
  const materialValue = materialLink?.appliedMaterial ? (
    <>
      {labelFor(materialLabels, materialLink.appliedMaterial)}{' '}
      {materialLink.result === 'PASS' ? (
        <FitMark kind="confirmed" text={filterStateLabels.PASS} />
      ) : materialLink.result ? (
        `· ${labelFor(filterStateLabels, materialLink.result)}`
      ) : null}
    </>
  ) : (
    glance.pending
  );

  return (
    <div data-testid="detail-summary" style={{ display: 'grid', gap: 8 }}>
      <div
        role="group"
        aria-label={texts.aria}
        data-testid="detail-summary-row"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '10px 14px',
          padding: '10px 14px',
          borderRadius: radius.card,
          background: detailLayout.summaryBg,
          border: `1px solid ${detailLayout.summaryBorder}`,
        }}
      >
        <Chip label={texts.industry} testId="glance-fit-industry">
          {industries.length > 0 ? (
            <>
              {industries.join(' · ')}{' '}
              <FitMark
                kind={industryConfirmed ? 'confirmed' : 'ai'}
                text={industryConfirmed ? glance.markConfirmed : glance.markAi}
              />
            </>
          ) : (
            glance.pending
          )}
        </Chip>
        <Divider />
        <Chip label={texts.process} testId="glance-fit-process">
          {processValue}
        </Chip>
        <Divider />
        <Chip label={texts.material} testId="glance-fit-material">
          {materialValue}
        </Chip>
        <Divider />
        <Chip label={texts.location} testId="detail-summary-location">
          {address ? (
            <>
              <span title={address} data-testid="detail-summary-address">
                {shortLocationOf(address)}
              </span>
              {/* 거산 본사까지의 직선거리(#666). 계산한 숫자라 확인 표시는 없다. */}
              {distance !== null ? (
                <>
                  {' · '}
                  <strong data-testid="detail-distance">{companySummary.distance(distance)}</strong>
                </>
              ) : null}
            </>
          ) : (
            glance.pending
          )}
        </Chip>
        <Divider />
        <span
          data-testid="glance-homepage"
          // 공식 홈페이지가 아니라는 안내("확인 필요 · …")가 붙으면 길어지므로 좁은 칸에서는 줄이 바뀌게 둔다.
          style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}
        >
          {link?.kind === 'homepage' ? (
            <span data-testid="detail-homepage">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.url}
                style={{ textDecoration: 'underline', whiteSpace: 'nowrap' }}
              >
                {texts.homepage} <span aria-hidden="true">↗</span>
              </a>
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
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.url}
                style={{ textDecoration: 'underline' }}
              >
                {link.kind === 'search' ? companyGlance.searchPage : companyGlance.evidencePage}{' '}
                <span aria-hidden="true">↗</span>
              </a>
            </span>
          ) : (
            <span style={secondary} data-testid="glance-no-homepage">
              {researched || header.homepageStatus === 'NOT_FOUND'
                ? companyGlance.noHomepage
                : glance.notResearched}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-expanded={fixOpen}
          aria-controls={panelId}
          onClick={() => setFixOpen((open) => !open)}
          data-testid="detail-summary-fix-toggle"
          style={{
            marginLeft: 'auto',
            padding: 0,
            border: 0,
            background: 'none',
            color: accent.text,
            font: 'inherit',
            fontSize: typography.fontSizeSecondary,
            textDecoration: 'underline',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {fixOpen ? texts.fixClose : texts.fixOpen}
        </button>
      </div>
      {showDifference ? (
        <ProcessDifference
          oppId={oppId}
          evalId={evalId}
          proposals={proposals}
          confirmedNames={confirmed.map((row) => row.processName || row.processCode)}
          onSaved={onSaved}
        />
      ) : null}
      {fixOpen ? (
        <section
          id={panelId}
          aria-label={texts.fixPanel}
          data-testid="detail-summary-fix-panel"
          style={{
            padding: '4px 14px 8px',
            borderRadius: radius.card,
            background: colors.bgContainer,
            border: `1px solid ${colors.borderSecondary}`,
          }}
        >
          <FixRow label={texts.process} testId="detail-summary-fix-process">
            <span>
              {firstLink ? firstLink.processName || firstLink.processCode : glance.pending}
            </span>
            {processOptions ? (
              <ProcessFix
                oppId={oppId}
                current={confirmed.map((row) => row.processCode)}
                options={processOptions}
                onSaved={onSaved}
              />
            ) : null}
          </FixRow>
          <FixRow label={texts.material} testId="detail-summary-fix-material">
            <span>
              {materialLink?.appliedMaterial
                ? labelFor(materialLabels, materialLink.appliedMaterial)
                : glance.pending}
            </span>
            {materialOptions ? (
              <MaterialFix
                oppId={oppId}
                current={materialLink?.appliedMaterial ?? null}
                hasProcess={confirmed.length > 0}
                options={materialOptions}
                onSaved={onSaved}
              />
            ) : null}
          </FixRow>
          {industryEditor ? (
            <FixRow label={texts.industry} testId="detail-summary-fix-industry">
              {industryEditor}
            </FixRow>
          ) : null}
          <FixRow label={texts.homepage} testId="detail-summary-fix-homepage">
            {link ? (
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline', overflowWrap: 'anywhere' }}
                data-testid="detail-summary-homepage-url"
              >
                {link.url}
              </a>
            ) : (
              <span style={secondary}>
                {researched || header.homepageStatus === 'NOT_FOUND'
                  ? companyGlance.noHomepage
                  : glance.notResearched}
              </span>
            )}{' '}
            <span style={secondary} data-testid="detail-summary-homepage-how">
              {texts.homepageHow}
            </span>
          </FixRow>
        </section>
      ) : null}
    </div>
  );
}
