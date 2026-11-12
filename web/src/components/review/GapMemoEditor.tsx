// 검토사항 자료 줄의 [메모 적기] 입력(#260, 2026-11-12): 줄 아래에 인라인으로 열리는 한 칸(모달 없음, 500자).
// 저장은 영업 메모 요청 `POST /notes`에 종류 RESEARCH와 줄 번호(itemId)를 같이 보낸다. 기록용이라 점수는 바뀌지 않고,
// 메모는 영업 메모와 같은 내부 전용이다(밖으로 나가지 않음). 저장하면 줄 아래에 최신 메모 하나가 보이고 이전 것은 활동 이력에 남는다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'antd';
import { ApiError, postNote } from '../../api/client';
import type { ReviewItemNote } from '../../api/types';
import { errorTexts, reviewArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface GapMemoEditorProps {
  oppId: string;
  /** 자료 줄 번호(예 GAP:REQ:req-3). 요청의 itemId로 간다. */
  itemId: string;
  /** 본 평가 번호. 있으면 요청에 함께 보낸다(선택). */
  evalId: string | null;
  staffKey: string;
  /** 고치기라면 지금 메모 글을 미리 채운다. */
  initialText: string;
  onCancel: () => void;
  /** 저장이 끝났을 때 새 메모를 넘긴다(줄이 이 값으로 바뀌고, 활동 이력을 새로 불러오게). */
  onSaved: (note: ReviewItemNote) => void;
}

export default function GapMemoEditor({
  oppId,
  itemId,
  evalId,
  staffKey,
  initialText,
  onCancel,
  onSaved,
}: GapMemoEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  async function save() {
    const text = draft.trim();
    if (text === '') return;
    setBusy(true);
    setError(null);
    try {
      const body = evalId
        ? { text, kind: 'RESEARCH' as const, itemId, evalId }
        : { text, kind: 'RESEARCH' as const, itemId };
      const envelope = await postNote(oppId, body, staffKey);
      const saved = envelope.data;
      onSaved({ text, by: saved.updatedBy, at: saved.updatedAt });
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${reviewArea.memoSaveFailed} (${detail})`);
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="review-memo-editor"
      style={{ marginLeft: 28, display: 'grid', gap: 6, maxWidth: 560 }}
    >
      <textarea
        value={draft}
        maxLength={reviewArea.memoMaxLength}
        rows={3}
        placeholder={reviewArea.memoPlaceholder}
        aria-label={reviewArea.memoInputLabel}
        onChange={(event) => setDraft(event.target.value)}
        disabled={busy}
        data-testid="review-memo-input"
        style={{ width: '100%', font: 'inherit', padding: 6 }}
      />
      <span style={secondary}>{reviewArea.memoHint}</span>
      <span data-testid="review-memo-counter" style={secondary}>
        {reviewArea.memoCounter(draft.length, reviewArea.memoMaxLength)}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          type="primary"
          size="small"
          loading={busy}
          disabled={draft.trim() === ''}
          onClick={() => void save()}
          data-testid="review-memo-save"
        >
          {reviewArea.memoSave}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel} data-testid="review-memo-cancel">
          {reviewArea.memoCancel}
        </Button>
      </div>
      {error ? (
        <div role="alert" data-testid="review-memo-error" style={{ color: colors.error }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** 메모 안의 http(s) 주소를 눌러 새 창으로 열 수 있게 나눈다. 다른 글자는 그대로 둔다. */
export function linkifyMemo(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    // 주소 끝에 붙은 문장부호는 주소가 아니다.
    const url = match[0].replace(/[.,;:!?)\]}、。]+$/u, '');
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a key={`${match.index}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = match.index + url.length;
    pattern.lastIndex = last;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
