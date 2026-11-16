// 대시보드(S4, 첫 화면). #795(PM 결정 2026-11-16)부터 "오늘 할 일과 방문 나가기 전 정리" 순서다:
//   맨 위 날짜 + 작은 회사 검색 → ① 오늘 브리핑(AI 오늘 정리 · 📅 일정 · 📬 전달 사항 · 📈 영업 진행 띠)
//   → ② 오늘 할 일(오늘 확인할 것 묶음) | ③ 작은 달력 → ④ 방문 준비(오늘·이번 주 일정 회사 + 보고서 · 거리 화살표) | 지도
//   → ⑤ 더 보기(접힘: 관심 기업 건수 · 최근 내 기록). 넓으면 두 칸, 오른쪽 코치 칸이 있는 노트북 폭에서는 위아래.
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
import DashboardBrief from '../components/dashboard/DashboardBrief';
import DashboardCalendar from '../components/dashboard/DashboardCalendar';
import DashboardMapSection from '../components/dashboard/DashboardMapSection';
import VisitPrep from '../components/dashboard/VisitPrep';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import AssistantDaily from '../components/assistant/AssistantDaily';
import { assistantConfigOf, SCHEDULE_CHANGED_EVENT } from '../api/assistant';
import TodayChecks, { dayLabel } from '../components/dashboard/TodayChecks';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { dashboardTexts } from '../labels/ko';
import { calendarPalette, colors, spacing, typography } from '../theme/tokens';
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
// 일정 달력 구역은 어두운 판(#758). 색은 theme/tokens의 calendarPalette.
const calendarSectionStyle = {
  ...sectionStyle,
  background: calendarPalette.panel,
  border: `1px solid ${calendarPalette.panelBorder}`,
  borderRadius: 20,
} as const;
const calendarTitleStyle = { ...cardTitleStyle, color: calendarPalette.title } as const;

export default function DashboardPage() {
  const { config, setBannerMeta, staffKey, canRecord } = useFrame();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  // "최근 내 기록"은 고른 담당자 것이다. 기록할 수 없는 계정(보기 전용·담당자 미선택)은 키를 보내지 않는다(#216 후속).
  const recordKey = canRecord ? staffKey : null;
  // 오늘 정리(#743)는 영업 기록 스위치가 켜져 있고 담당자를 골랐을 때만 부른다(꺼져 있으면 호출 0).
  const dailyKey = assistantConfigOf(config)?.enabled === true ? recordKey : null;
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

  // #774: 오른쪽 영업 코치 칸에서 [넣기]로 일정이 바뀌면 오늘 확인할 것·달력을 다시 읽는다.
  useEffect(() => {
    window.addEventListener(SCHEDULE_CHANGED_EVENT, retry);
    return () => window.removeEventListener(SCHEDULE_CHANGED_EVENT, retry);
  }, [retry]);

  const today = todayKst();

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
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <strong data-testid="dashboard-date" style={{ fontSize: typography.fontSizeCardTitle }}>
            {dashboardTexts.todayDate(dayLabel(today))}
          </strong>
          {/* #795: 회사 찾기는 가끔 쓰므로 오른쪽 위에 작게. 동작은 그대로(/opportunities?q=이름). */}
          <form
            role="search"
            onSubmit={submitSearch}
            style={{ display: 'flex', gap: 6, width: 260, maxWidth: '100%' }}
          >
            <label htmlFor="dashboard-search" style={{ position: 'absolute', left: -9999 }}>
              {dashboardTexts.searchLabel}
            </label>
            <Input
              id="dashboard-search"
              size="small"
              data-testid="dashboard-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dashboardTexts.searchPlaceholder}
              allowClear
            />
            <Button
              size="small"
              type="primary"
              htmlType="submit"
              data-testid="dashboard-search-button"
            >
              {dashboardTexts.searchButton}
            </Button>
          </form>
        </div>

        {/* ① 오늘 브리핑 */}
        {data ? (
          <DashboardBrief
            rows={data.todayChecks}
            counts={data.counts}
            assistantSummary={dailyKey ? <AssistantDaily staffKey={dailyKey} /> : null}
          />
        ) : null}
        {/* 영업 비서 질문 칸(#680)은 #773부터 오른쪽 "💬 영업 코치" 칸에 있다(AppFrame dock="assistant"). */}

        {/* ② 오늘 할 일 | ③ 작은 달력. 둘 합이 본문 폭보다 넓으면(노트북 + 코치 칸) 위아래로. */}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}
        >
          <div style={{ flex: '2 1 560px', minWidth: 0 }}>
            {data ? <TodayChecks rows={data.todayChecks} onChanged={retry} /> : null}
          </div>
          <section
            aria-labelledby="dashboard-calendar-title"
            data-testid="dashboard-calendar-section"
            style={{ ...calendarSectionStyle, flex: '1 1 340px', minWidth: 0, padding: 16 }}
          >
            <h2 id="dashboard-calendar-title" style={calendarTitleStyle}>
              {dashboardTexts.calendarTitle}
            </h2>
            <DashboardCalendar items={data?.schedule ?? []} today={today} compact />
          </section>
        </div>

        {/* ④ 방문 준비 + 지도(같은 지도 응답으로 거리 화살표를 그린다) */}
        <DashboardMapSection
          title={dashboardTexts.prepTitle}
          hint={dashboardTexts.prepHint}
          aside={(map) => <VisitPrep items={data?.schedule ?? []} today={today} map={map} />}
        />

        {/* ⑤ 더 보기: 날마다 보지 않는 것은 접어 둔다(지우지 않음). */}
        <details data-testid="dashboard-more" style={sectionStyle}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {dashboardTexts.moreTitle}
          </summary>
          <div style={{ display: 'grid', gap: spacing.sectionGap, marginTop: 12 }}>
            {data ? <CountCards counts={data.counts} part="bookmark" /> : null}
            <section
              aria-labelledby="dashboard-recent-title"
              data-testid="dashboard-recent-section"
              style={{ display: 'grid', gap: 12 }}
            >
              <h2 id="dashboard-recent-title" style={cardTitleStyle}>
                {dashboardTexts.recentTitle}
              </h2>
              <RecentActivityList items={data?.recentActivity ?? []} />
            </section>
          </div>
        </details>
      </div>
    </FiveStates>
  );
}
