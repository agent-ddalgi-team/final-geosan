// 관심 표시 한 건의 화면 상태(#357). 목록 카드와 상세 화면이 같이 쓴다.
// 서버 응답(source)이 새로 오면 그 값을 따르고, 단추로 바꾼 값·저장 뒤 다시 읽은 값은 같은 응답을 보는 동안만 덮어쓴다.
import { useCallback, useRef, useState } from 'react';
import { readBookmark } from '../../api/bookmark';
import type { BookmarkRecord } from '../../api/types';

export interface BookmarkState {
  bookmark: BookmarkRecord | null;
  /** [관심] 단추로 켜거나 끈 결과(서버가 돌려준 값)를 반영한다. */
  change: (next: BookmarkRecord) => void;
  /** 메모·영업 기록·검토 의견을 저장한 뒤 부른다. 서버가 관심을 켰을 수 있어 관심 값만 다시 읽는다. */
  sync: () => Promise<void>;
}

export function useBookmark(
  oppId: string,
  /** 이 관심 값이 실려 온 서버 응답(카드 한 건 또는 상세). 새 응답이 오면 화면에서 바꾼 값은 버린다. */
  source: object | null,
  initial: BookmarkRecord | null,
): BookmarkState {
  const [local, setLocal] = useState<{
    source: object | null;
    bookmark: BookmarkRecord | null;
  } | null>(null);
  // 늦게 도착한 "다시 읽기"가 그 뒤에 누른 단추 결과를 덮지 않게 순서를 센다.
  const order = useRef(0);
  const bookmark = local && local.source === source ? local.bookmark : initial;

  const change = useCallback(
    (next: BookmarkRecord) => {
      order.current += 1;
      setLocal({ source, bookmark: next });
    },
    [source],
  );

  const sync = useCallback(async () => {
    order.current += 1;
    const mine = order.current;
    try {
      const fresh = await readBookmark(oppId);
      if (order.current === mine) setLocal({ source, bookmark: fresh });
    } catch {
      // 다시 읽지 못하면 지금 표시를 그대로 둔다. 기록 저장 자체는 이미 끝났고, 화면을 새로 열면 서버 값이 보인다.
    }
  }, [oppId, source]);

  return { bookmark, change, sync };
}
