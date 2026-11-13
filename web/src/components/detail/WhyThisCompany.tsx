// "1. 왜 이 회사인가"(#674, PM 결정 2026-11-13): 전의 "추천 근거와 후속 조치"와 "근거 자료" 두 구역을 한 구역으로 합쳤다.
// 추천 근거 문장(점수 항목의 쉬운 요약)마다 바로 아래에 그 문장에 쓴 근거의 인용과 출처(새 창 링크)를 붙인다.
// 문장과 근거는 서버가 주는 점수 항목의 evidenceIds로 잇는다. 어느 문장에도 안 쓰인 근거는 "그 밖의 근거 자료"로 모은다.
// 근거가 하나도 없는 항목(자료 미확보·신호 없음)의 문장은 여기서 빼고 "2. 통화에서 확인할 것"의 접힌 묶음에서 보인다.
// 조사 전·홈페이지 없는 회사는 AI가 고른 이유 한 줄과 공장 등록 정보만 보인다. 읽기만 한다(단추 없음).
import type { DetailHeader, EvidenceView, Reasons, ScoreItemView } from '../../api/types';
import {
  certaintyLabels,
  companyGlance,
  detailReport,
  detailSections,
  evidenceRows,
  factoryProfileLabels,
  labelFor,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { splitSourceRef } from '../common/sourceUrl';
import DetailSection from './DetailSection';
import { summaryLines } from './ReasonsSection';
import type { SummaryLine } from './ReasonsSection';

const texts = detailReport.why;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/** 근거가 없다는 뜻의 항목 상태. 이 상태이고 붙은 근거도 없으면 추천 근거 문장으로 보이지 않는다. */
const NO_EVIDENCE_STATES = new Set(['UNAVAILABLE', 'NO_SIGNAL']);

export interface ReasonLine extends SummaryLine {
  /** 이 문장에 쓴 근거(항목의 evidenceIds 순서). */
  evidence: EvidenceView[];
}

/**
 * 근거가 있는 항목의 요약 문장과 그 문장에 쓴 근거. 문장 글과 줄 끝 괄호 링크는 전과 같다(`summaryLines`).
 * 근거가 없다는 상태(자료 미확보·신호 없음)이고 붙은 근거도 없는 항목은 뺀다.
 */
export function reasonLinesOf(
  items: ScoreItemView[] | undefined,
  evidence: EvidenceView[],
): ReasonLine[] {
  const byId = new Map(evidence.map((row) => [row.evidenceId, row]));
  const stateOf = new Map((items ?? []).map((item) => [item.itemCode, item]));
  return summaryLines(items, evidence)
    .map((row) => ({
      ...row,
      evidence: (stateOf.get(row.key)?.evidenceIds ?? [])
        .map((id) => byId.get(id))
        .filter((found): found is EvidenceView => found !== undefined),
    }))
    .filter(
      (row) =>
        row.evidence.length > 0 || !NO_EVIDENCE_STATES.has(stateOf.get(row.key)?.state ?? ''),
    );
}

function CertaintyText({ certainty }: { certainty: EvidenceView['certainty'] }) {
  const text = labelFor(certaintyLabels, certainty);
  if (certainty === 'STRONG' || certainty === 'WEAK')
    return <StatusTag tone="ask">{text}</StatusTag>;
  if (certainty === 'UNKNOWN') return <StatusTag tone="neutral">{text}</StatusTag>;
  return <span>{text}</span>;
}

/** 근거 한 건: "인용" — 출처 이름 ↗ · 출처 등급 B · 확인 */
function EvidenceQuote({ item }: { item: EvidenceView }) {
  return (
    <li data-testid="evidence-item" style={{ display: 'grid', gap: 2 }}>
      <blockquote style={{ margin: 0, ...secondary }}>“{item.quote}”</blockquote>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...secondary }}
      >
        <span aria-hidden="true">—</span>
        <span data-testid="evidence-source">
          {splitSourceRef(item.sourceRef).map((part, index) =>
            part.href ? (
              <a
                key={index}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'underline' }}
              >
                {part.text}
                <span aria-hidden="true"> ↗</span>
              </a>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </span>
        {item.occurredAt ? <span>{item.occurredAt}</span> : null}
        <span>
          {evidenceRows.gradePrefix} {item.sourceGrade}
        </span>
        <CertaintyText certainty={item.certainty} />
        {item.isLlmProposed ? (
          <StatusTag tone="ask" data-testid="evidence-llm-tag">
            {evidenceRows.llmProposed}
          </StatusTag>
        ) : null}
      </div>
    </li>
  );
}

const quoteList = {
  margin: '4px 0 0',
  padding: '0 0 0 16px',
  listStyle: 'none',
  display: 'grid',
  gap: 8,
  borderLeft: `2px solid ${colors.borderSecondary}`,
} as const;

export interface WhyThisCompanyProps {
  header: DetailHeader;
  reasons: Reasons;
  scoreItems?: ScoreItemView[];
  evidence: EvidenceView[];
}

export default function WhyThisCompany({
  header,
  reasons,
  scoreItems,
  evidence,
}: WhyThisCompanyProps) {
  const lines = reasonLinesOf(scoreItems, evidence);
  const usedIds = new Set(lines.flatMap((row) => row.evidence.map((item) => item.evidenceId)));
  const others = evidence.filter((item) => !usedIds.has(item.evidenceId));
  const pickReason = header.pickReason?.trim() || null;
  const reason = reasons.reason.trim();
  // 점수 전 회사는 서버가 고른 이유를 추천 근거 칸에 그대로 넣는다(#555). 같은 문장이면 한 번만 보인다.
  const showReason = lines.length === 0 && reason !== '' && reason !== pickReason;
  const factoryLine = evidence.length === 0 ? factoryProfileText(header.factoryProfile) : null;

  return (
    <DetailSection id="detail-reasons" title={detailSections.reasons}>
      {pickReason ? (
        <p data-testid="why-pick-reason" style={{ margin: 0 }}>
          <strong>{texts.pickReason}</strong>: {pickReason}{' '}
          <StatusTag tone="ask">{companyGlance.aiJudgment}</StatusTag>
        </p>
      ) : null}
      {showReason ? (
        <p data-testid="detail-reason" style={{ margin: 0 }}>
          <strong>{texts.reason}</strong>: {reason}
        </p>
      ) : null}
      {lines.length > 0 ? (
        <ul
          data-testid="detail-reason-lines"
          style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 12 }}
        >
          {lines.map((row) => (
            <li key={row.key} data-testid="detail-reason-line">
              <span data-testid="detail-reason-text">
                {row.link ? (
                  <>
                    {row.link.before}
                    <a
                      href={row.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: 'underline' }}
                    >
                      {row.link.label}
                    </a>
                    {row.link.after}
                  </>
                ) : (
                  row.text
                )}
              </span>
              {row.evidence.length > 0 ? (
                <ul aria-label={texts.evidenceListLabel(row.text)} style={quoteList}>
                  {row.evidence.map((item) => (
                    <EvidenceQuote key={item.evidenceId} item={item} />
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <div data-testid="why-other-evidence" style={{ display: 'grid', gap: 4 }}>
          <h3 style={{ margin: 0, fontSize: typography.fontSize, fontWeight: 600 }}>
            {lines.length > 0 ? texts.otherEvidence : texts.evidenceTitle}
          </h3>
          <ul style={quoteList}>
            {others.map((item) => (
              <EvidenceQuote key={item.evidenceId} item={item} />
            ))}
          </ul>
        </div>
      ) : null}
      {evidence.length === 0 ? (
        <>
          {factoryLine && header.factoryProfile ? (
            <p data-testid="why-factory" style={{ margin: 0 }}>
              <strong>{texts.factory}</strong>: {factoryLine}{' '}
              <span style={secondary}>
                ({factoryProfileLabels.basis(formatMonthDay(header.factoryProfile.fileDate) ?? '')})
              </span>
            </p>
          ) : null}
          <p data-testid="evidence-empty" style={{ margin: 0, ...secondary }}>
            {texts.noEvidenceYet}
          </p>
        </>
      ) : null}
    </DetailSection>
  );
}
