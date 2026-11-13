// (2026-11-13 PM 지시 #659로 상세 화면에서 뺀 구역. 지금 쓰는 곳 없음. 공정은 검토사항 맨 위 한 줄이 대신한다) 공정 적합성 검토(공정 연결): 거산 공정 이름 · 적용 소재 · 판정(글자).
import type { ProcessLinkView } from '../../api/types';
import StatusTag from '../common/StatusTag';
import DetailSection from './DetailSection';
import {
  detailSections,
  filterStateLabels,
  filterStateTone,
  labelFor,
  materialLabels,
  processRows,
  states,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export default function ProcessLinksSection({ links }: { links: ProcessLinkView[] }) {
  return (
    <DetailSection id="detail-process-links" title={detailSections.processLinks}>
      {links.length === 0 ? (
        <p style={{ margin: 0 }}>{states.noProcessLinks}</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {links.map((link) => (
            <li key={link.linkId} data-testid="process-link">
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <span>{link.processName || link.processCode}</span>
                {link.appliedMaterial ? (
                  <span>
                    {processRows.material}: {labelFor(materialLabels, link.appliedMaterial)}
                  </span>
                ) : null}
                {link.result ? (
                  <StatusTag tone={filterStateTone[link.result] ?? 'neutral'}>
                    {labelFor(filterStateLabels, link.result)}
                  </StatusTag>
                ) : null}
              </div>
              {link.reason ? (
                <div
                  style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
                >
                  {link.reason}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
