// 활동 이력 타임라인(U5, 기록 영역 아래): GET /activity를 최근 순으로 한 줄씩.
// 줄마다 시각 · 작성자 · 종류 · 내용. 예: "11/06 14:20 박 이사 전화 · 부재 '담당자 외근'". 읽기 전용이다.
// 종류는 뜻이 같은 3묶음(영업 활동·사실·의견)끼리 같은 색 태그로 보이고, 위의 단추로 한 묶음만 본다(#389).
// 기업이 바뀌면 부르는 쪽이 key로 새로 만든다. 다시 불러오는 동안에는 이전 줄을 그대로 둔다.
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { getActivity } from '../../api/client';
import type { ActivityItem } from '../../api/types';
import { activityGroupLabels, activityKindLabels, labelFor, timelineArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import StatusTag from '../common/StatusTag';
import { ACTIVITY_GROUPS, activityGroupTone, groupOf } from './activityGroups';
import type { ActivityGroup } from './activityGroups';
import { formatMonthDayTime } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

export interface ActivityTimelineProps {
  oppId: string;
  /** 값이 바뀌면 다시 불러온다(기록을 저장한 뒤 새 줄이 보이게). */
  refreshKey?: number;
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

export default function ActivityTimeline({ oppId, refreshKey = 0 }: ActivityTimelineProps) {
  const { config } = useFrame();
  const [retry, setRetry] = useState(0);
  /** 고른 묶음. null이면 전체. 기업이 바뀌면 부르는 쪽이 key로 새로 만들어 전체로 돌아간다. */
  const [group, setGroup] = useState<ActivityGroup | null>(null);
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

  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  const visible =
    items === null ? null : items.filter((item) => group === null || groupOf(item.kind) === group);
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
        <ol
          aria-label={timelineArea.listLabel}
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}
        >
          {visible.map((item, index) => (
            <li
              key={`${item.at}-${index}`}
              data-testid="timeline-item"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
            >
              <span data-testid="timeline-time" style={secondary}>
                {formatMonthDayTime(item.at) ?? ''}
              </span>
              <span data-testid="timeline-actor">{actorName(item.actor)}</span>
              <StatusTag tone={activityGroupTone[groupOf(item.kind)]} data-testid="timeline-kind">
                {labelFor(activityKindLabels, item.kind)}
              </StatusTag>
              <span data-testid="timeline-summary">{item.summary}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
