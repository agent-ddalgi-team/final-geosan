// 일정 달력(대시보드): 서버가 준 일정(`schedule`)의 날짜에 표시를 하고, 그 날을 누르면 작은 창(팝업)으로 일정 내용을 보인다.
// 새 API·필드 없이 이미 받은 일정만 쓴다. 팝업은 화면을 가리는 모달이 아니라 그 날짜 칸 바로 아래에 붙는 작은 창이다:
// [닫기]·Esc·바깥을 누르면 닫히고, 같은 날을 다시 눌러도 닫힌다.
// 색은 theme/tokens 조합만 쓴다: 기한 지남 = 연한 빨강, 예정 = 연한 파랑, 오늘 = 강조색 테두리, 고른 날 = 강조색 채움.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardScheduleItem } from '../../api/dashboardTypes';
import { brand } from '../../config/brand';
import { dashboardTexts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { sortSchedule } from './ScheduleList';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const POPOVER_WIDTH = 300;

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
    border: `1px solid ${colors.borderSecondary}`,
    background: colors.bgContainer,
    color: colors.text,
    borderRadius: 8,
    width: 32,
    height: 32,
    cursor: 'pointer',
  } as const;

  const openList = open ? sortSchedule(byDay.get(open.day) ?? []) : [];

  return (
    <div ref={wrapRef} data-testid="dashboard-calendar" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          aria-label="지난달"
          data-testid="dashboard-calendar-prev"
          onClick={() => move(-1)}
          style={navButton}
        >
          ‹
        </button>
        <strong data-testid="dashboard-calendar-title" style={{ flex: 1, textAlign: 'center' }}>
          {cursor.year}년 {cursor.month + 1}월
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
          gap: 4,
          color: colors.textSecondary,
          fontSize: typography.fontSizeSecondary,
          textAlign: 'center',
          marginBottom: 4,
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
          gridTemplateRows: `repeat(${rows}, minmax(44px, 1fr))`,
          gap: 4,
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
          const tone = overdue ? statusPalette.no : statusPalette.ask;
          const common = {
            position: 'relative',
            borderRadius: 8,
            border: isToday
              ? `2px solid ${brand.colorPrimary}`
              : `1px solid ${colors.borderSecondary}`,
            background: isSelected ? brand.colorPrimary : list ? tone.bg : colors.bgContainer,
            color: isSelected ? colors.bgContainer : list ? tone.fg : colors.text,
            fontSize: typography.fontSizeSecondary,
            fontWeight: list || isToday ? 700 : 400,
            padding: '4px 6px',
            textAlign: 'left',
          } as const;
          if (!list) {
            return (
              <span key={i} data-testid={`dashboard-calendar-day-${k}`} style={common}>
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
              {day}
              <span
                aria-hidden="true"
                style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 12, fontWeight: 400 }}
              >
                {list.length}건
              </span>
            </button>
          );
        })}
      </div>
      {byDay.size === 0 ? (
        <p
          data-testid="dashboard-schedule-empty"
          style={{ margin: '8px 0 0', color: colors.textSecondary }}
        >
          {dashboardTexts.calendarEmpty}
        </p>
      ) : (
        <p
          style={{
            margin: '8px 0 0',
            color: colors.textSecondary,
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
            background: colors.bgContainer,
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)',
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
                color: colors.textSecondary,
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
                        background: statusPalette.no.bg,
                        color: statusPalette.no.fg,
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
                <span style={{ color: colors.textSecondary }}>{item.oppTitle}</span>
                <span>{item.note}</span>
                <Link to={`/opportunities/${encodeURIComponent(item.oppId)}`}>
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
