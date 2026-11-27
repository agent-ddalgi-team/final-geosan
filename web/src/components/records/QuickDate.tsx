// 일정 날짜 고르기(#740, PM 지시 2026-11-14): 처음부터 펼쳐진 작은 달력 하나 + [없음].
// 전(#691)에는 오늘부터 2주 날짜 단추와 "다른 날짜" 칸을 함께 보였는데, 같은 날짜를 고르는 길이 둘이라 겹쳤다.
// #691 결정("다음 일정은 달력이 바로 열려 있고 없으면 '없음'으로 지나간다")을 그대로 따른다.
// 달력은 새 패키지 없이 직접 그린다(PM 세션 결정 2026-11-14): antd 달력은 package.json에 없는 날짜 도구를
// 불러 써야 하고, 화면 시험을 크게 느리게 했다. 날짜는 "YYYY-MM-DD" 글자로만 다뤄 시간대 계산이 없다.
// 다음 일정 저장 칸은 날짜만 받는다(시간 없음, 약속 C1 /outcomes).
import { Button } from 'antd';
import { useState } from 'react';
import { salesQuestionTexts as texts } from '../../labels/ko';
import { accent, colors, radius, typography } from '../../theme/tokens';
import { choiceChipStyle } from './ChoiceChips';
import { formatMonthDay, todayKst } from '../../utils/time';

/** 한 장에 보이는 주 수. 달마다 높이가 달라지지 않게 늘 6주를 그린다. */
const WEEKS = 6;

/** "11/20(금)" */
export function quickDateLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${formatMonthDay(date) ?? date}(${texts.weekdays[day]})`;
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** "2026-11"에서 step달 옮긴 달. */
function shiftMonth(month: string, step: number): string {
  const [year, mon] = month.split('-').map(Number);
  return iso(Date.UTC(year, mon - 1 + step, 1)).slice(0, 7);
}

/** "2026-11"을 펼친 달력의 날짜 42개(일요일부터, 앞뒤 달의 날 포함). */
function monthCells(month: string): string[] {
  const [year, mon] = month.split('-').map(Number);
  const first = Date.UTC(year, mon - 1, 1);
  const start = first - new Date(first).getUTCDay() * 86_400_000;
  return Array.from({ length: WEEKS * 7 }, (_, index) => iso(start + index * 86_400_000));
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

// #972: 빠른 날짜 단추는 기록 칸의 선택 단추와 같은 모양(고르면 강조 연한 바탕 + 강조 테두리 + 굵은 강조 글자).
const chip = (selected: boolean, disabled: boolean) => ({
  ...choiceChipStyle(selected, disabled),
  padding: '0 8px',
});

// 달력 날짜 칸: 고른 날은 강조 바탕 + 흰 글자, 오늘은 강조 테두리 + 굵은 글자.
const day = (selected: boolean, today: boolean, off: boolean) =>
  ({
    width: 32,
    height: 32,
    margin: '0 auto',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.controlSm,
    border: `1px solid ${selected || today ? accent.bg : 'transparent'}`,
    background: selected ? accent.bg : 'transparent',
    color: selected ? accent.onBg : off ? colors.textDimmed : colors.text,
    font: 'inherit',
    fontSize: typography.fontSizeSecondary,
    fontWeight: selected || today ? 700 : 400,
    cursor: off ? 'not-allowed' : 'pointer',
    textDecoration: off && !selected ? 'line-through' : 'none',
  }) as const;

const cellStyle = (off: boolean) =>
  ({
    padding: '3px 0',
    textAlign: 'center',
    background: off ? colors.bgLayout : undefined,
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
  const [view, setView] = useState(() => (value || from || todayKst()).slice(0, 7));
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

  const cells = monthCells(view);
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
          borderRadius: radius.md,
          padding: '4px 8px 8px',
          background: colors.bgContainer,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 0',
            borderBottom: `1px solid ${colors.borderSecondary}`,
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
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {texts.weekdays.map((name) => (
                <th
                  key={name}
                  scope="col"
                  style={{
                    padding: '6px 0',
                    fontWeight: 400,
                    fontSize: typography.fontSizeSecondary,
                  }}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: WEEKS }, (_, week) => (
              <tr key={week}>
                {cells.slice(week * 7, week * 7 + 7).map((date) => {
                  const number = Number(date.slice(8));
                  // 앞뒤 달의 날은 흐리게만 보이고 누르지 않는다(다른 달은 ‹ › 로 넘긴다).
                  if (!date.startsWith(view)) {
                    return (
                      <td key={date} style={cellStyle(false)}>
                        <span
                          aria-hidden="true"
                          style={{ ...day(false, false, true), textDecoration: 'none' }}
                        >
                          {number}
                        </span>
                      </td>
                    );
                  }
                  const selected = !none && value === date;
                  const today = date === from;
                  const off = blocked(date);
                  return (
                    <td key={date} style={cellStyle(off && !disabled)}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${quickDateLabel(date)}${today ? ` ${texts.nextDateToday}` : ''}`}
                        disabled={off}
                        onClick={() => pick(date)}
                        style={day(selected, today, off)}
                        data-testid={`${testId}-day-${date}`}
                      >
                        {number}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
