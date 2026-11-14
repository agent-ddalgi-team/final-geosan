// 대시보드(S4, 첫 화면): 회사 이름 검색 · 오늘 확인할 것 · 일정 달력 · 건수 두 구역("관심 기업" → "영업 진행") · 최근 내 기록 · 지도.
// 숫자는 서버의 집계 `GET /dashboard`(계약 C1 v3, #216·#356)에서 온다. 관심으로 고른 회사만 센다.
// 공정·산업군 막대는 영업 분석 화면으로 옮겼다(#679, PM 결정 2026-11-13). 대시보드는 오늘 할 일과 진행을 한눈에 보는 곳이다.
// 검색은 /opportunities?q=이름 으로 이동한다(계약: 검색은 목록의 q 조건). 목록이 q를 읽는 것은 서버 연결 뒤다.
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { getDashboard } from '../api/dashboard';
import type { Dashboard } from '../api/dashboardTypes';
import type { Meta } from '../api/types';
import CountCards from '../components/dashboard/CountCards';
import DashboardCalendar from '../components/dashboard/DashboardCalendar';
import DashboardMapSection from '../components/dashboard/DashboardMapSection';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import AssistantAsk from '../components/assistant/AssistantAsk';
import TodayChecks from '../components/dashboard/TodayChecks';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { dashboardTexts } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';
import { todayKst } from '../utils/time';

interface Result {
  /** 어떤 요청의 결과인지: 다시 시도 횟수와 담당자. 담당자가 바뀌면 이전 결과는 보이지 않는다. */
  key: string;
  data?: Dashboard;
  meta?: Meta;
  error?: unknown;
}

// 흰 카드: 달력·일정·최근 기록을 같은 모양으로 묶는다(연한 테두리, 둥근 모서리).
const sectionStyle = {
  display: 'grid',
  gap: 12,
  alignContent: 'start',
  boxSizing: 'border-box',
  background: colors.bgContainer,
  border: `1px solid ${colors.borderSecondary}`,
  borderRadius: 12,
  padding: spacing.cardPadding,
} as const;
const cardTitleStyle = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;

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

        {/* 위에서부터: 오늘 확인할 것 → 일정 달력 → 영업 진행(건수 칸) → 최근 내 기록 → 지도 (#679). */}
        {data ? <TodayChecks rows={data.todayChecks} /> : null}
        {/* 영업 비서 질문 칸(#680). 설정이 꺼져 있으면 안내 한 줄, 설정을 못 읽었으면 아무것도 없다. */}
        {data ? <AssistantAsk /> : null}

        <section
          aria-labelledby="dashboard-calendar-title"
          data-testid="dashboard-calendar-section"
          style={sectionStyle}
        >
          <h2 id="dashboard-calendar-title" style={cardTitleStyle}>
            {dashboardTexts.calendarTitle}
          </h2>
          <DashboardCalendar items={data?.schedule ?? []} today={todayKst()} />
        </section>

        {data ? <CountCards counts={data.counts} /> : null}

        <section
          aria-labelledby="dashboard-recent-title"
          data-testid="dashboard-recent-section"
          style={sectionStyle}
        >
          <h2 id="dashboard-recent-title" style={cardTitleStyle}>
            {dashboardTexts.recentTitle}
          </h2>
          <RecentActivityList items={data?.recentActivity ?? []} />
        </section>

        <DashboardMapSection />
      </div>
    </FiveStates>
  );
}
