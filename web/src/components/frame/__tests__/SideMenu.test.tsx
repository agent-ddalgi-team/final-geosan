// #762 왼쪽 메뉴: 네 줄(이모지 + 이름), 접으면 아이콘만(이름은 aria-label·title), 접은 상태 기억, 좁은 기기는 접힌 채로.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SideMenu, { SIDEBAR_STORAGE_KEY } from '../SideMenu';
import { frame } from '../../../labels/ko';

function renderMenu(path = '/', narrowDevice = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SideMenu narrowDevice={narrowDevice} />
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());

it('네 줄이 순서대로 이모지와 이름으로 보이고 각 화면 주소를 가리킨다', () => {
  renderMenu();
  const links = [
    ['nav-dashboard-link', '📊', frame.menuDashboard, '/'],
    ['nav-opportunities-link', '🔍', '신규 거래처 찾기', '/opportunities'],
    ['nav-bookmarks-link', '⭐', '관심 기업', '/bookmarks'],
    ['nav-sales-analysis-link', '📈', frame.menuSalesAnalysis, '/sales-analysis'],
  ] as const;
  const items = screen.getAllByRole('link');
  expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(links.map((l) => l[0]));
  for (const [testId, icon, label, href] of links) {
    const link = screen.getByTestId(testId);
    expect(link).toHaveTextContent(`${icon}${label}`);
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
  expect(bookmarks).toHaveTextContent(/^⭐$/);
  expect(bookmarks).toHaveAttribute('aria-label', '관심 기업');
  expect(bookmarks).toHaveAttribute('title', '관심 기업');
  expect(screen.getByRole('link', { name: '관심 기업' })).toBe(bookmarks);
  expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
  view.unmount();
  renderMenu();
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  await user.click(screen.getByTestId('side-menu-toggle'));
  expect(screen.getByTestId('nav-bookmarks-link')).toHaveTextContent('⭐관심 기업');
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
