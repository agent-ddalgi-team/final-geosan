// #773 오른쪽 "💬 영업 코치" 칸: 질문 칸(assistant)·페이지 자리(page), 접기·기억, 좁은 화면은 본문 아래.
// 설정 응답은 가짜(실제 서버 연결 확인이 아님).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import AppFrame from '../AppFrame';
import { DOCK_STORAGE_KEY } from '../CoachDock';
import { useFrame } from '../FrameContext';
import { getConfigUi } from '../../../api/client';
import fixture from '../../../test/fixtures/config-ui.json';
import type { ConfigUi, Envelope } from '../../../api/types';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getConfigUi: vi.fn(),
}));

function PortalProbe() {
  const { dockSlot } = useFrame();
  const content = <p data-testid="page-dock-content">기록 남기기 자리</p>;
  return dockSlot ? createPortal(content, dockSlot) : content;
}

function renderFrame(dock: 'assistant' | 'page', screenWidth = 1440) {
  vi.stubGlobal('screen', { width: screenWidth });
  const base = fixture as unknown as Envelope<ConfigUi>;
  vi.mocked(getConfigUi).mockResolvedValue({
    ...base,
    data: { ...base.data, assistant: { enabled: true, questionMaxLength: 300 } },
  } as Envelope<ConfigUi>);
  return render(
    <MemoryRouter>
      <AppFrame title="가상 화면" dock={dock}>
        <p data-testid="page-body">본문</p>
        {dock === 'page' ? <PortalProbe /> : null}
      </AppFrame>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it('assistant: 오른쪽 칸에 "💬 영업 코치" 제목과 질문 칸이 있고, 본문 바깥 오른쪽에 놓인다', async () => {
  renderFrame('assistant');
  const dock = await screen.findByTestId('coach-dock');
  expect(dock).toHaveTextContent('💬 영업 코치');
  expect(await screen.findByTestId('assistant-ask')).toBeInTheDocument();
  expect(screen.getByRole('main')).not.toContainElement(dock);
});

it('page: 페이지가 보낸 내용이 오른쪽 칸 안에 그려진다(본문에는 없다)', async () => {
  renderFrame('page');
  const content = await screen.findByTestId('page-dock-content');
  expect(screen.getByTestId('coach-dock')).toContainElement(content);
  expect(screen.getByRole('main')).not.toContainElement(content);
});

it('[›]로 접으면 💬만 남고 내용은 숨기기만 하며(지우지 않음), 접은 상태를 기억한다', async () => {
  const user = userEvent.setup();
  const view = renderFrame('page');
  await screen.findByTestId('page-dock-content');
  await user.click(screen.getByTestId('coach-dock-toggle'));
  expect(screen.getByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'true');
  expect(screen.getByTestId('coach-dock-toggle')).toHaveTextContent('💬');
  expect(screen.getByTestId('coach-dock-body')).not.toBeVisible();
  expect(screen.getByTestId('page-dock-content')).toBeInTheDocument();
  expect(window.localStorage.getItem(DOCK_STORAGE_KEY)).toBe('true');
  view.unmount();
  renderFrame('page');
  expect(await screen.findByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'true');
});

it('좁은 기기에서는 본문 아래에 놓이고 접기 단추가 없다', async () => {
  renderFrame('assistant', 800);
  const dock = await screen.findByTestId('coach-dock');
  expect(screen.getByRole('main')).toContainElement(dock);
  expect(screen.queryByTestId('coach-dock-toggle')).not.toBeInTheDocument();
});
