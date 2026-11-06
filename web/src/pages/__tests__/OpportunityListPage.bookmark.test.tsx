// 추천 목록의 "관심 기업" 보기(#357): [관심 기업만 보기] 켜기·끄기 / 검토 의견 거르기 다섯 개가 보내는 조건 /
// 주소에 남아 새로 고침해도 유지 / 대시보드 칸으로 걸러 본 목록의 이름과 [거르기 풀기] / 빈 목록 문구.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage, { PAGE_SIZE } from '../OpportunityListPage';
import { getOpportunities } from '../../api/client';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { bookmarkList, dashboardTexts, listFilters, states } from '../../labels/ko';
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

/** 조건이 하나도 없을 때 getOpportunities의 네 번째 인자. 관심·의견 조건은 켰을 때만 실린다. */
const NO_FILTERS = {
  process: null,
  region: null,
  industry: null,
  stage: null,
  filter: null,
  q: null,
};

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '전기아연도금', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 10 },
];

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

describe('OpportunityListPage "관심 기업" 보기 (#357)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('평소 목록 머리에는 [관심 기업만 보기] 단추 하나가 있고, 관심·의견 조건은 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('list-bookmarked-on')).toHaveTextContent(bookmarkList.showOnly);
    expect(screen.queryByTestId('list-bookmarked-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-filter-line')).not.toBeInTheDocument();
    expect(mockedGet.mock.calls[0][3]).toEqual(NO_FILTERS);
  });

  it('[관심 기업만 보기]를 누르면 주소에 남기고 관심 기업만 다시 불러오며, 공정 탭 없이 전체에서 거른다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?process=ANODIZING');
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('list-process-tabs')).toBeInTheDocument();
    await user.click(screen.getByTestId('list-bookmarked-on'));
    await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities\?bookmarked=true$/);
    expect(screen.getByTestId('list-bookmarked-title')).toHaveTextContent(/^관심 기업$/);
    expect(screen.queryByTestId('list-process-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-bookmarked-on')).not.toBeInTheDocument();
  });

  it('관심 기업 보기에는 거르기 단추 다섯 개가 순서대로 있고 처음에는 "전체 보기"가 눌려 있다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?bookmarked=true');
    await screen.findByTestId('opportunity-card');
    // 대시보드 "관심 기업 N곳"에서 넘어온 주소다. 공정 탭으로 바꾸지 않고 한 번만 부른다.
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenLastCalledWith(1, PAGE_SIZE, expect.any(AbortSignal), {
      ...NO_FILTERS,
      bookmarked: 'true',
    });
    const group = screen.getByRole('group', { name: bookmarkList.opinionGroupLabel });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '전체 보기',
      '검토 권고',
      '추가 확인 필요',
      '제외 기업',
      '기타',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it.each([
    ['검토 권고', 'WORTH_REVIEW'],
    ['추가 확인 필요', 'NEED_CHECK'],
    ['제외 기업', 'NOT_TARGET'],
    ['기타', 'NONE'],
  ])('거르기 "%s"를 누르면 의견 조건 %s 를 보내고 주소에 남긴다', async (label, value) => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true');
    await screen.findByTestId('opportunity-card');
    // 카드의 검토 의견 단추와 글자가 같아서, 머리의 거르기 묶음 안에서 찾는다.
    const group = screen.getByRole('group', { name: bookmarkList.opinionGroupLabel });
    await user.click(within(group).getByRole('button', { name: label }));
    await waitFor(() =>
      expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true', opinion: value }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/opportunities?bookmarked=true&opinion=${value}`,
    );
    expect(screen.getByTestId(`list-opinion-${value}`)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'false');
  });

  it('"전체 보기"로 돌리면 의견 조건이 주소와 요청에서 빠진다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=NEED_CHECK');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-opinion-ALL'));
    await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities\?bookmarked=true$/);
  });

  it('주소에 남은 관심 보기와 거르기는 새로 열어도 그대로 서버에 가고 고른 단추가 눌려 보인다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=NONE&region=아산시');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][3]).toEqual({
      ...NO_FILTERS,
      region: '아산시',
      bookmarked: 'true',
      opinion: 'NONE',
    });
    expect(screen.getByTestId('list-opinion-NONE')).toHaveAttribute('aria-pressed', 'true');
  });

  it('[전체 추천 목록 보기]를 누르면 관심 보기와 의견 거르기가 주소에서 빠지고 평소 목록으로 돌아간다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=WORTH_REVIEW');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByRole('button', { name: bookmarkList.showAll }));
    await waitFor(() => expect(lastFilters()).toEqual(NO_FILTERS));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities$/);
    expect(screen.getByTestId('list-bookmarked-on')).toBeInTheDocument();
    expect(screen.queryByTestId('list-opinion-filter')).not.toBeInTheDocument();
  });

  it('관심 보기가 아니거나 표에 없는 의견 값은 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    const { unmount } = renderPage('/opportunities?opinion=NEED_CHECK');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toEqual(NO_FILTERS);
    unmount();
    mockedGet.mockClear();
    renderPage('/opportunities?bookmarked=true&opinion=SOMETHING');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, bookmarked: 'true' });
    expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
  });

  it('관심 보기에서 0곳이면 카드의 [관심]을 눌러 담으라는 문구를 보이고, 머리 단추는 그대로 남는다', async () => {
    mockedGet.mockResolvedValue(reply([], { total: 0 }));
    renderPage('/opportunities?bookmarked=true');
    expect(await screen.findByText(bookmarkList.empty)).toBeInTheDocument();
    expect(bookmarkList.empty).toBe(
      '관심으로 고른 회사가 없습니다. 카드의 [관심]을 눌러 담아 보세요',
    );
    expect(screen.queryByText(states.listEmpty)).not.toBeInTheDocument();
    expect(screen.getByTestId('list-bookmarked-off')).toBeInTheDocument();
    expect(screen.getByTestId('list-opinion-filter')).toBeInTheDocument();
  });

  it('관심 보기에서 의견으로 걸러 0곳이면 "이 조건에 맞는 후보가 없습니다."를 보인다', async () => {
    mockedGet.mockResolvedValue(reply([], { total: 0 }));
    renderPage('/opportunities?bookmarked=true&opinion=NOT_TARGET');
    expect(await screen.findByText(listFilters.noMatch)).toBeInTheDocument();
    expect(screen.queryByText(bookmarkList.empty)).not.toBeInTheDocument();
  });

  describe('대시보드 칸으로 걸러 본 목록', () => {
    it.each([
      ['NO_OPINION', '의견 전'],
      ['NEED_CHECK', '추가 확인 필요'],
      ['NOT_TARGET', '제외'],
      ['NOT_CONTACTED', '미접촉'],
      ['IN_CONTACT', '접촉 중'],
      ['QUOTE_SAMPLE', '견적·샘플'],
      ['ON_HOLD', '보류'],
      ['DONE', '완료'],
      ['BOOKMARKED', '관심 기업'],
      ['SCHEDULE_DUE', '이번 주 일정'],
    ])(
      '?filter=%s 는 서버에 그대로 가고 머리에 대시보드 칸과 같은 이름 "%s"이 보인다',
      async (key, name) => {
        mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
        renderPage(`/opportunities?filter=${key}`);
        await screen.findByTestId('opportunity-card');
        expect(mockedGet).toHaveBeenCalledTimes(1);
        expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, filter: key });
        expect(screen.getByTestId('list-filter-name')).toHaveTextContent(new RegExp(`^${name}$`));
        expect(name).toBe(dashboardTexts.countNames[key as keyof typeof dashboardTexts.countNames]);
        expect(screen.getByTestId('list-filter-clear')).toHaveTextContent(bookmarkList.clearFilter);
        expect(screen.queryByTestId('list-process-tabs')).not.toBeInTheDocument();
      },
    );

    it('[거르기 풀기]를 누르면 조건이 주소와 요청에서 빠지고 이름 줄이 사라진다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage('/opportunities?filter=NOT_CONTACTED');
      await screen.findByTestId('opportunity-card');
      await user.click(screen.getByTestId('list-filter-clear'));
      await waitFor(() => expect(lastFilters()).toEqual(NO_FILTERS));
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities$/);
      expect(screen.queryByTestId('list-filter-line')).not.toBeInTheDocument();
    });

    it('칸 이름표에 없는 값은 서버에는 그대로 보내되 화면에는 코드 이름을 보이지 않는다', async () => {
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage('/opportunities?filter=TO_REVIEW');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, filter: 'TO_REVIEW' });
      expect(screen.getByTestId('list-filter-name')).toHaveTextContent(bookmarkList.filterUnknown);
      expect(screen.getByTestId('list-view-bar')).not.toHaveTextContent('TO_REVIEW');
    });

    it('관심 보기와 대시보드 칸 조건이 같이 있으면 둘 다 서버에 가고, 하나를 풀어도 다른 하나는 남는다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage('/opportunities?bookmarked=true&filter=IN_CONTACT');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet.mock.calls[0][3]).toEqual({
        ...NO_FILTERS,
        filter: 'IN_CONTACT',
        bookmarked: 'true',
      });
      await user.click(screen.getByTestId('list-filter-clear'));
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
      expect(screen.getByTestId('list-bookmarked-title')).toBeInTheDocument();
    });
  });
});
