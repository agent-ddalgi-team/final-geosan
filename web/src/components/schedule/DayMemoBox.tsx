// 달력 날짜 메모 칸(#984, PM이 고른 시안 2026-11-28). 달력에서 날짜를 누르면 뜨는 작은 창의 일정 아래에 그린다.
//   메모 목록(글 · 쓴 사람 · 적은 시각, 내가 쓴 메모에만 [지우기]) → 입력 칸(200자) + [저장] → 작은 안내 글.
// 팀이 함께 보는 메모장이다: 읽기는 누구나, 남기기는 기록 담당자만, 지우기는 쓴 사람만(서버가 한 번 더 막는다).
// 보기 전용 · 담당자를 고르기 전에는 입력 칸이 눌리지 않고 "먼저 담당자를 고르세요"가 보인다.
// 저장 · 지우기에 실패하면 그 자리에 이유를 알리고 적던 글은 그대로 둔다(성공처럼 넘기지 않는다).
// 성공하면 창(window)에 DAY_MEMO_CHANGED_EVENT를 알려 달력 테두리 · 영업 홈 "오늘 할 일"의 메모 줄이 바로 따라온다.
// 메모 목록은 이 부품이 읽지 않고 받는다(달력이 보이는 달을 한 번에 읽어 날짜별로 나눠 준다).
// AI 호출은 없다(비용 없음). 메모는 AI · 엑셀로 내보내지 않는다.
import { useId, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { ApiError } from '../../api/client';
import {
  DAY_MEMO_MAX_LENGTH,
  announceDayMemoChange,
  deleteDayMemo,
  postDayMemo,
} from '../../api/dayMemos';
import type { DayMemo } from '../../api/dayMemos';
import { dashboardTexts, dayMemo as t } from '../../labels/ko';
import { accent, colors, radius, typography, warn } from '../../theme/tokens';
import { formatMonthDayTime } from '../../utils/time';
import { popoverDayTitle } from '../dashboard/DashboardCalendar';
import { useFrame } from '../frame/FrameContext';

export interface DayMemoBoxProps {
  /** 메모를 붙일 날짜(YYYY-MM-DD). */
  day: string;
  /** 그날 메모(쓴 순서). */
  memos: DayMemo[];
  /** 메모 읽기 상태. loading = 읽는 중, error = 못 읽음, ready = 읽음. */
  state: 'loading' | 'error' | 'ready';
  /** ready인데 마지막 읽기는 실패했다(보이는 메모는 앞서 읽은 값). */
  stale?: boolean;
  /** [다시 읽기]. */
  onReload: () => void;
}

/** 메모 목록의 최대 높이(화면 모양값, 규칙 숫자 아님). 넘으면 목록 안에서 스크롤한다. */
const MEMO_LIST_MAX_HEIGHT = 180;

const small: CSSProperties = {
  fontSize: typography.fontSizeSecondary - 2,
  color: colors.textDimmed,
  lineHeight: 1.5,
};
const linkButton: CSSProperties = {
  border: 0,
  padding: 0,
  background: 'transparent',
  color: accent.text,
  font: 'inherit',
  textDecoration: 'underline',
  cursor: 'pointer',
};

/** 서버가 준 이유(안내 문장 + 다음 할 일)를 그대로 보인다. 서버 응답이 아니면 기본 문장. */
function failText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return [error.body.message, error.body.nextAction].filter(Boolean).join(' ');
  }
  return fallback;
}

export default function DayMemoBox({
  day,
  memos,
  state,
  stale = false,
  onReload,
}: DayMemoBoxProps) {
  const { staffKey, canRecord } = useFrame();
  const id = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const usable = canRecord && staffKey !== null;
  const trimmed = text.trim();
  const canSave = usable && !saving && trimmed !== '';

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave || staffKey === null) return;
    setSaving(true);
    setSaveError('');
    try {
      const envelope = await postDayMemo(day, trimmed, staffKey);
      setText('');
      announceDayMemoChange({ type: 'added', memo: envelope.data });
    } catch (error) {
      setSaveError(failText(error, t.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function remove(memo: DayMemo) {
    if (!usable || staffKey === null || removing !== null) return;
    setRemoving(memo.memoId);
    setRemoveError('');
    try {
      await deleteDayMemo(memo.memoId, staffKey);
      announceDayMemoChange({ type: 'deleted', memoId: memo.memoId });
    } catch (error) {
      setRemoveError(failText(error, t.removeFailed));
      // 이미 없는 메모(404)면 보이는 목록이 옛 값이다. 다른 곳(오늘 할 일의 메모 줄)에서도 그 메모를 빼게 알리고,
      // 이 달력의 목록은 서버 값으로 다시 맞춘다.
      if (error instanceof ApiError && error.status === 404) {
        announceDayMemoChange({ type: 'deleted', memoId: memo.memoId });
        onReload();
      }
    } finally {
      setRemoving(null);
    }
  }

  const retry = (
    <>
      {' '}
      <button type="button" onClick={onReload} data-testid="day-memo-retry" style={linkButton}>
        {t.retry}
      </button>
    </>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="day-memo-box"
      data-state={state}
      style={{ display: 'grid', gap: 6, minWidth: 0 }}
    >
      <div
        id={`${id}-title`}
        style={{ fontSize: typography.fontSizeSecondary - 1, color: colors.textDimmed }}
      >
        {t.title}
      </div>
      {state === 'loading' ? (
        <p aria-busy="true" data-testid="day-memo-loading" style={{ margin: 0, ...small }}>
          {t.loading}
        </p>
      ) : null}
      {state === 'error' ? (
        // 달력 · 일정은 그대로 쓴다. 메모만 못 읽었다고 알린다(빈 목록을 정상처럼 보이지 않는다).
        <p role="alert" data-testid="day-memo-load-error" style={{ margin: 0, ...small }}>
          {t.loadError}
          {retry}
        </p>
      ) : null}
      {state === 'ready' && memos.length === 0 ? (
        <p data-testid="day-memo-empty" style={{ margin: 0, ...small }}>
          {t.empty}
        </p>
      ) : null}
      {state === 'ready' && memos.length > 0 ? (
        <ul
          aria-label={t.listLabel(popoverDayTitle(day))}
          data-testid="day-memo-list"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 6,
            // 메모가 많은 날에도 작은 창이 화면 밖으로 길어지지 않게 목록만 스크롤한다.
            maxHeight: MEMO_LIST_MAX_HEIGHT,
            overflowY: 'auto',
          }}
        >
          {memos.map((memo) => {
            const mine = usable && memo.staffKey === staffKey;
            return (
              <li
                key={memo.memoId}
                data-testid="day-memo-item"
                style={{
                  background: colors.bgLayout,
                  borderRadius: radius.control,
                  padding: '8px 12px',
                  color: colors.text,
                  overflowWrap: 'anywhere',
                }}
              >
                <span
                  data-testid="day-memo-text"
                  style={{ display: 'block', whiteSpace: 'pre-wrap' }}
                >
                  {memo.text}
                </span>
                <span
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0 8px',
                    marginTop: 2,
                    ...small,
                  }}
                >
                  <span data-testid="day-memo-byline">
                    {t.byline(memo.staffName ?? memo.staffKey, formatMonthDayTime(memo.createdAt))}
                  </span>
                  {mine ? (
                    <button
                      type="button"
                      aria-label={t.removeLabel(memo.text)}
                      disabled={removing !== null}
                      aria-busy={removing === memo.memoId}
                      onClick={() => void remove(memo)}
                      data-testid="day-memo-remove"
                      style={{
                        ...linkButton,
                        cursor: removing !== null ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {t.remove}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {state === 'ready' && stale ? (
        <p role="alert" data-testid="day-memo-stale" style={{ margin: 0, ...small }}>
          {t.stale}
          {retry}
        </p>
      ) : null}
      {removeError ? (
        <p
          role="alert"
          data-testid="day-memo-remove-error"
          style={{ margin: 0, ...small, color: colors.error }}
        >
          {removeError}
        </p>
      ) : null}
      <form
        onSubmit={(event) => void save(event)}
        style={{ display: 'flex', gap: 6, marginTop: 2 }}
      >
        <input
          type="text"
          aria-label={t.inputLabel}
          placeholder={t.placeholder(DAY_MEMO_MAX_LENGTH)}
          maxLength={DAY_MEMO_MAX_LENGTH}
          value={text}
          disabled={!usable || saving}
          onChange={(event) => setText(event.target.value)}
          data-testid="day-memo-input"
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: 'border-box',
            padding: '7px 10px',
            border: `1px solid ${colors.border}`,
            borderRadius: radius.control,
            background: colors.bgContainer,
            color: colors.text,
            font: 'inherit',
            fontSize: typography.fontSizeSecondary,
          }}
        />
        <button
          type="submit"
          disabled={!canSave}
          aria-busy={saving}
          data-testid="day-memo-save"
          style={{
            padding: '7px 14px',
            border: 0,
            borderRadius: radius.control,
            background: accent.bg,
            color: accent.onBg,
            font: 'inherit',
            fontSize: typography.fontSizeSecondary,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.55,
          }}
        >
          {t.save}
        </button>
      </form>
      {!usable ? (
        <p
          data-testid="day-memo-pick-staff"
          style={{
            margin: 0,
            ...small,
            fontSize: typography.fontSizeSecondary - 1,
            color: warn.text,
          }}
        >
          {dashboardTexts.tablePickStaffFirst}
        </p>
      ) : null}
      {saveError ? (
        <p
          role="alert"
          data-testid="day-memo-save-error"
          style={{ margin: 0, ...small, color: colors.error }}
        >
          {saveError}
        </p>
      ) : null}
      <p data-testid="day-memo-hint" style={{ margin: 0, ...small }}>
        {t.hint}
      </p>
    </section>
  );
}
