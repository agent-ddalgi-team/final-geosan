// 추천 목록 머리(#210, 결정 2026-11-03 밤): 공정 탭 + 지역·산업 드롭다운. 모달 없이 인라인이다.
// 선택은 부모가 주소(`?process=&region=&industry=`)에 남기고, 이 부품은 고른 값을 알리기만 한다.
// 선택지 옆 숫자는 서버가 준 건수(현재 공정 탭 안 건수)이고, 건수가 0인 선택지는 서버가 빼서 준다.
import type { IndustryCount, ProcessCount, RegionCount } from '../../api/types';
import { listFilters } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface ListFilterBarProps {
  /** 공정 탭 목록(기회가 있는 공정만, 역량 파일 순서). */
  processCounts: ProcessCount[];
  /** false면 탭을 그리지 않는다(대시보드 건수·검색으로 넘어온 전체 목록). */
  showTabs: boolean;
  process: string | null;
  region: string | null;
  industry: string | null;
  regionCounts: RegionCount[];
  industryCounts: IndustryCount[];
  onProcess: (code: string) => void;
  onRegion: (region: string | null) => void;
  onIndustry: (industry: string | null) => void;
}

const selectStyle = {
  minHeight: 36,
  minWidth: 160,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: colors.bgContainer,
  color: colors.text,
  font: 'inherit',
} as const;

interface FilterSelectProps {
  id: string;
  label: string;
  value: string | null;
  items: { name: string; count: number }[];
  onChange: (value: string | null) => void;
  testId: string;
}

function FilterSelect({ id, label, value, items, onChange, testId }: FilterSelectProps) {
  // 주소에서 온 값이 선택지에 없으면(그 공정에 0건) 고른 값이 사라지지 않도록 0건으로 함께 보인다.
  const shown =
    value && !items.some((item) => item.name === value)
      ? [...items, { name: value, count: 0 }]
      : items;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <label
        htmlFor={id}
        style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        style={selectStyle}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        data-testid={testId}
      >
        <option value="">{listFilters.all}</option>
        {shown.map((item) => (
          <option key={item.name} value={item.name}>
            {listFilters.option(item.name, item.count)}
          </option>
        ))}
      </select>
    </span>
  );
}

export default function ListFilterBar({
  processCounts,
  showTabs,
  process,
  region,
  industry,
  regionCounts,
  industryCounts,
  onProcess,
  onRegion,
  onIndustry,
}: ListFilterBarProps) {
  const hasSelects = regionCounts.length > 0 || industryCounts.length > 0 || region || industry;
  return (
    <div data-testid="list-filter-bar" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      {showTabs && processCounts.length > 0 ? (
        <div
          role="tablist"
          aria-label={listFilters.tabsLabel}
          data-testid="list-process-tabs"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
        >
          {processCounts.map((item) => {
            const selected = item.processCode === process;
            return (
              <button
                key={item.processCode}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  if (!selected) onProcess(item.processCode);
                }}
                data-testid={`list-process-tab-${item.processCode}`}
                style={{
                  minHeight: 40,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: `1px solid ${selected ? colors.text : colors.border}`,
                  background: selected ? colors.text : colors.bgContainer,
                  color: selected ? colors.bgContainer : colors.text,
                  font: 'inherit',
                  fontWeight: selected ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                {listFilters.tab(item.processName, item.count)}
              </button>
            );
          })}
        </div>
      ) : null}
      {hasSelects ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <FilterSelect
            id="list-region-select"
            label={listFilters.regionLabel}
            value={region}
            items={regionCounts.map((item) => ({ name: item.region, count: item.count }))}
            onChange={onRegion}
            testId="list-region-select"
          />
          <FilterSelect
            id="list-industry-select"
            label={listFilters.industryLabel}
            value={industry}
            items={industryCounts.map((item) => ({ name: item.industry, count: item.count }))}
            onChange={onIndustry}
            testId="list-industry-select"
          />
        </div>
      ) : null}
    </div>
  );
}
