// 기록 영역(U5, 상세 하단): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정 네 칸. 모달·서랍 없이 인라인.
// 메모는 덧붙이기만 되고, 단계·일정은 저장할 때마다 새 행이 쌓인다(서버 규칙 Q5). 수정·삭제 단추는 두지 않는다.
// 상대 회사 담당자 연락처를 메모에 적어도 막지 않는다(PM 결정 2026-11-03: 내부 메모장). 글자 수 초과 등
// 서버가 돌려주는 쉬운 말은 그대로 보인다.
import { useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { ApiError, postNote, postOutcome } from '../../api/client';
import type {
  ContactCount,
  ContactMethod,
  ContactResult,
  LostReasonCode,
  NoteKind,
  OutcomeRecord,
  OutcomeRequest,
  OutcomeStatus,
} from '../../api/types';
import {
  contactMethodLabels,
  contactResultLabels,
  errorTexts,
  lostReasonLabels,
  noteKindLabels,
  outcomeStatusLabels,
  recordsArea,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatHourMinute } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

export const DEFAULT_NOTE_MAX_LENGTH = 200;

export interface RecordsAreaProps {
  oppId: string;
  /** 본 평가 ID. 없으면 보내지 않는다. */
  evalId?: string | null;
  /** 서버가 가진 현재 영업 단계·일정(없으면 null). 처음 보일 때만 쓴다. */
  outcome?: OutcomeRecord | null;
  contactCount?: ContactCount | null;
  /** 단계가 바뀌면 알린다(카드 꼬리표 갱신용). */
  onOutcomeSaved?: (outcome: OutcomeRecord) => void;
  /** 접촉·메모·단계·일정 중 무엇이든 저장이 끝나면 알린다(타임라인 새로 불러오기용). */
  onRecorded?: () => void;
}

type BlockKey = 'contact' | 'note' | 'stage' | 'schedule';

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function options(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

const EMPTY_COUNT: ContactCount = { total: 0, call: 0, email: 0, visit: 0 };

interface NativeSelectProps {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  /** 안내 글자("방법 고르세요"). 있으면 맨 위에 빈 값 선택지로 보인다. */
  placeholder?: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  testId: string;
}

/** 브라우저 기본 선택 상자. antd Select보다 가볍고 키보드·낭독기에서 그대로 동작한다. */
function NativeSelect({
  label,
  value,
  options: items,
  placeholder,
  onChange,
  disabled,
  testId,
}: NativeSelectProps) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      data-testid={testId}
      style={{
        minHeight: 40,
        minWidth: 120,
        padding: '0 12px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.bgContainer,
        color: colors.text,
        font: 'inherit',
      }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

export default function RecordsArea({
  oppId,
  evalId,
  outcome: initialOutcome,
  contactCount,
  onOutcomeSaved,
  onRecorded,
}: RecordsAreaProps) {
  const { config, staffKey, canRecord } = useFrame();
  const noteMax = config?.records?.noteMaxLength ?? DEFAULT_NOTE_MAX_LENGTH;

  const [outcome, setOutcome] = useState<OutcomeRecord | null>(initialOutcome ?? null);
  const [count, setCount] = useState<ContactCount>(contactCount ?? EMPTY_COUNT);
  const [busy, setBusy] = useState<BlockKey | null>(null);
  const [message, setMessage] = useState<{ block: BlockKey; text: string; error: boolean } | null>(
    null,
  );

  const [method, setMethod] = useState<ContactMethod | null>(null);
  const [result, setResult] = useState<ContactResult | null>(null);
  const [attemptedAt, setAttemptedAt] = useState(today());

  const [noteKind, setNoteKind] = useState<NoteKind>('MEMO');
  const [noteText, setNoteText] = useState('');

  const [stage, setStage] = useState<OutcomeStatus | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostCode, setLostCode] = useState<LostReasonCode | null>(null);
  // 방금 저장한 거절 사유 글. 거절 상태에서 일정·접촉만 저장할 때 같은 이유를 다시 실어 보내는 데 쓴다.
  const [savedLostReason, setSavedLostReason] = useState('');

  const [scheduleAt, setScheduleAt] = useState(initialOutcome?.nextScheduleAt ?? '');
  const [scheduleNote, setScheduleNote] = useState(initialOutcome?.nextScheduleNote ?? '');

  const currentStatus = outcome?.status ?? null;
  const disabled = !canRecord || busy !== null;

  function fail(block: BlockKey, caught: unknown) {
    const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
    setMessage({ block, text: `${recordsArea.saveFailed} (${detail})`, error: true });
  }

  function succeed(block: BlockKey, updatedAt: string) {
    const time = formatHourMinute(updatedAt) ?? formatHourMinute(new Date());
    setMessage({ block, text: `${recordsArea.savedPrefix} ${time}`, error: false });
  }

  /** 단계·일정은 새 행이라, 바꾸지 않는 값(현재 일정)을 같이 실어 보내 이전 값이 사라져 보이지 않게 한다. */
  async function saveOutcome(block: BlockKey, body: OutcomeRequest) {
    if (!staffKey) return false;
    setBusy(block);
    setMessage(null);
    try {
      const envelope = await postOutcome(
        oppId,
        { ...(evalId ? { evalId } : {}), ...body },
        staffKey,
      );
      const saved: OutcomeRecord = {
        version: envelope.data.version,
        updatedBy: envelope.data.updatedBy,
        updatedAt: envelope.data.updatedAt,
        status: envelope.data.status ?? body.status,
        lostReasonCode:
          (envelope.data.status ?? body.status) === 'LOST'
            ? (envelope.data.lostReasonCode ?? body.lostReasonCode ?? null)
            : null,
        nextScheduleAt: envelope.data.nextScheduleAt ?? body.nextScheduleAt ?? null,
        nextScheduleNote: envelope.data.nextScheduleNote ?? body.nextScheduleNote ?? null,
      };
      setOutcome(saved);
      onOutcomeSaved?.(saved);
      onRecorded?.();
      succeed(block, saved.updatedAt);
      return true;
    } catch (caught) {
      fail(block, caught);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function keepSchedule(): Pick<OutcomeRequest, 'nextScheduleAt' | 'nextScheduleNote'> {
    return {
      ...(outcome?.nextScheduleAt ? { nextScheduleAt: outcome.nextScheduleAt } : {}),
      ...(outcome?.nextScheduleNote ? { nextScheduleNote: outcome.nextScheduleNote } : {}),
    };
  }

  /** 이미 거절인 채로 일정·접촉만 저장해도 서버가 거절 이유를 요구하므로 현재 이유를 같이 보낸다. */
  function keepLostReason(): Pick<OutcomeRequest, 'lostReasonCode' | 'reason'> {
    if (currentStatus !== 'LOST' || !outcome?.lostReasonCode) return {};
    return {
      lostReasonCode: outcome.lostReasonCode,
      ...(savedLostReason ? { reason: savedLostReason } : {}),
    };
  }

  async function onSaveContact() {
    if (!method || !result) return;
    // 접촉했으니 아직 미접촉·관심이면 "접촉"으로 넘어가고, 그 뒤 단계는 그대로 둔다.
    const status: OutcomeStatus =
      currentStatus && currentStatus !== 'NOT_EXECUTED' && currentStatus !== 'INTERESTED'
        ? currentStatus
        : 'IN_PROGRESS';
    const ok = await saveOutcome('contact', {
      status,
      method,
      result,
      attemptedAt,
      ...keepSchedule(),
      ...(status === 'LOST' ? keepLostReason() : {}),
    });
    if (ok) {
      setCount((prev) => ({
        total: prev.total + 1,
        call: prev.call + (method === 'CALL' ? 1 : 0),
        email: prev.email + (method === 'EMAIL' ? 1 : 0),
        visit: prev.visit + (method === 'VISIT' ? 1 : 0),
      }));
      setMethod(null);
      setResult(null);
    }
  }

  async function onSaveNote() {
    const text = noteText.trim();
    if (!staffKey || text === '') return;
    setBusy('note');
    setMessage(null);
    try {
      const envelope = await postNote(
        oppId,
        { text, kind: noteKind, ...(evalId ? { evalId } : {}) },
        staffKey,
      );
      setNoteText('');
      onRecorded?.();
      succeed('note', envelope.data.updatedAt);
    } catch (caught) {
      // 입력한 글은 그대로 둔다.
      fail('note', caught);
    } finally {
      setBusy(null);
    }
  }

  async function onSaveStage() {
    if (!stage) return;
    const reason = lostReason.trim();
    // 거절은 이유 코드가 필수이고, 기타일 때만 자유 글이 필수다.
    if (stage === 'LOST' && (!lostCode || (lostCode === 'OTHER' && reason === ''))) return;
    const ok = await saveOutcome('stage', {
      status: stage,
      ...(stage === 'LOST' && lostCode ? { lostReasonCode: lostCode } : {}),
      ...(stage === 'LOST' && reason !== '' ? { reason } : {}),
      ...keepSchedule(),
    });
    if (ok) {
      setSavedLostReason(stage === 'LOST' ? reason : '');
      setStage(null);
      setLostReason('');
      setLostCode(null);
    }
  }

  const lostReasonMissing = stage === 'LOST' && lostReason.trim() === '' && lostCode === 'OTHER';
  const stageSaveBlocked = stage === 'LOST' && (!lostCode || lostReasonMissing);

  async function onSaveSchedule() {
    if (scheduleAt === '') return;
    const note = scheduleNote.trim();
    await saveOutcome('schedule', {
      status: currentStatus ?? 'NOT_EXECUTED',
      nextScheduleAt: scheduleAt,
      ...(note ? { nextScheduleNote: note } : {}),
      ...keepLostReason(),
    });
  }

  function blockMessage(block: BlockKey) {
    if (!message || message.block !== block) return null;
    return message.error ? (
      <span role="alert" data-testid={`records-${block}-error`} style={{ color: colors.error }}>
        {message.text}
      </span>
    ) : (
      <span aria-live="polite" data-testid={`records-${block}-saved`}>
        {message.text}
      </span>
    );
  }

  const blockStyle = { display: 'grid', gap: 8, maxWidth: 560 } as const;
  const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' } as const;
  const hintStyle = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  return (
    <div data-testid="records-area" style={{ display: 'grid', gap: 24 }}>
      {!canRecord ? (
        <Typography.Text type="secondary" data-testid="records-pick-staff-text">
          {recordsArea.pickStaffFirst}
        </Typography.Text>
      ) : null}

      <section aria-labelledby={`records-contact-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-contact-${oppId}`} style={{ margin: 0 }}>
          {recordsArea.contactTitle}
        </Typography.Title>
        <span data-testid="records-contact-count" style={hintStyle}>
          {recordsArea.contactCount(count.total, count.call, count.email, count.visit)}
        </span>
        <div style={rowStyle}>
          <NativeSelect
            label={recordsArea.contactMethod}
            placeholder={`${recordsArea.contactMethod} ${recordsArea.selectPlaceholder}`}
            value={method}
            options={options(contactMethodLabels)}
            onChange={(value) => setMethod(value as ContactMethod | null)}
            disabled={disabled}
            testId="records-contact-method"
          />
          <NativeSelect
            label={recordsArea.contactResult}
            placeholder={`${recordsArea.contactResult} ${recordsArea.selectPlaceholder}`}
            value={result}
            options={options(contactResultLabels)}
            onChange={(value) => setResult(value as ContactResult | null)}
            disabled={disabled}
            testId="records-contact-result"
          />
          <Input
            type="date"
            aria-label={recordsArea.contactDate}
            style={{ width: 160 }}
            value={attemptedAt}
            onChange={(event) => setAttemptedAt(event.target.value)}
            disabled={disabled}
            data-testid="records-contact-date"
          />
          <Button
            type="primary"
            disabled={disabled || !method || !result || attemptedAt === ''}
            loading={busy === 'contact'}
            onClick={() => void onSaveContact()}
            data-testid="records-contact-save-button"
          >
            {recordsArea.contactSave}
          </Button>
        </div>
        {blockMessage('contact')}
      </section>

      <section aria-labelledby={`records-note-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-note-${oppId}`} style={{ margin: 0 }}>
          {recordsArea.noteTitle}
        </Typography.Title>
        <div style={rowStyle}>
          <NativeSelect
            label={recordsArea.noteKind}
            value={noteKind}
            options={options(noteKindLabels)}
            onChange={(value) => setNoteKind((value as NoteKind | null) ?? 'MEMO')}
            disabled={disabled}
            testId="records-note-kind"
          />
        </div>
        <Input.TextArea
          aria-label={recordsArea.noteLabel}
          value={noteText}
          rows={2}
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={noteMax}
          onChange={(event) => setNoteText(event.target.value)}
          disabled={disabled}
          data-testid="records-note-input"
        />
        <span style={hintStyle}>
          {recordsArea.noteHint}{' '}
          <span data-testid="records-note-counter">
            {recordsArea.noteCounter(noteText.length, noteMax)}
          </span>
        </span>
        <div>
          <Button
            type="primary"
            disabled={disabled || noteText.trim() === ''}
            loading={busy === 'note'}
            onClick={() => void onSaveNote()}
            data-testid="records-note-save-button"
          >
            {recordsArea.noteSave}
          </Button>
        </div>
        {blockMessage('note')}
      </section>

      <section aria-labelledby={`records-stage-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-stage-${oppId}`} style={{ margin: 0 }}>
          {recordsArea.stageTitle}
        </Typography.Title>
        <span data-testid="records-stage-current" style={hintStyle}>
          {recordsArea.stageCurrent}:{' '}
          {currentStatus === 'LOST' && outcome?.lostReasonCode
            ? recordsArea.stageCurrentLost(lostReasonLabels[outcome.lostReasonCode])
            : currentStatus
              ? outcomeStatusLabels[currentStatus]
              : recordsArea.stageNone}
        </span>
        <div style={rowStyle}>
          <NativeSelect
            label={recordsArea.stageTitle}
            placeholder={recordsArea.selectPlaceholder}
            value={stage}
            options={options(outcomeStatusLabels)}
            onChange={(value) => {
              setStage(value as OutcomeStatus | null);
              // 거절이 아닌 단계로 바꾸면 거절 입력은 비운다(다른 단계에는 이유 코드를 보내지 않는다).
              if (value !== 'LOST') {
                setLostCode(null);
                setLostReason('');
              }
            }}
            disabled={disabled}
            testId="records-stage-select"
          />
          {stage === 'LOST' ? (
            <NativeSelect
              label={recordsArea.stageLostCodeLabel}
              placeholder={`${recordsArea.stageLostCodeLabel} ${recordsArea.selectPlaceholder}`}
              value={lostCode}
              options={options(lostReasonLabels)}
              onChange={(value) => setLostCode(value as LostReasonCode | null)}
              disabled={disabled}
              testId="records-stage-lost-code"
            />
          ) : null}
          <Button
            type="primary"
            disabled={disabled || !stage || stageSaveBlocked}
            loading={busy === 'stage'}
            onClick={() => void onSaveStage()}
            data-testid="records-stage-save-button"
          >
            {recordsArea.stageSave}
          </Button>
        </div>
        {stage === 'LOST' ? (
          <>
            {lostCode === null ? (
              <span data-testid="records-stage-lost-code-error" style={{ color: colors.error }}>
                {recordsArea.stageLostCodeRequired}
              </span>
            ) : null}
            <Input.TextArea
              aria-label={
                lostCode === 'OTHER'
                  ? recordsArea.stageReasonLabel
                  : recordsArea.stageReasonOptionalLabel
              }
              aria-required={lostCode === 'OTHER' ? 'true' : 'false'}
              value={lostReason}
              autoSize={{ minRows: 1, maxRows: 4 }}
              maxLength={noteMax}
              onChange={(event) => setLostReason(event.target.value)}
              disabled={disabled}
              data-testid="records-stage-reason-input"
            />
            {lostReasonMissing ? (
              <span data-testid="records-stage-reason-error" style={{ color: colors.error }}>
                {recordsArea.stageOtherReasonRequired}
              </span>
            ) : null}
          </>
        ) : null}
        {blockMessage('stage')}
      </section>

      <section aria-labelledby={`records-schedule-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-schedule-${oppId}`} style={{ margin: 0 }}>
          {recordsArea.scheduleTitle}
        </Typography.Title>
        <div style={rowStyle}>
          <Input
            type="date"
            aria-label={recordsArea.scheduleDate}
            style={{ width: 160 }}
            value={scheduleAt}
            onChange={(event) => setScheduleAt(event.target.value)}
            disabled={disabled}
            data-testid="records-schedule-date"
          />
          <Input
            aria-label={recordsArea.scheduleNote}
            placeholder={recordsArea.scheduleNote}
            style={{ flex: 1, minWidth: 200 }}
            value={scheduleNote}
            maxLength={noteMax}
            onChange={(event) => setScheduleNote(event.target.value)}
            disabled={disabled}
            data-testid="records-schedule-note"
          />
          <Button
            type="primary"
            disabled={disabled || scheduleAt === ''}
            loading={busy === 'schedule'}
            onClick={() => void onSaveSchedule()}
            data-testid="records-schedule-save-button"
          >
            {recordsArea.scheduleSave}
          </Button>
        </div>
        {blockMessage('schedule')}
      </section>
    </div>
  );
}
