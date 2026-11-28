// #802 월별 추세: 서버가 센 12개월 값을 달마다 읽는 글로 보인다. #972부터 접촉은 선 + 옅은 면으로 그리고
// 성사·거절은 달에 손을 올리면 뜨는 글·화면 읽기용 글·아래 요약 문장으로 전한다. 숫자는 가상이다.
import { render, screen } from '@testing-library/react';
import MonthlyTrend, { TREND_HEIGHT_SHORT, trendLinePath, trendPoints } from '../MonthlyTrend';

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

it('접촉한 회사 수를 선과 옅은 면으로 그린다: 가장 많은 달이 맨 위, 0곳인 달은 바닥, 달 칸 가운데를 지난다(#972)', () => {
  const rows = months.map((row) => {
    if (row.month === '2026-10') return { ...row, contacted: 10, won: 2, lost: 1 };
    if (row.month === '2026-11') return { ...row, contacted: 5, won: 1, lost: 2 };
    return row;
  });
  const points = trendPoints(rows);
  expect(points.map((point) => point.value)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 5]);
  // 가로: 600을 12칸으로 나눈 칸의 가운데(25, 75, …, 575).
  expect(points[0].x).toBe(25);
  expect(points[11].x).toBe(575);
  // 세로: 0곳 = 바닥(162), 가장 많은 달(10곳) = 맨 위(24), 5곳 = 그 한가운데(93).
  expect(points[0].y).toBe(162);
  expect(points[10].y).toBe(24);
  expect(points[11].y).toBe(93);

  render(<MonthlyTrend rows={rows} />);
  const line = screen.getByTestId('monthly-trend-path');
  expect(line).toHaveAttribute('d', trendLinePath(points));
  expect(line.getAttribute('d')).toContain('L525 24 L575 93');
  expect(line).toHaveAttribute('fill', 'none');
  // 면은 같은 선을 따라간 뒤 바닥으로 닫는다.
  expect(screen.getByTestId('monthly-trend-area').getAttribute('d')).toMatch(
    /^M25 162 .*L575 93 L575 170 L25 170 Z$/,
  );
  // 선이 그리지 않는 성사·거절은 달마다 손 올림 글(title)과 화면 읽기용 글(aria-label)로 그대로 전한다.
  const items = screen.getAllByTestId('monthly-trend-month');
  expect(items[10]).toHaveAttribute('aria-label', '10월: 접촉 10 · 성사 2 · 거절 1');
  expect(items[10]).toHaveAttribute('title', '10월: 접촉 10 · 성사 2 · 거절 1');
  expect(items[11]).toHaveAttribute('title', '11월: 접촉 5 · 성사 1 · 거절 2');
  expect(items[10]).toHaveAttribute('data-contacted', '10');
  // 그림 아래 요약 문장에도 12개월 성사·거절이 그대로 있다.
  expect(screen.getByTestId('monthly-trend-summary')).toHaveTextContent(
    '12개월 동안 성사 3곳 · 거절 3곳입니다.',
  );
  expect(screen.getByTestId('monthly-trend-legend')).toHaveTextContent('선 = 접촉한 회사 수');
});

it('접촉이 없고 성사·거절만 있는 달도 값을 지어내지 않는다: 선은 바닥, 글은 그대로', () => {
  const rows = months.map((row) => (row.month === '2026-11' ? { ...row, won: 1 } : row));
  render(<MonthlyTrend rows={rows} />);
  expect(trendPoints(rows).every((point) => point.y === 162)).toBe(true);
  expect(screen.getAllByTestId('monthly-trend-month')[11]).toHaveAttribute(
    'aria-label',
    '11월: 접촉 0 · 성사 1 · 거절 0',
  );
});

it('기록이 없으면 빈 안내, 옛 서버(칸 없음)면 그리지 않는다', () => {
  const { rerender } = render(<MonthlyTrend rows={months} />);
  expect(screen.getByTestId('monthly-trend-empty')).toHaveTextContent(
    '최근 12개월에 접촉 기록이 없습니다.',
  );
  expect(screen.queryByTestId('monthly-trend-line')).not.toBeInTheDocument();
  rerender(<MonthlyTrend rows={undefined} />);
  expect(screen.queryByTestId('monthly-trend')).not.toBeInTheDocument();
});

it('#983: 그림 높이를 주면 그 높이로 줄여 그리고(영업 홈은 절반쯤), 안 주면 지금 높이(170) 그대로다. 선의 값은 바뀌지 않는다', () => {
  const rows = months.map((row) => {
    if (row.month === '2026-10') return { ...row, contacted: 10, won: 2, lost: 1 };
    if (row.month === '2026-11') return { ...row, contacted: 5, won: 1, lost: 2 };
    return row;
  });
  const view = render(<MonthlyTrend rows={rows} />);
  const full = screen.getByTestId('monthly-trend-line');
  expect(full.style.height).toBe('170px');
  const path = screen.getByTestId('monthly-trend-path').getAttribute('d');
  const labels = screen
    .getAllByTestId('monthly-trend-month')
    .map((month) => month.getAttribute('aria-label'));
  view.unmount();
  render(<MonthlyTrend rows={rows} height={TREND_HEIGHT_SHORT} />);
  const short = screen.getByTestId('monthly-trend-line');
  expect(short.style.height).toBe(`${TREND_HEIGHT_SHORT}px`);
  expect(TREND_HEIGHT_SHORT).toBeGreaterThanOrEqual(170 * 0.4);
  expect(TREND_HEIGHT_SHORT).toBeLessThanOrEqual(170 * 0.6);
  // 달 칸의 손 올림 자리도 같은 높이라 그림과 어긋나지 않는다.
  const spacer = screen.getAllByTestId('monthly-trend-month')[0].querySelector('span');
  expect(spacer).toHaveStyle({ height: `${TREND_HEIGHT_SHORT}px` });
  // 세로로만 줄인다: 선 좌표와 달마다 읽히는 값은 그대로다.
  expect(screen.getByTestId('monthly-trend-path').getAttribute('d')).toBe(path);
  expect(
    screen.getAllByTestId('monthly-trend-month').map((month) => month.getAttribute('aria-label')),
  ).toEqual(labels);
});
