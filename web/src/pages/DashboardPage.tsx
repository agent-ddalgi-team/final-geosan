// 대시보드(S4, 첫 화면): 회사 이름 검색 · 건수 5개 · (공정·산업군 막대) · 일정 · 최근 내 기록.
// 숫자는 서버의 집계 `GET /dashboard`(계약 C1 v2, #216)에서 온다. 공정·산업군 막대는 서버가 주지 않으면(2차 #229 전) 숨긴다.
// 검색은 /opportunities?q=이름 으로 이동한다(계약: 검색은 목록의 q 조건). 목록이 q를 읽는 것은 서버 연결 뒤다.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { getDashboard } from '../api/dashboard';
import type { Dashboard } from '../api/dashboardTypes';
import type { Meta } from '../api/types';
import BreakdownBars from '../components/dashboard/BreakdownBars';
import CountCards from '../components/dashboard/CountCards';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import ScheduleList from '../components/dashboard/ScheduleList';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { dashboardTexts } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';

interface Result {
  /** 어떤 요청의 결과인지: 다시 시도 횟수와 담당자. 담당자가 바뀌면 이전 결과는 보이지 않는다. */
  key: string;
  data?: Dashboard;
  meta?: Meta;
  error?: unknown;
}

const sectionStyle = { display: 'grid', gap: 12, alignContent: 'start' } as const;

export default function DashboardPage() {
  const { setBannerMeta, staffKey, canRecord } = useFrame();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  // "최근 내 기록"은 고른 담당자 것이다. 기록할 수 없는 계정(보기 전용·담당자 미선택)은 키를 보내지 않는다(#216 후속).
  const recordKey = canRecord ? staffKey : null;
  const requestKey = `${reload}:${recordKey ?? ''}`;

  useEffect(() => {
    const controller = new AbortController();
    getDashboard(controller.signal, recordKey)
      .then((envelope) => {
        // 담당자를 바꾸거나 화면을 떠난 뒤 늦게 온 응답은 새 화면을 덮지 않는다.
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, data: envelope.data, meta: envelope.meta });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [requestKey, recordKey]);

  const current = result?.key === requestKey ? result : null;
  const meta = current?.meta ?? null;

  // 띠(가상 데이터·갱신 시각)는 대시보드 응답의 meta를 따른다.
  useEffect(() => {
    if (!meta) return undefined;
    setBannerMeta(meta);
    return () => setBannerMeta(null);
  }, [meta, setBannerMeta]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    navigate(`/opportunities?q=${encodeURIComponent(text)}`);
  };

  let state: 'loading' | 'error' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';

  const data = current?.data;
  const breakdown = data?.breakdown ?? null;

  return (
    <FiveStates
      state={state}
      errorTitle={dashboardTexts.loadError}
      error={current?.error}
      onRetry={retry}
    >
      <div style={{ display: 'grid', gap: spacing.sectionGap }}>
        <form role="search" onSubmit={submitSearch} style={{ display: 'flex', gap: 8 }}>
          <label htmlFor="dashboard-search" style={{ position: 'absolute', left: -9999 }}>
            {dashboardTexts.searchLabel}
          </label>
          <Input
            id="dashboard-search"
            data-testid="dashboard-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={dashboardTexts.searchPlaceholder}
            allowClear
          />
          <Button type="primary" htmlType="submit" data-testid="dashboard-search-button">
            {dashboardTexts.searchButton}
          </Button>
        </form>

        {data ? <CountCards counts={data.counts} /> : null}

        {breakdown ? (
          breakdown.basis.total === 0 ? (
            <section data-testid="dashboard-breakdown-empty" style={sectionStyle}>
              <p style={{ margin: 0, color: colors.textSecondary }}>
                {dashboardTexts.breakdownEmptyText}
              </p>
              <div>
                <Link to="/opportunities" data-testid="dashboard-breakdown-empty-link">
                  {dashboardTexts.breakdownEmptyAction}
                </Link>
              </div>
            </section>
          ) : (
            <div data-testid="dashboard-breakdown">
              <p
                data-testid="dashboard-breakdown-basis"
                style={{ margin: '0 0 12px', color: colors.textSecondary }}
              >
                {dashboardTexts.breakdownBasis(breakdown.basis.total)}
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: spacing.sectionGap,
                }}
              >
                <BreakdownBars
                  testId="dashboard-by-process"
                  title={dashboardTexts.breakdownProcessTitle}
                  rows={breakdown.byProcess.map((item) => ({
                    key: item.processCode,
                    name: item.processName,
                    count: item.count,
                    ratio: item.ratio,
                  }))}
                />
                <BreakdownBars
                  testId="dashboard-by-industry"
                  title={dashboardTexts.breakdownIndustryTitle}
                  includesProposed={breakdown.byIndustry.some((item) => item.includesProposed)}
                  rows={breakdown.byIndustry.map((item) => ({
                    key: item.industry,
                    name: item.industry,
                    count: item.count,
                    ratio: item.ratio,
                  }))}
                />
              </div>
            </div>
          )
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: spacing.sectionGap,
          }}
        >
          <section aria-labelledby="dashboard-schedule-title" style={sectionStyle}>
            <h2
              id="dashboard-schedule-title"
              style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
            >
              {dashboardTexts.scheduleTitle}
            </h2>
            <ScheduleList items={data?.schedule ?? []} />
          </section>
          <section aria-labelledby="dashboard-recent-title" style={sectionStyle}>
            <h2
              id="dashboard-recent-title"
              style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}
            >
              {dashboardTexts.recentTitle}
            </h2>
            <RecentActivityList items={data?.recentActivity ?? []} />
          </section>
        </div>
      </div>
    </FiveStates>
  );
}
