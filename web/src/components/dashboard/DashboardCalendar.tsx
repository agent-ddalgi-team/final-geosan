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
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import {
  accent,
  calendarPalette,
  colors,
  homePalette,
  radius,
  type CalendarTone,
  typography,
  warn,
} from '../../theme/tokens';

/** #972 점 달력 색. 점에는 글자를 올리지 않는다(강조 밝은 쪽 · 주의 점). 오늘 칸은 흰 글자가 올라가는 강조 바탕. */
export const DOT_COLORS = {
  todayBg: homePalette.blueStrong,
  todayFg: colors.bgContainer,
  weekBg: homePalette.blueBg,
  dot: accent.bright,
  dotOverdue: warn.dot,
} as const;
import { formatMonthDay } from '../../utils/time';
import { sortSchedule } from './ScheduleList';
import { PREP_DAYS } from './VisitPrep';

/** 두 날짜(YYYY-MM-DD) 사이 날 수(b - a). 날짜 글이 아니면 null. */
function dayDiff(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const x = parse(a);
  const y = parse(b);
  return x === null || y === null ? null : Math.round((y - x) / 86_400_000);
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
  /** #927 점 모양(영업 홈). 기본은 칸마다 색·건수. */
  dots?: boolean;
}

interface Open {
  day: string;
  left: number;
  top: number;
}

export default function DashboardCalendar({ items, today, compact = false, dots = false }: Props) {
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
    background: dots ? 'transparent' : calendarPalette.navBg,
    color: dots ? colors.textSecondary : calendarPalette.navFg,
    borderRadius: '50%',
    width: compact ? 28 : 40,
    height: compact ? 28 : 40,
    fontSize: compact ? 16 : 20,
    lineHeight: 1,
    cursor: 'pointer',
    flex: 'none',
  } as const;

  const openList = open ? sortSchedule(byDay.get(open.day) ?? []) : [];

  return (
    <div ref={wrapRef} data-testid="dashboard-calendar" style={{ position: 'relative' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 8 : 12 }}
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
            fontSize: dots ? typography.fontSize : compact ? 18 : 28,
            fontWeight: dots ? 700 : 500,
            lineHeight: 1.2,
          }}
        >
          {dots ? null : (
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
          {dots ? dashboardTexts.calendarDotsTitle(cursor.month + 1) : `${cursor.month + 1}월`}
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
          gap: 6,
          color: calendarPalette.weekday,
          fontSize: typography.fontSizeSecondary,
          textAlign: 'center',
          marginBottom: 6,
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
          gridTemplateRows: `repeat(${rows}, minmax(${dots ? 30 : compact ? 36 : 68}px, 1fr))`,
          gap: dots ? 2 : compact ? 4 : 6,
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
          if (dots) {
            // #929(시안 v3): 오늘부터 7일(이번 주 방문 목록과 같은 범위)은 연파랑 바탕.
            const offset = dayDiff(today, k);
            const thisWeek = offset !== null && offset >= 1 && offset < PREP_DAYS;
            const dotColor = isToday
              ? DOT_COLORS.todayFg
              : overdue
                ? DOT_COLORS.dotOverdue
                : DOT_COLORS.dot;
            const cell = {
              position: 'relative',
              boxSizing: 'border-box',
              minWidth: 0,
              border: 0,
              borderRadius: radius.controlSm,
              padding: '4px 0 10px',
              textAlign: 'center',
              fontFamily: 'inherit',
              fontSize: 12,
              background: isToday
                ? DOT_COLORS.todayBg
                : thisWeek
                  ? DOT_COLORS.weekBg
                  : 'transparent',
              color: isToday ? DOT_COLORS.todayFg : colors.text,
              fontWeight: isToday || list ? 700 : 400,
              outline: isSelected ? `2px solid ${colors.text}` : 'none',
              outlineOffset: 1,
            } as const;
            const dot = list ? (
              <span
                aria-hidden="true"
                data-testid={`dashboard-calendar-dot-${k}`}
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: 3,
                  width: 5,
                  height: 5,
                  marginLeft: -2.5,
                  borderRadius: '50%',
                  background: dotColor,
                }}
              />
            ) : null;
            if (!list || !tone) {
              return (
                <span
                  key={i}
                  data-testid={`dashboard-calendar-day-${k}`}
                  data-tone="none"
                  style={cell}
                >
                  {day}
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
                  const target = event.currentTarget;
                  const wrapWidth = wrapRef.current?.clientWidth ?? POPOVER_WIDTH;
                  const left = Math.max(
                    0,
                    Math.min(target.offsetLeft, wrapWidth - Math.min(POPOVER_WIDTH, wrapWidth)),
                  );
                  setOpen({ day: k, left, top: target.offsetTop + target.offsetHeight + 6 });
                }}
                style={{ ...cell, cursor: 'pointer' }}
              >
                {day}
                {dot}
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
      {dots ? (
        <ul
          aria-label={dashboardTexts.calendarLegendLabel}
          data-testid="dashboard-calendar-legend"
          style={{
            listStyle: 'none',
            margin: '8px 0 0',
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 12px',
            color: calendarPalette.textSecondary,
            fontSize: typography.fontSizeSecondary - 2,
          }}
        >
          {[
            [DOT_COLORS.dot, dashboardTexts.calendarDotHas, '50%'],
            [DOT_COLORS.dotOverdue, dashboardTexts.calendarDotOverdue, '50%'],
            [DOT_COLORS.weekBg, dashboardTexts.calendarThisWeek, '2px'],
          ].map(([color, label, round]) => (
            <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                aria-hidden="true"
                style={{
                  width: round === '50%' ? 6 : 10,
                  height: round === '50%' ? 6 : 8,
                  borderRadius: round,
                  background: color,
                }}
              />
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      <ul
        aria-label={dashboardTexts.calendarLegendLabel}
        data-testid={dots ? undefined : 'dashboard-calendar-legend'}
        style={{
          listStyle: 'none',
          margin: '12px 0 0',
          padding: 0,
          display: dots ? 'none' : 'flex',
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
      {byDay.size === 0 ? (
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
      {open ? (
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
