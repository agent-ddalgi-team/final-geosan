// 기간 선택(#760): 미리 정한 기간·직접 넣은 날짜를 알리고, 시작일 > 끝일은 막는다. 오늘은 2026-11-15로 고정한다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PeriodPicker, { presetPeriod } from '../PeriodPicker';
import { accent, choiceChip } from '../../../theme/tokens';

const TODAY = '2026-11-15';

describe('PeriodPicker', () => {
  it('미리 정한 기간의 양끝을 오늘 기준으로 계산한다', () => {
    expect(presetPeriod('ALL', TODAY)).toEqual({ from: null, to: null });
    expect(presetPeriod('DAYS_30', TODAY)).toEqual({ from: '2026-10-17', to: TODAY });
    expect(presetPeriod('MONTHS_3', TODAY)).toEqual({ from: '2026-08-16', to: TODAY });
    expect(presetPeriod('THIS_MONTH', TODAY)).toEqual({ from: '2026-11-01', to: TODAY });
    expect(presetPeriod('THIS_YEAR', TODAY)).toEqual({ from: '2026-01-01', to: TODAY });
  });

  it('둥근 칸에 지금 기간을 한글·숫자로 보이고, 누르면 고르는 창이 열려 [최근 30일]을 고르면 알리고 닫힌다', async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker
        value={{ from: '2026-09-01', to: '2026-11-15' }}
        onChange={onChange}
        today={TODAY}
      />,
    );
    expect(screen.getByTestId('period-picker-text')).toHaveTextContent(
      '2026년 9월 1일 ~ 11월 15일',
    );
    expect(screen.getByTestId('period-picker-text').textContent).not.toMatch(/[A-Za-z]/);
    await userEvent.click(screen.getByTestId('period-picker-button'));
    expect(screen.getByTestId('period-picker-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('period-preset-DAYS_30'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10-17', to: TODAY });
    expect(screen.queryByTestId('period-picker-panel')).not.toBeInTheDocument();
  });

  it('지금 기간과 같은 미리 정한 기간은 고른 선택 단추 모양(강조 연한 바탕 + 강조 글자), 나머지는 흰 단추다(#972)', async () => {
    render(
      <PeriodPicker value={presetPeriod('THIS_MONTH', TODAY)} onChange={vi.fn()} today={TODAY} />,
    );
    await userEvent.click(screen.getByTestId('period-picker-button'));
    const picked = screen.getByTestId('period-preset-THIS_MONTH');
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    expect(picked).toHaveStyle({
      background: choiceChip.selected.bg,
      color: choiceChip.selected.fg,
    });
    const other = screen.getByTestId('period-preset-DAYS_30');
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other).toHaveStyle({ background: choiceChip.idle.bg, color: choiceChip.idle.fg });
    // [적용]은 주 단추(강조 바탕 + 흰 글자).
    expect(screen.getByTestId('period-apply')).toHaveStyle({
      background: accent.bg,
      color: accent.onBg,
    });
  });

  it('직접 넣은 날짜는 [적용]을 눌러야 알리고, 시작일이 끝일보다 뒤면 알림을 보이고 적용을 막는다', async () => {
    const onChange = vi.fn();
    render(<PeriodPicker value={{ from: null, to: null }} onChange={onChange} today={TODAY} />);
    expect(screen.getByTestId('period-picker-text')).toHaveTextContent('전체 기간');
    await userEvent.click(screen.getByTestId('period-picker-button'));
    expect(screen.getByTestId('period-preset-ALL')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.type(screen.getByTestId('period-from'), '2026-11-10');
    await userEvent.type(screen.getByTestId('period-to'), '2026-11-01');
    expect(screen.getByTestId('period-invalid')).toHaveTextContent('시작일이 끝일보다 뒤입니다.');
    expect(screen.getByTestId('period-apply')).toBeDisabled();
    await userEvent.clear(screen.getByTestId('period-to'));
    await userEvent.type(screen.getByTestId('period-to'), '2026-11-12');
    await userEvent.click(screen.getByTestId('period-apply'));
    expect(onChange).toHaveBeenCalledWith({ from: '2026-11-10', to: '2026-11-12' });
  });

  it('Esc나 바깥을 누르면 아무것도 알리지 않고 닫힌다', async () => {
    const onChange = vi.fn();
    render(<PeriodPicker value={{ from: null, to: null }} onChange={onChange} today={TODAY} />);
    await userEvent.click(screen.getByTestId('period-picker-button'));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('period-picker-panel')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('period-picker-button'));
    await userEvent.click(document.body);
    expect(screen.queryByTestId('period-picker-panel')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
