// 대시보드(S4, 첫 화면). #921(PM 결정 2026-11-25)부터 "출근하면 · 외근 전 · 누가 봐도" 세 칸이다:
//   맨 위 한 줄: 날짜 + 작은 영업 단계 칩(미접촉 → 접촉 → 견적·샘플 → 성사 · 보류) + 작은 회사 검색
//   → ① 출근하면: 오늘 할 일(운영 알림 · 지난 일정 · 오늘 일정 · 확인할 것, AI 오늘 정리는 접어 둠)
//                | 전달 사항(받은 것 · 보낸 것) + 한 달 달력
//   → ② 외근 전: 이번 주 방문·연락(오늘부터 7일 + 보고서 · 거리 화살표) — #925부터 오늘 할 일 바로 아래 칸
//   → 지도 · 같이 들를 곳(#925: 지도 칸에는 지도와 같이 들를 곳만, 나란히)
//   → ③ 누가 봐도: 진행 중인 회사 표(단계 · 담당 · 마지막 접촉 · 다음 일정, 멈춘 회사 노란 줄)
//   → 더 보기(접힘: 관심 기업 건수 · 최근 내 기록).
// 같은 일정을 여러 곳에 되풀이하지 않는다(예전 브리핑 숫자 칸·큰 진행 띠는 없앰, #795·#766을 대신함).
// 숫자는 서버의 집계 `GET /dashboard`(계약 C1 v3, #216·#356)에서 온다. 관심으로 고른 회사만 센다.
// 공정·산업군 막대는 영업 분석 화면으로 옮겼다(#679, PM 결정 2026-11-13).
// 검색은 /opportunities?q=이름 으로 이동한다(계약: 검색은 목록의 q 조건).
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from 'antd';
import { getDashboard } from '../api/dashboard';
import type { Dashboard } from '../api/dashboardTypes';
import type { Meta } from '../api/types';
import type { ProgressBandKey } from '../api/dashboardTypes';
import type { DashboardMap as DashboardMapData } from '../api/dashboardMapTypes';
import CountCards from '../components/dashboard/CountCards';
import DashboardCalendar from '../components/dashboard/DashboardCalendar';
import ProgressTable from '../components/dashboard/ProgressTable';
import StageChips from '../components/dashboard/StageChips';
import DashboardMapSection from '../components/dashboard/DashboardMapSection';
import VisitPrep from '../components/dashboard/VisitPrep';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import AssistantDaily from '../components/assistant/AssistantDaily';
import { assistantConfigOf, SCHEDULE_CHANGED_EVENT } from '../api/assistant';
import TodayChecks, { dayLabel } from '../components/dashboard/TodayChecks';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { dashboardTexts, frame } from '../labels/ko';
import { colors, radius, spacing, typography } from '../theme/tokens';
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
  borderRadius: radius.lg,
  padding: spacing.cardPadding,
} as const;
const cardTitleStyle = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
/** #921: 오른쪽 칸(전달 사항 + 한 달 달력) 최대 폭(화면 모양값, 규칙 숫자 아님). */
export const CALENDAR_MAX_WIDTH = 400;

export default function DashboardPage() {
  const { config, setBannerMeta, staffKey, canRecord } = useFrame();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  // #921: 맨 위 단계 칩으로 고른 단계. "진행 중인 회사" 표가 그 단계로 걸러진다.
  const [stage, setStage] = useState<ProgressBandKey | null>(null);
  // #925: 지도 칸이 불러온 지도 정보. 오늘 할 일 아래 방문 목록이 거리 화살표를 그릴 때 같이 쓴다.
  const [mapData, setMapData] = useState<DashboardMapData | undefined>(undefined);
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
            gap: 12,
          }}
        >
          {/* #925: 페이지 제목·날짜·단계 칸·검색을 한 줄에(위쪽 빈 줄을 없앰). 제목은 페이지마다 하나(h1). */}
          <h1 style={{ fontSize: typography.fontSizeH1, margin: 0, lineHeight: 1.2 }}>
            {frame.pageTitleDashboard}
          </h1>
          <strong data-testid="dashboard-date" style={{ fontSize: typography.fontSizeCardTitle }}>
            {dashboardTexts.todayDate(dayLabel(today))}
          </strong>
          {data ? (
            <StageChips
              counts={data.counts}
              selected={stage}
              onSelect={(band) => {
                setStage(band);
                if (band) {
                  document
                    .getElementById('dashboard-progress-table')
                    ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                }
              }}
            />
          ) : null}
          {/* #795: 회사 찾기는 가끔 쓰므로 오른쪽 위에 작게. 동작은 그대로(/opportunities?q=이름). */}
          <form
            role="search"
            onSubmit={submitSearch}
            style={{ display: 'flex', gap: 6, width: 240, maxWidth: '100%', marginLeft: 'auto' }}
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
        {/* 영업 비서 질문 칸(#680)은 #773부터 오른쪽 "💬 영업 코치" 칸에 있다(AppFrame dock="assistant"). */}

        {/* ① 출근하면: 오늘 할 일 | 전달 사항 + 한 달 달력. 둘 합이 본문 폭보다 넓으면 위아래로. */}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}
        >
          <div style={{ flex: '3 1 360px', minWidth: 0 }}>
            {data ? (
              <TodayChecks
                part="work"
                rows={data.todayChecks}
                onChanged={retry}
                assistantSummary={
                  dailyKey ? (
                    // #921: AI 오늘 정리는 접어 둔다. 눌러서 펴 본다(부르는 것은 화면이 열릴 때 한 번).
                    <details data-testid="dashboard-ai-daily">
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                        {dashboardTexts.aiDailyTitle}
                      </summary>
                      <AssistantDaily staffKey={dailyKey} />
                    </details>
                  ) : null
                }
              />
            ) : null}
            {/* #925 외근 전: 이번 주 방문·연락은 오늘 할 일 바로 아래(일정은 한 줄로 모아 본다). */}
            <section
              aria-labelledby="dashboard-prep-title"
              data-testid="dashboard-prep-section"
              style={{ ...sectionStyle, marginTop: spacing.cardGap }}
            >
              <h2 id="dashboard-prep-title" style={cardTitleStyle}>
                {dashboardTexts.outTitle}
              </h2>
              <VisitPrep items={data?.schedule ?? []} today={today} map={mapData} />
            </section>
          </div>
          <div
            data-testid="dashboard-calendar-section"
            style={{ flex: '2 1 300px', minWidth: 0, maxWidth: CALENDAR_MAX_WIDTH }}
          >
            {data ? (
              <TodayChecks
                part="handoff"
                rows={data.todayChecks}
                onChanged={retry}
                footer={
                  <section
                    aria-label={dashboardTexts.calendarTitle}
                    style={{
                      display: 'grid',
                      gap: 8,
                      borderTop: `1px solid ${colors.borderSecondary}`,
                      paddingTop: 12,
                    }}
                  >
                    <DashboardCalendar items={data.schedule ?? []} today={today} compact />
                  </section>
                }
              />
            ) : null}
          </div>
        </div>

        {/* 지도 · 같이 들를 곳(#925): 방문 목록은 위로 옮겨, 이 칸에는 지도와 같이 들를 곳만 나란히. */}
        <DashboardMapSection title={dashboardTexts.mapTitle} onData={setMapData} />

        {/* ③ 누가 봐도: 진행 중인 회사 */}
        {data ? (
          <ProgressTable
            companies={data.progressCompanies}
            today={today}
            stage={stage}
            onClearStage={() => setStage(null)}
            staffKey={recordKey}
          />
        ) : null}

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
