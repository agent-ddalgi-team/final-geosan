// 영업 홈 "먼저 볼 후보"(#972 새 디자인, PM 결정 2026-11-27).
// 거래처 후보 목록이 처음 열릴 때와 같은 조건·정렬(추천 순, 관심으로 고른 회사 빼기)로 목록 응답을 한 번 불러
// 맨 위 3곳을 카드로 보인다. 목록 화면의 API 함수(getOpportunities)·카드 타입을 그대로 쓰고 새 서버 경로는 없다.
//   01  회사 이름(누르면 상세)  /  품목 · 확정된 공정  /  추천 근거 한 줄  /  꼬리표 1개
// 이 칸은 곁들이는 칸이다(명세 3장): 못 읽거나 후보가 없으면 오류를 띄우지 않고 이 칸만 그리지 않는다.
// 후보 목록의 오류·빈 상태는 거래처 후보 화면이 보여 준다.
// 가상 회사는 꼬리표 1개와 별도로 "가상 사례" 표시를 늘 붙인다(가상 데이터 표시 규칙).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOpportunities } from '../../api/client';
import type { OpportunityCard } from '../../api/types';
import {
  candidateSearch,
  cardRows,
  contactBuckets,
  dashboardTexts as t,
  listFilters,
  supplyTierLabels,
} from '../../labels/ko';
import { LIST_PATH } from '../../paths';
import { colors, homePalette, radius, spacing, tagPalette, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import StatusTag from '../common/StatusTag';

/** 보이는 후보 수(화면 모양값). */
export const TOP_COUNT = 3;
/** 목록 화면의 기본 조건: 추천 순(근거 상태 묶음 순) + 관심으로 고른 회사 빼기(#675). */
export const TOP_FILTERS = { sort: 'contact', hideBookmarked: 'true' } as const;

interface Loaded {
  items: OpportunityCard[];
  processNames: Record<string, string>;
}

/** 서버가 만든 카드 제목 "회사 · 기회(품목) 이름"을 회사와 품목으로 나눈다. 구분이 없으면 전체가 회사 이름. */
export function splitTitle(title: string): { company: string; item: string | null } {
  const at = title.indexOf(' · ');
  if (at < 0) return { company: title, item: null };
  return { company: title.slice(0, at), item: title.slice(at + 3).trim() || null };
}

/** 꼬리표 1개: 공급망 위치(AI 추정) → 거산에서 거리 → 들어온 날 → 공정 적합도 순으로 처음 있는 것. */
export function topTag(card: OpportunityCard): string | null {
  if (card.supplyTier === 'TIER2_3' || card.supplyTier === 'TIER1') {
    return supplyTierLabels.tag[card.supplyTier];
  }
  if (typeof card.distanceKm === 'number') return listFilters.cardDistance(card.distanceKm);
  const ingestedOn = formatMonthDay(card.ingestedAt);
  if (ingestedOn) return candidateSearch.ingestedOn(ingestedOn);
  if (card.fitLevel) return contactBuckets.fit[card.fitLevel];
  return null;
}

export default function TopCandidates() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getOpportunities(1, TOP_COUNT, controller.signal, TOP_FILTERS)
      .then((envelope) => {
        if (controller.signal.aborted) return;
        setLoaded({
          items: envelope.data.slice(0, TOP_COUNT),
          processNames: Object.fromEntries(
            (envelope.meta.processCounts ?? []).map((row) => [row.processCode, row.processName]),
          ),
        });
      })
      .catch(() => {
        // 못 읽으면 이 칸만 숨긴다(위 설명). 값을 지어내지 않고, 영업 홈 전체를 오류로 만들지 않는다.
        if (!controller.signal.aborted) setLoaded(null);
      });
    return () => controller.abort();
  }, []);

  if (!loaded || loaded.items.length === 0) return null;

  return (
    <section
      aria-labelledby="dashboard-top-title"
      data-testid="dashboard-top"
      style={{
        display: 'grid',
        gap: 14,
        alignContent: 'start',
        boxSizing: 'border-box',
        minWidth: 0,
        background: colors.bgContainer,
        border: `1px solid ${colors.borderSecondary}`,
        borderRadius: radius.card,
        padding: spacing.cardPadding,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <h2 id="dashboard-top-title" style={{ fontSize: typography.fontSizeCardTitle, margin: 0 }}>
          {t.topTitle}
        </h2>
        <span style={{ color: homePalette.muted, fontSize: typography.fontSizeSecondary }}>
          {t.topHint(loaded.items.length)}
        </span>
        <Link
          to={LIST_PATH}
          data-testid="dashboard-top-link"
          style={{ marginLeft: 'auto', fontSize: typography.fontSizeSecondary }}
        >
          {t.topLink}
        </Link>
      </div>
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          // 넓으면 세 칸 나란히, 좁으면 아래로 내려간다.
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {loaded.items.map((card, index) => {
          const { company, item } = splitTitle(card.title);
          // 공정은 확정된 것만(목록 카드의 공정 꼬리표와 같은 규칙, #659). AI가 제안만 한 공정은 적지 않는다.
          const processes = (card.confirmedProcessCodes ?? [])
            .map((code) => loaded.processNames[code])
            .filter((name): name is string => Boolean(name));
          const sub = [item, ...processes].filter(Boolean).join(' · ');
          const tag = topTag(card);
          return (
            <li
              key={card.oppId}
              data-testid="dashboard-top-card"
              style={{
                display: 'grid',
                gap: 6,
                alignContent: 'start',
                justifyItems: 'start',
                minWidth: 0,
                border: `1px solid ${colors.borderSecondary}`,
                borderRadius: radius.card,
                padding: 16,
              }}
            >
              <span
                data-testid="dashboard-top-number"
                aria-hidden="true"
                style={{
                  fontSize: typography.fontSizeSecondary,
                  fontWeight: 700,
                  color: tagPalette.accent.fg,
                  background: tagPalette.accent.bg,
                  borderRadius: radius.tag,
                  padding: '2px 8px',
                }}
              >
                {t.topNumber(index + 1)}
              </span>
              <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <Link
                  to={`${LIST_PATH}/${encodeURIComponent(card.oppId)}`}
                  data-testid="dashboard-top-name"
                  style={{ fontWeight: 600, color: colors.text, overflowWrap: 'anywhere' }}
                >
                  {company}
                </Link>
                {card.isVirtual ? (
                  <StatusTag tone="wait" data-testid="dashboard-top-virtual">
                    {cardRows.virtualTag}
                  </StatusTag>
                ) : null}
              </span>
              {sub ? (
                <span
                  data-testid="dashboard-top-sub"
                  style={{ color: homePalette.muted, fontSize: typography.fontSizeSecondary }}
                >
                  {sub}
                </span>
              ) : null}
              {card.reason.trim() ? (
                <p
                  data-testid="dashboard-top-reason"
                  title={card.reason}
                  style={{
                    margin: 0,
                    color: colors.textSecondary,
                    fontSize: typography.fontSizeSecondary,
                    // 길면 두 줄까지만(전체 문장은 손을 올리면 보이고, 상세에서 읽는다).
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {card.reason}
                </p>
              ) : null}
              {tag ? (
                <StatusTag tone="ask" data-testid="dashboard-top-tag">
                  {tag}
                </StatusTag>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
