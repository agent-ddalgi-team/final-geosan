// 일정 날짜 고르기(#740, PM 지시 2026-11-14): 처음부터 펼쳐진 작은 달력 하나 + [없음].
// 전(#691)에는 오늘부터 2주 날짜 단추와 "다른 날짜" 칸을 함께 보였는데, 같은 날짜를 고르는 길이 둘이라 겹쳤다.
// #691 결정("다음 일정은 달력이 바로 열려 있고 없으면 '없음'으로 지나간다")을 그대로 따른다.
// 다음 일정 저장 칸은 날짜만 받는다(시간 없음, 약속 C1 /outcomes).
import { useState } from 'react';
import { Button, Calendar } from 'antd';
// dayjs는 antd 달력이 쓰는 날짜 도구다(antd와 함께 설치돼 있어 새로 더하지 않았다).
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { salesQuestionTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

const DAY = 'YYYY-MM-DD';
const MONTH = 'YYYY-MM';

/** "11/20(금)" */
export function quickDateLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${formatMonthDay(date) ?? date}(${texts.weekdays[day]})`;
}

/** "2026-11"에서 step달 옮긴 달. */
function shiftMonth(month: string, step: number): string {
  return dayjs(`${month}-01`).add(step, 'month').format(MONTH);
}

export interface QuickDateProps {
  /** 고른 날짜(YYYY-MM-DD). 안 골랐으면 빈 값. */
  value: string;
  onChange: (value: string) => void;
  /** 오늘(한국 시간). 달력에 "오늘"을 표시하고, 고른 날짜가 없으면 이 달을 펼친다. */
  from: string;
  /** [없음]을 눌렀는지. onNone이 있을 때만 단추가 보인다. */
  none?: boolean;
  onNone?: (none: boolean) => void;
  disabled?: boolean;
  /** 낭독기용 이름("언제 할까요?"). */
  label: string;
  /** 고를 수 있는 가장 이른 날짜. 없으면 막지 않는다. */
  min?: string;
  testId: string;
}

const chip = (selected: boolean, disabled: boolean) =>
  ({
    minHeight: 32,
    padding: '0 8px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : colors.border}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : colors.text,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    fontWeight: selected ? 700 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }) as const;

const day = (selected: boolean, today: boolean, off: boolean) =>
  ({
    width: 32,
    height: 32,
    margin: '0 auto',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: `1px solid ${selected || today ? colors.text : 'transparent'}`,
    background: selected ? colors.text : 'transparent',
    color: selected ? colors.bgContainer : off ? colors.textDimmed : colors.text,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    fontWeight: selected || today ? 700 : 400,
    cursor: off ? 'not-allowed' : 'pointer',
    textDecoration: off && !selected ? 'line-through' : 'none',
  }) as const;

export default function QuickDate({
  value,
  onChange,
  from,
  none = false,
  onNone,
  disabled = false,
  label,
  min,
  testId,
}: QuickDateProps) {
  // 펼쳐 보이는 달. 고른 날짜가 있으면 그 달, 없으면 오늘이 든 달.
  const [view, setView] = useState(() => (value || from || dayjs().format(DAY)).slice(0, 7));
  // 바깥에서 날짜가 바뀌면(저장 뒤 새 일정 등) 그 달로 옮긴다.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value) setView(value.slice(0, 7));
  }
  const minMonth = min ? min.slice(0, 7) : '';
  const blocked = (date: string) => disabled || (min ? date < min : false);

  function pick(date: string) {
    onNone?.(false);
    // 고른 날짜를 한 번 더 누르면 지운다.
    onChange(date === value ? '' : date);
  }

  function cell(current: Dayjs) {
    const date = current.format(DAY);
    // 앞뒤 달의 날은 흐리게만 보인다(누르면 그 달로 넘어가며 골라진다).
    if (!date.startsWith(view)) {
      return (
        <div aria-hidden="true" style={{ ...day(false, false, true), textDecoration: 'none' }}>
          {current.date()}
        </div>
      );
    }
    const selected = !none && value === date;
    const today = date === from;
    const off = blocked(date);
    return (
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${quickDateLabel(date)}${today ? ` ${texts.nextDateToday}` : ''}`}
        disabled={off}
        style={day(selected, today, off)}
        data-testid={`${testId}-day-${date}`}
      >
        {current.date()}
      </button>
    );
  }

  const [year, month] = view.split('-').map(Number);
  return (
    <div
      data-testid={testId}
      data-month={view}
      style={{ display: 'grid', gap: 8, width: '100%', maxWidth: 320 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span data-testid={`${testId}-picked`} aria-live="polite">
          {none ? '' : value ? texts.calendarPicked(quickDateLabel(value)) : texts.calendarPickHint}
        </span>
        {onNone ? (
          <button
            type="button"
            aria-pressed={none}
            disabled={disabled}
            onClick={() => {
              onNone(!none);
              onChange('');
            }}
            style={chip(none, disabled)}
            data-testid={`${testId}-none`}
          >
            {texts.nextDateNone}
          </button>
        ) : null}
      </div>
      <div
        role="group"
        aria-label={label}
        style={{
          border: `1px solid ${colors.borderSecondary}`,
          borderRadius: 8,
          padding: '4px 8px 8px',
          background: colors.bgContainer,
        }}
      >
        <Calendar
          fullscreen={false}
          value={dayjs(`${view}-01`)}
          disabledDate={(current) => blocked(current.format(DAY))}
          fullCellRender={(current, info) =>
            info.type === 'date' ? cell(current) : info.originNode
          }
          onSelect={(current, { source }) => {
            if (source !== 'date' || blocked(current.format(DAY))) return;
            setView(current.format(MONTH));
            pick(current.format(DAY));
          }}
          headerRender={() => (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 0',
              }}
            >
              <Button
                type="text"
                size="small"
                aria-label={texts.calendarPrev}
                disabled={disabled || (minMonth !== '' && view <= minMonth)}
                onClick={() => setView(shiftMonth(view, -1))}
                data-testid={`${testId}-prev`}
              >
                ‹
              </Button>
              <span style={{ fontWeight: 700 }} data-testid={`${testId}-month`}>
                {texts.calendarMonth(year, month)}
              </span>
              <Button
                type="text"
                size="small"
                aria-label={texts.calendarNext}
                disabled={disabled}
                onClick={() => setView(shiftMonth(view, 1))}
                data-testid={`${testId}-next`}
              >
                ›
              </Button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
