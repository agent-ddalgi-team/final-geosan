// 추천 목록의 "관심 기업" 보기(#357): [관심 기업만 보기] 켜기·끄기 / 검토 의견 거르기 네 개가 보내는 조건 /
// 주소에 남아 새로 고침해도 유지 / 대시보드 칸으로 걸러 본 목록의 이름과 [거르기 풀기] / 빈 목록 문구.
// "제외한 회사" 보기(#536): 제외로 저장한 회사는 관심 기업에서 빠지므로 거르기 단추가 아니라 따로 보는 보기다.
// #981: 관심 기업 화면 맨 위 "의견 전" 띠 · 거래처 후보 줄은 세 칸.
// "의견 전"은 영업 홈의 같은 이름 칸과 같은 기준(filter=NO_OPINION: 관심 + 의견 없음 + 영업 단계 전)이다.
// 거르기 단추 "기타"(opinion=NONE)는 의견 기록이 없는 회사 전체(이미 접촉 중인 회사 포함)라 뜻이 다르다.
// 서버 호출(getOpportunities)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import OpportunityListPage, { PAGE_SIZE, type ListView } from '../OpportunityListPage';
import { getOpportunities, postOpinion } from '../../api/client';
import { readBookmark } from '../../api/bookmark';
import type { Envelope, OpportunityCard } from '../../api/types';
import { FrameContext } from '../../components/frame/FrameContext';
import { bookmarkList, dashboardTexts, excludedList, listFilters, states } from '../../labels/ko';
import { choiceChip } from '../../theme/tokens';
import listFixture from '../../test/fixtures/opportunities-apjeong.json';
import { listCallsOf, noOpinionCountCallsOf } from '../../test/listRequests';

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  getOpportunities: vi.fn(),
  postOpinion: vi.fn(),
}));
// 의견을 저장하면 줄이 관심 값을 다시 읽는다. 이 파일에서는 그 응답을 가짜로 돌려준다.
vi.mock('../../api/bookmark', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/bookmark')>()),
  readBookmark: vi.fn(),
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
  // 추천 순은 근거 상태 묶음 순(#610·#675)으로 달라고 한다.
  sort: 'contact',
};

/** 평소 목록(공정 하나·공정별 묶음·전체 보기)이 보내는 조건: 관심으로 고른 회사는 빼 달라고 한다(#675). */
const HOME_FILTERS = { ...NO_FILTERS, hideBookmarked: 'true' };

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '전기아연도금', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 10 },
];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(initial = '/opportunities', view: ListView = 'all') {
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
        <OpportunityListPage view={view} />
        <LocationProbe />
      </FrameContext.Provider>
    </MemoryRouter>,
  );
}

// 관심 기업 화면은 목록 요청 말고 "의견 전" 띠가 곳 수를 읽는 요청을 하나 더 보낸다(#981).
// 아래 시험들이 보는 것은 "목록을 어떤 조건으로 불렀나"이므로 목록 요청만 골라 본다.
const listCalls = () => listCallsOf(mockedGet.mock.calls);
const stripCalls = () => noOpinionCountCallsOf(mockedGet.mock.calls);
const lastFilters = () => listCalls().at(-1)?.[3];
/** 띠가 곳 수를 읽을 때 보내는 조건: 목록 조건에서 의견 거르기를 비우고 "의견 전" 조건(filter=NO_OPINION)을 더한다. */
const stripFilters = (extra: Record<string, string> = {}) => ({
  ...NO_FILTERS,
  ...extra,
  bookmarked: 'true',
  opinion: null,
  filter: 'NO_OPINION',
});

describe('OpportunityListPage "관심 기업" 보기 (#357)', () => {
  beforeEach(() => {
    // 지난번에 본 공정 기억(#368)이 검사 사이에 넘어가지 않게 지운다.
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  it('평소 목록(신규 거래처 찾기) 머리에는 [제외한 회사 보기]만 있고 [관심 기업만 보기]는 왼쪽 메뉴로 옮겼다(#762), 관심·의견 조건은 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage();
    await screen.findByTestId('opportunity-card');
    expect(screen.queryByTestId('list-bookmarked-on')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-excluded-on')).toHaveTextContent(excludedList.showOnly);
    expect(screen.queryByTestId('list-bookmarked-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-excluded-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-filter-line')).not.toBeInTheDocument();
    expect(mockedGet.mock.calls[0][3]).toEqual(HOME_FILTERS);
    // "의견 전" 띠는 관심 기업 화면에만 있다(#981). 평소 목록은 띠도, 띠가 곳 수를 읽는 요청도 없다.
    expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
    expect(stripCalls()).toHaveLength(0);
  });

  it('관심 기업 화면(/bookmarks, #762)은 관심 기업만 불러오고 주소에 bookmarked를 남기지 않으며, 공정은 "전체"에서 시작한다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/bookmarks', 'bookmarks');
    await screen.findByTestId('opportunity-card');
    await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/bookmarks$/);
    // 새 회사 찾기 조건 칸은 신규 거래처 찾기에만 있다.
    expect(screen.queryByTestId('ingest-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-bookmarked-title')).toHaveTextContent(/^관심 기업$/);
    // 관심 기업 보기에도 공정 선택란이 있고(#516), 묶지 않으므로 맨 위는 "전체"다.
    const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe(listFilters.all);
    expect(screen.queryByTestId('list-bookmarked-on')).not.toBeInTheDocument();
  });

  it('관심 기업 화면의 줄은 열 머리 없는 세 칸 줄이고, 거래처 후보의 줄은 열 머리 세 개가 붙은 세 칸 표 줄이다(#972, #981)', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    const bookmarks = renderPage('/bookmarks', 'bookmarks');
    const row = await screen.findByTestId('opportunity-card');
    expect(row).toHaveAttribute('data-layout', 'bookmark');
    expect(row.children).toHaveLength(3);
    expect(screen.queryByTestId('list-column-head')).not.toBeInTheDocument();
    // 줄 안에서 의견을 고르고 관심 별을 누를 수 있고, [자세히 보기]는 주 단추다.
    expect(within(row).getByTestId('opinion-select')).toBeEnabled();
    expect(within(row).getByTestId('bookmark-button')).toHaveAttribute('data-variant', 'star');
    expect(within(row).getByTestId('card-view-detail-link')).toHaveClass('ant-btn-primary');
    // 조건 칸과 줄은 흰 칸 하나에 담긴다.
    expect(screen.getByTestId('list-panel')).toContainElement(row);
    expect(screen.getByTestId('list-panel')).toContainElement(
      screen.getByTestId('list-opinion-filter'),
    );
    bookmarks.unmount();

    renderPage('/opportunities');
    const tableRow = await screen.findByTestId('opportunity-card');
    expect(tableRow).toHaveAttribute('data-layout', 'table');
    // #981: 거래처 후보 줄도 세 칸이다(예전 다섯 칸). 관심 기업 줄과는 모양 이름(cand-row--three)으로 갈린다.
    expect(tableRow.children).toHaveLength(3);
    expect(tableRow).not.toHaveClass('cand-row--three');
    // 열 머리도 줄의 칸과 같은 세 개다(#987: "회사 · 품목" → "기업", "추천 근거" → "추천 이유").
    const head = screen.getByTestId('list-column-head');
    expect(Array.from(head.children).map((column) => column.textContent)).toEqual([
      '기업',
      '추천 이유 · 검토사항',
      '적합도 · 점수 · 관심 · 의견',
    ]);
    // 거래처 후보 줄에는 [자세히 보기]가 없다(회사 이름을 누른다).
    expect(within(tableRow).queryByTestId('card-view-detail-link')).not.toBeInTheDocument();
  });

  it('거르기 단추는 선택 단추 모양이다: 고른 것은 연보라 바탕 + 보라 테두리 + 보라 글자 굵게(#972)', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/bookmarks?opinion=NEED_CHECK', 'bookmarks');
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('list-opinion-NEED_CHECK')).toHaveStyle({
      background: choiceChip.selected.bg,
      color: choiceChip.selected.fg,
      fontWeight: choiceChip.selected.fontWeight,
    });
    expect(screen.getByTestId('list-opinion-NEED_CHECK').style.border).toContain('1px solid');
    expect(screen.getByTestId('list-opinion-ALL')).toHaveStyle({
      background: choiceChip.idle.bg,
      color: choiceChip.idle.fg,
      fontWeight: 400,
    });
  });

  it('관심 기업 보기에서 공정을 고르면 관심 조건과 함께 보내고 주소에 남기되, 평소 목록의 마지막 공정 기억은 바꾸지 않는다(#516)', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('geosan.list.lastProcess', 'ZINC_PLATING');
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?bookmarked=true');
    await screen.findByTestId('opportunity-card');
    await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
    await waitFor(() =>
      expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true', process: 'ANODIZING' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('bookmarked=true');
    expect(screen.getByTestId('location')).toHaveTextContent('process=ANODIZING');
    expect(screen.getByTestId('list-bookmarked-title')).toBeInTheDocument();
    expect(window.localStorage.getItem('geosan.list.lastProcess')).toBe('ZINC_PLATING');
    // 공정이 섞이지 않아도 관심 기업 보기는 순위 번호를 숨긴 채다(PM 결정 2026-11-06).
    expect(screen.queryByTestId('card-rank')).not.toBeInTheDocument();
  });

  it('관심 기업 보기에서 고른 공정에 관심 기업이 없으면 조건을 바꿔 보라는 안내가 보인다(#516)', async () => {
    mockedGet.mockResolvedValue(reply([], { processCounts: TABS }));
    renderPage('/opportunities?bookmarked=true&process=ANODIZING');
    expect(await screen.findByText(listFilters.filteredEmpty)).toBeInTheDocument();
    expect(screen.queryByText(bookmarkList.empty)).not.toBeInTheDocument();
  });

  it('관심 기업 보기에는 거르기 단추 네 개가 순서대로 있고 처음에는 "전체 보기"가 눌려 있다(#536: "제외 기업" 없음)', async () => {
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?bookmarked=true');
    await screen.findByTestId('opportunity-card');
    // 대시보드 "관심 기업 N곳"에서 넘어온 주소다. 공정을 골라 주소를 바꾸지 않고 목록은 한 번만 부른다.
    expect(listCalls()).toEqual([
      [1, PAGE_SIZE, expect.any(AbortSignal), { ...NO_FILTERS, bookmarked: 'true' }],
    ]);
    // 그 밖의 요청은 "의견 전" 띠가 곳 수를 읽는 한 번뿐이다(#981).
    expect(stripCalls()).toHaveLength(1);
    expect(mockedGet).toHaveBeenCalledTimes(2);
    const group = screen.getByRole('group', { name: bookmarkList.opinionGroupLabel });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '전체 보기',
      '영업 대상',
      '검토 중',
      // 의견 기록이 없는 회사 전체다. 띠의 "의견 전"(영업 단계 전인 회사만)과 뜻이 달라 이름도 다르다(#981).
      '기타',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it.each([
    ['영업 대상', 'WORTH_REVIEW'],
    ['검토 중', 'NEED_CHECK'],
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
    // 목록은 한 번만, 주소의 조건 그대로 부른다.
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][3]).toEqual({
      ...NO_FILTERS,
      region: '아산시',
      bookmarked: 'true',
      opinion: 'NONE',
    });
    expect(screen.getByTestId('list-opinion-NONE')).toHaveAttribute('aria-pressed', 'true');
    // "기타"(의견 기록 없음)로 거르는 중에도 띠는 곳 수를 읽는다(#981): 지역은 그대로, 의견 거르기는 비우고 "의견 전" 조건으로.
    expect(stripCalls()).toEqual([
      [1, 1, expect.any(AbortSignal), stripFilters({ region: '아산시' })],
    ]);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it('관심 보기에는 전체 목록으로 돌아가는 단추를 따로 두지 않는다(위쪽 메뉴가 그 일을 한다)', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=WORTH_REVIEW');
    await screen.findByTestId('opportunity-card');
    expect(screen.getByTestId('list-opinion-filter')).toBeInTheDocument();
    expect(screen.queryByTestId('list-bookmarked-off')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-bookmarked-on')).not.toBeInTheDocument();
  });

  it('관심 보기가 아니거나 표에 없는 의견 값은 서버에 보내지 않는다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    const { unmount } = renderPage('/opportunities?opinion=NEED_CHECK');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toEqual(HOME_FILTERS);
    unmount();
    mockedGet.mockClear();
    renderPage('/opportunities?bookmarked=true&opinion=SOMETHING');
    await screen.findByTestId('opportunity-card');
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][3]).toEqual({ ...NO_FILTERS, bookmarked: 'true' });
    expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
  });

  it('예전 주소의 관심 보기 "제외 기업" 거르기(opinion=NOT_TARGET)는 서버에 보내지 않고 "전체 보기"로 연다(#536)', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&opinion=NOT_TARGET');
    await screen.findByTestId('opportunity-card');
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][3]).toEqual({ ...NO_FILTERS, bookmarked: 'true' });
    expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('list-opinion-NOT_TARGET')).not.toBeInTheDocument();
  });

  it('관심 보기에서 0곳이면 카드의 [관심]을 눌러 담으라는 문구를 보이고, 머리의 의견 거르기는 그대로 남는다', async () => {
    mockedGet.mockResolvedValue(reply([], { total: 0 }));
    renderPage('/opportunities?bookmarked=true');
    expect(await screen.findByText(bookmarkList.empty)).toBeInTheDocument();
    expect(bookmarkList.empty).toBe(
      '관심으로 고른 회사가 없습니다. 카드의 [관심]을 눌러 담아 보세요',
    );
    expect(screen.queryByText(states.listEmpty)).not.toBeInTheDocument();
    expect(screen.getByTestId('list-opinion-filter')).toBeInTheDocument();
  });

  it('관심 보기에서 의견으로 걸러 0곳이면 "이 조건에 맞는 후보가 없습니다."를 보인다', async () => {
    mockedGet.mockResolvedValue(reply([], { total: 0 }));
    renderPage('/opportunities?bookmarked=true&opinion=NEED_CHECK');
    expect(await screen.findByText(listFilters.noMatch)).toBeInTheDocument();
    expect(screen.queryByText(bookmarkList.empty)).not.toBeInTheDocument();
  });

  describe('"의견 전" 띠 (#981)', () => {
    /** 띠의 곳 수 요청에는 의견 전인 회사 수(가상 값)를, 목록 요청에는 A정밀 한 곳을 돌려준다. */
    const answerWithNoOpinion = (count: number) =>
      mockedGet.mockImplementation((_page, pageSize, _signal, filters) =>
        Promise.resolve(
          pageSize === 1 && filters?.filter === 'NO_OPINION'
            ? reply([apjeong], { total: count })
            : reply([apjeong]),
        ),
      );

    it.each([
      ['관심 기업 화면', '/bookmarks', 'bookmarks' as ListView, '/bookmarks?filter=NO_OPINION'],
      [
        '예전 주소의 관심 기업 보기',
        '/opportunities?bookmarked=true',
        'all' as ListView,
        '/opportunities?bookmarked=true&filter=NO_OPINION',
      ],
    ])(
      'Given 의견 전인 관심 기업 3곳 When %s Then 띠에 곳 수가 보이고, [의견 전만 보기]를 누르면 주소에 filter=NO_OPINION이 남고 그 조건으로 목록을 다시 부른다',
      async (_name, url, view, expectedUrl) => {
        const user = userEvent.setup();
        answerWithNoOpinion(3);
        renderPage(url, view);
        await screen.findByTestId('opportunity-card');
        const strip = await screen.findByTestId('no-opinion-strip');
        expect(within(strip).getByTestId('no-opinion-strip-text')).toHaveTextContent(
          /^의견을 아직 안 고른 관심 기업 3곳$/,
        );
        // 띠는 조건 칸·줄과 같은 흰 칸 안, 거르기 단추 위에 놓인다.
        expect(screen.getByTestId('list-panel')).toContainElement(strip);
        expect(
          strip.compareDocumentPosition(screen.getByTestId('list-opinion-filter')) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        // 곳 수는 한 줄만 읽는 요청 하나로 받는다: 목록과 같은 조건에 영업 홈과 같은 "의견 전" 조건을 더한다.
        expect(stripCalls()).toEqual([[1, 1, expect.any(AbortSignal), stripFilters()]]);
        expect(listCalls()).toHaveLength(1);

        await user.click(within(strip).getByRole('button', { name: '의견 전만 보기' }));
        // 목록은 "의견 전" 조건으로 다시 부른다. 의견 거르기(opinion)는 보내지 않는다.
        await waitFor(() =>
          expect(lastFilters()).toEqual({
            ...NO_FILTERS,
            filter: 'NO_OPINION',
            bookmarked: 'true',
          }),
        );
        expect(screen.getByTestId('location').textContent).toBe(expectedUrl);
        // 머리에 "거른 조건" 줄이 영업 홈 칸과 같은 이름으로 보이고 [거르기 풀기]가 있다.
        expect(screen.getByTestId('list-filter-name')).toHaveTextContent(/^의견 전$/);
        expect(screen.getByTestId('list-filter-clear')).toHaveTextContent(bookmarkList.clearFilter);
        // 의견 거르기 단추는 "전체 보기"인 채다("기타"가 눌리는 것이 아니다).
        expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('list-opinion-NONE')).toHaveAttribute('aria-pressed', 'false');
        // "의견 전"만 보는 중에는 띠를 숨기고 곳 수도 다시 읽지 않는다.
        expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
        expect(stripCalls()).toHaveLength(1);
        expect(listCalls()).toHaveLength(2);
      },
    );

    it('Given 주소가 /bookmarks?filter=NO_OPINION(영업 홈 알림 · ★ 뒤 안내 링크가 오는 곳) When 화면 Then "의견 전" 조건으로 목록을 부르고 띠와 곳 수 요청은 없다', async () => {
      answerWithNoOpinion(3);
      renderPage('/bookmarks?filter=NO_OPINION', 'bookmarks');
      await screen.findByTestId('opportunity-card');
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet.mock.calls[0]).toEqual([
        1,
        PAGE_SIZE,
        expect.any(AbortSignal),
        { ...NO_FILTERS, filter: 'NO_OPINION', bookmarked: 'true' },
      ]);
      expect(stripCalls()).toHaveLength(0);
      expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-bookmarked-title')).toHaveTextContent(/^관심 기업$/);
      expect(screen.getByTestId('list-filter-name')).toHaveTextContent(/^의견 전$/);
    });

    it('Given "의견 전"만 보는 중 When [거르기 풀기] Then 조건이 주소에서 빠지고 띠가 다시 곳 수를 읽어 보인다', async () => {
      const user = userEvent.setup();
      answerWithNoOpinion(3);
      renderPage('/bookmarks?filter=NO_OPINION', 'bookmarks');
      await screen.findByTestId('opportunity-card');
      await user.click(screen.getByTestId('list-filter-clear'));
      await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, bookmarked: 'true' }));
      expect(screen.getByTestId('location').textContent).toBe('/bookmarks');
      expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent(
        /^의견을 아직 안 고른 관심 기업 3곳$/,
      );
      expect(stripCalls()).toEqual([[1, 1, expect.any(AbortSignal), stripFilters()]]);
    });

    /** 가짜 창구가 돌려준 응답이 모두 끝나 화면에 반영될 때까지 기다린다("안 보인다"를 응답 도착 뒤에 확인하려고). */
    const settle = () =>
      act(async () => {
        await Promise.allSettled(mockedGet.mock.results.map((result) => result.value));
      });

    it('Given 띠에 3곳 When 줄에서 의견을 골라 저장 Then 띠가 곳 수를 다시 읽어 2곳으로 줄어든다(목록은 다시 부르지 않는다)', async () => {
      const user = userEvent.setup();
      const bookmark = { active: true, version: 1, by: 'park-lee', at: '2026-11-28T00:00:00Z' };
      const noOpinionRow = {
        ...apjeong,
        records: { ...apjeong.records, opinion: null, bookmark },
      } as unknown as OpportunityCard;
      let remaining = 3;
      mockedGet.mockImplementation((_page, pageSize, _signal, filters) =>
        Promise.resolve(
          pageSize === 1 && filters?.filter === 'NO_OPINION'
            ? reply([noOpinionRow], { total: remaining })
            : reply([noOpinionRow]),
        ),
      );
      vi.mocked(postOpinion).mockImplementation(async () => {
        remaining = 2;
        return {
          data: { opinion: 'WORTH_REVIEW', version: 1, reason: null },
          meta: {},
        } as unknown as Awaited<ReturnType<typeof postOpinion>>;
      });
      vi.mocked(readBookmark).mockResolvedValue(
        bookmark as unknown as Awaited<ReturnType<typeof readBookmark>>,
      );
      renderPage('/bookmarks', 'bookmarks');
      expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent('3곳');
      // 관심에 담고 의견을 안 고른 줄: 고르기 칸 아래에 알림이 보인다.
      expect(screen.getByTestId('opinion-nudge')).toHaveTextContent('의견을 골라 주세요');

      await user.selectOptions(screen.getByTestId('opinion-select'), 'WORTH_REVIEW');
      await waitFor(() =>
        expect(screen.getByTestId('no-opinion-strip-text')).toHaveTextContent('2곳'),
      );
      expect(postOpinion).toHaveBeenCalledTimes(1);
      expect(stripCalls()).toHaveLength(2);
      expect(listCalls()).toHaveLength(1);
      expect(screen.queryByTestId('opinion-nudge')).not.toBeInTheDocument();
    });

    it('Given 의견 전인 관심 기업 0곳 When 관심 기업 화면 Then 띠는 없고 목록은 그대로 보인다', async () => {
      answerWithNoOpinion(0);
      renderPage('/bookmarks', 'bookmarks');
      await screen.findByTestId('opportunity-card');
      await waitFor(() => expect(stripCalls()).toHaveLength(1));
      await settle();
      expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
    });

    it('Given 곳 수 요청만 실패 When 관심 기업 화면 Then 띠만 없고 목록은 오류 없이 보인다', async () => {
      mockedGet.mockImplementation((_page, pageSize, _signal, filters) =>
        pageSize === 1 && filters?.filter === 'NO_OPINION'
          ? Promise.reject(new Error('network'))
          : Promise.resolve(reply([apjeong])),
      );
      renderPage('/bookmarks', 'bookmarks');
      expect(await screen.findByTestId('opportunity-card')).toBeInTheDocument();
      await waitFor(() => expect(stripCalls()).toHaveLength(1));
      await settle();
      expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByTestId('opportunity-card')).toBeInTheDocument();
    });

    it.each([
      ['검토 중', 'NEED_CHECK'],
      ['기타(의견 기록 없음)', 'NONE'],
    ])(
      'Given 관심 기업 화면에서 의견 거르기 "%s"를 보는 중 When 화면 Then 띠는 그대로 보이고, [의견 전만 보기]를 누르면 의견 거르기가 풀리고 "의견 전" 조건만 남는다',
      async (_name, opinion) => {
        const user = userEvent.setup();
        answerWithNoOpinion(2);
        renderPage(`/bookmarks?opinion=${opinion}`, 'bookmarks');
        await screen.findByTestId('opportunity-card');
        expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent(
          /^의견을 아직 안 고른 관심 기업 2곳$/,
        );
        // 목록은 고른 의견으로 거르지만, 띠의 곳 수는 의견 거르기를 비우고 센다.
        expect(listCalls()[0][3]).toEqual({ ...NO_FILTERS, bookmarked: 'true', opinion });
        expect(stripCalls()).toEqual([[1, 1, expect.any(AbortSignal), stripFilters()]]);

        await user.click(screen.getByRole('button', { name: '의견 전만 보기' }));
        await waitFor(() =>
          expect(lastFilters()).toEqual({
            ...NO_FILTERS,
            filter: 'NO_OPINION',
            bookmarked: 'true',
          }),
        );
        expect(screen.getByTestId('location').textContent).toBe('/bookmarks?filter=NO_OPINION');
        expect(screen.getByTestId('list-opinion-ALL')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('no-opinion-strip')).not.toBeInTheDocument();
      },
    );

    it('Given 공정·지역을 고른 관심 기업 화면 When 띠 Then 같은 공정·지역 안에서 "의견 전"인 곳만 센다', async () => {
      answerWithNoOpinion(1);
      renderPage('/bookmarks?process=ANODIZING&region=아산시', 'bookmarks');
      await screen.findByTestId('opportunity-card');
      expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent(
        /^의견을 아직 안 고른 관심 기업 1곳$/,
      );
      expect(stripCalls()).toEqual([
        [1, 1, expect.any(AbortSignal), stripFilters({ process: 'ANODIZING', region: '아산시' })],
      ]);
    });
  });

  describe('대시보드 칸으로 걸러 본 목록', () => {
    it.each([
      ['NO_OPINION', '의견 전'],
      ['NEED_CHECK', '검토 중'],
      ['NOT_CONTACTED', '영업 대상 · 접촉 전'],
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
        expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      },
    );

    it('[거르기 풀기]를 누르면 조건이 주소와 요청에서 빠지고 이름 줄이 사라진다', async () => {
      const user = userEvent.setup();
      mockedGet.mockResolvedValue(reply([apjeong]));
      renderPage('/opportunities?filter=NOT_CONTACTED');
      await screen.findByTestId('opportunity-card');
      await user.click(screen.getByTestId('list-filter-clear'));
      await waitFor(() => expect(lastFilters()).toEqual(HOME_FILTERS));
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
      expect(listCalls()[0][3]).toEqual({
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

describe('OpportunityListPage "제외한 회사" 보기 (#536)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedGet.mockReset();
  });

  it('[제외한 회사 보기]를 누르면 주소에 남기고 의견 조건 NOT_TARGET만 보내며(관심 조건 없음), 공정은 "전체"에서 시작한다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?process=ANODIZING');
    await screen.findByTestId('opportunity-card');
    await user.click(screen.getByTestId('list-excluded-on'));
    await waitFor(() => expect(lastFilters()).toEqual({ ...NO_FILTERS, opinion: 'NOT_TARGET' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/opportunities\?excluded=true$/);
    expect(screen.getByTestId('list-excluded-title')).toHaveTextContent(/^제외한 회사$/);
    expect(screen.getByTestId('list-excluded-hint')).toHaveTextContent(excludedList.hint);
    const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0].textContent).toBe(listFilters.all);
    // 관심 기업 보기의 거르기와 평소 목록의 두 단추는 보이지 않는다(돌아가기는 위쪽 메뉴).
    expect(screen.queryByTestId('list-opinion-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-bookmarked-on')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-excluded-on')).not.toBeInTheDocument();
  });

  it('주소의 제외한 회사 보기는 새로 열어도 한 번만 부르고, 공정을 고르면 공정과 함께 보낸다', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('geosan.list.lastProcess', 'ZINC_PLATING');
    mockedGet.mockResolvedValue(reply([apjeong], { processCounts: TABS }));
    renderPage('/opportunities?excluded=true');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, opinion: 'NOT_TARGET' });
    await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
    await waitFor(() =>
      expect(lastFilters()).toEqual({ ...NO_FILTERS, opinion: 'NOT_TARGET', process: 'ANODIZING' }),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('excluded=true');
    // 평소 목록의 마지막 공정 기억은 바꾸지 않는다(관심 기업 보기와 같다).
    expect(window.localStorage.getItem('geosan.list.lastProcess')).toBe('ZINC_PLATING');
  });

  it('제외한 회사가 없으면 그 문구를, 고른 공정에 없으면 조건을 바꿔 보라는 문구를 보인다', async () => {
    mockedGet.mockResolvedValue(reply([], { total: 0, processCounts: TABS }));
    const { unmount } = renderPage('/opportunities?excluded=true');
    expect(await screen.findByText(excludedList.empty)).toBeInTheDocument();
    expect(screen.queryByText(states.listEmpty)).not.toBeInTheDocument();
    unmount();
    renderPage('/opportunities?excluded=true&process=ANODIZING');
    expect(await screen.findByText(listFilters.filteredEmpty)).toBeInTheDocument();
    expect(screen.queryByText(excludedList.empty)).not.toBeInTheDocument();
  });

  it('관심 기업 보기와 같이 켜진 주소는 관심 기업 보기를 따른다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?bookmarked=true&excluded=true');
    await screen.findByTestId('opportunity-card');
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][3]).toEqual({ ...NO_FILTERS, bookmarked: 'true' });
    expect(screen.getByTestId('list-bookmarked-view')).toBeInTheDocument();
    expect(screen.queryByTestId('list-excluded-view')).not.toBeInTheDocument();
  });

  it('검색하면 제외한 회사 보기에서 나와 전체 후보에서 찾는다', async () => {
    mockedGet.mockResolvedValue(reply([apjeong]));
    renderPage('/opportunities?excluded=true&q=정밀');
    await screen.findByTestId('opportunity-card');
    expect(mockedGet.mock.calls[0][3]).toEqual({ ...NO_FILTERS, q: '정밀' });
    expect(screen.queryByTestId('list-excluded-view')).not.toBeInTheDocument();
  });
});
