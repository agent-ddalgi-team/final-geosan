// 추천 목록(S1, BR10.1·BR10.7): 공정 탭 + 지역·산업 선택 + 순위 순 카드 + 쪽 넘김(20건씩) + 다섯 상태.
// 조건은 모두 주소(`?process=&region=&industry=`, 대시보드에서 넘어올 때는 `?stage=`·`?filter=`·`?q=`)에 남겨
// 새로 고침·공유해도 유지되고, 서버에 그대로 보낸다. 서버가 순위를 조건 안 번호로 다시 매긴다.
// 대시보드 건수·검색으로 넘어온 목록은 탭 없이 전체(공정 섞임)이다. 재접촉 탭·정렬 변경은 뒤 단위라 만들지 않는다.
// "관심 기업" 보기(#357): 주소 `?bookmarked=true`면 관심으로 고른 회사만 보이고, 검토 의견 거르기는 `&opinion=`으로 남는다.
// 관심 기업 보기도 공정 탭 없이 전체에서 거른다(대시보드 "관심 기업 N곳"과 곳 수가 같아야 해서).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagination } from 'antd';
import { getOpportunities } from '../api/client';
import type { Meta, OpportunityCard as CardData } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import IngestForm from '../components/list/IngestForm';
import IngestSummary from '../components/list/IngestSummary';
import { useIngestOptions } from '../components/list/useIngestOptions';
import ListFilterBar from '../components/list/ListFilterBar';
import ListViewBar, { isOpinionFilter } from '../components/list/ListViewBar';
import OpportunityCard from '../components/list/OpportunityCard';
import { bookmarkList, candidateSearch, listFilters, pagination, states } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';

export const PAGE_SIZE = 20;
/** 가져오는 중일 때 진행을 서버에서 다시 읽는 간격(밀리초). 약속에 값이 없어 화면이 정한 5초다. */
export const INGEST_POLL_MS = 5000;

interface Result {
  key: string;
  items?: CardData[];
  meta?: Meta;
  error?: unknown;
}

export default function OpportunityListPage() {
  const { config, setBannerMeta } = useFrame();
  const [params, setParams] = useSearchParams();
  const process = params.get('process');
  const region = params.get('region');
  const industry = params.get('industry');
  const stage = params.get('stage');
  const filter = params.get('filter');
  const q = params.get('q');
  // "이번 수집만"(#316)은 주소 `?batch=latest`로만 남긴다. 다른 값은 전체로 읽는다.
  const latestOnly = params.get('batch') === 'latest';
  // "관심 기업" 보기(#357)는 주소 `?bookmarked=true`로만 남긴다. 다른 값은 평소 목록으로 읽는다.
  const bookmarked = params.get('bookmarked') === 'true';
  // 검토 의견 거르기는 관심 기업 보기에서만 쓴다(거르기 단추가 그 보기에만 있다). 표에 없는 값은 "전체 보기"로 읽는다.
  const opinionParam = params.get('opinion');
  const opinion = bookmarked && isOpinionFilter(opinionParam) ? opinionParam : null;
  // 대시보드 건수·검색으로 넘어온 전체 목록과 관심 기업 보기에는 공정 탭이 없다.
  const tabsMode = !stage && !filter && !q && !bookmarked;
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
  // 탭·선택지는 목록을 다시 불러오는 동안에도 사라지지 않게 마지막 응답의 meta를 기억한다.
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
        const tabs = envelope.meta.processCounts ?? [];
        if (tabsMode && !process && tabs.length > 0) {
          // 처음 여는 탭은 첫 공정이다. 주소를 첫 공정으로 바꾸고(뒤로 가기 기록은 남기지 않는다) 그 공정으로 다시 불러온다.
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('process', tabs[0].processCode);
              return next;
            },
            { replace: true },
          );
          return;
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
    tabsMode,
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
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      });
    },
    [setParams],
  );

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

  const emptyText = latestOnly
    ? candidateSearch.latestEmpty
    : region || industry
      ? listFilters.filteredEmpty
      : stage || filter || q || opinion
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
        // 관심 기업 보기는 공정 탭 없이 전체에서 거르므로 켤 때 공정 조건을 뺀다. 끌 때는 의견 거르기도 같이 뺀다.
        onBookmarked={(on) =>
          update(on ? { bookmarked: 'true', process: null } : { bookmarked: null, opinion: null })
        }
        onOpinion={(value) => update({ opinion: value })}
        onClearFilter={() => update({ filter: null })}
      />
      {menu ? (
        <ListFilterBar
          processCounts={menu.processCounts ?? []}
          showTabs={tabsMode}
          process={process}
          region={region}
          industry={industry}
          regionCounts={menu.regionCounts ?? []}
          industryCounts={menu.industryCounts ?? []}
          // 탭을 바꾸면 지역·산업은 전체로 돌린다(선택지 건수가 공정 탭마다 달라서).
          onProcess={(code) => update({ process: code, region: null, industry: null })}
          onRegion={(value) => update({ region: value })}
          onIndustry={(value) => update({ industry: value })}
        />
      ) : null}
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
