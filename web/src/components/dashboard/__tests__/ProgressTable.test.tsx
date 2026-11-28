// #921 영업 홈 "누가 봐도 · 진행 중인 회사" 표. 서버 응답은 손으로 만든 가상 값이다(실제 서버 계산은
// tests/unit/u7/test_dashboard_progress.py). 회사 이름은 모두 가상이다.
// #983: 다음 일정 칸의 [일정 잡기]·[바꾸기]와 카드 머리 아래 작은 단계 칸 자리. 저장 요청은 가짜로 바꾼 확인이며
// 실제 서버 연결 확인이 아니다(저장 본문 · 실패 안내는 schedule/__tests__/ScheduleQuickEdit.test.tsx).
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
import { getSalesQuestions } from '../../../api/client';
import { FrameContext } from '../../frame/FrameContext';
import { resetScheduleQuestions } from '../../schedule/scheduleKinds';
import { dashboardTexts } from '../../../labels/ko';
import { choiceChip, colors, homePalette, tagPalette } from '../../../theme/tokens';

// 바로 일정 잡기 칸이 종류 목록을 만들려고 질문 파일을 읽는다. 여기서는 응답이 오지 않게 막아 둔다(대면·전화·메일만 보임).
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  getSalesQuestions: vi.fn(() => new Promise(() => {})),
}));

beforeEach(() => {
  resetScheduleQuestions();
  vi.mocked(getSalesQuestions).mockClear();
});

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
  // 표가 받는 담당자 값과 공통 틀 값은 영업 홈에서 늘 같이 간다(기록할 수 없으면 둘 다 없음).
  const staffKey = props.staffKey === undefined ? 'park-lee' : props.staffKey;
  render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey,
          setStaffKey: () => {},
          canRecord: staffKey !== null,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <ProgressTable
          companies={companies}
          today={TODAY}
          stage={null}
          onClearStage={onClearStage}
          staffKey="park-lee"
          {...props}
        />
      </FrameContext.Provider>
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
    // #983: 다음 일정 칸은 일정이 없으면 "일정 없음" + [일정 잡기], 있으면 지금 글 + [바꾸기]
    // (예전에는 일정 없는 멈춘 회사가 "⚠ 다음 일정 없음", 그 밖은 "—"였다).
    ['가상멈춤멈춘 회사', '접촉', '검수 담당', '11/5 대면 · 20일 전', '일정 없음일정 잡기'],
    ['가상견적', '견적·샘플', '영업 담당', '11/14 메일 · 11일 전', '지난 일정 11/21바꾸기'],
    ['가상접촉', '접촉', '영업 담당', '11/18 전화 · 7일 전', '11/28 전화바꾸기'],
    ['가상성사', '성사', '—', '11/24 · 어제', '일정 없음일정 잡기'],
  ]);
  // 일정 글만 따로: 멈춘 회사의 "일정 없음"과 지난 일정은 주의색 굵게, 멈추지 않은 회사의 "일정 없음"은 보조 글자색.
  const next = screen.getAllByTestId('dashboard-progress-next-text');
  expect(next.map((cell) => cell.textContent)).toEqual([
    '일정 없음',
    '지난 일정 11/21',
    '11/28 전화',
    '일정 없음',
  ]);
  expect(next[0].firstElementChild).toHaveStyle({
    color: homePalette.orangeText,
    fontWeight: '600',
  });
  expect(next[1].firstElementChild).toHaveStyle({
    color: homePalette.orangeText,
    fontWeight: '600',
  });
  expect(next[3].firstElementChild).toHaveStyle({ color: colors.textSecondary });
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

describe('#983 → #992 제목 옆 작은 단계 칸 자리', () => {
  it('넘겨받은 단계 칸은 제목 줄 안, 제목 바로 뒤 · 거르기 단추 앞에 놓이고 표는 그 아래다', () => {
    // #983에서는 제목 줄(제목 + 거르기 단추) 아래 한 줄이었다. PM 결정(2026-11-29, #992)으로 제목 바로 옆으로 옮겼다.
    renderTable({ stages: <div data-testid="stage-slot">단계 칸</div> });
    const card = screen.getByTestId('dashboard-progress-table');
    const slot = within(card).getByTestId('stage-slot');
    const title = within(card).getByRole('heading', { level: 2 });
    const order = [
      title,
      slot,
      screen.getByTestId('dashboard-progress-filter-all'),
      within(card).getByRole('table'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    const head = screen.getByTestId('dashboard-progress-head');
    expect(head).toContainElement(title);
    expect(head).toContainElement(slot);
    expect(head).toContainElement(screen.getByTestId('dashboard-progress-filter-all'));
    expect(title.nextElementSibling).toBe(slot);
    expect(head).not.toContainElement(within(card).getByRole('table'));
  });

  it('#992 설명 줄: 단계 칸이 있으면 "영업 단계 칸을 누르면 …"이 제목 줄 아래 · 표 위에 보이고, 꼬리표 풀이는 넘겨받았을 때만 끝에 붙는다', () => {
    const view = render(
      <MemoryRouter>
        <ProgressTable
          companies={companies}
          today={TODAY}
          stage={null}
          onClearStage={() => {}}
          staffKey="park-lee"
          stages={<div data-testid="stage-slot">단계 칸</div>}
          stagesLegend={dashboardTexts.stageHintEntered}
        />
      </MemoryRouter>,
    );
    const hint = screen.getByTestId('dashboard-stage-hint');
    expect(hint).toHaveTextContent(
      /^영업 단계 칸을 누르면 아래 목록이 그 단계 회사만 보입니다 · 숫자 옆 "\+2"는 이번 주에 들어온 곳$/,
    );
    const head = screen.getByTestId('dashboard-progress-head');
    expect(head.nextElementSibling).toBe(hint);
    expect(
      hint.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    view.unmount();
    renderTable({ stages: <div data-testid="stage-slot">단계 칸</div> });
    expect(screen.getByTestId('dashboard-stage-hint')).toHaveTextContent(
      /^영업 단계 칸을 누르면 아래 목록이 그 단계 회사만 보입니다$/,
    );
  });

  it('#992 설명 줄: 단계를 골랐으면 지금 "○○" n곳을 보는 중(n = 목록의 그 단계 회사 수)이 가운데에 끼고, 단계 칸도 고른 단계도 없으면 줄 자체가 없다', () => {
    const view = render(
      <MemoryRouter>
        <ProgressTable
          companies={companies}
          today={TODAY}
          stage="IN_CONTACT"
          onClearStage={() => {}}
          staffKey="park-lee"
          stages={<div data-testid="stage-slot">단계 칸</div>}
          stagesLegend={dashboardTexts.stageHintEntered}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dashboard-stage-hint')).toHaveTextContent(
      /^영업 단계 칸을 누르면 아래 목록이 그 단계 회사만 보입니다 · 지금 "접촉" 2곳을 보는 중 모든 단계 보기 · 숫자 옆 "\+2"는 이번 주에 들어온 곳$/,
    );
    expect(screen.getByTestId('dashboard-progress-stage')).toHaveTextContent(
      /^지금 "접촉" 2곳을 보는 중 모든 단계 보기$/,
    );
    view.unmount();
    // 단계 칸 없이 단계만 고른 표: 누르는 법 · 꼬리표 풀이 없이 "보는 중"만.
    const only = render(
      <MemoryRouter>
        <ProgressTable
          companies={companies}
          today={TODAY}
          stage="ON_HOLD"
          onClearStage={() => {}}
          staffKey="park-lee"
          stagesLegend={dashboardTexts.stageHintEntered}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('dashboard-stage-hint')).toHaveTextContent(
      /^지금 "보류" 1곳을 보는 중 모든 단계 보기$/,
    );
    only.unmount();
    renderTable();
    expect(screen.queryByTestId('dashboard-stage-hint')).not.toBeInTheDocument();
  });

  it('옛 서버라 회사 목록이 없어도 단계 칸이 있으면 카드와 단계 칸은 보이고, 표 · 곳 수 · 거르기는 지어내지 않는다', () => {
    renderTable({ companies: undefined, stages: <div data-testid="stage-slot">단계 칸</div> });
    const card = screen.getByTestId('dashboard-progress-table');
    expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent(
      new RegExp(`^${dashboardTexts.tableTitle}$`),
    );
    expect(within(card).getByTestId('stage-slot')).toBeInTheDocument();
    expect(within(card).queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-progress-table-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-progress-filter-all')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-progress-table-empty')).not.toBeInTheDocument();
  });
});

describe('#983 다음 일정 칸에서 바로 일정 잡기 · 바꾸기', () => {
  const buttonOf = (name: string) =>
    within(screen.getByRole('link', { name }).closest('tr') as HTMLElement).getByTestId(
      'dashboard-progress-schedule-button',
    );

  it('일정이 없는 줄은 [일정 잡기], 있는 줄(지난 일정 포함)은 [바꾸기]이고, 단추 이름에 회사 이름이 실린다', () => {
    renderTable();
    expect(buttonOf('가상멈춤')).toHaveTextContent(/^일정 잡기$/);
    expect(buttonOf('가상멈춤')).toHaveAccessibleName('가상멈춤 일정 잡기');
    expect(buttonOf('가상견적')).toHaveTextContent(/^바꾸기$/);
    expect(buttonOf('가상견적')).toHaveAccessibleName('가상견적 일정 바꾸기');
    expect(buttonOf('가상접촉')).toHaveTextContent(/^바꾸기$/);
    expect(buttonOf('가상성사')).toHaveTextContent(/^일정 잡기$/);
    // 처음에는 어느 줄도 펴져 있지 않다.
    expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-progress-pick-staff')).not.toBeInTheDocument();
  });

  it('단추를 누르면 그 줄의 다음 일정 칸 안(같은 칸 아래)에 일정 잡기 칸이 펴지고, 지금 일정이 안내 줄에 보인다', async () => {
    renderTable();
    await userEvent.click(buttonOf('가상견적'));
    const row = screen.getByRole('link', { name: '가상견적' }).closest('tr') as HTMLElement;
    const cell = within(row).getByTestId('dashboard-progress-next');
    const editor = within(cell).getByTestId('schedule-quick-edit');
    expect(buttonOf('가상견적')).toHaveAttribute('aria-expanded', 'true');
    // 지난 일정(11/21, 오늘은 11/25)은 "(지남)"이 붙고, 지난 날짜는 날짜 칸에 미리 넣지 않는다.
    expect(within(editor).getByTestId('schedule-quick-current')).toHaveTextContent(
      '지금 일정: 11/21 견적 회신 (지남) → 저장하면 이 일정으로 바뀌고 달력에도 바로 보입니다',
    );
    expect(within(editor).getByTestId('schedule-quick-date')).toHaveValue('');
    expect(within(editor).getByTestId('schedule-quick-date')).toHaveAttribute('min', TODAY);
    expect(within(editor).getByTestId('schedule-quick-note')).toHaveValue('견적 회신');
    // 다른 줄의 칸은 그대로다.
    expect(screen.getAllByTestId('schedule-quick-edit')).toHaveLength(1);
  });

  it('한 번에 한 줄만 펴진다: 다른 줄 단추를 누르면 앞 줄은 닫히고, 같은 단추나 [취소]로 닫는다', async () => {
    renderTable();
    await userEvent.click(buttonOf('가상견적'));
    await userEvent.click(buttonOf('가상접촉'));
    expect(screen.getAllByTestId('schedule-quick-edit')).toHaveLength(1);
    const open = screen.getByTestId('schedule-quick-edit');
    expect(screen.getByRole('link', { name: '가상접촉' }).closest('tr')).toContainElement(open);
    expect(buttonOf('가상견적')).toHaveAttribute('aria-expanded', 'false');
    // 앞으로 잡힌 일정(11/28 전화)은 그 날짜 · 내용으로 시작한다.
    expect(within(open).getByTestId('schedule-quick-date')).toHaveValue('2026-11-28');
    expect(within(open).getByTestId('schedule-quick-note')).toHaveValue('전화');
    expect(within(open).getByTestId('schedule-quick-current')).toHaveTextContent(
      '지금 일정: 11/28 전화 → 저장하면',
    );
    await userEvent.click(within(open).getByTestId('schedule-quick-cancel'));
    expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
    await userEvent.click(buttonOf('가상멈춤'));
    expect(screen.getByTestId('schedule-quick-current')).toHaveTextContent(
      '지금 일정 없음 → 저장하면 달력에도 바로 보입니다',
    );
    await userEvent.click(buttonOf('가상멈춤'));
    expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
  });

  it('보기 전용 · 담당자 미선택이면 단추가 눌리지 않고 표 위에 "먼저 담당자를 고르세요"가 보인다', async () => {
    renderTable({ staffKey: null });
    expect(screen.getByTestId('dashboard-progress-pick-staff')).toHaveTextContent(
      /^먼저 담당자를 고르세요$/,
    );
    const buttons = screen.getAllByTestId('dashboard-progress-schedule-button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', '먼저 담당자를 고르세요');
      expect(button).toHaveAccessibleDescription('먼저 담당자를 고르세요');
    }
    await userEvent.click(buttons[0]);
    expect(screen.queryByTestId('schedule-quick-edit')).not.toBeInTheDocument();
  });

  it('보일 회사가 없으면 잠긴 단추도 없으므로 "먼저 담당자를 고르세요"도 보이지 않는다', () => {
    renderTable({ staffKey: null, companies: { IN_CONTACT: [] } });
    expect(screen.getByTestId('dashboard-progress-table-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-progress-pick-staff')).not.toBeInTheDocument();
  });
});
