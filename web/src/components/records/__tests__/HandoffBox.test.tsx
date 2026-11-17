// #771 전달 사항: 포스트잇 목록, 받는 사람에게만 [확인했어요], [전달 사항 남기기]로 받는 사람 골라 남기기.
// 서버 요청은 가짜(실제 연결은 서버 시험·브라우저 확인).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HandoffBox from '../HandoffBox';
import { confirmHandoff, postNote } from '../../../api/client';
import type { ConfigUi, HandoffNote } from '../../../api/types';
import { FrameContext } from '../../frame/FrameContext';
import fixture from '../../../test/fixtures/config-ui.json';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  postNote: vi.fn(),
  confirmHandoff: vi.fn(),
}));

const config = (fixture as unknown as { data: ConfigUi }).data;
const rows: HandoffNote[] = [
  {
    noteId: 'note-1',
    text: '가상 전달: 도금 두께 가능',
    from: 'kim-gwajang',
    to: 'park-lee',
    at: '2026-11-16T01:00:00Z',
    confirmedAt: null,
    confirmedBy: null,
  },
  {
    noteId: 'note-2',
    text: '가상 전달: 샘플 일정',
    from: 'kim-gwajang',
    to: 'choi-pm',
    at: '2026-11-15T01:00:00Z',
    confirmedAt: '2026-11-15T02:00:00Z',
    confirmedBy: 'choi-pm',
  },
];

function renderBox(staffKey: string, onChanged = vi.fn(), lastActor: string | null = null) {
  render(
    <FrameContext.Provider
      value={{
        config,
        staffKey,
        setStaffKey: () => {},
        canRecord: staffKey !== 'viewer',
        setBannerMeta: () => {},
        setPageTitle: () => {},
      }}
    >
      <HandoffBox oppId="opp-1" handoffs={rows} lastActor={lastActor} onChanged={onChanged} />
    </FrameContext.Provider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.mocked(postNote).mockReset();
  vi.mocked(confirmHandoff).mockReset();
});

it('확인 전은 노란 포스트잇·확인 전 1건, 확인한 것은 옅게 "✓ 확인함"이고 이름으로 보인다', () => {
  renderBox('park-lee');
  const notes = screen.getAllByTestId('handoff-note');
  expect(notes[0]).toHaveAttribute('data-confirmed', 'false');
  expect(notes[0]).toHaveTextContent('김 과장 → 박 이사');
  expect(notes[1]).toHaveAttribute('data-confirmed', 'true');
  expect(notes[1]).toHaveTextContent('✓ 확인함');
  expect(screen.getByTestId('handoff-waiting')).toHaveTextContent('확인 전 1건');
});

it('받는 사람에게만 [확인했어요]가 보이고, 누르면 확인을 보내고 상세를 다시 읽는다', async () => {
  vi.mocked(confirmHandoff).mockResolvedValueOnce({
    data: { noteId: 'note-1', confirmedAt: 'x', confirmedBy: 'park-lee' },
    meta: {},
  } as never);
  const onChanged = renderBox('park-lee');
  await userEvent.click(screen.getByTestId('handoff-confirm'));
  expect(confirmHandoff).toHaveBeenCalledWith('note-1', 'park-lee');
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it('받는 사람이 아니면 [확인했어요] 대신 "받는 사람 확인 전"이 보인다(#794)', () => {
  renderBox('kim-gwajang');
  expect(screen.queryByTestId('handoff-confirm')).not.toBeInTheDocument();
  const notes = screen.getAllByTestId('handoff-note');
  expect(notes[0]).toHaveTextContent('박 이사 확인 전');
  expect(notes[1]).toHaveTextContent('✓ 확인함');
  expect(notes[1]).not.toHaveTextContent('확인 전');
});

it('[전달 사항 남기기]: 받는 사람 기본값은 마지막으로 기록한 사람, 글을 쓰고 [전달하기]', async () => {
  vi.mocked(postNote).mockResolvedValueOnce({ data: { noteId: 'n' }, meta: {} } as never);
  const onChanged = renderBox('kim-gwajang', vi.fn(), 'park-lee');
  await userEvent.click(screen.getByTestId('handoff-open'));
  fireEvent.change(screen.getByTestId('handoff-text'), {
    target: { value: '  가상 전달: 도금 두께 가능  ' },
  });
  await userEvent.click(screen.getByTestId('handoff-send'));
  expect(postNote).toHaveBeenCalledWith(
    'opp-1',
    { kind: 'HANDOFF', text: '가상 전달: 도금 두께 가능', toStaffKey: 'park-lee', evalId: null },
    'kim-gwajang',
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it('보기 전용이면 남기기·확인 단추가 없다', () => {
  renderBox('viewer');
  expect(screen.queryByTestId('handoff-open')).not.toBeInTheDocument();
  expect(screen.queryByTestId('handoff-confirm')).not.toBeInTheDocument();
});

// #853(PM 결정 2026-11-17): 역할 묶음(영업·검수·운영)으로 보낸 전달 사항.
describe('역할 묶음으로 받은 전달 사항 (#853)', () => {
  const teamConfig: ConfigUi = {
    ...config,
    staff: [...config.staff, { key: 'lee-sales', displayName: '영업 담당 2' }],
    handoffTeams: [
      { key: 'SALES', label: '영업', staffKeys: ['park-lee', 'lee-sales'] },
      { key: 'QUALITY', label: '검수(품질·기술)', staffKeys: ['kim-gwajang'] },
    ],
  };
  const teamRow: HandoffNote = {
    noteId: 'note-9',
    text: '가상 전달: 도금 두께 가능',
    from: 'kim-gwajang',
    to: '',
    toTeam: 'SALES',
    at: '2026-11-17T01:00:00Z',
    confirmedAt: null,
    confirmedBy: null,
  };

  function renderTeam(staffKey: string) {
    render(
      <FrameContext.Provider
        value={{
          config: teamConfig,
          staffKey,
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <HandoffBox oppId="opp-1" handoffs={[teamRow]} listOnly onChanged={vi.fn()} />
      </FrameContext.Provider>,
    );
  }

  it('Given "영업"으로 온 전달 When 영업 담당 2가 열면 Then 받는 이름은 "영업"이고 [확인했어요]가 있다', () => {
    renderTeam('lee-sales');
    expect(screen.getByTestId('handoff-note')).toHaveTextContent('김 과장 → 영업');
    expect(screen.getByTestId('handoff-confirm')).toBeInTheDocument();
  });

  it('Given "영업"으로 온 전달 When 보낸 검수 담당이 열면 Then [확인했어요] 대신 "영업 확인 전"', () => {
    renderTeam('kim-gwajang');
    expect(screen.queryByTestId('handoff-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('handoff-waiting-for')).toHaveTextContent('영업 확인 전');
  });
});
