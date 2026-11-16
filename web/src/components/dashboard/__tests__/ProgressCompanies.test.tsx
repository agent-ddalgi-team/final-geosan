// #800 대시보드 영업 진행 띠: 칸을 누르면 그 단계 회사가 펴지고, 멈춘 회사에 "⚠ 멈춘 회사"가 붙는다.
// 서버 응답은 가짜(실제 계산은 서버 시험 test_dashboard_progress.py).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CountCards from '../CountCards';
import ProgressCompanyList, { daysBetween, progressLine } from '../ProgressCompanyList';
import type { Dashboard, DashboardCounts, ProgressCompany } from '../../../api/dashboardTypes';

const counts: DashboardCounts = {
  BOOKMARKED: 9,
  NO_OPINION: 1,
  NEED_CHECK: 0,
  NOT_CONTACTED: 1,
  IN_CONTACT: 7,
  QUOTE_SAMPLE: 0,
  ON_HOLD: 1,
  DONE: 0,
  SCHEDULE_DUE: 0,
  WON: 0,
};

function company(name: string, extra: Partial<ProgressCompany> = {}): ProgressCompany {
  return {
    oppId: `opp-${name}`,
    customerName: name,
    lastContactAt: '2026-11-13',
    nextScheduleAt: null,
    nextScheduleNote: null,
    stalled: false,
    ...extra,
  };
}

const companies: Dashboard['progressCompanies'] = {
  NOT_CONTACTED: [company('가상미접촉', { lastContactAt: null })],
  IN_CONTACT: [
    company('가상멈춤', { lastContactAt: '2026-10-26', stalled: true }),
    company('가상코파스', { nextScheduleAt: '2026-11-18', nextScheduleNote: '방문' }),
    ...['가', '나', '다', '라', '마'].map((n) => company(`가상${n}`)),
  ],
  QUOTE_SAMPLE: [],
  WON: [],
  ON_HOLD: [company('가상보류')],
};

function renderBand(withCompanies = true) {
  render(
    <MemoryRouter>
      <CountCards
        counts={counts}
        part="progress"
        companies={withCompanies ? companies : undefined}
        today="2026-11-16"
      />
    </MemoryRouter>,
  );
}

it('Given 회사 목록이 온 서버 / When 접촉 칸을 누름 / Then 그 단계 회사가 띠 아래에 펴지고 다시 누르면 접힌다', async () => {
  renderBand();
  const cell = screen.getByTestId('dashboard-count-IN_CONTACT');
  expect(cell.tagName).toBe('BUTTON');
  expect(cell).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByTestId('dashboard-progress-open-hint')).toBeInTheDocument();
  await userEvent.click(cell);
  expect(cell).toHaveAttribute('aria-expanded', 'true');
  const panel = screen.getByTestId('dashboard-progress-companies-IN_CONTACT');
  expect(panel).toHaveTextContent('접촉 7곳');
  const rows = within(panel).getAllByTestId('dashboard-progress-company');
  // 앞 5곳 + [2곳 더 보기]
  expect(rows).toHaveLength(5);
  expect(rows[0]).toHaveTextContent('가상멈춤마지막 접촉 21일 전 · 일정 없음⚠ 멈춘 회사');
  expect(rows[1]).toHaveTextContent('가상코파스마지막 접촉 3일 전 · 다음 11/18 방문');
  expect(within(rows[1]).queryByTestId('dashboard-progress-stalled')).not.toBeInTheDocument();
  expect(within(rows[0]).getByRole('link')).toHaveAttribute(
    'href',
    `/opportunities/${encodeURIComponent('opp-가상멈춤')}`,
  );
  await userEvent.click(within(panel).getByTestId('dashboard-progress-more'));
  expect(within(panel).getAllByTestId('dashboard-progress-company')).toHaveLength(7);
  expect(within(panel).getByTestId('dashboard-progress-list-link-IN_CONTACT')).toHaveAttribute(
    'href',
    '/opportunities?filter=IN_CONTACT',
  );
  await userEvent.click(cell);
  expect(screen.queryByTestId('dashboard-progress-companies-IN_CONTACT')).not.toBeInTheDocument();
});

it('보류 n곳도 눌러 편다. 회사가 없는 칸은 "이 단계 회사가 없습니다"', async () => {
  renderBand();
  await userEvent.click(screen.getByTestId('dashboard-count-ON_HOLD'));
  expect(screen.getByTestId('dashboard-progress-companies-ON_HOLD')).toHaveTextContent(
    '보류 1곳가상보류',
  );
  await userEvent.click(screen.getByTestId('dashboard-count-QUOTE_SAMPLE'));
  expect(screen.getByTestId('dashboard-progress-companies-QUOTE_SAMPLE')).toHaveTextContent(
    '이 단계 회사가 없습니다.',
  );
  expect(screen.queryByTestId('dashboard-progress-companies-ON_HOLD')).not.toBeInTheDocument();
});

it('옛 서버라 회사 목록이 없으면 칸은 지금처럼 목록 링크다', () => {
  renderBand(false);
  expect(screen.getByTestId('dashboard-count-IN_CONTACT')).toHaveAttribute(
    'href',
    '/opportunities?filter=IN_CONTACT',
  );
  expect(screen.queryByTestId('dashboard-progress-open-hint')).not.toBeInTheDocument();
});

it('줄 글: 접촉 없음·오늘 접촉·일정 글 없는 일정', () => {
  expect(daysBetween('2026-11-13', '2026-11-16')).toBe(3);
  expect(progressLine(company('a', { lastContactAt: null }), '2026-11-16')).toBe(
    '아직 접촉 전 · 일정 없음',
  );
  expect(
    progressLine(
      company('a', { lastContactAt: '2026-11-16', nextScheduleAt: '2026-11-20' }),
      '2026-11-16',
    ),
  ).toBe('오늘 접촉 · 다음 11/20');
});

it('목록 줄은 회사 이름 링크와 날짜 글만 보인다(메모 칸이 없다)', () => {
  render(
    <MemoryRouter>
      <ProgressCompanyList
        band="WON"
        rows={[company('가상성사')]}
        today="2026-11-16"
        listHref="/opportunities?filter=WON"
      />
    </MemoryRouter>,
  );
  expect(screen.getByTestId('dashboard-progress-companies-WON')).toHaveTextContent('성사 1곳');
});
