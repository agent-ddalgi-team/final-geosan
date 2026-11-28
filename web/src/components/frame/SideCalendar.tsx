// 왼쪽 메뉴 아래 한 달 달력(#983, PM이 고른 시안 2026-11-28). 모든 화면에서 보인다(넓은 화면).
// 메뉴와 간격을 띄운 연회색 칸 안에 작은 달력(DashboardCalendar mini)을 그린다. 날짜를 누르면 달력 오른쪽으로
// 작은 창이 떠서 그날 일정(회사 · 내용 · 지남 표시)을 보이고, 일정이 없으면 "일정 없음"이라고 보인다.
// 일정은 영업 홈과 같은 응답을 쓴다(useSideSchedule). 못 읽으면 이 칸에 짧은 안내만 보이고 메뉴는 그대로 쓴다.
// #984: 달력은 날짜 메모를 쓰는 달력(MemoCalendar)이다. 메모가 있는 날에 테두리가 보이고, 날짜를 누르면 뜨는 창의
// 일정 아래에 그날 메모 칸이 보인다. 메모는 보이는 달만 읽고, 못 읽어도 달력 · 일정은 그대로 쓴다.
// extra: 메모 칸 대신 작은 창 본문 아래에 끼울 것. 주지 않으면 메모 칸을 그린다.
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { dashboardTexts as t } from '../../labels/ko';
import { accent, colors, sideCalendar } from '../../theme/tokens';
import { todayKst } from '../../utils/time';
import MemoCalendar from '../schedule/MemoCalendar';
import { useFrame } from './FrameContext';
import { useSideSchedule } from './useSideSchedule';

/** [다시 읽기]. 다시 읽을 길이 없으면(영업 홈: 본문의 [다시 시도]가 맡음) 그리지 않는다. */
function Retry({ onClick }: { onClick: (() => void) | null }) {
  if (!onClick) return null;
  return (
    <>
      {' '}
      <button
        type="button"
        onClick={onClick}
        data-testid="side-calendar-retry"
        style={{
          border: 0,
          padding: 0,
          background: 'transparent',
          color: accent.text,
          font: 'inherit',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
      >
        {t.sideCalendarRetry}
      </button>
    </>
  );
}

export default function SideCalendar({ extra }: { extra?: (day: string) => ReactNode }) {
  const { staffKey, canRecord } = useFrame();
  const { pathname } = useLocation();
  // 영업 홈과 같은 규칙: 기록할 수 없는 계정(보기 전용 · 담당자 미선택)은 키를 보내지 않는다.
  const recordKey = canRecord ? staffKey : null;
  const schedule = useSideSchedule(recordKey, pathname);
  const notice = {
    margin: 0,
    padding: '0 4px',
    fontSize: sideCalendar.legendFontSize,
    lineHeight: 1.5,
    color: colors.textSecondary,
  } as const;
  return (
    <section
      aria-label={t.calendarTitle}
      data-testid="side-calendar"
      data-state={schedule.state}
      style={{
        flex: 'none',
        position: 'relative',
        marginTop: sideCalendar.gapAbove,
        padding: sideCalendar.panelPadding,
        background: sideCalendar.panelBg,
        border: `1px solid ${sideCalendar.panelBorder}`,
        borderRadius: sideCalendar.panelRadius,
        whiteSpace: 'normal',
      }}
    >
      {schedule.state === 'ready' ? (
        <>
          <MemoCalendar
            items={schedule.items}
            today={todayKst()}
            popoverSide="right"
            watch={pathname}
            extra={extra}
          />
          {schedule.stale ? (
            // 다시 읽기에 실패했다: 보이는 달력은 앞서 읽은 값이라고 알린다(조용히 옛 값을 보이지 않는다).
            <p role="alert" data-testid="side-calendar-stale" style={{ ...notice, marginTop: 6 }}>
              {t.sideCalendarStale}
              <Retry onClick={schedule.reload} />
            </p>
          ) : null}
        </>
      ) : schedule.state === 'error' ? (
        <p role="alert" data-testid="side-calendar-error" style={notice}>
          {t.sideCalendarError}
          <Retry onClick={schedule.reload} />
        </p>
      ) : (
        <p aria-busy="true" data-testid="side-calendar-loading" style={notice}>
          {t.sideCalendarLoading}
        </p>
      )}
    </section>
  );
}
