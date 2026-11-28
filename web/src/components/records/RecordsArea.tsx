// 기록 영역(U5, 상세 하단): 접촉 시도 / 영업 메모 / 영업 단계 / 다음 일정 네 칸. 모달·서랍 없이 인라인.
// 다음 일정은 꼬리 질문 "다음 할 일은?" 아래 날짜로 접촉과 함께 잡고, 따로 있는 일정 칸은 접어 둔다(#683).
// 덜 누르고 덜 오르내리게(#691, PM 결정 2026-11-13): 종류는 "전화"로 시작하고, "누가 먼저 연락했나"는 종류 옆에
// 기본 "우리가"로 골라져 있으며, [접촉 기록 저장]은 꼬리 질문·한 줄 메모 아래 맨 끝에 있다. 결과가 "거절"이면
// "어떻게 할까요?" 한 번으로 마무리 답을 대신 싣는다. 접힌 일정 칸에서는 통화 없이 종류·날짜로 일정만 잡는다.
// 메모는 덧붙이기만 되고, 단계·일정은 저장할 때마다 새 행이 쌓인다(서버 규칙 Q5). 수정·삭제 단추는 두지 않는다.
// 상대 회사 담당자 연락처를 메모에 적어도 막지 않는다(PM 결정 2026-11-03: 내부 메모장). 글자 수 초과 등
// 서버가 돌려주는 쉬운 말은 그대로 보인다.
// 영업 코치(#742, PM 결정 2026-11-14): 영업 기록 스위치가 켜져 있고 결과가 "연결됨"이면 꼬리 질문 대신
// "확인사항"과 메모 칸, [보내기 💰]가 보인다. AI가 정리한 것을 확인 화면에서 보고 [이대로 저장]을 눌러야
// 저장되고(기존 /outcomes, 답마다 누가 채웠는지), [고치기]는 AI 답이 골라진 지금 양식을 연다.
// 코치 피드백 줄은 저장 뒤 /notes kind ADVICE로, 다음 통화에 물어볼 것은 kind CALL_PREP 한 행으로 남는다(#750). [AI가 메모 읽기]는 코치로 합쳐 이 칸에서 뺐다.
// 기록 남기기 단순화(#985, PM 결정 2026-11-29 시안 "기록 남기기 — 만들 흐름"): 영업 코치를 쓸 수 있으면 고르는 것은
// 종류 하나(통화 · 메일 · 대면 · 메모) + 메모뿐이다. 발신/수신 · 결과 · 접촉 날짜 칸은 처음 모습에서 없앴고
// (날짜는 오늘, 방향은 "우리가"), [보내기 유료] 뒤 확인 화면(CoachReview)에서 한 줄로 보고 바꾼다.
//   · 메모가 "부재" 낱말뿐이면(absentWords) AI 없이 [저장] 한 번으로 부재 접촉을 남기고 그 자리에서 일정을 잡는다.
//   · 메모에 전화번호 · 이메일이 있으면(contactGuard) 단추를 누르기 전에 알리고 막는다(AI 비용이 먼저 나가지 않게).
//   · 종류 [메모]는 [메모로만 저장](전과 같음, 저장 뒤 [일정 잡기] · [AI가 메모 읽기])과 [영업 코치에게 보내기 유료]
//     (통화 · 메일 · 대면을 한 번 고르면 접촉 기록으로 정리 · 저장, /notes로는 저장하지 않는다) 두 가지다.
//   · 영업 코치를 못 쓰면(스위치 꺼짐 · 하루/월 한도 503 · 422 · 질문 파일을 못 읽음) 전의 직접 고르는 양식이 그대로 나온다.
//     확인 화면의 [고치기]와 보내기 실패 뒤 [직접 고르기]도 그 양식을 연다. 적던 메모는 그대로 둔다.
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { Button, Input, Typography } from 'antd';
import { assistantConfigOf, SCHEDULE_CHANGED_EVENT } from '../../api/assistant';
import { ApiError, getSalesQuestions, postNote, postOutcome } from '../../api/client';
import type { OutcomeResponse } from '../../api/types';
import { postCoach } from '../../api/coach';
import type { CoachResult } from '../../api/coach';
import type {
  AnswerFilledBy,
  ContactMethod,
  ContactResult,
  LostReasonCode,
  NoteKind,
  OutcomeRecord,
  OutcomeRequest,
  OutcomeStatus,
  SalesQuestions,
  SalesStep,
  SalesStepView,
} from '../../api/types';
import MemoRead from '../assistant/MemoRead';
import PaidTag from '../common/PaidTag';
import {
  coachTexts,
  contactMethodLabels,
  contactResultLabels,
  errorTexts,
  lostReasonLabels,
  memoReadTexts,
  outcomeStatusLabels,
  quickRecordTexts,
  recordsArea,
  salesQuestionTexts,
  salesStepLabels,
  handoffTexts,
} from '../../labels/ko';
import { accent, colors, radius, typography, warn } from '../../theme/tokens';
import { formatHourMinute, formatMonthDay, todayKst } from '../../utils/time';
import { useFrame, VIEWER_KEY } from '../frame/FrameContext';
import { isAbsentMemo } from './absentWords';
import ChoiceChips from './ChoiceChips';
import { choiceAnswerIds } from './ChoiceQuestion';
import type { ChoiceMarks } from './ChoiceQuestion';
import { CoachReview } from './CoachReview';
import type { CoachSelection } from './CoachReview';
import { findContact } from './contactGuard';
import QuickDate from './QuickDate';
import {
  AbsentSavedBox,
  ContactAlert,
  MemoKindAsk,
  NoteSavedBox,
  RecordExamples,
} from './QuickRecord';
import { CoachChecklist } from './SalesCoach';
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

/** #847: 화면에는 안 보이고 읽어 주는 도구에만 남는 제목. */
const screenReaderOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  margin: 0,
} as const;

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
  /** #803 오른쪽 영업 코치 판 안에 놓일 때 true: 맨 위 요약을 줄인다(세부 단계·아직 모르는 것은 다른 곳과 같아 뺌). */
  inCoach?: boolean;
  /**
   * #847: 확정된 것(들은 답 · 단계 고치기)을 옮겨 그릴 왼쪽 자리(영업 단계 칸 아래). 없으면 이 칸 안에 그린다.
   * #996(PM 결정 2026-11-29): 그 자리에는 "▸ 지금까지 들은 답 n개"와 "단계 고치기"만 작은 링크 모양으로 그린다.
   * [일정만 바꾸기]는 그리지 않는다(일정은 영업 코치 맨 위 "다음 일정 [바꾸기]"로 바꾼다). 이 칸 안에 그릴 때는 전과 같다.
   */
  sideSlot?: HTMLElement | null;
  /** #847: 메모를 받는 사람에게 전달 사항으로 남긴 뒤(상세를 다시 읽게). */
  onHandoffSent?: () => void;
}

type BlockKey = 'contact' | 'note' | 'stage' | 'schedule';

/**
 * 기록 종류 한 칸의 선택지. 전화·대면·메일은 접촉(영업 결과), 메모는 메모로 저장된다.
 * #847(PM 결정 2026-11-17): "자료 조사"는 "메모"로 합쳤다(예전 자료 조사 기록은 그대로 보인다).
 */
type RecordKind = 'MEMO' | 'CALL' | 'VISIT' | 'EMAIL';

/** "어떻게 할까요?"에서 "아직 끝 아님 · 다시 연락"을 고른 상태(#691). 마무리 보기는 그 보기의 ID를 쓴다. */
const DECLINE_CONTINUE = '__CONTINUE__';

/** 상세 머리의 [기록 남기기]가 초점을 옮길 첫 입력(종류 고르기)의 id. */
export function recordsEntryInputId(oppId: string): string {
  return `records-kind-${oppId}`;
}

const RECORD_KIND_ORDER: RecordKind[] = ['CALL', 'EMAIL', 'VISIT', 'MEMO'];

/** #853 메모 받는 사람 칸에서 역할 묶음 값의 머리(사람 키와 섞이지 않게). */
const TEAM_PREFIX = 'team:';

/** 이 칸의 종류 단추 글(#985 시안: 통화 · 메일 · 대면 · 메모). 다른 화면의 공통 글자는 그대로다. */
function recordKindLabel(kind: RecordKind): string {
  return quickRecordTexts.kindLabels[kind];
}

/**
 * 영업 코치를 지금 쓸 수 없다는 실패인가(#985): 하루 · 월 한도(503, kind …_LIMIT)나 스위치 꺼짐 · 전송 거부(422).
 * 이때는 다시 보내도 같으므로 직접 고르는 양식을 연다. 그 밖의 실패(네트워크 등)는 그 자리에서 다시 보낼 수 있다.
 */
function coachUnavailable(caught: unknown): caught is ApiError {
  if (!(caught instanceof ApiError)) return false;
  const kind = caught.body.kind ?? '';
  return (
    caught.status === 503 ||
    caught.status === 422 ||
    kind.endsWith('_LIMIT') ||
    kind === 'SALES_RECORDS_DISABLED'
  );
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
        borderRadius: radius.control,
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

/**
 * 답 하나를 누가 채웠나(#742): 코치가 채운 답 그대로면 AI_CONFIRMED, 코치가 채운 질문을 다른 보기로
 * 바꿨으면 AI_CHANGED(PM 결정 2026-11-14), 코치가 채우지 않은 질문을 고른 답은 STAFF.
 */
function filledByOf(
  answer: { questionId: string; answerId: string },
  aiFilled: Record<string, string[]>,
): AnswerFilledBy {
  const original = aiFilled[answer.questionId];
  if (!original) return 'STAFF';
  return original.includes(answer.answerId) ? 'AI_CONFIRMED' : 'AI_CHANGED';
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
  inCoach = false,
  sideSlot = null,
  onHandoffSent,
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
  // 접촉 날짜는 오늘(한국 시간)까지만 고른다. 서버가 그 뒤 날짜를 400으로 돌려주면 그 문장을 날짜 칸 아래에 보인다.
  const [attemptedAt, setAttemptedAt] = useState(todayKst());
  const [dateError, setDateError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // 영업 기록 스위치가 켜져 있으면 연결된 접촉은 영업 코치로 적는다(#742).
  const aiReadsMemo = assistantConfigOf(config)?.enabled === true;
  // 영업 코치(#742): 받은 정리, 보내는 중, 오류, [고치기]로 지금 양식을 연 상태, AI가 채운 답, 남길 피드백.
  const [coachResult, setCoachResult] = useState<CoachResult | null>(null);
  const [coachSending, setCoachSending] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachEditing, setCoachEditing] = useState(false);
  const [aiFilled, setAiFilled] = useState<Record<string, string[]> | null>(null);
  const [adviceKeep, setAdviceKeep] = useState<string[]>([]);
  // (#750) [고치기]로 양식을 연 뒤 저장해도 코치가 준 다음 통화 준비를 남긴다.
  const [nextCallKeep, setNextCallKeep] = useState<string[]>([]);
  // 제외한 회사에 [이대로 저장]을 눌러 "영업 대상으로 되돌릴까요?"를 묻는 동안 기다리는 코치 저장(#697).
  const [pendingCoach, setPendingCoach] = useState<CoachSelection | null>(null);
  // #985: 영업 코치를 지금 쓸 수 없을 때(한도 · 스위치 꺼짐) 서버가 준 안내. 있으면 직접 고르는 양식을 연다.
  const [coachBlocked, setCoachBlocked] = useState<string | null>(null);
  // #985 종류 [메모] → [영업 코치에게 보내기]: "어떻게 있었던 일인가요?"를 묻는 중인지, 고른 종류.
  const [askMemoKind, setAskMemoKind] = useState(false);
  const [memoAs, setMemoAs] = useState<ContactMethod | null>(null);
  // #985 "부재" 낱말만 적어 AI 없이 저장한 뒤의 초록 상자(그 자리에서 다음 일정을 잡는다).
  const [absentSaved, setAbsentSaved] = useState<{ method: ContactMethod; line: string } | null>(
    null,
  );
  // 제외한 회사에 부재 [저장]을 눌러 "영업 대상으로 되돌릴까요?"를 묻는 중인지(#697 · #985).
  const [pendingAbsent, setPendingAbsent] = useState(false);
  // #985 [메모로만 저장] 뒤: 방금 저장한 메모(그 아래 [일정 잡기] · [AI가 메모 읽기]).
  const [noteSaved, setNoteSaved] = useState<{ noteId: string } | null>(null);
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
  const noteKind: NoteKind = 'MEMO';
  // #847: 메모에 받는 사람을 고르면 전달 사항(HANDOFF)으로 남는다. 안 고르면 그냥 메모.
  const [noteTo, setNoteTo] = useState<string | null>(null);
  // #853(PM 결정 2026-11-17): 역할 묶음(영업·검수·운영)이 설정돼 있으면 사람 대신 묶음으로 고른다.
  // 묶음 값은 "team:SALES"처럼 앞에 team:을 붙여 사람 키와 섞이지 않게 한다. 나 말고 받을 사람이 없는 묶음은 뺀다.
  const teamTargets = (config?.handoffTeams ?? [])
    .filter((team) => team.staffKeys.some((key) => key !== staffKey))
    .map((team) => ({ key: `${TEAM_PREFIX}${team.key}`, displayName: team.label }));
  const noteTargets =
    teamTargets.length > 0
      ? teamTargets
      : (config?.staff ?? []).filter((entry) => entry.key !== staffKey && entry.key !== VIEWER_KEY);

  const [stage, setStage] = useState<OutcomeStatus | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostCode, setLostCode] = useState<LostReasonCode | null>(null);
  // 방금 저장한 거절 사유 글. 거절 상태에서 일정·접촉만 저장할 때 같은 이유를 다시 실어 보내는 데 쓴다.
  const [savedLostReason, setSavedLostReason] = useState('');

  const [scheduleAt, setScheduleAt] = useState(initialOutcome?.nextScheduleAt ?? '');
  const [scheduleNote, setScheduleNote] = useState(initialOutcome?.nextScheduleNote ?? '');
  // #980: 다른 칸(영업 코치 "다음 일정" · 영업 홈 표)에서 저장해 서버 기록이 더 새로우면 그 값으로 맞춘다.
  // 맞추지 않으면 다음 접촉 저장이 옛 일정을 다시 실어 보내 방금 잡은 일정을 덮는다.
  const [seenOutcomeVersion, setSeenOutcomeVersion] = useState(initialOutcome?.version ?? null);
  if (
    initialOutcome &&
    initialOutcome.version !== seenOutcomeVersion &&
    initialOutcome.version > (outcome?.version ?? -1)
  ) {
    setSeenOutcomeVersion(initialOutcome.version);
    setOutcome(initialOutcome);
    setScheduleAt(initialOutcome.nextScheduleAt ?? '');
    setScheduleNote(initialOutcome.nextScheduleNote ?? '');
  }

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
      // #980: 일정·접촉이 바뀌었으니 왼쪽 달력 · 영업 홈 · 메뉴 숫자가 다시 읽게 알린다(#983과 같은 이벤트).
      window.dispatchEvent(new Event(SCHEDULE_CHANGED_EVENT));
      // 접힌 "다음 일정" 칸을 펼쳤을 때 방금 저장한 일정이 들어 있게 한다(#683).
      setScheduleAt(saved.nextScheduleAt ?? '');
      setScheduleNote(saved.nextScheduleNote ?? '');
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

  /**
   * 접촉 날짜가 지금 일정 날짜와 같거나 뒤인가. 일정대로 연락했으니 그 일정은 넘기지 않는다
   * (PM 결정 2026-11-14 #733, 서버와 같은 규칙).
   */
  function pastSchedule(day: string = attemptedAt): boolean {
    const contactedOn = day || todayKst();
    return Boolean(outcome?.nextScheduleAt && outcome.nextScheduleAt <= contactedOn);
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
  // #853: 첫 접촉 질문("누가 먼저 연락했나요?")은 종류 옆 단추로 고른다(발신/수신, 외근/내방).
  const direction = contactQuestions[0] ?? null;
  const directionDefault = direction?.answers.find((option) => option.default)?.answerId;

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
    // 받아 둔 코치 정리도 비운다(#742). 다른 결과의 접촉에 실리지 않게.
    // [고치기] · [직접 고르기]로 연 양식은 그대로 둔다(#985: 결과를 바꿨다고 처음 모습으로 돌아가지 않게).
    clearCoach(true);
  }

  function clearCoach(keepForm = false) {
    setCoachResult(null);
    setCoachError(null);
    if (!keepForm) setCoachEditing(false);
    setAiFilled(null);
    setAdviceKeep([]);
    setNextCallKeep([]);
    setPendingCoach(null);
    setPendingAbsent(false);
    setAskMemoKind(false);
    setMemoAs(null);
  }

  // #985: 영업 코치를 쓸 수 있으면 "종류 하나 + 메모" 흐름, 아니면(스위치 꺼짐 · 한도 · 질문 파일 실패 · [고치기]) 지금 양식.
  const quick = aiReadsMemo && !questionsFailed && !coachEditing && coachBlocked === null;
  // 영업 코치로 정리 · 저장할 접촉의 종류와 메모: 종류 [메모]에서 보냈으면 그때 고른 종류와 메모 칸의 글.
  const coachMethod: ContactMethod | null = method ?? memoAs;
  const coachMemo = (method ? memoLine : noteText).trim();
  // 메모에 전화번호 · 이메일이 있으면 누르기 전에 알린다(접촉 메모는 서버가 연락처를 400으로 거부한다).
  const contactFound = coachMemo !== '' && findContact(coachMemo) !== null;
  // 메모가 "부재" 낱말뿐이면 AI 없이 바로 저장한다.
  const absentMemo = method !== null && isAbsentMemo(method, memoLine);

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
    const formAnswers = [
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
    // 코치 답을 [고치기]로 연 양식이면 답마다 누가 채웠는지 싣는다(#742): AI 답 그대로면 AI_CONFIRMED.
    const answers = aiFilled
      ? formAnswers.map((answer) => ({ ...answer, filledBy: filledByOf(answer, aiFilled) }))
      : formAnswers;
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
      // "AI 판단이 맞았나"는 더 묻지 않는다(#740, PM 결정 2026-11-14). 서버의 그 칸은 그대로 두고 요청에 싣지 않는다.
      ...(answers.length > 0 ? { answers } : {}),
      ...(memo ? { memo } : {}),
      // 날짜를 넣었으면 새 일정(날짜 + 고른 할 일의 쉬운 말), 안 넣었으면 있던 일정을 그대로 싣는다.
      // 성사·거절로 끝나는 저장이면 있던 일정은 싣지 않는다(서버가 비운다, #719).
      // 일정 날짜나 그 뒤에 연락했으면 그 일정도 싣지 않는다: 놓친 일정이 아니다(#733).
      ...(nextAction && plannedDate !== ''
        ? { nextScheduleAt: plannedDate, nextScheduleNote: nextAction.label }
        : endsSale(status) || pastSchedule()
          ? {}
          : keepSchedule()),
      ...(closing ? closingReason : status === 'LOST' ? keepLostReason() : {}),
      ...(restore ? { restoreExcluded: true } : {}),
    });
    if (ok) {
      if (closing) {
        setSavedLostReason(closing.lostReasonCode === 'OTHER' ? memo : '');
      }
      await afterContactSaved(method, choiceAnswers.length > 0, adviceKeep, nextCallKeep);
    }
  }

  /** 접촉 저장 뒤 칸을 비우고, 코치 피드백(#742)과 다음 통화 준비(#750)를 남기고, 상세에 알린다. */
  async function afterContactSaved(
    saved: ContactMethod,
    confirmed: boolean,
    advice: string[],
    nextCall: string[],
  ) {
    setAskExcluded(false);
    onContactRecorded?.(saved);
    setResult(null);
    setPicked({});
    setPickedMany({});
    // 종류 [메모]에서 영업 코치로 보낸 접촉이면 메모 칸의 글이 그 접촉의 메모였다(#985).
    if (method) setMemoLine('');
    else setNoteText('');
    setNextDate('');
    setNextNone(false);
    setContactPicks({});
    setDeclineChoice(null);
    clearCoach();
    if (advice.length > 0) await keepAdvice(advice);
    if (nextCall.length > 0) await keepCallPrep(nextCall);
    // 공정·산업을 확정했으면 점수·검토사항도 바뀌므로 상세 전체를 다시 불러오게 알린다(#652).
    if (confirmed && onCompanyConfirmed) onCompanyConfirmed();
    else onSalesStepChanged?.();
  }

  /** 코치 피드백 줄을 메모 종류 ADVICE로 남긴다(#742, #750부터 모두). 실패하면 한 줄로 알린다. */
  async function keepAdvice(lines: string[]) {
    if (!staffKey) return;
    try {
      for (const text of lines) {
        await postNote(oppId, { text, kind: 'ADVICE', ...(evalId ? { evalId } : {}) }, staffKey);
      }
      onRecorded?.();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setMessage({ block: 'contact', text: `${coachTexts.adviceFailed} (${detail})`, error: true });
    }
  }

  /** (#750) 다음 통화에 물어볼 것을 메모 종류 CALL_PREP 한 행(줄바꿈으로 이음)으로 남긴다. */
  async function keepCallPrep(lines: string[]) {
    if (!staffKey) return;
    try {
      const text = lines.join('\n');
      await postNote(oppId, { text, kind: 'CALL_PREP', ...(evalId ? { evalId } : {}) }, staffKey);
      onRecorded?.();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setMessage({ block: 'contact', text: `${coachTexts.prepFailed} (${detail})`, error: true });
    }
  }

  /** #985 종류 [메모]에서 적은 글을 접촉 양식으로 옮긴다(직접 고르는 양식은 접촉 종류에서만 쓸 수 있다). */
  function moveNoteToContact(as: ContactMethod) {
    setRecordKind(as);
    setMemoLine(noteText.trim().slice(0, MEMO_LINE_MAX_LENGTH));
    setNoteText('');
    setAskMemoKind(false);
    setMemoAs(null);
  }

  /**
   * [보내기 유료](#742 → #985): 저장 전 메모를 코치에 보내 정리·빠진 필수 질문·피드백을 받는다. 저장은 하지 않는다.
   * 날짜는 오늘로 보낸다(확인 화면에서 바꾼다). 종류 [메모]에서는 고른 종류(`as`)로 보낸다.
   * 영업 코치를 지금 쓸 수 없으면(한도 · 스위치 꺼짐) 직접 고르는 양식을 열고, 그 밖의 실패는 그 자리에 알린다.
   */
  async function onSendCoach(as?: ContactMethod) {
    const sendMethod = as ?? method;
    const memo = (as ? noteText : memoLine).trim();
    if (!staffKey || !sendMethod || memo === '' || coachSending || findContact(memo)) return;
    setCoachSending(true);
    setCoachError(null);
    setMessage(null);
    // 앞 기록의 저장 뒤 상자(부재 · 메모)는 새 기록을 시작하면 접는다.
    setAbsentSaved(null);
    setNoteSaved(null);
    try {
      const envelope = await postCoach(
        oppId,
        { memo, method: sendMethod, attemptedAt: todayKst() },
        staffKey,
      );
      setCoachResult(envelope.data);
    } catch (caught) {
      if (coachUnavailable(caught)) {
        setCoachBlocked(`${caught.body.message} ${quickRecordTexts.fallbackHint}`);
        if (as) moveNoteToContact(as);
      } else {
        const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
        setCoachError(`${coachTexts.failed} (${detail})`);
      }
    } finally {
      setCoachSending(false);
    }
  }

  /**
   * #985 "부재" 낱말만 적었을 때의 [저장]: 영업 코치(AI)를 부르지 않고 부재 접촉을 바로 남긴다.
   * 본문은 직접 고르는 양식에서 결과 "부재"를 저장할 때와 같다: 오늘 날짜, "누가 먼저 연락했나"는 기본 보기.
   */
  async function onSaveAbsent(restore?: boolean) {
    const memo = memoLine.trim();
    if (!method || !isAbsentMemo(method, memo)) return;
    if (excluded && restore === undefined) {
      setPendingAbsent(true);
      setAskExcluded(true);
      return;
    }
    setAbsentSaved(null);
    const today = todayKst();
    const status: OutcomeStatus = currentStatus ?? 'NOT_EXECUTED';
    const defaults = contactDefaults(questions);
    const answers = contactQuestions
      .filter((question) => defaults[question.questionId])
      .map((question) => ({
        questionId: question.questionId,
        answerId: defaults[question.questionId],
      }));
    const directionId = direction ? defaults[direction.questionId] : undefined;
    const directionLabel =
      direction && directionId
        ? (salesQuestionTexts.contactDirectionLabels[method]?.[directionId] ??
          direction.answers.find((option) => option.answerId === directionId)?.label)
        : null;
    const ok = await saveOutcome('contact', {
      status,
      method,
      result: 'ABSENT',
      attemptedAt: today,
      ...(answers.length > 0 ? { answers } : {}),
      memo,
      ...(endsSale(status) || pastSchedule(today) ? {} : keepSchedule()),
      ...(status === 'LOST' ? keepLostReason() : {}),
      ...(restore ? { restoreExcluded: true } : {}),
    });
    if (ok) {
      setAbsentSaved({
        method,
        line: [
          recordKindLabel(method),
          directionLabel,
          quickRecordTexts.absentResult[method],
          formatMonthDay(today) ?? today,
        ]
          .filter(Boolean)
          .join(' · '),
      });
      await afterContactSaved(method, false, [], []);
    }
  }

  /** #985 그 자리의 일정 칸이 "그 사이 다른 기록이 저장됐다"고 막혔을 때 [다시 읽기]: 상세와 활동 이력을 다시 읽는다. */
  function onQuickReload() {
    onSalesStepChanged?.();
    onRecorded?.();
  }

  /** #985 부재 저장 · 메모 저장 뒤 그 자리의 일정 칸에서 일정을 저장했을 때: 화면 값을 새 기록에 맞춘다. */
  function onQuickScheduleSaved(saved: OutcomeResponse) {
    const record: OutcomeRecord = {
      version: saved.version,
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
      status: saved.status,
      lostReasonCode:
        saved.status === 'LOST' ? (saved.lostReasonCode ?? outcome?.lostReasonCode ?? null) : null,
      nextScheduleAt: saved.nextScheduleAt ?? null,
      nextScheduleNote: saved.nextScheduleNote ?? null,
    };
    setOutcome(record);
    setScheduleAt(record.nextScheduleAt ?? '');
    setScheduleNote(record.nextScheduleNote ?? '');
    onOutcomeSaved?.(record);
    onRecorded?.();
    setAbsentSaved(null);
    succeed('contact', record.updatedAt);
  }

  /**
   * [이대로 저장](#742 → #985): 확인 화면에서 고른 그대로 기존 접촉 저장 창구를 부른다. 답마다 누가 채웠는지 싣는다.
   * 결과는 "연결됨"이다(영업 코치가 정리한 것은 상대와 이야기가 된 접촉이다). 날짜는 확인 화면의 값,
   * 건너뛴 질문은 고른 것에 없으므로 답을 싣지 않는다. 상대 반응 "기타" 한 줄은 메모 끝에 덧붙인다.
   */
  async function onCoachSave(selection: CoachSelection, restore?: boolean) {
    if (!coachMethod || !questions) return;
    const memo = `${coachMemo}${selection.memoAdd}`;
    // 확인 화면이 먼저 알리고 막는다. 그래도 넘어오면 서버 400을 기다리지 않고 보내지 않는다.
    if (memo.length > MEMO_LINE_MAX_LENGTH || findContact(memo)) return;
    if (excluded && restore === undefined) {
      setPendingCoach(selection);
      setAskExcluded(true);
      return;
    }
    const single = selection.single;
    const closingNow = closingPick(questions.questions, single);
    if (closingNow?.status === 'LOST' && closingNow.lostReasonCode === null) return;
    const contactIds = new Set(contactQuestions.map((question) => question.questionId));
    const defaults = contactDefaults(questions);
    const picks = [
      ...contactQuestions.map((question) => ({
        questionId: question.questionId,
        answerId: single[question.questionId] ?? defaults[question.questionId],
      })),
      ...questions.questions
        .filter((question) => !contactIds.has(question.questionId))
        .flatMap((question) =>
          question.choices
            ? (selection.many[question.questionId] ?? []).map((answerId) => ({
                questionId: question.questionId,
                answerId,
              }))
            : single[question.questionId]
              ? [{ questionId: question.questionId, answerId: single[question.questionId] }]
              : [],
        ),
    ].filter((answer) => Boolean(answer.answerId));
    const answers = picks.map((answer) => ({
      ...answer,
      filledBy: filledByOf(answer, selection.aiFilled),
    }));
    const contactedOn = selection.attemptedAt || todayKst();
    const status: OutcomeStatus = closingNow?.status ?? currentStatus ?? 'NOT_EXECUTED';
    const action = nextActionPick(questions, questions.questions, single);
    const planned =
      action && !closingNow && selection.nextDate >= todayKst() ? selection.nextDate : '';
    const ok = await saveOutcome('contact', {
      status,
      method: coachMethod,
      result: 'REACHED',
      attemptedAt: contactedOn,
      ...(answers.length > 0 ? { answers } : {}),
      ...(memo ? { memo } : {}),
      ...(action && planned !== ''
        ? { nextScheduleAt: planned, nextScheduleNote: action.label }
        : endsSale(status) || pastSchedule(contactedOn)
          ? {}
          : keepSchedule()),
      ...(closingNow?.lostReasonCode
        ? {
            lostReasonCode: closingNow.lostReasonCode,
            ...(closingNow.lostReasonCode === 'OTHER' ? { reason: memo } : {}),
          }
        : status === 'LOST'
          ? keepLostReason()
          : {}),
      ...(restore ? { restoreExcluded: true } : {}),
    });
    if (ok) {
      if (closingNow) setSavedLostReason(closingNow.lostReasonCode === 'OTHER' ? memo : '');
      const confirmed = questions.questions.some(
        (question) => question.choices && (selection.many[question.questionId] ?? []).length > 0,
      );
      await afterContactSaved(coachMethod, confirmed, selection.advice, selection.nextCall);
    }
  }

  /** [고치기](#742): AI 답이 골라진 채로 지금 양식을 연다. 저장할 때 AI 답 그대로인 것만 AI_CONFIRMED. */
  function onCoachEdit(selection: CoachSelection) {
    const contactIds = new Set(contactQuestions.map((question) => question.questionId));
    const formPicks: Record<string, string> = {};
    const contactNext: Record<string, string> = {};
    for (const [questionId, answerId] of Object.entries(selection.single)) {
      if (contactIds.has(questionId)) contactNext[questionId] = answerId;
      else formPicks[questionId] = answerId;
    }
    setPicked(formPicks);
    setContactPicks((previous) => ({ ...previous, ...contactNext }));
    setPickedMany(selection.many);
    setNextDate(selection.nextDate);
    setAiFilled(selection.aiFilled);
    setAdviceKeep(selection.advice);
    setNextCallKeep(selection.nextCall);
    setCoachResult(null);
    // #985: 처음 모습에 결과 · 날짜 칸이 없으므로 양식을 열 때 채운다. 영업 코치가 정리한 접촉은 "연결됨"이다.
    setResult('REACHED');
    setAttemptedAt(selection.attemptedAt || todayKst());
    // 종류 [메모]에서 보낸 것이면 고른 종류의 접촉 양식으로 옮긴다. 기타 한 줄은 들어갈 때만 메모에 덧붙인다.
    const memo = `${coachMemo}${selection.memoAdd}`;
    if (memoAs) moveNoteToContact(memoAs);
    if (memo.length <= MEMO_LINE_MAX_LENGTH) setMemoLine(memo);
    setCoachEditing(true);
  }

  /** #985 보내기 실패 뒤 [직접 고르기]: 적던 메모를 그대로 둔 채 직접 고르는 양식을 연다. */
  function onCoachDirect() {
    if (memoAs) moveNoteToContact(memoAs);
    setCoachError(null);
    setCoachEditing(true);
  }

  /** 제외한 회사에 저장할 때 "영업 대상으로 되돌릴까요?"의 답(#697). 코치 저장이 기다리고 있으면 그것을 저장한다. */
  function onExcludedAnswer(restore: boolean) {
    if (pendingCoach) void onCoachSave(pendingCoach, restore);
    else if (pendingAbsent) void onSaveAbsent(restore);
    else void onSaveContact(restore);
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
        noteTo?.startsWith(TEAM_PREFIX)
          ? {
              text,
              kind: 'HANDOFF',
              toTeam: noteTo.slice(TEAM_PREFIX.length),
              ...(evalId ? { evalId } : {}),
            }
          : noteTo
            ? { text, kind: 'HANDOFF', toStaffKey: noteTo, ...(evalId ? { evalId } : {}) }
            : { text, kind: noteKind, ...(evalId ? { evalId } : {}) },
        staffKey,
      );
      setNoteText('');
      // #985: 그냥 메모면 저장 바로 아래에 [일정 잡기] · [AI가 메모 읽기]를 잇는다(전달 사항에는 잇지 않는다).
      setNoteSaved(quick && !noteTo ? { noteId: envelope.data.noteId } : null);
      setAskMemoKind(false);
      if (noteTo) {
        setNoteTo(null);
        // 전달 사항은 상세 응답에 실려 확인사항 맨 위에 보이므로 상세를 다시 읽는다.
        onHandoffSent?.();
      }
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

  // #847(PM 결정 2026-11-17): 확정된 것(지금까지 들은 답 · 단계 고치기 · 다음 일정)은 왼쪽 보고서 쪽 영업 단계 아래로.
  // sideSlot이 있으면(넓은 화면의 오른쪽 영업 코치 칸) 그 자리로 옮겨 그리고, 없으면 전처럼 이 칸 안에 그린다.
  const confirmedSummary = (
    <SalesStepSummary
      step={salesStep}
      status={currentStatus}
      questions={questions}
      compact={inCoach}
    />
  );
  const stageFix = (
    <>
      {/* 영업 단계 칸은 기본으로 접어 둔다(#674, PM 지시 2026-11-13): 단계는 꼬리 질문 답으로 저절로 저장되고
          지금 단계는 상세 맨 위 진행 막대에 보인다. 잘못됐을 때만 이 한 줄에서 펼쳐 고친다(창 없음).
          큰 단계 고치기와 세부 단계 고치기(#607)가 같은 접힌 자리에 있다. */}
      <section aria-label={recordsArea.stageTitle} style={blockStyle}>
        <div style={rowStyle} data-testid="records-stage-fix">
          {/* #996: 영업 단계 칸 아래에서는 묻는 말 없이 작은 링크 하나로 보인다. */}
          {sideSlot ? null : <span style={hintStyle}>{recordsArea.stageFixAsk}</span>}
          <Button
            size="small"
            type={sideSlot ? 'link' : 'default'}
            style={sideSlot ? { padding: 0, height: 'auto' } : undefined}
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
    </>
  );
  // 다음 일정이 오늘보다 앞이면(지난 일정) 주의색으로 굵게 보인다(#972, 글자는 그대로).
  const nextScheduleDay = outcome?.nextScheduleAt?.slice(0, 10) ?? null;
  const scheduleOverdue = nextScheduleDay !== null && nextScheduleDay < todayKst();
  const scheduleFix = (
    <>
      {/* 다음 일정 칸도 접어 둔다(#683, PM 결정 2026-11-13): 일정은 꼬리 질문 "다음 할 일은?" 아래 날짜로
          접촉과 함께 잡는다. 통화 없이 일정만 바꿀 때 이 한 줄에서 펼친다(창 없음, 기능은 그대로). */}
      <section aria-label={recordsArea.scheduleTitle} style={blockStyle}>
        <div style={rowStyle} data-testid="records-schedule-fix">
          <span
            style={
              scheduleOverdue ? { ...hintStyle, color: warn.text, fontWeight: 600 } : hintStyle
            }
            data-overdue={scheduleOverdue ? 'true' : undefined}
            data-testid="records-schedule-current"
          >
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
                // 지난 날짜는 못 고른다(꼬리 질문 쪽과 같은 규칙, PM 세션 결정 2026-11-14 #740).
                min={todayKst()}
                disabled={disabled}
                label={recordsArea.scheduleDate}
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
    </>
  );

  // ---- #985 "종류 하나 + 메모" 흐름(영업 코치를 쓸 수 있을 때) ----
  const noteTrimmed = noteText.trim();
  // 종류 [메모]의 글을 영업 코치에게 보내면 접촉 메모가 되므로 접촉 메모 상한(더 짧다)을 넘으면 보낼 수 없다.
  const noteTooLong = noteTrimmed.length > MEMO_LINE_MAX_LENGTH;
  const dateErrorLine =
    coachMethod && dateError ? (
      <span role="alert" data-testid="records-contact-date-error" style={{ color: colors.error }}>
        {dateError}
      </span>
    ) : null;
  const coachSendingLine = coachSending ? (
    <span aria-live="polite" style={hintStyle}>
      {coachTexts.sending}
    </span>
  ) : null;
  // 그 밖의 실패(네트워크 등): 이유를 알리고 다시 보낼 수 있다. 계속 안 되면 [직접 고르기]로 지금 양식을 쓴다.
  const coachErrorLine = coachError ? (
    <>
      <span role="alert" data-testid="coach-error" style={{ color: colors.error }}>
        {coachError}
      </span>
      <Button
        disabled={disabled || coachSending}
        onClick={onCoachDirect}
        data-testid="coach-direct"
      >
        {coachTexts.direct}
      </Button>
    </>
  ) : null;
  const coachReview =
    coachResult && questions && coachMethod ? (
      <>
        <CoachReview
          questions={questions}
          result={coachResult}
          method={coachMethod}
          memo={coachMemo}
          memoMax={MEMO_LINE_MAX_LENGTH}
          asKind={memoAs ? recordKindLabel(memoAs) : null}
          disabled={disabled}
          saving={busy === 'contact'}
          onSave={(selection) => void onCoachSave(selection)}
          onEdit={onCoachEdit}
        />
        {blockMessage('contact')}
      </>
    ) : null;
  const quickPanel = method ? (
    <>
      {/* 영업 코치 칸(상세)에서는 바로 위 "확인사항" 묶음이 같은 것을 보여 주므로 이 한 줄은 그 밖에서만 보인다. */}
      {inCoach ? null : <CoachChecklist questions={questions} step={salesStep} />}
      <Input.TextArea
        aria-label={quickRecordTexts.memoLabel}
        aria-invalid={contactFound ? 'true' : undefined}
        placeholder={quickRecordTexts.memoPlaceholders[method]}
        value={memoLine}
        rows={3}
        autoSize={{ minRows: 3, maxRows: 6 }}
        maxLength={MEMO_LINE_MAX_LENGTH}
        onChange={(event) => setMemoLine(event.target.value)}
        // 정리를 받은 뒤에는 메모를 고정한다(받은 정리와 저장할 메모가 어긋나지 않게). 바꾸려면 [고치기].
        disabled={disabled || coachResult !== null || coachSending}
        style={contactFound ? { borderColor: warn.text } : undefined}
        data-testid="records-contact-memo"
      />
      <span style={hintStyle} data-testid="records-contact-memo-hint">
        {coachTexts.sendHint} {recordsArea.noteCounter(memoLine.length, MEMO_LINE_MAX_LENGTH)}
      </span>
      {contactFound ? <ContactAlert /> : null}
      {coachReview ?? (
        <>
          <RecordExamples kind={method} />
          <div style={{ ...rowStyle, justifyContent: 'flex-end' }}>
            {absentMemo ? (
              <span style={hintStyle} data-testid="quick-absent-hint">
                {quickRecordTexts.absentHint}
              </span>
            ) : null}
            {coachSendingLine}
            {coachErrorLine}
            {blockMessage('contact')}
            {absentMemo ? (
              // "부재" 낱말뿐이면 AI를 부르지 않는다: [보내기 유료] 대신 [저장](유료 표시 없음).
              <Button
                type="primary"
                disabled={disabled}
                loading={busy === 'contact'}
                onClick={() => void onSaveAbsent()}
                data-testid="quick-absent-save"
              >
                {quickRecordTexts.absentSave}
              </Button>
            ) : (
              <Button
                type="primary"
                disabled={disabled || coachMemo === '' || contactFound || questions === null}
                loading={coachSending}
                onClick={() => void onSendCoach()}
                data-testid="coach-send"
              >
                {coachTexts.send} <PaidTag onPrimary />
              </Button>
            )}
          </div>
        </>
      )}
      {dateErrorLine}
      {absentSaved ? (
        <AbsentSavedBox
          oppId={oppId}
          method={absentSaved.method}
          line={absentSaved.line}
          currentScheduleAt={outcome?.nextScheduleAt ?? null}
          currentScheduleNote={outcome?.nextScheduleNote ?? null}
          onScheduleSaved={onQuickScheduleSaved}
          onReload={onQuickReload}
          onClose={() => setAbsentSaved(null)}
        />
      ) : null}
    </>
  ) : (
    <>
      <Input.TextArea
        aria-label={recordsArea.noteLabel}
        placeholder={quickRecordTexts.memoPlaceholders.MEMO}
        value={noteText}
        rows={2}
        autoSize={{ minRows: 2, maxRows: 6 }}
        maxLength={noteMax}
        onChange={(event) => setNoteText(event.target.value)}
        disabled={disabled || coachResult !== null || coachSending}
        data-testid="records-note-input"
      />
      <span style={hintStyle} data-testid="records-note-hint">
        {inCoach ? (
          coachTexts.noteHint
        ) : (
          <>
            {memoReadTexts.noteHintAi} {memoReadTexts.nameHintAi}
          </>
        )}{' '}
        <span data-testid="records-note-counter">
          {recordsArea.noteCounter(noteText.length, noteMax)}
        </span>
      </span>
      <span style={hintStyle} data-testid="quick-note-guide">
        {quickRecordTexts.noteGuide}
      </span>
      {coachReview ?? (
        <>
          <RecordExamples kind="MEMO" />
          <div style={rowStyle}>
            {/* #847: 받는 사람을 고르면 전달 사항(받는 사람이 [확인했어요])으로 남는다. */}
            {noteTargets.length > 0 ? (
              <NativeSelect
                label={handoffTexts.toLabel}
                placeholder={recordsArea.noteToNone}
                value={noteTo}
                options={noteTargets.map((entry) => ({
                  value: entry.key,
                  label: entry.displayName,
                }))}
                onChange={(value) => {
                  setNoteTo(value);
                  if (value) setAskMemoKind(false);
                }}
                disabled={disabled}
                testId="records-note-to"
              />
            ) : null}
            {/* 메모로만 저장: 전과 같은 메모 저장(AI 없음). 받는 사람이 있으면 전달 사항. */}
            <Button
              disabled={disabled || noteTrimmed === '' || coachSending}
              loading={busy === 'note'}
              onClick={() => void onSaveNote()}
              data-testid="records-note-save-button"
            >
              {noteTo ? handoffTexts.send : quickRecordTexts.noteOnly}
            </Button>
            {/* 영업 코치에게 보내기: 통화 · 메일 · 대면을 한 번 고르면 접촉 기록으로 정리한다(/notes로는 저장하지 않는다). */}
            <Button
              type="primary"
              disabled={
                disabled ||
                noteTrimmed === '' ||
                noteTo !== null ||
                noteTooLong ||
                contactFound ||
                questions === null ||
                coachSending
              }
              onClick={() => {
                setAskMemoKind(true);
                setNoteSaved(null);
              }}
              data-testid="quick-note-coach"
            >
              {quickRecordTexts.noteToCoach} <PaidTag onPrimary />
            </Button>
          </div>
          {noteTo ? (
            <span style={hintStyle} data-testid="quick-note-to-blocked">
              {quickRecordTexts.noteToBlocked}
            </span>
          ) : null}
          {!noteTo && noteTooLong ? (
            <span style={hintStyle} data-testid="quick-note-too-long">
              {quickRecordTexts.noteTooLong(MEMO_LINE_MAX_LENGTH, noteTrimmed.length)}
            </span>
          ) : null}
          {!noteTo && contactFound ? (
            <span
              role="alert"
              data-testid="quick-note-contact-blocked"
              style={{ color: warn.text, fontSize: typography.fontSizeSecondary }}
            >
              {quickRecordTexts.memoContactBlocked}
            </span>
          ) : null}
          {askMemoKind && !noteTo && noteTrimmed !== '' && !noteTooLong && !contactFound ? (
            <MemoKindAsk
              value={memoAs}
              disabled={disabled || coachSending || questions === null}
              onPick={(picked) => {
                setMemoAs(picked);
                void onSendCoach(picked);
              }}
            />
          ) : null}
          <div style={rowStyle}>
            {coachSendingLine}
            {coachErrorLine}
            {blockMessage('note')}
            {blockMessage('contact')}
          </div>
        </>
      )}
      {dateErrorLine}
      {noteSaved ? (
        <NoteSavedBox
          oppId={oppId}
          currentScheduleAt={outcome?.nextScheduleAt ?? null}
          currentScheduleNote={outcome?.nextScheduleNote ?? null}
          onScheduleSaved={onQuickScheduleSaved}
          onReload={onQuickReload}
          onClose={() => setNoteSaved(null)}
          disabled={!canRecord}
        >
          {/* 방금 저장한 메모 아래에만 보인다(#720). 누르기 전에는 AI를 부르지 않는다. */}
          <MemoRead
            key={noteSaved.noteId}
            oppId={oppId}
            target={{ recordKind: 'NOTE', recordId: noteSaved.noteId }}
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
        </NoteSavedBox>
      ) : null}
    </>
  );

  return (
    <div data-testid="records-area" style={{ display: 'grid', gap: 24 }}>
      {!canRecord ? (
        <Typography.Text type="secondary" data-testid="records-pick-staff-text">
          {recordsArea.pickStaffFirst}
        </Typography.Text>
      ) : null}

      {/* #847: 영업 코치 칸에서는 위 "② 통화 뒤 — 기록 남기기" 제목이 같은 말을 해서 안내 줄을 뺀다. */}
      {inCoach ? null : (
        <Typography.Text type="secondary" data-testid="records-flow-guide">
          {recordsArea.flowGuide}
        </Typography.Text>
      )}

      {sideSlot ? null : confirmedSummary}

      <section aria-labelledby={`records-entry-${oppId}`} style={blockStyle}>
        {/* #847: 영업 코치 칸에서는 "② 통화 뒤 — 기록 남기기"와 겹쳐 화면에서 숨긴다(읽어 주는 도구에는 남김). */}
        <Typography.Title
          level={3}
          id={`records-entry-${oppId}`}
          style={inCoach ? screenReaderOnly : { margin: 0 }}
        >
          {recordsArea.entryTitle}
        </Typography.Title>
        <div style={rowStyle}>
          {/* #972 새 시안: 종류는 고르기 상자 대신 선택 단추(통화 · 메일 · 대면 · 메모). 고르는 값과 저장은 그대로다. */}
          <ChoiceChips
            label={recordsArea.entryKind}
            value={recordKind}
            options={RECORD_KIND_ORDER.map((kind) => ({
              value: kind,
              label: recordKindLabel(kind),
            }))}
            onChange={(value) => {
              setRecordKind(value as RecordKind);
              clearCoach();
              // #985: 종류를 바꾸면 앞 종류의 저장 뒤 상자(부재 · 메모)는 접는다.
              setAbsentSaved(null);
              setNoteSaved(null);
            }}
            disabled={disabled}
            testId="records-kind"
            focusId={recordsEntryInputId(oppId)}
          />
          {!quick && method && direction ? (
            // #985: 영업 코치를 쓸 수 있으면 발신/수신 · 결과 · 날짜 칸은 처음 모습에 없다(확인 화면에서 본다).
            // #853(PM 결정 2026-11-17): "누가 먼저 연락했나요?"는 종류 옆 단추 두 개(발신 | 수신, 대면은 외근 | 내방).
            // 기본 "발신"이 골라져 있어 보통은 누르지 않는다. 메모면 보이지 않는다.
            // #972: 고른 단추는 강조 연한 바탕 + 강조 테두리 + 굵은 강조 글자(#947의 "강조색으로 채움"을 대신한다).
            <ChoiceChips
              label={direction.text}
              value={contactAnswers[direction.questionId] ?? directionDefault ?? null}
              disabled={disabled}
              onChange={(value) =>
                setContactPicks((previous) => ({
                  ...previous,
                  [direction.questionId]: value,
                }))
              }
              options={direction.answers.map((option) => ({
                value: option.answerId,
                label:
                  salesQuestionTexts.contactDirectionLabels[method]?.[option.answerId] ??
                  option.label,
              }))}
              testId="records-direction"
            />
          ) : null}
          {!quick && method ? (
            <>
              {/* 누가 먼저 연락했나(#691): 기본 "우리가"가 골라져 있어 대부분 누를 필요가 없다. 방문은 "우리가 감 / 상대가 옴". */}
              {contactQuestions.slice(direction ? 1 : 0).map((question) => (
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
              {/* #972 새 시안: 결과도 선택 단추(연결됨 · 부재 · 거절). 처음에는 아무것도 골라져 있지 않다. */}
              <ChoiceChips
                label={recordsArea.contactResult}
                value={result}
                options={options(contactResultLabels)}
                onChange={(value) => onResultChange(value as ContactResult)}
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
            </>
          ) : null}
        </div>
        {/* #985: 영업 코치를 지금 쓸 수 없을 때의 안내 한 줄. 아래에 직접 고르는 양식이 그대로 나온다. */}
        {coachBlocked ? (
          <div
            role="status"
            data-testid="coach-blocked"
            style={{
              padding: '10px 12px',
              border: `1px solid ${colors.borderSecondary}`,
              borderRadius: radius.control,
              background: colors.bgLayout,
              color: colors.textSecondary,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {coachBlocked}
          </div>
        ) : null}
        {quick ? (
          quickPanel
        ) : (
          <>
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
                <span style={hintStyle} data-testid="records-note-hint">
                  {inCoach && aiReadsMemo ? (
                    // #847: 영업 코치 칸에서는 메모 안내도 한 줄로.
                    coachTexts.noteHint
                  ) : (
                    <>
                      {aiReadsMemo ? memoReadTexts.noteHintAi : recordsArea.noteHint}{' '}
                      {aiReadsMemo ? memoReadTexts.nameHintAi : memoReadTexts.nameHint}
                    </>
                  )}{' '}
                  <span data-testid="records-note-counter">
                    {recordsArea.noteCounter(noteText.length, noteMax)}
                  </span>
                </span>
                <div style={rowStyle}>
                  {/* #847: 받는 사람을 고르면 전달 사항(받는 사람이 [확인했어요])으로 남는다. */}
                  {noteTargets.length > 0 ? (
                    <NativeSelect
                      label={handoffTexts.toLabel}
                      placeholder={recordsArea.noteToNone}
                      value={noteTo}
                      options={noteTargets.map((entry) => ({
                        value: entry.key,
                        label: entry.displayName,
                      }))}
                      onChange={setNoteTo}
                      disabled={disabled}
                      testId="records-note-to"
                    />
                  ) : null}
                  <Button
                    type="primary"
                    disabled={disabled || noteText.trim() === ''}
                    loading={busy === 'note'}
                    onClick={() => void onSaveNote()}
                    data-testid="records-note-save-button"
                  >
                    {noteTo ? handoffTexts.send : recordsArea.noteSave}
                  </Button>
                </div>
              </>
            )}
            {declineMode ? (
              <div data-testid="records-decline" style={{ display: 'grid', gap: 4 }}>
                <div id={`records-decline-label-${oppId}`}>{salesQuestionTexts.declineAsk}</div>
                <ChoiceChips
                  labelledBy={`records-decline-label-${oppId}`}
                  value={declineChoice}
                  disabled={disabled}
                  onChange={onDeclineChoice}
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
            {/* #847: 영업 코치 칸에서는 결과를 고르기 전에도 메모 칸이 보인다(전에는 결과를 골라야 나타났다). */}
            {method && (result || inCoach) ? (
              <>
                <Input
                  aria-label={inCoach ? coachTexts.memoLabel : salesQuestionTexts.memoLabel}
                  placeholder={inCoach ? coachTexts.memoPlaceholder : salesQuestionTexts.memoLabel}
                  value={memoLine}
                  maxLength={MEMO_LINE_MAX_LENGTH}
                  onChange={(event) => setMemoLine(event.target.value)}
                  // 정리를 받은 뒤에는 메모를 고정한다(받은 정리와 저장할 메모가 어긋나지 않게). 바꾸려면 [고치기].
                  disabled={disabled || coachResult !== null || coachSending}
                  data-testid="records-contact-memo"
                />
                <span style={hintStyle} data-testid="records-contact-memo-hint">
                  {inCoach && aiReadsMemo ? (
                    // #847: 코치 메모 안내는 한 줄(직함으로 적기 · 이름·전화는 지운 뒤 AI로).
                    coachTexts.sendHint
                  ) : (
                    <>
                      {aiReadsMemo ? memoReadTexts.memoLineHintAi : salesQuestionTexts.memoHint}{' '}
                      {aiReadsMemo ? memoReadTexts.nameHintAi : memoReadTexts.nameHint}
                    </>
                  )}{' '}
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
              <span
                role="alert"
                data-testid="records-next-date-error"
                style={{ color: colors.error }}
              >
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
          </>
        )}
        {/* 제외한 회사에 접촉을 남기려 할 때만: 창 없이 이 자리에서 한 번 묻는다(#697). */}
        {coachMethod && excluded && askExcluded ? (
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
              onClick={() => onExcludedAnswer(true)}
              data-testid="records-excluded-restore-button"
            >
              {recordsArea.excludedRestoreSave}
            </Button>
            <Button
              disabled={disabled}
              onClick={() => onExcludedAnswer(false)}
              data-testid="records-excluded-keep-button"
            >
              {recordsArea.excludedKeepSave}
            </Button>
          </div>
        ) : null}
      </section>

      {sideSlot ? null : stageFix}
      {sideSlot ? null : scheduleFix}
      {sideSlot
        ? createPortal(
            // #996(PM 결정 2026-11-29): 영업 단계 칸 아래 한 줄 — "▸ 지금까지 들은 답 n개" · "단계 고치기"(작은 링크 모양).
            // 누르면 그 자리에서 펼쳐진다(동작은 그대로). [일정만 바꾸기]는 이 칸에서 뺐다.
            <div
              data-testid="records-side"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: '6px 14px',
                fontSize: typography.fontSizeSecondary,
              }}
            >
              {/* 들은 답이 없으면 아무것도 그리지 않으므로, 빈 칸이 틈을 만들지 않게 상자 없이(contents) 둔다. */}
              <div
                data-testid="records-side-known"
                style={{ display: 'contents', color: accent.text }}
              >
                {confirmedSummary}
              </div>
              <div data-testid="records-side-stage" style={{ minWidth: 0 }}>
                {stageFix}
              </div>
            </div>,
            sideSlot,
          )
        : null}
    </div>
  );
}
