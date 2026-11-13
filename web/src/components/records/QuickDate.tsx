// 날짜를 바로 고르는 줄(#691, PM 결정 2026-11-13): 달력을 눌러 여는 대신 오늘부터 2주를 단추로 펼쳐 보인다.
// 그 밖의 날짜는 옆의 "다른 날짜" 칸에서 고르고, 일정이 없으면 [없음]으로 지나간다.
// 다음 일정 저장 칸은 날짜만 받는다(시간 없음, 약속 C1 /outcomes).
import { Input } from 'antd';
import { salesQuestionTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';

/** 바로 고를 수 있게 펼쳐 보이는 날 수(오늘 포함 2주). */
export const QUICK_DATE_DAYS = 14;

/** from(YYYY-MM-DD)부터 count일의 날짜. 날짜만 다루므로 시간대 계산 없이 센다. */
export function quickDates(from: string, count = QUICK_DATE_DAYS): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  if (!match) return [];
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/** "11/20(금)" */
export function quickDateLabel(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${formatMonthDay(date) ?? date}(${texts.weekdays[day]})`;
}

export interface QuickDateProps {
  /** 고른 날짜(YYYY-MM-DD). 안 골랐으면 빈 값. */
  value: string;
  onChange: (value: string) => void;
  /** 오늘(한국 시간). 이 날부터 2주를 펼친다. */
  from: string;
  /** [없음]을 눌렀는지. onNone이 있을 때만 단추가 보인다. */
  none?: boolean;
  onNone?: (none: boolean) => void;
  disabled?: boolean;
  /** 낭독기용 이름("언제 할까요?"). */
  label: string;
  /** "다른 날짜" 칸에서 고를 수 있는 가장 이른 날짜. 없으면 막지 않는다. */
  inputMin?: string;
  /** "다른 날짜" 입력의 testid(전부터 쓰던 날짜 칸 이름을 그대로 쓴다). */
  inputTestId: string;
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

export default function QuickDate({
  value,
  onChange,
  from,
  none = false,
  onNone,
  disabled = false,
  label,
  inputMin,
  inputTestId,
  testId,
}: QuickDateProps) {
  const dates = quickDates(from);
  function pick(date: string) {
    onNone?.(false);
    // 고른 날짜를 한 번 더 누르면 지운다.
    onChange(date === value ? '' : date);
  }
  return (
    <div data-testid={testId} style={{ display: 'grid', gap: 8 }}>
      <div
        role="group"
        aria-label={`${label} ${texts.nextDateListLabel}`}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
      >
        {dates.map((date, index) => {
          const selected = !none && value === date;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => pick(date)}
              style={chip(selected, disabled)}
              data-testid={`${testId}-day-${date}`}
            >
              {index === 0 ? `${texts.nextDateToday} ` : ''}
              {quickDateLabel(date)}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span>{texts.nextDateOther}</span>
          <Input
            type="date"
            aria-label={`${label} ${texts.nextDateOther}`}
            style={{ width: 160 }}
            value={none ? '' : value}
            min={inputMin}
            onChange={(event) => {
              onNone?.(false);
              onChange(event.target.value);
            }}
            disabled={disabled}
            data-testid={inputTestId}
          />
        </label>
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
    </div>
  );
}
