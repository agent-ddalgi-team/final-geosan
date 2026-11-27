// 선택 단추 묶음(#972 새 시안): 하나만 고른다. 고른 단추는 강조 연한 바탕 + 강조 글자 굵게이고 aria-checked로도 알린다.
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { choiceChip } from '../../../theme/tokens';
import ChoiceChips from '../ChoiceChips';

const options = [
  { value: 'CALL', label: '전화' },
  { value: 'EMAIL', label: '메일' },
  { value: 'VISIT', label: '대면' },
];

function Harness({
  initial = null,
  disabled = false,
  onPick,
}: {
  initial?: string | null;
  disabled?: boolean;
  onPick?: (value: string) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <ChoiceChips
      label="종류"
      value={value}
      options={options}
      disabled={disabled}
      testId="chips"
      focusId="chips-entry"
      onChange={(next) => {
        onPick?.(next);
        setValue(next);
      }}
    />
  );
}

describe('ChoiceChips', () => {
  it('보기마다 단추가 있고, 처음에는 아무것도 골라져 있지 않을 수 있다', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: '종류' })).toBe(screen.getByTestId('chips'));
    const chips = screen.getAllByRole('radio');
    expect(chips.map((chip) => chip.textContent)).toEqual(['전화', '메일', '대면']);
    for (const chip of chips) expect(chip).not.toBeChecked();
    // 고른 것이 없으면 첫 단추가 Tab 자리이고 바깥에서 초점을 옮길 id도 거기에 붙는다.
    expect(chips[0]).toHaveAttribute('tabindex', '0');
    expect(chips[0]).toHaveAttribute('id', 'chips-entry');
    expect(chips[1]).toHaveAttribute('tabindex', '-1');
  });

  it('누르면 그 단추만 골라지고, 고른 단추는 강조 연한 바탕 + 굵은 강조 글자다', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initial="CALL" onPick={onPick} />);
    const [call, email] = screen.getAllByRole('radio');
    expect(call).toBeChecked();
    expect(call).toHaveStyle({
      background: choiceChip.selected.bg,
      color: choiceChip.selected.fg,
      fontWeight: choiceChip.selected.fontWeight,
    });
    expect(email).toHaveStyle({
      background: choiceChip.idle.bg,
      color: choiceChip.idle.fg,
      fontWeight: 400,
    });
    await user.click(email);
    expect(onPick).toHaveBeenCalledWith('EMAIL');
    expect(email).toBeChecked();
    expect(call).not.toBeChecked();
    // 고른 단추가 Tab 자리와 초점 id를 가져간다.
    expect(email).toHaveAttribute('id', 'chips-entry');
    expect(call).not.toHaveAttribute('id');
    // 이미 고른 단추를 다시 눌러도 바뀌었다고 알리지 않는다.
    await user.click(email);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('키보드: Tab으로 고른 단추에 들어가 화살표로 옮기며 고른다(끝에서 처음으로 돈다)', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initial="EMAIL" onPick={onPick} />);
    const [call, email, visit] = screen.getAllByRole('radio');
    await user.tab();
    expect(email).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(visit).toHaveFocus();
    expect(visit).toBeChecked();
    await user.keyboard('{ArrowRight}');
    expect(call).toHaveFocus();
    expect(call).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    expect(visit).toBeChecked();
    expect(onPick.mock.calls.map(([value]) => value)).toEqual(['VISIT', 'CALL', 'VISIT']);
  });

  it('잠그면 묶음과 단추가 모두 눌리지 않는다', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness initial="CALL" disabled onPick={onPick} />);
    expect(screen.getByTestId('chips')).toBeDisabled();
    const email = screen.getByRole('radio', { name: '메일' });
    expect(email).toBeDisabled();
    await user.click(email);
    expect(onPick).not.toHaveBeenCalled();
  });
});
