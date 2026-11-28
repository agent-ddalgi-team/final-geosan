// 의견 영역(S3, BR9.1·BR9.4·BR10.6): 목록 카드와 상세 맨 아래에서 같은 부품을 쓴다.
// 버튼 하나를 누르면 즉시 저장(검토할 만함·추가 확인), '대상 아님'은 사유 칸이 인라인으로 펼쳐진다(모달 없음).
// 저장되면 "저장됨 HH:MM"이 3초 보였다가 "의견: … (수정)"으로 남고, 실패하면 입력을 유지한다.
// #798(PM 지시 2026-11-16): 목록 카드는 variant="select"로 단추 셋 대신 고르기 칸 하나를 쓴다. 저장 규칙은 같다
// (영업 대상·검토 중은 바로 저장, 제외는 이유를 꼭 적어야 저장).
// #996(PM 결정 2026-11-29): 기업 상세는 variant="box"로 "담당자 의견" 이름이 붙은 칸 하나를 쓴다. 단추 셋이 늘 보이고,
// 아직 안 골랐으면 주황 칸 + "아직 안 골랐습니다 · 골라 주세요 →", 고른 뒤에는 흰 칸에 고른 단추만 진한 보라 + "✓"와
// "영업 담당 · 11/29"(고른 사람 · 날짜)가 붙는다. 저장 규칙과 막는 조건(담당자 미선택 · 보기 전용)은 같다.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Button, Input, Space, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { ApiError, postOpinion } from '../../api/client';
import type { Meta, Opinion, OpinionRecord } from '../../api/types';
import { detailCompose, errorTexts, listSimple, opinionArea, opinionLabels } from '../../labels/ko';
import { colors, detailLayout, opinionNudge, radius, typography } from '../../theme/tokens';
import { formatHourMinute, formatMonthDay } from '../../utils/time';
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
  /**
   * "buttons"(기본)는 단추 셋 → 저장 뒤 "의견: … (수정)", "select"(목록 카드, #798)는 고르기 칸 하나,
   * "box"(기업 상세, #996)는 "담당자 의견" 이름이 붙은 칸에 단추 셋이 늘 보인다.
   */
  variant?: 'buttons' | 'select' | 'box';
  /**
   * 고르기 칸(select)에서만 쓴다(#981). true인데 저장된 의견이 없으면 칸을 주황 테두리로 띄우고
   * "의견을 골라 주세요"를 보인다. 목록 줄이 "관심에 담은 회사"일 때 true로 준다.
   */
  nudge?: boolean;
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
  nudge = false,
}: OpinionAreaProps) {
  const selectMode = variant === 'select';
  const boxMode = variant === 'box';
  const { staffKey, canRecord, config } = useFrame();
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
  const showButtons = selectMode || boxMode || !record?.opinion || editing || savedAt !== null;
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
    // 칸 모양(#996)은 단추가 늘 보인다. 이미 고른 의견을 또 누르면 같은 값을 다시 저장하지 않는다
    // (제외는 이유를 고칠 수 있게 이유 칸을 연다).
    if (boxMode && opinion !== 'NOT_TARGET' && record?.opinion === opinion && !reasonOpen) return;
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
  // 관심에 담았는데 의견이 아직 없는 줄(#981). 제외 이유를 적는 중이거나 담당자를 안 골랐으면 알리지 않는다.
  const needsOpinion = selectMode && nudge && !record?.opinion && !reasonOpen && canRecord;
  // 칸 모양(#996): 아직 안 고른 회사는 주황 칸으로 알린다. 담당자를 안 골랐거나 보기 전용이면 고를 수 없으므로 알리지 않는다.
  const boxNeedsOpinion = boxMode && !record?.opinion && !reasonOpen && canRecord;
  const pickedByName = record?.opinion
    ? (config?.staff.find((entry) => entry.key === record.updatedBy)?.displayName ??
      record.updatedBy ??
      '')
    : '';
  const pickedByText =
    boxMode && record?.opinion && pickedByName
      ? detailCompose.opinion.by(pickedByName, formatMonthDay(record.updatedAt))
      : null;

  return (
    <div
      data-testid="opinion-area"
      // 칸 모양(#996)은 요약 줄 아래 오른쪽 끝에 붙는다.
      style={{ display: 'grid', gap: boxMode ? 4 : 8, justifyItems: boxMode ? 'end' : undefined }}
    >
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
              border: needsOpinion
                ? `2px solid ${opinionNudge.border}`
                : `1px solid ${colors.border}`,
              background: needsOpinion ? opinionNudge.bg : colors.bgContainer,
              color: colors.text,
              font: 'inherit',
            }}
            data-nudge={needsOpinion ? 'true' : undefined}
            aria-describedby={needsOpinion ? `opinion-nudge-${oppId}` : undefined}
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
      {needsOpinion ? (
        <span
          id={`opinion-nudge-${oppId}`}
          data-testid="opinion-nudge"
          style={{ color: opinionNudge.fg, fontSize: typography.fontSizeSecondary }}
        >
          {opinionArea.nudge}
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
      {boxMode ? (
        <div
          role="group"
          aria-label={detailCompose.opinion.title}
          data-testid="opinion-box"
          data-nudge={boxNeedsOpinion ? 'true' : undefined}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '6px 8px 6px 12px',
            borderRadius: radius.card,
            border: `1px solid ${boxNeedsOpinion ? opinionNudge.line : colors.borderSecondary}`,
            background: boxNeedsOpinion ? opinionNudge.bg : colors.bgContainer,
          }}
        >
          <span
            style={{
              fontSize: typography.fontSizeSecondary,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: boxNeedsOpinion ? opinionNudge.fg : colors.text,
            }}
          >
            {detailCompose.opinion.title}
          </span>
          {boxNeedsOpinion ? (
            <span
              data-testid="opinion-nudge"
              style={{ color: opinionNudge.fg, fontSize: detailLayout.smallFont }}
            >
              {detailCompose.opinion.nudge} <span aria-hidden="true">→</span>
            </span>
          ) : null}
          {BUTTONS.map(({ value, testId }) => {
            // 제외 이유를 적는 동안은 "제외"가 고른 것으로 보인다(저장 전).
            const pressed = reasonOpen ? value === 'NOT_TARGET' : record?.opinion === value;
            const saved = record?.opinion === value && !reasonOpen;
            return (
              <button
                key={value}
                type="button"
                ref={value === 'NOT_TARGET' ? notTargetButtonRef : undefined}
                aria-pressed={pressed}
                disabled={!canRecord || saving}
                onClick={() => onPick(value)}
                data-testid={testId}
                data-picked={saved ? 'true' : undefined}
                style={{
                  minHeight: 30,
                  padding: '3px 10px',
                  borderRadius: radius.controlSm,
                  border: `1px solid ${saved ? detailLayout.opinionPicked.bg : colors.border}`,
                  background: saved ? detailLayout.opinionPicked.bg : colors.bgContainer,
                  color: saved ? detailLayout.opinionPicked.fg : colors.text,
                  fontWeight: saved ? 600 : 400,
                  font: 'inherit',
                  fontSize: typography.fontSizeSecondary,
                  whiteSpace: 'nowrap',
                  cursor: !canRecord || saving ? 'not-allowed' : 'pointer',
                  opacity: !canRecord ? 0.6 : 1,
                }}
              >
                {saved ? <span aria-hidden="true">✓ </span> : null}
                {opinionLabels[value]}
              </button>
            );
          })}
          {pickedByText ? (
            <span
              data-testid="opinion-picked-by"
              style={{ color: colors.textDimmed, fontSize: detailLayout.smallFont }}
            >
              {pickedByText}
            </span>
          ) : null}
          {!canRecord ? (
            <span
              data-testid="opinion-pick-staff-text"
              style={{ color: colors.textSecondary, fontSize: detailLayout.smallFont }}
            >
              {opinionArea.pickStaffFirst}
            </span>
          ) : null}
        </div>
      ) : null}
      {boxMode && record?.opinion === 'NOT_TARGET' && record.reason && !reasonOpen ? (
        <span
          data-testid="opinion-box-reason"
          style={{
            color: colors.textSecondary,
            fontSize: typography.fontSizeSecondary,
            justifySelf: 'end',
          }}
        >
          {opinionArea.reasonLabel}: {record.reason}
        </span>
      ) : null}
      {selectMode || boxMode ? null : showButtons ? (
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
        <div
          style={{
            display: 'grid',
            gap: 8,
            maxWidth: 560,
            ...(boxMode ? { width: '100%', justifyItems: 'start' } : {}),
          }}
        >
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
