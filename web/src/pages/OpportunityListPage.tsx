// 추천 목록(S1, BR10.1·BR10.7): 공정 탭 + 지역·산업 선택 + 순위 순 카드 + 쪽 넘김(20건씩) + 다섯 상태.
// 조건은 모두 주소(`?process=&region=&industry=`, 대시보드에서 넘어올 때는 `?stage=`·`?filter=`·`?q=`)에 남겨
// 새로 고침·공유해도 유지되고, 서버에 그대로 보낸다. 서버가 순위를 조건 안 번호로 다시 매긴다.
// 대시보드 건수·검색으로 넘어온 목록은 탭 없이 전체(공정 섞임)이다. 재접촉 탭·담기·정렬 변경은 뒤 단위라 만들지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pagination } from 'antd';
import { getOpportunities } from '../api/client';
import type { Meta, OpportunityCard as CardData } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import ListFilterBar from '../components/list/ListFilterBar';
import OpportunityCard from '../components/list/OpportunityCard';
import { listFilters, pagination, states } from '../labels/ko';
import { colors, spacing, typography } from '../theme/tokens';

export const PAGE_SIZE = 20;

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
  // 대시보드 건수·검색으로 넘어온 전체 목록에는 공정 탭이 없다.
  const tabsMode = !stage && !filter && !q;
  const filterKey = [process, region, industry, stage, filter, q].map((v) => v ?? '').join('|');

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
  }, [page, process, region, industry, stage, filter, q, tabsMode, requestKey, setParams]);

  const current = result?.key === requestKey ? result : null;
  const meta = current?.meta ?? null;

  // 띠(가상 데이터·거산 확인 전·갱신 시각)는 목록 응답의 meta를 따른다.
  useEffect(() => {
    if (!meta) return undefined;
    setBannerMeta(meta);
    return () => setBannerMeta(null);
  }, [meta, setBannerMeta]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

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

  const emptyText =
    region || industry
      ? listFilters.filteredEmpty
      : stage || filter || q
        ? listFilters.noMatch
        : states.listEmpty;

  return (
    <>
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
