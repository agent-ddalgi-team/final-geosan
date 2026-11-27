// #773 오른쪽 "💬 영업 코치" 칸: 질문 칸(assistant)·페이지 자리(page), 접기·기억, 좁은 화면은 본문 아래.
// 설정 응답은 가짜(실제 서버 연결 확인이 아님).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortal } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import AppFrame from '../AppFrame';
import { DOCK_DEFAULT_COLLAPSED, dockStorageKey } from '../CoachDock';
import type { DockScreen } from '../CoachDock';
import { useFrame } from '../FrameContext';
import { getConfigUi } from '../../../api/client';
import fixture from '../../../test/fixtures/config-ui.json';
import type { ConfigUi, Envelope } from '../../../api/types';
import { accent, colors, radius } from '../../../theme/tokens';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getConfigUi: vi.fn(),
}));

function PortalProbe() {
  const { dockSlot } = useFrame();
  const content = <p data-testid="page-dock-content">기록 남기기 자리</p>;
  return dockSlot ? createPortal(content, dockSlot) : content;
}

function renderFrame(dock: 'assistant' | 'page', screenWidth = 1440, dockScreen?: DockScreen) {
  vi.stubGlobal('screen', { width: screenWidth });
  const base = fixture as unknown as Envelope<ConfigUi>;
  vi.mocked(getConfigUi).mockResolvedValue({
    ...base,
    data: { ...base.data, assistant: { enabled: true, questionMaxLength: 300 } },
  } as Envelope<ConfigUi>);
  return render(
    <MemoryRouter>
      <AppFrame title="가상 화면" dock={dock} dockScreen={dockScreen}>
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

it('[›]로 접으면 💬만 남고 내용은 숨기기만 하며(지우지 않음), 접은 상태를 그 화면 종류에 기억한다', async () => {
  const user = userEvent.setup();
  const view = renderFrame('page', 1440, 'DETAIL');
  await screen.findByTestId('page-dock-content');
  await user.click(screen.getByTestId('coach-dock-toggle'));
  expect(screen.getByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'true');
  expect(screen.getByTestId('coach-dock-toggle')).toHaveTextContent('💬');
  expect(screen.getByTestId('coach-dock-body')).not.toBeVisible();
  expect(screen.getByTestId('page-dock-content')).toBeInTheDocument();
  expect(window.localStorage.getItem(dockStorageKey('DETAIL'))).toBe('true');
  view.unmount();
  renderFrame('page', 1440, 'DETAIL');
  expect(await screen.findByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'true');
});

it('#795 화면 종류별 기본값: 기업 상세·신규 거래처 찾기는 펼침, 대시보드·관심 기업·영업 분석은 접힘(💬만)', async () => {
  expect(DOCK_DEFAULT_COLLAPSED).toEqual({
    DETAIL: false,
    LIST: false,
    DASHBOARD: true,
    BOOKMARKS: true,
    ANALYSIS: true,
  });
  for (const [kind, collapsed] of Object.entries(DOCK_DEFAULT_COLLAPSED) as [
    DockScreen,
    boolean,
  ][]) {
    const view = renderFrame(kind === 'DETAIL' ? 'page' : 'assistant', 1440, kind);
    const dock = await screen.findByTestId('coach-dock');
    expect(dock).toHaveAttribute('data-collapsed', String(collapsed));
    expect(screen.getByTestId('coach-dock-toggle')).toHaveTextContent(collapsed ? '💬' : '›');
    view.unmount();
  }
});

it('#795 펼치거나 접은 것은 그 화면 종류에만 기억하고, 다른 화면의 기본값은 그대로다(예전 공통 키는 읽지 않음)', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('geosan.coachDockCollapsed', 'true');
  let view = renderFrame('assistant', 1440, 'DASHBOARD');
  await user.click(await screen.findByTestId('coach-dock-toggle'));
  expect(screen.getByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'false');
  expect(window.localStorage.getItem(dockStorageKey('DASHBOARD'))).toBe('false');
  view.unmount();
  // 다른 화면(관심 기업)은 영향 없이 기본 접힘, 신규 거래처 찾기는 옛 공통 키와 무관하게 기본 펼침.
  view = renderFrame('assistant', 1440, 'BOOKMARKS');
  expect(await screen.findByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'true');
  view.unmount();
  view = renderFrame('assistant', 1440, 'LIST');
  expect(await screen.findByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'false');
  view.unmount();
  // 대시보드를 다시 열면 펼친 것을 기억한다.
  renderFrame('assistant', 1440, 'DASHBOARD');
  expect(await screen.findByTestId('coach-dock')).toHaveAttribute('data-collapsed', 'false');
});

it('좁은 기기에서는 본문 아래에 놓이고 접기 단추가 없다(기본 접힘 화면이어도 그대로)', async () => {
  renderFrame('assistant', 800, 'DASHBOARD');
  const dock = await screen.findByTestId('coach-dock');
  expect(screen.getByRole('main')).toContainElement(dock);
  expect(screen.queryByTestId('coach-dock-toggle')).not.toBeInTheDocument();
});

it('#972 펼치면 흰 카드(얇은 테두리, 모서리 12)이고, 접으면 카드 없이 강조 바탕 정사각 단추(모서리 12)만 남는다', async () => {
  const user = userEvent.setup();
  renderFrame('page', 1440, 'DETAIL');
  const dock = await screen.findByTestId('coach-dock');
  expect(dock).toHaveStyle({
    background: colors.bgContainer,
    border: `1px solid ${colors.borderSecondary}`,
    borderRadius: `${radius.card}px`,
  });
  expect(dock.style.boxShadow).toBe('');
  const toggle = screen.getByTestId('coach-dock-toggle');
  expect(toggle).toHaveStyle({ background: colors.bgContainer });
  await user.click(toggle);
  expect(dock.style.background).toBe('transparent');
  expect(dock.style.borderWidth).toBe('0px');
  expect(screen.getByTestId('coach-dock-toggle')).toHaveStyle({
    background: accent.bg,
    color: accent.onBg,
    width: '44px',
    height: '44px',
    borderRadius: `${radius.card}px`,
  });
  expect(screen.getByTestId('coach-dock-toggle')).toHaveAttribute('aria-expanded', 'false');
});
