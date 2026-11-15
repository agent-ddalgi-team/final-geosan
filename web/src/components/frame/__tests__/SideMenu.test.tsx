// #762 왼쪽 메뉴: 네 줄(그림 + 이름), 접으면 아이콘만(이름은 aria-label·title·이름표), 접은 상태 기억, 좁은 기기는 접힌 채로.
// #767(PM 2026-11-16): 이모지 대신 내용에 맞는 선 그림 아이콘(SVG, data-icon)이라 글자에는 한글 이름만 있다.
// #770: 새로 생긴 것 숫자 꼬리표. 숫자 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { getMenuBadges } from '../../../api/menuBadges';
import SideMenu, { SIDEBAR_STORAGE_KEY } from '../SideMenu';
import { frame } from '../../../labels/ko';

vi.mock('../../../api/menuBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/menuBadges')>()),
  getMenuBadges: vi.fn(),
}));

const mockedBadges = vi.mocked(getMenuBadges);

function badgesAre(dashboard: number, list: number, bookmarks: number) {
  mockedBadges.mockResolvedValue({ data: { dashboard, list, bookmarks }, meta: {} });
}

function renderMenu(path = '/', narrowDevice = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SideMenu narrowDevice={narrowDevice} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockedBadges.mockReset();
  badgesAre(0, 0, 0);
});

it('네 줄이 순서대로 그림과 이름으로 보이고 각 화면 주소를 가리킨다', () => {
  renderMenu();
  const links = [
    ['nav-dashboard-link', 'dashboard', frame.menuDashboard, '/'],
    ['nav-opportunities-link', 'find', '신규 거래처 찾기', '/opportunities'],
    ['nav-bookmarks-link', 'bookmarks', '관심 기업', '/bookmarks'],
    ['nav-sales-analysis-link', 'sales-analysis', frame.menuSalesAnalysis, '/sales-analysis'],
  ] as const;
  const items = screen.getAllByRole('link');
  expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(links.map((l) => l[0]));
  for (const [testId, icon, label, href] of links) {
    const link = screen.getByTestId(testId);
    expect(link).toHaveTextContent(new RegExp(`^${label}$`));
    expect(link.querySelector('svg')).toHaveAttribute('data-icon', icon);
    expect(link).toHaveAttribute('href', href);
  }
});

it('지금 보는 화면 줄에 aria-current가 붙는다(관심 기업)', () => {
  renderMenu('/bookmarks');
  expect(screen.getByTestId('nav-bookmarks-link')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByTestId('nav-dashboard-link')).not.toHaveAttribute('aria-current');
});

it('[‹]로 접으면 아이콘만 남고 이름은 aria-label·title로 남으며, 접은 상태를 기억한다', async () => {
  const user = userEvent.setup();
  const view = renderMenu();
  const toggle = screen.getByTestId('side-menu-toggle');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.click(toggle);
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  expect(toggle).toHaveAttribute('aria-label', frame.sidebarExpand);
  const bookmarks = screen.getByTestId('nav-bookmarks-link');
  // 글자 칸 대신 그림 + 손 올림 이름표(aria-hidden)만 있다.
  expect(bookmarks.querySelector('svg')).toHaveAttribute('data-icon', 'bookmarks');
  expect(bookmarks.querySelector('.side-nav-tip')).toHaveTextContent('관심 기업');
  expect(bookmarks.querySelector('.side-nav-tip')).toHaveAttribute('aria-hidden', 'true');
  expect(bookmarks).toHaveAttribute('aria-label', '관심 기업');
  expect(bookmarks).toHaveAttribute('title', '관심 기업');
  expect(screen.getByRole('link', { name: '관심 기업' })).toBe(bookmarks);
  expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
  view.unmount();
  renderMenu();
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  await user.click(screen.getByTestId('side-menu-toggle'));
  expect(screen.getByTestId('nav-bookmarks-link')).toHaveTextContent(/^관심 기업$/);
  expect(screen.getByTestId('nav-bookmarks-link').querySelector('.side-nav-tip')).toBeNull();
  expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
});

it('좁은 기기는 처음부터 접힌 채로 열고, 기억한 값이 있으면 그 값을 따른다', () => {
  const view = renderMenu('/', true);
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  view.unmount();
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false');
  renderMenu('/', true);
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
});

it('메뉴 안 글자는 한글뿐이고(영어·이모지 없음), 묶음 이름 "영업"이 보인다', () => {
  renderMenu();
  const text = screen.getByTestId('side-menu').textContent ?? '';
  expect(text).toContain('영업');
  expect(text).not.toMatch(/[A-Za-z]/);
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
});

describe('새로 생긴 것 숫자 꼬리표 (#770)', () => {
  it('펼친 메뉴: 숫자가 이름 뒤에 붙고, 0인 줄과 영업 분석에는 없다. 링크 이름이 뜻까지 읽힌다', async () => {
    badgesAre(3, 12, 0);
    renderMenu();
    const dashboard = await screen.findByTestId('nav-dashboard-link-badge');
    expect(dashboard).toHaveTextContent(/^3$/);
    expect(dashboard).toHaveAttribute('title', '오늘 확인할 것 3곳');
    expect(dashboard).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('nav-opportunities-link-badge')).toHaveTextContent(/^12$/);
    expect(screen.queryByTestId('nav-bookmarks-link-badge')).toBeNull();
    expect(screen.queryByTestId('nav-sales-analysis-link-badge')).toBeNull();
    // 펼친 상태에서 꼬리표는 그림 틀 밖(이름 뒤)에 있다.
    expect(
      within(screen.getByTestId('nav-dashboard-link-icon')).queryByTestId(
        'nav-dashboard-link-badge',
      ),
    ).toBeNull();
    expect(screen.getByRole('link', { name: '신규 거래처 찾기, 새 후보 12곳' })).toBe(
      screen.getByTestId('nav-opportunities-link'),
    );
    expect(screen.getByTestId('nav-bookmarks-link')).not.toHaveAttribute('aria-label');
  });

  it('접은 메뉴: 숫자가 그림 모서리에 얹히고 이름표·aria-label에 뜻이 붙는다', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    badgesAre(0, 0, 2);
    renderMenu();
    const icon = screen.getByTestId('nav-bookmarks-link-icon');
    expect(await within(icon).findByTestId('nav-bookmarks-link-badge')).toHaveTextContent(/^2$/);
    const link = screen.getByTestId('nav-bookmarks-link');
    expect(link).toHaveAttribute('aria-label', '관심 기업, 새 소식 2곳');
    expect(link.querySelector('.side-nav-tip')).toHaveTextContent('관심 기업, 새 소식 2곳');
    expect(screen.getByTestId('nav-dashboard-link')).toHaveAttribute('aria-label', '대시보드');
  });

  it('99를 넘으면 "99+"로 줄인다(뜻에는 실제 곳 수)', async () => {
    badgesAre(0, 240, 0);
    renderMenu();
    const badge = await screen.findByTestId('nav-opportunities-link-badge');
    expect(badge).toHaveTextContent(/^99\+$/);
    expect(badge).toHaveAttribute('title', '새 후보 240곳');
  });

  it('숫자를 못 읽으면 꼬리표 없이 메뉴 네 줄만 그대로 보인다', async () => {
    mockedBadges.mockReset();
    mockedBadges.mockRejectedValue(new Error('network'));
    renderMenu();
    await waitFor(() => expect(mockedBadges).toHaveBeenCalled());
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByTestId(/-badge$/)).toBeNull();
  });

  it('신규 거래처 찾기 화면에 들어오면 그 화면을 "봤음"으로 기억하고 숫자를 다시 읽는다', async () => {
    renderMenu('/opportunities');
    await waitFor(() => expect(mockedBadges).toHaveBeenCalled());
    const [seen] = mockedBadges.mock.calls[0];
    expect(seen.list).not.toBeNull();
  });
});
