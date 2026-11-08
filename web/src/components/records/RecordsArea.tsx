// 기록 영역(U5, 상세 하단): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정 네 칸. 모달·서랍 없이 인라인.
// 메모는 덧붙이기만 되고, 단계·일정은 저장할 때마다 새 행이 쌓인다(서버 규칙 Q5). 수정·삭제 단추는 두지 않는다.
// 상대 회사 담당자 연락처를 메모에 적어도 막지 않는다(PM 결정 2026-11-03: 내부 메모장). 글자 수 초과 등
// 서버가 돌려주는 쉬운 말은 그대로 보인다.
import { useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { ApiError, postNote, postOutcome } from '../../api/client';
import type {
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
import { formatHourMinute, todayKst } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

export const DEFAULT_NOTE_MAX_LENGTH = 200;

export interface RecordsAreaProps {
  oppId: string;
  /** 본 평가 ID. 없으면 보내지 않는다. */
  evalId?: string | null;
  /** 서버가 가진 현재 영업 단계·일정(없으면 null). 처음 보일 때만 쓴다. */
  outcome?: OutcomeRecord | null;
  /** 접촉(전화·방문·메일)을 저장했을 때 알린다. 접촉 횟수는 상세 머리가 보인다. */
  onContactRecorded?: (method: ContactMethod) => void;
  /** 단계가 바뀌면 알린다(카드 꼬리표 갱신용). */
  onOutcomeSaved?: (outcome: OutcomeRecord) => void;
  /** 접촉·메모·단계·일정 중 무엇이든 저장이 끝나면 알린다(타임라인 새로 불러오기용). */
  onRecorded?: () => void;
}

type BlockKey = 'contact' | 'note' | 'stage' | 'schedule';

/** 기록 종류 한 칸의 선택지. 전화·방문·메일은 접촉(영업 결과), 메모·자료 조사는 메모로 저장된다. */
type RecordKind = 'MEMO' | 'CALL' | 'VISIT' | 'EMAIL' | 'RESEARCH';

const RECORD_KIND_ORDER: RecordKind[] = ['MEMO', 'CALL', 'VISIT', 'EMAIL', 'RESEARCH'];

function recordKindLabel(kind: RecordKind): string {
  if (kind === 'MEMO' || kind === 'RESEARCH') return noteKindLabels[kind];
  return contactMethodLabels[kind];
}

/** 접촉 날짜가 오늘(한국 시간)보다 뒤라서 서버가 돌려보낸 오류의 칸 이름(약속 C1, #433). */
const CONTACT_DATE_FIELD = 'attemptedAt';

function options(labels: Record<string, string>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

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
  onContactRecorded,
  onOutcomeSaved,
  onRecorded,
}: RecordsAreaProps) {
  const { config, staffKey, canRecord } = useFrame();
  const noteMax = config?.records?.noteMaxLength ?? DEFAULT_NOTE_MAX_LENGTH;

  const [outcome, setOutcome] = useState<OutcomeRecord | null>(initialOutcome ?? null);
  const [busy, setBusy] = useState<BlockKey | null>(null);
  const [message, setMessage] = useState<{ block: BlockKey; text: string; error: boolean } | null>(
    null,
  );

  // 종류 한 칸. 전화·방문·메일이면 결과·날짜 입력이, 메모·자료 조사면 글 입력이 보인다.
  const [recordKind, setRecordKind] = useState<RecordKind>('MEMO');
  const [result, setResult] = useState<ContactResult | null>(null);
  // 접촉 날짜는 오늘(한국 시간)까지만 고른다. 서버가 그 뒤 날짜를 400으로 돌려주면 그 문장을 날짜 칸 아래에 보인다.
  const [attemptedAt, setAttemptedAt] = useState(todayKst());
  const [dateError, setDateError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // 접촉을 적은 뒤 단계가 미접촉이면 "접촉으로 바꿀까요?"를 이 회사에서 한 번만 묻는다(자동 변경 아님).
  const [stageSuggestion, setStageSuggestion] = useState<'idle' | 'shown' | 'used'>('idle');

  const method: ContactMethod | null =
    recordKind === 'CALL' || recordKind === 'VISIT' || recordKind === 'EMAIL' ? recordKind : null;
  const noteKind: NoteKind = recordKind === 'RESEARCH' ? 'RESEARCH' : 'MEMO';

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
    setDateError(null);
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
      // 접촉 날짜가 오늘 뒤라서 서버가 돌려보냈으면 그 문장을 날짜 칸 아래에 보인다.
      const dateField =
        block === 'contact' && caught instanceof ApiError
          ? caught.body.fields?.find((field) => field.path === CONTACT_DATE_FIELD)
          : undefined;
      if (dateField) setDateError(dateField.message);
      else fail(block, caught);
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
    // 접촉을 적어도 단계는 자동으로 바꾸지 않는다(PM 결정 2026-11-08, #433): 지금 단계를 그대로 싣는다.
    // 단계 기록이 아직 없거나 미접촉이면, 저장이 끝난 뒤 "접촉으로 바꿀까요?"를 한 번 묻는다.
    const status: OutcomeStatus = currentStatus ?? 'NOT_EXECUTED';
    const askStage = status === 'NOT_EXECUTED';
    const ok = await saveOutcome('contact', {
      status,
      method,
      result,
      attemptedAt,
      ...keepSchedule(),
      ...(status === 'LOST' ? keepLostReason() : {}),
    });
    if (ok) {
      onContactRecorded?.(method);
      setResult(null);
      if (askStage) setStageSuggestion((previous) => (previous === 'idle' ? 'shown' : previous));
    }
  }

  /** 제안의 [접촉으로 바꾸기]: 영업 단계 저장과 같은 호출로 "접촉"을 저장한다. 하루 일정은 그대로 둔다. */
  async function onApplyStageSuggestion() {
    const ok = await saveOutcome('stage', { status: 'IN_PROGRESS', ...keepSchedule() });
    if (ok) setStageSuggestion('used');
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

      <Typography.Text type="secondary" data-testid="records-flow-guide">
        {recordsArea.flowGuide}
      </Typography.Text>

      <section aria-labelledby={`records-entry-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-entry-${oppId}`} style={{ margin: 0 }}>
          <span aria-hidden="true" data-testid="records-step-1">
            {recordsArea.stepOne}{' '}
          </span>
          {recordsArea.entryTitle}
        </Typography.Title>
        <div style={rowStyle}>
          <NativeSelect
            label={recordsArea.entryKind}
            value={recordKind}
            options={RECORD_KIND_ORDER.map((kind) => ({
              value: kind,
              label: recordKindLabel(kind),
            }))}
            onChange={(value) => setRecordKind((value as RecordKind | null) ?? 'MEMO')}
            disabled={disabled}
            testId="records-kind"
          />
          {method ? (
            <>
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
                aria-invalid={dateError ? 'true' : undefined}
                aria-describedby={dateError ? `records-contact-date-error-${oppId}` : undefined}
                style={{ width: 160 }}
                value={attemptedAt}
                max={todayKst()}
                onChange={(event) => {
                  setAttemptedAt(event.target.value);
                  setDateError(null);
                }}
                disabled={disabled}
                data-testid="records-contact-date"
              />
              <Button
                type="primary"
                disabled={disabled || !result || attemptedAt === ''}
                loading={busy === 'contact'}
                onClick={() => void onSaveContact()}
                data-testid="records-contact-save-button"
              >
                {recordsArea.contactSave}
              </Button>
            </>
          ) : null}
        </div>
        {method ? null : (
          <>
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
                {noteKind === 'RESEARCH' ? recordsArea.researchSave : recordsArea.noteSave}
              </Button>
            </div>
          </>
        )}
        {method && dateError ? (
          <span
            role="alert"
            id={`records-contact-date-error-${oppId}`}
            data-testid="records-contact-date-error"
            style={{ color: colors.error }}
          >
            {dateError}
          </span>
        ) : null}
        {blockMessage(method ? 'contact' : 'note')}
        {stageSuggestion === 'shown' &&
        (currentStatus === null || currentStatus === 'NOT_EXECUTED') ? (
          <div style={rowStyle} data-testid="records-stage-suggestion">
            <span>{recordsArea.stageSuggest}</span>
            <Button
              size="small"
              type="primary"
              disabled={disabled}
              loading={busy === 'stage'}
              onClick={() => void onApplyStageSuggestion()}
              data-testid="records-stage-suggestion-apply"
            >
              {recordsArea.stageSuggestApply}
            </Button>
            <Button
              size="small"
              disabled={disabled}
              onClick={() => setStageSuggestion('used')}
              data-testid="records-stage-suggestion-dismiss"
            >
              {recordsArea.stageSuggestDismiss}
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby={`records-stage-${oppId}`} style={blockStyle}>
        <Typography.Title level={3} id={`records-stage-${oppId}`} style={{ margin: 0 }}>
          <span aria-hidden="true" data-testid="records-step-2">
            {recordsArea.stepTwo}{' '}
          </span>
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
          <span aria-hidden="true" data-testid="records-step-3">
            {recordsArea.stepThree}{' '}
          </span>
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
