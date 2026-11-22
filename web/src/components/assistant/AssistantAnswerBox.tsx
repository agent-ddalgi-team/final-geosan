// 영업 비서의 답 한 덩어리(#680): 답 글 + "AI가 쓴 답 · 확인 필요" 표시 + 근거 회사 링크.
// 모달 없이 그 자리 아래에 편다. 근거 회사는 서버가 고른 것만 보이고, 누르면 그 회사 상세로 간다.
// 질문에 답하기에서 회사 일부만 보았으면 "○곳 가운데 ○곳만 보았습니다"를 답 아래에 적는다.
// #774: 긴 답은 앞 5줄만 보이고 [더 보기]로 편다. 답 아래 "할 일 제안"은 서버가 검증한 것만 오고,
// 담당자가 [넣기]를 눌러야 그 회사 다음 일정으로 저장된다(이미 일정이 있으면 "바꿀까요?"를 먼저 묻는다).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'antd';
import { postSchedule, SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import type { AssistantAnswer, AssistantSuggestion } from '../../api/assistant';
import { ApiError } from '../../api/client';
import { assistantTexts as texts, errorTexts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { dayLabel } from '../dashboard/TodayChecks';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
/** 접은 답에 보이는 줄 수. */
const SHOWN_LINES = 5;

/** '로'/'으로': 끝 글자에 받침이 있으면(ㄹ 받침은 빼고) '으로'. */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (Number.isNaN(code) || code < 0 || code >= 11172) return `${word}로`;
  const final = code % 28;
  return `${word}${final === 0 || final === 8 ? '로' : '으로'}`;
}

function scheduleText(date: string | null, note: string | null): string {
  return [dayLabel(date), note].filter(Boolean).join(' ');
}

type PutState = 'idle' | 'confirm' | 'saving' | 'done';

/** #887 영업 분석의 일정 제안도 같은 줄을 쓴다(source ANALYSIS). */
export function SuggestionItem({
  item,
  source,
}: {
  item: AssistantSuggestion;
  source?: 'COACH' | 'ANALYSIS';
}) {
  const { staffKey, canRecord } = useFrame();
  const [state, setState] = useState<PutState>('idle');
  const [error, setError] = useState<string | null>(null);
  const next = scheduleText(item.date, item.actionLabel);
  const current = item.currentScheduleAt
    ? scheduleText(item.currentScheduleAt, item.currentScheduleNote)
    : null;
  const same =
    item.currentScheduleAt === item.date && item.currentScheduleNote === item.actionLabel;

  async function save() {
    if (!staffKey || !canRecord) return;
    setState('saving');
    setError(null);
    try {
      await postSchedule(
        item.oppId,
        {
          nextScheduleAt: item.date,
          actionId: item.actionId,
          expectedVersion: item.outcomeVersion,
          ...(source ? { source } : {}),
        },
        staffKey,
      );
      setState('done');
      window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: item.oppId }));
    } catch (caught) {
      const detail =
        caught instanceof ApiError
          ? `${caught.body.message} ${caught.body.nextAction ?? ''}`.trim()
          : errorTexts.network;
      setError(`${texts.putFailed} (${detail})`);
      setState('idle');
    }
  }

  return (
    <li data-testid="assistant-suggestion" style={{ display: 'grid', gap: 4 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>{item.name}</Link>
        <span>· {next}</span>
        {state === 'done' ? (
          <span data-testid="assistant-suggestion-done" style={{ color: statusPalette.ok.fg }}>
            ✓ {texts.putDone}
          </span>
        ) : same ? (
          <span data-testid="assistant-suggestion-same" style={secondary}>
            {texts.putSame}
          </span>
        ) : canRecord && state !== 'confirm' ? (
          <Button
            size="small"
            loading={state === 'saving'}
            onClick={() => (current ? setState('confirm') : void save())}
            data-testid="assistant-suggestion-put"
          >
            {texts.putIn}
          </Button>
        ) : null}
      </span>
      {state === 'confirm' && current ? (
        <span
          data-testid="assistant-suggestion-confirm"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
        >
          <span style={secondary}>{texts.putConfirm(current, withRo(next))}</span>
          <Button
            size="small"
            type="primary"
            onClick={() => void save()}
            data-testid="assistant-suggestion-change"
          >
            {texts.putChange}
          </Button>
          <Button
            size="small"
            onClick={() => setState('idle')}
            data-testid="assistant-suggestion-keep"
          >
            {texts.putKeep}
          </Button>
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ color: colors.error, fontSize: typography.fontSizeSecondary }}>
          {error}
        </span>
      ) : null}
    </li>
  );
}

export default function AssistantAnswerBox({ answer }: { answer: AssistantAnswer }) {
  const { companiesIncluded: included, companiesTotal: total } = answer;
  const partial = included !== undefined && total !== undefined && included < total;
  const [open, setOpen] = useState(false);
  // 답 끝의 빈 줄은 줄 수에 넣지 않는다(4줄 답에 [더 보기]가 붙지 않게).
  const full = answer.answer.trimEnd();
  const lines = full.split('\n');
  const long = lines.length > SHOWN_LINES;
  const shown = long && !open ? lines.slice(0, SHOWN_LINES).join('\n') : full;
  const suggestions = answer.suggestions ?? [];
  return (
    <div
      data-testid="assistant-answer"
      aria-live="polite"
      style={{
        display: 'grid',
        gap: 8,
        padding: 12,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: 8,
        background: colors.bgLayout,
      }}
    >
      <span
        data-testid="assistant-ai-mark"
        style={{
          justifySelf: 'start',
          padding: '2px 8px',
          borderRadius: 4,
          background: statusPalette.wait.bg,
          color: statusPalette.wait.fg,
          fontSize: typography.fontSizeSecondary,
        }}
      >
        {texts.aiMark}
      </span>
      <p data-testid="assistant-answer-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {shown}
      </p>
      {long ? (
        <Button
          type="link"
          size="small"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid="assistant-answer-more"
          style={{ justifySelf: 'start', padding: 0 }}
        >
          {open ? texts.answerLess : texts.answerMore}
        </Button>
      ) : null}
      {suggestions.length > 0 ? (
        <section
          data-testid="assistant-suggestions"
          aria-label={texts.suggestionsTitle}
          style={{ display: 'grid', gap: 6 }}
        >
          <strong style={{ fontSize: typography.fontSizeSecondary }}>
            {texts.suggestionsTitle}
          </strong>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {suggestions.map((item) => (
              <SuggestionItem key={`${item.oppId}-${item.date}`} item={item} />
            ))}
          </ul>
          <span style={secondary}>{texts.suggestionsHint}</span>
        </section>
      ) : null}
      {answer.sources.length > 0 ? (
        <p data-testid="assistant-sources" style={{ margin: 0, ...secondary }}>
          {texts.sourcesLabel}{' '}
          {answer.sources.map((source, index) => (
            <span key={source.oppId}>
              {index > 0 ? ' · ' : null}
              <Link to={`/opportunities/${encodeURIComponent(source.oppId)}`}>{source.name}</Link>
            </span>
          ))}
        </p>
      ) : (
        <p data-testid="assistant-sources-none" style={{ margin: 0, ...secondary }}>
          {texts.sourcesNone}
        </p>
      )}
      {partial ? (
        <p data-testid="assistant-partial" style={{ margin: 0, ...secondary }}>
          {texts.partial(total, included)}
        </p>
      ) : null}
    </div>
  );
}
