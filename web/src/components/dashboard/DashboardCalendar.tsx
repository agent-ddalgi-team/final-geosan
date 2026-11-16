// 일정 달력(대시보드): 서버가 준 일정(`schedule`)의 날짜에 표시를 하고, 그 날을 누르면 작은 창(팝업)으로 일정 내용을 보인다.
// 새 API·필드 없이 이미 받은 일정만 쓴다. 팝업은 화면을 가리는 모달이 아니라 그 날짜 칸 바로 아래에 붙는 작은 창이다:
// [닫기]·Esc·바깥을 누르면 닫히고, 같은 날을 다시 눌러도 닫힌다.
// 모양(#758): 어두운 판 위 둥근 칸. 일정이 있는 날만 상태 색을 칠하고(기한 지남 = 갈색, 오늘 = 금색, 7일 안 = 연노랑,
// 그 뒤 = 연두) 왼쪽 위에 "N건", 왼쪽 아래에 두 자리 날짜("04")를 둔다. 일정 없는 날은 흐리게. 글자는 한글과 숫자만.
// 색은 theme/tokens의 calendarPalette만 쓴다.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { dashboardTexts } from '../../labels/ko';
import { calendarPalette, typography, type CalendarTone } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { sortSchedule } from './ScheduleList';

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
}

interface Open {
  day: string;
  left: number;
  top: number;
}

export default function DashboardCalendar({ items, today }: Props) {
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
    background: calendarPalette.navBg,
    color: calendarPalette.navFg,
    borderRadius: '50%',
    width: 40,
    height: 40,
    fontSize: 20,
    lineHeight: 1,
    cursor: 'pointer',
    flex: 'none',
  } as const;

  const openList = open ? sortSchedule(byDay.get(open.day) ?? []) : [];

  return (
    <div ref={wrapRef} data-testid="dashboard-calendar" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
            fontSize: 28,
            fontWeight: 500,
            lineHeight: 1.2,
          }}
        >
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
          {cursor.month + 1}월
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
          gridTemplateRows: `repeat(${rows}, minmax(68px, 1fr))`,
          gap: 6,
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
          const common = {
            position: 'relative',
            boxSizing: 'border-box',
            minWidth: 0,
            borderRadius: 12,
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
                left: 8,
                bottom: 6,
                fontSize: 15,
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
                  left: 6,
                  top: 6,
                  maxWidth: 'calc(100% - 12px)',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  borderRadius: 999,
                  padding: '1px 7px',
                  background: palette.badge,
                  fontSize: 12,
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
                borderRadius: 4,
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
            borderRadius: 14,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
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
                        borderRadius: 4,
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
