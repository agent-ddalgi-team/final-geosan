// 오른쪽 영업 코치 칸의 질문 칸(#680): 한 줄로 묻고 [묻기]를 누르면 답이 그 아래에 펴진다.
// #981(PM 결정 2026-11-28): 시안 모양 — 안내 말풍선 → 그 화면에 맞는 예시 질문 단추 세 개 → 질문 칸과 보라 [묻기 유료].
// 예시 질문 단추는 질문 칸에 글만 채운다(요청 0건, 비용 없음). 비용은 [묻기]를 눌러 보낼 때만 든다.
// 예: "가격 때문에 거절된 회사는?" → 답 글 + "AI가 쓴 답 · 확인 필요" + 근거 회사 링크.
// 서버는 메모 글 없이 고른 값(단계·접촉 날짜·거절 이유·고른 답·일정 날짜)만 AI에 보낸다. 아무 값도 바꾸지 않는다.
// 설정을 아직 못 읽었거나 서버가 값을 안 주면 아무것도 보이지 않고, 스위치가 꺼져 있으면 칸 대신 안내 한 줄만 보인다.
// #774: 지금 화면(대시보드·신규 거래처 찾기·관심 기업·영업 분석)을 함께 보낸다. 신규 거래처 찾기에서는
// 서버가 아직 연락 안 한 후보 표(지역·적합도·거리)도 싣는다.
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Input } from 'antd';
import type { InputRef } from 'antd';
import { assistantConfigOf, postAssistantAsk } from '../../api/assistant';
import type { AssistantAnswer, AssistantPage } from '../../api/assistant';
import { ApiError } from '../../api/client';
import { assistantTexts as texts, errorTexts } from '../../labels/ko';
import { BOOKMARKS_PATH, LIST_PATH } from '../../paths';
import { colors, radius, typography } from '../../theme/tokens';
import PaidTag from '../common/PaidTag';
import { useFrame } from '../frame/FrameContext';
import AssistantAnswerBox from './AssistantAnswerBox';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/** 주소로 지금 화면을 고른다. 모르는 화면이면 null(서버는 지금처럼 답한다). */
export function assistantPageOf(pathname: string): AssistantPage | null {
  if (pathname === '/') return 'DASHBOARD';
  if (pathname === LIST_PATH) return 'LIST';
  if (pathname === BOOKMARKS_PATH) return 'BOOKMARKS';
  if (pathname === '/sales-analysis') return 'ANALYSIS';
  return null;
}

export default function AssistantAsk() {
  const { config, staffKey, canRecord } = useFrame();
  const page = assistantPageOf(useLocation().pathname);
  const settings = assistantConfigOf(config);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<InputRef>(null);

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
      const envelope = await postAssistantAsk(text, staffKey, page);
      setAnswer(envelope.data);
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.askFailed} (${detail})`);
    } finally {
      setAsking(false);
    }
  };

  // 예시 질문은 질문 칸이 놓인 화면 네 곳에만 있다. 모르는 화면이면 단추를 그리지 않는다.
  const examples = page ? texts.examples[page] : [];
  const pickExample = (example: string) => {
    setQuestion(example);
    inputRef.current?.focus();
  };

  return (
    <section
      data-testid="assistant-ask"
      aria-label={texts.askLabel}
      style={{ display: 'grid', gap: 12 }}
    >
      <p
        data-testid="assistant-intro"
        style={{
          margin: 0,
          padding: '10px 14px',
          borderRadius: radius.control,
          borderBottomLeftRadius: 4,
          background: colors.bgLayout,
          color: colors.textSecondary,
        }}
      >
        {texts.intro[page ?? 'OTHER']}
      </p>
      {examples.length > 0 ? (
        <div
          role="group"
          aria-label={texts.examplesLabel}
          data-testid="assistant-examples"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => pickExample(example)}
              disabled={!canRecord || asking}
              data-testid="assistant-example"
              style={{
                minHeight: 32,
                padding: '0 12px',
                border: `1px solid ${colors.borderSecondary}`,
                borderRadius: radius.controlSm,
                background: colors.bgContainer,
                color: colors.textSecondary,
                font: 'inherit',
                fontSize: typography.fontSizeSecondary,
                cursor: !canRecord || asking ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={submit}
        style={{
          display: 'flex',
          gap: 6,
          padding: 5,
          borderRadius: radius.control,
          background: colors.bgLayout,
        }}
      >
        <label htmlFor="assistant-question" style={{ position: 'absolute', left: -9999 }}>
          {texts.askLabel}
        </label>
        <Input
          ref={inputRef}
          id="assistant-question"
          data-testid="assistant-question-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={page === 'LIST' ? texts.askPlaceholderList : texts.askPlaceholder}
          maxLength={settings.questionMaxLength ?? undefined}
          disabled={!canRecord || asking}
          allowClear
          variant="borderless"
        />
        <Button
          type="primary"
          htmlType="submit"
          data-testid="assistant-ask-button"
          loading={asking}
          disabled={!canRecord || !text}
        >
          {texts.askButton} <PaidTag onPrimary />
        </Button>
      </form>
      <span data-testid="assistant-ask-hint" style={secondary}>
        {canRecord
          ? `${page === 'LIST' ? texts.askHintList : texts.askHint} ${texts.askCostHint}`
          : texts.pickStaffFirst}
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
