// 검토사항 영역(U5, 상세 화면 (3)): 확인 질문·"자료 못 찾음"·"자료 부족" 항목을 한 목록으로 모으고,
// 담당자가 확인하면 체크한다. 목록은 서버가 평가 결과에서 만들고, 화면은 체크 상태만 저장한다.
// 체크와 해제는 모두 새 기록이라 지우는 단추는 없다(Q5). 저장이 끝난 뒤에만 체크 모양이 바뀐다.
// 질문 줄에는 [답 적기]가 붙는다(2026-11-04): 누르면 줄 아래에 인라인 입력 한 칸이 열리고(모달 없음, 500자),
// 저장하면 "답: …"이 보인다. 답이 있으면 [답 고치기]. 답을 저장해도 체크는 자동으로 바뀌지 않는다.
// AI 제안 줄(#498, 2026-11-09)에는 체크 상자 대신 [확정]·[고치기]가 붙는다. [확정]은 기존 체크 저장 그대로
// (checked:true), [고치기]는 줄 안에 드롭다운이 열려(모달 없음) 서버가 준 단계 하나를 고르고 checked:true와 stepLabel을
// 함께 보낸다. 공정 연결 제안은 1차에 [확정]만. 저장이 끝나면 점수가 바뀌므로 상세를 다시 불러오게 알린다.
// 자료 줄에는 [메모 적기]도 붙는다(#260, 2026-11-12): 줄 아래에 인라인 입력이 열리고(모달 없음, 500자) 저장하면
// "메모: … — 박 이사 · 11/20"이 보인다(주소는 눌러 새 창으로). 있으면 [메모 고치기]. 기록용이라 점수·체크는 바뀌지 않는다.
// 자료 줄(#260, 2026-11-04)에는 [붙여넣고 조사]가 붙는다: 줄 아래에 출처 주소·공개 본문 입력이 열리고(모달 없음),
// 기존 홈페이지 조사 요청으로 근거를 뽑아 다시 평가한다. 체크는 자동으로 바뀌지 않는다. 한 번에 한 줄만 열고 조사 중에는 다른 줄도 잠근다.
// 줄이 많으면 묶어서 보인다(#619, 2026-11-13): "확인 필요"만 펼쳐 두고 "근거·자료가 없는 항목"과 "AI 공정 연결 제안"은
// 접어 둔다(누르면 줄 아래로 펼침, 모달 없음). 줄·단추는 그대로이고 접힘 상태는 저장하지 않는다. 전체 줄이
// REVIEW_FOLD_MIN_TOTAL 이하이면 접지 않고 예전처럼 한 목록으로 보인다.
import { useEffect, useState } from 'react';
import { Button, Typography } from 'antd';
import { ApiError, postQuestionReply, postReviewCheck } from '../../api/client';
import type { ReviewItem, ReviewItemKind } from '../../api/types';
import { errorTexts, reviewArea } from '../../labels/ko';
import type { StatusTone } from '../../theme/tokens';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';
import { useFrame } from '../frame/FrameContext';
import GapMemoEditor, { linkifyMemo } from './GapMemoEditor';
import PasteResearchForm from './PasteResearchForm';

/**
 * 조사가 끝나면 상세를 새로 불러오고 이 영역도 새로 그려져 안내가 사라진다.
 * 그래서 성공 안내는 여기에 맡겨 두었다가 새로 그려진 영역이 한 번 꺼내 보인다.
 */
const pendingPasteNotices = new Map<string, string>();

export interface ReviewAreaProps {
  oppId: string;
  /** 본 평가 ID. 체크 요청에 꼭 필요하다. 없으면 체크 상자를 잠근다. */
  evalId: string | null;
  items: ReviewItem[];
  /** 답 저장이 끝났을 때 알린다(활동 이력을 새로 불러오게). */
  onReplied?: () => void;
  /** 자료 줄 메모 저장이 끝났을 때 알린다(활동 이력을 새로 불러오게). 점수는 안 바뀌므로 상세는 다시 안 읽는다. */
  onMemoSaved?: () => void;
  /** AI 제안 줄의 [확정]·[고치기] 저장이 끝났을 때 알린다(점수가 바뀌므로 상세를 다시 불러오게). */
  onProposalSaved?: () => void;
  /** 확정된 홈페이지 주소(http/https). [붙여넣고 조사]의 출처 칸에 미리 채운다. 없으면 빈 칸. */
  homepageUrl?: string | null;
  /** [붙여넣고 조사]가 성공했거나 [새로 불러오기]를 누르면 부른다(상세·활동 이력을 다시 읽게). */
  onResearched?: () => void;
  /**
   * AI 점수 입력 제안 줄만 넘겨 "점수 자세히 보기" 안에 넣을 때 true(#674, PM 결정 2026-11-13).
   * 체크 안내·진행 수("확인 0 / 8")를 그리지 않는다. [확정]·[고치기]는 그대로 동작한다.
   */
  proposalsOnly?: boolean;
}

/** 자료 줄: 담당자가 찾아 보완할 수 있는 "자료 못 찾음"·"자료 부족" 줄. */
export function isGapLine(item: ReviewItem): boolean {
  return item.kind === 'DATA_NOT_FOUND' || item.kind === 'DATA_INSUFFICIENT';
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

/** 전체 줄 수가 이 값 이하이면 접지 않는다(화면 표시값, #619). */
export const REVIEW_FOLD_MIN_TOTAL = 5;
/** 접힌 머리 줄에 이름을 몇 개까지 적을지(나머지는 "외 n개"). */
export const REVIEW_FOLD_NAME_LIMIT = 3;

export type ReviewGroup = 'ask' | 'gap' | 'process';
type FoldGroup = Exclude<ReviewGroup, 'ask'>;
const FOLD_GROUPS: FoldGroup[] = ['gap', 'process'];

/** 체크·답·메모 가운데 하나라도 달린 줄. */
export function hasRecord(item: ReviewItem): boolean {
  return item.checked || Boolean(item.replyText) || Boolean(item.note);
}

/**
 * 줄이 들어갈 묶음. 기록이 달린 줄과 질문·표시·요구 조건 확인·점수 입력 제안은 "확인 필요"(펼쳐 둠),
 * "근거 없음"·"자료 못 찾음"은 gap, 공정 연결 제안은 process(둘 다 접어 둠).
 */
export function reviewGroupOf(item: ReviewItem): ReviewGroup {
  if (hasRecord(item)) return 'ask';
  if (item.kind === 'PROCESS_LINK_PROPOSAL') return 'process';
  if (isGapLine(item) && !item.itemId.startsWith('GAP:REQ:')) return 'gap';
  return 'ask';
}

/**
 * 공정 연결 제안 줄 글에서 공정 이름만 꺼낸다(접힌 머리 줄에 모아 보이려고). 서버 글 모양
 * "AI 공정 연결 제안 · <공정> · 근거: …" 또는 "AI 제안 · 공정 연결 — <공정> · 근거: …"가 아니면 null.
 */
export function processNameOf(item: ReviewItem): string | null {
  const parts = item.text.split(' · ');
  if (parts.length < 2) return null;
  if (parts[0] === 'AI 공정 연결 제안') return parts[1].trim() || null;
  const old = /^공정 연결 — (.+)$/.exec(parts[1]);
  return old ? old[1].trim() || null : null;
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
  onMemoSaved,
  onProposalSaved,
  homepageUrl = null,
  onResearched,
  proposalsOnly = false,
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
  // [메모 적기]: 한 번에 한 줄만 연다.
  const [memoOpenId, setMemoOpenId] = useState<string | null>(null);
  // [붙여넣고 조사]: 한 번에 한 줄만 연다. 조사 중에는 다른 줄의 단추도 잠근다.
  const [pasteOpenId, setPasteOpenId] = useState<string | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(
    () => pendingPasteNotices.get(oppId) ?? null,
  );

  // 묶음은 처음 받은 줄로 한 번만 정한다. 펼친 묶음에서 체크·메모를 저장해도 줄이 그 자리에 있고(자리 이동 없음),
  // 상세를 다시 불러오면 기록이 달린 줄은 "확인 필요"로 올라온다.
  const folded = initialItems.length > REVIEW_FOLD_MIN_TOTAL;
  const [groupById] = useState(
    () => new Map(initialItems.map((item) => [item.itemId, reviewGroupOf(item)])),
  );
  const [openGroups, setOpenGroups] = useState<Record<FoldGroup, boolean>>({
    gap: false,
    process: false,
  });

  useEffect(() => {
    pendingPasteNotices.delete(oppId);
  }, [oppId]);

  const done = items.filter((item) => item.checked).length;
  const inGroup = (group: ReviewGroup) =>
    items.filter((item) => (groupById.get(item.itemId) ?? 'ask') === group);
  const askItems = folded ? inGroup('ask') : items;
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

  function renderItem(item: ReviewItem) {
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
          {isGapLine(item) ? (
            <Button
              size="small"
              disabled={!canRecord || !staffKey}
              onClick={() => setMemoOpenId((open) => (open === item.itemId ? null : item.itemId))}
              aria-label={reviewArea.memoButtonLabel(item.text)}
              data-testid="review-memo-button"
            >
              {item.note ? reviewArea.memoEdit : reviewArea.memoAdd}
            </Button>
          ) : null}
          {isGapLine(item) ? (
            <Button
              size="small"
              disabled={!canRecord || !staffKey || pasteBusy}
              onClick={() => {
                setPasteNotice(null);
                setPasteOpenId((open) => (open === item.itemId ? null : item.itemId));
              }}
              aria-label={reviewArea.pasteButtonLabel(item.text)}
              data-testid="review-paste-button"
            >
              {reviewArea.pasteButton}
            </Button>
          ) : null}
        </div>
        {pasteOpenId === item.itemId ? (
          <PasteResearchForm
            oppId={oppId}
            defaultUrl={homepageUrl}
            onBusyChange={setPasteBusy}
            onCancel={() => setPasteOpenId(null)}
            onReload={() => onResearched?.()}
            onDone={(notice) => {
              pendingPasteNotices.set(oppId, notice);
              setPasteNotice(notice);
              setPasteOpenId(null);
              onResearched?.();
            }}
          />
        ) : null}
        {isGapLine(item) && item.note && memoOpenId !== item.itemId ? (
          <div data-testid="review-memo" style={{ marginLeft: 28 }}>
            <span>
              {reviewArea.memoPrefix} {linkifyMemo(item.note.text)}
            </span>
            {personName(item.note.by) && formatMonthDay(item.note.at) ? (
              <span data-testid="review-memo-by" style={secondary}>
                {' — '}
                {reviewArea.repliedBy(personName(item.note.by), formatMonthDay(item.note.at) ?? '')}
              </span>
            ) : null}
          </div>
        ) : null}
        {isGapLine(item) && memoOpenId === item.itemId && staffKey ? (
          <GapMemoEditor
            oppId={oppId}
            itemId={item.itemId}
            evalId={evalId}
            staffKey={staffKey}
            initialText={item.note?.text ?? ''}
            onCancel={() => setMemoOpenId(null)}
            onSaved={(note) => {
              setItems((prev) =>
                prev.map((entry) => (entry.itemId === item.itemId ? { ...entry, note } : entry)),
              );
              setMemoOpenId(null);
              onMemoSaved?.();
            }}
          />
        ) : null}
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
              <div role="alert" data-testid="review-reply-error" style={{ color: colors.error }}>
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
  }

  return (
    <div data-testid="review-area" style={{ display: 'grid', gap: 8 }}>
      {proposalsOnly || (folded && askItems.length === 0) ? null : (
        <span data-testid="review-progress" style={{ fontWeight: 600 }}>
          {folded
            ? reviewArea.askProgress(
                askItems.filter((item) => item.checked).length,
                askItems.length,
              )
            : reviewArea.progress(done, items.length)}
        </span>
      )}
      {proposalsOnly ? null : <span style={secondary}>{reviewArea.hint}</span>}
      {!canRecord ? (
        <Typography.Text type="secondary" data-testid="review-pick-staff-text">
          {reviewArea.pickStaffFirst}
        </Typography.Text>
      ) : null}
      {pasteNotice ? (
        <span role="status" style={secondary} data-testid="review-paste-notice">
          {pasteNotice}
        </span>
      ) : null}
      {askItems.length === 0 ? (
        <p data-testid={folded ? 'review-ask-empty' : 'review-empty'} style={{ margin: 0 }}>
          {folded ? reviewArea.askEmpty : reviewArea.empty}
        </p>
      ) : (
        <ul
          aria-label={reviewArea.listLabel}
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}
        >
          {askItems.map(renderItem)}
        </ul>
      )}
      {folded
        ? FOLD_GROUPS.map((group) => {
            const rows = inGroup(group);
            if (rows.length === 0) return null;
            const open = openGroups[group];
            const names =
              group === 'process'
                ? rows.map(processNameOf).filter((name): name is string => name !== null)
                : [];
            const recorded = rows.filter(hasRecord).length;
            const listId = `review-fold-${oppId}-${group}`;
            return (
              <div
                key={group}
                data-testid={`review-fold-${group}`}
                style={{ display: 'grid', gap: 8 }}
              >
                <div>
                  <Button
                    size="small"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }))}
                    data-testid={`review-fold-toggle-${group}`}
                  >
                    {reviewArea.foldHead(
                      group,
                      rows.length,
                      open,
                      names.slice(0, REVIEW_FOLD_NAME_LIMIT),
                      Math.max(0, names.length - REVIEW_FOLD_NAME_LIMIT),
                      recorded,
                    )}
                  </Button>
                </div>
                {open ? (
                  <ul
                    id={listId}
                    aria-label={reviewArea.foldListLabel(group)}
                    style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}
                  >
                    {rows.map(renderItem)}
                  </ul>
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
