// 의견 영역(S3, BR9.1·BR9.4·BR10.6): 목록 카드와 상세 맨 아래에서 같은 부품을 쓴다.
// 버튼 하나를 누르면 즉시 저장(검토할 만함·추가 확인), '대상 아님'은 사유 칸이 인라인으로 펼쳐진다(모달 없음).
// 저장되면 "저장됨 HH:MM"이 3초 보였다가 "의견: … (수정)"으로 남고, 실패하면 입력을 유지한다.
// #798(PM 지시 2026-11-16): 목록 카드는 variant="select"로 단추 셋 대신 고르기 칸 하나를 쓴다. 저장 규칙은 같다
// (영업 대상·검토 중은 바로 저장, 제외는 이유를 꼭 적어야 저장).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Button, Input, Space, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { ApiError, postOpinion } from '../../api/client';
import type { Meta, Opinion, OpinionRecord } from '../../api/types';
import { errorTexts, listSimple, opinionArea, opinionLabels } from '../../labels/ko';
import { colors, radius, typography } from '../../theme/tokens';
import { formatHourMinute } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

/** "저장됨 HH:MM"이 보이는 시간(ms). 지나면 영구 문구로 바뀐다. */
export const SAVED_FLASH_MS = 3000;
export const REASON_MAX_LENGTH = 200;

const BUTTONS: { value: Opinion; testId: string }[] = [
  { value: 'WORTH_REVIEW', testId: 'opinion-worth-review-button' },
  { value: 'NEED_CHECK', testId: 'opinion-need-check-button' },
  { value: 'NOT_TARGET', testId: 'opinion-not-target-button' },
];

export interface OpinionAreaProps {
  oppId: string;
  /** 본 평가 ID. 의견은 어느 평가를 보고 냈는지와 함께 저장된다(BR9.5). */
  evalId: string;
  /** 서버가 가진 현재 의견(없으면 null). 처음 보일 때만 쓴다. */
  record?: OpinionRecord | null;
  onSaved?: (record: OpinionRecord, meta: Meta) => void;
  /** "buttons"(기본, 상세)는 단추 셋, "select"(목록 카드, #798)는 고르기 칸 하나. */
  variant?: 'buttons' | 'select';
}

function previousText(previous: Record<string, unknown>): string {
  const value = previous.opinion;
  return typeof value === 'string' && value in opinionLabels ? opinionLabels[value as Opinion] : '';
}

export default function OpinionArea({
  oppId,
  evalId,
  record: initial,
  onSaved,
  variant = 'buttons',
}: OpinionAreaProps) {
  const selectMode = variant === 'select';
  const { staffKey, canRecord } = useFrame();
  const [record, setRecord] = useState<OpinionRecord | null>(initial ?? null);
  const [editing, setEditing] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [savingOpinion, setSavingOpinion] = useState<Opinion | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Record<string, unknown> | null>(null);
  const reasonRef = useRef<TextAreaRef>(null);
  const notTargetButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!savedAt) return undefined;
    const timer = setTimeout(() => setSavedAt(null), SAVED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  useEffect(() => {
    if (reasonOpen) reasonRef.current?.focus();
  }, [reasonOpen]);

  const saving = savingOpinion !== null;
  const showButtons = selectMode || !record?.opinion || editing || savedAt !== null;
  const trimmedReason = reason.trim();

  async function save(opinion: Opinion, reasonText?: string) {
    if (!staffKey) return;
    setSavingOpinion(opinion);
    setError(null);
    try {
      const envelope = await postOpinion(
        oppId,
        {
          opinion,
          evalId,
          expectedVersion: record?.version ?? null,
          ...(reasonText ? { reason: reasonText } : {}),
        },
        staffKey,
      );
      setRecord(envelope.data);
      setPrevious(envelope.meta.previousValue ?? null);
      setEditing(false);
      setReasonOpen(false);
      setReason('');
      setSavedAt(formatHourMinute(envelope.data.updatedAt) ?? formatHourMinute(new Date()));
      onSaved?.(envelope.data, envelope.meta);
    } catch (caught) {
      // 입력(사유 칸)은 그대로 둔다. 서버가 쉬운 말을 줬으면 함께 보인다.
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${opinionArea.saveFailed} (${detail})`);
    } finally {
      setSavingOpinion(null);
    }
  }

  function onPick(opinion: Opinion) {
    if (opinion === 'NOT_TARGET') {
      setReason(record?.opinion === 'NOT_TARGET' ? (record.reason ?? '') : '');
      setError(null);
      setReasonOpen(true);
      return;
    }
    setReasonOpen(false);
    void save(opinion);
  }

  function closeReason() {
    setReasonOpen(false);
    setReason('');
    setError(null);
    notTargetButtonRef.current?.focus();
  }

  function onReasonKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeReason();
    }
  }

  const reasonError = reasonOpen && trimmedReason === '' ? opinionArea.reasonRequired : null;

  // 고르기 칸에 보일 값: 제외 이유를 적는 동안은 "제외", 아니면 저장된 의견.
  const selectValue = reasonOpen ? 'NOT_TARGET' : (record?.opinion ?? '');

  return (
    <div data-testid="opinion-area" style={{ display: 'grid', gap: 8 }}>
      {selectMode ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label
            htmlFor={`opinion-select-${oppId}`}
            style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
          >
            {listSimple.opinionSelectLabel}
          </label>
          <select
            id={`opinion-select-${oppId}`}
            value={selectValue}
            disabled={!canRecord || saving}
            onChange={(event) => {
              const value = event.target.value as Opinion | '';
              if (value) onPick(value);
            }}
            data-testid="opinion-select"
            // #972: 선택 칸 모서리 9 + 얇은 테두리(목록 조건 칸과 같은 모양).
            style={{
              minHeight: 36,
              padding: '0 8px',
              borderRadius: radius.control,
              border: `1px solid ${colors.border}`,
              background: colors.bgContainer,
              color: colors.text,
              font: 'inherit',
            }}
          >
            <option value="" disabled>
              {listSimple.opinionSelectPlaceholder}
            </option>
            {BUTTONS.map(({ value }) => (
              <option key={value} value={value}>
                {opinionLabels[value]}
              </option>
            ))}
          </select>
          {record?.opinion === 'NOT_TARGET' && record.reason && !reasonOpen ? (
            <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
              {opinionArea.reasonLabel}: {record.reason}
            </span>
          ) : null}
        </span>
      ) : null}
      {/* #972: 좁은 표 줄 칸에서 고르기 칸 옆 단추를 밀어내지 않게, 안내는 고르기 칸 아래 작은 글로 둔다. */}
      {selectMode && !canRecord ? (
        <span
          data-testid="opinion-pick-staff-text"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {opinionArea.pickStaffFirst}
        </span>
      ) : null}
      {selectMode ? null : showButtons ? (
        <Space wrap size={8} role="group" aria-label={opinionArea.groupLabel}>
          {BUTTONS.map(({ value, testId }) => {
            const pressed = record?.opinion === value;
            return (
              <Button
                key={value}
                ref={value === 'NOT_TARGET' ? notTargetButtonRef : undefined}
                type={pressed ? 'primary' : 'default'}
                aria-pressed={pressed}
                disabled={!canRecord || (saving && savingOpinion !== value)}
                loading={savingOpinion === value && value !== 'NOT_TARGET'}
                onClick={() => onPick(value)}
                data-testid={testId}
              >
                {opinionLabels[value]}
              </Button>
            );
          })}
          {!canRecord ? (
            <Typography.Text data-testid="opinion-pick-staff-text" type="secondary">
              {opinionArea.pickStaffFirst}
            </Typography.Text>
          ) : null}
        </Space>
      ) : null}

      {reasonOpen && showButtons ? (
        <div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
          <label htmlFor={`opinion-reason-${oppId}`}>{opinionArea.reasonLabel}</label>
          <Input.TextArea
            id={`opinion-reason-${oppId}`}
            ref={reasonRef}
            value={reason}
            rows={1}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={REASON_MAX_LENGTH}
            aria-required="true"
            aria-describedby={`opinion-reason-help-${oppId}`}
            onChange={(event) => setReason(event.target.value)}
            onKeyDown={onReasonKeyDown}
            data-testid="opinion-reason-input"
          />
          <div id={`opinion-reason-help-${oppId}`} style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
              {opinionArea.contactHint}
            </span>
            {reasonError ? (
              <span data-testid="opinion-reason-error" style={{ color: colors.error }}>
                {reasonError}
              </span>
            ) : null}
          </div>
          <Space>
            <Button
              type="primary"
              disabled={trimmedReason === ''}
              loading={savingOpinion === 'NOT_TARGET'}
              onClick={() => void save('NOT_TARGET', trimmedReason)}
              data-testid="opinion-reason-save-button"
            >
              {opinionArea.save}
            </Button>
            <Button
              disabled={saving}
              onClick={closeReason}
              data-testid="opinion-reason-cancel-button"
            >
              {opinionArea.cancel}
            </Button>
          </Space>
        </div>
      ) : null}

      {/* 저장 결과는 화면 낭독기에 바로 읽히도록 항상 떠 있는 자리에 쓴다. */}
      <span aria-live="polite" data-testid="opinion-saved-text">
        {savedAt ? `${opinionArea.savedPrefix} ${savedAt}` : ''}
      </span>

      {error ? (
        <span role="alert" data-testid="opinion-save-error" style={{ color: colors.error }}>
          {error}
        </span>
      ) : null}

      {previous ? (
        <Alert
          type="warning"
          showIcon
          closable
          data-testid="opinion-changed-by-other"
          message={`${opinionArea.changedByOther} (${opinionArea.previousPrefix} ${previousText(previous)})`}
        />
      ) : null}

      {!showButtons && record?.opinion ? (
        <div data-testid="opinion-summary">
          <span>
            {opinionArea.savedSummaryPrefix} {opinionLabels[record.opinion]}
          </span>{' '}
          <Button
            type="link"
            size="small"
            aria-label={opinionArea.edit}
            disabled={!canRecord}
            onClick={() => setEditing(true)}
            data-testid="opinion-edit-button"
          >
            ({opinionArea.edit})
          </Button>
          {record.opinion === 'NOT_TARGET' && record.reason ? (
            <div style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}>
              {opinionArea.reasonLabel}: {record.reason}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
