// 검토사항 영역(U5, 상세 화면 (3)): 확인 질문·"자료 못 찾음"·"자료 부족" 항목을 한 목록으로 모으고,
// 담당자가 확인하면 체크한다. 목록은 서버가 평가 결과에서 만들고, 화면은 체크 상태만 저장한다.
// 체크와 해제는 모두 새 기록이라 지우는 단추는 없다(Q5). 저장이 끝난 뒤에만 체크 모양이 바뀐다.
// 질문 줄에는 [답 적기]가 붙는다(2026-11-04): 누르면 줄 아래에 인라인 입력 한 칸이 열리고(모달 없음, 500자),
// 저장하면 "답: …"이 보인다. 답이 있으면 [답 고치기]. 답을 저장해도 체크는 자동으로 바뀌지 않는다.
// AI 제안 줄(#498, 2026-11-09)에는 체크 상자 대신 [확정]·[고치기]가 붙는다. [확정]은 기존 체크 저장 그대로
// (checked:true), [고치기]는 줄 안에 드롭다운이 열려(모달 없음) 서버가 준 단계 하나를 고르고 checked:true와 stepLabel을
// 함께 보낸다. 공정 연결 제안은 1차에 [확정]만. 저장이 끝나면 점수가 바뀌므로 상세를 다시 불러오게 알린다.
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
  /** AI 제안 줄의 [확정]·[고치기] 저장이 끝났을 때 알린다(점수가 바뀌므로 상세를 다시 불러오게). */
  onProposalSaved?: () => void;
}

/** AI가 제안한 줄(점수 입력·공정 연결). 체크 상자 대신 [확정]·[고치기]가 붙는다. */
export function isProposal(item: ReviewItem): boolean {
  return item.kind === 'ITEM_INPUT_PROPOSAL' || item.kind === 'PROCESS_LINK_PROPOSAL';
}

/** [고치기]는 점수 입력 제안 줄이고 서버가 단계 선택지를 줬을 때만 보인다(공정 연결은 1차에 [확정]만). */
export function canFixProposal(item: ReviewItem): boolean {
  return item.kind === 'ITEM_INPUT_PROPOSAL' && (item.stepOptions?.length ?? 0) > 0;
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
  // 표면처리를 직접 하는 회사일 수 있음(#319): 담당자가 확인해야 하는 표시다. 줄은 서버가 준 그대로 보이고 화면이 빼지 않는다.
  OWN_PLATING_LINE_SUSPECTED: 'ask',
  // AI가 제안한 값은 사람이 확인하기 전이라 "확인 필요" 색으로 보인다(#498).
  ITEM_INPUT_PROPOSAL: 'ask',
  PROCESS_LINK_PROPOSAL: 'ask',
};

export default function ReviewArea({
  oppId,
  evalId,
  items: initialItems,
  onReplied,
  onProposalSaved,
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
  // [고치기] 드롭다운: 한 번에 한 줄만 연다. 고른 단계가 없으면 저장할 수 없다.
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState('');

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

  /** [확정](stepLabel 없음) 또는 [고치기](stepLabel 있음). 둘 다 checked:true로 기존 체크 저장을 쓴다. */
  async function saveProposal(item: ReviewItem, stepLabel?: string) {
    if (!staffKey || !evalId) return;
    setBusyId(item.itemId);
    setError(null);
    try {
      const body =
        stepLabel === undefined ? { checked: true, evalId } : { checked: true, evalId, stepLabel };
      const envelope = await postReviewCheck(oppId, item.itemId, body, staffKey);
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
      setFixingId(null);
      setStepDraft('');
      onProposalSaved?.();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError({ itemId: item.itemId, text: `${reviewArea.saveFailed} (${detail})` });
    } finally {
      setBusyId(null);
    }
  }

  function openFix(item: ReviewItem) {
    setFixingId(item.itemId);
    setStepDraft('');
    setError(null);
  }

  function closeFix() {
    setFixingId(null);
    setStepDraft('');
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
                  {isProposal(item) ? null : (
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
                  )}
                  <StatusTag tone={KIND_TONE[item.kind] ?? 'neutral'} data-testid="review-tag">
                    {reviewArea.tag(item.kind, item.targetLabel)}
                  </StatusTag>
                  {isProposal(item) ? (
                    <span data-testid="review-text">{item.text}</span>
                  ) : (
                    <label htmlFor={inputId} data-testid="review-text">
                      {item.text}
                    </label>
                  )}
                  {isProposal(item) && !item.checked ? (
                    <>
                      <Button
                        type="primary"
                        size="small"
                        disabled={locked}
                        onClick={() => void saveProposal(item)}
                        aria-label={reviewArea.proposalConfirmLabel(item.text)}
                        data-testid="review-proposal-confirm"
                      >
                        {reviewArea.proposalConfirm}
                      </Button>
                      {canFixProposal(item) ? (
                        <Button
                          size="small"
                          disabled={locked}
                          onClick={() => openFix(item)}
                          aria-label={reviewArea.proposalFixLabel(item.text)}
                          data-testid="review-proposal-fix"
                        >
                          {reviewArea.proposalFix}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
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
                {fixingId === item.itemId ? (
                  <div
                    data-testid="review-fix-editor"
                    style={{ marginLeft: 28, display: 'flex', flexWrap: 'wrap', gap: 8 }}
                  >
                    <select
                      value={stepDraft}
                      onChange={(event) => setStepDraft(event.target.value)}
                      disabled={locked}
                      aria-label={reviewArea.stepPickerLabel}
                      data-testid="review-fix-select"
                      style={{ font: 'inherit', padding: 4 }}
                    >
                      <option value="">{reviewArea.stepPlaceholder}</option>
                      {(item.stepOptions ?? []).map((step) => (
                        <option key={step} value={step}>
                          {step}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="primary"
                      size="small"
                      disabled={locked || stepDraft === ''}
                      onClick={() => void saveProposal(item, stepDraft)}
                      data-testid="review-fix-save"
                    >
                      {reviewArea.stepSave}
                    </Button>
                    <Button
                      size="small"
                      disabled={busyId !== null}
                      onClick={closeFix}
                      data-testid="review-fix-cancel"
                    >
                      {reviewArea.stepCancel}
                    </Button>
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
