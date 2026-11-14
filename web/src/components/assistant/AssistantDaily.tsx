// 대시보드 "오늘 확인할 것" 칸 맨 위의 오늘 정리(#743, PM 결정 2026-11-14).
// 화면이 열리면 저절로 한 번 부른다(단추 없음). 서버가 하루(한국 날짜) 한 번만 AI를 부르고 같은 날은 기억해 둔 글을 준다.
// 예: "- 화 11/18 A정밀 방문 → 근처 1.5km B금속(관심)도 들르세요" + "AI가 쓴 글 · 확인 필요" + 근거 회사 링크.
// 스위치가 꺼져 있거나 담당자를 고르지 않았으면 대시보드가 이 부품을 그리지 않는다(부르지도 않는다).
// 정리할 것이 없으면(ASSISTANT_NO_RECORDS) 아무것도 보이지 않고, 그 밖의 실패는 한 줄로 알린다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAssistantDaily } from '../../api/assistant';
import type { DailyBrief } from '../../api/assistant';
import { ApiError } from '../../api/client';
import { assistantTexts as texts, errorTexts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const NOTHING_TO_SUMMARISE = 'ASSISTANT_NO_RECORDS';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; brief: DailyBrief }
  | { kind: 'empty' }
  | { kind: 'error'; detail: string };

export default function AssistantDaily({ staffKey }: { staffKey: string }) {
  const [state, setState] = useState<{ key: string; value: State } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getAssistantDaily(staffKey, controller.signal)
      .then((envelope) => {
        if (!controller.signal.aborted) {
          setState({ key: staffKey, value: { kind: 'ready', brief: envelope.data } });
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && caught.body.kind === NOTHING_TO_SUMMARISE) {
          setState({ key: staffKey, value: { kind: 'empty' } });
          return;
        }
        const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
        setState({ key: staffKey, value: { kind: 'error', detail } });
      });
    return () => controller.abort();
  }, [staffKey]);

  const current: State = state?.key === staffKey ? state.value : { kind: 'loading' };
  if (current.kind === 'empty') return null;
  if (current.kind === 'loading') {
    return (
      <span data-testid="assistant-daily-loading" role="status" style={secondary}>
        {texts.dailyLoading}
      </span>
    );
  }
  if (current.kind === 'error') {
    return (
      <p data-testid="assistant-daily-error" style={{ margin: 0, ...secondary }}>
        {texts.dailyFailed} ({current.detail})
      </p>
    );
  }
  const { brief } = current;
  return (
    <div
      data-testid="assistant-daily"
      aria-live="polite"
      style={{
        display: 'grid',
        gap: 6,
        padding: 12,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
        background: colors.bgLayout,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <strong>{texts.dailyTitle}</strong>
        <span
          data-testid="assistant-daily-mark"
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            background: statusPalette.wait.bg,
            color: statusPalette.wait.fg,
            fontSize: typography.fontSizeSecondary,
          }}
        >
          {texts.dailyMark}
        </span>
      </div>
      <p data-testid="assistant-daily-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {brief.summary}
      </p>
      {brief.sources.length > 0 ? (
        <p data-testid="assistant-daily-sources" style={{ margin: 0, ...secondary }}>
          {texts.sourcesLabel}{' '}
          {brief.sources.map((source, index) => (
            <span key={source.oppId}>
              {index > 0 ? ' · ' : null}
              <Link to={`/opportunities/${encodeURIComponent(source.oppId)}`}>{source.name}</Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
