// #798(PM 지시 2026-11-16): 목록 머리를 "공정 · 지역 · 정렬 + 검색(오른쪽)" 한 줄과 접힌 [조건 더 보기]로 줄인다.
// 지역 선택란은 권역(preset)과 시·군 직접 고르기로 나눠 보인다.
import { render, screen, within } from '@testing-library/react';
import ListFilterBar from '../ListFilterBar';
import type { ListFilterBarProps } from '../ListFilterBar';

function renderBar(overrides: Partial<ListFilterBarProps> = {}) {
  render(
    <ListFilterBar
      sort="rank"
      showFlat
      processCounts={[{ processCode: 'ZINC_PLATING', processName: '아연도금', count: 9 }]}
      showProcess
      process={null}
      region={null}
      industry={null}
      regionCounts={[
        { region: '천안·아산', count: 8, preset: true },
        { region: '충남', count: 9, preset: true },
        { region: '천안시', count: 6, preset: false },
        { region: '아산시', count: 2, preset: false },
      ]}
      industryCounts={[{ industry: '자동차 부품', count: 4 }]}
      query={null}
      distancePresets={[30, 50]}
      onProcess={vi.fn()}
      onRegion={vi.fn()}
      onIndustry={vi.fn()}
      onSearch={vi.fn()}
      onClearSearch={vi.fn()}
      onSort={vi.fn()}
      onFlat={vi.fn()}
      onMaxDistance={vi.fn()}
      {...overrides}
    />,
  );
}

it('Given 평소 목록 / When 열기 / Then 공정·지역·정렬·검색은 앞줄에, 산업·거리·전체 보기는 접힌 [조건 더 보기] 안에 있다', () => {
  renderBar({ moreExtra: <button data-testid="extra-in-more">제외한 회사 보기</button> });
  const main = screen.getByTestId('list-filter-main');
  expect(within(main).getByTestId('list-process-select')).toBeInTheDocument();
  expect(within(main).getByTestId('list-region-select')).toBeInTheDocument();
  expect(within(main).getByTestId('list-sort')).toBeInTheDocument();
  expect(within(main).getByTestId('list-search')).toBeInTheDocument();
  const more = screen.getByTestId('list-more');
  expect(more.tagName).toBe('DETAILS');
  expect(more).not.toHaveAttribute('open');
  expect(within(more).getByTestId('list-industry-select')).toBeInTheDocument();
  expect(within(more).getByTestId('list-distance-select')).toBeInTheDocument();
  expect(within(more).getByTestId('list-view-all')).toBeInTheDocument();
  expect(within(more).getByTestId('extra-in-more')).toBeInTheDocument();
  expect(within(more).getByTestId('list-more-toggle')).toHaveTextContent('조건 더 보기');
});

it('Given 산업·거리가 걸린 주소 / When 열기 / Then [조건 더 보기 (2)]로 펴진 채 보인다', () => {
  renderBar({ industry: '자동차 부품', maxDistanceKm: 30 });
  const more = screen.getByTestId('list-more');
  expect(more).toHaveAttribute('open');
  expect(screen.getByTestId('list-more-toggle')).toHaveTextContent('조건 더 보기 (2)');
});

it('지역 선택란은 "권역"과 "시·군 직접 고르기" 묶음으로 나뉜다', () => {
  renderBar();
  const select = screen.getByTestId('list-region-select');
  const groups = select.querySelectorAll('optgroup');
  expect([...groups].map((group) => group.getAttribute('label'))).toEqual([
    '권역',
    '시·군 직접 고르기',
  ]);
  expect(
    within(groups[0] as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['천안·아산 8', '충남 9']);
  expect(
    within(groups[1] as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['천안시 6', '아산시 2']);
});

it('옛 응답(preset 칸 없음)이면 묶음 없이 지금처럼 한 목록으로 보인다', () => {
  renderBar({
    regionCounts: [
      { region: '천안 인근', count: 8 },
      { region: '아산시', count: 5 },
    ],
  });
  expect(screen.getByTestId('list-region-select').querySelectorAll('optgroup')).toHaveLength(0);
});
