// 목록 머리(#210): 공정 탭 표시·선택·누르기 / 지역·산업 선택지와 "전체" / 탭 숨김 / 주소에서 온 값 유지.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListFilterBar from '../ListFilterBar';
import type { ListFilterBarProps } from '../ListFilterBar';
import { listFilters } from '../../../labels/ko';

const TABS = [
  { processCode: 'ZINC_PLATING', processName: '전기아연도금', count: 9 },
  { processCode: 'ANODIZING', processName: '아노다이징', count: 10 },
];

function renderBar(overrides: Partial<ListFilterBarProps> = {}) {
  const handlers = { onProcess: vi.fn(), onRegion: vi.fn(), onIndustry: vi.fn() };
  render(
    <ListFilterBar
      processCounts={TABS}
      showTabs
      process="ZINC_PLATING"
      region={null}
      industry={null}
      regionCounts={[
        { region: '천안 인근', count: 8 },
        { region: '아산시', count: 5 },
      ]}
      industryCounts={[{ industry: '자동차 부품', count: 4 }]}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ListFilterBar', () => {
  it('공정마다 "이름 (건수)" 탭이 보이고 지금 공정만 선택 표시다', () => {
    renderBar();
    expect(screen.getByRole('tablist', { name: listFilters.tabsLabel })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['전기아연도금 (9)', '아노다이징 (10)']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('다른 탭을 누르면 그 공정 코드를 알리고, 지금 탭을 다시 눌러도 알리지 않는다', async () => {
    const user = userEvent.setup();
    const { onProcess } = renderBar();
    await user.click(screen.getByTestId('list-process-tab-ZINC_PLATING'));
    expect(onProcess).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('list-process-tab-ANODIZING'));
    expect(onProcess).toHaveBeenCalledWith('ANODIZING');
  });

  it('탭을 숨기라고 하거나 공정이 하나도 없으면 탭 줄이 없다', () => {
    renderBar({ showTabs: false });
    expect(screen.queryByTestId('list-process-tabs')).not.toBeInTheDocument();
  });

  it('공정이 없으면 탭이 없다', () => {
    renderBar({ processCounts: [] });
    expect(screen.queryByTestId('list-process-tabs')).not.toBeInTheDocument();
  });

  it('지역·산업 선택지는 "전체"가 맨 앞이고 이름 옆에 건수가 붙는다', () => {
    renderBar();
    expect(
      within(screen.getByTestId('list-region-select'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['전체', '천안 인근 8', '아산시 5']);
    expect(
      within(screen.getByTestId('list-industry-select'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['전체', '자동차 부품 4']);
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
});
