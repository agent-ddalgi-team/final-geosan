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
