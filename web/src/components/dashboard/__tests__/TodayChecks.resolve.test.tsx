// #766 지난 일정 — 했나요? [완료]·[날짜 바꾸기]·[필요 없어요]. 서버 요청은 가짜(실제 연결 확인은 서버 시험·브라우저).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TodayChecks from '../TodayChecks';
import { ApiError, resolveSchedule } from '../../../api/client';
import type { TodayCheckRow } from '../../../api/dashboardTypes';
import { FrameContext } from '../../frame/FrameContext';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  resolveSchedule: vi.fn(),
}));
const mocked = vi.mocked(resolveSchedule);

const overdue = (outcomeVersion: number | null = 3): TodayCheckRow[] => [
  {
    kind: 'SCHEDULE_OVERDUE',
    count: 1,
    items: [
      {
        oppId: 'opp-4',
        customerName: '가상테크',
        dueAt: '2026-11-10',
        note: '전화',
        outcomeVersion,
      },
    ],
    listFilter: null,
  },
];

function renderChecks(rows: TodayCheckRow[], canRecord = true, onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: canRecord ? 'park-lee' : 'viewer',
          setStaffKey: () => {},
          canRecord,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <TodayChecks rows={rows} onChanged={onChanged} />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
  return onChanged;
}

beforeEach(() => mocked.mockReset());

it.each([
  ['dashboard-today-done', 'DONE'],
  ['dashboard-today-drop', 'DROPPED'],
] as const)('%s를 누르면 %s로 보내고 대시보드를 다시 읽는다', async (testId, action) => {
  mocked.mockResolvedValueOnce({ data: { status: 'IN_PROGRESS' }, meta: {} } as never);
  const onChanged = renderChecks(overdue());
  await userEvent.click(screen.getByTestId(testId));
  expect(mocked).toHaveBeenCalledWith('opp-4', { action, expectedVersion: 3 }, 'park-lee');
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it('[날짜 바꾸기]는 새 날짜 칸을 펴고, 날짜를 골라 [옮기기]를 누르면 MOVED와 날짜를 보낸다', async () => {
  mocked.mockResolvedValueOnce({ data: { status: 'IN_PROGRESS' }, meta: {} } as never);
  const onChanged = renderChecks(overdue());
  expect(screen.queryByTestId('dashboard-today-move-date')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('dashboard-today-move'));
  const save = screen.getByTestId('dashboard-today-move-save');
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByTestId('dashboard-today-move-date'), {
    target: { value: '2099-01-02' },
  });
  await userEvent.click(save);
  expect(mocked).toHaveBeenCalledWith(
    'opp-4',
    { action: 'MOVED', expectedVersion: 3, nextScheduleAt: '2099-01-02' },
    'park-lee',
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it('서버가 거부하면(그 사이 다른 기록) 이유를 보이고 다시 읽지 않는다', async () => {
  mocked.mockRejectedValueOnce(
    new ApiError(409, {
      message: '그 사이 이 회사에 다른 기록이 저장됐습니다',
      nextAction: '화면을 새로 고쳐 지금 일정을 확인해 주세요',
      ref: 'test',
    }),
  );
  const onChanged = renderChecks(overdue());
  await userEvent.click(screen.getByTestId('dashboard-today-done'));
  expect(await screen.findByRole('alert')).toHaveTextContent('그 사이 이 회사에 다른 기록');
  expect(onChanged).not.toHaveBeenCalled();
});

it('보기 전용이거나 기록 번호가 없으면(옛 서버) 단추를 보이지 않는다', () => {
  renderChecks(overdue(), false);
  expect(screen.queryByTestId('dashboard-today-done')).not.toBeInTheDocument();
});

it('기록 번호가 없는 옛 응답이면 단추를 보이지 않는다', () => {
  renderChecks(overdue(null));
  expect(screen.queryByTestId('dashboard-today-done')).not.toBeInTheDocument();
});
