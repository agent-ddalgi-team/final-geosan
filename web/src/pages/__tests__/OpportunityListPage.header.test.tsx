// 추천 목록 머리(#361, 2026-11-06 PM 결정): 공정 선택란(9종·0곳 포함·"전체" 없음) /
// 공정을 고르기 전에는 목록을 비워 두고 마지막으로 본 공정을 기억한다(#368, 2026-11-06 PM 결정) /
// 회사 이름 검색(전체 후보에서, 검색어만 보냄, [검색 지우기]로 직전 주소 복귀) / 정렬("가까운 순"은 준비 중).
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { LAST_PROCESS_STORAGE_KEY } from '../../components/list/lastProcess';
import { bookmarkList, listFilters, listSearch } from '../../labels/ko';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const mockedGet = vi.mocked(getOpportunities);
const apjeong = listFixture.data[0] as unknown as OpportunityCard;

function reply(items: OpportunityCard[], meta = {}): Envelope<OpportunityCard[]> {
  return { data: items, meta: { total: items.length, ...meta } };
}

/** 조건이 하나도 없을 때 getOpportunities의 네 번째 인자. */
const NO_FILTERS = {
  process: null,
  region: null,
  industry: null,
  stage: null,
  filter: null,
  q: null,
};

/** 거산 공정 9종(서버가 주는 순서). 앞의 두 공정에만 회사가 있다. */
const NINE = [
  { processCode: 'ZINC_PLATING', processName: '아연도금(전기아연도금)', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징(양극산화피막)', count: 10 },
  { processCode: 'BLACK_OXIDE', processName: '알카리 흑착(흑색산화피막)', count: 0 },
  { processCode: 'ELECTROLESS_NICKEL', processName: '무전해 니켈', count: 0 },
  { processCode: 'CHROME_PLATING', processName: '크롬 도금', count: 0 },
  { processCode: 'ELECTROPOLISHING', processName: '전해연마', count: 0 },
  { processCode: 'PHOSPHATE_COATING', processName: '인산염 피막', count: 0 },
  { processCode: 'CHROMATE', processName: '크로메이트(화성피막)', count: 0 },
  { processCode: 'PASSIVATION', processName: '부동태(부동태 처리)', count: 0 },
];

const MENU = {
  processCounts: NINE,
  regionCounts: [
    { region: '천안 인근', count: 8 },
    { region: '아산시', count: 3 },
  ],
  industryCounts: [{ industry: '자동차 부품', count: 2 }],
};

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(initial = '/opportunities') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <FrameContext.Provider
        value={{
          config: null,
          staffKey: 'park-lee',
          setStaffKey: () => {},
          canRecord: true,
          setBannerMeta: () => {},
          setPageTitle: () => {},
        }}
      >
        <OpportunityListPage />
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

const lastFilters = () => mockedGet.mock.calls.at(-1)?.[3];
const locationText = () => screen.getByTestId('location').textContent ?? '';
/** 지금 주소의 조건을 이름-값으로 읽는다(한글이 %로 바뀐 주소도 같은 값으로 견주려고). */
const locationParams = () =>
  Object.fromEntries(new URLSearchParams(locationText().split('?')[1] ?? ''));

async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = screen.getByTestId('list-search-input');
  await user.clear(input);
  await user.type(input, text);
  await user.click(screen.getByTestId('list-search-button'));
}

describe('OpportunityListPage 목록 머리 (#361)', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  describe('공정 선택란', () => {
    it('거산 공정 9종이 모두 선택란에 보이고 0곳인 공정도 보이며, "전체"는 없다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ZINC_PLATING');
      await screen.findByTestId('opportunity-card');
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        '아연도금(전기아연도금) 9',
        '아노다이징(양극산화피막) 10',
        '알카리 흑착(흑색산화피막) 0',
        '무전해 니켈 0',
        '크롬 도금 0',
        '전해연마 0',
        '인산염 피막 0',
        '크로메이트(화성피막) 0',
        '부동태(부동태 처리) 0',
      ]);
      expect(
        within(select).queryByRole('option', { name: listFilters.all }),
      ).not.toBeInTheDocument();
      expect(select.value).toBe('ZINC_PLATING');
      // 공정·지역·산업 선택란이 같은 머리 안에 함께 있다.
      const bar = screen.getByTestId('list-filter-bar');
      expect(within(bar).getByTestId('list-region-select')).toBeInTheDocument();
      expect(within(bar).getByTestId('list-industry-select')).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('0곳인 공정을 고르면 그 공정으로 불러오고 빈 목록과 안내 문장이 보인다', async () => {
      const user = userEvent.setup();
      mockedGet.mockImplementation((_page, _size, _signal, filters) =>
        Promise.resolve(
          filters?.process === 'CHROME_PLATING'
            ? reply([], { ...MENU, regionCounts: [], industryCounts: [], total: 0 })
            : reply([apjeong], MENU),
        ),
      );
      renderPage('/opportunities?process=ZINC_PLATING&region=아산시');
      await screen.findByTestId('opportunity-card');
      await user.selectOptions(screen.getByTestId('list-process-select'), 'CHROME_PLATING');
      expect(
        await screen.findByText(
          '이 공정의 후보가 아직 없습니다. 후보 찾기로 회사를 찾으면 여기에 나타납니다',
        ),
      ).toBeInTheDocument();
      expect(lastFilters()).toEqual({ ...NO_FILTERS, process: 'CHROME_PLATING' });
      expect(locationText()).toBe('/opportunities?process=CHROME_PLATING');
      expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument();
      // 빈 공정에서도 선택란은 남아 다른 공정으로 바꿀 수 있다.
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe(
        'CHROME_PLATING',
      );
    });

    it('회사가 있는 공정에서 지역으로 걸러 0곳이면 0곳 공정 안내가 아니라 조건을 바꿔 보라는 문구다', async () => {
      mockedGet.mockResolvedValue(reply([], { ...MENU, total: 0 }));
      renderPage('/opportunities?process=ANODIZING&region=아산시');
      expect(await screen.findByText(listFilters.filteredEmpty)).toBeInTheDocument();
      expect(screen.queryByText(listFilters.processEmpty)).not.toBeInTheDocument();
    });

    it('공정·지역·산업을 바꾸면 맞는 조건을 서버에 보내고 주소에 남긴다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ZINC_PLATING');
      await screen.findByTestId('opportunity-card');
      await user.selectOptions(screen.getByTestId('list-region-select'), '아산시');
      await waitFor(() =>
        expect(lastFilters()).toEqual({ ...NO_FILTERS, process: 'ZINC_PLATING', region: '아산시' }),
      );
      await user.selectOptions(screen.getByTestId('list-industry-select'), '자동차 부품');
      await waitFor(() =>
        expect(lastFilters()).toEqual({
          ...NO_FILTERS,
          process: 'ZINC_PLATING',
          region: '아산시',
          industry: '자동차 부품',
        }),
      );
      expect(locationParams()).toEqual({
        process: 'ZINC_PLATING',
        region: '아산시',
        industry: '자동차 부품',
      });
      await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, process: 'ANODIZING' }));
      expect(locationParams()).toEqual({ process: 'ANODIZING' });
    });
  });

  // 처음 열 때의 규칙(#368, 2026-11-06 PM 결정): #361의 "처음에는 (회사가 있는) 첫 공정"을 바꿨다.
  // 프로그램이 공정을 대신 고르지 않고, 고르기 전에는 목록을 비워 두며, 마지막으로 본 공정을 브라우저에 기억한다.
  describe('공정을 고르기 전 (#368)', () => {
    const remembered = () => window.localStorage.getItem(LAST_PROCESS_STORAGE_KEY);

    it('기억한 공정 없이 처음 열면 공정이 골라져 있지 않고, 카드 없이 "공정을 고르면…" 안내만 보인다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], { ...MENU, total: 19 }));
      renderPage();
      expect(
        await screen.findByText('공정을 고르면 그 공정의 후보가 나타납니다'),
      ).toBeInTheDocument();
      // 프로그램이 공정을 대신 고르지 않는다: 한 번만 부르고 주소도 그대로다.
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0][3]).toEqual(NO_FILTERS);
      expect(locationText()).toBe('/opportunities');
      // 서로 다른 공정의 회사를 한 줄로 섞어 보이지 않는다.
      expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-total')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-pagination')).not.toBeInTheDocument();
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(select.value).toBe('');
      const options = within(select).getAllByRole('option') as HTMLOptionElement[];
      expect(options).toHaveLength(10);
      expect(options[0]).toHaveTextContent(/^공정을 고르세요$/);
      expect(options[0]).toBeDisabled();
      expect(options[1]).toHaveTextContent('아연도금(전기아연도금) 9');
      // 지역·산업만으로는 목록을 보이지 않으므로 공정을 고르기 전에는 두 선택란이 없다.
      expect(screen.queryByTestId('list-region-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-industry-select')).not.toBeInTheDocument();
      // 검색 칸과 정렬은 고르기 전에도 쓸 수 있다.
      expect(screen.getByTestId('list-search-input')).toBeInTheDocument();
      expect(screen.getByTestId('list-sort')).toBeInTheDocument();
      expect(remembered()).toBeNull();
    });

    it('회사가 있는 공정이 하나도 없어도 공정을 대신 고르지 않고, 0곳 공정 안내가 아니라 고르라는 안내다', async () => {
      const allEmpty = NINE.map((item) => ({ ...item, count: 0 }));
      mockedGet.mockResolvedValue(reply([], { processCounts: allEmpty, total: 0 }));
      renderPage();
      expect(await screen.findByText(listFilters.pickProcess)).toBeInTheDocument();
      expect(screen.queryByText(listFilters.processEmpty)).not.toBeInTheDocument();
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(locationText()).toBe('/opportunities');
    });

    it('공정을 고르면 그 공정의 카드와 지역·산업 선택란이 나타나고, 고르라는 글자는 사라진다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage();
      await screen.findByText(listFilters.pickProcess);
      await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
      await screen.findByTestId('opportunity-card');
      expect(lastFilters()).toEqual({ ...NO_FILTERS, process: 'ANODIZING' });
      expect(locationText()).toBe('/opportunities?process=ANODIZING');
      expect(screen.queryByText(listFilters.pickProcess)).not.toBeInTheDocument();
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(select.value).toBe('ANODIZING');
      expect(within(select).getAllByRole('option')).toHaveLength(9);
      expect(
        within(select).queryByRole('option', { name: listFilters.processPlaceholder }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-industry-select')).toBeInTheDocument();
      expect(remembered()).toBe('ANODIZING');
    });

    it('공정을 본 뒤 공정 없이 목록을 다시 열면 지난번에 본 공정으로 바로 열린다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      const first = renderPage('/opportunities?process=ANODIZING');
      await screen.findByTestId('opportunity-card');
      expect(remembered()).toBe('ANODIZING');
      first.unmount();
      mockedGet.mockClear();
      renderPage();
      await screen.findByTestId('opportunity-card');
      expect(locationText()).toBe('/opportunities?process=ANODIZING');
      expect(mockedGet).toHaveBeenCalledTimes(2);
      expect(mockedGet.mock.calls[0][3]).toEqual(NO_FILTERS);
      expect(mockedGet.mock.calls[1][3]).toEqual({ ...NO_FILTERS, process: 'ANODIZING' });
      expect(screen.queryByText(listFilters.pickProcess)).not.toBeInTheDocument();
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe(
        'ANODIZING',
      );
    });

    it('다른 공정으로 바꾸면 기억도 그 공정으로 바뀐다(0곳인 공정도)', async () => {
      const user = userEvent.setup();
      mockedGet.mockImplementation((_page, _size, _signal, filters) =>
        Promise.resolve(
          filters?.process === 'CHROME_PLATING'
            ? reply([], { ...MENU, regionCounts: [], industryCounts: [], total: 0 })
            : reply([apjeong], MENU),
        ),
      );
      renderPage('/opportunities?process=ZINC_PLATING');
      await screen.findByTestId('opportunity-card');
      expect(remembered()).toBe('ZINC_PLATING');
      await user.selectOptions(screen.getByTestId('list-process-select'), 'CHROME_PLATING');
      await screen.findByText(listFilters.processEmpty);
      expect(remembered()).toBe('CHROME_PLATING');
    });

    it('기억한 공정이 더는 없는 공정이면 기억을 지우고 고르기 전 상태로 연다', async () => {
      window.localStorage.setItem(LAST_PROCESS_STORAGE_KEY, 'OLD_PROCESS');
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage();
      expect(await screen.findByText(listFilters.pickProcess)).toBeInTheDocument();
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(locationText()).toBe('/opportunities');
      expect(remembered()).toBeNull();
    });

    it('주소의 공정이 선택지에 없는 값이면 그 값을 지우고 고르기 전 상태로 돌아간다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=NOT_A_PROCESS&region=아산시');
      expect(await screen.findByText(listFilters.pickProcess)).toBeInTheDocument();
      expect(locationParams()).toEqual({ region: '아산시' });
      expect(lastFilters()).toEqual({ ...NO_FILTERS, region: '아산시' });
      expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument();
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe('');
      // 틀린 공정은 기억하지 않는다.
      expect(remembered()).toBeNull();
    });

    it('주소의 공정이 선택지에 없는 값이어도 기억한 공정이 있으면 그 공정으로 연다', async () => {
      window.localStorage.setItem(LAST_PROCESS_STORAGE_KEY, 'ZINC_PLATING');
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=NOT_A_PROCESS');
      await waitFor(() => expect(locationText()).toBe('/opportunities?process=ZINC_PLATING'));
      await waitFor(() =>
        expect(lastFilters()).toEqual({ ...NO_FILTERS, process: 'ZINC_PLATING' }),
      );
      await screen.findByTestId('opportunity-card');
    });

    it.each([
      ['/opportunities?q=A정밀', { q: 'A정밀' }],
      ['/opportunities?bookmarked=true', { bookmarked: 'true' }],
      ['/opportunities?filter=NOT_CONTACTED', { filter: 'NOT_CONTACTED' }],
      ['/opportunities?stage=IN_PROGRESS', { stage: 'IN_PROGRESS' }],
    ])(
      '%s 는 공정을 고르지 않아도 바로 나오고, 기억한 공정으로 바뀌지도 않는다',
      async (url, expected) => {
        window.localStorage.setItem(LAST_PROCESS_STORAGE_KEY, 'ANODIZING');
        mockedGet.mockResolvedValue(reply([apjeong], MENU));
        renderPage(url);
        await screen.findByTestId('opportunity-card');
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, ...expected });
        expect(screen.queryByText(listFilters.pickProcess)).not.toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent(url);
        // 공정 없이 본 목록은 기억을 바꾸지 않는다.
        expect(remembered()).toBe('ANODIZING');
      },
    );

    it('공정 선택지가 하나도 오지 않으면(공정 자료 없음) 고르라고 하지 않고 온 목록을 그대로 보인다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage();
      await screen.findByTestId('opportunity-card');
      expect(screen.queryByText(listFilters.pickProcess)).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
    });

    it('브라우저 저장소를 쓸 수 없어도 목록은 열리고 공정을 고를 수 있다', async () => {
      const user = userEvent.setup();
      const blocked = () => {
        throw new Error('저장소 사용 불가');
      };
      const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
      try {
        mockedGet.mockResolvedValue(reply([apjeong], MENU));
        renderPage();
        await screen.findByText(listFilters.pickProcess);
        await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
        await screen.findByTestId('opportunity-card');
        expect(locationText()).toBe('/opportunities?process=ANODIZING');
      } finally {
        getSpy.mockRestore();
        setSpy.mockRestore();
      }
    });
  });

  describe('회사 이름 검색', () => {
    it('검색하면 고른 조건과 상관없이 검색어만 서버에 보내고, 결과 위에 "전체 후보에서 찾은 결과"와 검색어를 보인다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING&region=아산시&industry=자동차 부품');
      await screen.findByTestId('opportunity-card');
      await searchFor(user, '코파스');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '코파스' }));
      expect(locationParams()).toEqual({ q: '코파스' });
      expect(locationText()).toBe(`/opportunities?q=${encodeURIComponent('코파스')}`);
      const line = await screen.findByTestId('list-search-line');
      expect(line).toHaveTextContent('전체 후보에서 찾은 결과');
      expect(screen.getByTestId('list-search-query')).toHaveTextContent(/^코파스$/);
      // 검색 칸은 검색 중에도 보이고 지금 검색어가 들어 있다.
      expect(screen.getByTestId('list-search-input')).toHaveValue('코파스');
    });

    it('검색 중에는 공정·지역·산업 선택란이 숨는다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING');
      await screen.findByTestId('opportunity-card');
      expect(screen.getByTestId('list-process-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-industry-select')).toBeInTheDocument();
      await searchFor(user, '코파스');
      await screen.findByTestId('list-search-line');
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-region-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-industry-select')).not.toBeInTheDocument();
    });

    it('Enter로도 검색하고, 앞뒤 공백은 떼고 보낸다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING');
      await screen.findByTestId('opportunity-card');
      await user.type(screen.getByTestId('list-search-input'), '  명화금속 {Enter}');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '명화금속' }));
    });

    it('[검색 지우기]를 누르면 검색하기 직전에 고른 공정·지역·산업으로 돌아간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING&region=아산시&industry=자동차 부품');
      await screen.findByTestId('opportunity-card');
      await searchFor(user, '코파스');
      await user.click(await screen.findByTestId('list-search-clear'));
      await waitFor(() =>
        expect(lastFilters()).toEqual({
          ...NO_FILTERS,
          process: 'ANODIZING',
          region: '아산시',
          industry: '자동차 부품',
        }),
      );
      expect(locationParams()).toEqual({
        process: 'ANODIZING',
        region: '아산시',
        industry: '자동차 부품',
      });
      expect(screen.queryByTestId('list-search-line')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-search-input')).toHaveValue('');
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe(
        'ANODIZING',
      );
      expect((screen.getByTestId('list-region-select') as HTMLSelectElement).value).toBe('아산시');
    });

    it('검색 중에 다른 이름으로 다시 검색해도 [검색 지우기]는 처음 검색하기 전 주소로 돌아간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING&region=아산시');
      await screen.findByTestId('opportunity-card');
      await searchFor(user, '코파스');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '코파스' }));
      await searchFor(user, '명화금속');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '명화금속' }));
      await user.click(screen.getByTestId('list-search-clear'));
      await waitFor(() =>
        expect(locationParams()).toEqual({ process: 'ANODIZING', region: '아산시' }),
      );
    });

    it('관심 기업 보기에서 검색하면 검색어만 보내고, [검색 지우기]로 관심 기업 보기(의견 거르기 포함)로 돌아간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?bookmarked=true&opinion=NEED_CHECK');
      await screen.findByTestId('opportunity-card');
      // 관심 기업 보기에는 공정 선택란이 없지만 검색 칸은 있다.
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      await searchFor(user, '코파스');
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '코파스' }));
      expect(locationParams()).toEqual({ q: '코파스' });
      expect(screen.queryByTestId('list-bookmarked-view')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('list-search-clear'));
      await waitFor(() =>
        expect(lastFilters()).toEqual({
          ...NO_FILTERS,
          bookmarked: 'true',
          opinion: 'NEED_CHECK',
        }),
      );
      expect(locationParams()).toEqual({ bookmarked: 'true', opinion: 'NEED_CHECK' });
      expect(screen.getByTestId('list-bookmarked-title')).toBeInTheDocument();
      expect(screen.getByTestId('list-opinion-NEED_CHECK')).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([
      ['/opportunities?filter=NOT_CONTACTED', { filter: 'NOT_CONTACTED' }],
      ['/opportunities?stage=IN_PROGRESS', { stage: 'IN_PROGRESS' }],
    ])(
      '대시보드 칸으로 넘어온 목록(%s)에서도 검색 칸이 보이고, 검색 뒤 [검색 지우기]로 그 목록에 돌아간다',
      async (url, expected) => {
        const user = userEvent.setup();
        mockedGet.mockResolvedValue(reply([apjeong], MENU));
        renderPage(url);
        await screen.findByTestId('opportunity-card');
        expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
        await searchFor(user, '코파스');
        await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, q: '코파스' }));
        expect(screen.queryByTestId('list-filter-line')).not.toBeInTheDocument();
        await user.click(screen.getByTestId('list-search-clear'));
        await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, ...expected }));
        expect(locationText()).toBe(url);
      },
    );

    it('직전 주소를 모르면(대시보드 검색으로 바로 넘어온 주소) [검색 지우기]는 조건 없는 목록으로 간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage('/opportunities?q=A정밀');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, q: 'A정밀' });
      expect(screen.getByTestId('list-search-query')).toHaveTextContent(/^A정밀$/);
      expect(screen.getByTestId('list-search-input')).toHaveValue('A정밀');
      await user.click(screen.getByTestId('list-search-clear'));
      await waitFor(() => expect(lastFilters()).toEqual(NO_FILTERS));
      expect(locationText()).toBe('/opportunities');
    });

    it('빈 검색어·공백만 있는 검색어로는 검색하지 않는다(요청도 주소도 그대로)', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING');
      await screen.findByTestId('opportunity-card');
      const calls = mockedGet.mock.calls.length;
      await user.click(screen.getByTestId('list-search-button'));
      await user.type(screen.getByTestId('list-search-input'), '   {Enter}');
      expect(mockedGet).toHaveBeenCalledTimes(calls);
      expect(locationText()).toBe('/opportunities?process=ANODIZING');
      expect(screen.queryByTestId('list-search-line')).not.toBeInTheDocument();
    });

    it('검색 결과가 0곳이면 "이 이름으로 찾은 후보가 없습니다"를 보이고 검색 칸과 [검색 지우기]는 남는다', async () => {
      mockedGet.mockResolvedValue(reply([], { ...MENU, total: 0 }));
      renderPage('/opportunities?q=없는회사');
      expect(await screen.findByText('이 이름으로 찾은 후보가 없습니다')).toBeInTheDocument();
      expect(listSearch.empty).toBe('이 이름으로 찾은 후보가 없습니다');
      expect(screen.getByTestId('list-search-input')).toHaveValue('없는회사');
      expect(screen.getByTestId('list-search-clear')).toBeInTheDocument();
    });

    it('주소에 검색어와 다른 조건이 같이 적혀 있어도 서버에는 검색어만 보낸다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?q=A정밀&process=ANODIZING&region=아산시&bookmarked=true');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, q: 'A정밀' });
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-bookmarked-view')).not.toBeInTheDocument();
    });

    it('검색 중에 [관심 기업만 보기]를 누르면 검색에서 나와 관심 기업 보기로 간다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?q=A정밀');
      await screen.findByTestId('opportunity-card');
      expect(screen.getByTestId('list-bookmarked-on')).toHaveTextContent(bookmarkList.showOnly);
      await user.click(screen.getByTestId('list-bookmarked-on'));
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
      expect(locationText()).toBe('/opportunities?bookmarked=true');
      expect(screen.queryByTestId('list-search-line')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-search-input')).toHaveValue('');
    });

    it('목록을 불러오지 못했을 때도 검색 칸은 보인다', async () => {
      mockedGet.mockRejectedValue(new Error('network'));
      renderPage('/opportunities?process=ANODIZING');
      await screen.findByRole('alert');
      expect(screen.getByTestId('list-search-input')).toBeInTheDocument();
    });
  });

  describe('정렬', () => {
    it('"추천 순"이 골라져 있고, "가까운 순 (준비 중)"은 고를 수 없게 표시되며 눌러도 요청이 없다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage('/opportunities?process=ANODIZING');
      await screen.findByTestId('opportunity-card');
      const group = screen.getByRole('group', { name: listSearch.sortLabel });
      const rank = within(group).getByRole('button', { name: '추천 순' });
      const distance = within(group).getByRole('button', { name: '가까운 순 (준비 중)' });
      expect(rank).toHaveAttribute('aria-pressed', 'true');
      expect(distance).toHaveAttribute('aria-disabled', 'true');
      expect(distance).toHaveAttribute('aria-pressed', 'false');
      const calls = mockedGet.mock.calls.length;
      await user.click(distance);
      await user.click(rank);
      expect(mockedGet).toHaveBeenCalledTimes(calls);
      expect(rank).toHaveAttribute('aria-pressed', 'true');
      expect(locationText()).toBe('/opportunities?process=ANODIZING');
      // 서버로 `sort`를 보내지 않는다.
      for (const call of mockedGet.mock.calls) expect(call[3]).not.toHaveProperty('sort');
    });

    it.each([
      '/opportunities?q=A정밀',
      '/opportunities?bookmarked=true',
      '/opportunities?filter=NOT_CONTACTED',
    ])('정렬 묶음은 %s 에서도 보이고 `sort`는 보내지 않는다', async (url) => {
      mockedGet.mockResolvedValue(reply([apjeong], MENU));
      renderPage(url);
      await screen.findByTestId('opportunity-card');
      expect(screen.getByTestId('list-sort-rank')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('list-sort-distance')).toHaveAttribute('aria-disabled', 'true');
      for (const call of mockedGet.mock.calls) expect(call[3]).not.toHaveProperty('sort');
    });
  });

  describe('순위 번호', () => {
    it('공정 하나를 고른 목록에서는 카드에 순위 번호가 보인다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong], { processCounts: NINE }));
      renderPage('/opportunities?process=ANODIZING');
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).getByTestId('card-rank')).toHaveTextContent('1');
    });

    it.each([
      ['검색 결과', '/opportunities?q=A정밀'],
      ['관심 기업 목록', '/opportunities?bookmarked=true'],
      ['대시보드 칸으로 넘어온 목록', '/opportunities?filter=NEED_CHECK'],
      ['영업 단계로 넘어온 목록', '/opportunities?stage=IN_PROGRESS'],
    ])('%s처럼 공정이 섞인 목록에서는 순위 번호를 숨긴다 (PM 결정 2026-11-06)', async (_, path) => {
      mockedGet.mockResolvedValue(reply([apjeong], { processCounts: NINE }));
      renderPage(path);
      const card = await screen.findByTestId('opportunity-card');
      expect(within(card).queryByTestId('card-rank')).not.toBeInTheDocument();
      expect(within(card).getByRole('heading', { level: 2 })).toHaveTextContent('A정밀');
    });
  });
});
