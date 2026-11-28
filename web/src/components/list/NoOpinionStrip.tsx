// 관심 기업 화면 맨 위의 "의견 전" 띠(#981, PM 결정 2026-11-28).
// 관심(★)에만 담고 검토 의견을 안 고른 회사가 있으면 몇 곳인지 알리고, [의견 전만 보기]로 그 회사만 거른다.
// "의견 전"의 뜻은 영업 홈의 "의견 전" 칸과 같다: 관심 기업 가운데 검토 의견이 없고 영업 단계도 아직 없는(미접촉) 회사.
// (이미 접촉·견적 단계로 가 있는 회사는 의견을 안 골랐어도 세지 않는다.)
// 곳 수는 목록과 같은 창구(GET /opportunities, 지금 화면의 조건 + filter=NO_OPINION)의 meta.total을 그대로 쓴다(한 줄만 읽음).
// 그래서 영업 홈의 숫자, 이 띠의 숫자, [의견 전만 보기]를 눌렀을 때 나오는 회사 수가 같은 기준이다.
// 읽지 못했거나 0곳이면 아무것도 보이지 않는다(숫자를 지어내지 않는다).
import { useEffect, useState } from 'react';
import { getOpportunities } from '../../api/client';
import type { ListFilters } from '../../api/client';
import { bookmarkList } from '../../labels/ko';
import { opinionNudge, radius, typography } from '../../theme/tokens';

/** 영업 홈 "의견 전" 칸과 같은 조건 이름(목록 창구의 filter 값). */
export const NO_OPINION_FILTER = 'NO_OPINION';

export interface NoOpinionStripProps {
  /** 관심 기업 화면이 목록을 부를 때 쓰는 조건(공정·지역 등). 의견 거르기는 빼고 "의견 전" 조건을 더해 곳 수를 읽는다. */
  filters: ListFilters;
  /** 목록을 다시 읽거나 줄에서 의견을 저장할 때마다 바뀌는 값. 바뀌면 곳 수도 다시 읽는다(의견을 고르면 줄어든다). */
  reloadKey: string;
  /** [의견 전만 보기]: 관심 기업 화면을 "의견 전" 조건(filter=NO_OPINION)으로 거른다. */
  onShowOnly: () => void;
}

export default function NoOpinionStrip({ filters, reloadKey, onShowOnly }: NoOpinionStripProps) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOpportunities(1, 1, controller.signal, {
      ...filters,
      bookmarked: 'true',
      opinion: null,
      filter: NO_OPINION_FILTER,
    })
      .then((envelope) => {
        const total = envelope.meta.total;
        setCount(typeof total === 'number' ? total : null);
      })
      .catch(() => {
        // 알림 띠는 덤이다. 못 읽으면 띠만 숨기고 목록은 그대로 둔다(목록의 오류는 목록이 따로 알린다).
        if (!controller.signal.aborted) setCount(null);
      });
    return () => controller.abort();
    // 조건은 reloadKey에 이미 담겨 있다(조건이 바뀌면 목록 요청 열쇠가 바뀐다). 객체가 새로 만들어질 때마다 다시 읽지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (count === null || count <= 0) return null;
  return (
    <div
      role="status"
      data-testid="no-opinion-strip"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 12px',
        marginBottom: 16,
        padding: '10px 14px',
        border: `1px solid ${opinionNudge.line}`,
        borderRadius: radius.control,
        background: opinionNudge.bg,
        color: opinionNudge.fg,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      <span data-testid="no-opinion-strip-text">{bookmarkList.noOpinionStrip(count)}</span>
      <button
        type="button"
        onClick={onShowOnly}
        data-testid="no-opinion-strip-button"
        style={{
          marginLeft: 'auto',
          minHeight: 32,
          padding: '0 12px',
          border: `1px solid ${opinionNudge.border}`,
          borderRadius: radius.controlSm,
          background: 'transparent',
          color: opinionNudge.fg,
          font: 'inherit',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {bookmarkList.noOpinionShowOnly}
      </button>
    </div>
  );
}
