// #824(#802 2단계-가) 영업 분석 맨 위 "AI 분석 피드백" 카드.
// 숫자 표만 외부 AI에 보내 실패를 먼저(어디서 → 왜 → 실패 전 신호 → 성공과 다른 점 → 다음엔), 성공,
// 다음 할 일을 근거 숫자와 함께 받는다. 기간마다 저장본을 먼저 읽고(AI 호출 없음), [분석 받기 💰]를
// 눌러야 부른다. 영업 기록 스위치가 꺼져 있거나 담당자를 안 골랐거나 보기 전용이면 단추가 잠긴다.
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { ApiError } from '../../api/client';
import {
  getSalesFeedback,
  requestSalesFeedback,
  type AnalysisFeedback,
  type AnalysisPeriod,
  type FeedbackClaim,
  type FeedbackState,
} from '../../api/salesAnalysis';
import { analysisFeedbackTexts as t } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const box = {
  display: 'grid',
  gap: 12,
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: '16px 20px',
} as const;

function Claims({ items, testId }: { items: FeedbackClaim[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <ul data-testid={testId} style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
      {items.map((item, index) => (
        <li key={`${testId}-${index}`}>
          <span>{item.text}</span>
          <span data-testid="feedback-evidence" style={{ ...secondary, display: 'block' }}>
            {t.evidence(item.evidence)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Part({
  title,
  parts,
  labels,
  testId,
}: {
  title: string;
  parts: Record<string, FeedbackClaim[]>;
  labels: Record<string, string>;
  testId: string;
}) {
  const filled = Object.entries(parts).filter(([, items]) => items.length > 0);
  if (filled.length === 0) return null;
  return (
    <section data-testid={testId} style={{ display: 'grid', gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: typography.fontSize }}>{title}</h3>
      {filled.map(([key, items]) => (
        <div key={key} style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: typography.fontSizeSecondary }}>{labels[key] ?? key}</strong>
          <Claims items={items} testId={`${testId}-${key}`} />
        </div>
      ))}
    </section>
  );
}

function Compared({ feedback }: { feedback: AnalysisFeedback }) {
  const compared = feedback.comparedToPrevious;
  if (!compared) return null;
  return (
    <p data-testid="feedback-compared" style={{ ...secondary, margin: 0 }}>
      {t.compareTitle(compared.previousFrom, compared.previousTo)}:{' '}
      {compared.rows
        .map((row) => {
          const diff = row.current - row.previous;
          const arrow = diff > 0 ? `↑${diff}` : diff < 0 ? `↓${-diff}` : '—';
          return `${t.compareKeys[row.key] ?? row.key} ${row.current} (${arrow})`;
        })
        .join(' · ')}
    </p>
  );
}

export interface AnalysisFeedbackCardProps {
  period: AnalysisPeriod;
  /** 영업 분석을 다시 읽을 때 함께 다시 읽는다. */
  reloadKey?: number;
}

export default function AnalysisFeedbackCard({ period, reloadKey = 0 }: AnalysisFeedbackCardProps) {
  const { staffKey, canRecord } = useFrame();
  // 읽은 값은 어느 기간·몇 번째 다시 읽기의 것인지와 함께 둔다(다른 기간의 값은 보이지 않는다).
  const key = `${period.from ?? ''}~${period.to ?? ''}#${reloadKey}`;
  const [loaded, setLoaded] = useState<{ key: string; state: FeedbackState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ key: string; text: string } | null>(null);
  const state = loaded?.key === key ? loaded.state : null;

  useEffect(() => {
    const controller = new AbortController();
    getSalesFeedback(controller.signal, period)
      .then((envelope) => setLoaded({ key, state: envelope.data }))
      .catch(() => {
        // 저장본을 못 읽어도 분석 화면의 나머지는 그대로 보인다. 카드는 빈 상태로 둔다.
        if (!controller.signal.aborted)
          setLoaded({ key, state: { feedback: null, current: false, switchOn: false } });
      });
    return () => controller.abort();
    // key가 period·reloadKey를 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function ask() {
    if (!staffKey || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const envelope = await requestSalesFeedback(period, Boolean(state?.feedback), staffKey);
      setLoaded({
        key,
        state: { feedback: envelope.data.feedback, current: true, switchOn: true },
      });
    } catch (error) {
      setMessage({
        key,
        text:
          error instanceof ApiError ? `${error.body.message} ${error.body.nextAction}` : t.failed,
      });
    } finally {
      setBusy(false);
    }
  }
  const messageText = message?.key === key ? message.text : '';

  const feedback = state?.feedback ?? null;
  const locked = !state?.switchOn || !staffKey || !canRecord;
  const buttonText = feedback ? t.refresh : t.request;
  return (
    <section aria-labelledby="analysis-feedback-title" data-testid="analysis-feedback" style={box}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h2
          id="analysis-feedback-title"
          style={{ margin: 0, fontSize: typography.fontSizeCardTitle }}
        >
          {t.title}
        </h2>
        {feedback ? (
          <span data-testid="feedback-ai-tag" style={secondary}>
            {t.aiTag}
          </span>
        ) : null}
      </div>
      {!feedback ? <p style={{ ...secondary, margin: 0 }}>{t.intro}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button
          type={feedback ? 'default' : 'primary'}
          disabled={locked || busy || state === null}
          onClick={() => void ask()}
          data-testid="feedback-request"
        >
          {buttonText}
        </Button>
        {feedback && state && !state.current ? (
          <span data-testid="feedback-stale" style={secondary}>
            {t.stale}
          </span>
        ) : null}
        {busy ? <span style={secondary}>{t.loading}</span> : null}
        {state && !state.switchOn ? (
          <span data-testid="feedback-switch-off" style={secondary}>
            {t.switchOff}
          </span>
        ) : state && !staffKey ? (
          <span style={secondary}>{t.needStaff}</span>
        ) : null}
      </div>
      {messageText ? (
        <p role="alert" style={{ color: colors.error, margin: 0 }}>
          {messageText}
        </p>
      ) : null}
      {feedback ? (
        <>
          <Part
            title={t.failureTitle}
            parts={feedback.failure}
            labels={t.parts}
            testId="feedback-failure"
          />
          <Part
            title={t.successTitle}
            parts={feedback.success}
            labels={t.successParts}
            testId="feedback-success"
          />
          {feedback.next.length > 0 ? (
            <section style={{ display: 'grid', gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: typography.fontSize }}>{t.nextTitle}</h3>
              <Claims items={feedback.next} testId="feedback-next" />
            </section>
          ) : null}
          {feedback.heldBack.length > 0 ? (
            <section data-testid="feedback-held-back" style={{ display: 'grid', gap: 4 }}>
              <strong style={{ fontSize: typography.fontSizeSecondary }}>{t.heldBackTitle}</strong>
              <ul style={{ ...secondary, margin: 0, paddingLeft: 18 }}>
                {feedback.heldBack.map((item, index) => (
                  <li key={`held-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <Compared feedback={feedback} />
          <p data-testid="feedback-generated" style={{ ...secondary, margin: 0 }}>
            {t.generated(
              feedback.generatedAt.slice(0, 10),
              feedback.costUsd === null ? null : `$${feedback.costUsd.toFixed(4)}`,
            )}
          </p>
        </>
      ) : state ? (
        <p style={{ ...secondary, margin: 0 }}>{t.empty}</p>
      ) : null}
    </section>
  );
}
