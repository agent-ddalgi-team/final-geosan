// 활동 이력 타임라인(U5, 기록 영역 아래): GET /activity를 최근 순으로 한 줄씩.
// 줄마다 시각 · 작성자 · 종류 · 내용. 예: "11/06 14:20 박 이사 전화 · 부재 '담당자 외근'". 읽기 전용이다.
// 종류는 뜻이 같은 3묶음(영업 활동·사실·의견)끼리 같은 색 태그로 보이고, 위의 단추로 한 묶음만 본다(#389).
// 기업이 바뀌면 부르는 쪽이 key로 새로 만든다. 다시 불러오는 동안에는 이전 줄을 그대로 둔다.
// 내 기록 줄에는 [잘못 입력]이 붙는다(#254, 2026-11-12): 누르면 줄 아래에 확인 한 줄이 열리고(모달 없음, 이유 200자 선택),
// [표시]를 누르면 서버가 그 줄에 취소 표시만 남긴다(지우지 않음). 취소된 줄은 줄이 그어지고 "취소 · 박 이사 · 11/06"이 붙는다.
// 남의 기록·이미 취소된 줄·취소 줄 자체에는 단추가 없다(설정으로 허용하면 남의 기록에도 보임). 취소하면 단계·횟수가 바뀌므로 부르는 쪽에 알린다.
import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { ApiError, getActivity, postRecordCancel } from '../../api/client';
import type { ActivityItem } from '../../api/types';
import {
  activityGroupLabels,
  activityKindLabels,
  errorTexts,
  labelFor,
  opinionLabels,
  timelineArea,
} from '../../labels/ko';
import { colors, detailTheme, typography } from '../../theme/tokens';
import StatusTag from '../common/StatusTag';
import { ACTIVITY_GROUPS, activityGroupTone, groupOf } from './activityGroups';
import type { ActivityGroup } from './activityGroups';
import { formatMonthDayTime } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

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
  return item.summary;
}

/** #803: 처음에 보이는 묶음 수. 나머지는 [더 보기 n건]으로 편다. */
export const TIMELINE_SHOWN = 5;

/** #803 세로 타임라인 점 안 그림: 전화 📞 · 방문 🚶 · 메일 ✉ · 메모 📝 · 의견·관심 ⭐ · 단계 📈 · 그 밖 •. */
export function timelineIcon(item: ActivityItem): string {
  if (item.kind === 'CONTACT_ATTEMPT') {
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
  /** 고른 묶음. null이면 전체. 기업이 바뀌면 부르는 쪽이 key로 새로 만들어 전체로 돌아간다. */
  const [group, setGroup] = useState<ActivityGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  const visible =
    items === null ? null : items.filter((item) => group === null || groupOf(item.kind) === group);
  // #803: 같은 시각 줄을 묶고, 처음에는 최근 5묶음만 보인다.
  const blocks = visible === null ? [] : groupSameMoment(visible);
  const shownBlocks = showAll ? blocks : blocks.slice(0, TIMELINE_SHOWN);
  const hiddenBlocks = blocks.length - shownBlocks.length;
  const hiddenItems = blocks.slice(TIMELINE_SHOWN).reduce((sum, block) => sum + block.length, 0);
  const itemIndex = new Map((visible ?? []).map((item, index) => [item, index]));
  const groupChoices: { value: ActivityGroup | null; label: string }[] = [
    { value: null, label: timelineArea.groupAll },
    ...ACTIVITY_GROUPS.map((value) => ({ value, label: activityGroupLabels[value] })),
  ];

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
          {groupChoices.map((choice) => {
            const selected = choice.value === group;
            return (
              <button
                key={choice.value ?? 'ALL'}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (!selected) setGroup(choice.value);
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
          {timelineArea.groupEmpty(group === null ? '' : activityGroupLabels[group])}
        </span>
      ) : null}
      {visible !== null && visible.length > 0 ? (
        <>
          <ol
            aria-label={timelineArea.listLabel}
            style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid' }}
          >
            {shownBlocks.map((block, blockIndex) => (
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
                  style={{ display: 'grid', justifyItems: 'center', gridTemplateRows: 'auto 1fr' }}
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
                    {timelineIcon(block[0])}
                  </span>
                  {blockIndex < shownBlocks.length - 1 ? (
                    <span style={{ width: 2, background: detailTheme.lineTodo, minHeight: 8 }} />
                  ) : null}
                </span>
                <div style={{ display: 'grid', gap: 2, paddingBottom: 10 }}>
                  {block.map((item, inner) => {
                    const index = itemIndex.get(item) ?? inner;
                    const key = lineKey(item);
                    const cancelOpen = cancelingKey === key && canCancel(item);
                    const first = inner === 0;
                    return (
                      <div
                        key={`${item.at}-${index}`}
                        data-testid="timeline-item"
                        data-cancelled={item.cancelled === true ? 'true' : undefined}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                      >
                        {first ? (
                          <>
                            <span data-testid="timeline-time" style={secondary}>
                              {formatMonthDayTime(item.at) ?? ''}
                            </span>
                            <span data-testid="timeline-actor">{actorName(item.actor)}</span>
                          </>
                        ) : null}
                        <StatusTag
                          tone={activityGroupTone[groupOf(item.kind)]}
                          data-testid="timeline-kind"
                        >
                          {labelFor(activityKindLabels, item.kind)}
                        </StatusTag>
                        <span
                          data-testid="timeline-summary"
                          style={
                            item.cancelled === true
                              ? { textDecoration: 'line-through', color: colors.textSecondary }
                              : undefined
                          }
                        >
                          {summaryText(item)}
                        </span>
                        {item.cancelled === true ? (
                          <span data-testid="timeline-cancelled-note" style={secondary}>
                            {timelineArea.cancelledNote(
                              item.cancelledBy ? actorName(item.cancelledBy) : '',
                              formatMonthDayTime(item.cancelledAt)?.slice(0, 5) ?? '',
                            )}
                          </span>
                        ) : null}
                        {canCancel(item) && !cancelOpen ? (
                          <Button
                            size="small"
                            type="link"
                            onClick={() => openCancel(item)}
                            aria-label={timelineArea.cancelButtonLabel(summaryText(item))}
                            data-testid="timeline-cancel-open"
                            style={{ padding: 0, height: 'auto' }}
                          >
                            {timelineArea.cancelButton}
                          </Button>
                        ) : null}
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
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
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
