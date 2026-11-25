// #918 영업 분석 "지난 분석" 탭: [AI 분석 받기]로 받을 때마다 저장된 분석을 최근 것부터 줄로 보이고,
// 줄을 누르면 그때 받은 본문(AnalysisFeedbackCard와 같은 모양)을 바로 아래에 연다. 읽기만 한다(AI 호출 없음).
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  getFeedbackHistory,
  getPastFeedback,
  type AnalysisFeedback,
  type FeedbackHistoryItem,
} from '../../api/salesAnalysis';
import { analysisFeedbackTexts, pastAnalysisTexts as t } from '../../labels/ko';
import { colors, radius, typography } from '../../theme/tokens';
import { formatMonthDay, formatMonthDayTime } from '../../utils/time';
import FiveStates from '../common/FiveStates';
import { useFrame } from '../frame/FrameContext';
import { FeedbackBody } from './AnalysisFeedbackCard';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const rowStyle = {
  display: 'grid',
  gap: 4,
  width: '100%',
  textAlign: 'left',
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: radius.lg,
  padding: '12px 16px',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
} as const;

type Opened =
  | { id: string; status: 'loading' }
  | { id: string; status: 'ready'; feedback: AnalysisFeedback }
  | { id: string; status: 'error'; message: string };

export default function PastAnalyses() {
  const { config } = useFrame();
  const [items, setItems] = useState<FeedbackHistoryItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [opened, setOpened] = useState<Opened | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getFeedbackHistory(controller.signal)
      .then((envelope) => {
        setItems(envelope.data.items);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught);
      });
    return () => controller.abort();
  }, [reload]);

  function open(id: string) {
    if (opened?.id === id) {
      setOpened(null);
      return;
    }
    setOpened({ id, status: 'loading' });
    getPastFeedback(id)
      .then((envelope) =>
        setOpened((now) =>
          now?.id === id ? { id, status: 'ready', feedback: envelope.data } : now,
        ),
      )
      .catch((caught: unknown) =>
        setOpened((now) =>
          now?.id === id
            ? {
                id,
                status: 'error',
                message:
                  caught instanceof ApiError
                    ? `${caught.body.message} ${caught.body.nextAction}`
                    : t.openError,
              }
            : now,
        ),
      );
  }

  const staffName = (key: string) =>
    config?.staff.find((entry) => entry.key === key)?.displayName ?? key;
  const state = error
    ? 'error'
    : items === null
      ? 'loading'
      : items.length === 0
        ? 'empty'
        : 'ready';

  return (
    <section data-testid="past-analyses" style={{ display: 'grid', gap: 12 }}>
      <p style={{ ...secondary, margin: 0 }}>{t.intro}</p>
      <FiveStates
        data-testid="past-analyses-state"
        state={state}
        errorTitle={t.loadError}
        error={error}
        onRetry={() => {
          setError(null);
          setItems(null);
          setReload((value) => value + 1);
        }}
        emptyText={t.empty}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {(items ?? []).map((item) => {
            const isOpen = opened?.id === item.feedbackId;
            const period =
              item.periodFrom || item.periodTo
                ? t.period(formatMonthDay(item.periodFrom), formatMonthDay(item.periodTo))
                : t.allPeriod;
            return (
              <li key={item.feedbackId} style={{ display: 'grid', gap: 8 }}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => open(item.feedbackId)}
                  data-testid="past-analysis-row"
                  style={rowStyle}
                >
                  <strong>{item.headline || t.noHeadline}</strong>
                  <span style={secondary}>
                    {t.line(
                      formatMonthDayTime(item.generatedAt) ?? item.generatedAt,
                      period,
                      staffName(item.generatedBy),
                      item.nextCount,
                    )}
                  </span>
                </button>
                {isOpen ? (
                  <div
                    data-testid="past-analysis-body"
                    style={{ ...rowStyle, cursor: 'default', gap: 12 }}
                  >
                    {opened.status === 'loading' ? (
                      <span style={secondary}>{t.loading}</span>
                    ) : opened.status === 'error' ? (
                      <p role="alert" style={{ color: colors.error, margin: 0 }}>
                        {opened.message}
                      </p>
                    ) : (
                      <>
                        <span style={secondary}>{analysisFeedbackTexts.aiTag}</span>
                        <FeedbackBody feedback={opened.feedback} />
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </FiveStates>
    </section>
  );
}
