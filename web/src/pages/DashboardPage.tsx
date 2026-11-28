// 영업 홈(S4, 첫 화면). #992(PM이 고른 수정안 3, 2026-11-29)부터 위에서 아래로:
//   인사말 줄: "안녕하세요, ○○ 님" + 날짜 · 오늘 챙길 일 n건 | 오른쪽 회사 검색
//   → 오늘 할 일(운영 알림 · 지난 일정 · 오늘 일정 · 오늘 날짜의 달력 메모 · 확인할 회사, AI 요약은 접어 둠.
//     의견 전 알림 줄은 이 칸에 붙어 있어 이 칸을 따라간다) | 전달 사항(받은 것 · 보낸 것)
//   → 진행 중인 회사 카드(폭 전체): 제목 바로 옆 작은 영업 단계 칸 묶음(미접촉 → 접촉 → 견적·샘플 → 성사 ┊ 보류,
//     누르면 표가 그 단계로 걸러진다) + 표(단계 · 담당 · 마지막 접촉 · 다음 일정 — 다음 일정 칸에서 바로 일정을 잡고 바꾼다)
//   → 이번 주 방문·연락(오늘부터 7일 + 보고서 · 거리 화살표) | 지도(위) + 같이 들를 곳(아래)
//   → 먼저 볼 후보 3곳(거래처 후보 목록 추천 순 맨 위. 못 읽으면 이 칸만 숨김)
//   → 월별 접촉 추세(영업 분석과 같은 응답·같은 그림, 높이는 절반쯤. 못 읽으면 이 칸만 숨김)
//   → 더 보기(접힘: 관심 기업 건수 · 최근 내 기록).
// 한 달 달력은 왼쪽 메뉴 아래로 옮겨 모든 화면에서 보인다(SideCalendar). 영업 홈이 읽은 일정을 그 달력에 알려
// 같은 요청을 두 번 보내지 않는다. 좁은 기기(메뉴가 접혀 달력이 없음)에서만 본문 맨 아래에 달력을 그린다.
// #984: 오늘 날짜의 달력 메모는 `GET /day-memos?from=오늘&to=오늘`로 따로 읽어 오늘 할 일 칸에 한 줄씩 보인다
// (`/dashboard` 응답 · 오늘 챙길 일 건수는 그대로). 달력에서 오늘 메모를 남기거나 지우면 이 줄도 바로 따라온다.
// (#972까지는 맨 위에 큰 단계 카드 5칸 · 월별 추세가 있었고, 달력은 이번 주 방문·연락 칸 안, 지도는 따로 한 줄이었다.
//  #983에서는 진행 중인 회사가 맨 위, 오늘 할 일 | 전달 사항이 그 아래였다. 그날 할 일이 먼저 보이게 #992에서 바꿨다.)
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
import MemoCalendar from '../components/schedule/MemoCalendar';
import TodayMemoLines from '../components/schedule/TodayMemoLines';
import { useDayMemos } from '../components/schedule/useDayMemos';
import ProgressTable from '../components/dashboard/ProgressTable';
import StageChips, { hasEnteredTag } from '../components/dashboard/StageChips';
import HomeTrend from '../components/dashboard/HomeTrend';
import TopCandidates from '../components/dashboard/TopCandidates';
import DashboardMapSection from '../components/dashboard/DashboardMapSection';
import VisitPrep, { PREP_DAYS, prepItems } from '../components/dashboard/VisitPrep';
import RecentActivityList from '../components/dashboard/RecentActivityList';
import AssistantDaily from '../components/assistant/AssistantDaily';
import { assistantConfigOf, SCHEDULE_CHANGED_EVENT } from '../api/assistant';
import NoOpinionNotice from '../components/dashboard/NoOpinionNotice';
import TodayChecks from '../components/dashboard/TodayChecks';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import { publishSideSchedule, publishSideScheduleError } from '../components/frame/useSideSchedule';
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
/** #983: 좁은 기기에서 본문 맨 아래에 그리는 달력의 최대 폭(화면 모양값, 규칙 숫자 아님). */
export const CALENDAR_MAX_WIDTH = 400;

export default function DashboardPage() {
  const { config, setBannerMeta, staffKey, canRecord, narrowDevice = false } = useFrame();
  const navigate = useNavigate();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  // #921 → #983 → #992: "진행 중인 회사" 제목 옆 작은 영업 단계 칸으로 고른 단계. 그 아래 표가 그 단계로 걸러진다.
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
        // #983: 왼쪽 메뉴 달력이 같은 일정을 쓰게 알린다(달력이 같은 요청을 또 보내지 않는다).
        publishSideSchedule(recordKey, envelope.data.schedule);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, error });
        publishSideScheduleError(recordKey);
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
  // #983: 진행 중인 회사 표에서 일정을 저장해도 같은 알림이 와서 표 · 오늘 할 일을 다시 읽는다.
  useEffect(() => {
    window.addEventListener(SCHEDULE_CHANGED_EVENT, retry);
    return () => window.removeEventListener(SCHEDULE_CHANGED_EVENT, retry);
  }, [retry]);

  const today = todayKst();
  // #984: 오늘 날짜의 달력 메모. 대시보드 응답과 따로 읽는다(못 읽어도 나머지 칸은 그대로 쓴다).
  const todayMemos = useDayMemos(today, today);
  const todayMemoFailed = todayMemos.state === 'error' || todayMemos.stale;

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

        {/* 영업 비서 질문 칸(#680)은 #773부터 오른쪽 "영업 코치" 칸에 있다(AppFrame dock="assistant"). */}

        {/* ① 출근하면(#992: 인사말 바로 아래 맨 위): 오늘 할 일 | 전달 사항. 둘 합이 본문 폭보다 넓으면 위아래로. */}
        <div
          data-testid="dashboard-row-work"
          style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}
        >
          <div style={{ flex: '3 1 360px', minWidth: 0 }}>
            {data ? (
              <TodayChecks
                part="work"
                rows={data.todayChecks}
                onChanged={retry}
                // #981: 관심에 담고 의견을 안 고른 회사가 있으면 오늘 할 일 아래에 한 줄로 알린다.
                notice={<NoOpinionNotice count={data.counts.NO_OPINION} />}
                // #984: 오늘 날짜의 달력 메모를 일정 줄 아래에 한 줄씩. 없으면 아무것도 그리지 않는다.
                memoLines={
                  todayMemos.memos.length > 0 || todayMemoFailed ? (
                    <TodayMemoLines
                      memos={todayMemos.memos}
                      failed={todayMemoFailed}
                      onReload={todayMemos.reload}
                    />
                  ) : null
                }
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

        {/* #983 → #992: 진행 중인 회사 카드(폭 전체)는 오늘 할 일 | 전달 사항 줄 바로 아래.
            제목 옆 작은 영업 단계 칸을 누르면 표가 그 단계로 걸러진다(#921 동작 그대로). */}
        {data ? (
          <ProgressTable
            companies={data.progressCompanies}
            today={today}
            stage={stage}
            onClearStage={() => setStage(null)}
            staffKey={recordKey}
            onReload={retry}
            stages={
              <StageChips
                counts={data.counts}
                companies={data.progressCompanies}
                entered={data.enteredThisWeek}
                selected={stage}
                onSelect={setStage}
              />
            }
            // 칸에 "+n" 꼬리표가 하나라도 보일 때만 설명 줄 끝에 풀이를 붙인다(없는 것을 설명하지 않는다).
            stagesLegend={
              hasEnteredTag(data.counts, data.enteredThisWeek)
                ? dashboardTexts.stageHintEntered
                : null
            }
          />
        ) : null}

        {/* ② 외근 전(#983): 이번 주 방문·연락 | 지도(위) + 같이 들를 곳(아래). 본문이 좁으면 위아래로 쌓인다. */}
        <div
          data-testid="dashboard-row-out"
          style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.cardGap, alignItems: 'start' }}
        >
          <section
            aria-labelledby="dashboard-prep-title"
            data-testid="dashboard-prep-section"
            style={{ ...sectionStyle, flex: '3 1 360px', minWidth: 0 }}
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
            <VisitPrep items={data?.schedule ?? []} today={today} map={mapData} />
          </section>
          {/* 지도 · 같이 들를 곳(#925 → #983): 따로 한 줄이던 지도 구역을 이 줄 오른쪽 칸으로 옮겼다. */}
          <div data-testid="dashboard-map-column" style={{ flex: '2 1 300px', minWidth: 0 }}>
            <DashboardMapSection title={dashboardTexts.mapTitle} onData={setMapData} stacked />
          </div>
        </div>

        {/* #972: 먼저 볼 후보 3곳(거래처 후보 목록 추천 순 맨 위). 스스로 불러오고, 못 읽으면 이 칸만 숨는다. */}
        {data ? <TopCandidates /> : null}

        {/* #972 → #983: 월별 접촉 추세(영업 분석과 같은 응답)는 맨 아래로. 스스로 불러오고, 못 읽으면 이 칸만 숨는다. */}
        {data ? <HomeTrend /> : null}

        {/* #983: 좁은 기기는 왼쪽 메뉴가 접혀 달력이 없으므로 본문 맨 아래에 같은 달력을 그린다(창은 날짜 아래). */}
        {data && narrowDevice ? (
          <section
            aria-label={dashboardTexts.calendarTitle}
            data-testid="dashboard-calendar-section"
            style={{ ...sectionStyle, maxWidth: CALENDAR_MAX_WIDTH }}
          >
            <MemoCalendar items={data.schedule} today={today} popoverSide="below" />
          </section>
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
