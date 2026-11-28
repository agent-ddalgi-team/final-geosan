// 바로 일정 잡기 칸(#983, PM이 고른 시안 2026-11-28). 영업 홈 "진행 중인 회사" 표의 다음 일정 칸에서 펴지고,
// 기업 상세에서도 같은 부품을 쓸 수 있게 영업 홈에 묶지 않았다(회사 번호와 지금 일정만 받는다).
//   날짜(오늘 이후) · 종류(고르면 내용이 그 이름으로 채워지고 고쳐 쓸 수 있다) · 내용 한 줄 · [저장] [취소]
//   아래 작은 안내 "지금 일정: 11/18 방문 (지남) → 저장하면 이 일정으로 바뀌고 달력에도 바로 보입니다"
// 저장은 기업 상세의 [일정 잡기](RecordsArea onSaveSchedule)와 같다: POST /opportunities/{oppId}/outcomes 에
//   지금 단계 그대로(기록이 없으면 NOT_EXECUTED) + nextScheduleAt + nextScheduleNote (+ 거절 상태면 이유 코드 이어받기).
// 이 부품은 지금 단계를 모르므로 저장 직전에 그 회사 상세를 한 번 읽어 단계 · 평가 번호 · 거절 이유를 얻는다.
// 상세를 못 읽으면 저장 요청을 보내지 않고 알린다. 저장이 실패하면 입력을 그대로 두고 알린다(성공처럼 넘기지 않는다).
// 저장되면 창(window)에 SCHEDULE_CHANGED_EVENT를 알려 영업 홈 · 왼쪽 달력 · 메뉴 숫자가 다시 읽게 한다.
// AI 호출은 없다(비용 없음).
import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { ApiError, getOpportunityDetail, postOutcome } from '../../api/client';
import { SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import type { OutcomeRequest, OutcomeResponse, SalesQuestions } from '../../api/types';
import { errorTexts, scheduleQuickEdit as t } from '../../labels/ko';
import { accent, colors, homePalette, radius, typography, warn } from '../../theme/tokens';
import { formatMonthDay, todayKst } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';
import { loadScheduleQuestions, scheduleKindsOf } from './scheduleKinds';

/** 내용 한 줄 글자 수 상한(설정 records.noteMaxLength가 없을 때. 기업 상세의 일정 칸과 같은 값). */
export const SCHEDULE_NOTE_FALLBACK_MAX = 200;

export interface ScheduleQuickEditProps {
  oppId: string;
  /** 지금 잡혀 있는 다음 일정 날짜(YYYY-MM-DD). 없으면 null. */
  currentScheduleAt?: string | null;
  /** 지금 일정의 할 일 한 줄. */
  currentScheduleNote?: string | null;
  /** 저장이 끝나면 서버가 돌려준 새 기록과 함께 부른다. */
  onSaved?: (saved: OutcomeResponse) => void;
  onCancel?: () => void;
  /** 그 사이 다른 기록이 저장돼 서버가 막았을 때(409) [다시 읽기]를 누르면 부른다. 없으면 단추를 그리지 않는다. */
  onReload?: () => void;
  /** 오늘(YYYY-MM-DD, 한국). 안 주면 지금 시각으로 센다. */
  today?: string;
}

const fieldLabel: CSSProperties = {
  display: 'grid',
  gap: 3,
  fontSize: typography.fontSizeSecondary - 1,
  color: colors.textDimmed,
};
const control: CSSProperties = {
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.controlSm,
  background: colors.bgContainer,
  color: colors.text,
  font: 'inherit',
  fontSize: typography.fontSizeSecondary,
};
const button: CSSProperties = {
  padding: '6px 12px',
  borderRadius: radius.controlSm,
  font: 'inherit',
  fontSize: typography.fontSizeSecondary,
  whiteSpace: 'nowrap',
};

function reasonOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.body.message : errorTexts.network;
}

export default function ScheduleQuickEdit({
  oppId,
  currentScheduleAt = null,
  currentScheduleNote = null,
  onSaved,
  onCancel,
  onReload,
  today: todayProp,
}: ScheduleQuickEditProps) {
  const { config, staffKey, canRecord } = useFrame();
  const today = todayProp ?? todayKst();
  const id = useId();
  // 지금 일정이 오늘이나 그 뒤면 그 날짜로 시작하고, 지났거나 없으면 비워 둔다(지난 날짜는 저장할 수 없다).
  const [date, setDate] = useState(
    currentScheduleAt && currentScheduleAt >= today ? currentScheduleAt : '',
  );
  const [note, setNote] = useState(currentScheduleNote ?? '');
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    loadScheduleQuestions()
      .then((loaded) => {
        if (alive) setQuestions(loaded);
      })
      .catch(() => {
        // 질문 파일을 못 읽으면 대면·전화·메일 세 가지만 보인다(기업 상세의 일정 칸과 같다). 내용은 직접 적을 수 있다.
      });
    return () => {
      alive = false;
    };
  }, []);

  const kinds = scheduleKindsOf(questions);
  const usable = canRecord && staffKey !== null;
  const disabled = !usable || busy;
  const datePast = date !== '' && date < today;
  const noteMax = config?.records?.noteMaxLength ?? SCHEDULE_NOTE_FALLBACK_MAX;

  async function save() {
    if (!usable || staffKey === null || busy || date === '' || datePast) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // ① 지금 단계 · 평가 번호 · 거절 이유를 그 회사 상세에서 읽는다(표의 줄에는 이 값이 없다).
      let detail;
      try {
        detail = (await getOpportunityDetail(oppId)).data;
      } catch (caught) {
        setError({ text: `${t.loadFailed} (${reasonOf(caught)})`, stale: false });
        return;
      }
      const outcome = detail.records.outcome ?? null;
      const status = outcome?.status ?? 'NOT_EXECUTED';
      const text = note.trim();
      const body: OutcomeRequest = {
        ...(detail.evalId ? { evalId: detail.evalId } : {}),
        status,
        nextScheduleAt: date,
        ...(text ? { nextScheduleNote: text } : {}),
        // 이미 거절인 채로 일정만 저장해도 서버가 거절 이유를 요구하므로 지금 이유 코드를 같이 보낸다.
        ...(status === 'LOST' && outcome?.lostReasonCode
          ? { lostReasonCode: outcome.lostReasonCode }
          : {}),
      };
      // ② 저장은 한 번만 보낸다(다시 시도하지 않는다).
      try {
        const envelope = await postOutcome(oppId, body, staffKey);
        setSaved(true);
        window.dispatchEvent(new CustomEvent(SCHEDULE_CHANGED_EVENT, { detail: oppId }));
        onSaved?.(envelope.data);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          // 그 사이 다른 기록이 저장됐다: 서버 안내를 그대로 보이고 다시 읽게 한다.
          setError({ text: `${caught.body.message} ${caught.body.nextAction}`, stale: true });
        } else {
          setError({ text: `${t.saveFailed} (${reasonOf(caught)})`, stale: false });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const currentDay = currentScheduleAt
    ? (formatMonthDay(currentScheduleAt) ?? currentScheduleAt)
    : null;

  return (
    <div
      role="group"
      aria-label={t.groupLabel}
      data-testid="schedule-quick-edit"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'flex-end',
        boxSizing: 'border-box',
        padding: '10px 12px',
        border: `1px solid ${accent.border}`,
        borderRadius: radius.control,
        background: colors.bgContainer,
        boxShadow: homePalette.popoverShadow,
        color: colors.text,
        fontWeight: 400,
      }}
    >
      <label htmlFor={`${id}-date`} style={fieldLabel}>
        {t.dateLabel}
        <input
          id={`${id}-date`}
          type="date"
          value={date}
          min={today}
          disabled={disabled}
          aria-invalid={datePast}
          onChange={(event) => setDate(event.target.value)}
          data-testid="schedule-quick-date"
          style={control}
        />
      </label>
      <label htmlFor={`${id}-kind`} style={fieldLabel}>
        {t.kindLabel}
        <select
          id={`${id}-kind`}
          // 내용이 종류 이름 그대로면 그 종류가 골라져 보이고, 고쳐 쓰면 "종류 고르기"로 돌아간다.
          value={kinds.includes(note) ? note : ''}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== '') setNote(event.target.value);
          }}
          data-testid="schedule-quick-kind"
          style={control}
        >
          <option value="">{t.kindPlaceholder}</option>
          {kinds.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-note`} style={{ ...fieldLabel, flex: '1 1 100%' }}>
        {t.noteLabel}
        <input
          id={`${id}-note`}
          type="text"
          value={note}
          maxLength={noteMax}
          placeholder={t.notePlaceholder}
          disabled={disabled}
          onChange={(event) => setNote(event.target.value)}
          data-testid="schedule-quick-note"
          style={{ ...control, width: '100%' }}
        />
      </label>
      <span style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={disabled || date === '' || datePast}
          aria-busy={busy}
          onClick={() => void save()}
          data-testid="schedule-quick-save"
          style={{
            ...button,
            border: 0,
            background: accent.bg,
            color: accent.onBg,
            cursor: disabled || date === '' || datePast ? 'not-allowed' : 'pointer',
            opacity: disabled || date === '' || datePast ? 0.55 : 1,
          }}
        >
          {t.save}
        </button>
        {onCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            data-testid="schedule-quick-cancel"
            style={{
              ...button,
              border: `1px solid ${colors.borderSecondary}`,
              background: colors.bgContainer,
              color: colors.text,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {t.cancel}
          </button>
        ) : null}
      </span>
      {!usable ? (
        <span
          data-testid="schedule-quick-pick-staff"
          style={{
            flexBasis: '100%',
            fontSize: typography.fontSizeSecondary - 1,
            color: warn.text,
          }}
        >
          {t.pickStaffFirst}
        </span>
      ) : null}
      {datePast ? (
        <span
          role="alert"
          data-testid="schedule-quick-date-error"
          style={{
            flexBasis: '100%',
            fontSize: typography.fontSizeSecondary - 1,
            color: colors.error,
          }}
        >
          {t.datePast}
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          data-testid="schedule-quick-error"
          style={{
            flexBasis: '100%',
            fontSize: typography.fontSizeSecondary - 1,
            color: colors.error,
          }}
        >
          {error.text}
          {error.stale && onReload ? (
            <>
              {' '}
              <button
                type="button"
                onClick={onReload}
                data-testid="schedule-quick-reload"
                style={{
                  border: 0,
                  padding: 0,
                  background: 'transparent',
                  color: accent.text,
                  font: 'inherit',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                }}
              >
                {t.reload}
              </button>
            </>
          ) : null}
        </span>
      ) : null}
      {saved ? (
        <span
          aria-live="polite"
          data-testid="schedule-quick-saved"
          style={{ flexBasis: '100%', fontSize: typography.fontSizeSecondary - 1 }}
        >
          {t.saved}
        </span>
      ) : null}
      <span
        data-testid="schedule-quick-current"
        style={{
          flexBasis: '100%',
          fontSize: typography.fontSizeSecondary - 2,
          color: colors.textDimmed,
        }}
      >
        {currentDay
          ? t.currentLine(currentDay, currentScheduleNote ?? '', (currentScheduleAt ?? '') < today)
          : t.noCurrentLine}{' '}
        {t.kindHint}
      </span>
    </div>
  );
}
