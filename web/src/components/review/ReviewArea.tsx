// 검토사항 영역(U5, 상세 화면 (3)): 확인 질문·"자료 못 찾음"·"자료 부족" 항목을 한 목록으로 모으고,
// 담당자가 확인하면 체크한다. 목록은 서버가 평가 결과에서 만들고, 화면은 체크 상태만 저장한다.
// 체크와 해제는 모두 새 기록이라 지우는 단추는 없다(Q5). 저장이 끝난 뒤에만 체크 모양이 바뀐다.
// 질문 줄에는 [답 적기]가 붙는다(2026-11-04): 누르면 줄 아래에 인라인 입력 한 칸이 열리고(모달 없음, 500자),
// 저장하면 "답: …"이 보인다. 답이 있으면 [답 고치기]. 답을 저장해도 체크는 자동으로 바뀌지 않는다.
import { useState } from 'react';
import { Button, Typography } from 'antd';
import { ApiError, postQuestionReply, postReviewCheck } from '../../api/client';
import type { ReviewItem, ReviewItemKind } from '../../api/types';
import { errorTexts, reviewArea } from '../../labels/ko';
import type { StatusTone } from '../../theme/tokens';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { useFrame } from '../frame/FrameContext';

export interface ReviewAreaProps {
  oppId: string;
  /** 본 평가 ID. 체크 요청에 꼭 필요하다. 없으면 체크 상자를 잠근다. */
  evalId: string | null;
  items: ReviewItem[];
  /** 답 저장이 끝났을 때 알린다(활동 이력을 새로 불러오게). */
  onReplied?: () => void;
}

/** 줄 번호 "Q:<질문번호>"에서 질문 번호를 꺼낸다. 질문 줄이 아니면 null. */
export function questionIdOf(item: ReviewItem): string | null {
  if (item.kind !== 'QUESTION' || !item.itemId.startsWith('Q:')) return null;
  return item.itemId.slice(2) || null;
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const KIND_TONE: Record<ReviewItemKind, StatusTone> = {
  QUESTION: 'ask',
  DATA_NOT_FOUND: 'wait',
  DATA_INSUFFICIENT: 'wait',
};

export default function ReviewArea({
  oppId,
  evalId,
  items: initialItems,
  onReplied,
}: ReviewAreaProps) {
  const { config, staffKey, canRecord } = useFrame();
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ itemId: string; text: string } | null>(null);
  // 답 입력칸: 한 번에 한 줄만 연다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<{ itemId: string; text: string } | null>(null);

  const done = items.filter((item) => item.checked).length;
  const locked = !canRecord || !evalId || busyId !== null;

  function personName(key: string | null | undefined): string {
    if (!key) return '';
    return config?.staff.find((entry) => entry.key === key)?.displayName ?? key;
  }

  async function toggle(item: ReviewItem) {
    if (!staffKey || !evalId) return;
    setBusyId(item.itemId);
    setError(null);
    try {
      const envelope = await postReviewCheck(
        oppId,
        item.itemId,
        { checked: !item.checked, evalId },
        staffKey,
      );
      const saved = envelope.data;
      setItems((prev) =>
        prev.map((entry) =>
          entry.itemId === item.itemId
            ? {
                ...entry,
                checked: saved.checked,
                checkedBy: saved.checkedBy ?? null,
                checkedAt: saved.checkedAt ?? null,
              }
            : entry,
        ),
      );
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError({ itemId: item.itemId, text: `${reviewArea.saveFailed} (${detail})` });
    } finally {
      setBusyId(null);
    }
  }

  function openReply(item: ReviewItem) {
    setEditingId(item.itemId);
    setDraft(item.replyText ?? '');
    setReplyError(null);
  }

  function closeReply() {
    setEditingId(null);
    setDraft('');
    setReplyError(null);
  }

  async function saveReply(item: ReviewItem) {
    const questionId = questionIdOf(item);
    const text = draft.trim();
    if (!staffKey || !questionId || text === '') return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      const envelope = await postQuestionReply(
        questionId,
        { replyText: text, repliedAt: today() },
        staffKey,
      );
      const saved = envelope.data;
      setItems((prev) =>
        prev.map((entry) =>
          entry.itemId === item.itemId
            ? {
                ...entry,
                replyText: saved.replyText,
                repliedAt: saved.repliedAt,
                repliedBy: saved.repliedBy ?? null,
              }
            : entry,
        ),
      );
      closeReply();
      onReplied?.();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setReplyError({ itemId: item.itemId, text: `${reviewArea.replySaveFailed} (${detail})` });
    } finally {
      setReplyBusy(false);
    }
  }

  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  return (
    <div data-testid="review-area" style={{ display: 'grid', gap: 8 }}>
      <span data-testid="review-progress" style={{ fontWeight: 600 }}>
        {reviewArea.progress(done, items.length)}
      </span>
      <span style={secondary}>{reviewArea.hint}</span>
      {!canRecord ? (
        <Typography.Text type="secondary" data-testid="review-pick-staff-text">
          {reviewArea.pickStaffFirst}
        </Typography.Text>
      ) : null}
      {items.length === 0 ? (
        <p data-testid="review-empty" style={{ margin: 0 }}>
          {reviewArea.empty}
        </p>
      ) : (
        <ul
          aria-label={reviewArea.listLabel}
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}
        >
          {items.map((item) => {
            const inputId = `review-check-${oppId}-${item.itemId}`;
            const who = personName(item.checkedBy);
            const when = formatMonthDay(item.checkedAt);
            return (
              <li key={item.itemId} data-testid="review-item">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={item.checked}
                    disabled={locked}
                    onChange={() => void toggle(item)}
                    aria-label={reviewArea.checkLabel(item.text)}
                    data-testid="review-checkbox"
                    style={{ width: 20, height: 20 }}
                  />
                  <StatusTag tone={KIND_TONE[item.kind] ?? 'neutral'} data-testid="review-tag">
                    {reviewArea.tag(item.kind, item.targetLabel)}
                  </StatusTag>
                  <label htmlFor={inputId} data-testid="review-text">
                    {item.text}
                  </label>
                  {questionIdOf(item) ? (
                    <Button
                      size="small"
                      disabled={!canRecord || !evalId || replyBusy}
                      onClick={() => openReply(item)}
                      aria-label={reviewArea.replyButtonLabel(item.text)}
                      data-testid="review-reply-button"
                    >
                      {item.replyText ? reviewArea.replyEdit : reviewArea.replyAdd}
                    </Button>
                  ) : null}
                </div>
                {item.replyText && editingId !== item.itemId ? (
                  <div data-testid="review-reply" style={{ marginLeft: 28 }}>
                    <span>
                      {reviewArea.replyPrefix} {item.replyText}
                    </span>
                    {personName(item.repliedBy) && formatMonthDay(item.repliedAt) ? (
                      <span data-testid="review-replied-by" style={secondary}>
                        {' — '}
                        {reviewArea.repliedBy(
                          personName(item.repliedBy),
                          formatMonthDay(item.repliedAt) ?? '',
                        )}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {editingId === item.itemId ? (
                  <div
                    data-testid="review-reply-editor"
                    style={{ marginLeft: 28, display: 'grid', gap: 6, maxWidth: 560 }}
                  >
                    <textarea
                      value={draft}
                      maxLength={reviewArea.replyMaxLength}
                      rows={3}
                      placeholder={reviewArea.replyPlaceholder}
                      aria-label={reviewArea.replyInputLabel}
                      onChange={(event) => setDraft(event.target.value)}
                      disabled={replyBusy}
                      data-testid="review-reply-input"
                      style={{ width: '100%', font: 'inherit', padding: 6 }}
                    />
                    <span style={secondary}>{reviewArea.replyHint}</span>
                    <span data-testid="review-reply-counter" style={secondary}>
                      {reviewArea.replyCounter(draft.length, reviewArea.replyMaxLength)}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        type="primary"
                        size="small"
                        loading={replyBusy}
                        disabled={draft.trim() === ''}
                        onClick={() => void saveReply(item)}
                        data-testid="review-reply-save"
                      >
                        {reviewArea.replySave}
                      </Button>
                      <Button
                        size="small"
                        disabled={replyBusy}
                        onClick={closeReply}
                        data-testid="review-reply-cancel"
                      >
                        {reviewArea.replyCancel}
                      </Button>
                    </div>
                    {replyError?.itemId === item.itemId ? (
                      <div
                        role="alert"
                        data-testid="review-reply-error"
                        style={{ color: colors.error }}
                      >
                        {replyError.text}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {item.checked && who && when ? (
                  <div data-testid="review-checked-by" style={{ ...secondary, marginLeft: 28 }}>
                    {reviewArea.checkedBy(who, when)}
                  </div>
                ) : null}
                {error?.itemId === item.itemId ? (
                  <div
                    role="alert"
                    data-testid="review-error"
                    style={{ color: colors.error, marginLeft: 28 }}
                  >
                    {error.text}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
