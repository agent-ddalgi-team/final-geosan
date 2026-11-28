// #762 왼쪽 메뉴: 네 줄(그림 + 이름), 접으면 아이콘만(이름은 aria-label·title·이름표), 접은 상태 기억, 좁은 기기는 접힌 채로.
// #767(PM 2026-11-16): 이모지 대신 내용에 맞는 선 그림 아이콘(SVG, data-icon)이라 글자에는 한글 이름만 있다.
// #770: 새로 생긴 것 숫자 꼬리표. 숫자 요청은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
// #972(보라 톤 시안): 맨 위 로고 + 이름, 주 단추 [새 후보 발굴], 묶음 "영업" · "분석" · "운영", 지금 화면 줄·꼬리표 색.
// #987: 관심 기업 줄의 주황 꼬리표 "의견 전 n"(관심에 담고 의견을 안 고른 곳 수, 서버 bookmarksNoOpinion).
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { getMenuBadges } from '../../../api/menuBadges';
import SideMenu, {
  NEW_CANDIDATES_PATH,
  SIDEBAR_DETAIL_STORAGE_KEY,
  SIDEBAR_STORAGE_KEY,
  isDetailPath,
} from '../SideMenu';
import { FrameContext } from '../FrameContext';
import type { FrameValue } from '../FrameContext';
import type { ConfigUi } from '../../../api/types';
import { frame } from '../../../labels/ko';
import { accent, opinionNudge, sidebarTheme } from '../../../theme/tokens';

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

it('주 단추 아래로 네 줄이 순서대로 그림과 이름으로 보이고 각 화면 주소를 가리킨다', () => {
  renderMenu();
  const links = [
    ['nav-dashboard-link', 'dashboard', frame.menuDashboard, '/'],
    ['nav-opportunities-link', 'find', '거래처 후보', '/opportunities'],
    ['nav-bookmarks-link', 'bookmarks', '관심 기업', '/bookmarks'],
    ['nav-sales-analysis-link', 'sales-analysis', frame.menuSalesAnalysis, '/sales-analysis'],
  ] as const;
  const items = screen.getAllByRole('link');
  // #972: 맨 앞은 주 단추 [새 후보 발굴], 그 아래가 메뉴 네 줄이다.
  expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
    'nav-new-candidates',
    ...links.map((l) => l[0]),
  ]);
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

it('[메뉴 접기]는 메뉴 줄보다 위에 있다(머리 띠 아래에서 시작해도 첫 화면에서 보이게, #767)', () => {
  renderMenu();
  const toggle = screen.getByTestId('side-menu-toggle');
  const first = screen.getByTestId('nav-dashboard-link');
  expect(toggle.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toggle).toHaveAttribute('aria-label', frame.sidebarCollapse);
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
    expect(screen.getByRole('link', { name: '거래처 후보, 새 후보 12곳' })).toBe(
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
    expect(screen.getByTestId('nav-dashboard-link')).toHaveAttribute('aria-label', '영업 홈');
  });

  it('99를 넘으면 "99+"로 줄인다(뜻에는 실제 곳 수)', async () => {
    badgesAre(0, 240, 0);
    renderMenu();
    const badge = await screen.findByTestId('nav-opportunities-link-badge');
    expect(badge).toHaveTextContent(/^99\+$/);
    expect(badge).toHaveAttribute('title', '새 후보 240곳');
  });

  it('숫자를 못 읽으면 꼬리표 없이 주 단추와 메뉴 네 줄만 그대로 보인다', async () => {
    mockedBadges.mockReset();
    mockedBadges.mockRejectedValue(new Error('network'));
    renderMenu();
    await waitFor(() => expect(mockedBadges).toHaveBeenCalled());
    // 주 단추 [새 후보 발굴](#972) + 메뉴 네 줄.
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(
      screen.getAllByRole('link').filter((link) => link.classList.contains('side-nav-row')),
    ).toHaveLength(4);
    expect(screen.queryByTestId(/-badge$/)).toBeNull();
  });

  it('신규 거래처 찾기 화면에 들어오면 그 화면을 "봤음"으로 기억하고 숫자를 다시 읽는다', async () => {
    renderMenu('/opportunities');
    await waitFor(() => expect(mockedBadges).toHaveBeenCalled());
    const [seen] = mockedBadges.mock.calls[0];
    expect(seen.list).not.toBeNull();
  });
});

describe('관심 기업 줄의 "의견 전 n" 꼬리표 (#987)', () => {
  const TAG = 'nav-bookmarks-link-no-opinion';
  /**
   * 메뉴 숫자 응답. 영업 홈 숫자를 늘 1로 줘서, 그 꼬리표가 보인 뒤(응답이 화면에 반영된 뒤)에
   * "의견 전" 꼬리표가 있는지 없는지를 본다. bookmarksNoOpinion을 안 주면 칸이 없는 옛 서버 응답이다.
   */
  function noOpinionIs(bookmarksNoOpinion: number | undefined, bookmarks = 0) {
    mockedBadges.mockResolvedValue({
      data: {
        dashboard: 1,
        list: 0,
        bookmarks,
        ...(bookmarksNoOpinion === undefined ? {} : { bookmarksNoOpinion }),
      },
      meta: {},
    });
  }
  const loaded = () => screen.findByTestId('nav-dashboard-link-badge');

  it('Given 의견 전인 관심 기업 3곳 When 펼친 메뉴 Then 관심 기업 줄에 주황 꼬리표 "의견 전 3"이 보이고, 링크 이름이 뜻까지 읽힌다', async () => {
    noOpinionIs(3);
    renderMenu();
    const tag = await screen.findByTestId(TAG);
    expect(tag).toHaveTextContent(/^의견 전 3$/);
    expect(tag).toHaveAttribute('title', '의견을 안 고른 관심 기업 3곳');
    // 꼬리표 글자는 낭독에서 빼고, 뜻은 링크 이름으로 읽힌다.
    expect(tag).toHaveAttribute('aria-hidden', 'true');
    expect(tag).toHaveStyle({ background: opinionNudge.bg, color: opinionNudge.fg });
    const link = screen.getByTestId('nav-bookmarks-link');
    expect(link).toContainElement(tag);
    expect(link).toHaveAttribute('aria-label', '관심 기업, 의견을 안 고른 관심 기업 3곳');
    expect(screen.getByRole('link', { name: '관심 기업, 의견을 안 고른 관심 기업 3곳' })).toBe(
      link,
    );
    // 이름 뒤에 놓이고, 그림 틀 안에는 없다.
    expect(
      within(link).getByText('관심 기업').compareDocumentPosition(tag) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(screen.getByTestId('nav-bookmarks-link-icon')).queryByTestId(TAG)).toBeNull();
    // 관심 기업 줄에만 붙는다. 새 소식이 없으면 숫자 꼬리표는 없다.
    expect(screen.getAllByTestId(/-no-opinion$/)).toHaveLength(1);
    expect(screen.queryByTestId('nav-bookmarks-link-badge')).toBeNull();
  });

  it('Given 새 소식 2곳과 의견 전 3곳이 같이 있음 When 펼친 메뉴 Then "의견 전 3" 옆에 새 소식 숫자가 그대로 있고 링크 이름은 둘 다 읽힌다', async () => {
    noOpinionIs(3, 2);
    renderMenu();
    const tag = await screen.findByTestId(TAG);
    const badge = screen.getByTestId('nav-bookmarks-link-badge');
    expect(tag).toHaveTextContent(/^의견 전 3$/);
    expect(badge).toHaveTextContent(/^2$/);
    expect(badge).toHaveAttribute('title', '새 소식 2곳');
    expect(tag.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('nav-bookmarks-link')).toHaveAttribute(
      'aria-label',
      '관심 기업, 새 소식 2곳, 의견을 안 고른 관심 기업 3곳',
    );
  });

  it.each([
    ['0곳', 0],
    ['서버가 칸을 안 줌(옛 서버)', undefined],
  ])(
    'Given 의견 전 %s When 펼친 메뉴 Then 꼬리표가 없고 링크 이름도 그대로다',
    async (_name, value) => {
      noOpinionIs(value);
      renderMenu();
      await loaded();
      expect(screen.queryByTestId(TAG)).toBeNull();
      expect(screen.queryByTestId(/-no-opinion$/)).toBeNull();
      expect(screen.getByTestId('nav-bookmarks-link')).not.toHaveAttribute('aria-label');
      expect(screen.getByTestId('nav-bookmarks-link')).toHaveTextContent(/^관심 기업$/);
    },
  );

  it('Given 의견 전 0곳이지만 새 소식 2곳 When 펼친 메뉴 Then 새 소식 숫자만 있고 링크 이름에 의견 전 말이 붙지 않는다', async () => {
    noOpinionIs(0, 2);
    renderMenu();
    expect(await screen.findByTestId('nav-bookmarks-link-badge')).toHaveTextContent(/^2$/);
    expect(screen.queryByTestId(TAG)).toBeNull();
    expect(screen.getByTestId('nav-bookmarks-link')).toHaveAttribute(
      'aria-label',
      '관심 기업, 새 소식 2곳',
    );
  });

  it('Given 의견 전 3곳 · 새 소식 2곳 When 접힌 메뉴 Then "의견 전" 꼬리표는 그리지 않고(새 소식 숫자만 그림에 얹힘) 이름표·aria-label에는 뜻이 남는다', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    noOpinionIs(3, 2);
    renderMenu();
    const icon = screen.getByTestId('nav-bookmarks-link-icon');
    expect(await within(icon).findByTestId('nav-bookmarks-link-badge')).toHaveTextContent(/^2$/);
    expect(screen.queryByTestId(TAG)).toBeNull();
    const link = screen.getByTestId('nav-bookmarks-link');
    expect(link).not.toHaveTextContent('의견 전');
    expect(link).toHaveAttribute(
      'aria-label',
      '관심 기업, 새 소식 2곳, 의견을 안 고른 관심 기업 3곳',
    );
    expect(link.querySelector('.side-nav-tip')).toHaveTextContent(
      '관심 기업, 새 소식 2곳, 의견을 안 고른 관심 기업 3곳',
    );
  });

  it('Given 의견 전 3곳뿐 When 접힌 메뉴 Then 꼬리표 없이 aria-label로만 알린다', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    noOpinionIs(3);
    renderMenu();
    await waitFor(() =>
      expect(screen.getByTestId('nav-bookmarks-link')).toHaveAttribute(
        'aria-label',
        '관심 기업, 의견을 안 고른 관심 기업 3곳',
      ),
    );
    expect(screen.queryByTestId(TAG)).toBeNull();
    expect(screen.queryByTestId('nav-bookmarks-link-badge')).toBeNull();
  });

  it('Given 의견 전 120곳 When 펼친 메뉴 Then 글은 "의견 전 99+"로 줄이고 뜻에는 실제 곳 수를 적는다', async () => {
    noOpinionIs(120);
    renderMenu();
    const tag = await screen.findByTestId(TAG);
    expect(tag).toHaveTextContent(/^의견 전 99\+$/);
    expect(tag).toHaveAttribute('title', '의견을 안 고른 관심 기업 120곳');
    expect(frame.menuNoOpinion(99)).toBe('의견 전 99');
    expect(frame.menuNoOpinion(100)).toBe('의견 전 99+');
  });

  it('Given 숫자를 못 읽음 When 메뉴 Then "의견 전" 꼬리표도 없다', async () => {
    mockedBadges.mockReset();
    mockedBadges.mockRejectedValue(new Error('network'));
    renderMenu();
    await waitFor(() => expect(mockedBadges).toHaveBeenCalled());
    await act(async () => {
      await Promise.allSettled(mockedBadges.mock.results.map((result) => result.value));
    });
    expect(screen.queryByTestId(/-no-opinion$/)).toBeNull();
    expect(screen.getByTestId('nav-bookmarks-link')).not.toHaveAttribute('aria-label');
  });
});

it('기업 상세에서는 처음에 접혀 있고, 펴면 상세 기억에만 남아 다른 화면의 기억은 그대로다 (#803)', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false');
  const view = renderMenu('/opportunities/opp-1');
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'true');
  await user.click(screen.getByTestId('side-menu-toggle'));
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
  expect(window.localStorage.getItem(SIDEBAR_DETAIL_STORAGE_KEY)).toBe('false');
  expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
  view.unmount();
  renderMenu('/opportunities');
  expect(screen.getByTestId('side-menu')).toHaveAttribute('data-collapsed', 'false');
  expect(isDetailPath('/opportunities/opp-1/report')).toBe(false);
  expect(isDetailPath('/opportunities')).toBe(false);
});

describe('새 디자인 (#972)', () => {
  function renderWithFrame(value: Partial<FrameValue>, path = '/') {
    const frameValue: FrameValue = {
      config: null,
      staffKey: null,
      setStaffKey: () => {},
      canRecord: false,
      setBannerMeta: () => {},
      setPageTitle: () => {},
      ...value,
    };
    return render(
      <FrameContext.Provider value={frameValue}>
        <MemoryRouter initialEntries={[path]}>
          <SideMenu narrowDevice={false} />
        </MemoryRouter>
      </FrameContext.Provider>,
    );
  }

  it('맨 위에 로고와 이름이 있고, 그 아래 주 단추 [새 후보 발굴]이 새 후보 발굴 창을 여는 주소를 가리킨다', () => {
    renderMenu();
    const menu = screen.getByTestId('side-menu');
    const logo = within(menu).getByTestId('brand-logo');
    expect(logo.getAttribute('src')).toMatch(/geosan-logo/);
    // 옆에 이름 글자가 있으므로 그림은 꾸밈(alt 빈 값)이다.
    expect(logo).toHaveAttribute('alt', '');
    expect(within(menu).getByTestId('brand-name')).toHaveTextContent(/^거산 영업지원$/);
    const button = screen.getByTestId('nav-new-candidates');
    expect(button).toHaveTextContent(/^새 후보 발굴$/);
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'new-candidates');
    expect(NEW_CANDIDATES_PATH).toBe('/opportunities?newCandidates=1');
    expect(button).toHaveAttribute('href', NEW_CANDIDATES_PATH);
    expect(button).toHaveStyle({
      background: sidebarTheme.primaryBg,
      color: sidebarTheme.primaryFg,
    });
    // 순서: 로고 → 주 단추 → 메뉴 첫 줄.
    const first = screen.getByTestId('nav-dashboard-link');
    expect(logo.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('공통 틀이 넘긴 이름·로고가 있으면 그 값으로 보이고, 로고가 없으면 이름만 보인다', () => {
    render(
      <MemoryRouter>
        <SideMenu narrowDevice={false} brand={{ logoUrl: null, brandName: '가상 영업지원' }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('brand-name')).toHaveTextContent('가상 영업지원');
    expect(screen.queryByTestId('brand-logo')).toBeNull();
  });

  it('접으면 주 단추는 더하기 그림만 남고 이름은 aria-label·title·이름표로 남으며, 로고가 이름을 대신 읽힌다', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByTestId('side-menu-toggle'));
    const button = screen.getByTestId('nav-new-candidates');
    expect(button.querySelector('svg')).toHaveAttribute('data-icon', 'new-candidates');
    expect(button).toHaveAttribute('aria-label', '새 후보 발굴');
    expect(button).toHaveAttribute('title', '새 후보 발굴');
    expect(button.querySelector('.side-nav-tip')).toHaveTextContent('새 후보 발굴');
    expect(screen.getByRole('link', { name: '새 후보 발굴' })).toBe(button);
    expect(button).toHaveAttribute('href', NEW_CANDIDATES_PATH);
    expect(screen.queryByTestId('brand-name')).toBeNull();
    expect(screen.getByTestId('brand-logo')).toHaveAttribute('alt', '거산 영업지원');
  });

  it('묶음 "영업"에 세 줄, "분석"에 영업 분석이 있고, 운영 담당이 아니면 "운영" 묶음은 없다', () => {
    renderMenu();
    const sales = screen.getByRole('list', { name: '영업' });
    expect(
      within(sales)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual(['nav-dashboard-link', 'nav-opportunities-link', 'nav-bookmarks-link']);
    const analysis = screen.getByRole('list', { name: '분석' });
    expect(
      within(analysis)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual(['nav-sales-analysis-link']);
    expect(screen.queryByRole('list', { name: '운영' })).toBeNull();
    expect(screen.queryByTestId('nav-operations-link')).toBeNull();
    const text = screen.getByTestId('side-menu').textContent ?? '';
    expect(text.indexOf('영업 홈')).toBeLessThan(text.indexOf('분석'));
  });

  it('운영 담당에게는 맨 아래 "운영" 묶음에 운영 관리가 보인다', () => {
    renderWithFrame({
      staffKey: 'ops-kim',
      config: { operationsStaffKeys: ['ops-kim'] } as unknown as ConfigUi,
    });
    const operations = screen.getByRole('list', { name: '운영' });
    const link = within(operations).getByTestId('nav-operations-link');
    expect(link).toHaveTextContent(/^운영 관리$/);
    expect(link).toHaveAttribute('href', '/operations');
    const lists = screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'));
    expect(lists).toEqual(['영업', '분석', '운영']);
  });

  it('지금 화면 줄은 강조 연한 바탕 + 강조 글자 굵게이고, 다른 줄은 바탕 없이 보조 글자다', () => {
    renderMenu('/bookmarks');
    expect(screen.getByTestId('nav-bookmarks-link')).toHaveStyle({
      background: accent.soft,
      color: accent.text,
      fontWeight: 600,
    });
    const other = screen.getByTestId('nav-dashboard-link');
    expect(other).toHaveStyle({ color: sidebarTheme.fg, fontWeight: 400 });
    expect(other.style.background).toBe('');
  });

  it('숫자 꼬리표는 연보라 바탕 + 강조 글자다(빨강을 쓰지 않는다)', async () => {
    badgesAre(4, 0, 0);
    renderMenu();
    expect(await screen.findByTestId('nav-dashboard-link-badge')).toHaveStyle({
      background: accent.softDeep,
      color: accent.text,
    });
  });

  it('새 후보 발굴 주소로 들어와도 거래처 후보 줄이 지금 화면으로 표시된다', () => {
    renderMenu(NEW_CANDIDATES_PATH);
    expect(screen.getByTestId('nav-opportunities-link')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('nav-new-candidates')).not.toHaveAttribute('aria-current');
  });
});
