// 일정 달력: 일정 날짜에 표시가 붙고, 날을 누르면 작은 창(팝업)에 내용이 보이며, 달을 넘겨 볼 수 있다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardCalendar from '../DashboardCalendar';
import type { DashboardScheduleItem } from '../../../api/dashboardTypes';

const item = (
  dueAt: string,
  overdue: boolean,
  oppId: string,
  customerName = '시험 회사',
): DashboardScheduleItem => ({
  oppId,
  customerName,
  oppTitle: '시험 건',
  dueAt,
  note: '전화',
  overdue,
  staffKey: 'park-lee',
});

const items = [
  item('2026-11-04', false, 'b', '예정 회사'),
  item('2026-11-04', true, 'a', '지난 회사'),
  item('2026-11-18', false, 'c'),
  item('2026-12-02', false, 'd'),
];

function renderCalendar(list = items) {
  return render(
    <MemoryRouter>
      <DashboardCalendar items={list} today="2026-11-11" />
    </MemoryRouter>,
  );
}

describe('DashboardCalendar', () => {
  it('오늘이 속한 달을 보이고, 일정이 있는 날만 누를 수 있는 단추로 건수를 알린다', () => {
    renderCalendar();
    expect(screen.getByTestId('dashboard-calendar-title')).toHaveTextContent('2026년 11월');
    const day4 = screen.getByTestId('dashboard-calendar-day-2026-11-04');
    expect(day4).toHaveAttribute('aria-label', '11월 4일 일정 2건 (기한 지남)');
    expect(day4.tagName).toBe('BUTTON');
    expect(screen.getByTestId('dashboard-calendar-day-2026-11-18')).toHaveAttribute(
      'aria-label',
      '11월 18일 일정 1건',
    );
    expect(screen.getByTestId('dashboard-calendar-day-2026-11-05').tagName).toBe('SPAN');
    expect(screen.queryByTestId('dashboard-calendar-day-2026-12-02')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
  });

  it('일정이 있는 날을 누르면 작은 창이 열려 그 날 일정(기한 지남이 맨 위)과 상세 보기 링크를 보인다', async () => {
    renderCalendar();
    await userEvent.click(screen.getByTestId('dashboard-calendar-day-2026-11-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAttribute('role', 'dialog');
    expect(popover).toHaveAttribute('aria-modal', 'false');
    expect(popover).toHaveTextContent('11/4 일정 2건');
    const rows = screen.getAllByTestId('dashboard-calendar-popover-item');
    expect(rows[0]).toHaveTextContent('지남지난 회사');
    expect(rows[1]).toHaveTextContent('예정 회사');
    expect(rows[1]).toHaveTextContent('시험 건');
    expect(rows[1]).toHaveTextContent('전화');
    expect(rows[1].querySelector('a')).toHaveAttribute('href', '/opportunities/b');
  });

  it('같은 날을 다시 누르거나 [닫기]·Esc·바깥을 누르면 닫힌다', async () => {
    renderCalendar();
    const day = screen.getByTestId('dashboard-calendar-day-2026-11-18');
    await userEvent.click(day);
    expect(screen.getByTestId('dashboard-calendar-popover')).toBeInTheDocument();
    await userEvent.click(day);
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(day);
    await userEvent.click(screen.getByTestId('dashboard-calendar-popover-close'));
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(day);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(day);
    await userEvent.click(document.body);
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
  });

  it('다음 달·지난달 단추로 달을 넘겨 보고, 달을 넘기면 열려 있던 팝업은 닫힌다', async () => {
    renderCalendar();
    await userEvent.click(screen.getByTestId('dashboard-calendar-day-2026-11-18'));
    await userEvent.click(screen.getByTestId('dashboard-calendar-next'));
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-calendar-title')).toHaveTextContent('2026년 12월');
    expect(screen.getByTestId('dashboard-calendar-day-2026-12-02')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('dashboard-calendar-prev'));
    await userEvent.click(screen.getByTestId('dashboard-calendar-prev'));
    expect(screen.getByTestId('dashboard-calendar-title')).toHaveTextContent('2026년 10월');
  });

  it('일정이 하나도 없어도 달력은 그려지고 안내 문구만 보인다', () => {
    renderCalendar([]);
    expect(screen.getByTestId('dashboard-calendar')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /일정 \d+건/ })).toHaveLength(0);
    expect(screen.getByTestId('dashboard-schedule-empty')).toBeInTheDocument();
  });
});
