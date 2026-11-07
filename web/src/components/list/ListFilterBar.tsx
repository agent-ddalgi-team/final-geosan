// 추천 목록 머리(#210 → #361, 2026-11-06 PM 결정): 공정·지역·산업 선택란 + 회사 이름 검색 칸 + 정렬. 모달 없이 인라인이다.
//  - 공정은 탭이 아니라 선택란이다. "전체"를 두지 않고, 회사가 0곳인 공정도 보인다.
//  - 공정을 아직 고르지 않았으면(#368) 공정 선택란 맨 위에 "공정을 고르세요"가 보이고 지역·산업 선택란은 숨는다.
//  - 검색하면 고른 조건과 상관없이 전체 후보에서 찾는다. 검색 중에는 세 선택란을 숨기고 결과 줄과 [검색 지우기]를 보인다.
//  - 정렬은 "추천 순"만 고를 수 있다. "가까운 순"은 거리 작업(#222) 전이라 흐리게만 보이고 눌러도 아무 일이 없다.
// 선택과 검색어는 부모가 주소(`?process=&region=&industry=`, `?q=`)에 남기고, 이 부품은 고른 값을 알리기만 한다.
// 선택지 옆 숫자는 서버가 준 건수다. 지역·산업은 건수가 0인 선택지를 서버가 빼서 주고, 공정은 0곳도 함께 준다.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from 'antd';
import type { IndustryCount, ProcessCount, RegionCount } from '../../api/types';
import { listFilters, listSearch } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface ListFilterBarProps {
  /** 공정 선택지(거산 공정 전부, 역량 파일 순서. 회사가 0곳인 공정도 온다). */
  processCounts: ProcessCount[];
  /** false면 공정 선택란을 그리지 않는다(관심 기업 보기, 대시보드 칸으로 넘어온 전체 목록). */
  showProcess: boolean;
  process: string | null;
  region: string | null;
  industry: string | null;
  regionCounts: RegionCount[];
  industryCounts: IndustryCount[];
  /** 지금 검색어(주소 `q=`). 있으면 검색 중이라 세 선택란을 숨기고 결과 줄을 보인다. */
  query: string | null;
  onProcess: (code: string) => void;
  onRegion: (region: string | null) => void;
  onIndustry: (industry: string | null) => void;
  /** [검색]·Enter. 앞뒤 공백을 뗀 검색어만 알린다(빈 검색어로는 알리지 않는다). */
  onSearch: (text: string) => void;
  onClearSearch: () => void;
}

const controlStyle = {
  minHeight: 36,
  padding: '0 12px',
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: colors.bgContainer,
  color: colors.text,
  font: 'inherit',
} as const;

const selectStyle = { ...controlStyle, minWidth: 160 } as const;

const rowStyle = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 } as const;

const labelStyle = {
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;

const sortStyle = (selected: boolean) =>
  ({
    minHeight: 36,
    padding: '0 14px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : colors.borderSecondary}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : colors.textDimmed,
    font: 'inherit',
    fontWeight: selected ? 700 : 400,
    cursor: selected ? 'default' : 'not-allowed',
  }) as const;

interface FilterSelectProps {
  id: string;
  label: string;
  value: string | null;
  /** value는 서버에 보내는 값, name은 화면에 보이는 이름. */
  items: { value: string; name: string; count: number }[];
  /** true면 맨 앞에 "전체"를 둔다(지역·산업). 공정은 "전체"가 없다. */
  withAll: boolean;
  /** "전체"가 없는 선택란에서 고른 값이 없을 때(선택지에 없는 값일 때도) 맨 위에 보이는 글자. 고를 수는 없다. */
  placeholder?: string;
  onChange: (value: string | null) => void;
  testId: string;
}

function FilterSelect({
  id,
  label,
  value,
  items,
  withAll,
  placeholder,
  onChange,
  testId,
}: FilterSelectProps) {
  // 주소에서 온 지역·산업 값이 선택지에 없으면(그 공정에 0건) 고른 값이 사라지지 않도록 0건으로 함께 보인다.
  const shown =
    withAll && value && !items.some((item) => item.value === value)
      ? [...items, { value, name: value, count: 0 }]
      : items;
  // "전체"가 없는 선택란(공정)은 고른 값이 선택지에 없으면 아무것도 고르지 않은 것으로 보인다.
  const unpicked = !withAll && !items.some((item) => item.value === value);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        value={unpicked ? '' : (value ?? '')}
        style={selectStyle}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        data-testid={testId}
      >
        {withAll ? <option value="">{listFilters.all}</option> : null}
        {unpicked && placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {shown.map((item) => (
          <option key={item.value} value={item.value}>
            {listFilters.option(item.name, item.count)}
          </option>
        ))}
      </select>
    </span>
  );
}

interface SearchBoxProps {
  /** 지금 검색어. 검색 중이 아니면 빈 글자. */
  initial: string;
  onSearch: (text: string) => void;
}

/** 회사 이름 검색 칸. 주소의 검색어가 바뀌면 부모가 `key`로 새로 그려 칸의 글자를 맞춘다. */
function SearchBox({ initial, onSearch }: SearchBoxProps) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    // 빈 검색어·공백만 있는 검색어로는 검색하지 않는다.
    if (!value) return;
    onSearch(value);
  };
  return (
    <form
      role="search"
      onSubmit={submit}
      data-testid="list-search"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <label htmlFor="list-search-input" style={{ position: 'absolute', left: -9999 }}>
        {listSearch.label}
      </label>
      <input
        id="list-search-input"
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={listSearch.placeholder}
        style={{ ...controlStyle, minWidth: 220 }}
        data-testid="list-search-input"
      />
      <button
        type="submit"
        style={{ ...controlStyle, padding: '0 14px', cursor: 'pointer' }}
        data-testid="list-search-button"
      >
        {listSearch.button}
      </button>
    </form>
  );
}

export default function ListFilterBar({
  processCounts,
  showProcess,
  process,
  region,
  industry,
  regionCounts,
  industryCounts,
  query,
  onProcess,
  onRegion,
  onIndustry,
  onSearch,
  onClearSearch,
}: ListFilterBarProps) {
  const searching = query !== null;
  const hasProcess = !searching && showProcess && processCounts.length > 0;
  // 공정을 고르기 전에는 지역·산업 선택란을 보이지 않는다(곳 수가 고른 공정 안 건수라서, #368).
  const waitingProcess = hasProcess && !processCounts.some((item) => item.processCode === process);
  const hasSelects =
    !searching &&
    !waitingProcess &&
    (regionCounts.length > 0 || industryCounts.length > 0 || region || industry);
  return (
    <div data-testid="list-filter-bar" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      <div style={rowStyle}>
        {hasProcess ? (
          <FilterSelect
            id="list-process-select"
            label={listFilters.processLabel}
            value={process}
            items={processCounts.map((item) => ({
              value: item.processCode,
              name: item.processName,
              count: item.count,
            }))}
            withAll={false}
            placeholder={listFilters.processPlaceholder}
            onChange={(code) => {
              if (code && code !== process) onProcess(code);
            }}
            testId="list-process-select"
          />
        ) : null}
        {hasSelects ? (
          <>
            <FilterSelect
              id="list-region-select"
              label={listFilters.regionLabel}
              value={region}
              items={regionCounts.map((item) => ({
                value: item.region,
                name: item.region,
                count: item.count,
              }))}
              withAll
              onChange={onRegion}
              testId="list-region-select"
            />
            <FilterSelect
              id="list-industry-select"
              label={listFilters.industryLabel}
              value={industry}
              items={industryCounts.map((item) => ({
                value: item.industry,
                name: item.industry,
                count: item.count,
              }))}
              withAll
              onChange={onIndustry}
              testId="list-industry-select"
            />
          </>
        ) : null}
        <SearchBox key={query ?? ''} initial={query ?? ''} onSearch={onSearch} />
        <div
          role="group"
          aria-label={listSearch.sortLabel}
          data-testid="list-sort"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}
        >
          <span aria-hidden="true" style={labelStyle}>
            {listSearch.sortLabel}
          </span>
          <button
            type="button"
            aria-pressed="true"
            style={sortStyle(true)}
            data-testid="list-sort-rank"
          >
            {listSearch.sortRank}
          </button>
          {/* 준비 중: 낭독기에도 읽히도록 지우지 않고 aria-disabled로 둔다. 누르는 일을 붙이지 않아 아무 요청도 없다. */}
          <button
            type="button"
            aria-pressed="false"
            aria-disabled="true"
            style={sortStyle(false)}
            data-testid="list-sort-distance"
          >
            {listSearch.sortDistance}
          </button>
        </div>
      </div>
      {searching ? (
        <div data-testid="list-search-line" style={{ ...rowStyle, gap: 12 }}>
          <span>
            <span style={{ color: colors.textSecondary }}>{listSearch.resultTitle}: </span>
            <strong data-testid="list-search-query">{query}</strong>
          </span>
          <Button size="small" onClick={onClearSearch} data-testid="list-search-clear">
            {listSearch.clear}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
