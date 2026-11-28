// 공통 틀: 랜드마크·건너뛰기 링크·h1, 설정 읽기(담당자 목록·띠), 담당자 기억, 보기 전용, 설정 실패.
// 서버 없이 VITE_USE_FIXTURES=1 가짜 응답으로 돌린다(실제 서버 연결 확인이 아님).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AppFrame from '../AppFrame';
import { STAFF_STORAGE_KEY, useFrame } from '../FrameContext';
import { banner, frame } from '../../../labels/ko';

function Probe() {
  const { staffKey, canRecord, narrowDevice } = useFrame();
  return (
    <>
      <span data-testid="probe">{`${staffKey ?? 'none'}|${canRecord}`}</span>
      <span data-testid="probe-narrow">{String(narrowDevice)}</span>
    </>
  );
}

function renderFrame() {
  return render(
    <MemoryRouter>
      <AppFrame title={frame.pageTitleList}>
        <Probe />
      </AppFrame>
    </MemoryRouter>,
  );
}

describe('AppFrame', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '1');
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('header·nav·main 랜드마크와 h1 하나, 본문으로 건너뛰기 링크가 있다', async () => {
    renderFrame();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: frame.navLabel })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(frame.pageTitleList);
    expect(screen.getByTestId('skip-link')).toHaveAttribute('href', '#main');
    expect(screen.getByTestId('skip-link')).toHaveTextContent(frame.skipToContent);
    await screen.findByText('거산 영업지원');
  });

  it('메뉴에 [대시보드]와 [영업 후보 목록]이 있고, 지금 보는 쪽에 aria-current가 붙는다', async () => {
    renderFrame();
    const dashboard = screen.getByTestId('nav-dashboard-link');
    const list = screen.getByTestId('nav-opportunities-link');
    expect(dashboard).toHaveTextContent(frame.menuDashboard);
    expect(dashboard).toHaveAttribute('href', '/');
    expect(dashboard).toHaveAttribute('aria-current', 'page');
    expect(list).toHaveTextContent(frame.menuOpportunities);
    expect(list).toHaveAttribute('href', '/opportunities');
    expect(list).not.toHaveAttribute('aria-current');
    await screen.findByText('거산 영업지원');
  });

  it('설정을 읽으면 브랜드명이 보이고 띠에 가상 데이터가 함께 보인다', async () => {
    renderFrame();
    expect(await screen.findByTestId('brand-name')).toHaveTextContent('거산 영업지원');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(banner.virtualData));
    expect(screen.getByRole('status')).toHaveTextContent(banner.internalOnly);
  });

  it('서버 설정에 로고가 비어 있으면 화면에 실린 거산 로고를 브랜드명 옆에 보인다 (#898)', async () => {
    renderFrame();
    await screen.findByTestId('brand-name');
    const logo = await screen.findByTestId('brand-logo');
    expect(logo.getAttribute('src')).toMatch(/geosan-logo/);
    // 옆에 브랜드명 글자가 있으므로 그림은 꾸밈(alt 빈 값)이다.
    expect(logo).toHaveAttribute('alt', '');
  });

  it('#972 로고와 브랜드명은 왼쪽 메뉴 맨 위에 한 번만 보이고, 위쪽 줄에는 글자 크기와 담당자 고르기만 남는다', async () => {
    renderFrame();
    await screen.findByTestId('brand-name');
    const menu = screen.getByRole('navigation', { name: frame.navLabel });
    const header = screen.getByRole('banner');
    expect(screen.getAllByTestId('brand-name')).toHaveLength(1);
    expect(screen.getAllByTestId('brand-logo')).toHaveLength(1);
    expect(menu).toContainElement(screen.getByTestId('brand-name'));
    expect(menu).toContainElement(screen.getByTestId('brand-logo'));
    expect(header).not.toHaveTextContent('거산 영업지원');
    expect(header).toContainElement(screen.getByTestId('font-scale'));
    expect(header).toContainElement(screen.getByRole('combobox'));
    // 왼쪽 메뉴는 화면 맨 위부터 내려온다: 위쪽 줄·알림 띠·본문이 모두 메뉴 오른쪽 칸 안에 있다.
    const rightColumn = header.parentElement as HTMLElement;
    expect(rightColumn).toContainElement(screen.getByRole('status'));
    expect(rightColumn).toContainElement(screen.getByRole('main'));
    expect(rightColumn).not.toContainElement(menu);
    expect(menu.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('#972 메뉴의 [새 후보 발굴]은 거래처 후보 화면의 새 후보 발굴 창을 여는 주소를 가리킨다', async () => {
    renderFrame();
    expect(screen.getByTestId('nav-new-candidates')).toHaveAttribute(
      'href',
      '/opportunities?newCandidates=1',
    );
    await screen.findByText('거산 영업지원');
  });

  it('담당자를 고르면 기록할 수 있고 브라우저에 기억된다', async () => {
    renderFrame();
    expect(screen.getByTestId('probe')).toHaveTextContent('none|false');
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByTitle('김 과장'));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('kim-gwajang|true'));
    expect(window.localStorage.getItem(STAFF_STORAGE_KEY)).toBe('kim-gwajang');
  });

  it('기억해 둔 담당자는 새로 열어도 복원되고, 보기 전용이면 기록할 수 없다', async () => {
    window.localStorage.setItem(STAFF_STORAGE_KEY, 'viewer');
    renderFrame();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('viewer|false'));
  });

  it('기억해 둔 키가 설정 목록에 없으면 고른 것으로 치지 않는다', async () => {
    window.localStorage.setItem(STAFF_STORAGE_KEY, 'ghost');
    renderFrame();
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(screen.getByTestId('probe')).toHaveTextContent('none|false');
  });

  it('#983 넓은 화면: 왼쪽 메뉴는 항상 펼쳐져 있고 접기 단추가 없으며, 메뉴 아래에 달력 칸이 있다(화면에는 넓은 화면이라고 알린다)', async () => {
    // 예전에 "접음"으로 기억해 둔 값이 있어도 펼친다.
    window.localStorage.setItem('geosan.sidebarCollapsed', 'true');
    renderFrame();
    await screen.findByText('거산 영업지원');
    const menu = screen.getByRole('navigation', { name: frame.navLabel });
    expect(menu).toHaveAttribute('data-collapsed', 'false');
    expect(screen.queryByTestId('side-menu-toggle')).not.toBeInTheDocument();
    expect(menu).toContainElement(screen.getByTestId('side-calendar'));
    expect(screen.getByRole('main')).not.toContainElement(screen.getByTestId('side-calendar'));
    expect(screen.getByTestId('probe-narrow')).toHaveTextContent('false');
  });

  it('#983 좁은 기기: 지금 방식 그대로 접기 단추가 있고 접힌 채로 열리며, 메뉴 아래 달력은 없다(화면에 좁은 기기라고 알려 영업 홈이 본문 맨 아래에 달력을 그린다)', async () => {
    vi.stubGlobal('screen', { width: 800 });
    renderFrame();
    await screen.findByTestId('brand-logo');
    const menu = screen.getByRole('navigation', { name: frame.navLabel });
    expect(menu).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('side-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('side-calendar')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe-narrow')).toHaveTextContent('true');
  });

  it('설정을 못 읽으면 담당자 목록 실패 문구를 보이고 내부용 띠는 그대로 보인다', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderFrame();
    expect(await screen.findByTestId('staff-load-failed')).toHaveTextContent(frame.staffLoadFailed);
    expect(screen.getByRole('status')).toHaveTextContent(banner.internalOnly);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
