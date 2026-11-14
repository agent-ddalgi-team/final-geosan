// 기록 영역(U5, 상세 하단): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정 네 칸. 모달·서랍 없이 인라인.
// 다음 일정은 꼬리 질문 "다음 할 일은?" 아래 날짜로 접촉과 함께 잡고, 따로 있는 일정 칸은 접어 둔다(#683).
// 덜 누르고 덜 오르내리게(#691, PM 결정 2026-11-13): 종류는 "전화"로 시작하고, "누가 먼저 연락했나"는 종류 옆에
// 기본 "우리가"로 골라져 있으며, [접촉 기록 저장]은 꼬리 질문·한 줄 메모 아래 맨 끝에 있다. 결과가 "거절"이면
// "어떻게 할까요?" 한 번으로 마무리 답을 대신 싣는다. 접힌 일정 칸에서는 통화 없이 종류·날짜로 일정만 잡는다.
// 메모는 덧붙이기만 되고, 단계·일정은 저장할 때마다 새 행이 쌓인다(서버 규칙 Q5). 수정·삭제 단추는 두지 않는다.
// 상대 회사 담당자 연락처를 메모에 적어도 막지 않는다(PM 결정 2026-11-03: 내부 메모장). 글자 수 초과 등
// 서버가 돌려주는 쉬운 말은 그대로 보인다.
import { useEffect, useState } from 'react';
import { Button, Input, Radio, Typography } from 'antd';
import { assistantConfigOf } from '../../api/assistant';
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
  memoReadTexts,
  noteKindLabels,
  outcomeStatusLabels,
  recordsArea,
  salesQuestionTexts,
  salesStepLabels,
} from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatHourMinute, formatMonthDay, todayKst } from '../../utils/time';
import MemoRead from '../assistant/MemoRead';
import type { MemoTarget } from '../assistant/MemoRead';
import { useFrame } from '../frame/FrameContext';
import { choiceAnswerIds } from './ChoiceQuestion';
import type { ChoiceMarks } from './ChoiceQuestion';
import QuickDate from './QuickDate';
import {
  STEP_ORDER,
  SalesQuestionFields,
  SalesStepSummary,
  closingPick,
  closingRouteOf,
  contactDefaults,
  contactQuestionsOf,
  nextActionPick,
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
  /**
   * 이 회사의 최신 검토 의견이 "제외"인지(#697). 제외한 회사에 접촉을 남기려 하면 저장 전에 그 자리에서
   * 한 번 묻는다: 영업 대상으로 되돌리고 저장할지, 제외인 채로 저장할지.
   */
  excluded?: boolean;
}

type BlockKey = 'contact' | 'note' | 'stage' | 'schedule';

/** 기록 종류 한 칸의 선택지. 전화·방문·메일은 접촉(영업 결과), 메모·자료 조사는 메모로 저장된다. */
type RecordKind = 'MEMO' | 'CALL' | 'VISIT' | 'EMAIL' | 'RESEARCH';

/** "어떻게 할까요?"에서 "아직 끝 아님 · 다시 연락"을 고른 상태(#691). 마무리 보기는 그 보기의 ID를 쓴다. */
const DECLINE_CONTINUE = '__CONTINUE__';

/** 상세 머리의 [기록 남기기]가 초점을 옮길 첫 입력(종류 고르기)의 id. */
export function recordsEntryInputId(oppId: string): string {
  return `records-kind-${oppId}`;
}

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
  id?: string;
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
  id,
}: NativeSelectProps) {
  return (
    <select
      id={id}
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
  excluded = false,
}: RecordsAreaProps) {
  const { config, staffKey, canRecord } = useFrame();
  const noteMax = config?.records?.noteMaxLength ?? DEFAULT_NOTE_MAX_LENGTH;

  const [outcome, setOutcome] = useState<OutcomeRecord | null>(initialOutcome ?? null);
  const [busy, setBusy] = useState<BlockKey | null>(null);
  const [message, setMessage] = useState<{ block: BlockKey; text: string; error: boolean } | null>(
    null,
  );

  // 종류 한 칸. 전화·방문·메일이면 결과·날짜 입력이, 메모·자료 조사면 글 입력이 보인다.
  // 통화 기록이 가장 잦아 "전화"로 시작한다(#691). 메모만 적을 때는 종류에서 "메모"를 고른다.
  const [recordKind, setRecordKind] = useState<RecordKind>('CALL');
  const [result, setResult] = useState<ContactResult | null>(null);
  const [judgmentCheck, setJudgmentCheck] = useState<JudgmentCheck | null>(null);
  // 접촉 날짜는 오늘(한국 시간)까지만 고른다. 서버가 그 뒤 날짜를 400으로 돌려주면 그 문장을 날짜 칸 아래에 보인다.
  const [attemptedAt, setAttemptedAt] = useState(todayKst());
  const [dateError, setDateError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // 방금 저장한 메모(#720). 영업 기록 스위치가 켜져 있으면 그 아래에 [AI가 메모 읽기 💰]가 보인다.
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);
  const aiReadsMemo = assistantConfigOf(config)?.enabled === true;
  // #607 꼬리 질문: 이번 접촉에서 고른 답과 한 줄 메모. 저장하면 비운다.
  const [questions, setQuestions] = useState<SalesQuestions | null>(null);
  const [questionsFailed, setQuestionsFailed] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  // #652 여러 개를 고르는 질문(공정·산업 확인)에서 고른 값.
  const [pickedMany, setPickedMany] = useState<Record<string, string[]>>({});
  const [memoLine, setMemoLine] = useState('');
  const [override, setOverride] = useState<SalesStep | null>(null);
  // "영업 단계" 칸은 기본으로 접혀 있다(#674). [단계 고치기]로 펼친다.
  const [stageOpen, setStageOpen] = useState(false);
  // "다음 일정" 칸도 접혀 있다(#683). [일정만 바꾸기]로 펼친다.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // 꼬리 질문 "다음 할 일은?" 아래 "언제 할까요?" 날짜(#683). 저장하면 비운다.
  const [nextDate, setNextDate] = useState('');
  // "언제 할까요?"에서 [없음]을 눌렀는지(#691). 일정 없이 지나간다(있던 일정은 그대로).
  const [nextNone, setNextNone] = useState(false);
  // 접촉 자체에 대한 질문("누가 먼저 연락했나요?" #691)에서 기본값과 다르게 고른 답.
  const [contactPicks, setContactPicks] = useState<Record<string, string>>({});
  // 결과가 "거절"일 때 "어떻게 할까요?"에서 고른 것(#691): 마무리 보기 ID 또는 "아직 끝 아님".
  const [declineChoice, setDeclineChoice] = useState<string | null>(null);
  // 제외한 회사에 [접촉 기록 저장]을 눌러 "영업 대상으로 되돌릴까요?"를 묻는 중인지(#697).
  const [askExcluded, setAskExcluded] = useState(false);
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
      // 접힌 "다음 일정" 칸을 펼쳤을 때 방금 저장한 일정이 들어 있게 한다(#683).
      setScheduleAt(saved.nextScheduleAt ?? '');
      setScheduleNote(saved.nextScheduleNote ?? '');
      onOutcomeSaved?.(saved);
      onRecorded?.();
      if (body.memo) setMemoTarget({ recordKind: 'OUTCOME', savedAt: saved.updatedAt });
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

  /** 지금 일정이 오늘보다 앞선가. 통화를 남길 때 이런 일정은 넘기지 않는다(PM 결정 2026-11-14). */
  function pastSchedule(): boolean {
    return Boolean(outcome?.nextScheduleAt && outcome.nextScheduleAt < todayKst());
  }

  function keepSchedule(): Pick<OutcomeRequest, 'nextScheduleAt' | 'nextScheduleNote'> {
    return {
      ...(outcome?.nextScheduleAt ? { nextScheduleAt: outcome.nextScheduleAt } : {}),
      ...(outcome?.nextScheduleNote ? { nextScheduleNote: outcome.nextScheduleNote } : {}),
    };
  }

  /**
   * 이번 저장으로 성사·거절로 "끝나는지"(#719 후속). 끝나는 저장이면 있던 일정을 다시 싣지 않는다 —
   * 실어 보내면 서버가 "보내온 일정"으로 받아 그대로 남겨, 끝난 회사에 옛 일정이 보였다.
   * 이미 같은 단계로 끝나 있던 회사(거절 뒤 이유만 고침)는 끝나는 저장이 아니므로 그대로 싣는다.
   */
  function endsSale(next: OutcomeStatus): boolean {
    return (next === 'WON' || next === 'LOST') && currentStatus !== next;
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

  // 접촉마다 남기는 답(누가 먼저 연락했나): 기본 보기가 골라져 있고 부재 접촉에도 보낸다(#691).
  const contactQuestions = contactQuestionsOf(questions);
  const contactAnswers = { ...contactDefaults(questions), ...contactPicks };

  // 결과가 "거절"이면 "다음 할 일 → 끝 → 어떻게 끝났나요?"를 차례로 묻지 않고 한 번에 묻는다(#691).
  // 어느 질문·보기가 그 길인지는 질문 파일에서 찾는다. 못 찾으면 전처럼 질문을 차례로 보인다.
  const route = closingRouteOf(questions);
  const declineOptions = (route?.options ?? []).filter((option) => option.closes !== 'WON');
  const declineMode = method !== null && result === 'DECLINED' && declineOptions.length > 0;

  function clearRoutePicks(previous: Record<string, string>): Record<string, string> {
    if (!route) return previous;
    const next = { ...previous };
    delete next[route.openerId];
    delete next[route.closingId];
    return next;
  }

  function onDeclineChoice(choice: string) {
    setDeclineChoice(choice);
    setPicked((previous) => {
      const next = clearRoutePicks(previous);
      if (route && choice !== DECLINE_CONTINUE) {
        // 고른 대로 "끝"과 마무리 답을 대신 싣는다. 서버 규칙(#643)은 그대로다.
        next[route.openerId] = route.endAnswerIds[0];
        next[route.closingId] = choice;
      }
      return next;
    });
  }

  function onResultChange(value: ContactResult | null) {
    setResult(value);
    // 결과가 바뀌면 "어떻게 할까요?"와 그 선택이 대신 실은 답을 비운다.
    setDeclineChoice(null);
    setPicked(clearRoutePicks);
  }

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
  // 끝이 아닌 "다음 할 일"을 고르고 날짜를 넣었으면 접촉과 함께 다음 일정을 잡는다(#683).
  // 날짜 칸이 안 보이는 동안(끝·답 지움·부재) 남아 있는 날짜는 쓰지 않는다.
  const nextAction = questions ? nextActionPick(questions, shownQuestions, picked) : null;
  const plannedDate = nextAction && !closing ? nextDate : '';
  const plannedDatePast = plannedDate !== '' && plannedDate < todayKst();

  /**
   * 접촉 저장. 제외한 회사면 먼저 한 번 묻고(#697), 답(`restore`)을 받은 뒤에 저장한다.
   * 제외가 아닌 회사는 묻지 않는다: 서버가 같은 저장 안에서 검토 의견을 "영업 대상"으로 정한다.
   */
  async function onSaveContact(restore?: boolean) {
    if (!method || !result || closingNeedsReason || closingNeedsMemo || plannedDatePast) return;
    if (excluded && restore === undefined) {
      setAskExcluded(true);
      return;
    }
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
      // 누가 먼저 연락했나(#691): 접촉(전화·메일·방문)마다, 부재여도 보낸다.
      ...contactQuestions
        .filter((question) => contactAnswers[question.questionId])
        .map((question) => ({
          questionId: question.questionId,
          answerId: contactAnswers[question.questionId],
        })),
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
      // 날짜를 넣었으면 새 일정(날짜 + 고른 할 일의 쉬운 말), 안 넣었으면 있던 일정을 그대로 싣는다.
      // 성사·거절로 끝나는 저장이면 있던 일정은 싣지 않는다(서버가 비운다, #719).
      // 이미 지난 일정도 싣지 않는다: 그 날짜 뒤에 연락했으니 놓친 일정이 아니다(PM 결정 2026-11-14).
      ...(nextAction && plannedDate !== ''
        ? { nextScheduleAt: plannedDate, nextScheduleNote: nextAction.label }
        : endsSale(status) || pastSchedule()
          ? {}
          : keepSchedule()),
      ...(closing ? closingReason : status === 'LOST' ? keepLostReason() : {}),
      ...(restore ? { restoreExcluded: true } : {}),
    });
    if (ok) {
      setAskExcluded(false);
      if (closing) {
        setSavedLostReason(closing.lostReasonCode === 'OTHER' ? memo : '');
      }
      onContactRecorded?.(method);
      setResult(null);
      setJudgmentCheck(null);
      setPicked({});
      setPickedMany({});
      setMemoLine('');
      setNextDate('');
      setNextNone(false);
      setContactPicks({});
      setDeclineChoice(null);
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
      if (noteKind === 'MEMO')
        setMemoTarget({ recordKind: 'NOTE', recordId: envelope.data.noteId });
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
      ...(endsSale(stage) ? {} : keepSchedule()),
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

  // 일정만 잡을 때 고르는 종류(#691): 방문·전화·메일 + 질문 파일 "다음 할 일"의 끝이 아닌 보기(자료 보내기·견적…).
  const nextActionQuestion = questions?.questions.find(
    (question) => question.questionId === route?.openerId,
  );
  const scheduleKinds = [
    ...new Set([
      contactMethodLabels.VISIT,
      contactMethodLabels.CALL,
      contactMethodLabels.EMAIL,
      ...(nextActionQuestion?.answers ?? [])
        .filter((option) => !route?.endAnswerIds.includes(option.answerId))
        .map((option) => option.label),
    ]),
  ];

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
            onChange={(value) => setRecordKind((value as RecordKind | null) ?? 'CALL')}
            disabled={disabled}
            testId="records-kind"
            id={recordsEntryInputId(oppId)}
          />
          {method ? (
            <>
              {/* 누가 먼저 연락했나(#691): 기본 "우리가"가 골라져 있어 대부분 누를 필요가 없다. 방문은 "우리가 감 / 상대가 옴". */}
              {contactQuestions.map((question) => (
                <NativeSelect
                  key={question.questionId}
                  label={question.text}
                  value={contactAnswers[question.questionId] ?? null}
                  options={question.answers.map((option) => ({
                    value: option.answerId,
                    label:
                      method === 'VISIT'
                        ? (salesQuestionTexts.contactVisitLabels[option.answerId] ?? option.label)
                        : option.label,
                  }))}
                  onChange={(value) =>
                    setContactPicks((previous) => {
                      const next = { ...previous };
                      if (value === null) delete next[question.questionId];
                      else next[question.questionId] = value;
                      return next;
                    })
                  }
                  disabled={disabled}
                  testId={`records-contact-question-${question.questionId}`}
                />
              ))}
              <NativeSelect
                label={recordsArea.contactResult}
                placeholder={`${recordsArea.contactResult} ${recordsArea.selectPlaceholder}`}
                value={result}
                options={options(contactResultLabels)}
                onChange={(value) => onResultChange(value as ContactResult | null)}
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
              {aiReadsMemo ? memoReadTexts.noteHintAi : recordsArea.noteHint}{' '}
              {aiReadsMemo ? memoReadTexts.nameHintAi : memoReadTexts.nameHint}{' '}
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
        {declineMode ? (
          <div data-testid="records-decline" style={{ display: 'grid', gap: 4 }}>
            <div id={`records-decline-label-${oppId}`}>{salesQuestionTexts.declineAsk}</div>
            <Radio.Group
              aria-labelledby={`records-decline-label-${oppId}`}
              optionType="button"
              value={declineChoice}
              disabled={disabled}
              onChange={(event) => onDeclineChoice(event.target.value as string)}
              options={[
                ...declineOptions.map((option) => ({
                  value: option.answerId,
                  label: salesQuestionTexts.declineCloseLabels[option.closes] ?? option.label,
                })),
                { value: DECLINE_CONTINUE, label: salesQuestionTexts.declineContinue },
              ]}
            />
          </div>
        ) : null}
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
            nextDate={nextDate}
            onNextDate={setNextDate}
            nextDateMin={todayKst()}
            nextNone={nextNone}
            onNextNone={setNextNone}
            hideQuestionIds={
              declineMode && route
                ? declineChoice === DECLINE_CONTINUE
                  ? [route.closingId]
                  : [route.openerId, route.closingId]
                : []
            }
            hideAnswerIds={
              declineMode && route && declineChoice === DECLINE_CONTINUE
                ? { [route.openerId]: route.endAnswerIds }
                : {}
            }
            limit={config?.records?.questionsPerContact ?? null}
            stepLine={
              declineMode && declineChoice === DECLINE_CONTINUE
                ? salesQuestionTexts.stepLineDeclinedContinue
                : undefined
            }
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
              {aiReadsMemo ? memoReadTexts.memoLineHintAi : salesQuestionTexts.memoHint}{' '}
              {aiReadsMemo ? memoReadTexts.nameHintAi : memoReadTexts.nameHint}{' '}
              {recordsArea.noteCounter(memoLine.length, MEMO_LINE_MAX_LENGTH)}
            </span>
          </>
        ) : null}
        {closingLabel ? (
          <span data-testid="records-close-preview" aria-live="polite">
            {salesQuestionTexts.closePreview(closingLabel)}
          </span>
        ) : null}
        {nextAction && plannedDate !== '' && !plannedDatePast ? (
          <span data-testid="records-next-date-preview" aria-live="polite">
            {salesQuestionTexts.nextDatePreview(
              formatMonthDay(plannedDate) ?? plannedDate,
              nextAction.label,
            )}
          </span>
        ) : null}
        {nextAction && !closing && nextNone ? (
          <span data-testid="records-next-none-preview" aria-live="polite">
            {outcome?.nextScheduleAt
              ? salesQuestionTexts.nextDateNoneKeeps(
                  formatMonthDay(outcome.nextScheduleAt) ?? outcome.nextScheduleAt,
                  outcome.nextScheduleNote ?? '',
                )
              : salesQuestionTexts.nextDateNonePreview}
          </span>
        ) : null}
        {declineMode && declineChoice === null ? (
          <span data-testid="records-decline-unpicked" style={hintStyle}>
            {salesQuestionTexts.declineUnpicked}
          </span>
        ) : null}
        {plannedDatePast ? (
          <span role="alert" data-testid="records-next-date-error" style={{ color: colors.error }}>
            {salesQuestionTexts.nextDatePast}
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
        {/* 저장 단추는 꼬리 질문·날짜·한 줄 메모 아래 맨 끝에 둔다(#691): 다 답한 뒤 위로 올라가지 않는다.
            저장 알림("저장됨 21:15")도 이 자리에 남는다. */}
        {method ? (
          <div style={rowStyle}>
            <Button
              type="primary"
              disabled={
                disabled ||
                !result ||
                attemptedAt === '' ||
                plannedDatePast ||
                closingNeedsReason ||
                closingNeedsMemo
              }
              loading={busy === 'contact'}
              onClick={() => void onSaveContact()}
              data-testid="records-contact-save-button"
            >
              {recordsArea.contactSave}
            </Button>
            {blockMessage('contact')}
          </div>
        ) : (
          blockMessage('note')
        )}
        {/* 방금 저장한 메모 줄 아래에만 보인다(#720). 스위치가 꺼져 있으면 아무것도 보이지 않는다. */}
        <MemoRead
          key={memoTarget ? JSON.stringify(memoTarget) : 'none'}
          oppId={oppId}
          target={memoTarget}
          outcome={outcome}
          processQuestionId={
            questions?.questions.find((question) => question.choices === 'PROCESS')?.questionId ??
            null
          }
          onApplied={(kind, saved) => {
            if (saved) {
              setOutcome(saved);
              setScheduleAt(saved.nextScheduleAt ?? '');
              setScheduleNote(saved.nextScheduleNote ?? '');
              onOutcomeSaved?.(saved);
            }
            onRecorded?.();
            // 공정·산업이 바뀌면 점수·검토사항도 바뀌므로 상세 전체를 조용히 다시 읽는다.
            if (kind === 'NEXT_SCHEDULE') onSalesStepChanged?.();
            else (onCompanyConfirmed ?? onSalesStepChanged)?.();
          }}
        />
        {/* 제외한 회사에 접촉을 남기려 할 때만: 창 없이 이 자리에서 한 번 묻는다(#697). */}
        {method && excluded && askExcluded ? (
          <div
            role="group"
            aria-label={recordsArea.excludedAsk}
            data-testid="records-excluded-ask"
            style={rowStyle}
          >
            <span role="status">{recordsArea.excludedAsk}</span>
            <Button
              type="primary"
              disabled={disabled}
              onClick={() => void onSaveContact(true)}
              data-testid="records-excluded-restore-button"
            >
              {recordsArea.excludedRestoreSave}
            </Button>
            <Button
              disabled={disabled}
              onClick={() => void onSaveContact(false)}
              data-testid="records-excluded-keep-button"
            >
              {recordsArea.excludedKeepSave}
            </Button>
          </div>
        ) : null}
      </section>

      {/* 영업 단계 칸은 기본으로 접어 둔다(#674, PM 지시 2026-11-13): 단계는 꼬리 질문 답으로 저절로 저장되고
          지금 단계는 상세 맨 위 진행 막대에 보인다. 잘못됐을 때만 이 한 줄에서 펼쳐 고친다(창 없음).
          큰 단계 고치기와 세부 단계 고치기(#607)가 같은 접힌 자리에 있다. */}
      <section aria-label={recordsArea.stageTitle} style={blockStyle}>
        <div style={rowStyle} data-testid="records-stage-fix">
          <span style={hintStyle}>{recordsArea.stageFixAsk}</span>
          <Button
            size="small"
            aria-expanded={stageOpen}
            aria-controls={`records-stage-body-${oppId}`}
            onClick={() => setStageOpen((open) => !open)}
            data-testid="records-stage-toggle"
          >
            {stageOpen ? recordsArea.stageFixClose : recordsArea.stageFixOpen}
          </Button>
          {stageOpen ? null : blockMessage('stage')}
        </div>
        <div
          id={`records-stage-body-${oppId}`}
          hidden={!stageOpen}
          data-testid="records-stage-body"
          style={stageOpen ? { display: 'grid', gap: 8 } : undefined}
        >
          {stageOpen ? (
            <>
              <Typography.Title level={4} id={`records-stage-${oppId}`} style={{ margin: 0 }}>
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
                    <span
                      data-testid="records-stage-lost-code-error"
                      style={{ color: colors.error }}
                    >
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
                    options={STEP_ORDER.map((code) => ({
                      value: code,
                      label: salesStepLabels[code],
                    }))}
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
            </>
          ) : null}
        </div>
      </section>

      {/* 다음 일정 칸도 접어 둔다(#683, PM 결정 2026-11-13): 일정은 꼬리 질문 "다음 할 일은?" 아래 날짜로
          접촉과 함께 잡는다. 통화 없이 일정만 바꿀 때 이 한 줄에서 펼친다(창 없음, 기능은 그대로). */}
      <section aria-label={recordsArea.scheduleTitle} style={blockStyle}>
        <div style={rowStyle} data-testid="records-schedule-fix">
          <span style={hintStyle} data-testid="records-schedule-current">
            {outcome?.nextScheduleAt
              ? recordsArea.scheduleCurrent(
                  formatMonthDay(outcome.nextScheduleAt) ?? outcome.nextScheduleAt,
                  outcome.nextScheduleNote ?? '',
                )
              : recordsArea.scheduleNone}
          </span>
          <Button
            size="small"
            aria-expanded={scheduleOpen}
            aria-controls={`records-schedule-body-${oppId}`}
            onClick={() => setScheduleOpen((open) => !open)}
            data-testid="records-schedule-toggle"
          >
            {scheduleOpen
              ? recordsArea.scheduleFixClose
              : outcome?.nextScheduleAt
                ? recordsArea.scheduleFixOpen
                : recordsArea.scheduleNewOpen}
          </Button>
          {scheduleOpen ? null : blockMessage('schedule')}
        </div>
        <div
          id={`records-schedule-body-${oppId}`}
          hidden={!scheduleOpen}
          data-testid="records-schedule-body"
          style={scheduleOpen ? { display: 'grid', gap: 8 } : undefined}
        >
          {scheduleOpen ? (
            <>
              <Typography.Title level={4} id={`records-schedule-${oppId}`} style={{ margin: 0 }}>
                {recordsArea.scheduleTitle}
              </Typography.Title>
              <span style={hintStyle} data-testid="records-schedule-only-hint">
                {recordsArea.scheduleOnlyHint}
              </span>
              {/* 통화 없이 일정만 잡기(#691): 종류를 고르면 "할 일 한 줄"이 그 말로 채워진다. */}
              <div
                role="group"
                aria-label={recordsArea.scheduleKind}
                style={rowStyle}
                data-testid="records-schedule-kinds"
              >
                {scheduleKinds.map((label) => (
                  <Button
                    key={label}
                    size="small"
                    type={scheduleNote === label ? 'primary' : 'default'}
                    aria-pressed={scheduleNote === label}
                    disabled={disabled}
                    onClick={() => setScheduleNote(label)}
                    data-testid="records-schedule-kind"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <QuickDate
                value={scheduleAt}
                onChange={setScheduleAt}
                from={todayKst()}
                disabled={disabled}
                label={recordsArea.scheduleDate}
                inputTestId="records-schedule-date"
                testId="records-schedule-quick"
              />
              <div style={rowStyle}>
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
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
