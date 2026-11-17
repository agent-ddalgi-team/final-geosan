// 활동 이력 타임라인(U5, 기록 영역 아래): GET /activity를 최근 순으로 한 줄씩.
// 줄마다 시각 · 작성자 · 종류 · 내용. 예: "11/06 14:20 박 이사 전화 · 부재 '담당자 외근'". 읽기 전용이다.
// 종류는 뜻이 같은 3묶음(영업 활동·사실·의견)끼리 같은 색 태그로 보이고, 위의 단추로 한 묶음만 본다(#389).
// 기업이 바뀌면 부르는 쪽이 key로 새로 만든다. 다시 불러오는 동안에는 이전 줄을 그대로 둔다.
// 내 기록 줄에는 [잘못 입력]이 붙는다(#254, 2026-11-12): 누르면 줄 아래에 확인 한 줄이 열리고(모달 없음, 이유 200자 선택),
// [표시]를 누르면 서버가 그 줄에 취소 표시만 남긴다(지우지 않음). 취소된 줄은 줄이 그어지고 "취소 · 박 이사 · 11/06"이 붙는다.
// 남의 기록·이미 취소된 줄·취소 줄 자체에는 단추가 없다(설정으로 허용하면 남의 기록에도 보임). 취소하면 단계·횟수가 바뀌므로 부르는 쪽에 알린다.
// #849(PM 결정 2026-11-17): 흐름 줄(단계·다음 일정이 바뀐 때만) · 접촉 카드 · AI 피드백(같은 묶음 접촉 카드 안에 접힘) 3층.
// 날짜 구분선, 거르기 6개(전체·흐름·접촉·메모·AI 피드백·확인한 사실·의견), [잘못 입력]은 ··· 메뉴 안으로. 저장은 그대로다.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Input } from 'antd';
import { ApiError, getActivity, getSalesQuestions, postRecordCancel } from '../../api/client';
import type { ActivityItem } from '../../api/types';
import {
  activityKindLabels,
  contactMethodLabels,
  contactResultLabels,
  errorTexts,
  labelFor,
  lostReasonLabels,
  opinionLabels,
  outcomeStatusLabels,
  salesQuestionTexts,
  timelineArea,
  timelineLayers,
} from '../../labels/ko';
import { colors, detailTheme, typography } from '../../theme/tokens';
import StatusTag from '../common/StatusTag';
import { activityGroupTone, groupOf } from './activityGroups';
import {
  TIMELINE_LAYERS,
  adviceText,
  arrangeBlock,
  displayBlocks,
  displayDay,
  flowChanges,
  inLayer,
  isStructuredAdvice,
  isStructuredOutcome,
  kstDay,
} from './activityLayers';
import type { FlowChange, TimelineLayer } from './activityLayers';
import { formatMonthDay, formatMonthDayTime, todayKst } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';
import { contactQuestionsOf } from './SalesQuestions';

export interface ActivityTimelineProps {
  oppId: string;
  /** 값이 바뀌면 다시 불러온다(기록을 저장한 뒤 새 줄이 보이게). */
  refreshKey?: number;
  /** 기록을 잘못 입력으로 표시한 직후 알린다(현재 단계·횟수가 되돌아가므로 상세를 다시 불러오게). */
  onCancelled?: () => void;
}

/** 줄 하나를 가리키는 값. 같은 저장 행이 여러 줄이어도 시각까지 합쳐 구분한다. */
function lineKey(item: ActivityItem): string {
  return `${item.at}|${item.recordId ?? ''}`;
}

/**
 * 줄의 내용. 검토 의견 줄은 서버가 의견 코드("NEED_CHECK")를 그대로 주므로 쉬운 말("검토 중")로 바꾼다(#691).
 * 대응표에 없는 값이면 받은 글 그대로 보인다.
 */
export function summaryText(item: ActivityItem): string {
  if (item.kind === 'OPINION' && item.summary in opinionLabels) {
    return labelFor(opinionLabels, item.summary);
  }
  // #849: 꼬리표와 같은 말이 글 앞에 또 붙어 오면 뺀다. 예: [남긴 피드백] "남긴 피드백 · …" → "…".
  const tag = `${labelFor(activityKindLabels, item.kind)} · `;
  return item.summary.startsWith(tag) ? item.summary.slice(tag.length) : item.summary;
}

/** #849 날짜 구분선. 예: "11월 17일 (화) · 오늘". */
export function dateLabel(iso: string, now: Date = new Date()): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : kstDay(iso);
  if (!day) return '';
  const [year, month, date] = day.split('-').map(Number);
  const weekday = timelineLayers.weekdays[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  const today = todayKst(now);
  const yesterday = todayKst(new Date(now.getTime() - 86_400_000));
  const relative =
    day === today ? timelineLayers.today : day === yesterday ? timelineLayers.yesterday : null;
  return timelineLayers.dateLine(month, date, weekday, relative);
}

/** #849 흐름 줄 글. 예: "접촉 → 견적·샘플 · 다음 일정 11/18 방문", 거절이면 "접촉 → 거절 · 가격". */
export function flowText(item: ActivityItem, change: FlowChange | undefined): string {
  const statusLabel = (status: string) => labelFor(outcomeStatusLabels, status);
  let to = statusLabel(change?.to ?? item.status ?? '');
  if (item.status === 'LOST' && item.lostReasonCode) {
    to += ` · ${labelFor(lostReasonLabels, item.lostReasonCode)}`;
  }
  const scheduleAt = change ? change.schedule : (item.nextScheduleAt ?? null);
  const note = change ? change.scheduleNote : (item.nextScheduleNote ?? null);
  const schedule = scheduleAt
    ? [formatMonthDay(scheduleAt), note?.trim()].filter(Boolean).join(' ')
    : null;
  return timelineLayers.flowLine(change?.from ? statusLabel(change.from) : null, to, schedule);
}

/** #803: 처음에 보이는 묶음 수. 나머지는 [더 보기 n건]으로 편다. */
export const TIMELINE_SHOWN = 5;

/** #803 세로 타임라인 점 안 그림: 전화 📞 · 방문 🚶 · 메일 ✉ · 메모 📝 · 의견·관심 ⭐ · 단계 📈 · 그 밖 •. */
export function timelineIcon(item: ActivityItem): string {
  if (item.kind === 'CONTACT_ATTEMPT') {
    if (item.method === 'VISIT') return '🚶';
    if (item.method === 'EMAIL') return '✉';
    if (item.method === 'CALL') return '📞';
    if (item.summary.includes('방문')) return '🚶';
    if (item.summary.includes('메일')) return '✉';
    return '📞';
  }
  if (item.kind === 'NOTE' || item.kind === 'REPLY') return '📝';
  if (item.kind === 'OPINION' || item.kind === 'BOOKMARK') return '⭐';
  if (item.kind === 'OUTCOME') return '📈';
  if (item.kind === 'ADVICE') return '💬';
  return '•';
}

/**
 * #803: 같은 시각(분까지)·같은 사람의 줄을 한 묶음으로. 접촉을 저장하면 "접촉 시도"와 "영업 단계" 줄이 같은 시각에
 * 둘 생겨 쌍으로 보였다. 줄 하나하나(잘못 입력 단추 포함)는 그대로 두고 시각·사람만 한 번 보인다.
 */
export function groupSameMoment(items: ActivityItem[]): ActivityItem[][] {
  const blocks: ActivityItem[][] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    const head = last?.[0];
    if (
      head &&
      head.actor === item.actor &&
      formatMonthDayTime(head.at) !== null &&
      formatMonthDayTime(head.at) === formatMonthDayTime(item.at)
    ) {
      last.push(item);
    } else {
      blocks.push([item]);
    }
  }
  return blocks;
}

/** 최근 순(시각이 늦은 것이 위). 같은 시각이면 서버가 준 순서를 뒤집어 늦게 쌓인 것이 위로 온다. */
export function sortRecentFirst(items: ActivityItem[]): ActivityItem[] {
  return items
    .map((item, index) => ({ item, index, time: Date.parse(item.at) }))
    .sort((a, b) => {
      const ta = Number.isNaN(a.time) ? -Infinity : a.time;
      const tb = Number.isNaN(b.time) ? -Infinity : b.time;
      return tb - ta || b.index - a.index;
    })
    .map((entry) => entry.item);
}

const groupButtonStyle = (selected: boolean) =>
  ({
    minHeight: 32,
    padding: '0 12px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : colors.border}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : colors.text,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    fontWeight: selected ? 700 : 400,
    cursor: 'pointer',
  }) as const;

export default function ActivityTimeline({
  oppId,
  refreshKey = 0,
  onCancelled,
}: ActivityTimelineProps) {
  const { config, staffKey, canRecord } = useFrame();
  const [retry, setRetry] = useState(0);
  // [잘못 입력] 확인 한 줄: 한 번에 한 줄만 연다.
  const [cancelingKey, setCancelingKey] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<{ key: string; text: string } | null>(null);
  /** #849 ··· 메뉴: 한 번에 한 줄만 연다. */
  const [menuKey, setMenuKey] = useState<string | null>(null);
  /** #849 접촉 카드 안 접힌 AI 피드백을 편 카드. */
  const [openAi, setOpenAi] = useState<Set<string>>(() => new Set());
  /** 고른 층. null이면 전체. 기업이 바뀌면 부르는 쪽이 key로 새로 만들어 전체로 돌아간다. */
  const [layer, setLayer] = useState<TimelineLayer | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * #849(PM 결정 2026-11-17): "먼저 연락한 쪽" 칩은 기록 칸(#847)과 같은 말("수신"·"내방")을 쓴다.
   * 서버는 보기 이름("상대가")을 주므로 질문 파일에서 그 이름의 보기 코드를 찾아 대응표 값을 쓴다.
   * 질문 파일을 못 받으면 서버가 준 이름으로 "상대가 먼저"를 보인다.
   */
  const [directionIds, setDirectionIds] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let alive = true;
    getSalesQuestions()
      .then((envelope) => {
        const direction = contactQuestionsOf(envelope.data)[0];
        if (!alive || !direction) return;
        setDirectionIds(
          new Map(direction.answers.map((option) => [option.label, option.answerId])),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getActivity(oppId, 50, controller.signal)
      .then((envelope) => {
        setItems(sortRecentFirst(envelope.data));
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [oppId, refreshKey, retry]);

  function actorName(actor: string): string {
    if (actor === 'system') return timelineArea.system;
    return config?.staff.find((entry) => entry.key === actor)?.displayName ?? actor;
  }

  /**
   * 내 기록(설정이 허용하면 모든 기록)이고 아직 취소되지 않은 저장 행 줄에만 단추를 둔다.
   * 프로그램이 남긴 변경 기록(#731)은 서버가 번호를 주지 않지만, 실려 와도 단추를 두지 않는다.
   */
  function canCancel(item: ActivityItem): boolean {
    if (!item.recordId || item.cancelled) return false;
    if (item.kind === 'RECORD_CANCELLED' || item.kind === 'CHANGE') return false;
    if (!canRecord || !staffKey) return false;
    return item.actor === staffKey || config?.records?.cancelByAnyStaff === true;
  }

  function openCancel(item: ActivityItem) {
    setCancelingKey(lineKey(item));
    setMenuKey(null);
    setReason('');
    setCancelError(null);
  }

  function closeCancel() {
    setCancelingKey(null);
    setReason('');
    setCancelError(null);
  }

  async function confirmCancel(item: ActivityItem) {
    if (!staffKey || !item.recordId) return;
    const key = lineKey(item);
    const text = reason.trim();
    setCancelBusy(true);
    setCancelError(null);
    try {
      await postRecordCancel(oppId, item.recordId, text === '' ? {} : { reason: text }, staffKey);
      closeCancel();
      setRetry((n) => n + 1);
      onCancelled?.();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setCancelError({ key, text: `${timelineArea.cancelFailed} (${detail})` });
    } finally {
      setCancelBusy(false);
    }
  }

  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;
  const struck = { textDecoration: 'line-through', color: colors.textSecondary } as const;

  const changes = flowChanges(items ?? []);
  const visible = items === null ? null : items.filter((item) => inLayer(item, layer, changes));
  // #803: 같은 시각 줄을 묶고, 처음에는 최근 5묶음만 보인다.
  // #849: 접촉 줄은 실제 접촉한 날 아래로, AI 피드백은 저장 묶음대로 접촉 카드 안에(카드를 따라간다).
  const { blocks, nested: nestedAdvice } = displayBlocks(visible ?? [], groupSameMoment);
  const shownBlocks = showAll ? blocks : blocks.slice(0, TIMELINE_SHOWN);
  const hiddenBlocks = blocks.length - shownBlocks.length;
  const hiddenItems = blocks.slice(TIMELINE_SHOWN).reduce((sum, block) => sum + block.length, 0);
  const itemIndex = new Map((visible ?? []).map((item, index) => [item, index]));
  // #849 날짜 구분선: 보이는 묶음을 한국 날짜별로 나눈다(최근 날짜가 위).
  const days: { day: string; blocks: ActivityItem[][] }[] = [];
  for (const block of shownBlocks) {
    const day = displayDay(block[0]) ?? '';
    const last = days[days.length - 1];
    if (last && last.day === day) last.blocks.push(block);
    else days.push({ day, blocks: [block] });
  }
  const layerChoices: { value: TimelineLayer | null; label: string }[] = [
    { value: null, label: timelineArea.groupAll },
    ...TIMELINE_LAYERS.map((value) => ({ value, label: timelineLayers.filters[value] })),
  ];

  /** ··· 메뉴와 그 안의 [잘못 입력]. 확인 한 줄이 열려 있으면 메뉴는 숨는다. */
  function menu(item: ActivityItem): ReactNode {
    const key = lineKey(item);
    if (!canCancel(item) || cancelingKey === key) return null;
    const open = menuKey === key;
    // 다음 통화 준비는 꼬리표("남긴 피드백")와 앞머리가 달라 summaryText로는 안 빠진다 → 앞머리 없는 글.
    const label = isStructuredAdvice(item) ? adviceText(item) : summaryText(item);
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
        <button
          type="button"
          aria-label={timelineLayers.menuLabel(label)}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setMenuKey(open ? null : key)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuKey(null);
          }}
          data-testid="timeline-menu-open"
          style={{
            border: 'none',
            background: 'transparent',
            color: colors.textSecondary,
            cursor: 'pointer',
            font: 'inherit',
            padding: '0 4px',
            minHeight: 24,
          }}
        >
          {timelineLayers.menuButton}
        </button>
        {open ? (
          <Button
            size="small"
            onClick={() => openCancel(item)}
            aria-label={timelineArea.cancelButtonLabel(label)}
            data-testid="timeline-cancel-open"
          >
            {timelineArea.cancelButton}
          </Button>
        ) : null}
      </span>
    );
  }

  /** 줄 아래에 열리는 확인 한 줄과 오류(모달 없음, #254). */
  function cancelArea(item: ActivityItem, index: number): ReactNode {
    const key = lineKey(item);
    const cancelOpen = cancelingKey === key && canCancel(item);
    return (
      <>
        {cancelOpen ? (
          <div
            data-testid="timeline-cancel-form"
            style={{
              flexBasis: '100%',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <label htmlFor={`cancel-reason-${index}`} style={secondary}>
              {timelineArea.cancelPrompt}
            </label>
            <Input
              id={`cancel-reason-${index}`}
              value={reason}
              maxLength={timelineArea.cancelReasonMaxLength}
              aria-label={timelineArea.cancelReasonLabel}
              onChange={(event) => setReason(event.target.value)}
              disabled={cancelBusy}
              style={{ maxWidth: 320 }}
              data-testid="timeline-cancel-reason"
            />
            <Button
              size="small"
              type="primary"
              loading={cancelBusy}
              onClick={() => void confirmCancel(item)}
              data-testid="timeline-cancel-confirm"
            >
              {timelineArea.cancelConfirm}
            </Button>
            <Button
              size="small"
              onClick={closeCancel}
              disabled={cancelBusy}
              data-testid="timeline-cancel-close"
            >
              {timelineArea.cancelClose}
            </Button>
          </div>
        ) : null}
        {cancelError?.key === key ? (
          <div
            role="alert"
            data-testid="timeline-cancel-error"
            style={{ flexBasis: '100%', color: colors.error }}
          >
            {cancelError.text}
          </div>
        ) : null}
      </>
    );
  }

  function cancelledNote(item: ActivityItem): ReactNode {
    if (item.cancelled !== true) return null;
    return (
      <span data-testid="timeline-cancelled-note" style={secondary}>
        {timelineArea.cancelledNote(
          item.cancelledBy ? actorName(item.cancelledBy) : '',
          formatMonthDayTime(item.cancelledAt)?.slice(0, 5) ?? '',
        )}
      </span>
    );
  }

  /** AI 피드백 한 줄(카드 안이든 따로든): 💬 꼬리표 + 앞머리 없는 글. */
  function adviceLine(item: ActivityItem, testId: string, index: number): ReactNode {
    return (
      <div key={lineKey(item)} data-testid={testId} style={{ display: 'grid', gap: 2 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <StatusTag tone="ask" data-testid="timeline-kind">
            {`💬 ${item.noteKind === 'CALL_PREP' ? timelineLayers.callPrepTag : timelineLayers.aiTag}`}
          </StatusTag>
          <span data-testid="timeline-summary" style={item.cancelled === true ? struck : undefined}>
            {adviceText(item)}
          </span>
          {cancelledNote(item)}
          {menu(item)}
        </div>
        {cancelArea(item, index)}
      </div>
    );
  }

  /** 먼저 연락한 쪽 칩. 우리가 먼저(기본 보기)면 서버가 비워 보내 칩이 없다. */
  function firstMoverChip(item: ActivityItem): string | null {
    if (!item.firstMover) return null;
    const answerId = directionIds?.get(item.firstMover);
    const label = answerId
      ? salesQuestionTexts.contactDirectionLabels[item.method ?? '']?.[answerId]
      : undefined;
    return label ?? timelineLayers.firstMoverChip(item.firstMover, item.method === 'VISIT');
  }

  /** 영업 기록 줄: 흐름 줄(바뀐 때만, 접촉 없는 단계 기록은 늘) + 접촉 카드(흐름만 볼 때는 숨김). */
  function outcomeLine(item: ActivityItem, nested: ActivityItem[], index: number): ReactNode {
    const change = changes.get(item);
    const contact = item.method != null;
    const showFlow = change !== undefined || !contact;
    const showCard = contact && layer !== 'FLOW';
    const key = lineKey(item);
    const aiOpen = openAi.has(key);
    const chip = firstMoverChip(item);
    return (
      <>
        {showFlow ? (
          <div
            data-testid="timeline-flow"
            aria-label={timelineLayers.flowLabel}
            style={{
              ...secondary,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
              ...(item.cancelled === true && !contact ? struck : {}),
            }}
          >
            <span aria-hidden="true">📈</span>
            <span>{flowText(item, change)}</span>
            {!contact ? cancelledNote(item) : null}
            {!contact ? menu(item) : null}
          </div>
        ) : null}
        {showCard ? (
          <div
            data-testid="timeline-card"
            style={{
              border: `1px solid ${colors.borderSecondary}`,
              borderRadius: 8,
              padding: '6px 10px',
              background: colors.bgContainer,
              display: 'grid',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <strong
                data-testid="timeline-card-title"
                style={item.cancelled === true ? struck : undefined}
              >
                {timelineLayers.contactTitle(
                  labelFor(contactMethodLabels, item.method ?? ''),
                  item.result ? labelFor(contactResultLabels, item.result) : null,
                )}
              </strong>
              {chip ? (
                <StatusTag tone="neutral" data-testid="timeline-chip">
                  {chip}
                </StatusTag>
              ) : null}
              {cancelledNote(item)}
              {menu(item)}
            </div>
            {item.memo ? (
              <div data-testid="timeline-card-memo" style={{ whiteSpace: 'pre-wrap' }}>
                {item.memo}
              </div>
            ) : null}
            {nested.length > 0 ? (
              <div style={{ display: 'grid', gap: 4 }}>
                <button
                  type="button"
                  aria-expanded={aiOpen}
                  onClick={() =>
                    setOpenAi((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  data-testid="timeline-ai-toggle"
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    font: 'inherit',
                    color: colors.textSecondary,
                    fontSize: typography.fontSizeSecondary,
                  }}
                >
                  {`💬 ${timelineLayers.aiToggle(nested.length, aiOpen)}`}
                </button>
                {aiOpen ? (
                  <div
                    style={{
                      display: 'grid',
                      gap: 4,
                      paddingLeft: 12,
                      borderLeft: `2px solid ${colors.borderSecondary}`,
                    }}
                  >
                    {nested.map((advice, n) =>
                      adviceLine(advice, 'timeline-ai-nested', index + n + 1),
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {cancelArea(item, index)}
      </>
    );
  }

  /** 그 밖의 줄(메모·사실·의견, 값이 없는 옛 응답): 꼬리표 + 글, 지금과 같다. */
  function plainLine(item: ActivityItem, index: number): ReactNode {
    return (
      <>
        <StatusTag tone={activityGroupTone[groupOf(item.kind)]} data-testid="timeline-kind">
          {labelFor(activityKindLabels, item.kind)}
        </StatusTag>
        <span data-testid="timeline-summary" style={item.cancelled === true ? struck : undefined}>
          {summaryText(item)}
        </span>
        {cancelledNote(item)}
        {menu(item)}
        {cancelArea(item, index)}
      </>
    );
  }

  return (
    <section aria-labelledby={`timeline-${oppId}`} data-testid="activity-timeline">
      <h3
        id={`timeline-${oppId}`}
        style={{ margin: '0 0 8px', fontSize: typography.fontSize, fontWeight: 600 }}
      >
        {timelineArea.title}
      </h3>
      {failed ? (
        <div role="alert" data-testid="timeline-error" style={{ color: colors.error }}>
          {timelineArea.loadFailed}{' '}
          <Button type="link" onClick={() => setRetry((n) => n + 1)} style={{ padding: 0 }}>
            {timelineArea.retry}
          </Button>
        </div>
      ) : null}
      {items === null && !failed ? (
        <span style={secondary} data-testid="timeline-loading">
          {timelineArea.loading}
        </span>
      ) : null}
      {items !== null && items.length === 0 && !failed ? (
        <span data-testid="timeline-empty" style={secondary}>
          {timelineArea.empty}
        </span>
      ) : null}
      {items !== null && items.length > 0 ? (
        <div
          role="group"
          aria-label={timelineArea.groupFilterLabel}
          data-testid="timeline-group-filter"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}
        >
          {layerChoices.map((choice) => {
            const selected = choice.value === layer;
            return (
              <button
                key={choice.value ?? 'ALL'}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) setLayer(choice.value);
                }}
                style={groupButtonStyle(selected)}
                data-testid={`timeline-group-${choice.value ?? 'ALL'}`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {visible !== null && items !== null && items.length > 0 && visible.length === 0 ? (
        <span data-testid="timeline-group-empty" style={secondary}>
          {timelineArea.groupEmpty(layer === null ? '' : timelineLayers.filters[layer])}
        </span>
      ) : null}
      {visible !== null && visible.length > 0 ? (
        <>
          {days.map((day) => (
            <div key={day.day} data-testid="timeline-day" style={{ display: 'grid', gap: 4 }}>
              <div
                data-testid="timeline-date"
                style={{
                  ...secondary,
                  fontWeight: 600,
                  borderBottom: `1px solid ${colors.borderSecondary}`,
                  paddingBottom: 2,
                  marginBottom: 4,
                }}
              >
                {dateLabel(day.day)}
              </div>
              <ol
                aria-label={`${timelineArea.listLabel} · ${dateLabel(day.day)}`}
                style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid' }}
              >
                {day.blocks.map((block, blockIndex) => {
                  const { lines } = arrangeBlock(block);
                  // 접촉한 날 아래로 옮긴 줄이면 저장한 때를 날짜와 함께 보인다(예: "11/17 22:54 저장").
                  const moved = displayDay(block[0]) !== kstDay(block[0].at);
                  return (
                    <li
                      key={`${block[0].at}-${blockIndex}`}
                      data-testid="timeline-block"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '28px minmax(0, 1fr)',
                        columnGap: 8,
                      }}
                    >
                      {/* #803 세로 타임라인: 왼쪽 점(그림)과 아래로 이어지는 선. */}
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'grid',
                          justifyItems: 'center',
                          gridTemplateRows: 'auto 1fr',
                        }}
                      >
                        <span
                          data-testid="timeline-icon"
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 999,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 12,
                            background: detailTheme.accentSoft,
                            border: `1px solid ${detailTheme.accent}`,
                          }}
                        >
                          {timelineIcon(lines[0] ?? block[0])}
                        </span>
                        {blockIndex < day.blocks.length - 1 ? (
                          <span
                            style={{ width: 2, background: detailTheme.lineTodo, minHeight: 8 }}
                          />
                        ) : null}
                      </span>
                      <div style={{ display: 'grid', gap: 4, paddingBottom: 10 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span data-testid="timeline-time" style={secondary}>
                            {moved
                              ? timelineLayers.savedAt(formatMonthDayTime(block[0].at) ?? '')
                              : formatHourMinuteOf(block[0].at)}
                          </span>
                          <span data-testid="timeline-actor">{actorName(block[0].actor)}</span>
                        </div>
                        {lines.map((item, inner) => {
                          const index = itemIndex.get(item) ?? inner;
                          const structuredOutcome = isStructuredOutcome(item);
                          const structuredAdvice = isStructuredAdvice(item);
                          return (
                            <div
                              key={`${item.at}-${index}`}
                              data-testid="timeline-item"
                              data-cancelled={item.cancelled === true ? 'true' : undefined}
                              style={
                                structuredOutcome || structuredAdvice
                                  ? { display: 'grid', gap: 4 }
                                  : {
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: 8,
                                      alignItems: 'center',
                                    }
                              }
                            >
                              {structuredOutcome
                                ? outcomeLine(item, nestedAdvice.get(item) ?? [], index)
                                : structuredAdvice
                                  ? adviceLine(item, 'timeline-ai', index)
                                  : plainLine(item, index)}
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {hiddenBlocks > 0 || showAll ? (
            <Button
              type="link"
              size="small"
              onClick={() => setShowAll((open) => !open)}
              data-testid="timeline-more"
              style={{ paddingLeft: 36 }}
            >
              {showAll ? timelineArea.showLess : timelineArea.showMore(hiddenItems)}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** 묶음 머리 시각. 날짜는 구분선이 보이므로 "14:20"만. 시각을 못 읽으면 빈칸. */
function formatHourMinuteOf(iso: string): string {
  return formatMonthDayTime(iso)?.slice(6) ?? '';
}
