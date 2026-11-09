// 목록 머리(#210 → #361): 공정 선택란(9종·0곳 포함) / 지역·산업 선택지와 "전체" / 공정 선택란 숨김 /
// 공정을 고르기 전(#368 → #383, 2026-11-07 PM 결정): 맨 위 "전체(공정별로 묶음)"가 골라져 보이고 지역·산업 선택란도 보인다 /
// 주소에서 온 값 유지 / 회사 이름 검색 칸과 결과 줄·[검색 지우기] / 정렬("가까운 순"은 준비 중).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListFilterBar from '../ListFilterBar';
import type { ListFilterBarProps } from '../ListFilterBar';
import { listFilters, listSearch } from '../../../labels/ko';

/** 거산 공정 9종(서버가 주는 순서). 회사가 0곳인 공정도 함께 온다. */
const PROCESSES = [
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

function renderBar(overrides: Partial<ListFilterBarProps> = {}) {
  const handlers = {
    onProcess: vi.fn(),
    onRegion: vi.fn(),
    onIndustry: vi.fn(),
    onSearch: vi.fn(),
    onClearSearch: vi.fn(),
    onSort: vi.fn(),
  };
  render(
    <ListFilterBar
      sort="rank"
      processCounts={PROCESSES}
      showProcess
      process="ZINC_PLATING"
      region={null}
      industry={null}
      regionCounts={[
        { region: '천안 인근', count: 8 },
        { region: '아산시', count: 5 },
      ]}
      industryCounts={[{ industry: '자동차 부품', count: 4 }]}
      query={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

const optionTexts = (testId: string) =>
  within(screen.getByTestId(testId))
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('ListFilterBar', () => {
  describe('공정 선택란 (#361)', () => {
    it('맨 위 "전체(공정별로 묶음)" 아래에 거산 공정 9종이 서버가 준 순서대로 "이름 곳 수"로 보이고, 0곳인 공정도 보인다', () => {
      renderBar();
      expect(screen.getByLabelText(listFilters.processLabel)).toBe(
        screen.getByTestId('list-process-select'),
      );
      expect(optionTexts('list-process-select')).toEqual([
        '전체(공정별로 묶음)',
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
    });

    it('지금 공정이 골라져 있고, 지역·산업의 "전체"와 같은 글자의 선택지는 없다(공정은 "전체(공정별로 묶음)")', () => {
      renderBar({ process: 'ANODIZING' });
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(select.value).toBe('ANODIZING');
      expect(
        within(select).queryByRole('option', { name: listFilters.all }),
      ).not.toBeInTheDocument();
      expect(within(select).getAllByRole('option')).toHaveLength(10);
    });

    it('탭 줄은 더 이상 없다(공정은 선택란 하나로 고른다)', () => {
      renderBar();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('다른 공정을 고르면 그 공정 코드를 알린다(0곳인 공정도 고를 수 있다)', async () => {
      const user = userEvent.setup();
      const { onProcess } = renderBar();
      await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
      expect(onProcess).toHaveBeenLastCalledWith('ANODIZING');
      await user.selectOptions(screen.getByTestId('list-process-select'), 'CHROME_PLATING');
      expect(onProcess).toHaveBeenLastCalledWith('CHROME_PLATING');
    });

    it('공정 선택란을 숨기라고 하면 공정 선택란만 없고 지역·산업 선택란은 남는다', () => {
      renderBar({ showProcess: false });
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-industry-select')).toBeInTheDocument();
    });

    it('공정이 하나도 없으면 공정 선택란이 없다', () => {
      renderBar({ processCounts: [] });
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
    });
  });

  // #368의 "공정을 고르세요"·지역·산업 숨김을 #383(2026-11-07 PM 결정)이 바꿨다: 묶음 보기가 골라진 것으로 보이고 지역·산업도 보인다.
  describe('공정을 고르기 전 — 묶음 보기 (#383)', () => {
    it('고른 공정이 없으면 맨 위 "전체(공정별로 묶음)"가 골라져 보이고(고를 수 있다) 그 아래에 9종이 있다', () => {
      renderBar({ process: null });
      const select = screen.getByTestId('list-process-select') as HTMLSelectElement;
      expect(select.value).toBe('');
      const options = within(select).getAllByRole('option') as HTMLOptionElement[];
      expect(options).toHaveLength(10);
      expect(options[0]).toHaveTextContent(/^전체\(공정별로 묶음\)$/);
      expect(options[0]).not.toBeDisabled();
      expect(options[0].value).toBe('');
      expect(options[1]).toHaveTextContent('아연도금(전기아연도금) 9');
      expect(screen.queryByText('공정을 고르세요')).not.toBeInTheDocument();
    });

    it('고른 공정이 없어도 지역·산업 선택란이 보이고, 검색 칸과 정렬도 남는다', () => {
      renderBar({ process: null });
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-industry-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-search-input')).toBeInTheDocument();
      expect(screen.getByTestId('list-sort')).toBeInTheDocument();
    });

    it('묶음 보기에서 공정을 고르면 그 공정 코드를 알린다', async () => {
      const user = userEvent.setup();
      const handlers = renderBar({ process: null });
      await user.selectOptions(screen.getByTestId('list-process-select'), 'ANODIZING');
      expect(handlers.onProcess).toHaveBeenCalledTimes(1);
      expect(handlers.onProcess).toHaveBeenCalledWith('ANODIZING');
    });

    it('공정 하나를 고른 상태에서 "전체(공정별로 묶음)"를 고르면 null을 알린다', async () => {
      const user = userEvent.setup();
      const handlers = renderBar({ process: 'ANODIZING' });
      await user.selectOptions(screen.getByTestId('list-process-select'), '');
      expect(handlers.onProcess).toHaveBeenCalledTimes(1);
      expect(handlers.onProcess).toHaveBeenCalledWith(null);
    });

    it('주소의 공정이 선택지에 없는 값이면 "전체(공정별로 묶음)"가 골라진 것으로 보이고 그 값은 선택지에 더하지 않는다', () => {
      renderBar({ process: 'NOT_A_PROCESS' });
      expect((screen.getByTestId('list-process-select') as HTMLSelectElement).value).toBe('');
      expect(optionTexts('list-process-select')).toHaveLength(10);
      expect(optionTexts('list-process-select')[0]).toBe(listFilters.processGrouped);
      expect(screen.queryByText(/NOT_A_PROCESS/)).not.toBeInTheDocument();
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
    });

    it('공정 선택란이 없는 보기(관심 기업·대시보드 칸)에서는 공정이 없어도 지역·산업 선택란이 보인다', () => {
      renderBar({ showProcess: false, process: null });
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-region-select')).toBeInTheDocument();
      expect(screen.getByTestId('list-industry-select')).toBeInTheDocument();
    });
  });

  it('지역·산업 선택지는 "전체"가 맨 앞이고 이름 옆에 건수가 붙는다', () => {
    renderBar();
    expect(optionTexts('list-region-select')).toEqual(['전체', '천안 인근 8', '아산시 5']);
    expect(optionTexts('list-industry-select')).toEqual(['전체', '자동차 부품 4']);
    expect(screen.getByLabelText(listFilters.regionLabel)).toBe(
      screen.getByTestId('list-region-select'),
    );
    expect(screen.getByLabelText(listFilters.industryLabel)).toBe(
      screen.getByTestId('list-industry-select'),
    );
  });

  it('고르면 값을, "전체"로 돌리면 null을 알린다', async () => {
    const user = userEvent.setup();
    const { onRegion, onIndustry } = renderBar({ region: '아산시' });
    await user.selectOptions(screen.getByTestId('list-industry-select'), '자동차 부품');
    expect(onIndustry).toHaveBeenCalledWith('자동차 부품');
    await user.selectOptions(screen.getByTestId('list-region-select'), listFilters.all);
    expect(onRegion).toHaveBeenCalledWith(null);
  });

  it('주소에서 온 값이 선택지에 없으면(그 공정에 0건) 0건으로 함께 보여 고른 값이 사라지지 않는다', () => {
    renderBar({ region: '당진시', regionCounts: [{ region: '아산시', count: 5 }] });
    const select = screen.getByTestId('list-region-select') as HTMLSelectElement;
    expect(select.value).toBe('당진시');
    expect(within(select).getByRole('option', { name: '당진시 0' })).toBeInTheDocument();
  });

  it('선택지도 고른 값도 없으면 지역·산업 선택 상자는 보이지 않는다', () => {
    renderBar({ regionCounts: [], industryCounts: [] });
    expect(screen.queryByTestId('list-region-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-industry-select')).not.toBeInTheDocument();
  });

  describe('회사 이름 검색 칸 (#361)', () => {
    it('검색 칸에 이름과 자리 글자가 있고, 평소에는 결과 줄이 없다', () => {
      renderBar();
      const input = screen.getByRole('searchbox', { name: listSearch.label });
      expect(input).toBe(screen.getByTestId('list-search-input'));
      expect(input).toHaveAttribute('placeholder', '회사 이름을 입력하세요');
      expect(input).toHaveValue('');
      expect(screen.getByTestId('list-search-button')).toHaveTextContent(/^검색$/);
      expect(screen.queryByTestId('list-search-line')).not.toBeInTheDocument();
    });

    it('[검색]을 누르거나 Enter를 치면 앞뒤 공백을 뗀 검색어를 알린다', async () => {
      const user = userEvent.setup();
      const { onSearch } = renderBar();
      await user.type(screen.getByTestId('list-search-input'), '  코파스 ');
      await user.click(screen.getByTestId('list-search-button'));
      expect(onSearch).toHaveBeenLastCalledWith('코파스');
      await user.clear(screen.getByTestId('list-search-input'));
      await user.type(screen.getByTestId('list-search-input'), '명화금속{Enter}');
      expect(onSearch).toHaveBeenLastCalledWith('명화금속');
      expect(onSearch).toHaveBeenCalledTimes(2);
    });

    it('빈 검색어·공백만 있는 검색어로는 알리지 않는다', async () => {
      const user = userEvent.setup();
      const { onSearch } = renderBar();
      await user.click(screen.getByTestId('list-search-button'));
      await user.type(screen.getByTestId('list-search-input'), '   {Enter}');
      expect(onSearch).not.toHaveBeenCalled();
    });

    it('검색 중에는 세 선택란이 숨고, 결과 줄에 "전체 후보에서 찾은 결과"와 검색어·[검색 지우기]가 보인다', async () => {
      const user = userEvent.setup();
      const { onClearSearch } = renderBar({ query: '코파스', region: '아산시' });
      expect(screen.queryByTestId('list-process-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-region-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('list-industry-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('list-search-line')).toHaveTextContent('전체 후보에서 찾은 결과');
      expect(screen.getByTestId('list-search-query')).toHaveTextContent(/^코파스$/);
      // 검색 칸은 검색 중에도 보이고 지금 검색어가 들어 있다.
      expect(screen.getByTestId('list-search-input')).toHaveValue('코파스');
      expect(screen.getByTestId('list-search-clear')).toHaveTextContent(/^검색 지우기$/);
      await user.click(screen.getByTestId('list-search-clear'));
      expect(onClearSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe('정렬 (#361 · #516)', () => {
    it('"추천 순"이 골라져 있고, "최근 들어온 순"은 고를 수 있으며, "가까운 순 (준비 중)"은 고를 수 없게 표시된다', () => {
      renderBar();
      const group = screen.getByRole('group', { name: listSearch.sortLabel });
      const buttons = within(group).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual([
        '추천 순',
        '최근 들어온 순',
        '가까운 순 (준비 중)',
      ]);
      expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
      expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
      expect(buttons[1]).not.toHaveAttribute('aria-disabled');
      expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
      expect(buttons[2]).toHaveAttribute('aria-disabled', 'true');
    });

    it('"최근 들어온 순"을 누르면 recent를 알리고, 이미 골라진 정렬을 다시 눌러도 알리지 않는다', async () => {
      const user = userEvent.setup();
      const handlers = renderBar();
      await user.click(screen.getByTestId('list-sort-recent'));
      expect(handlers.onSort).toHaveBeenCalledTimes(1);
      expect(handlers.onSort).toHaveBeenCalledWith('recent');
      await user.click(screen.getByTestId('list-sort-rank'));
      expect(handlers.onSort).toHaveBeenCalledTimes(1);
    });

    it('주소의 정렬이 recent면 "최근 들어온 순"이 골라져 보이고 "추천 순"을 누르면 rank를 알린다', async () => {
      const user = userEvent.setup();
      const handlers = renderBar({ sort: 'recent' });
      expect(screen.getByTestId('list-sort-recent')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('list-sort-rank')).toHaveAttribute('aria-pressed', 'false');
      await user.click(screen.getByTestId('list-sort-rank'));
      expect(handlers.onSort).toHaveBeenCalledWith('rank');
    });

    it('"가까운 순 (준비 중)"을 눌러도 아무것도 알리지 않고 "추천 순"이 그대로 골라져 있다', async () => {
      const user = userEvent.setup();
      const handlers = renderBar();
      await user.click(screen.getByTestId('list-sort-distance'));
      await user.click(screen.getByTestId('list-sort-rank'));
      for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
      expect(screen.getByTestId('list-sort-rank')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('list-sort-distance')).toHaveAttribute('aria-pressed', 'false');
    });

    it('정렬 묶음은 검색 중에도, 공정 선택란이 없는 보기에서도 보인다', () => {
      renderBar({ query: '코파스', showProcess: false });
      expect(screen.getByTestId('list-sort')).toBeInTheDocument();
    });
  });
});
