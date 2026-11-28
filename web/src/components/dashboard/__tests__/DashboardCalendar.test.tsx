// 일정 달력: 일정 날짜에 표시가 붙고, 날을 누르면 작은 창(팝업)에 내용이 보이며, 달을 넘겨 볼 수 있다.
// #983: 작은 달력(mini) — 왼쪽 메뉴 아래와 좁은 기기의 영업 홈이 쓴다. 점 대신 칸 색, 어느 날짜든 누를 수 있다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardCalendar, { miniCellColors, popoverDayTitle } from '../DashboardCalendar';
import type { DashboardScheduleItem } from '../../../api/dashboardTypes';
import { accent, colors, sideCalendar, warn } from '../../../theme/tokens';

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

  it('일정이 있는 날만 상태 색을 칠한다: 기한 지남·오늘·7일 안·그 뒤, 일정 없는 날은 흐린 칸(#758)', () => {
    renderCalendar([
      item('2026-11-04', true, 'a'),
      item('2026-11-11', false, 'b'),
      item('2026-11-17', false, 'c'),
      item('2026-11-18', false, 'd'),
      item('2026-11-25', false, 'e'),
    ]);
    const tone = (d: string) =>
      screen.getByTestId(`dashboard-calendar-day-2026-11-${d}`).getAttribute('data-tone');
    expect(tone('04')).toBe('overdue');
    expect(tone('11')).toBe('today');
    expect(tone('17')).toBe('soon');
    expect(tone('18')).toBe('later');
    expect(tone('25')).toBe('later');
    expect(tone('05')).toBe('none');
    const empty = screen.getByTestId('dashboard-calendar-day-2026-11-05');
    const filled = screen.getByTestId('dashboard-calendar-day-2026-11-18');
    expect(Number(empty.style.opacity)).toBeLessThan(1);
    expect(empty.style.background).not.toBe(filled.style.background);
  });

  it('칸에는 두 자리 날짜와 "N건"을 한글·숫자로만 보이고, 아래에 색 설명 줄이 있다(#758)', () => {
    renderCalendar();
    const day4 = screen.getByTestId('dashboard-calendar-day-2026-11-04');
    expect(day4).toHaveTextContent('2건');
    expect(day4).toHaveTextContent('04');
    expect(screen.getByTestId('dashboard-calendar-day-2026-11-05')).toHaveTextContent(/^05$/);
    expect(screen.getByTestId('dashboard-calendar-legend')).toHaveTextContent(
      '기한 지남오늘7일 안그 뒤',
    );
    expect(screen.getByTestId('dashboard-calendar').textContent).not.toMatch(/[A-Za-z]/);
  });
});

describe('작은 달력 (#983 mini)', () => {
  function renderMini(
    props: Partial<React.ComponentProps<typeof DashboardCalendar>> = {},
    list = items,
  ) {
    return render(
      <MemoryRouter>
        <DashboardCalendar items={list} today="2026-11-11" mini {...props} />
      </MemoryRouter>,
    );
  }
  const day = (date: string) => screen.getByTestId(`dashboard-calendar-day-${date}`);
  const cell = (date: string) => screen.getByTestId(`dashboard-calendar-cell-${date}`);

  it('머리는 "11월 일정", 요일 줄과 날짜 칸(26×26, 글자 13)이 보이고, 그 달의 모든 날짜가 단추다', () => {
    renderMini();
    expect(screen.getByTestId('dashboard-calendar-title')).toHaveTextContent(/^11월 일정$/);
    expect(screen.getByTestId('dashboard-calendar')).toHaveTextContent('일월화수목금토');
    const grid = screen.getByRole('grid', { name: '2026년 11월 일정 달력' });
    const buttons = within(grid).getAllByRole('button');
    // 11월은 30일.
    expect(buttons).toHaveLength(30);
    expect(buttons.map((button) => button.textContent)).toEqual(
      Array.from({ length: 30 }, (_, index) => String(index + 1)),
    );
    expect(cell('2026-11-05')).toHaveStyle({
      width: `${sideCalendar.cellSize}px`,
      height: `${sideCalendar.cellSize}px`,
      fontSize: `${sideCalendar.cellFontSize}px`,
    });
    expect(sideCalendar.cellSize).toBe(26);
    expect(sideCalendar.cellFontSize).toBe(13);
  });

  it('점 대신 칸 색: 일정 있는 날 = 연보라 바탕 + 보라 굵은 숫자, 지난 일정이 남은 날 = 연주황 바탕 + 주황 굵은 숫자, 일정 없는 날 = 바탕 없이 보통 굵기', () => {
    renderMini();
    // 11/18: 예정 1건.
    expect(day('2026-11-18')).toHaveAttribute('data-tone', 'has');
    expect(cell('2026-11-18')).toHaveStyle({
      background: accent.softDeep,
      color: accent.text,
      fontWeight: '700',
    });
    // 11/4: 지난 일정이 남아 있다(같은 날 예정 일정이 있어도 지난 일정 색이 먼저다).
    expect(day('2026-11-04')).toHaveAttribute('data-tone', 'overdue');
    expect(cell('2026-11-04')).toHaveStyle({
      background: sideCalendar.overdue.bg,
      color: warn.text,
      fontWeight: '700',
    });
    expect(day('2026-11-05')).toHaveAttribute('data-tone', 'none');
    expect(cell('2026-11-05')).toHaveStyle({ color: colors.text, fontWeight: '400' });
    expect(cell('2026-11-05').style.background).toBe('transparent');
    // 점은 없다.
    expect(screen.queryByTestId('dashboard-calendar-dot-2026-11-18')).not.toBeInTheDocument();
    // 두 칸 색은 서로 다르다(색만 같아 구분이 안 되는 일이 없게).
    expect(sideCalendar.has.bg).not.toBe(sideCalendar.overdue.bg);
  });

  it('오늘은 얇은 안쪽 테두리로 구분하고, 화면 낭독기에는 "오늘"로 읽힌다', () => {
    renderMini();
    expect(day('2026-11-11')).toHaveAttribute('data-today', 'true');
    expect(day('2026-11-11')).toHaveAttribute('aria-current', 'date');
    expect(cell('2026-11-11').style.boxShadow).toContain('inset');
    expect(cell('2026-11-11').style.boxShadow).toContain(`${sideCalendar.todayRingWidth}px`);
    expect(day('2026-11-12')).not.toHaveAttribute('data-today');
    expect(cell('2026-11-12').style.boxShadow).toBe('none');
  });

  it('날짜 단추 이름: "11월 18일, 일정 1건" · "11월 4일, 일정 2건, 지난 일정 있음" · "11월 5일, 일정 없음" · 오늘은 "오늘"이 붙는다', () => {
    renderMini();
    expect(day('2026-11-18')).toHaveAttribute('aria-label', '11월 18일, 일정 1건');
    expect(day('2026-11-04')).toHaveAttribute('aria-label', '11월 4일, 일정 2건, 지난 일정 있음');
    expect(day('2026-11-05')).toHaveAttribute('aria-label', '11월 5일, 일정 없음');
    expect(day('2026-11-11')).toHaveAttribute('aria-label', '11월 11일, 오늘, 일정 없음');
  });

  it('달력 아래에 칸 색 풀이(일정 · 지난 일정)와 안내 한 줄이 있다(색만으로 알리지 않는다)', () => {
    renderMini();
    const legend = screen.getByTestId('dashboard-calendar-legend');
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['일정', '지난 일정']);
    const marks = legend.querySelectorAll('span[aria-hidden="true"]');
    expect(marks[0]).toHaveStyle({ background: sideCalendar.has.bg });
    expect(marks[1]).toHaveStyle({ background: sideCalendar.overdue.bg });
    expect(screen.getByTestId('dashboard-calendar-hint')).toHaveTextContent(
      /^날짜를 누르면 그날 일정이 보입니다$/,
    );
    // 예전 상태 색 풀이(기한 지남 · 오늘 · 7일 안 · 그 뒤)는 이 모양에서 보이지 않는다.
    expect(screen.getByTestId('dashboard-calendar')).not.toHaveTextContent('7일 안');
  });

  it('일정이 있는 날을 누르면 작은 창에 날짜 · 건수와 그날 일정(지난 일정 먼저, 회사 이름은 상세 링크 · 내용 · 지남 표시)이 보이고, 누른 날은 진한 보라 바탕 + 흰 숫자가 된다', async () => {
    renderMini();
    await userEvent.click(day('2026-11-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAttribute('role', 'dialog');
    expect(popover).toHaveAttribute('aria-modal', 'false');
    expect(popover).toHaveAccessibleName('11월 4일 (수) 일정 2건');
    expect(within(popover).getByTestId('dashboard-calendar-popover-title')).toHaveTextContent(
      /^11월 4일 \(수\)$/,
    );
    expect(within(popover).getByTestId('dashboard-calendar-popover-count')).toHaveTextContent(
      /^일정 2건$/,
    );
    const rows = within(popover).getAllByTestId('dashboard-calendar-popover-item');
    expect(rows.map((row) => row.textContent)).toEqual([
      '지남지난 회사 · 전화',
      '예정 회사 · 전화',
    ]);
    expect(within(rows[0]).getByRole('link', { name: '지난 회사' })).toHaveAttribute(
      'href',
      '/opportunities/a',
    );
    expect(within(rows[1]).getByRole('link', { name: '예정 회사' })).toHaveAttribute(
      'href',
      '/opportunities/b',
    );
    expect(within(rows[1]).queryByTestId('dashboard-schedule-overdue')).not.toBeInTheDocument();
    // 누른 날: 지난 일정 색보다 "누른 날" 색이 먼저다.
    expect(day('2026-11-04')).toHaveAttribute('aria-pressed', 'true');
    expect(cell('2026-11-04')).toHaveStyle({
      background: accent.bg,
      color: accent.onBg,
      fontWeight: '700',
    });
  });

  it('일정이 없는 날도 누를 수 있고, 작은 창에 "일정 없음"이라고 보인다(일정 목록은 그리지 않는다)', async () => {
    renderMini();
    await userEvent.click(day('2026-11-05'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    expect(popover).toHaveAccessibleName('11월 5일 (목) 일정 없음');
    expect(within(popover).getByTestId('dashboard-calendar-popover-count')).toHaveTextContent(
      /^일정 없음$/,
    );
    expect(within(popover).queryByRole('list')).not.toBeInTheDocument();
    expect(within(popover).queryByRole('link')).not.toBeInTheDocument();
    expect(cell('2026-11-05')).toHaveStyle({ background: accent.bg, color: accent.onBg });
    // 일정이 하나도 없는 달력도 같다.
  });

  it('일정이 하나도 없어도 달력은 그려지고, 어느 날을 눌러도 "일정 없음"이다', async () => {
    renderMini({}, []);
    expect(within(screen.getByRole('grid')).getAllByRole('button')).toHaveLength(30);
    await userEvent.click(day('2026-11-20'));
    expect(screen.getByTestId('dashboard-calendar-popover-count')).toHaveTextContent(/^일정 없음$/);
  });

  it('같은 날을 다시 누르거나 [×]·Esc·바깥을 누르면 닫히고, 달을 넘겨도 닫힌다', async () => {
    renderMini();
    const target = day('2026-11-18');
    await userEvent.click(target);
    expect(screen.getByTestId('dashboard-calendar-popover')).toBeInTheDocument();
    await userEvent.click(target);
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(target);
    const close = screen.getByTestId('dashboard-calendar-popover-close');
    expect(close).toHaveAccessibleName('닫기');
    await userEvent.click(close);
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(target);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(target);
    await userEvent.click(document.body);
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();

    await userEvent.click(target);
    await userEvent.click(screen.getByTestId('dashboard-calendar-next'));
    expect(screen.queryByTestId('dashboard-calendar-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-calendar-title')).toHaveTextContent(/^12월 일정$/);
    // 12월은 31일, 12/2에 일정이 있다.
    expect(within(screen.getByRole('grid')).getAllByRole('button')).toHaveLength(31);
    expect(day('2026-12-02')).toHaveAttribute('aria-label', '12월 2일, 일정 1건');
  });

  it('작은 창은 달력 오른쪽(왼쪽 메뉴)이나 날짜 아래에 뜬다', async () => {
    const view = renderMini({ popoverSide: 'right' });
    await userEvent.click(day('2026-11-18'));
    const right = screen.getByTestId('dashboard-calendar-popover');
    expect(right).toHaveAttribute('data-side', 'right');
    expect(right.style.left).toBe(`calc(100% + ${sideCalendar.popoverGap}px)`);
    expect(right.style.width).toBe(`${sideCalendar.popoverWidth}px`);
    view.unmount();
    renderMini();
    await userEvent.click(day('2026-11-18'));
    const below = screen.getByTestId('dashboard-calendar-popover');
    expect(below).toHaveAttribute('data-side', 'below');
    expect(below.style.width).toBe(`min(${sideCalendar.popoverWidth}px, 100%)`);
  });

  it('작은 창 본문 아래에 끼울 자리(날짜 메모 #984): 넘겨받은 것을 그날 날짜와 함께 그리고, 없으면 자리도 없다', async () => {
    const extra = vi.fn((date: string) => (
      <span data-testid="memo-slot">{`메모 자리 ${date}`}</span>
    ));
    const view = renderMini({ extra });
    await userEvent.click(day('2026-11-04'));
    const popover = screen.getByTestId('dashboard-calendar-popover');
    const slot = within(popover).getByTestId('dashboard-calendar-popover-extra');
    expect(slot).toHaveTextContent(/^메모 자리 2026-11-04$/);
    // 일정 목록 아래에 놓인다.
    const lastRow = within(popover).getAllByTestId('dashboard-calendar-popover-item').at(-1)!;
    expect(lastRow.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 일정이 없는 날에도 자리가 있다.
    await userEvent.click(day('2026-11-05'));
    expect(screen.getByTestId('memo-slot')).toHaveTextContent('메모 자리 2026-11-05');
    expect(extra).toHaveBeenLastCalledWith('2026-11-05');
    view.unmount();
    renderMini();
    await userEvent.click(day('2026-11-04'));
    expect(screen.queryByTestId('dashboard-calendar-popover-extra')).not.toBeInTheDocument();
  });

  it('miniCellColors · popoverDayTitle', () => {
    expect(miniCellColors('has', false)).toEqual(sideCalendar.has);
    expect(miniCellColors('overdue', false)).toEqual(sideCalendar.overdue);
    expect(miniCellColors('none', false)).toEqual(sideCalendar.plain);
    expect(miniCellColors('overdue', true)).toEqual(sideCalendar.selected);
    expect(miniCellColors('none', true)).toEqual(sideCalendar.selected);
    expect(popoverDayTitle('2026-12-23')).toBe('12월 23일 (수)');
    expect(popoverDayTitle('2026-11-01')).toBe('11월 1일 (일)');
    expect(popoverDayTitle('날짜 아님')).toBe('날짜 아님');
  });
});
