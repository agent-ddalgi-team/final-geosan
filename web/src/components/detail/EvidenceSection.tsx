// 4. 근거 자료: 출처 · 출처 등급 · 확인/추정 글자(추정이 확정처럼 보이면 결함, AC10.1.3).
// 홈페이지 주소 입력·확정은 뒤 단위라 "확인이 필요합니다" 안내 글자만 보인다.
import type { EvidenceView } from '../../api/types';
import StatusTag from '../common/StatusTag';
import { splitSourceRef } from '../common/sourceUrl';
import DetailSection from './DetailSection';
import { certaintyLabels, detailSections, evidenceRows, labelFor, states } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

function CertaintyText({ certainty }: { certainty: EvidenceView['certainty'] }) {
  const text = labelFor(certaintyLabels, certainty);
  if (certainty === 'STRONG' || certainty === 'WEAK')
    return <StatusTag tone="ask">{text}</StatusTag>;
  if (certainty === 'UNKNOWN') return <StatusTag tone="neutral">{text}</StatusTag>;
  return <span>{text}</span>;
}

export default function EvidenceSection({
  evidence,
  homepageNeedsConfirm,
}: {
  evidence: EvidenceView[];
  homepageNeedsConfirm: boolean;
}) {
  return (
    <DetailSection id="detail-evidence" title={detailSections.evidence}>
      {evidence.length === 0 ? (
        <p data-testid="evidence-empty" style={{ margin: 0 }}>
          {states.noEvidence}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
          {evidence.map((item) => (
            <li key={item.evidenceId} data-testid="evidence-item">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
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
                      </a>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </span>
                {item.occurredAt ? (
                  <span style={{ color: colors.textSecondary }}>{item.occurredAt}</span>
                ) : null}
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
              <blockquote
                style={{
                  margin: '4px 0 0',
                  color: colors.textSecondary,
                  fontSize: typography.fontSizeSecondary,
                }}
              >
                {item.quote}
              </blockquote>
            </li>
          ))}
        </ul>
      )}
      {homepageNeedsConfirm ? (
        <p data-testid="homepage-needs-confirm" style={{ margin: 0 }}>
          {evidenceRows.homepageNeedsConfirm}
        </p>
      ) : null}
    </DetailSection>
  );
}
