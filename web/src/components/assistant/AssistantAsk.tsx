// 대시보드 "오늘 확인할 것" 아래의 질문 칸(#680): 한 줄로 묻고 [묻기 💰]를 누르면 답이 그 아래에 펴진다.
// 예: "가격 때문에 거절된 회사는?" → 답 글 + "AI가 쓴 답 · 확인 필요" + 근거 회사 링크.
// 서버는 메모 글 없이 고른 값(단계·접촉 날짜·거절 이유·고른 답·일정 날짜)만 AI에 보낸다. 아무 값도 바꾸지 않는다.
// 설정을 아직 못 읽었거나 서버가 값을 안 주면 아무것도 보이지 않고, 스위치가 꺼져 있으면 칸 대신 안내 한 줄만 보인다.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input } from 'antd';
import { assistantConfigOf, postAssistantAsk } from '../../api/assistant';
import type { AssistantAnswer } from '../../api/assistant';
import { ApiError } from '../../api/client';
import { assistantTexts as texts, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';
import AssistantAnswerBox from './AssistantAnswerBox';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function AssistantAsk() {
  const { config, staffKey, canRecord } = useFrame();
  const settings = assistantConfigOf(config);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!settings) return null;
  if (!settings.enabled) {
    return (
      <p data-testid="assistant-disabled" style={{ margin: 0, ...secondary }}>
        {texts.disabled}
      </p>
    );
  }

  const text = question.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!staffKey || !canRecord || !text || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const envelope = await postAssistantAsk(text, staffKey);
      setAnswer(envelope.data);
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.askFailed} (${detail})`);
    } finally {
      setAsking(false);
    }
  };

  return (
    <section
      data-testid="assistant-ask"
      aria-label={texts.askLabel}
      style={{ display: 'grid', gap: 8 }}
    >
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <label htmlFor="assistant-question" style={{ position: 'absolute', left: -9999 }}>
          {texts.askLabel}
        </label>
        <Input
          id="assistant-question"
          data-testid="assistant-question-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={texts.askPlaceholder}
          maxLength={settings.questionMaxLength ?? undefined}
          disabled={!canRecord || asking}
          allowClear
        />
        <Button
          htmlType="submit"
          data-testid="assistant-ask-button"
          loading={asking}
          disabled={!canRecord || !text}
        >
          {texts.askButton}
        </Button>
      </form>
      <span data-testid="assistant-ask-hint" style={secondary}>
        {canRecord ? texts.askHint : texts.pickStaffFirst}
      </span>
      {asking ? (
        <span data-testid="assistant-asking" role="status" style={secondary}>
          {texts.asking}
        </span>
      ) : null}
      {error ? (
        <p
          data-testid="assistant-ask-error"
          role="alert"
          style={{ margin: 0, color: colors.error }}
        >
          {error}
        </p>
      ) : null}
      {answer ? <AssistantAnswerBox answer={answer} /> : null}
    </section>
  );
}
