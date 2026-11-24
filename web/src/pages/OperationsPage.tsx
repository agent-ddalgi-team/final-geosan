// 운영 관리 화면(#799, PM 결정 2026-11-16). 운영 담당(설정 operations.staffKeys)만 연다(서버가 403으로 막는다).
//   ① AI 사용액: 이번 달 금액/한도 막대 + 쓰임새별(회사 조사·후보 판단 / 웹 검색 / 영업 기록·코치) + 날짜별 막대
//      + 오늘 자동 조사 금액/하루 한도. 숫자는 `geosan cost`와 같은 계산(서버).
//   ② 자료 현황: 자료별 기준일·넣은 날·행 수·다음 갱신 권장(공장현황 파일만, 지나면 "지남"). 실행 단추 없음.
//   ③ 최근 막힌 전송 10건: 시각·용도·이유만.
import { useEffect, useState } from 'react';
import { getOperations } from '../api/operations';
import type { Operations } from '../api/operations';
import { ApiError } from '../api/client';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { operationsTexts as t } from '../labels/ko';
import { colors, detailTheme, radius, spacing, typography } from '../theme/tokens';
import { formatMonthDayTime } from '../utils/time';

const section = {
  display: 'grid',
  gap: 12,
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: radius.lg,
  padding: spacing.cardPadding,
} as const;
const title = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function Bar({ ratio, warn, testId }: { ratio: number; warn: boolean; testId: string }) {
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return (
    <div
      aria-hidden="true"
      style={{
        height: 10,
        borderRadius: radius.sm,
        background: detailTheme.bandTodo,
        overflow: 'hidden',
      }}
    >
      <div
        data-testid={testId}
        style={{ width, height: '100%', background: warn ? colors.error : detailTheme.accentBar }}
      />
    </div>
  );
}

function UsageSection({ usage }: { usage: Operations['usage'] }) {
  const ratio = usage.costLimitUsd > 0 ? usage.costUsd / usage.costLimitUsd : 0;
  const percent = Math.round(ratio * 100);
  const maxDay = Math.max(0, ...usage.daily.map((row) => row.costUsd));
  return (
    <section aria-labelledby="ops-usage-title" data-testid="ops-usage" style={section}>
      <h2 id="ops-usage-title" style={title}>
        {t.usageTitle(usage.month)}
      </h2>
      <strong data-testid="ops-usage-total" style={{ fontSize: typography.fontSizeH1 }}>
        {t.usageTotal(usd(usage.costUsd), usd(usage.costLimitUsd), percent)}
      </strong>
      <Bar ratio={ratio} warn={ratio >= usage.alertRatio} testId="ops-usage-bar" />
      <span style={secondary}>
        {t.usageCalls(usage.calls, usage.callLimit)} ·{' '}
        {t.usageAlertLine(Math.round(usage.alertRatio * 100))}
      </span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {usage.groups.map((row) => (
          <li key={row.group} data-testid={`ops-usage-group-${row.group}`}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{t.groupNames[row.group]}</span>
              <span>
                {usd(row.costUsd)} <span style={secondary}>· {t.groupLine(row.calls)}</span>
              </span>
            </span>
            <Bar
              ratio={usage.costUsd > 0 ? row.costUsd / usage.costUsd : 0}
              warn={false}
              testId={`ops-usage-group-bar-${row.group}`}
            />
          </li>
        ))}
      </ul>
      {usage.daily.length > 0 ? (
        <div>
          <span style={secondary}>{t.dailyTitle}</span>
          <ol
            data-testid="ops-usage-daily"
            style={{
              listStyle: 'none',
              margin: '4px 0 0',
              padding: 0,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 4,
              height: 64,
            }}
          >
            {usage.daily.map((row) => (
              <li
                key={row.day}
                title={`${row.day.slice(5)} ${usd(row.costUsd)}`}
                aria-label={`${row.day.slice(5)} ${usd(row.costUsd)}`}
                style={{
                  flex: '1 1 0',
                  maxWidth: 24,
                  height: `${maxDay > 0 ? Math.max(4, (row.costUsd / maxDay) * 64) : 4}px`,
                  background: detailTheme.accentBar,
                  borderRadius: radius.sm,
                }}
              />
            ))}
          </ol>
        </div>
      ) : null}
      <span data-testid="ops-auto-research" style={secondary}>
        {t.autoResearchToday(
          usd(usage.autoResearchToday.usedUsd),
          usage.autoResearchToday.limitUsd === null ? null : usd(usage.autoResearchToday.limitUsd),
        )}
      </span>
    </section>
  );
}

function SourcesSection({ sources }: { sources: Operations['sources'] }) {
  const cell = { padding: '6px 8px', borderBottom: `1px solid ${colors.borderSecondary}` } as const;
  return (
    <section aria-labelledby="ops-sources-title" data-testid="ops-sources" style={section}>
      <h2 id="ops-sources-title" style={title}>
        {t.sourcesTitle}
      </h2>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {t.sourceHead.map((head) => (
              <th key={head} style={{ ...cell, ...secondary, textAlign: 'left', fontWeight: 600 }}>
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
              <td
                style={{
                  ...cell,
                  color: row.refreshOverdue ? colors.error : undefined,
                  fontWeight: row.refreshOverdue ? 600 : undefined,
                }}
              >
                {row.refreshDueAt
                  ? `${row.refreshDueAt}${row.refreshOverdue ? ` (${t.overdue})` : ''}`
                  : t.none}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ ...secondary, margin: 0 }}>{t.refreshHowTo}</p>
    </section>
  );
}

function BlockedSection({ blocked }: { blocked: Operations['blocked'] }) {
  return (
    <section aria-labelledby="ops-blocked-title" data-testid="ops-blocked" style={section}>
      <h2 id="ops-blocked-title" style={title}>
        {t.blockedTitle}
      </h2>
      {blocked.length === 0 ? (
        <p style={{ ...secondary, margin: 0 }}>{t.blockedEmpty}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {blocked.map((row, index) => (
            <li key={`${row.occurredAt}-${index}`} data-testid="ops-blocked-row">
              <span style={secondary}>{formatMonthDayTime(row.occurredAt)}</span> ·{' '}
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
        <div style={{ display: 'grid', gap: spacing.sectionGap }} data-testid="ops-page">
          <UsageSection usage={current.data.usage} />
          <SourcesSection sources={current.data.sources} />
          <BlockedSection blocked={current.data.blocked} />
        </div>
      ) : null}
    </FiveStates>
  );
}
