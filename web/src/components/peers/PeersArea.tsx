// 상세 "비슷한 회사 참고"(#269, PM 결정 2026-11-04 A안): 같은 공정·산업군 다른 회사 최대 5곳을 요약 줄 1개 + 회사 줄로 본다.
// 읽기만 하고 저장하지 않으며 보기 전용 담당자도 볼 수 있다. 메모 글이 들어 있어 "내부 참고 · 밖으로 안 나감"을 항상 보인다.
// 기업이 바뀌면 부르는 쪽이 key로 새로 만든다. 못 불러와도 상세의 다른 영역은 그대로이고 이 영역만 [다시 불러오기]를 보인다.
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { getPeers } from '../../api/client';
import type { PeersResponse } from '../../api/types';
import { peersArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import PeerCompanyLine from './PeerCompanyLine';
import { peersSummaryText } from './peersText';
import { usePeerNames } from './usePeerNames';

export interface PeersAreaProps {
  oppId: string;
}

export default function PeersArea({ oppId }: PeersAreaProps) {
  const { processNames, personName } = usePeerNames();
  const [retry, setRetry] = useState(0);
  const [peers, setPeers] = useState<PeersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getPeers(oppId, controller.signal)
      .then((envelope) => {
        setPeers(envelope.data);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [oppId, retry]);

  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;
  const summaryText = peers ? peersSummaryText(peers.summary) : '';

  return (
    <div data-testid="peers-area" style={{ display: 'grid', gap: 8 }}>
      <span data-testid="peers-internal-note" style={secondary}>
        {peersArea.internalNote}
      </span>
      {failed ? (
        <div role="alert" data-testid="peers-error" style={{ color: colors.error }}>
          {peersArea.loadFailed}{' '}
          <Button type="link" onClick={() => setRetry((n) => n + 1)} style={{ padding: 0 }}>
            {peersArea.retry}
          </Button>
        </div>
      ) : null}
      {peers === null && !failed ? (
        <span style={secondary} data-testid="peers-loading">
          {peersArea.loading}
        </span>
      ) : null}
      {peers !== null && peers.companies.length === 0 ? (
        <span data-testid="peers-empty">{peersArea.empty}</span>
      ) : null}
      {peers !== null && peers.companies.length > 0 ? (
        <>
          {summaryText ? (
            <span data-testid="peers-summary" style={{ fontWeight: 600 }}>
              {summaryText}
            </span>
          ) : null}
          <ul
            aria-label={peersArea.listLabel}
            style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}
          >
            {peers.companies.map((company) => (
              <PeerCompanyLine
                key={company.oppId}
                company={company}
                processNames={processNames}
                personName={personName}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
