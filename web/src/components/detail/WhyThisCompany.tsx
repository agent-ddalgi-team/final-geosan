// "1. 왜 이 회사인가"(#674, PM 결정 2026-11-13): 전의 "추천 근거와 후속 조치"와 "근거 자료" 두 구역을 한 구역으로 합쳤다.
// 추천 근거 문장(점수 항목의 쉬운 요약)마다 바로 아래에 그 문장에 쓴 근거의 인용과 출처(새 창 링크)를 붙인다.
// 문장과 근거는 서버가 주는 점수 항목의 evidenceIds로 잇는다. 어느 문장에도 안 쓰인 근거는 "그 밖의 근거 자료"로 모은다.
// 근거가 하나도 없는 항목(자료 미확보·신호 없음)의 문장은 여기서 빼고 "2. 통화에서 확인할 것"의 접힌 묶음에서 보인다.
// 조사 전·홈페이지 없는 회사는 AI가 고른 이유 한 줄과 공장 등록 정보만 보인다. 읽기만 한다(단추 없음).
// #996(PM 결정 2026-11-29): "한눈에"와 한 블록(카드 하나) 안에 놓인다. 카드 틀은 블록이 그리고 이 부품은 큰 제목과 줄만 그린다.
// 줄 머리의 갈래 이름("제품" · "소재" · "납품실적")은 이름표로 떼어 왼쪽에 보이고, 줄마다 id가 있어
// "한눈에" 핵심 줄의 "○○ 근거 ↓"가 그 줄로 스크롤 · 초점을 옮긴다.
import type { DetailHeader, EvidenceView, Reasons, ScoreItemView } from '../../api/types';
import {
  certaintyLabels,
  companyGlance,
  detailCompose,
  detailReport,
  detailSections,
  evidenceRows,
  factoryProfileLabels,
  labelFor,
} from '../../labels/ko';
import { accent, colors, detailLayout, typography } from '../../theme/tokens';
import { factoryProfileText } from '../../utils/factoryProfile';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { splitSourceRef } from '../common/sourceUrl';
import BlockHeading from './BlockHeading';
import { summaryLines } from './ReasonsSection';
import type { SummaryLine } from './ReasonsSection';

const texts = detailReport.why;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/** "왜 이 회사인가" 줄의 id. "한눈에" 핵심 줄의 "○○ 근거 ↓"가 이 줄로 간다(#996). */
export function reasonLineId(itemCode: string): string {
  return `detail-reason-line-${itemCode}`;
}

/**
 * 줄 글 "제품: 육각볼트…"에서 갈래 이름("제품", 추정이면 "제품(추정)")과 본문을 나눈다(#996).
 * ": "가 없으면 이름 없이 본문만이다.
 */
export function splitReasonLabel(text: string): { label: string | null; body: string } {
  const colon = text.indexOf(': ');
  return colon > 0
    ? { label: text.slice(0, colon), body: text.slice(colon + 2) }
    : { label: null, body: text };
}

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

/** 같은 줄 안에서 인용·출처가 같은 근거는 한 번만 보인다(#803 — 같은 인용이 두 번씩 보였다). */
export function dedupeEvidence(items: EvidenceView[]): EvidenceView[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.quote}\u0000${item.sourceRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 그 줄 근거 가운데 가장 높은 출처 등급(A가 가장 높다). 없으면 null. */
export function bestGradeOf(items: EvidenceView[]): string | null {
  const grades = items.map((item) => item.sourceGrade).filter((grade) => Boolean(grade));
  return grades.length > 0 ? [...grades].sort()[0] : null;
}

/** 근거 한 건: "인용" — 출처 이름 ↗ · 출처 등급 B · 확인. 바로 위 근거와 출처가 같으면 "같은 출처"만. */
function EvidenceQuote({ item, sameSource = false }: { item: EvidenceView; sameSource?: boolean }) {
  return (
    <li data-testid="evidence-item" style={{ display: 'grid', gap: 2 }}>
      <blockquote style={{ margin: 0, ...secondary }}>“{item.quote}”</blockquote>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...secondary }}
      >
        <span aria-hidden="true">—</span>
        <span data-testid="evidence-source">
          {sameSource
            ? texts.sameSource
            : splitSourceRef(item.sourceRef).map((part, index) =>
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
    <section
      aria-labelledby="detail-reasons-heading"
      data-testid="detail-reasons"
      style={{ display: 'grid', gap: 10 }}
    >
      <BlockHeading
        id="detail-reasons-heading"
        title={detailSections.reasons}
        hint={detailCompose.why.hint}
      />
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
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid' }}
        >
          {lines.map((row, rowIndex) => {
            const quotes = dedupeEvidence(row.evidence);
            const grade = bestGradeOf(quotes);
            const { label, body } = splitReasonLabel(row.text);
            // 링크가 있는 줄은 괄호 앞 글이 "제품: …("로 시작한다. 이름표로 뗀 만큼 앞을 잘라 낸다.
            const prefix = label ? `${label}: ` : '';
            const linkBefore =
              row.link && row.link.before.startsWith(prefix)
                ? row.link.before.slice(prefix.length)
                : (row.link?.before ?? '');
            return (
              <li
                key={row.key}
                id={reasonLineId(row.key)}
                // "한눈에"의 "○○ 근거 ↓"가 초점을 옮겨 올 수 있게 한다(Tab 순서에는 넣지 않는다).
                tabIndex={-1}
                data-testid="detail-reason-line"
                data-item={row.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: label ? '58px minmax(0, 1fr)' : 'minmax(0, 1fr)',
                  columnGap: 10,
                  rowGap: 4,
                  padding: '9px 0',
                  // #972 새 시안: 줄 사이에만 얇은 나눔 줄(첫 줄 위에는 없다).
                  borderTop: rowIndex === 0 ? 0 : `1px solid ${colors.borderSecondary}`,
                }}
              >
                {label ? (
                  <strong
                    data-testid="detail-reason-label"
                    style={{
                      fontSize: detailLayout.smallFont,
                      color: colors.textSecondary,
                      paddingTop: 3,
                      wordBreak: 'keep-all',
                    }}
                  >
                    {label}
                  </strong>
                ) : null}
                <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 12,
                      alignItems: 'baseline',
                    }}
                  >
                    <span data-testid="detail-reason-text">
                      {row.link ? (
                        <>
                          {linkBefore}
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
                        body
                      )}
                    </span>
                    {grade ? (
                      <span style={secondary} data-testid="detail-reason-grade">
                        {texts.bestGrade(grade)}
                      </span>
                    ) : null}
                  </div>
                  {quotes.length > 0 ? (
                    // #803: 인용·출처는 접어 두고 "근거 3건"을 눌러 편다(화면 길이의 절반이 인용 줄이었다).
                    <details data-testid="detail-reason-evidence">
                      <summary
                        style={{
                          cursor: 'pointer',
                          width: 'fit-content',
                          fontSize: typography.fontSizeSecondary,
                          color: accent.text,
                        }}
                      >
                        {texts.evidenceCount(quotes.length)}
                      </summary>
                      <ul aria-label={texts.evidenceListLabel(row.text)} style={quoteList}>
                        {quotes.map((item, index) => (
                          <EvidenceQuote
                            key={item.evidenceId}
                            item={item}
                            sameSource={index > 0 && quotes[index - 1].sourceRef === item.sourceRef}
                          />
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
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
    </section>
  );
}
