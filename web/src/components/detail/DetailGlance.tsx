// 상세 "한눈에"(#674 → #996, PM 결정 2026-11-29): 핵심 줄(어떤 회사 · 맞는 점 · 특징 · 확인할 점) + 위치.
// "왜 이 회사인가"와 한 블록(카드 하나) 안에 놓인다. 카드 틀은 블록이 그리고 이 부품은 큰 제목과 줄만 그린다.
// 핵심 줄은 저장된 값에서 프로그램이 골라 붙인다(`glanceKeys.ts`, AI 호출 없음). 줄 수는 고정이 아니다:
// 갈래(어떤 회사 · 맞는 점 · 특징 · 확인할 점)마다 값이 있는 만큼 줄이 생기고, 값이 없는 갈래는 그리지 않으며,
// 갈래마다 앞 3줄까지 보이고 나머지는 "더 보기 n줄"로 편다. 갈래는 배열로 받아 그려 새 갈래를 더하기 쉽다.
// 근거 문장에서 온 줄은 끝에 "○○ 근거 ↓"가 붙어, 누르면 아래 "왜 이 회사인가"의 그 줄로 스크롤 · 초점을 옮긴다.
// 전에 이 상자에 있던 것 가운데: 공정 · 소재 · 산업 · 거리 · 홈페이지는 머리의 요약 줄(`DetailSummaryRow.tsx`)로,
// 대표번호 · 대표명은 "담당자 연락처" 칸(`ContactCard.tsx`)으로, 접촉 횟수는 "기록" 칸 제목 옆으로 옮겼고,
// "확인할 것 n가지"는 오른쪽 영업 코치 "확인사항"과 같아 뺐다. 근거 상태(근거 수 · 적합도 · 조사일 · 오래됨)와
// 공급망 위치는 같은 내용이 다른 곳에 없어 맨 아래 작은 줄로 남긴다.
import { useState } from 'react';
import { Button } from 'antd';
import type {
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
  companyGlance,
  companySummary,
  detailCompose,
  detailReport,
  factoryProfileLabels,
  glanceVisual,
  mapLinkLabels,
  supplyTierLabels,
} from '../../labels/ko';
import {
  accent,
  colors,
  detailLayout,
  detailTheme,
  radius,
  statusPalette,
  typography,
} from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { daysAgo, formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { buildMapLinks } from '../common/mapLinks';
import BlockHeading from './BlockHeading';
import CompanyInfoFix from './CompanyInfoFix';
import DetailMiniMap from './DetailMiniMap';
import { reasonLineId } from './WhyThisCompany';
import { GLANCE_LINES_SHOWN, glanceGroupsOf } from './glanceKeys';
import type { GlanceGroup, GlanceLine } from './glanceKeys';

// 다른 부품(확인사항 · 회사별 보고서)이 전부터 이 파일에서 가져다 쓰던 계산. 지금은 `glanceState.ts`에 있다.
export { detailCheckWordsOf, processStateOf } from './glanceState';
export type { DetailCheckWords } from './glanceState';

const texts = detailReport.glance;
const keyTexts = detailCompose.glance;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 } as const;

/** 지도 상자 높이(#996): 전보다 조금 낮게, 가로는 칸 폭을 다 쓴다. */
export const GLANCE_MAP_HEIGHT = 120;

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value) && /^https?:\/\/\S+$/.test(value as string);
}

/** 아래 "왜 이 회사인가"의 그 줄로 내려가 초점을 둔다. 줄이 없으면 아무것도 하지 않는다. */
function goReasonLine(code: string) {
  const target = document.getElementById(reasonLineId(code));
  if (!target) return;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.focus({ preventScroll: true });
}

/** 핵심 줄 하나: 글 + 꼬리표 · 덧말 + 글 끝 "○○ 근거 ↓". */
function KeyLine({ line }: { line: GlanceLine }) {
  return (
    <li data-testid="glance-key-line">
      <span data-testid={line.testId}>
        <span data-testid="glance-key-text" style={line.muted ? secondary : undefined}>
          {line.text}
        </span>
        {line.note ? (
          <>
            {' '}
            <span style={secondary}>{line.note}</span>
          </>
        ) : null}
        {line.tag ? (
          <>
            {' '}
            <StatusTag tone="ask">{line.tag}</StatusTag>
          </>
        ) : null}
      </span>
      {/* 글 끝에 "○○ 근거 ↓"를 이어 붙인다(반 폭 칸에서 글이 칸 폭을 다 쓰게). */}
      {line.target ? (
        <>
          {' '}
          <a
            href={`#${reasonLineId(line.target.code)}`}
            onClick={(event) => {
              event.preventDefault();
              if (line.target) goReasonLine(line.target.code);
            }}
            data-testid="glance-key-link"
            data-target={line.target.code}
            style={{
              color: accent.text,
              fontSize: detailLayout.smallFont,
              textDecoration: 'underline',
              whiteSpace: 'nowrap',
            }}
          >
            {keyTexts.evidenceLink(line.target.label)} <span aria-hidden="true">↓</span>
          </a>
        </>
      ) : null}
    </li>
  );
}

/**
 * 갈래 하나: 왼쪽 이름표(색 + 글자) 한 번 + 오른쪽 줄들. 줄이 여러 개면 점 목록으로 보이고,
 * `GLANCE_LINES_SHOWN`줄을 넘으면 앞의 줄만 보이고 "더 보기 n줄"로 편다(다시 누르면 접힘).
 * 이름표는 줄마다 되풀이하지 않는다(같은 색 이름표가 줄줄이 서면 글보다 이름표가 먼저 읽힌다).
 */
function KeyGroup({ group }: { group: GlanceGroup }) {
  const [open, setOpen] = useState(false);
  const palette =
    group.tone === 'good'
      ? statusPalette.ok
      : group.tone === 'warn'
        ? statusPalette.wait
        : statusPalette.neutral;
  const hidden = Math.max(0, group.lines.length - GLANCE_LINES_SHOWN);
  const lines = open ? group.lines : group.lines.slice(0, GLANCE_LINES_SHOWN);
  const many = group.lines.length > 1;
  const listId = `glance-lines-${group.key}`;
  return (
    <div
      data-testid={group.testId}
      data-tone={group.tone}
      data-lines={group.lines.length}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '8px 0',
        borderTop: `1px solid ${colors.borderSecondary}`,
      }}
    >
      <dt
        style={{
          flex: 'none',
          width: detailLayout.keyLabelWidth,
          textAlign: 'center',
          padding: '2px 0',
          borderRadius: radius.tag,
          background: palette.bg,
          color: palette.fg,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {group.label}
      </dt>
      <dd style={{ margin: 0, flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        <ul
          id={listId}
          data-testid={group.listTestId}
          style={{
            margin: 0,
            display: 'grid',
            gap: 4,
            // 줄이 하나면 점 없이, 여러 개면 점 목록으로(어디서 줄이 바뀌는지 보이게).
            paddingLeft: many ? 18 : 0,
            listStyle: many ? 'disc' : 'none',
          }}
        >
          {lines.map((line, index) => (
            <KeyLine key={`${index}:${line.text}`} line={line} />
          ))}
        </ul>
        {hidden > 0 ? (
          <div>
            <Button
              type="link"
              size="small"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
              data-testid="glance-key-more"
              style={{ padding: 0, height: 'auto', fontSize: typography.fontSizeSecondary }}
            >
              {open ? keyTexts.less : keyTexts.more(hidden)}
            </Button>
          </div>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * 갈래 배열을 받아 그대로 그린다. 갈래 수도 줄 수도 고정이 아니다(값이 있는 만큼).
 * 새 갈래(예: 통화로 알아낸 것)는 배열에 더하면 같은 모양으로 그려진다.
 */
export function GlanceGroupList({ groups }: { groups: GlanceGroup[] }) {
  return (
    <dl data-testid="glance-keys" style={{ margin: 0 }}>
      {groups.map((group) => (
        <KeyGroup key={group.key} group={group} />
      ))}
    </dl>
  );
}

export interface DetailGlanceProps {
  header: DetailHeader;
  processLinks: ProcessLinkView[];
  evidence: EvidenceView[];
  reviewItems?: ReviewItem[];
  requirements?: RequirementCheckView[];
  /** 시험이 현재 시각에 기대지 않게 지금 시각을 받을 수 있다. */
  now?: Date;
  /**
   * #958: 위치 줄에 주소 · 회사 이름 [고치기]를 붙일 때 넘긴다. 넘기지 않으면 읽기만 한다.
   * 저장하면 거리와 지도가 바뀌므로 상세를 새로 불러오게 알린다.
   */
  companyInfo?: { oppId: string; onSaved: () => void };
  /** 점수 항목(쉬운 요약 · 근거 번호). 핵심 줄과 근거 상태 막대에 쓴다. 없으면 근거 문장 줄과 막대를 그리지 않는다. */
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
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <span
        role="img"
        aria-label={glanceVisual.evidenceBar(withEvidence, total)}
        style={{
          position: 'relative',
          width: 140,
          height: 8,
          borderRadius: radius.tag,
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
    borderRadius: '50%',
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
  now,
  companyInfo,
  scoreItems,
  map = null,
  mapClientId,
  plateDecider = null,
}: DetailGlanceProps) {
  // #803: 지도를 못 그리면(키 없음·인증 실패) 거리 그림으로 돌아간다.
  const [mapFailed, setMapFailed] = useState(false);

  // ── 핵심 줄: 어떤 회사 · 맞는 점 · 특징 · 확인할 점(저장된 값에서 골라 붙인 갈래 배열. 값이 없는 갈래는 없다)
  const groups = glanceGroupsOf({
    header,
    processLinks,
    evidence,
    reviewItems,
    requirements,
    scoreItems,
  });

  // ── 위치
  const factoryLine = factoryProfileText(header.factoryProfile);
  const address = header.address?.trim() || null;
  const mapLinks = buildMapLinks(header.address);
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

  const showLocation = Boolean(address || factoryLine || companyInfo);

  return (
    <section
      aria-labelledby="detail-glance-heading"
      data-testid="detail-glance"
      style={{ display: 'grid', gap: 10 }}
    >
      <BlockHeading id="detail-glance-heading" title={texts.title} hint={keyTexts.hint} />
      <GlanceGroupList groups={groups} />

      {showLocation ? (
        <div
          data-testid="glance-location"
          style={{
            display: 'grid',
            gap: 6,
            paddingTop: 8,
            borderTop: `1px solid ${colors.borderSecondary}`,
          }}
        >
          <div style={{ ...line, fontSize: typography.fontSizeSecondary }}>
            <span style={{ color: colors.textDimmed, fontSize: detailLayout.smallFont }}>
              {keyTexts.location}
            </span>
            {address || factoryLine ? (
              // 상자 없이(contents) 둬서 "위치" 이름표 · 주소 · 지도 링크가 한 줄에 이어지고 좁으면 차례로 줄이 바뀐다.
              <span style={{ display: 'contents' }} data-testid="glance-factory-profile">
                <span>{[address, factoryLine].filter((part) => part).join(' · ')}</span>
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
              </span>
            ) : null}
            {companyInfo ? (
              <CompanyInfoFix
                oppId={companyInfo.oppId}
                address={address}
                companyName={header.customerName}
                canRename={header.discoverySource === 'STAFF_ADDED'}
                onSaved={companyInfo.onSaved}
              />
            ) : null}
          </div>
          {/* 지도를 못 그리면(좌표 없음 · 키 없음 · 인증 실패) 거리 숫자만으로 그린 그림으로 대신한다. */}
          {address && distance !== null && (!map || mapFailed) ? (
            <DistanceLine km={distance} />
          ) : null}
          {map && !mapFailed ? (
            <DetailMiniMap
              map={map}
              href={mapLinks?.naver ?? null}
              onUnavailable={() => setMapFailed(true)}
              width="100%"
              height={GLANCE_MAP_HEIGHT}
              {...(mapClientId !== undefined ? { clientId: mapClientId } : {})}
            />
          ) : null}
        </div>
      ) : null}

      <SupplyTierLine header={header} plateDecider={plateDecider} />

      {/* 근거 상태: 근거 수 · 홈페이지 · 적합도 · 조사일과 "오래됨" 알림. 같은 내용이 다른 곳에 없어 작은 줄로 남긴다. */}
      <div
        data-testid="glance-evidence"
        style={{ ...line, color: colors.textSecondary, fontSize: detailLayout.smallFont }}
      >
        <span style={{ color: colors.textDimmed }}>{keyTexts.evidenceState}</span>
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
        {scoreItems ? <EvidenceBar items={scoreItems} /> : null}
      </div>
    </section>
  );
}
