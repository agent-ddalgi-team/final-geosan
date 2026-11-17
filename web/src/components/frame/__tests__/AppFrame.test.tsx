// 공통 틀: 랜드마크·건너뛰기 링크·h1, 설정 읽기(담당자 목록·띠), 담당자 기억, 보기 전용, 설정 실패.
// 서버 없이 VITE_USE_FIXTURES=1 가짜 응답으로 돌린다(실제 서버 연결 확인이 아님).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AppFrame from '../AppFrame';
import { STAFF_STORAGE_KEY, useFrame } from '../FrameContext';
import { banner, frame } from '../../../labels/ko';

function Probe() {
  const { staffKey, canRecord } = useFrame();
  return <span data-testid="probe">{`${staffKey ?? 'none'}|${canRecord}`}</span>;
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

  it('설정을 못 읽으면 담당자 목록 실패 문구를 보이고 내부용 띠는 그대로 보인다', async () => {
    vi.stubEnv('VITE_USE_FIXTURES', '0');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    renderFrame();
    expect(await screen.findByTestId('staff-load-failed')).toHaveTextContent(frame.staffLoadFailed);
    expect(screen.getByRole('status')).toHaveTextContent(banner.internalOnly);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
