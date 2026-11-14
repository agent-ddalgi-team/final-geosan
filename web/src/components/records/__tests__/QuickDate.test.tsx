// #740(PM 지시 2026-11-14): 일정 날짜는 처음부터 펼쳐진 달력 하나 + [없음]으로 고른다.
// 예전의 "오늘부터 2주 날짜 단추"와 "다른 날짜" 칸은 같은 날짜를 고르는 길이 둘이라 겹쳐서 없앴다.
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickDate, { quickDateLabel } from '../QuickDate';
import { pickCalendarDate } from '../../../test/pickCalendarDate';

const TODAY = '2026-11-14';

function Harness({
  initial = '',
  min,
  disabled = false,
  withNone = true,
  onPicked = () => {},
}: {
  initial?: string;
  min?: string;
  disabled?: boolean;
  withNone?: boolean;
  onPicked?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [none, setNone] = useState(false);
  return (
    <QuickDate
      value={value}
      onChange={(next) => {
        setValue(next);
        onPicked(next);
      }}
      from={TODAY}
      none={none}
      onNone={withNone ? setNone : undefined}
      min={min}
      disabled={disabled}
      label="언제 할까요?"
      testId="quick"
    />
  );
}

describe('일정 날짜 달력 (#740)', () => {
  it('처음부터 이번 달 달력이 펼쳐져 있고, 2주 날짜 단추·"다른 날짜" 칸은 없다', () => {
    render(<Harness />);
    const root = screen.getByTestId('quick');
    expect(root).toHaveAttribute('data-month', '2026-11');
    expect(screen.getByTestId('quick-month')).toHaveTextContent('2026년 11월');
    // 이번 달 30일이 모두 보인다.
    expect(screen.getByTestId('quick-day-2026-11-01')).toBeInTheDocument();
    expect(screen.getByTestId('quick-day-2026-11-30')).toBeInTheDocument();
    expect(screen.queryByText('다른 날짜')).not.toBeInTheDocument();
    expect(root.querySelector('input[type="date"]')).toBeNull();
    // 오늘은 낭독기에 "오늘"로 읽힌다.
    expect(screen.getByTestId(`quick-day-${TODAY}`)).toHaveAccessibleName('11/14(토) 오늘');
    expect(screen.getByRole('group', { name: '언제 할까요?' })).toBeInTheDocument();
  });

  it('날짜를 누르면 그 날짜(YYYY-MM-DD, 시간 없음)가 실리고 "11/20(금)"처럼 글로도 보이며, 한 번 더 누르면 지워진다', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    render(<Harness onPicked={onPicked} />);
    await user.click(screen.getByTestId('quick-day-2026-11-20'));
    expect(onPicked).toHaveBeenLastCalledWith('2026-11-20');
    expect(screen.getByTestId('quick-day-2026-11-20')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('quick-picked')).toHaveTextContent('고른 날짜: 11/20(금)');

    await user.click(screen.getByTestId('quick-day-2026-11-20'));
    expect(onPicked).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('quick-day-2026-11-20')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('quick-picked')).not.toHaveTextContent('고른 날짜');
  });

  it('가장 이른 날(오늘)보다 앞 날짜는 눌러도 골라지지 않고, 이전 달로도 넘어가지 않는다', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    render(<Harness min={TODAY} onPicked={onPicked} />);
    const past = screen.getByTestId('quick-day-2026-11-13');
    expect(past).toBeDisabled();
    await user.click(past);
    expect(onPicked).not.toHaveBeenCalled();
    expect(screen.getByTestId(`quick-day-${TODAY}`)).toBeEnabled();
    expect(screen.getByTestId('quick-prev')).toBeDisabled();
  });

  it('[다음 달]로 넘겨 다음 달 날짜를 고를 수 있다', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    render(<Harness min={TODAY} onPicked={onPicked} />);
    await pickCalendarDate(user, 'quick', '2027-01-05');
    expect(screen.getByTestId('quick')).toHaveAttribute('data-month', '2027-01');
    expect(screen.getByTestId('quick-month')).toHaveTextContent('2027년 1월');
    expect(onPicked).toHaveBeenLastCalledWith('2027-01-05');
    expect(screen.getByTestId('quick-picked')).toHaveTextContent('고른 날짜: 1/5(화)');
  });

  it('이미 고른 날짜가 있으면 그 달이 펼쳐진다', () => {
    render(<Harness initial="2027-02-10" />);
    expect(screen.getByTestId('quick')).toHaveAttribute('data-month', '2027-02');
    expect(screen.getByTestId('quick-day-2027-02-10')).toHaveAttribute('aria-pressed', 'true');
  });

  it('[없음]을 누르면 고른 날짜가 비고, [없음] 뒤에 날짜를 고르면 [없음]이 풀린다', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    render(<Harness onPicked={onPicked} />);
    await user.click(screen.getByTestId('quick-day-2026-11-18'));
    await user.click(screen.getByTestId('quick-none'));
    expect(screen.getByTestId('quick-none')).toHaveAttribute('aria-pressed', 'true');
    expect(onPicked).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('quick-day-2026-11-18')).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByTestId('quick-day-2026-11-19'));
    expect(screen.getByTestId('quick-none')).toHaveAttribute('aria-pressed', 'false');
    expect(onPicked).toHaveBeenLastCalledWith('2026-11-19');
  });

  it('[없음]은 넘겨 줄 때만 보인다', () => {
    render(<Harness withNone={false} />);
    expect(screen.queryByTestId('quick-none')).not.toBeInTheDocument();
  });

  it('막혀 있으면 날짜·달 넘기기·[없음]을 누를 수 없다', async () => {
    const user = userEvent.setup();
    const onPicked = vi.fn();
    render(<Harness disabled onPicked={onPicked} />);
    expect(screen.getByTestId('quick-day-2026-11-20')).toBeDisabled();
    expect(screen.getByTestId('quick-next')).toBeDisabled();
    expect(screen.getByTestId('quick-prev')).toBeDisabled();
    expect(screen.getByTestId('quick-none')).toBeDisabled();
    await user.click(screen.getByTestId('quick-day-2026-11-20'));
    expect(onPicked).not.toHaveBeenCalled();
  });

  it('고른 날짜 글은 "11/20(금)"처럼 요일을 붙인다', () => {
    expect(quickDateLabel('2026-11-20')).toBe('11/20(금)');
    expect(quickDateLabel('2027-01-05')).toBe('1/5(화)');
  });
});
