// 운영 관리 화면(#799, PM 결정 2026-11-16). 운영 담당(설정 operations.staffKeys)만 연다(서버가 403으로 막는다).
//   ① AI 사용액: 이번 달 금액/한도 막대 + 쓰임새별(회사 조사·후보 판단 / 웹 검색 / 영업 기록·코치) + 날짜별 막대
//      + 오늘 자동 조사 금액/하루 한도. 숫자는 `geosan cost`와 같은 계산(서버).
//   ② 자료 현황: 자료별 기준일·넣은 날·행 수·다음 갱신 권장(공장현황 파일만, 지나면 "지남"). 실행 단추 없음.
//   ③ 최근 막힌 전송 10건: 시각·용도·이유만.
// #972(새 시안): 내용·순서는 그대로, 보라 톤. 넓으면 [AI 사용액 | 날짜별] 두 칸으로 나란히 둔다.
//   사용액 막대는 알림 비율(설정 llm.costAlertRatio, 서버가 준 값) 이상이면 주의색, 아니면 보라.
//   날짜별 막대는 오늘만 진한 보라, 나머지는 옅은 보라. "지남"은 주의 꼬리표. 표 머리는 흐린 글자 + 얇은 아래 선.
import { useEffect, useState } from 'react';
import { getOperations } from '../api/operations';
import type { Operations } from '../api/operations';
import { ApiError } from '../api/client';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { operationsTexts as t, operationsToneTexts as tone } from '../labels/ko';
import {
  accent,
  colors,
  neutralChip,
  radius,
  spacing,
  tagPalette,
  typography,
  warn,
} from '../theme/tokens';
import { formatMonthDayTime, todayKst } from '../utils/time';

const section = {
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  minWidth: 0,
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: radius.card,
  padding: spacing.cardPadding,
} as const;
const title = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;
const dimmed = { color: colors.textDimmed, fontSize: typography.fontSizeSecondary } as const;
/** 제목 옆 작은 설명 줄(시안: 제목과 같은 줄, 좁으면 아래로). */
const titleRow = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 } as const;
/** 날짜별 막대가 이 수보다 많으면 막대 위 금액·아래 날짜 글자를 빼고 손 올림 글만 둔다(칸이 좁아 겹친다). */
const DAILY_LABEL_MAX = 10;
const DAILY_BAR_HEIGHT = 120;

export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** "2026-11-27" → "11/27" */
function monthDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${m}/${d}`;
}

function Bar({
  ratio,
  color,
  height = 10,
  testId,
}: {
  ratio: number;
  color: string;
  height?: number;
  testId: string;
}) {
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        borderRadius: radius.tag,
        background: neutralChip.bg,
        overflow: 'hidden',
      }}
    >
      <div
        data-testid={testId}
        style={{ width, height: '100%', borderRadius: radius.tag, background: color }}
      />
    </div>
  );
}

function UsageSection({ usage }: { usage: Operations['usage'] }) {
  const ratio = usage.costLimitUsd > 0 ? usage.costUsd / usage.costLimitUsd : 0;
  const percent = Math.round(ratio * 100);
  const alertPercent = Math.round(usage.alertRatio * 100);
  // 알림 기준은 전과 같다: 사용 비율이 설정의 알림 비율 이상이면 주의.
  const over = ratio >= usage.alertRatio;
  return (
    <section aria-labelledby="ops-usage-title" data-testid="ops-usage" style={section}>
      <div style={titleRow}>
        <h2 id="ops-usage-title" style={title}>
          {t.usageTitle(usage.month)}
        </h2>
        <span style={dimmed}>{t.usageAlertLine(alertPercent)}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0 8px' }}>
        <strong data-testid="ops-usage-total">
          <span style={{ fontSize: typography.fontSizeH1, fontWeight: 700, letterSpacing: -0.6 }}>
            {usd(usage.costUsd)}
          </span>{' '}
          <span style={{ ...dimmed, fontWeight: 400 }}>
            {tone.usageLimit(usd(usage.costLimitUsd), percent)}
          </span>
        </strong>
        <span style={dimmed}>· {t.usageCalls(usage.calls, usage.callLimit)}</span>
      </div>
      <Bar ratio={ratio} color={over ? warn.dot : accent.bright} testId="ops-usage-bar" />
      {over ? (
        <span
          data-testid="ops-usage-over"
          style={{ color: warn.text, fontSize: typography.fontSizeSecondary, fontWeight: 600 }}
        >
          {tone.usageOver(alertPercent)}
        </span>
      ) : null}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
        {usage.groups.map((row, index) => (
          <li
            key={row.group}
            data-testid={`ops-usage-group-${row.group}`}
            style={{
              display: 'grid',
              gap: 6,
              padding: '10px 0',
              borderTop: index === 0 ? undefined : `1px solid ${colors.borderSecondary}`,
            }}
          >
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{t.groupNames[row.group]}</span>
              <span>
                <strong style={{ fontWeight: 600 }}>{usd(row.costUsd)}</strong>{' '}
                <span style={dimmed}>· {t.groupLine(row.calls)}</span>
              </span>
            </span>
            <Bar
              ratio={usage.costUsd > 0 ? row.costUsd / usage.costUsd : 0}
              color={accent.line}
              height={6}
              testId={`ops-usage-group-bar-${row.group}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DailySection({ usage, today }: { usage: Operations['usage']; today: string }) {
  const maxDay = Math.max(0, ...usage.daily.map((row) => row.costUsd));
  const labelled = usage.daily.length <= DAILY_LABEL_MAX;
  return (
    <section aria-labelledby="ops-daily-title" data-testid="ops-daily" style={section}>
      <div style={titleRow}>
        <h2 id="ops-daily-title" style={title}>
          {t.dailyTitle}
        </h2>
        {usage.daily.length > 0 ? (
          <span style={dimmed}>{tone.dailyNote(usage.daily.length)}</span>
        ) : null}
      </div>
      {usage.daily.length > 0 ? (
        <ol
          data-testid="ops-usage-daily"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            alignItems: 'flex-end',
            gap: labelled ? 8 : 4,
          }}
        >
          {usage.daily.map((row) => {
            const isToday = row.day === today;
            const text = `${row.day.slice(5)} ${usd(row.costUsd)}`;
            return (
              <li
                key={row.day}
                title={text}
                aria-label={text}
                aria-current={isToday ? 'date' : undefined}
                data-today={isToday ? 'true' : 'false'}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  maxWidth: labelled ? 56 : 24,
                  display: 'grid',
                  justifyItems: 'center',
                  gap: 4,
                  fontSize: typography.fontSizeSecondary,
                  color: colors.textDimmed,
                }}
              >
                {labelled ? (
                  <span aria-hidden="true" style={{ color: colors.text, fontWeight: 500 }}>
                    {usd(row.costUsd)}
                  </span>
                ) : null}
                <span
                  aria-hidden="true"
                  data-testid="ops-usage-daily-bar"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: maxDay > 0 ? Math.max(4, (row.costUsd / maxDay) * DAILY_BAR_HEIGHT) : 4,
                    // 오늘만 진한 보라, 나머지는 옅은 보라.
                    background: isToday ? accent.bg : accent.softDeep,
                    borderRadius: radius.tag,
                  }}
                />
                {labelled ? <span aria-hidden="true">{monthDay(row.day)}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      <span
        data-testid="ops-auto-research"
        style={{
          ...secondary,
          background: colors.bgLayout,
          borderRadius: radius.control,
          padding: '9px 12px',
        }}
      >
        {t.autoResearchToday(
          usd(usage.autoResearchToday.usedUsd),
          usage.autoResearchToday.limitUsd === null ? null : usd(usage.autoResearchToday.limitUsd),
        )}
      </span>
    </section>
  );
}

function SourcesSection({ sources }: { sources: Operations['sources'] }) {
  const cell = {
    padding: '12px 10px',
    borderBottom: `1px solid ${colors.borderSecondary}`,
    textAlign: 'left',
    verticalAlign: 'top',
  } as const;
  return (
    <section aria-labelledby="ops-sources-title" data-testid="ops-sources" style={section}>
      <h2 id="ops-sources-title" style={title}>
        {t.sourcesTitle}
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {t.sourceHead.map((head) => (
                // 표 머리: 흐린 글자 + 얇은 아래 선.
                <th
                  key={head}
                  scope="col"
                  style={{ ...cell, ...dimmed, padding: '8px 10px', fontWeight: 400 }}
                >
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((row) => (
              <tr key={row.source} data-testid={`ops-source-${row.source}`}>
                <td style={cell}>{t.sourceNames[row.source]}</td>
                <td style={cell}>{row.asOf ?? t.none}</td>
                <td style={cell}>{row.loadedAt ? formatMonthDayTime(row.loadedAt) : t.none}</td>
                <td style={cell}>{row.rows.toLocaleString('ko-KR')}</td>
                <td style={cell}>
                  {row.refreshDueAt ? (
                    <>
                      <span
                        style={
                          row.refreshOverdue ? { color: warn.text, fontWeight: 600 } : undefined
                        }
                      >
                        {row.refreshDueAt}
                      </span>
                      {row.refreshOverdue ? (
                        <>
                          {' '}
                          <span
                            data-testid="ops-source-overdue"
                            style={{
                              padding: '3px 9px',
                              borderRadius: radius.tag,
                              background: tagPalette.warn.bg,
                              color: tagPalette.warn.fg,
                              fontSize: typography.fontSizeSecondary,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.overdue}
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    t.none
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...dimmed, margin: 0 }}>{t.refreshHowTo}</p>
    </section>
  );
}

function BlockedSection({ blocked }: { blocked: Operations['blocked'] }) {
  return (
    <section aria-labelledby="ops-blocked-title" data-testid="ops-blocked" style={section}>
      <div style={titleRow}>
        <h2 id="ops-blocked-title" style={title}>
          {t.blockedTitle}
        </h2>
        {blocked.length > 0 ? (
          <span data-testid="ops-blocked-count" style={dimmed}>
            {tone.blockedCount(blocked.length)}
          </span>
        ) : null}
      </div>
      {blocked.length === 0 ? (
        <p style={{ ...secondary, margin: 0 }}>{t.blockedEmpty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {blocked.map((row, index) => (
            <li
              key={`${row.occurredAt}-${index}`}
              data-testid="ops-blocked-row"
              style={{
                padding: '10px 0',
                borderTop: index === 0 ? undefined : `1px solid ${colors.borderSecondary}`,
              }}
            >
              <span style={dimmed}>{formatMonthDayTime(row.occurredAt)}</span> ·{' '}
              {row.reason ?? row.kind}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Result {
  key: number;
  data?: Operations;
  error?: unknown;
}

export default function OperationsPage() {
  const { staffKey } = useFrame();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getOperations(controller.signal, staffKey)
      .then((envelope) => setResult({ key: reload, data: envelope.data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: reload, error });
      });
    return () => controller.abort();
  }, [reload, staffKey]);
  const current = result?.key === reload ? result : null;
  const state = !current ? 'loading' : current.error ? 'error' : 'ready';
  const forbidden = current?.error instanceof ApiError && current.error.status === 403;
  return (
    <FiveStates
      state={state}
      errorTitle={forbidden ? t.forbidden : t.loadError}
      error={current?.error}
      onRetry={() => setReload((n) => n + 1)}
    >
      {current?.data ? (
        <div style={{ display: 'grid', gap: spacing.cardGap }} data-testid="ops-page">
          {/* 넓으면 [AI 사용액 1.2 | 날짜별 1], 좁으면 아래로 쌓인다. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap }}>
            <div style={{ flex: '1.2 1 380px', minWidth: 0, display: 'grid' }}>
              <UsageSection usage={current.data.usage} />
            </div>
            <div style={{ flex: '1 1 300px', minWidth: 0, display: 'grid' }}>
              <DailySection usage={current.data.usage} today={todayKst()} />
            </div>
          </div>
          <SourcesSection sources={current.data.sources} />
          <BlockedSection blocked={current.data.blocked} />
        </div>
      ) : null}
    </FiveStates>
  );
}
