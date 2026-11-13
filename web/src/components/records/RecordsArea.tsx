// 기록 영역(U5, 상세 하단): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정 네 칸. 모달·서랍 없이 인라인.
// 메모는 덧붙이기만 되고, 단계·일정은 저장할 때마다 새 행이 쌓인다(서버 규칙 Q5). 수정·삭제 단추는 두지 않는다.
// 상대 회사 담당자 연락처를 메모에 적어도 막지 않는다(PM 결정 2026-11-03: 내부 메모장). 글자 수 초과 등
// 서버가 돌려주는 쉬운 말은 그대로 보인다.
import { useEffect, useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { ApiError, getSalesQuestions, postNote, postOutcome } from '../../api/client';
import type {
  ContactMethod,
  ContactResult,
  JudgmentCheck,
  LostReasonCode,
  NoteKind,
  OutcomeRecord,
  OutcomeRequest,
  OutcomeStatus,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import {
  contactMethodLabels,
  contactResultLabels,
  judgmentCheckLabels,
  errorTexts,
  lostReasonLabels,
  noteKindLabels,
  outcomeStatusLabels,
  recordsArea,
  salesQuestionTexts,
  salesStepLabels,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatHourMinute, todayKst } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';
import { choiceAnswerIds } from './ChoiceQuestion';
import type { ChoiceMarks } from './ChoiceQuestion';
import {
  STEP_ORDER,
  SalesQuestionFields,
  SalesStepSummary,
  closingPick,
  visibleQuestions,
} from './SalesQuestions';

export const DEFAULT_NOTE_MAX_LENGTH = 200;
/** 접촉 기록 한 줄 메모 상한(#607, 설정 records.memoLineMaxLength 초기값). 넘으면 서버가 400. */
export const MEMO_LINE_MAX_LENGTH = 100;

// 질문 파일은 한 번만 받는다(문구가 바뀌면 새로 고침으로 다시 받는다).
let questionsCache: Promise<SalesQuestions> | null = null;
function loadSalesQuestions(): Promise<SalesQuestions> {
  questionsCache ??= getSalesQuestions()
    .then((envelope) => envelope.data)
    .catch((caught: unknown) => {
      questionsCache = null;
      throw caught;
    });
  return questionsCache;
}

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
  /** 세부 단계·알아낸 것(#607). 상세가 다시 불러올 때마다 새 값이 들어온다. */
  salesStep?: SalesStepView | null;
  /** 접촉·단계 고치기를 저장해 세부 단계가 바뀌었을 수 있을 때 알린다(상세 다시 불러오기용). */
  onSalesStepChanged?: () => void;
  /** 이 회사에 붙어 있는 공정·산업군 표시(#652). 꼬리 질문의 공정·산업 확인 보기에 붙인다. */
  choiceMarks?: ChoiceMarks | null;
  /** 꼬리 질문으로 공정·산업을 확정해 저장했을 때 알린다(점수·검토사항까지 상세 전체 다시 불러오기용). */
  onCompanyConfirmed?: () => void;
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
  salesStep = null,
  onSalesStepChanged,
  choiceMarks = null,
  onCompanyConfirmed,
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
  const [judgmentCheck, setJudgmentCheck] = useState<JudgmentCheck | null>(null);
  // 접촉 날짜는 오늘(한국 시간)까지만 고른다. 서버가 그 뒤 날짜를 400으로 돌려주면 그 문장을 날짜 칸 아래에 보인다.
  const [attemptedAt, setAttemptedAt] = useState(todayKst());
  const [dateError, setDateError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // #607 꼬리 질문: 이번 접촉에서 고른 답과 한 줄 메모. 저장하면 비운다.
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);
  const [questionsFailed, setQuestionsFailed] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  // #652 여러 개를 고르는 질문(공정·산업 확인)에서 고른 값.
  const [pickedMany, setPickedMany] = useState<Record<string, string[]>>({});
  const [memoLine, setMemoLine] = useState('');
  const [override, setOverride] = useState<SalesStep | null>(null);
  useEffect(() => {
    let alive = true;
    loadSalesQuestions()
      .then((loaded) => {
        if (alive) setQuestions(loaded);
      })
      .catch(() => {
        if (alive) setQuestionsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  // 통화가 된 경우에만 판단이 맞았는지 알 수 있다. 부재면 묻지 않는다(#531).
  const spokeToCompany = result === 'REACHED' || result === 'DECLINED';

  // 꼬리 질문은 통화가 된 접촉에서만 보인다. "거절"이면 "다음 할 일"과 마무리 질문만(#643).
  const shownQuestions =
    method && spokeToCompany && questions
      ? visibleQuestions(questions, salesStep, picked, result === 'DECLINED')
      : [];
  // 마무리 답("끝 → 성사·거절·보류")을 골랐으면 저장할 때 단계가 그 값으로 정해진다(#643).
  const closing = closingPick(shownQuestions, picked);
  const closingNeedsReason = closing?.status === 'LOST' && closing.lostReasonCode === null;
  const closingNeedsMemo = closing?.lostReasonCode === 'OTHER' && memoLine.trim() === '';
  const closingLabel = closing
    ? closing.status === 'LOST' && closing.lostReasonCode
      ? recordsArea.stageCurrentLost(lostReasonLabels[closing.lostReasonCode])
      : outcomeStatusLabels[closing.status]
    : null;

  async function onSaveContact() {
    if (!method || !result || closingNeedsReason || closingNeedsMemo) return;
    // 지금 단계를 그대로 싣는다. 서버가 미접촉 → 접촉, 자료·견적 이상이면 → 견적·샘플로 앞으로만
    // 바꾼다(#607, PM 결정 2026-11-12로 #433의 "한 번 묻기"를 바꿈). 마무리 답을 골랐으면 서버가
    // 그 답으로 보류·성사·거절과 거절 이유를 정한다(#643). 화면도 같은 값을 실어 보낸다.
    const status: OutcomeStatus = closing?.status ?? currentStatus ?? 'NOT_EXECUTED';
    // 지금 보이는 질문의 답만 보낸다(가려진 꼬리 질문에 남은 옛 선택은 보내지 않는다).
    // 여러 개를 고르는 질문(#652)은 고른 값마다 답 하나씩. "아직 모름"이면 보내지 않는다.
    const choiceAnswers = shownQuestions
      .filter((question) => question.choices)
      .flatMap((question) =>
        choiceAnswerIds(question, pickedMany[question.questionId] ?? [], choiceMarks).map(
          (answerId) => ({ questionId: question.questionId, answerId }),
        ),
      );
    const answers = [
      ...shownQuestions
        .filter((question) => !question.choices && picked[question.questionId])
        .map((question) => ({
          questionId: question.questionId,
          answerId: picked[question.questionId],
        })),
      ...choiceAnswers,
    ];
    const memo = memoLine.trim();
    const closingReason: Pick<OutcomeRequest, 'lostReasonCode' | 'reason'> = closing?.lostReasonCode
      ? {
          lostReasonCode: closing.lostReasonCode,
          // 기타는 사유 글이 필수라 한 줄 메모를 사유로도 싣는다(기존 서버 규칙 그대로).
          ...(closing.lostReasonCode === 'OTHER' ? { reason: memo } : {}),
        }
      : {};
    const ok = await saveOutcome('contact', {
      status,
      method,
      result,
      attemptedAt,
      ...(spokeToCompany && judgmentCheck ? { judgmentCheck } : {}),
      ...(answers.length > 0 ? { answers } : {}),
      ...(memo ? { memo } : {}),
      ...keepSchedule(),
      ...(closing ? closingReason : status === 'LOST' ? keepLostReason() : {}),
    });
    if (ok) {
      if (closing) {
        setSavedLostReason(closing.lostReasonCode === 'OTHER' ? memo : '');
      }
      onContactRecorded?.(method);
      setResult(null);
      setJudgmentCheck(null);
      setPicked({});
      setPickedMany({});
      setMemoLine('');
      // 공정·산업을 확정했으면 점수·검토사항도 바뀌므로 상세 전체를 다시 불러오게 알린다(#652).
      if (choiceAnswers.length > 0 && onCompanyConfirmed) onCompanyConfirmed();
      else onSalesStepChanged?.();
    }
  }

  /** [단계 고치기](#607): 세부 단계를 담당자가 정한다. 큰 단계·일정은 그대로 싣는다. */
  async function onSaveOverride() {
    if (!override) return;
    const status: OutcomeStatus = currentStatus ?? 'IN_PROGRESS';
    const ok = await saveOutcome('stage', {
      status,
      stepOverride: override,
      ...keepSchedule(),
      ...(status === 'LOST' ? keepLostReason() : {}),
    });
    if (ok) {
      setOverride(null);
      onSalesStepChanged?.();
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

      <Typography.Text type="secondary" data-testid="records-flow-guide">
        {recordsArea.flowGuide}
      </Typography.Text>

      <SalesStepSummary step={salesStep} status={currentStatus} questions={questions} />

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
              {spokeToCompany ? (
                <NativeSelect
                  label={recordsArea.judgmentCheck}
                  placeholder={`${recordsArea.judgmentCheck} ${recordsArea.selectPlaceholder}`}
                  value={judgmentCheck}
                  options={options(judgmentCheckLabels)}
                  onChange={(value) => setJudgmentCheck(value as JudgmentCheck | null)}
                  disabled={disabled}
                  testId="records-judgment-check"
                />
              ) : null}
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
                disabled={
                  disabled ||
                  !result ||
                  attemptedAt === '' ||
                  closingNeedsReason ||
                  closingNeedsMemo
                }
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
        {method && spokeToCompany && questions ? (
          <SalesQuestionFields
            questions={questions}
            step={salesStep}
            picked={picked}
            allOnly={result === 'DECLINED'}
            onPick={(questionId, answerId) =>
              setPicked((previous) => {
                const next = { ...previous };
                if (answerId === null) delete next[questionId];
                else next[questionId] = answerId;
                return next;
              })
            }
            pickedMany={pickedMany}
            onPickMany={(questionId, values) =>
              setPickedMany((previous) => ({ ...previous, [questionId]: values }))
            }
            marks={choiceMarks}
            disabled={disabled}
          />
        ) : null}
        {method && spokeToCompany && questionsFailed ? (
          <span style={hintStyle} data-testid="sales-questions-failed">
            {salesQuestionTexts.loadFailed}
          </span>
        ) : null}
        {method && result ? (
          <>
            <Input
              aria-label={salesQuestionTexts.memoLabel}
              placeholder={salesQuestionTexts.memoLabel}
              value={memoLine}
              maxLength={MEMO_LINE_MAX_LENGTH}
              onChange={(event) => setMemoLine(event.target.value)}
              disabled={disabled}
              data-testid="records-contact-memo"
            />
            <span style={hintStyle}>
              {salesQuestionTexts.memoHint}{' '}
              {recordsArea.noteCounter(memoLine.length, MEMO_LINE_MAX_LENGTH)}
            </span>
          </>
        ) : null}
        {closingLabel ? (
          <span data-testid="records-close-preview" aria-live="polite">
            {salesQuestionTexts.closePreview(closingLabel)}
          </span>
        ) : null}
        {closingNeedsReason || closingNeedsMemo ? (
          <span data-testid="records-close-blocked" style={{ color: colors.error }}>
            {closingNeedsReason
              ? salesQuestionTexts.closeNeedsReason
              : salesQuestionTexts.closeOtherNeedsMemo}
          </span>
        ) : null}
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
        <span style={hintStyle} data-testid="records-stage-auto-hint">
          {recordsArea.stageAutoHint}
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
        {salesStep?.code ? (
          <div style={rowStyle}>
            <NativeSelect
              label={salesQuestionTexts.overrideLabel}
              placeholder={salesQuestionTexts.overrideLabel}
              value={override}
              options={STEP_ORDER.map((code) => ({ value: code, label: salesStepLabels[code] }))}
              onChange={(value) => setOverride(value as SalesStep | null)}
              disabled={disabled}
              testId="records-step-override"
            />
            <Button
              disabled={disabled || !override || override === salesStep.code}
              loading={busy === 'stage'}
              onClick={() => void onSaveOverride()}
              data-testid="records-step-override-save"
            >
              {salesQuestionTexts.overrideSave}
            </Button>
          </div>
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
