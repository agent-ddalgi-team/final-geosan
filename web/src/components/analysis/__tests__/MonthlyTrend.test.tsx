// #802 월별 추세: 서버가 센 12개월 값을 달마다 막대 셋과 읽는 글로 보인다. 숫자는 가상이다.
import { render, screen } from '@testing-library/react';
import MonthlyTrend from '../MonthlyTrend';

const months = Array.from({ length: 12 }, (_, index) => {
  const month = ((index + 11) % 12) + 1;
  const year = month === 12 ? 2025 : 2026;
  return { month: `${year}-${String(month).padStart(2, '0')}`, contacted: 0, won: 0, lost: 0 };
});

it('달마다 "11월: 접촉 5 · 성사 1 · 거절 2"를 읽을 수 있게 보인다', () => {
  const rows = months.map((row) =>
    row.month === '2026-11' ? { ...row, contacted: 5, won: 1, lost: 2 } : row,
  );
  render(<MonthlyTrend rows={rows} />);
  const items = screen.getAllByTestId('monthly-trend-month');
  expect(items).toHaveLength(12);
  expect(items[0]).toHaveTextContent('12월');
  expect(items[11]).toHaveAttribute('aria-label', '11월: 접촉 5 · 성사 1 · 거절 2');
  expect(screen.getByTestId('monthly-trend')).toHaveTextContent('기간 선택과 상관없이');
});

it('기록이 없으면 빈 안내, 옛 서버(칸 없음)면 그리지 않는다', () => {
  const { rerender } = render(<MonthlyTrend rows={months} />);
  expect(screen.getByTestId('monthly-trend-empty')).toHaveTextContent(
    '최근 12개월에 접촉 기록이 없습니다.',
  );
  rerender(<MonthlyTrend rows={undefined} />);
  expect(screen.queryByTestId('monthly-trend')).not.toBeInTheDocument();
});
