// #762 왼쪽 메뉴: 네 줄(그림 + 이름), 접으면 아이콘만(이름은 aria-label·title·이름표), 접은 상태 기억, 좁은 기기는 접힌 채로.
// #767(PM 2026-11-16): 이모지 대신 내용에 맞는 선 그림 아이콘(SVG, data-icon)이라 글자에는 한글 이름만 있다.
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
