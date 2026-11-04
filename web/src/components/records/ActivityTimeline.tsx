// 활동 이력 타임라인(U5, 기록 영역 아래): GET /activity를 최근 순으로 한 줄씩.
// 줄마다 시각 · 작성자 · 종류 · 내용. 예: "11/06 14:20 박 이사 전화 · 부재 '담당자 외근'". 읽기 전용이다.
// 기업이 바뀌면 부르는 쪽이 key로 새로 만든다. 다시 불러오는 동안에는 이전 줄을 그대로 둔다.
import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { getActivity } from '../../api/client';
import type { ActivityItem } from '../../api/types';
import { activityKindLabels, labelFor, timelineArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
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

export default function ActivityTimeline({ oppId, refreshKey = 0 }: ActivityTimelineProps) {
  const { config } = useFrame();
  const [retry, setRetry] = useState(0);
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
        <ol
          aria-label={timelineArea.listLabel}
          style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}
        >
          {items.map((item, index) => (
            <li
              key={`${item.at}-${index}`}
              data-testid="timeline-item"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              <span data-testid="timeline-time" style={secondary}>
                {formatMonthDayTime(item.at) ?? ''}
              </span>
              <span data-testid="timeline-actor">{actorName(item.actor)}</span>
              <span data-testid="timeline-kind" style={{ fontWeight: 600 }}>
                {labelFor(activityKindLabels, item.kind)}
              </span>
              <span data-testid="timeline-summary">{item.summary}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
