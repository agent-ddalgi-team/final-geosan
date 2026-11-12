// 추천 목록(S1, BR10.1·BR10.7): 공정·지역·산업 선택란 + 회사 이름 검색 + 정렬 + 순위 순 카드 + 쪽 넘김(20건씩) + 다섯 상태.
// 조건은 모두 주소(`?process=&region=&industry=`, 대시보드에서 넘어올 때는 `?stage=`·`?filter=`·`?q=`)에 남겨
// 새로 고침·공유해도 유지되고, 서버에 그대로 보낸다. 서버가 순위를 조건 안 번호로 다시 매긴다.
// 공정은 선택란이다(#361). 공정을 고르기 전에는 공정별 묶음으로 보인다(#383, 2026-11-07 PM 결정; #368의 빈 목록을 바꿈):
//   주소에 공정이 없으면 서버가 준 공정 선택지 가운데 회사가 있는 공정마다 `process=<코드>`로 따로 불러 묶음으로 보인다.
//   묶음 안 번호는 그 공정 안 순위 그대로이고, 서로 다른 공정을 한 줄 순위로 섞지 않는다. 지역·산업은 묶음 보기에서도 고를 수 있다.
//   마지막으로 본 선택(공정 하나 또는 묶음 보기)은 이 브라우저가 기억해, 공정 없이 열면 그것으로 연다. 프로그램이 공정을 대신 고르지 않는다.
// 대시보드 건수로 넘어온 목록은 공정 선택란 없이 전체(공정 섞임)이다. 재접촉 탭은 뒤 단위라 만들지 않는다.
// 검색(#361): 주소가 `?q=검색어`이면 고른 조건과 상관없이 전체 후보에서 찾는다(서버에는 검색어만 보낸다).
//   [검색 지우기]는 검색하기 직전의 주소로 돌아간다. 직전 주소는 주소 기록(history state)에 실어 새로 고침해도 남는다.
// 정렬(#361·#516): "추천 순"(기본, 서버로 `sort`를 보내지 않음)과 "최근 들어온 순"(`?sort=recent`).
// "가까운 순"은 거리 작업(#222) 전이라 흐리게만 보이고 아무것도 보내지 않는다.
// "관심 기업" 보기(#357): 주소 `?bookmarked=true`면 관심으로 고른 회사만 보이고, 검토 의견 거르기는 `&opinion=`으로 남는다.
// "제외한 회사" 보기(#536): 주소 `?excluded=true`면 검토 대상 제외로 저장한 회사만 보인다(서버에는 `opinion=NOT_TARGET`).
// 관심 기업 보기도 공정 선택란 없이 전체에서 거른다(대시보드 "관심 기업 N곳"과 곳 수가 같아야 해서).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Pagination } from 'antd';
import { getOpportunities } from '../api/client';
import type { Meta, OpportunityCard as CardData } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import ExportButton from '../components/list/ExportButton';
import IngestForm from '../components/list/IngestForm';
import IngestSummary from '../components/list/IngestSummary';
import { useIngestOptions } from '../components/list/useIngestOptions';
import ListFilterBar from '../components/list/ListFilterBar';
import type { ListSort } from '../components/list/ListFilterBar';
import {
  FLAT_VIEW_CHOICE,
  GROUPED_VIEW_CHOICE,
  readLastProcess,
  storeLastProcess,
} from '../components/list/lastProcess';
import ListViewBar, { isOpinionFilter } from '../components/list/ListViewBar';
import OpportunityCard from '../components/list/OpportunityCard';
import { GROUP_PAGE_SIZE, useProcessGroups } from '../components/list/useProcessGroups';
import {
  bookmarkList,
  excludedList,
  listFilters,
  listSearch,
  pagination,
  states,
} from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';

export const PAGE_SIZE = 20;
/** 가져오는 중일 때 진행을 서버에서 다시 읽는 간격(밀리초). 약속에 값이 없어 화면이 정한 5초다. */
export const INGEST_POLL_MS = 5000;

/** 검색하기 직전의 주소(물음표 뒤 조건)를 주소 기록에 실을 때 쓰는 이름. */
const SEARCH_RETURN_KEY = 'searchReturn';

/** 주소 기록에 실린 "검색하기 직전의 주소"를 읽는다. 없거나 글자가 아니면 null(직전 주소를 모름). */
function readSearchReturn(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const value = (state as Record<string, unknown>)[SEARCH_RETURN_KEY];
  return typeof value === 'string' ? value : null;
}

interface Result {
  key: string;
  items?: CardData[];
  meta?: Meta;
  error?: unknown;
}

export default function OpportunityListPage() {
  const { config, setBannerMeta } = useFrame();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // 검색어(#361). 빈 글자·공백만 있는 값은 검색이 아닌 것으로 읽는다.
  const qParam = params.get('q');
  const q = qParam && qParam.trim() ? qParam : null;
  const searching = q !== null;
  // 검색 중에는 전체 후보에서 찾으므로 주소에 다른 조건이 같이 적혀 있어도 읽지 않는다(서버에는 검색어만 간다).
  const condition = (key: string) => (searching ? null : params.get(key));
  const process = condition('process');
  const region = condition('region');
  const industry = condition('industry');
  const stage = condition('stage');
  const filter = condition('filter');
  // 정렬(#516)은 주소 `?sort=recent`로만 남긴다. 다른 값은 추천 순으로 읽는다.
  const sort: ListSort = condition('sort') === 'recent' ? 'recent' : 'rank';
  // "관심 기업" 보기(#357)는 주소 `?bookmarked=true`로만 남긴다. 다른 값은 평소 목록으로 읽는다.
  const bookmarked = condition('bookmarked') === 'true';
  // "제외한 회사" 보기(#536)는 주소 `?excluded=true`로만 남긴다. 관심 기업 보기와 같이 켜지면 관심 기업 보기를 따른다.
  const excluded = !bookmarked && condition('excluded') === 'true';
  // 검토 의견 거르기는 관심 기업 보기에서만 쓴다(거르기 단추가 그 보기에만 있다). 표에 없는 값은 "전체 보기"로 읽는다.
  const opinionParam = condition('opinion');
  const opinion = bookmarked && isOpinionFilter(opinionParam) ? opinionParam : null;
  // 공정 선택란은 평소 목록에만 있다. 대시보드 건수로 넘어온 전체 목록·검색 결과·관심 기업 보기에는 없다.
  const processMode = !stage && !filter && !searching && !bookmarked && !excluded;
  // 전체 보기(#516): 평소 목록에서 공정을 고르지 않고 주소에 `view=all`이 있으면 묶지 않고 한 줄로 본다.
  const flat = processMode && !process && condition('view') === 'all';
  // 검색하기 직전의 주소. 대시보드에서 검색으로 바로 넘어왔으면 모른다(null).
  const searchReturn = readSearchReturn(location.state);
  const filterKey = [
    process,
    region,
    industry,
    stage,
    filter,
    q,
    sort === 'recent' ? 'recent' : '',
    bookmarked ? 'bookmarked' : '',
    excluded ? 'excluded' : '',
    opinion,
    // 서버 요청은 같지만 묶음 보기는 첫 응답의 카드를 버리므로, 전체 보기로 바꾸면 다시 불러야 한다.
    flat ? 'all' : '',
  ]
    .map((v) => v ?? '')
    .join('|');

  // 조건이 바뀌면 1쪽부터 다시 본다.
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  // 선택란의 선택지는 목록을 다시 불러오는 동안에도 사라지지 않게 마지막 응답의 meta를 기억한다.
  const [menu, setMenu] = useState<Meta | null>(null);
  const requestKey = `${filterKey}:${page}:${reload}`;

  // 서버에 보내는 조건. 묶음 보기의 묶음 요청도 이 모양에 `process`만 바꿔 보낸다.
  const baseFilters = useMemo(
    () => ({
      process,
      region,
      industry,
      stage,
      filter,
      q,
      // 추천 순일 때는 이 칸을 아예 보내지 않는다(서버·기존 시험이 보는 요청 모양을 바꾸지 않음).
      ...(sort === 'recent' ? { sort: 'recent' } : {}),
      // 관심 기업 보기와 그 안의 검토 의견 거르기도 켰을 때만 보낸다.
      ...(bookmarked ? { bookmarked: 'true' } : {}),
      ...(opinion ? { opinion } : {}),
      // 제외한 회사 보기는 관심 조건 없이 최신 의견이 검토 대상 제외인 회사만 달라고 한다.
      ...(excluded ? { opinion: 'NOT_TARGET' } : {}),
    }),
    [process, region, industry, stage, filter, q, sort, bookmarked, opinion, excluded],
  );

  useEffect(() => {
    const controller = new AbortController();
    getOpportunities(page, PAGE_SIZE, controller.signal, baseFilters)
      .then((envelope) => {
        setMenu(envelope.meta);
        const choices = envelope.meta.processCounts ?? [];
        const isChoice = (code: string | null) => choices.some((item) => item.processCode === code);
        if (processMode && choices.length > 0) {
          if (isChoice(process)) {
            // 다음에 공정 없이 목록을 열면 이 공정으로 바로 열리도록 기억한다.
            storeLastProcess(process);
          } else if (flat) {
            // 전체 보기(#516): 공정 상관없이 이 응답의 카드를 한 줄로 그대로 보이고, 그렇게 기억한다.
            storeLastProcess(FLAT_VIEW_CHOICE);
            setResult({ key: requestKey, items: envelope.data, meta: envelope.meta });
            return;
          } else {
            // 공정이 골라져 있지 않다(주소에 없거나 선택지에 없는 값). 프로그램이 공정을 대신 고르지 않는다(#368).
            const remembered = readLastProcess();
            const usable = isChoice(remembered);
            if (usable || process) {
              // 지난번에 본 공정이 있으면 그 공정으로, 없으면 주소의 틀린 공정만 지우고(묶음 보기) 다시 불러온다
              // (뒤로 가기 기록은 남기지 않는다).
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (usable && remembered) next.set('process', remembered);
                  else next.delete('process');
                  return next;
                },
                { replace: true },
              );
              return;
            }
            if (remembered === FLAT_VIEW_CHOICE) {
              // 지난번에 전체 보기를 봤으면 그것으로 연다(주소에 view=all을 더해 다시 부른다. 기록은 남기지 않는다).
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('view', 'all');
                  return next;
                },
                { replace: true },
              );
              return;
            }
            // 묶음 보기(#383): 기억이 없거나 묶음 보기이거나 더는 없는 공정이면 묶음 보기로 열고 그렇게 기억한다.
            // 이 응답의 카드(공정 섞임)는 쓰지 않고 선택지·곳 수만 쓴다. 묶음은 공정마다 따로 부른다.
            storeLastProcess(GROUPED_VIEW_CHOICE);
            setResult({ key: requestKey, items: [], meta: envelope.meta });
            return;
          }
        }
        setResult({ key: requestKey, items: envelope.data, meta: envelope.meta });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [page, baseFilters, process, processMode, flat, requestKey, setParams]);

  const current = result?.key === requestKey ? result : null;
  const meta = current?.meta ?? null;

  // 묶음 보기(#383): 공정 선택란이 있는 평소 목록에서 공정을 고르지 않았고 공정 선택지가 왔을 때. 전체 보기(#516)면 묶지 않는다.
  const grouped = processMode && !process && !flat && (meta?.processCounts ?? []).length > 0;
  // 회사가 1곳 이상인 공정만 묶음으로 부른다(선택지 곳 수는 지역·산업과 상관없는 전체 건수라, 조건을 걸면 0곳이 될 수 있다).
  const groupCodes = useMemo(
    () =>
      grouped
        ? (meta?.processCounts ?? [])
            .filter((item) => item.count > 0)
            .map((item) => item.processCode)
        : [],
    [grouped, meta],
  );
  const groups = useProcessGroups(groupCodes, baseFilters, reload);

  // 띠(가상 데이터·거산 확인 전·갱신 시각)는 목록 응답의 meta를 따른다.
  useEffect(() => {
    if (!meta) return undefined;
    setBannerMeta(meta);
    return () => setBannerMeta(null);
  }, [meta, setBannerMeta]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  // 후보 수집 진행만 조용히 다시 읽는다(목록을 비우거나 깜박이지 않는다). 읽지 못하면 이전 표시를 그대로 둔다.
  const ingestOptions = useIngestOptions();
  const refreshIngest = useCallback(async (signal?: AbortSignal) => {
    try {
      const envelope = await getOpportunities(1, 1, signal, {});
      const latest = envelope.meta.latestIngest ?? null;
      if (!signal?.aborted) {
        setMenu((prev) => (prev ? { ...prev, latestIngest: latest } : prev));
      }
      return latest;
    } catch {
      return undefined;
    }
  }, []);
  const ingestRunning = menu?.latestIngest?.status === 'RUNNING';
  useEffect(() => {
    if (!ingestRunning) return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void refreshIngest(controller.signal).then((latest) => {
        // 끝났으면(또는 실패했으면) 새로 들어온 회사가 보이도록 목록을 한 번 다시 불러온다.
        if (latest && latest.status !== 'RUNNING' && !controller.signal.aborted) {
          setReload((n) => n + 1);
        }
      });
    }, INGEST_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [ingestRunning, refreshIngest]);

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        // 보기·조건을 바꾸면 검색에서 나온다(검색은 조건과 섞지 않고 전체 후보에서만 한다).
        next.delete('q');
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      });
    },
    [setParams],
  );

  // 검색: 주소를 `?q=검색어` 하나로 바꾼다. 돌아갈 주소는 검색하기 직전 것을 기억하고,
  // 검색 중에 다른 이름으로 다시 검색하면 처음 검색하기 전의 주소를 그대로 넘긴다.
  const search = useCallback(
    (text: string) => {
      if (text === q) return;
      const back = searching ? searchReturn : location.search;
      setParams(
        new URLSearchParams({ q: text }),
        back === null ? undefined : { state: { [SEARCH_RETURN_KEY]: back } },
      );
    },
    [q, searching, searchReturn, location.search, setParams],
  );

  // [검색 지우기]: 검색하기 직전의 주소로 돌아간다. 모르면 조건 없는 목록으로 간다.
  const clearSearch = useCallback(() => {
    const next = new URLSearchParams(searchReturn ?? '');
    next.delete('q');
    setParams(next);
  }, [searchReturn, setParams]);

  const processNames = useMemo(
    () =>
      Object.fromEntries(
        (menu?.processCounts ?? []).map((item) => [item.processCode, item.processName]),
      ),
    [menu],
  );

  const items = current?.items ?? [];
  const total = meta?.total ?? items.length;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = from + items.length - 1;
  const notEvaluated = meta?.notEvaluatedCount ?? 0;

  // 묶음 보기에서 모든 묶음이 0곳이면(또는 회사가 있는 공정이 없으면) 비어 있음으로 본다. 실패한 묶음이 있으면 그 자리를 보인다.
  const groupsAllEmpty =
    grouped &&
    groupCodes.every((code) => {
      const group = groups.resultFor(code);
      return group?.items !== undefined && group.items.length === 0;
    });

  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';
  else if (grouped ? groupsAllEmpty : items.length === 0) state = 'empty';

  // 고른 공정에 회사가 한 곳도 없으면(전체 건수 0) 다른 조건과 상관없이 그 안내를 먼저 보인다.
  const processIsEmpty =
    processMode &&
    (meta?.processCounts ?? []).some((item) => item.processCode === process && item.count === 0);
  // 묶음 보기에서 회사가 있는 공정은 있는데 조건(지역·산업) 때문에 모든 묶음이 0곳이면 조건을 바꿔 보라는 문구다.
  const groupsFiltered = grouped && groupCodes.length > 0;
  // 관심 기업 보기에서 공정을 골라 0곳이면 "관심 기업 없음"이 아니라 조건을 바꿔 보라는 문구다(#516).
  // 제외한 회사 보기도 같다(#536).
  const bookmarkedByProcess = (bookmarked || excluded) && process !== null;
  const emptyText = searching
    ? listSearch.empty
    : processIsEmpty
      ? listFilters.processEmpty
      : region || industry || groupsFiltered || bookmarkedByProcess
        ? listFilters.filteredEmpty
        : stage || filter || opinion
          ? listFilters.noMatch
          : bookmarked
            ? bookmarkList.empty
            : excluded
              ? excludedList.empty
              : states.listEmpty;
  const latestIngest = menu?.latestIngest ?? null;
  // 묶음 머리에 끼우는 고른 조건 이름(지역·산업). 값이 곧 화면 이름이다.
  const groupConditions = [region, industry].filter((value): value is string => Boolean(value));
  // "이 공정만 보기" 링크: 그 묶음을 부른 조건 그대로 공정 하나를 고른 보기로 간다.
  const onlyProcessHref = (code: string) => {
    const next = new URLSearchParams();
    next.set('process', code);
    if (region) next.set('region', region);
    if (industry) next.set('industry', industry);
    if (sort === 'recent') next.set('sort', 'recent');
    return `${location.pathname}?${next.toString()}`;
  };

  return (
    <>
      {ingestOptions ? (
        <IngestForm
          options={ingestOptions}
          running={ingestRunning}
          onStarted={() => void refreshIngest()}
        />
      ) : null}
      {latestIngest ? <IngestSummary ingest={latestIngest} /> : null}
      <ListViewBar
        bookmarked={bookmarked}
        excluded={excluded}
        opinion={opinion}
        filter={filter}
        // 관심 기업 보기는 "전체"에서 시작하므로 켤 때 공정 조건을 뺀다(그 안에서 다시 고를 수 있다, #516).
        // 끌 때는 의견 거르기도 같이 뺀다.
        onBookmarked={(on) =>
          update(
            on
              ? { bookmarked: 'true', excluded: null, process: null }
              : { bookmarked: null, opinion: null },
          )
        }
        // 제외한 회사 보기(#536)도 "전체"에서 시작한다. 관심 기업 보기의 의견 거르기는 같이 뺀다.
        onExcluded={(on) =>
          update(
            on
              ? { excluded: 'true', bookmarked: null, opinion: null, process: null }
              : { excluded: null },
          )
        }
        onOpinion={(value) => update({ opinion: value })}
        onClearFilter={() => update({ filter: null })}
      />
      {/* 검색 칸은 서버 응답 전에도(불러오지 못했을 때도) 쓸 수 있게 머리를 항상 그린다. 선택지는 응답이 오면 채워진다. */}
      <ListFilterBar
        processCounts={menu?.processCounts ?? []}
        // 관심 기업 보기에도 공정 선택란을 둔다(#516, PM 2026-11-09). 묶지 않으므로 맨 위는 "전체"다.
        showProcess={processMode || bookmarked || excluded}
        processGrouped={processMode && !flat}
        process={process}
        region={region}
        industry={industry}
        regionCounts={menu?.regionCounts ?? []}
        industryCounts={menu?.industryCounts ?? []}
        query={q}
        // 공정을 바꾸면 지역·산업은 전체로 돌린다(선택지 건수가 공정마다 달라서).
        // 선택란에서 고른 것은 바로 기억한다. "전체(공정별로 묶음)"를 골랐을 때 지난번 공정 기억이 되살아나
        // 그 공정으로 돌아가 버리지 않게 하려는 것이다(주소에 공정이 없으면 기억한 것으로 여는 규칙 때문).
        onProcess={(code) => {
          // 관심 기업 보기에서 고른 공정은 기억하지 않는다(평소 목록의 "마지막 선택"과 섞이지 않게).
          if (processMode) storeLastProcess(code ?? GROUPED_VIEW_CHOICE);
          // 공정을 고르면(또는 묶음 보기로 돌아가면) 전체 보기에서 나온다.
          update({ process: code, region: null, industry: null, view: null });
        }}
        onRegion={(value) => update({ region: value })}
        onIndustry={(value) => update({ industry: value })}
        onSearch={search}
        onClearSearch={clearSearch}
        sort={sort}
        // 추천 순은 주소에서 빼서 기본값으로 둔다(예전 주소·즐겨찾기와 요청 모양이 그대로).
        onSort={(value) => update({ sort: value === 'recent' ? 'recent' : null })}
        // 전체 보기(#516): 켜면 공정을 빼고 한 줄로, 끄면 묶음 보기로. 어느 쪽이든 마지막 선택으로 기억한다.
        showFlat={processMode}
        flat={flat}
        onFlat={(on) => {
          storeLastProcess(on ? FLAT_VIEW_CHOICE : GROUPED_VIEW_CHOICE);
          update(on ? { view: 'all', process: null } : { view: null });
        }}
      />
      <FiveStates
        state={state}
        emptyText={emptyText}
        errorTitle={states.listError}
        error={current?.error}
        onRetry={retry}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: spacing.cardGap,
          }}
        >
          <p
            data-testid="list-total"
            style={{
              color: colors.textSecondary,
              margin: 0,
              fontSize: typography.fontSizeSecondary,
            }}
          >
            {grouped
              ? `${pagination.totalLine(total)} · ${listFilters.groupedNote}`
              : flat
                ? `${pagination.totalLine(total)} · ${listFilters.flatNote}`
                : pagination.totalLine(total)}
          </p>
          {/* 엑셀 내려받기(#217): 목록을 부른 조건 그대로 보낸다. 쪽 번호는 보내지 않아 전체가 담긴다. */}
          <ExportButton filters={baseFilters} />
        </div>
        {grouped ? (
          // 묶음 보기(#383): 공정마다 묶음 하나. 묶음 안 번호는 그 공정 안 순위다. 0곳인 묶음은 보이지 않는다.
          <div data-testid="process-groups" style={{ display: 'grid', gap: spacing.sectionGap }}>
            {groupCodes.map((code) => {
              const group = groups.resultFor(code);
              const groupItems = group?.items ?? [];
              if (group?.items !== undefined && groupItems.length === 0) return null;
              const groupTotal = group?.meta?.total ?? groupItems.length;
              return (
                <section
                  key={code}
                  data-testid={`process-group-${code}`}
                  aria-label={processNames[code] ?? code}
                >
                  <FiveStates
                    state={!group ? 'loading' : group.error ? 'error' : 'ready'}
                    errorTitle={states.listError}
                    error={group?.error}
                    onRetry={() => groups.retry(code)}
                    skeletonCount={1}
                    data-testid={`process-group-${code}-states`}
                  >
                    <h2
                      data-testid="process-group-title"
                      style={{
                        margin: `0 0 ${spacing.cardGap}px`,
                        fontSize: typography.fontSizeCardTitle,
                      }}
                    >
                      {listFilters.groupTitle(
                        processNames[code] ?? code,
                        groupConditions,
                        groupTotal,
                      )}
                    </h2>
                    <ol
                      data-testid="opportunity-list"
                      style={{
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        display: 'grid',
                        gap: spacing.cardGap,
                      }}
                    >
                      {groupItems.map((card) => (
                        <li key={card.oppId}>
                          <OpportunityCard
                            card={card}
                            classificationOverrides={config?.classificationLabels}
                            processNames={processNames}
                            showRank
                          />
                        </li>
                      ))}
                    </ol>
                    {groupTotal > GROUP_PAGE_SIZE ? (
                      <p style={{ marginTop: spacing.cardGap, marginBottom: 0 }}>
                        <Link to={onlyProcessHref(code)} data-testid="process-group-more">
                          {listFilters.onlyThisProcess}
                        </Link>
                      </p>
                    ) : null}
                  </FiveStates>
                </section>
              );
            })}
          </div>
        ) : (
          <ol
            data-testid="opportunity-list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: spacing.cardGap,
            }}
          >
            {items.map((card) => (
              <li key={card.oppId}>
                <OpportunityCard
                  card={card}
                  classificationOverrides={config?.classificationLabels}
                  processNames={processNames}
                  // 전체 보기(#516)는 공정이 섞이므로 순위 번호를 숨긴다(PM 결정 2026-11-06과 같은 규칙).
                  showRank={processMode && !flat}
                />
              </li>
            ))}
          </ol>
        )}
        {notEvaluated > 0 ? (
          <p data-testid="list-not-evaluated" style={{ color: colors.textSecondary }}>
            {states.notEvaluatedCount(notEvaluated)}
          </p>
        ) : null}
        {!grouped && total > 1 ? (
          <div
            data-testid="list-pagination"
            style={{
              marginTop: spacing.sectionGap,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              aria-live="polite"
              data-testid="list-range-text"
              style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
            >
              {pagination.total(from, to, total)} · {pagination.perPage}
            </span>
            {total > PAGE_SIZE ? (
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={(next) => setPageState({ key: filterKey, page: next })}
              />
            ) : null}
          </div>
        ) : null}
      </FiveStates>
    </>
  );
}
