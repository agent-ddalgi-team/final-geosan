// 상세 맨 위 "이 회사 한눈에"(#563, PM 요청 2026-11-11).
// ① 홈페이지 ② 한두 줄 소개 ③ 왜 이 회사인지·적합도를 한 칸에 모은다.
// 모두 서버가 이미 저장해 둔 값(조사 결과·후보 판단·공장 자료)이라 새 AI 호출이 없다.
// 값이 없으면 그다음 근거로 대신하고, 대신할 것도 없으면 그 줄을 짧게 안내하거나 뺀다.
import type { DetailHeader, EvidenceView, SourceGrade } from '../../api/types';
import {
  companyGlance,
  companySummary,
  factoryProfileLabels,
  homepageLinkLabel,
} from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 } as const;
const labelStyle = { fontWeight: 600, minWidth: 72 } as const;
const GRADE_ORDER: SourceGrade[] = ['A', 'B', 'C', 'D'];

function httpUrl(value: string | null | undefined): string | null {
  return value && /^https?:\/\/\S+$/.test(value) ? value : null;
}

type GlanceLink =
  | { kind: 'homepage'; url: string; needsConfirm: boolean }
  | { kind: 'search' | 'evidence'; url: string }
  | null;

/** 공식 홈페이지 → 검색에서 찾은 페이지 → 등급이 가장 높은 근거의 출처 페이지 순으로 고른다. */
export function pickGlanceLink(header: DetailHeader, evidence: EvidenceView[]): GlanceLink {
  const homepage = httpUrl(header.homepageUrl);
  if (homepage) {
    return {
      kind: 'homepage',
      url: homepage,
      needsConfirm: header.homepageStatus === 'NEEDS_CONFIRMATION',
    };
  }
  const found = httpUrl(header.discoverySourceUrl);
  if (found) return { kind: 'search', url: found };
  const best = evidence
    .filter((row) => httpUrl(row.sourceRef))
    .sort((a, b) => GRADE_ORDER.indexOf(a.sourceGrade) - GRADE_ORDER.indexOf(b.sourceGrade))[0];
  return best ? { kind: 'evidence', url: best.sourceRef } : null;
}

function ExternalLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
      {children}
    </a>
  );
}

export default function CompanyGlance({
  header,
  evidence = [],
}: {
  header: DetailHeader;
  evidence?: EvidenceView[];
}) {
  const link = pickGlanceLink(header, evidence);
  const summary = header.summaryLine?.trim() || null;
  const item = header.opportunityItem?.trim() || null;
  const industries = header.industries ?? [];
  const factoryIntro = item
    ? [companyGlance.produces(item), ...industries].join(' · ')
    : industries.join(' · ') || null;
  const pickReason = header.pickReason?.trim() || null;
  const fit = header.fitLevel ?? null;
  const factoryLine = factoryProfileText(header.factoryProfile);

  return (
    <section
      aria-label={companyGlance.title}
      data-testid="company-glance"
      style={{
        display: 'grid',
        gap: 6,
        padding: spacing.cardPadding,
        background: colors.bgLayout,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
      }}
    >
      <div style={rowStyle} data-testid="glance-homepage">
        <span style={labelStyle}>{companyGlance.homepage}</span>
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
            {companyGlance.noHomepage}
          </span>
        )}
        {link?.kind === 'homepage' && link.needsConfirm ? (
          <StatusTag tone="wait">{companyGlance.needsConfirm}</StatusTag>
        ) : null}
      </div>

      {summary || factoryIntro ? (
        <div
          style={rowStyle}
          data-testid={summary ? 'company-summary-line' : 'glance-factory-intro'}
        >
          <span style={labelStyle}>{companyGlance.intro}</span>
          <span>{summary ?? factoryIntro}</span>
          {summary ? (
            header.researchSource === 'AI' ? (
              <StatusTag tone="ask">{companySummary.aiSuggestion}</StatusTag>
            ) : null
          ) : (
            <span style={secondary}>({companyGlance.factoryBasis})</span>
          )}
        </div>
      ) : null}

      {factoryLine && header.factoryProfile ? (
        <div style={rowStyle} data-testid="glance-factory-profile">
          <span style={labelStyle}>{factoryProfileLabels.row}</span>
          <span>{factoryLine}</span>
          <span style={secondary}>
            ({factoryProfileLabels.basis(formatMonthDay(header.factoryProfile.fileDate) ?? '')})
          </span>
        </div>
      ) : null}

      {pickReason || fit ? (
        <div style={rowStyle} data-testid="glance-why">
          <span style={labelStyle}>{companyGlance.why}</span>
          {fit ? (
            <StatusTag tone={fit === 'HIGH' ? 'ok' : fit === 'MEDIUM' ? 'neutral' : 'wait'}>
              {companyGlance.fit[fit]}
            </StatusTag>
          ) : null}
          {pickReason ? <span data-testid="glance-pick-reason">{pickReason}</span> : null}
          <StatusTag tone="ask">{companyGlance.aiJudgment}</StatusTag>
        </div>
      ) : null}
    </section>
  );
}
