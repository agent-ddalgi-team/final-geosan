// 공정별 묶음 보기(#383, 2026-11-07 PM 결정)의 묶음 요청.
// 공정을 고르기 전에는 서버가 준 공정 선택지 가운데 회사가 1곳 이상인 공정마다 지금의 목록 요청을
// `process=<코드>`만 바꿔 따로 부른다(같은 지역·산업·"이번 수집만" 조건, 1쪽, 50곳). 서버 응답 모양은 그대로다.
// 묶음 하나가 실패해도 다른 묶음은 보이고, [다시 시도]는 그 묶음만 다시 부른다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOpportunities } from '../../api/client';
import type { ListFilters } from '../../api/client';
import type { Meta, OpportunityCard } from '../../api/types';

/** 묶음 하나에 담는 상한. 약속의 `pageSize` 최대값(50)이다. 넘치면 묶음 끝에 "이 공정만 보기"로 넘긴다. */
export const GROUP_PAGE_SIZE = 50;

export interface ProcessGroupResult {
  items?: OpportunityCard[];
  meta?: Meta;
  error?: unknown;
}

interface Stored extends ProcessGroupResult {
  key: string;
}

export interface ProcessGroups {
  /** 아직 응답이 없으면(불러오는 중) undefined. */
  resultFor: (code: string) => ProcessGroupResult | undefined;
  /** 그 묶음만 다시 부른다. */
  retry: (code: string) => void;
}

/**
 * @param codes 묶음으로 보일 공정 코드(회사가 1곳 이상인 공정). 비어 있으면 아무것도 부르지 않는다.
 * @param filters 공정을 뺀 나머지 조건(지역·산업·이번 수집만). 묶음마다 `process`만 더해 보낸다.
 * @param version 부모 목록이 다시 불러올 때마다 올라가는 번호. 바뀌면 모든 묶음을 다시 부른다.
 */
export function useProcessGroups(
  codes: string[],
  filters: ListFilters,
  version: number,
): ProcessGroups {
  const [results, setResults] = useState<Record<string, Stored>>({});
  const [reloads, setReloads] = useState<Record<string, number>>({});
  // 효과 안에서 최신 결과를 읽되 결과가 바뀔 때마다 아래 요청 효과가 다시 돌지 않게 참조로 둔다.
  // (요청 효과보다 먼저 적어 두어, 같은 그리기 뒤에 이 참조가 먼저 새 값이 된다.)
  const resultsRef = useRef(results);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  // 배열·객체가 매번 새로 만들어져도 내용이 같으면 다시 부르지 않도록 글자 키로 바꿔 견준다.
  const filtersKey = JSON.stringify(filters);
  const codesKey = codes.join(',');
  const stableFilters = useMemo(() => JSON.parse(filtersKey) as ListFilters, [filtersKey]);
  const stableCodes = useMemo(() => (codesKey ? codesKey.split(',') : []), [codesKey]);
  const keyFor = useCallback(
    (code: string) => `${code}|${filtersKey}|${version}|${reloads[code] ?? 0}`,
    [filtersKey, version, reloads],
  );

  useEffect(() => {
    if (stableCodes.length === 0) return undefined;
    const controller = new AbortController();
    for (const code of stableCodes) {
      const key = keyFor(code);
      // 같은 조건으로 이미 받은(또는 실패한) 묶음은 다시 부르지 않는다. [다시 시도]는 번호를 올려 키를 바꾼다.
      if (resultsRef.current[code]?.key === key) continue;
      getOpportunities(1, GROUP_PAGE_SIZE, controller.signal, { ...stableFilters, process: code })
        .then((envelope) => {
          if (controller.signal.aborted) return;
          setResults((prev) => ({
            ...prev,
            [code]: { key, items: envelope.data, meta: envelope.meta },
          }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setResults((prev) => ({ ...prev, [code]: { key, error } }));
        });
    }
    return () => controller.abort();
  }, [stableCodes, stableFilters, keyFor]);

  const resultFor = useCallback(
    (code: string) => {
      const stored = results[code];
      return stored && stored.key === keyFor(code) ? stored : undefined;
    },
    [results, keyFor],
  );

  const retry = useCallback((code: string) => {
    setReloads((prev) => ({ ...prev, [code]: (prev[code] ?? 0) + 1 }));
  }, []);

  return { resultFor, retry };
}
