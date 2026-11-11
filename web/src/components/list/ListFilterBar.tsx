// 추천 목록 머리(#210 → #361, 2026-11-06 PM 결정): 공정·지역·산업 선택란 + 회사 이름 검색 칸 + 정렬. 모달 없이 인라인이다.
//  - 공정은 탭이 아니라 선택란이다. 회사가 0곳인 공정도 보인다.
//  - 공정 선택란 맨 위는 "전체(공정별로 묶음)"다(#383, 2026-11-07 PM 결정). 고른 공정이 없으면(주소에 공정이 없거나
//    선택지에 없는 값이면) 이것이 골라진 것으로 보이고, 지역·산업 선택란은 이때도 보여 먼저 고를 수 있다.
//    관심 기업 보기(#516, 2026-11-09 PM 지시)에도 공정 선택란이 있다. 거기서는 묶지 않으므로 맨 위가 "전체"다.
//  - 검색하면 고른 조건과 상관없이 전체 후보에서 찾는다. 검색 중에는 세 선택란을 숨기고 결과 줄과 [검색 지우기]를 보인다.
//  - 정렬은 "추천 순"과 "최근 들어온 순"(#516)을 고를 수 있다. "가까운 순"은 거리 작업(#222) 전이라 흐리게만 보이고
//    눌러도 아무 일이 없다. 고른 정렬은 부모가 주소(`?sort=recent`)에 남긴다.
//  - 정렬 줄 마지막 "전체 보기"(#516, PM 지시 2026-11-09)는 평소 목록에서만 보이고, 누르면 공정별 묶음을 풀어
//    모든 회사를 한 줄로 본다(주소 `?view=all`). 다시 누르면 묶음 보기로 돌아간다.
// 선택과 검색어는 부모가 주소(`?process=&region=&industry=`, `?q=`)에 남기고, 이 부품은 고른 값을 알리기만 한다.
// 선택지 옆 숫자는 서버가 준 건수다. 지역·산업은 건수가 0인 선택지를 서버가 빼서 주고, 공정은 0곳도 함께 준다.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from 'antd';
import type { IndustryCount, ProcessCount, RegionCount } from '../../api/types';
import { listFilters, listSearch } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

/** 목록 정렬(#516). rank = 추천 순(기본), recent = 들어온 시각 최신 순. */
export type ListSort = 'rank' | 'recent';

export interface ListFilterBarProps {
  /** 공정 선택지(거산 공정 전부, 역량 파일 순서. 회사가 0곳인 공정도 온다). */
  processCounts: ProcessCount[];
  /** false면 공정 선택란을 그리지 않는다(대시보드 칸으로 넘어온 전체 목록). */
  showProcess: boolean;
  /** 공정 선택란 맨 위 글자. true(기본)면 "전체(공정별로 묶음)", false면 "전체"(관심 기업 보기처럼 묶지 않는 보기). */
  processGrouped?: boolean;
  process: string | null;
  region: string | null;
  industry: string | null;
  regionCounts: RegionCount[];
  industryCounts: IndustryCount[];
  /** 지금 검색어(주소 `q=`). 있으면 검색 중이라 세 선택란을 숨기고 결과 줄을 보인다. */
  query: string | null;
  /** 공정 하나를 고르면 그 코드, "전체(공정별로 묶음)"를 고르면 null. */
  onProcess: (code: string | null) => void;
  onRegion: (region: string | null) => void;
  onIndustry: (industry: string | null) => void;
  /** [검색]·Enter. 앞뒤 공백을 뗀 검색어만 알린다(빈 검색어로는 알리지 않는다). */
  onSearch: (text: string) => void;
  onClearSearch: () => void;
  /** 지금 정렬(주소 `sort=`). 없으면 추천 순. */
  sort: ListSort;
  /** 다른 정렬을 고르면 알린다. 이미 골라진 것을 다시 눌러도 알리지 않는다. */
  onSort: (sort: ListSort) => void;
  /** true면 정렬 줄 끝에 "전체 보기" 단추를 그린다(평소 목록). 검색·관심 기업·대시보드 칸 보기에는 없다. */
  showFlat?: boolean;
  /** "전체 보기"가 눌려 있는지(주소 `view=all`). */
  flat?: boolean;
  /** "전체 보기"를 누르면 켜고 끄기를 알린다. */
  onFlat?: (on: boolean) => void;
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

/** 정렬 줄 단추. enabled가 false면(준비 중) 흐리게 보이고 누를 수 없는 모양이다. */
const sortStyle = (selected: boolean, enabled = true) =>
  ({
    minHeight: 36,
    padding: '0 14px',
    borderRadius: 8,
    border: `1px solid ${selected ? colors.text : enabled ? colors.border : colors.borderSecondary}`,
    background: selected ? colors.text : colors.bgContainer,
    color: selected ? colors.bgContainer : enabled ? colors.text : colors.textDimmed,
    font: 'inherit',
    fontWeight: selected ? 700 : 400,
    cursor: selected ? 'default' : enabled ? 'pointer' : 'not-allowed',
  }) as const;

interface FilterSelectProps {
  id: string;
  label: string;
  value: string | null;
  /** value는 서버에 보내는 값, name은 화면에 보이는 이름. */
  items: { value: string; name: string; count: number }[];
  /** 맨 앞 "전체" 선택지의 글자(지역·산업은 "전체", 공정은 "전체(공정별로 묶음)"). 값은 빈 글자다. */
  allLabel: string;
  /** true면 고른 값이 선택지에 없을 때 0건으로 함께 보여 고른 값이 사라지지 않게 한다(지역·산업). */
  keepUnknown: boolean;
  onChange: (value: string | null) => void;
  testId: string;
}

function FilterSelect({
  id,
  label,
  value,
  items,
  allLabel,
  keepUnknown,
  onChange,
  testId,
}: FilterSelectProps) {
  const known = items.some((item) => item.value === value);
  // 주소에서 온 지역·산업 값이 선택지에 없으면(그 공정에 0건) 고른 값이 사라지지 않도록 0건으로 함께 보인다.
  const shown =
    keepUnknown && value && !known ? [...items, { value, name: value, count: 0 }] : items;
  // 공정 선택란은 고른 값이 선택지에 없으면 맨 위 "전체(공정별로 묶음)"가 골라진 것으로 보인다.
  const current = known || (keepUnknown && value) ? value : '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        value={current ?? ''}
        style={selectStyle}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        data-testid={testId}
      >
        <option value="">{allLabel}</option>
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
  processGrouped = true,
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
  sort,
  onSort,
  showFlat = false,
  flat = false,
  onFlat,
}: ListFilterBarProps) {
  const searching = query !== null;
  const hasProcess = !searching && showProcess && processCounts.length > 0;
  // 지역·산업 선택란은 공정을 고르기 전(묶음 보기)에도 보인다(#383). 곳 수는 부모가 준 응답의 것이다.
  const hasSelects =
    !searching && (regionCounts.length > 0 || industryCounts.length > 0 || region || industry);
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
            allLabel={processGrouped ? listFilters.processGrouped : listFilters.all}
            keepUnknown={false}
            onChange={(code) => {
              // 선택지에 없는 공정이 주소에 있을 때 "전체(공정별로 묶음)"를 다시 고르는 것도 바뀐 것으로 알린다.
              const shownNow = processCounts.some((item) => item.processCode === process)
                ? process
                : null;
              if (code !== shownNow) onProcess(code);
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
              allLabel={listFilters.all}
              keepUnknown
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
              allLabel={listFilters.all}
              keepUnknown
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
            aria-pressed={sort === 'rank'}
            onClick={() => {
              if (sort !== 'rank') onSort('rank');
            }}
            style={sortStyle(sort === 'rank')}
            data-testid="list-sort-rank"
          >
            {listSearch.sortRank}
          </button>
          <button
            type="button"
            aria-pressed={sort === 'recent'}
            onClick={() => {
              if (sort !== 'recent') onSort('recent');
            }}
            style={sortStyle(sort === 'recent')}
            data-testid="list-sort-recent"
          >
            {listSearch.sortRecent}
          </button>
          {/* 준비 중: 낭독기에도 읽히도록 지우지 않고 aria-disabled로 둔다. 누르는 일을 붙이지 않아 아무 요청도 없다. */}
          <button
            type="button"
            aria-pressed="false"
            aria-disabled="true"
            style={sortStyle(false, false)}
            data-testid="list-sort-distance"
          >
            {listSearch.sortDistance}
          </button>
          {showFlat ? (
            <button
              type="button"
              aria-pressed={flat}
              onClick={() => onFlat?.(!flat)}
              style={{ ...sortStyle(flat), marginLeft: 8, cursor: 'pointer' }}
              data-testid="list-view-all"
            >
              {listSearch.viewAll}
            </button>
          ) : null}
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
