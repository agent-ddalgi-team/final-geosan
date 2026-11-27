// 영업 홈(S4, 첫 화면). #972(새 디자인, PM 결정 2026-11-27)부터 위에서 아래로:
//   인사말 줄: "안녕하세요, ○○ 님" + 날짜 · 오늘 챙길 일 n건 | 오른쪽 회사 검색
//   → 단계 숫자 카드 5칸(미접촉 › 접촉 › 견적·샘플 › 성사 · 보류) — 누르면 아래 표가 그 단계로 걸러진다
//   → 월별 접촉 추세(영업 분석과 같은 응답·같은 그림. 못 읽으면 이 칸만 숨김)
//   → 오늘 할 일(운영 알림 · 지난 일정 · 오늘 일정 · 확인할 회사, AI 요약은 접어 둠) | 전달 사항(받은 것 · 보낸 것)
//   → 이번 주 방문·연락(오늘부터 7일 + 보고서 · 거리 화살표) + 한 달 점 달력
//   → 지도 · 같이 들를 곳
//   → 진행 중인 회사 표(단계 · 담당 · 마지막 접촉 · 다음 일정, 멈춘 회사 꼬리표)
//   → 먼저 볼 후보 3곳(거래처 후보 목록 추천 순 맨 위. 못 읽으면 이 칸만 숨김)
//   → 더 보기(접힘: 관심 기업 건수 · 최근 내 기록).
// 같은 일정을 여러 곳에 되풀이하지 않는다(#921: 출근하면 · 외근 전 · 누가 봐도 세 칸 순서는 그대로).
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
import type { ProgressBandKey, TodayCheckRow } from '../api/dashboardTypes';
import type { DashboardMap as DashboardMapData } from '../api/dashboardMapTypes';
import CountCards from '../components/dashboard/CountCards';
import DashboardCalendar from '../components/dashboard/DashboardCalendar';
import ProgressTable from '../components/dashboard/ProgressTable';
import StageChips from '../components/dashboard/StageChips';
import HomeTrend from '../components/dashboard/HomeTrend';
import TopCandidates from '../components/dashboard/TopCandidates';
import DashboardMapSection from '../components/dashboard/DashboardMapSection';
import VisitPrep, { PREP_DAYS, prepItems } from '../components/dashboard/VisitPrep';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import AssistantDaily from '../components/assistant/AssistantDaily';
import { assistantConfigOf, SCHEDULE_CHANGED_EVENT } from '../api/assistant';
import TodayChecks from '../components/dashboard/TodayChecks';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { dashboardTexts, frame } from '../labels/ko';
import type { ConfigUi } from '../api/types';
import { colors, homePalette, radius, spacing, typography } from '../theme/tokens';
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
  borderRadius: radius.card,
  padding: spacing.cardPadding,
} as const;
const cardTitleStyle = { fontSize: typography.fontSizeCardTitle, margin: 0 } as const;
const WEEKDAYS = '일월화수목금토';

/** "11월 27일 금요일". 날짜 글(YYYY-MM-DD)이 아니면 그대로. */
export function greetingDate(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return today;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dashboardTexts.greetingDate(day.getMonth() + 1, day.getDate(), WEEKDAYS[day.getDay()]);
}

/**
 * 인사말에 쓸 화면 이름: 계정 방식이면 로그인한 사람, 아니면 고른 담당자(기록할 수 있는 담당자만).
 * 이름을 모르면(보기 전용 · 담당자 미선택 · 첫 로그인 설정 전) null이고 화면은 지금 제목을 보인다.
 */
export function greetingName(
  config: ConfigUi | null,
  staffKey: string | null,
  canRecord: boolean,
): string | null {
  if (config?.currentStaff) return config.currentStaff.displayName?.trim() || null;
  if (!canRecord || !staffKey) return null;
  return config?.staff?.find((entry) => entry.key === staffKey)?.displayName?.trim() || null;
}

/** 왼쪽 메뉴 숫자와 같은 뜻: 지난 일정 + 오늘 일정 + 나에게 온 전달 사항. 줄 목록이 없으면(옛 서버) null. */
const TODO_KINDS = ['SCHEDULE_OVERDUE', 'SCHEDULE_TODAY', 'HANDOFF_FOR_ME'];
export function todoCount(rows: TodayCheckRow[] | undefined): number | null {
  if (rows === undefined) return null;
  return rows
    .filter((row) => TODO_KINDS.includes(row.kind))
    .reduce((sum, row) => sum + row.count, 0);
}
/** #929: 이번 주 방문·연락 칸 안 달력 최대 폭(화면 모양값, 규칙 숫자 아님). */
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
  const name = greetingName(config, staffKey, canRecord);
  const todo = todoCount(data?.todayChecks);
  const prepCount = prepItems(data?.schedule ?? [], today).length;

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
            alignItems: 'flex-end',
            gap: 16,
          }}
        >
          {/* #972: 인사말(로그인한 사람 이름을 모르면 지금 제목) + 날짜 · 오늘 챙길 일. 제목은 페이지마다 하나(h1). */}
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: typography.fontSizeH1,
                margin: 0,
                lineHeight: 1.2,
                letterSpacing: -0.5,
              }}
            >
              {name ? dashboardTexts.greeting(name) : frame.pageTitleDashboard}
            </h1>
            <p
              data-testid="dashboard-date"
              style={{
                margin: '4px 0 0',
                color: colors.textSecondary,
                fontSize: typography.fontSizeSecondary,
              }}
            >
              {greetingDate(today)}
              {todo !== null ? (
                <>
                  {' · '}
                  {dashboardTexts.greetingTodoLead}{' '}
                  <b data-testid="dashboard-todo-count" style={{ color: homePalette.blueText }}>
                    {dashboardTexts.greetingTodoCount(todo)}
                  </b>
                </>
              ) : null}
            </p>
          </div>
          {/* #795: 회사 찾기는 가끔 쓰므로 오른쪽 위에 작게. 동작은 그대로(/opportunities?q=이름). */}
          <form
            role="search"
            onSubmit={submitSearch}
            style={{ display: 'flex', gap: 6, width: 260, maxWidth: '100%', marginLeft: 'auto' }}
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

        {/* #972: 단계 숫자 카드 5칸. 누르면 아래 "진행 중인 회사" 표가 그 단계로 걸러진다(#921 동작 그대로). */}
        {data ? (
          <StageChips
            counts={data.counts}
            companies={data.progressCompanies}
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
        {/* #972: 월별 접촉 추세(영업 분석과 같은 응답). 스스로 불러오고, 못 읽으면 이 칸만 숨는다. */}
        {data ? <HomeTrend /> : null}

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
                    <details
                      data-testid="dashboard-ai-daily"
                      style={{
                        background: homePalette.purpleBg,
                        borderRadius: radius.controlSm,
                        padding: '8px 12px',
                      }}
                    >
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontWeight: 600,
                          color: homePalette.purpleText,
                        }}
                      >
                        {dashboardTexts.aiDailyTitle}
                      </summary>
                      <AssistantDaily staffKey={dailyKey} />
                    </details>
                  ) : null
                }
              />
            ) : null}
          </div>
          <div data-testid="dashboard-handoff-column" style={{ flex: '2 1 300px', minWidth: 0 }}>
            {data ? <TodayChecks part="handoff" rows={data.todayChecks} onChanged={retry} /> : null}
          </div>
        </div>

        {/* #929(시안 v3): 이번 주 방문·연락 — 왼쪽 7일 목록, 같은 칸 오른쪽에 "11월 일정" 점 달력(이번 주 연파랑). */}
        <section
          aria-labelledby="dashboard-prep-title"
          data-testid="dashboard-prep-section"
          style={sectionStyle}
        >
          <h2 id="dashboard-prep-title" style={cardTitleStyle}>
            {dashboardTexts.outTitle}
            {/* #972(시안): 제목 옆 작은 풀이 "오늘부터 7일 · 3곳". 일정이 없으면 아래 빈 안내가 말한다. */}
            {prepCount > 0 ? (
              <small
                data-testid="dashboard-prep-count"
                style={{
                  marginLeft: 8,
                  fontSize: typography.fontSizeSecondary,
                  color: colors.textDimmed,
                  fontWeight: 400,
                }}
              >
                {dashboardTexts.outCount(PREP_DAYS, prepCount)}
              </small>
            ) : null}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'start' }}>
            <div style={{ flex: '5 1 420px', minWidth: 0 }}>
              <VisitPrep items={data?.schedule ?? []} today={today} map={mapData} />
            </div>
            <div
              data-testid="dashboard-calendar-section"
              aria-label={dashboardTexts.calendarTitle}
              style={{
                flex: '3 1 280px',
                minWidth: 0,
                maxWidth: CALENDAR_MAX_WIDTH,
                borderLeft: `1px solid ${colors.borderSecondary}`,
                paddingLeft: 18,
              }}
            >
              <DashboardCalendar items={data?.schedule ?? []} today={today} compact dots />
            </div>
          </div>
        </section>

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

        {/* #972: 먼저 볼 후보 3곳(거래처 후보 목록 추천 순 맨 위). 스스로 불러오고, 못 읽으면 이 칸만 숨는다. */}
        {data ? <TopCandidates /> : null}

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
