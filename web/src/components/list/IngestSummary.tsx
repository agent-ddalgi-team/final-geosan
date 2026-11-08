// 추천 목록 머리의 후보 수집 요약(#316, 결정 2026-11-05): 마지막 수집 회차의 진행·결과 한 줄과 "이번 수집만 / 전체" 전환.
// 서버가 준 meta.latestIngest를 그대로 보이고 화면에서 건수를 계산해 지어내지 않는다. 건수를 모르는 칸은 뺀다.
// 고르기·[새 후보 가져오기] 단추는 서버(POST /ingest)가 합쳐진 뒤 이어서 붙인다(이 부품은 보여 주기만 한다).
import type { LatestIngest } from '../../api/types';
import { candidateSearch } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export type IngestScope = 'latest' | 'all';

export interface IngestSummaryProps {
  ingest: LatestIngest;
  scope: IngestScope;
  onScope: (scope: IngestScope) => void;
}

/** 건수 칸을 보이는 글자 조각으로 바꾼다. 서버가 안 준 칸(없음·null)은 뺀다. */
export function summaryParts(ingest: LatestIngest): string[] {
  const parts: string[] = [];
  if (typeof ingest.scannedCount === 'number') {
    parts.push(candidateSearch.scanned(ingest.scannedCount));
  }
  if (typeof ingest.pickedCount === 'number') {
    parts.push(candidateSearch.picked(ingest.pickedCount));
    if (typeof ingest.researchDoneCount === 'number') {
      parts.push(candidateSearch.researched(ingest.researchDoneCount, ingest.pickedCount));
    }
  }
  if (typeof ingest.mergeCandidateCount === 'number' && ingest.mergeCandidateCount > 0) {
    parts.push(candidateSearch.mergeCandidates(ingest.mergeCandidateCount));
  }
  return parts;
}

/**
 * 실패 사유 한 줄. 서버가 쉬운 문장으로 준 것을 그대로 보이고(화면에서 새로 짓지 않는다),
 * 없으면 기존 고정 문구를 쓴다.
 */
export function failureText(ingest: LatestIngest): string {
  const reason = typeof ingest.failureReason === 'string' ? ingest.failureReason.trim() : '';
  return reason || candidateSearch.failed;
}

/** 한도 등으로 건너뛴 일을 쉬운 말 문장으로 바꾼다. 서버가 안 준 칸과 모르는 코드는 뺀다. */
export function skippedNotices(ingest: LatestIngest): string[] {
  const notices: string[] = [];
  const web: string | undefined = ingest.webSkippedReason
    ? (candidateSearch.webSkipped as Record<string, string>)[ingest.webSkippedReason]
    : undefined;
  if (web) notices.push(web);
  const complex: string | undefined = ingest.complexListSkippedReason
    ? (candidateSearch.complexListSkipped as Record<string, string>)[
        ingest.complexListSkippedReason
      ]
    : undefined;
  if (complex) notices.push(complex);
  return notices;
}

const scopeButton = (selected: boolean) =>
  ({
    minHeight: 36,
    padding: '0 14px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : colors.border}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : colors.text,
    font: 'inherit',
    fontWeight: selected ? 700 : 400,
    cursor: 'pointer',
  }) as const;

export default function IngestSummary({ ingest, scope, onScope }: IngestSummaryProps) {
  const parts = summaryParts(ingest);
  const notices = skippedNotices(ingest);
  const failed = ingest.status === 'FAILED';
  const running = ingest.status === 'RUNNING';
  return (
    <div
      data-testid="ingest-summary"
      data-status={ingest.status}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
      >
        <span style={{ fontWeight: 700, color: colors.text }}>{candidateSearch.summaryTitle}</span>
        {failed ? (
          <span data-testid="ingest-failed"> · {failureText(ingest)}</span>
        ) : (
          <>
            {running ? (
              <span data-testid="ingest-running"> · {candidateSearch.running}</span>
            ) : null}
            {parts.length > 0 ? (
              <span data-testid="ingest-counts"> · {parts.join(' · ')}</span>
            ) : null}
            {notices.map((text) => (
              <span key={text} data-testid="ingest-skipped">
                {' '}
                · {text}
              </span>
            ))}
          </>
        )}
      </div>
      <div
        role="group"
        aria-label={candidateSearch.scopeLabel}
        data-testid="ingest-scope"
        style={{ display: 'flex', gap: 8 }}
      >
        <button
          type="button"
          aria-pressed={scope === 'latest'}
          onClick={() => {
            if (scope !== 'latest') onScope('latest');
          }}
          style={scopeButton(scope === 'latest')}
          data-testid="ingest-scope-latest"
        >
          {candidateSearch.scopeLatest}
        </button>
        <button
          type="button"
          aria-pressed={scope === 'all'}
          onClick={() => {
            if (scope !== 'all') onScope('all');
          }}
          style={scopeButton(scope === 'all')}
          data-testid="ingest-scope-all"
        >
          {candidateSearch.scopeAll}
        </button>
      </div>
    </div>
  );
}
