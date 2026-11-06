// 추천 목록(S1, BR10.1·BR10.7): 공정·지역·산업 선택란 + 회사 이름 검색 + 정렬 + 순위 순 카드 + 쪽 넘김(20건씩) + 다섯 상태.
// 조건은 모두 주소(`?process=&region=&industry=`, 대시보드에서 넘어올 때는 `?stage=`·`?filter=`·`?q=`)에 남겨
// 새로 고침·공유해도 유지되고, 서버에 그대로 보낸다. 서버가 순위를 조건 안 번호로 다시 매긴다.
// 공정은 선택란이고 "전체"가 없다(#361). 공정을 고르기 전에는 목록을 비워 둔다(#368, 2026-11-06 PM 결정):
//   주소에 공정이 없으면 이 브라우저에서 마지막으로 본 공정으로 열고, 기억한 공정이 없으면 카드 없이 "공정을 고르면…" 안내만 보인다.
// 대시보드 건수로 넘어온 목록은 공정 선택란 없이 전체(공정 섞임)이다. 재접촉 탭은 뒤 단위라 만들지 않는다.
// 검색(#361): 주소가 `?q=검색어`이면 고른 조건과 상관없이 전체 후보에서 찾는다(서버에는 검색어만 보낸다).
//   [검색 지우기]는 검색하기 직전의 주소로 돌아간다. 직전 주소는 주소 기록(history state)에 실어 새로 고침해도 남는다.
// 정렬(#361): "추천 순"뿐이다. "가까운 순"은 거리 작업(#222) 전이라 흐리게만 보이고 서버로 `sort`를 보내지 않는다.
// "관심 기업" 보기(#357): 주소 `?bookmarked=true`면 관심으로 고른 회사만 보이고, 검토 의견 거르기는 `&opinion=`으로 남는다.
// 관심 기업 보기도 공정 선택란 없이 전체에서 거른다(대시보드 "관심 기업 N곳"과 곳 수가 같아야 해서).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Pagination } from 'antd';
import { getOpportunities } from '../api/client';
import type { Meta, OpportunityCard as CardData } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import IngestForm from '../components/list/IngestForm';
import IngestSummary from '../components/list/IngestSummary';
import { useIngestOptions } from '../components/list/useIngestOptions';
import ListFilterBar from '../components/list/ListFilterBar';
import { readLastProcess, storeLastProcess } from '../components/list/lastProcess';
import ListViewBar, { isOpinionFilter } from '../components/list/ListViewBar';
import OpportunityCard from '../components/list/OpportunityCard';
import {
  bookmarkList,
  candidateSearch,
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
  // "이번 수집만"(#316)은 주소 `?batch=latest`로만 남긴다. 다른 값은 전체로 읽는다.
  const latestOnly = condition('batch') === 'latest';
  // "관심 기업" 보기(#357)는 주소 `?bookmarked=true`로만 남긴다. 다른 값은 평소 목록으로 읽는다.
  const bookmarked = condition('bookmarked') === 'true';
  // 검토 의견 거르기는 관심 기업 보기에서만 쓴다(거르기 단추가 그 보기에만 있다). 표에 없는 값은 "전체 보기"로 읽는다.
  const opinionParam = condition('opinion');
  const opinion = bookmarked && isOpinionFilter(opinionParam) ? opinionParam : null;
  // 공정 선택란은 평소 목록에만 있다. 대시보드 건수로 넘어온 전체 목록·검색 결과·관심 기업 보기에는 없다.
  const processMode = !stage && !filter && !searching && !bookmarked;
  // 검색하기 직전의 주소. 대시보드에서 검색으로 바로 넘어왔으면 모른다(null).
  const searchReturn = readSearchReturn(location.state);
  const filterKey = [
    process,
    region,
    industry,
    stage,
    filter,
    q,
    latestOnly ? 'latest' : '',
    bookmarked ? 'bookmarked' : '',
    opinion,
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

  useEffect(() => {
    const controller = new AbortController();
    getOpportunities(page, PAGE_SIZE, controller.signal, {
      process,
      region,
      industry,
      stage,
      filter,
      q,
      // 전체 보기일 때는 이 칸을 아예 보내지 않는다(서버·기존 시험이 보는 요청 모양을 바꾸지 않음).
      ...(latestOnly ? { batch: 'latest' } : {}),
      // 관심 기업 보기와 그 안의 검토 의견 거르기도 켰을 때만 보낸다.
      ...(bookmarked ? { bookmarked: 'true' } : {}),
      ...(opinion ? { opinion } : {}),
    })
      .then((envelope) => {
        setMenu(envelope.meta);
        const choices = envelope.meta.processCounts ?? [];
        const isChoice = (code: string | null) => choices.some((item) => item.processCode === code);
        if (processMode && choices.length > 0) {
          if (isChoice(process)) {
            // 다음에 공정 없이 목록을 열면 이 공정으로 바로 열리도록 기억한다.
            storeLastProcess(process);
          } else {
            // 공정을 아직 고르지 않았다(주소에 없거나 선택지에 없는 값). 프로그램이 공정을 대신 고르지 않는다(#368).
            const remembered = readLastProcess();
            const usable = isChoice(remembered);
            // 기억한 공정이 더는 없는 공정이면 지운다.
            if (remembered !== null && !usable) storeLastProcess(null);
            if (usable || process) {
              // 지난번에 본 공정이 있으면 그 공정으로, 없으면 주소의 틀린 공정만 지우고 다시 불러온다
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
            // 고르기 전: 서로 다른 공정의 회사를 한 줄로 섞어 보이지 않도록 카드는 비워 두고 선택지만 쓴다.
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
  }, [
    page,
    process,
    region,
    industry,
    stage,
    filter,
    q,
    latestOnly,
    bookmarked,
    opinion,
    processMode,
    requestKey,
    setParams,
  ]);

  const current = result?.key === requestKey ? result : null;
  const meta = current?.meta ?? null;

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

  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';
  else if (items.length === 0) state = 'empty';

  // 공정을 아직 고르지 않았으면(#368) 다른 조건과 상관없이 고르라는 안내를 보인다.
  const processUnpicked = processMode && !process && (meta?.processCounts ?? []).length > 0;
  // 고른 공정에 회사가 한 곳도 없으면(전체 건수 0) 다른 조건과 상관없이 그 안내를 먼저 보인다.
  const processIsEmpty =
    processMode &&
    (meta?.processCounts ?? []).some((item) => item.processCode === process && item.count === 0);
  const emptyText = searching
    ? listSearch.empty
    : processUnpicked
      ? listFilters.pickProcess
      : processIsEmpty
        ? listFilters.processEmpty
        : latestOnly
          ? candidateSearch.latestEmpty
          : region || industry
            ? listFilters.filteredEmpty
            : stage || filter || opinion
              ? listFilters.noMatch
              : bookmarked
                ? bookmarkList.empty
                : states.listEmpty;
  const latestIngest = menu?.latestIngest ?? null;

  return (
    <>
      {ingestOptions ? (
        <IngestForm
          options={ingestOptions}
          running={ingestRunning}
          onStarted={() => void refreshIngest()}
        />
      ) : null}
      {latestIngest ? (
        <IngestSummary
          ingest={latestIngest}
          scope={latestOnly ? 'latest' : 'all'}
          onScope={(scope) => update({ batch: scope === 'latest' ? 'latest' : null })}
        />
      ) : null}
      <ListViewBar
        bookmarked={bookmarked}
        opinion={opinion}
        filter={filter}
        // 관심 기업 보기는 공정 선택란 없이 전체에서 거르므로 켤 때 공정 조건을 뺀다. 끌 때는 의견 거르기도 같이 뺀다.
        onBookmarked={(on) =>
          update(on ? { bookmarked: 'true', process: null } : { bookmarked: null, opinion: null })
        }
        onOpinion={(value) => update({ opinion: value })}
        onClearFilter={() => update({ filter: null })}
      />
      {/* 검색 칸은 서버 응답 전에도(불러오지 못했을 때도) 쓸 수 있게 머리를 항상 그린다. 선택지는 응답이 오면 채워진다. */}
      <ListFilterBar
        processCounts={menu?.processCounts ?? []}
        showProcess={processMode}
        process={process}
        region={region}
        industry={industry}
        regionCounts={menu?.regionCounts ?? []}
        industryCounts={menu?.industryCounts ?? []}
        query={q}
        // 공정을 바꾸면 지역·산업은 전체로 돌린다(선택지 건수가 공정마다 달라서).
        onProcess={(code) => update({ process: code, region: null, industry: null })}
        onRegion={(value) => update({ region: value })}
        onIndustry={(value) => update({ industry: value })}
        onSearch={search}
        onClearSearch={clearSearch}
      />
      <FiveStates
        state={state}
        emptyText={emptyText}
        errorTitle={states.listError}
        error={current?.error}
        onRetry={retry}
      >
        <p
          data-testid="list-total"
          style={{
            color: colors.textSecondary,
            marginTop: 0,
            fontSize: typography.fontSizeSecondary,
          }}
        >
          {pagination.totalLine(total)}
        </p>
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
              />
            </li>
          ))}
        </ol>
        {notEvaluated > 0 ? (
          <p data-testid="list-not-evaluated" style={{ color: colors.textSecondary }}>
            {states.notEvaluatedCount(notEvaluated)}
          </p>
        ) : null}
        {total > 1 ? (
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
