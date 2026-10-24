// 추천 목록(S1, BR10.1·BR10.7): 순위 순 카드 + 쪽 넘김(20건씩) + 다섯 상태.
// 탭(재접촉)·검색·담기·정렬 변경은 뒤 단위라 만들지 않는다. 정렬은 서버가 정한 순위 그대로다.
import { useCallback, useEffect, useState } from 'react';
import { Pagination } from 'antd';
import { getOpportunities } from '../api/client';
import type { Meta, OpportunityCard as CardData } from '../api/types';
import FiveStates from '../components/common/FiveStates';
import { useFrame } from '../components/frame/FrameContext';
import OpportunityCard from '../components/list/OpportunityCard';
import { pagination, states } from '../labels/ko';
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
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = `${page}:${reload}`;

  useEffect(() => {
    const controller = new AbortController();
    getOpportunities(page, PAGE_SIZE, controller.signal)
      .then((envelope) => {
        setResult({ key: requestKey, items: envelope.data, meta: envelope.meta });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error });
      });
    return () => controller.abort();
  }, [page, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const meta = current?.meta ?? null;

  // 띠(가상 데이터·거산 확인 전·갱신 시각)는 목록 응답의 meta를 따른다.
  useEffect(() => {
    if (!meta) return undefined;
    setBannerMeta(meta);
    return () => setBannerMeta(null);
  }, [meta, setBannerMeta]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  const items = current?.items ?? [];
  const total = meta?.total ?? items.length;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = from + items.length - 1;
  const notEvaluated = meta?.notEvaluatedCount ?? 0;

  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  if (!current) state = 'loading';
  else if (current.error) state = 'error';
  else if (items.length === 0) state = 'empty';

  return (
    <FiveStates
      state={state}
      emptyText={states.listEmpty}
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
            <OpportunityCard card={card} classificationOverrides={config?.classificationLabels} />
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
              onChange={setPage}
            />
          ) : null}
        </div>
      ) : null}
    </FiveStates>
  );
}
