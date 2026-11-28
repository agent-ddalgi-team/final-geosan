// 일정 달력(대시보드): 서버가 준 일정(`schedule`)의 날짜에 표시를 하고, 그 날을 누르면 작은 창(팝업)으로 일정 내용을 보인다.
// 새 API·필드 없이 이미 받은 일정만 쓴다. 팝업은 화면을 가리는 모달이 아니라 그 날짜 칸 바로 아래에 붙는 작은 창이다:
// [닫기]·Esc·바깥을 누르면 닫히고, 같은 날을 다시 눌러도 닫힌다.
// 모양(#758): 어두운 판 위 둥근 칸. 일정이 있는 날만 상태 색을 칠하고(기한 지남 = 갈색, 오늘 = 금색, 7일 안 = 연노랑,
// 그 뒤 = 연두) 왼쪽 위에 "N건", 왼쪽 아래에 두 자리 날짜("04")를 둔다. 일정 없는 날은 흐리게. 글자는 한글과 숫자만.
// 색은 theme/tokens의 calendarPalette만 쓴다.
// #795: 대시보드는 compact로 작게 그린다(칸 높이·글자만 줄이고 날짜 누르면 팝업 등 동작은 같다).
// #927(PM 요청 2026-11-25, 시안): dots = 날짜 숫자만 작게, 일정 있는 날 아래 점(지난 일정 미정리는 빨강),
//   오늘은 초록으로 채움. 머리는 "‹ 11월 일정 ›". 날짜를 누르면 그날 일정 작은 창(지금과 같음).
// #972(새 디자인): 점 달력의 오늘 = 강조 바탕 + 흰 글자, 일정 점 = 강조 밝은 쪽, 지난 일정 미정리 점 = 주의 점,
//   이번 주 = 강조 연한 바탕, 칸 모서리 8. 작은 창 그림자는 토큰(homePalette.popoverShadow).
// #983(PM이 고른 시안 2026-11-28): 점 모양(dots)을 작은 달력(mini)으로 바꿨다. 왼쪽 메뉴 아래(모든 화면)와
//   좁은 화면의 영업 홈 본문 맨 아래가 쓴다.
//   - 점 대신 칸 색(나이 있는 분도 보이게): 일정 있는 날 = 연보라 바탕 + 보라 굵은 숫자, 지난 일정이 남은 날 =
//     연주황 바탕 + 주황 굵은 숫자, 누른 날 = 진한 보라 바탕 + 흰 숫자, 오늘 = 얇은 테두리. 달력 아래에 풀이.
//   - 어느 날짜든 누를 수 있다. 일정이 없는 날은 작은 창에 "일정 없음"이 보인다.
//   - 작은 창은 달력 오른쪽(popoverSide="right", 왼쪽 메뉴)이나 날짜 아래("below")에 뜨고,
//     본문 아래에 다른 것(날짜 메모 #984 자리)을 끼울 수 있다(extra).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import {
  calendarPalette,
  colors,
  homePalette,
  radius,
  sideCalendar,
  type CalendarTone,
  typography,
} from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { sortSchedule } from './ScheduleList';

/** #983 작은 달력의 날짜 칸 종류: 지난 일정이 남은 날 · 일정 있는 날 · 일정 없는 날. */
export type MiniDayTone = 'overdue' | 'has' | 'none';

/** #983 작은 달력 날짜 칸의 바탕 · 글자색. 누른 날이 가장 먼저다. */
export function miniCellColors(tone: MiniDayTone, selected: boolean): { bg: string; fg: string } {
  if (selected) return sideCalendar.selected;
  if (tone === 'overdue') return sideCalendar.overdue;
  if (tone === 'has') return sideCalendar.has;
  return sideCalendar.plain;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const POPOVER_WIDTH = 300;

const TONE_ORDER: CalendarTone[] = ['overdue', 'today', 'soon', 'later'];
const TONE_LABEL: Record<CalendarTone, string> = {
  overdue: dashboardTexts.calendarToneOverdue,
  today: dashboardTexts.calendarToneToday,
  soon: dashboardTexts.calendarToneSoon,
  later: dashboardTexts.calendarToneLater,
};
const SOON_DAYS = 7;

function dayNumber(dateKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

/** 그 날 일정의 색: 기한 지남이 하나라도 있으면 갈색, 오늘이면 금색, 7일 안이면 연노랑, 그 밖은 연두. */
function toneOf(dateKey: string, list: DashboardScheduleItem[], today: string): CalendarTone {
  if (list.some((item) => item.overdue)) return 'overdue';
  if (dateKey === today) return 'today';
  const a = dayNumber(dateKey);
  const b = dayNumber(today);
  if (a !== null && b !== null && a > b && a - b < SOON_DAYS) return 'soon';
  return 'later';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** (연, 월 0~11, 일) → "YYYY-MM-DD". 시간대 계산 없이 숫자로만 만든다. */
function key(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

interface Props {
  items: DashboardScheduleItem[];
  /** 오늘 날짜(YYYY-MM-DD, 한국 기준). 비어 있으면 오늘 표시를 하지 않는다. */
  today: string;
  /** #795: 작게(칸 높이 36px, 작은 글자). 동작은 같다. */
  compact?: boolean;
  /** #983 작은 달력(왼쪽 메뉴 · 좁은 화면의 영업 홈). 기본은 칸마다 색·건수. */
  mini?: boolean;
  /** 작은 달력의 작은 창이 뜨는 쪽. right = 달력 오른쪽(왼쪽 메뉴), below = 날짜 아래. */
  popoverSide?: 'right' | 'below';
  /** 작은 달력의 작은 창 본문 아래에 끼울 것. 그날 날짜(YYYY-MM-DD)를 받는다(날짜 메모 #984 자리). */
  extra?: (day: string) => ReactNode;
}

interface Open {
  day: string;
  left: number;
  top: number;
  /** 작은 달력 · 오른쪽 창에서 날짜가 화면 아래쪽이면 창을 위로 펼친다: 달력 아래 끝에서 창 아래 끝까지 거리. */
  bottom?: number;
}

export default function DashboardCalendar({
  items,
  today,
  compact = false,
  mini = false,
  popoverSide = 'below',
  extra,
}: Props) {
  const base = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  const startYear = base ? Number(base[1]) : new Date().getFullYear();
  const startMonth = base ? Number(base[2]) - 1 : new Date().getMonth();
  const [cursor, setCursor] = useState({ year: startYear, month: startMonth });
  const [open, setOpen] = useState<Open | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Esc나 바깥을 누르면 팝업을 닫는다.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(null);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapRef.current && !wrapRef.current.contains(target)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const byDay = new Map<string, DashboardScheduleItem[]>();
  for (const item of items) {
    byDay.set(item.dueAt, [...(byDay.get(item.dueAt) ?? []), item]);
  }

  const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const lead = first.getUTCDay();
  const length = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
  const rows = Math.ceil((lead + length) / 7);

  const move = (delta: number) => {
    const d = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
    setOpen(null);
  };

  const navButton = {
    border: 0,
    background: mini ? 'transparent' : calendarPalette.navBg,
    color: mini ? colors.textSecondary : calendarPalette.navFg,
    borderRadius: '50%',
    width: mini ? 24 : compact ? 28 : 40,
    height: mini ? 24 : compact ? 28 : 40,
    fontSize: mini ? sideCalendar.titleFontSize : compact ? 16 : 20,
    fontFamily: 'inherit',
    padding: 0,
    lineHeight: 1,
    cursor: 'pointer',
    flex: 'none',
  } as const;

  const openList = open ? sortSchedule(byDay.get(open.day) ?? []) : [];

  return (
    <div ref={wrapRef} data-testid="dashboard-calendar" style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mini ? 2 : 8,
          marginBottom: compact || mini ? 8 : 12,
        }}
      >
        <button
          type="button"
          aria-label="지난달"
          data-testid="dashboard-calendar-prev"
          onClick={() => move(-1)}
          style={navButton}
        >
          ‹
        </button>
        <strong
          data-testid="dashboard-calendar-title"
          style={{
            flex: 1,
            textAlign: 'center',
            color: calendarPalette.title,
            fontSize: mini ? sideCalendar.titleFontSize : compact ? 18 : 28,
            fontWeight: mini ? 600 : 500,
            lineHeight: 1.2,
          }}
        >
          {mini ? null : (
            <>
              <span
                style={{
                  fontSize: typography.fontSizeSecondary,
                  fontWeight: 400,
                  color: calendarPalette.textSecondary,
                  marginRight: 6,
                }}
              >
                {cursor.year}년
              </span>{' '}
            </>
          )}
          {mini ? dashboardTexts.calendarDotsTitle(cursor.month + 1) : `${cursor.month + 1}월`}
        </strong>
        <button
          type="button"
          aria-label="다음 달"
          data-testid="dashboard-calendar-next"
          onClick={() => move(1)}
          style={navButton}
        >
          ›
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: mini ? 0 : 6,
          color: calendarPalette.weekday,
          fontSize: mini ? sideCalendar.weekdayFontSize : typography.fontSizeSecondary,
          textAlign: 'center',
          marginBottom: mini ? 2 : 6,
        }}
      >
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div
        role="grid"
        aria-label={`${cursor.year}년 ${cursor.month + 1}월 일정 달력`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: mini
            ? undefined
            : `repeat(${rows}, minmax(${compact ? 36 : 68}px, 1fr))`,
          gap: mini ? '2px 0' : compact ? 4 : 6,
        }}
      >
        {Array.from({ length: rows * 7 }, (_, i) => {
          const day = i - lead + 1;
          if (day < 1 || day > length) return <span key={i} aria-hidden="true" />;
          const k = key(cursor.year, cursor.month, day);
          const list = byDay.get(k);
          const overdue = list?.some((item) => item.overdue) ?? false;
          const isSelected = open?.day === k;
          const isToday = k === today;
          const tone = list ? toneOf(k, list, today) : null;
          const palette = tone ? calendarPalette.tones[tone] : null;
          if (mini) {
            // #983: 어느 날짜든 누를 수 있다. 칸 색과 굵기로 일정 있는 날 · 지난 일정이 남은 날을 알린다.
            const miniTone: MiniDayTone = overdue ? 'overdue' : list ? 'has' : 'none';
            const cellColors = miniCellColors(miniTone, isSelected);
            const marked = miniTone !== 'none' || isSelected;
            return (
              <button
                key={i}
                type="button"
                data-testid={`dashboard-calendar-day-${k}`}
                aria-pressed={isSelected}
                aria-haspopup="dialog"
                aria-current={isToday ? 'date' : undefined}
                aria-label={dashboardTexts.calendarDayLabel(
                  cursor.month + 1,
                  day,
                  list?.length ?? 0,
                  overdue,
                  isToday,
                )}
                data-tone={miniTone}
                data-today={isToday ? 'true' : undefined}
                onClick={(event) => {
                  if (isSelected) {
                    setOpen(null);
                    return;
                  }
                  const target = event.currentTarget;
                  const wrap = wrapRef.current;
                  if (popoverSide === 'right') {
                    // 날짜가 화면 아래쪽 절반에 있으면 창을 위로 펼쳐 화면 밖으로 나가지 않게 한다.
                    const low = target.getBoundingClientRect().top > window.innerHeight / 2;
                    const rowBottom = target.offsetTop + target.offsetHeight;
                    setOpen({
                      day: k,
                      left: 0,
                      top: Math.max(0, target.offsetTop - 12),
                      ...(low
                        ? {
                            bottom: Math.max(0, (wrap?.clientHeight ?? rowBottom) - rowBottom - 12),
                          }
                        : {}),
                    });
                    return;
                  }
                  const wrapWidth = wrap?.clientWidth ?? POPOVER_WIDTH;
                  const left = Math.max(
                    0,
                    Math.min(target.offsetLeft, wrapWidth - Math.min(POPOVER_WIDTH, wrapWidth)),
                  );
                  setOpen({ day: k, left, top: target.offsetTop + target.offsetHeight + 6 });
                }}
                style={{
                  border: 0,
                  background: 'none',
                  padding: '1px 0',
                  minWidth: 0,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span
                  data-testid={`dashboard-calendar-cell-${k}`}
                  style={{
                    display: 'block',
                    width: sideCalendar.cellSize,
                    height: sideCalendar.cellSize,
                    lineHeight: `${sideCalendar.cellSize}px`,
                    margin: '0 auto',
                    borderRadius: sideCalendar.cellRadius,
                    fontSize: sideCalendar.cellFontSize,
                    textAlign: 'center',
                    background: cellColors.bg,
                    color: cellColors.fg,
                    fontWeight: marked ? 700 : 400,
                    // 누른 날은 바깥 고리, 오늘은 안쪽 얇은 테두리.
                    boxShadow: isSelected
                      ? `0 0 0 2px ${colors.bgContainer}, 0 0 0 4px ${sideCalendar.selected.bg}`
                      : isToday
                        ? `inset 0 0 0 ${sideCalendar.todayRingWidth}px ${sideCalendar.todayRing}`
                        : 'none',
                  }}
                >
                  {day}
                </span>
              </button>
            );
          }
          const common = {
            position: 'relative',
            boxSizing: 'border-box',
            minWidth: 0,
            borderRadius: compact ? radius.control : radius.card,
            border: 0,
            boxShadow: isToday ? `inset 0 0 0 2px ${calendarPalette.todayRing}` : 'none',
            outline: isSelected ? `3px solid ${calendarPalette.todayRing}` : 'none',
            outlineOffset: 2,
            background: palette ? palette.bg : calendarPalette.emptyBg,
            color: palette ? palette.fg : calendarPalette.emptyFg,
            opacity: palette ? 1 : 0.75,
            fontFamily: 'inherit',
            padding: 0,
            textAlign: 'left',
          } as const;
          const number = (
            <span
              style={{
                position: 'absolute',
                left: compact ? 4 : 8,
                bottom: compact ? 2 : 6,
                fontSize: compact ? 11 : 15,
                fontWeight: palette || isToday ? 600 : 400,
                color: isToday && !palette ? calendarPalette.todayRing : undefined,
              }}
            >
              {pad(day)}
            </span>
          );
          if (!list || !palette || !tone) {
            return (
              <span
                key={i}
                data-testid={`dashboard-calendar-day-${k}`}
                data-tone="none"
                style={common}
              >
                {number}
              </span>
            );
          }
          return (
            <button
              key={i}
              type="button"
              data-testid={`dashboard-calendar-day-${k}`}
              aria-pressed={isSelected}
              aria-haspopup="dialog"
              aria-label={`${cursor.month + 1}월 ${day}일 일정 ${list.length}건${
                overdue ? ' (기한 지남)' : ''
              }`}
              data-tone={tone}
              onClick={(event) => {
                if (isSelected) {
                  setOpen(null);
                  return;
                }
                const cell = event.currentTarget;
                const wrapWidth = wrapRef.current?.clientWidth ?? POPOVER_WIDTH;
                const left = Math.max(
                  0,
                  Math.min(cell.offsetLeft, wrapWidth - Math.min(POPOVER_WIDTH, wrapWidth)),
                );
                setOpen({ day: k, left, top: cell.offsetTop + cell.offsetHeight + 6 });
              }}
              style={{ ...common, cursor: 'pointer' }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: compact ? 3 : 6,
                  top: compact ? 3 : 6,
                  maxWidth: compact ? 'calc(100% - 6px)' : 'calc(100% - 12px)',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  borderRadius: radius.tag,
                  padding: compact ? '0 4px' : '1px 7px',
                  background: palette.badge,
                  fontSize: compact ? 10 : 12,
                  fontWeight: 600,
                }}
              >
                {dashboardTexts.calendarCount(list.length)}
              </span>
              {number}
            </button>
          );
        })}
      </div>
      {mini ? (
        <ul
          aria-label={dashboardTexts.calendarLegendLabel}
          data-testid="dashboard-calendar-legend"
          style={{
            listStyle: 'none',
            margin: '10px 0 0',
            padding: '0 4px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 10px',
            color: calendarPalette.textSecondary,
            fontSize: sideCalendar.legendFontSize,
          }}
        >
          {[
            [sideCalendar.has.bg, dashboardTexts.calendarMiniHas],
            [sideCalendar.overdue.bg, dashboardTexts.calendarMiniOverdue],
          ].map(([color, label]) => (
            <li
              key={label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
            >
              <span
                aria-hidden="true"
                style={{ width: 14, height: 14, borderRadius: 4, background: color }}
              />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {mini ? null : (
        <ul
          aria-label={dashboardTexts.calendarLegendLabel}
          data-testid="dashboard-calendar-legend"
          style={{
            listStyle: 'none',
            margin: '12px 0 0',
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 14px',
            color: calendarPalette.textSecondary,
            fontSize: typography.fontSizeSecondary,
          }}
        >
          {TONE_ORDER.map((tone) => (
            <li key={tone} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: radius.tag,
                  background: calendarPalette.tones[tone].bg,
                }}
              />
              {TONE_LABEL[tone]}
            </li>
          ))}
        </ul>
      )}
      {mini ? (
        <p
          data-testid="dashboard-calendar-hint"
          style={{
            margin: '6px 0 0',
            padding: '0 4px',
            color: calendarPalette.weekday,
            fontSize: sideCalendar.legendFontSize,
            lineHeight: 1.5,
          }}
        >
          {dashboardTexts.calendarMiniHint}
        </p>
      ) : byDay.size === 0 ? (
        <p
          data-testid="dashboard-schedule-empty"
          style={{ margin: '8px 0 0', color: calendarPalette.textSecondary }}
        >
          {dashboardTexts.calendarEmpty}
        </p>
      ) : (
        <p
          style={{
            margin: '8px 0 0',
            color: calendarPalette.textSecondary,
            fontSize: typography.fontSizeSecondary,
          }}
        >
          {dashboardTexts.calendarHint}
        </p>
      )}
      {open && mini ? (
        <MiniPopover
          open={open}
          list={openList}
          side={popoverSide}
          onClose={() => setOpen(null)}
          extra={extra}
        />
      ) : null}
      {open && !mini ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${formatMonthDay(open.day)} 일정`}
          data-testid="dashboard-calendar-popover"
          style={{
            position: 'absolute',
            left: open.left,
            top: open.top,
            width: `min(${POPOVER_WIDTH}px, 100%)`,
            boxSizing: 'border-box',
            zIndex: 10,
            background: calendarPalette.popoverBg,
            border: `1px solid ${calendarPalette.popoverBorder}`,
            color: calendarPalette.title,
            borderRadius: radius.card,
            boxShadow: homePalette.popoverShadow,
            padding: 12,
            display: 'grid',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <strong style={{ flex: 1 }}>
              {formatMonthDay(open.day)} 일정 {openList.length}건
            </strong>
            <button
              type="button"
              data-testid="dashboard-calendar-popover-close"
              onClick={() => setOpen(null)}
              style={{
                border: 0,
                background: 'transparent',
                color: calendarPalette.textSecondary,
                cursor: 'pointer',
              }}
            >
              {dashboardTexts.popoverClose}
            </button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {openList.map((item) => (
              <li
                key={`${item.oppId}-${item.dueAt}-${item.note}`}
                data-testid="dashboard-calendar-popover-item"
                style={{ display: 'grid', gap: 2 }}
              >
                <span>
                  {item.overdue ? (
                    <span
                      data-testid="dashboard-schedule-overdue"
                      style={{
                        background: calendarPalette.tones.overdue.bg,
                        color: calendarPalette.tones.overdue.fg,
                        borderRadius: radius.tag,
                        padding: '0 6px',
                        marginRight: 6,
                        fontSize: typography.fontSizeSecondary,
                      }}
                    >
                      {dashboardTexts.scheduleOverdue}
                    </span>
                  ) : null}
                  <strong>{item.customerName}</strong>
                </span>
                <span style={{ color: calendarPalette.textSecondary }}>{item.oppTitle}</span>
                <span>{item.note}</span>
                <Link
                  to={`/opportunities/${encodeURIComponent(item.oppId)}`}
                  style={{ color: calendarPalette.link }}
                >
                  {dashboardTexts.popoverDetail}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** "2026-12-23" → "12월 23일 (수)". 날짜 글이 아니면 그대로. */
export function popoverDayTitle(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return dashboardTexts.calendarPopoverDay(Number(m[2]), Number(m[3]), WEEKDAYS[weekday]);
}

/**
 * #983 작은 달력의 작은 창: 머리 "12월 23일 (수) · 일정 2건(없으면 일정 없음) · ×", 그날 일정(회사 링크 · 내용 · 지남),
 * 그 아래 끼울 것(extra). 화면을 가리는 창이 아니다(aria-modal=false).
 */
function MiniPopover({
  open,
  list,
  side,
  onClose,
  extra,
}: {
  open: Open;
  list: DashboardScheduleItem[];
  side: 'right' | 'below';
  onClose: () => void;
  extra?: (day: string) => ReactNode;
}) {
  const right = side === 'right';
  const up = right && open.bottom !== undefined;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`${popoverDayTitle(open.day)} ${
        list.length > 0
          ? dashboardTexts.calendarPopoverCount(list.length)
          : dashboardTexts.calendarPopoverNone
      }`}
      data-testid="dashboard-calendar-popover"
      data-side={side}
      style={{
        position: 'absolute',
        ...(right
          ? {
              left: `calc(100% + ${sideCalendar.popoverGap}px)`,
              ...(up ? { bottom: open.bottom } : { top: open.top }),
              width: sideCalendar.popoverWidth,
            }
          : {
              left: open.left,
              top: open.top,
              width: `min(${sideCalendar.popoverWidth}px, 100%)`,
            }),
        boxSizing: 'border-box',
        zIndex: 10,
        background: sideCalendar.popoverBg,
        border: `1px solid ${sideCalendar.popoverBorder}`,
        color: calendarPalette.title,
        borderRadius: sideCalendar.popoverRadius,
        boxShadow: sideCalendar.popoverShadow,
        padding: 14,
        display: 'grid',
        gap: 10,
        fontSize: typography.fontSizeSecondary,
        lineHeight: 1.5,
      }}
    >
      {right ? (
        // 달력 쪽을 가리키는 작은 꼬리(꾸밈).
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -7,
            ...(up ? { bottom: 18 } : { top: 18 }),
            width: 12,
            height: 12,
            background: sideCalendar.popoverBg,
            borderLeft: `1px solid ${sideCalendar.popoverBorder}`,
            borderBottom: `1px solid ${sideCalendar.popoverBorder}`,
            transform: 'rotate(45deg)',
          }}
        />
      ) : null}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b data-testid="dashboard-calendar-popover-title" style={{ fontSize: 15 }}>
          {popoverDayTitle(open.day)}
        </b>
        <span
          data-testid="dashboard-calendar-popover-count"
          style={{ fontSize: typography.fontSizeSecondary - 1, color: calendarPalette.weekday }}
        >
          {list.length > 0
            ? dashboardTexts.calendarPopoverCount(list.length)
            : dashboardTexts.calendarPopoverNone}
        </span>
        <button
          type="button"
          aria-label={dashboardTexts.popoverClose}
          data-testid="dashboard-calendar-popover-close"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            border: 0,
            background: 'none',
            padding: '0 4px',
            fontSize: 16,
            fontFamily: 'inherit',
            color: calendarPalette.weekday,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
      {list.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {list.map((item) => (
            <li
              key={`${item.oppId}-${item.dueAt}-${item.note}`}
              data-testid="dashboard-calendar-popover-item"
            >
              {item.overdue ? (
                <span
                  data-testid="dashboard-schedule-overdue"
                  style={{
                    background: calendarPalette.tones.overdue.bg,
                    color: calendarPalette.tones.overdue.fg,
                    borderRadius: radius.tag,
                    padding: '0 6px',
                    marginRight: 6,
                    fontSize: typography.fontSizeSecondary - 1,
                    fontWeight: 600,
                  }}
                >
                  {dashboardTexts.scheduleOverdue}
                </span>
              ) : null}
              <Link
                to={`/opportunities/${encodeURIComponent(item.oppId)}`}
                style={{ color: calendarPalette.link, fontWeight: 600 }}
              >
                {item.customerName}
              </Link>
              {item.note ? <span> · {item.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {extra ? <div data-testid="dashboard-calendar-popover-extra">{extra(open.day)}</div> : null}
    </div>
  );
}
