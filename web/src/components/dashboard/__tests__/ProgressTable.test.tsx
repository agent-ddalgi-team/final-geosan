// #921 영업 홈 "누가 봐도 · 진행 중인 회사" 표. 서버 응답은 손으로 만든 가상 값이다(실제 서버 계산은
// tests/unit/u7/test_dashboard_progress.py). 회사 이름은 모두 가상이다.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProgressTable, {
  STAGE_COLORS,
  TABLE_SHOWN,
  lastContactText,
  tableRows,
} from '../ProgressTable';
import type { Dashboard, ProgressCompany } from '../../../api/dashboardTypes';
import { dashboardTexts } from '../../../labels/ko';
import { choiceChip, tagPalette } from '../../../theme/tokens';

const TODAY = '2026-11-25';

function company(overrides: Partial<ProgressCompany> & { oppId: string }): ProgressCompany {
  return {
    customerName: `가상 ${overrides.oppId}`,
    lastContactAt: null,
    nextScheduleAt: null,
    nextScheduleNote: null,
    stalled: false,
    ...overrides,
  };
}

const companies: Dashboard['progressCompanies'] = {
  NOT_CONTACTED: [company({ oppId: 'n1', customerName: '가상미접촉' })],
  IN_CONTACT: [
    company({
      oppId: 'c1',
      customerName: '가상접촉',
      lastContactAt: '2026-11-18',
      lastContactMethod: 'CALL',
      lastContactStaffKey: 'park-lee',
      lastContactStaffName: '영업 담당',
      nextScheduleAt: '2026-11-28',
      nextScheduleNote: '전화',
    }),
    company({
      oppId: 'c2',
      customerName: '가상멈춤',
      lastContactAt: '2026-11-05',
      lastContactMethod: 'VISIT',
      lastContactStaffKey: 'kim-gwajang',
      lastContactStaffName: '검수 담당',
      stalled: true,
    }),
  ],
  QUOTE_SAMPLE: [
    company({
      oppId: 'q1',
      customerName: '가상견적',
      lastContactAt: '2026-11-14',
      lastContactMethod: 'EMAIL',
      lastContactStaffKey: 'park-lee',
      lastContactStaffName: '영업 담당',
      nextScheduleAt: '2026-11-21',
      nextScheduleNote: '견적 회신',
    }),
  ],
  WON: [company({ oppId: 'w1', customerName: '가상성사', lastContactAt: '2026-11-24' })],
  ON_HOLD: [company({ oppId: 'h1', customerName: '가상보류' })],
};

function renderTable(props: Partial<React.ComponentProps<typeof ProgressTable>> = {}): {
  onClearStage: ReturnType<typeof vi.fn>;
} {
  const onClearStage = vi.fn();
  render(
    <MemoryRouter>
      <ProgressTable
        companies={companies}
        today={TODAY}
        stage={null}
        onClearStage={onClearStage}
        staffKey="park-lee"
        {...props}
      />
    </MemoryRouter>,
  );
  return { onClearStage };
}

function rowTexts(): string[][] {
  return screen.getAllByTestId('dashboard-progress-row').map((row) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? ''),
  );
}

it('기본은 접촉 · 견적·샘플 · 성사 회사를 멈춘 회사 → 다음 일정 가까운 순으로 한 줄씩 보인다', () => {
  renderTable();
  expect(screen.getByTestId('dashboard-progress-table-count')).toHaveTextContent('4곳');
  expect(rowTexts()).toEqual([
    // #972: 멈춘 회사는 회사 이름 옆에 "멈춘 회사" 꼬리표가 붙는다(예전에는 노란 줄).
    ['가상멈춤멈춘 회사', '접촉', '검수 담당', '11/5 대면 · 20일 전', dashboardTexts.tableStalled],
    ['가상견적', '견적·샘플', '영업 담당', '11/14 메일 · 11일 전', '지난 일정 11/21'],
    ['가상접촉', '접촉', '영업 담당', '11/18 전화 · 7일 전', '11/28 전화'],
    ['가상성사', '성사', '—', '11/24 · 어제', '—'],
  ]);
  const stalled = screen.getAllByTestId('dashboard-progress-row')[0];
  expect(stalled).toHaveAttribute('data-stalled', 'true');
  expect(within(stalled).getByRole('link', { name: '가상멈춤' })).toHaveAttribute(
    'href',
    '/opportunities/c2',
  );
  expect(screen.queryByText('가상미접촉')).not.toBeInTheDocument();
  expect(screen.queryByText('가상보류')).not.toBeInTheDocument();
});

it('[내 회사만]은 마지막 접촉을 내가 적은 회사, [멈춘 회사만]은 멈춘 회사만 보인다', async () => {
  renderTable();
  await userEvent.click(screen.getByTestId('dashboard-progress-filter-mine'));
  expect(rowTexts().map((row) => row[0])).toEqual(['가상견적', '가상접촉']);
  await userEvent.click(screen.getByTestId('dashboard-progress-filter-stalled'));
  expect(rowTexts().map((row) => row[0])).toEqual(['가상멈춤멈춘 회사']);
  await userEvent.click(screen.getByTestId('dashboard-progress-filter-all'));
  expect(rowTexts()).toHaveLength(4);
});

it('담당자를 고르지 않았으면 [내 회사만]이 없다', () => {
  renderTable({ staffKey: null });
  expect(screen.queryByTestId('dashboard-progress-filter-mine')).not.toBeInTheDocument();
});

it('단계를 고르면 그 단계(보류 포함)만 보이고 [모든 단계 보기]로 푼다', async () => {
  const { onClearStage } = renderTable({ stage: 'ON_HOLD' });
  expect(rowTexts().map((row) => row[0])).toEqual(['가상보류']);
  expect(rowTexts()[0][3]).toBe(dashboardTexts.tableNoContact);
  await userEvent.click(screen.getByRole('button', { name: dashboardTexts.tableStageClear }));
  expect(onClearStage).toHaveBeenCalledTimes(1);
});

it('조건에 맞는 회사가 없으면 빈 안내 한 줄', async () => {
  renderTable({ companies: { IN_CONTACT: [] } });
  expect(screen.getByTestId('dashboard-progress-table-empty')).toHaveTextContent(
    dashboardTexts.tableEmpty,
  );
});

it(`${TABLE_SHOWN}곳을 넘으면 앞 ${TABLE_SHOWN}곳만 보이고 [모두 보기]로 편 뒤 [접기]로 접는다`, async () => {
  const many = Array.from({ length: TABLE_SHOWN + 3 }, (_, index) =>
    company({ oppId: `m${index}`, customerName: `가상${String(index).padStart(2, '0')}` }),
  );
  renderTable({ companies: { IN_CONTACT: many } });
  expect(screen.getAllByTestId('dashboard-progress-row')).toHaveLength(TABLE_SHOWN);
  const toggle = screen.getByTestId('dashboard-progress-show-all');
  expect(toggle).toHaveTextContent(`모두 보기 (${TABLE_SHOWN + 3}곳)`);
  await userEvent.click(toggle);
  expect(screen.getAllByTestId('dashboard-progress-row')).toHaveLength(TABLE_SHOWN + 3);
  await userEvent.click(screen.getByTestId('dashboard-progress-show-all'));
  expect(screen.getAllByTestId('dashboard-progress-row')).toHaveLength(TABLE_SHOWN);
});

it('옛 서버(칸 없음)면 표를 그리지 않는다', () => {
  render(
    <MemoryRouter>
      <ProgressTable
        companies={undefined}
        today={TODAY}
        stage={null}
        onClearStage={() => {}}
        staffKey={null}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByTestId('dashboard-progress-table')).not.toBeInTheDocument();
});

it('lastContactText·tableRows: 옛 서버라 방식이 없으면 날짜와 며칠 전만, 이름이 같으면 번호 순', () => {
  expect(lastContactText(company({ oppId: 'x', lastContactAt: '2026-11-25' }), TODAY)).toBe(
    '11/25 · 오늘',
  );
  const rows = tableRows(
    {
      IN_CONTACT: [
        company({ oppId: 'b', customerName: '같은이름' }),
        company({ oppId: 'a', customerName: '같은이름' }),
      ],
    },
    ['IN_CONTACT'],
  );
  expect(rows.map((row) => row.oppId)).toEqual(['a', 'b']);
});

it('#972: 멈춘 회사는 노란 줄 대신 회사 이름 옆 "멈춘 회사" 주의 꼬리표로 보이고, 멈추지 않은 회사에는 붙지 않는다', () => {
  renderTable();
  const rows = screen.getAllByTestId('dashboard-progress-row');
  const tag = within(rows[0]).getByTestId('dashboard-progress-stalled-tag');
  expect(tag).toHaveTextContent(dashboardTexts.tableStalledTag);
  expect(tag).toHaveStyle({ background: tagPalette.warn.bg, color: tagPalette.warn.fg });
  expect(rows[0].style.background).toBe('');
  expect(screen.getAllByTestId('dashboard-progress-stalled-tag')).toHaveLength(1);
});

it('#972: 단계 꼬리표는 접촉 · 견적·샘플이 보라, 성사가 초록이고 알약 모양이 아니다', () => {
  renderTable();
  const tags = screen.getAllByTestId('dashboard-progress-stage-tag');
  expect(tags.map((tag) => tag.textContent)).toEqual(['접촉', '견적·샘플', '접촉', '성사']);
  expect(tags[0]).toHaveStyle({ background: tagPalette.accent.bg, color: tagPalette.accent.fg });
  expect(tags[1]).toHaveStyle({ background: tagPalette.accent.bg, color: tagPalette.accent.fg });
  expect(tags[3]).toHaveStyle({ background: tagPalette.ok.bg, color: tagPalette.ok.fg });
  expect(tags[0]).toHaveStyle({ borderRadius: '6px' });
  expect(STAGE_COLORS.NOT_CONTACTED).toEqual(tagPalette.neutral);
  expect(STAGE_COLORS.ON_HOLD).toEqual(tagPalette.neutral);
});

it('#972: 고른 거르기 단추는 강조 연한 바탕 + 강조 테두리 + 굵은 강조 글자, 나머지는 흰 바탕', async () => {
  renderTable();
  const all = screen.getByTestId('dashboard-progress-filter-all');
  const stalled = screen.getByTestId('dashboard-progress-filter-stalled');
  expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(all).toHaveStyle({
    background: choiceChip.selected.bg,
    color: choiceChip.selected.fg,
    fontWeight: '600',
  });
  expect(stalled).toHaveStyle({ background: choiceChip.idle.bg, color: choiceChip.idle.fg });
  await userEvent.click(stalled);
  expect(stalled).toHaveAttribute('aria-pressed', 'true');
  expect(stalled).toHaveStyle({ background: choiceChip.selected.bg });
  expect(all).toHaveAttribute('aria-pressed', 'false');
});
