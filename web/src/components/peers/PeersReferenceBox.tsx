// 영업 전략 영역(2차, #27)의 "참고한 이력" 상자(#269 할 일 3번): 전략 초안 옆에 요약 줄 + 비슷한 회사 2곳을 보인다.
// 초안 글(공개 자료 기반 AI)과 섞지 않으려고 따로 테두리를 두고 "내부 참고 · 밖으로 안 나감"을 표시한다.
// 전략 영역(#27)이 아직 없어서 상세 화면에는 붙이지 않았다. 전략 영역이 생기면 그쪽이 읽은 응답을 `peers`로 넘겨 붙이면 된다.
// 이 상자의 요약 건수를 초안 생성에 넣는 것은 #247 결정 뒤 별도 이슈다.
import type { PeersResponse } from '../../api/types';
import { peersArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import PeerCompanyLine from './PeerCompanyLine';
import { peersSummaryText } from './peersText';
import { usePeerNames } from './usePeerNames';

export interface PeersReferenceBoxProps {
  peers: PeersResponse;
}

export default function PeersReferenceBox({ peers }: PeersReferenceBoxProps) {
  const { processNames, personName } = usePeerNames();
  const summaryText = peersSummaryText(peers.summary);
  const shown = peers.companies.slice(0, peersArea.referenceCompaniesShown);
  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  return (
    <section
      aria-label={peersArea.referenceTitle}
      data-testid="peers-reference-box"
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <strong>{peersArea.referenceTitle}</strong>
        <span data-testid="peers-reference-internal-note" style={secondary}>
          {peersArea.internalNote}
        </span>
      </div>
      {shown.length === 0 ? (
        <span data-testid="peers-reference-empty">{peersArea.empty}</span>
      ) : (
        <>
          {summaryText ? <span data-testid="peers-reference-summary">{summaryText}</span> : null}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {shown.map((company) => (
              <PeerCompanyLine
                key={company.oppId}
                company={company}
                processNames={processNames}
                personName={personName}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
