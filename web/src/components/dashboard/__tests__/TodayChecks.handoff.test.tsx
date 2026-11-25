// #854 대시보드 전달 사항: 나에게 온 줄의 [확인], 내가 보낸 전달 사항 묶음.
// #921: 영업 홈은 전달 사항을 오른쪽 칸(part="handoff")에, 일정은 왼쪽 칸(part="work")에 나눠 그린다.
// 서버 요청은 가짜(실제 저장·보낸 사람에게만 보이는 규칙은 서버 시험 tests/unit/u7/test_handoff.py).
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TodayChecks from '../TodayChecks';
import { SCHEDULE_CHANGED_EVENT } from '../../../api/assistant';
import { ApiError, confirmHandoff } from '../../../api/client';
import type { TodayCheckRow } from '../../../api/dashboardTypes';
import { FrameContext } from '../../frame/FrameContext';
import { dashboardTexts } from '../../../labels/ko';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  confirmHandoff: vi.fn(),
}));
const mocked = vi.mocked(confirmHandoff);

const forMe: TodayCheckRow = {
  kind: 'HANDOFF_FOR_ME',
  count: 1,
  items: [
    {
      oppId: 'opp-7',
      customerName: '가상정밀',
      dueAt: null,
      note: '검수 담당 · 11/17',
      text: '가상 전달: 샘플 결과 물어봐 주세요',
      noteIds: ['note-new', 'note-old'],
    },
  ],
  listFilter: null,
};

const fromMe: TodayCheckRow = {
  kind: 'HANDOFF_FROM_ME',
  count: 1,
  items: [
    {
      oppId: 'opp-9',
      customerName: '가상금속',
      dueAt: null,
      note: '→ 영업 · 11/17',
      text: '가상 전달: 다음 방문 때 견적 담당자도',
      noteIds: null,
    },
  ],
  listFilter: null,
};

function frame(canRecord: boolean) {
  return {
    config: null,
    staffKey: canRecord ? 'park-lee' : 'viewer',
    setStaffKey: () => {},
    canRecord,
    setBannerMeta: () => {},
    setPageTitle: () => {},
  };
}

function renderChecks(rows: TodayCheckRow[], canRecord = true) {
  render(
    <MemoryRouter>
      <FrameContext.Provider value={frame(canRecord)}>
        <TodayChecks rows={rows} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => mocked.mockReset());

it('[확인]을 누르면 그 회사의 확인 전 전달 사항을 모두 확인하고 대시보드·메뉴 숫자를 다시 읽게 알린다', async () => {
  mocked.mockResolvedValue({ data: {}, meta: {} } as never);
  const heard = vi.fn();
  window.addEventListener(SCHEDULE_CHANGED_EVENT, heard);
  renderChecks([forMe]);
  const button = screen.getByTestId('dashboard-today-handoff-confirm');
  expect(button).toHaveAccessibleName('가상정밀 전달 사항 확인');
  await userEvent.click(button);
  expect(mocked.mock.calls).toEqual([
    ['note-new', 'park-lee'],
    ['note-old', 'park-lee'],
  ]);
  await waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
  window.removeEventListener(SCHEDULE_CHANGED_EVENT, heard);
});

it('확인이 실패하면 줄 아래에 이유 한 줄이 보이고 다시 누를 수 있다', async () => {
  mocked.mockRejectedValueOnce(
    new ApiError(403, {
      code: 'FORBIDDEN',
      message: '받는 사람만 확인할 수 있습니다.',
      nextAction: '전달 사항을 받은 담당자가 눌러 주세요.',
      fields: [],
    } as never),
  );
  renderChecks([forMe]);
  await userEvent.click(screen.getByTestId('dashboard-today-handoff-confirm'));
  expect(await screen.findByTestId('dashboard-today-handoff-error')).toHaveTextContent(
    '받는 사람만 확인할 수 있습니다.',
  );
  expect(screen.getByTestId('dashboard-today-handoff-confirm')).toBeEnabled();
});

it('보기 전용이거나 번호가 없는 옛 응답이면 [확인]이 없고 회사 이름은 상세로 간다', () => {
  renderChecks([forMe], false);
  expect(screen.queryByTestId('dashboard-today-handoff-confirm')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '가상정밀' })).toHaveAttribute(
    'href',
    '/opportunities/opp-7',
  );
});

it('내가 보낸 전달 사항은 📤 묶음으로 회사·받는 사람·날짜·글 앞부분이 보이고 [확인]은 없다', () => {
  renderChecks([fromMe, forMe]);
  const group = screen.getByTestId('dashboard-today-items-HANDOFF_FROM_ME');
  expect(screen.getByTestId('dashboard-today-count-HANDOFF_FROM_ME')).toHaveTextContent(
    `${dashboardTexts.todayGroupTitles.HANDOFF_FROM_ME} 1곳`,
  );
  expect(within(group).getByRole('link', { name: '가상금속' })).toHaveAttribute(
    'href',
    '/opportunities/opp-9',
  );
  expect(group).toHaveTextContent('→ 영업 · 11/17');
  expect(group).toHaveTextContent('가상 전달: 다음 방문 때 견적 담당자도');
  expect(within(group).queryByTestId('dashboard-today-handoff-confirm')).not.toBeInTheDocument();
  // 보낸 것은 맨 아래(내 할 일이 아님): 나에게 온 전달 사항이 먼저 보인다.
  const titles = screen
    .getAllByTestId(/^dashboard-today-count-/)
    .map((node) => node.dataset.testid);
  expect(titles).toEqual([
    'dashboard-today-count-HANDOFF_FOR_ME',
    'dashboard-today-count-HANDOFF_FROM_ME',
  ]);
});

const overdue: TodayCheckRow = {
  kind: 'SCHEDULE_OVERDUE',
  count: 1,
  listFilter: null,
  items: [{ oppId: 'opp-x', customerName: '가상 지난일정', dueAt: '2026-11-10', note: '방문' }],
};

function renderPart(part: 'work' | 'handoff', rows: TodayCheckRow[]) {
  render(
    <MemoryRouter>
      <FrameContext.Provider value={frame(true)}>
        <TodayChecks part={part} rows={rows} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

it('#921 전달 사항 칸에는 받은 것과 보낸 것 묶음만 있고 일정 묶음은 없다', () => {
  renderPart('handoff', [overdue, forMe, fromMe]);
  const section = screen.getByTestId('dashboard-handoff');
  expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(
    dashboardTexts.handoffTitle,
  );
  expect(screen.getByTestId('dashboard-today-items-HANDOFF_FOR_ME')).toBeInTheDocument();
  expect(screen.getByTestId('dashboard-today-items-HANDOFF_FROM_ME')).toBeInTheDocument();
  expect(screen.queryByTestId('dashboard-today-items-SCHEDULE_OVERDUE')).not.toBeInTheDocument();
});

it('#921 오늘 할 일 칸에는 전달 사항 묶음이 없고, 전달 사항뿐이면 빈 안내가 보인다', () => {
  renderPart('work', [forMe, fromMe]);
  expect(screen.queryByTestId('dashboard-today-items-HANDOFF_FOR_ME')).not.toBeInTheDocument();
  expect(screen.getByTestId('dashboard-today-empty')).toHaveTextContent(dashboardTexts.workEmpty);
});

it('#921 전달 사항이 없으면 전달 사항 칸에 빈 안내 한 줄이 보인다', () => {
  renderPart('handoff', [overdue]);
  expect(screen.getByTestId('dashboard-handoff-empty')).toHaveTextContent(
    dashboardTexts.handoffEmpty,
  );
});
