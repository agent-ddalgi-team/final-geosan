// 영업 지역 지도 카드: 관심 기업의 "시·군"(목록 API의 region)을 시·도로 바꿔 칠하고, 그 시·군의 가운데 근처에 회사 점을 찍는다.
// 새 API 없이 이미 있는 목록(`GET /opportunities?bookmarked=true`)만 쓴다. 정확한 주소 좌표는 서버가 주지 않으므로 점은 시·군 가운데 근처다.
// 시·군을 모르는 회사(주소 없음)는 점을 찍지 않고 곳수만 알린다. 불러오지 못하면 지도는 그대로 두고 안내만 보인다.
import { useEffect, useState } from 'react';
import { getOpportunities } from '../../api/client';
import type { OpportunityCard } from '../../api/types';
import { PROVINCES } from '../../data/koreaProvinces';
import { HQ_LABEL, HQ_REGION, distanceKm } from '../../config/nearby';
import { REGION_CENTER } from '../../data/regionCenter';
import { REGION_TO_PROVINCE } from '../../data/regionToProvince';
import { dashboardTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import KoreaMap, { DOT_COLORS } from './KoreaMap';
import type { DotTone, MapDot } from './KoreaMap';

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      counts: Record<string, number>;
      dots: MapDot[];
      total: number;
      placed: number;
      unknown: number;
    };

/** "아산시"처럼 시·군 이름을 시·도 코드로. 모르면 null(주소 없음·이름이 겹치는 구 이름 등). */
export function provinceOf(region: string | null | undefined): string | null {
  if (!region) return null;
  return REGION_TO_PROVINCE[region.trim()] ?? null;
}

/** 영업 결과(저장된 단계) → 점 색. 단계가 없으면 "관심". */
export function toneOf(card: Pick<OpportunityCard, 'records'>): DotTone {
  switch (card.records?.outcome?.status) {
    case 'IN_PROGRESS':
    case 'SAMPLE_OR_REGISTRATION_APPROVED':
      return 'progress';
    case 'WON':
      return 'won';
    case 'ON_HOLD':
    case 'LOST':
      return 'other';
    default:
      return 'interest';
  }
}

const PROVINCE_NAMES = new Map(PROVINCES.map((p) => [p.code, p.name]));

/** 한 시·군에 회사가 여러 곳이면 점이 겹치지 않게 가운데 둘레로 조금씩 벌려 놓는다. */
function spread(cards: Array<{ card: OpportunityCard; center: [number, number] }>): MapDot[] {
  const seen = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const { card } of cards) {
    const key = card.region ?? '';
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return cards.map(({ card, center }) => {
    const key = card.region ?? '';
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const n = sizes.get(key) ?? 1;
    const angle = (2 * Math.PI * index) / n;
    const radius = n > 1 ? 0.07 : 0;
    const tone = toneOf(card);
    const province = PROVINCE_NAMES.get(provinceOf(card.region) ?? '');
    const hqCenter = REGION_CENTER[HQ_REGION];
    return {
      id: card.oppId,
      name: card.title.split(' · ')[0],
      lon: center[0] + radius * Math.cos(angle),
      lat: center[1] + radius * Math.sin(angle),
      tone,
      toneLabel: TONE_LABEL[tone],
      place: [province, card.region?.trim()].filter(Boolean).join(' '),
      distKm: hqCenter ? Math.round(distanceKm(hqCenter, center)) : null,
    };
  });
}

const TONE_LABEL: Record<DotTone, string> = {
  interest: dashboardTexts.mapLegendInterest,
  progress: dashboardTexts.mapLegendProgress,
  won: dashboardTexts.mapLegendWon,
  other: dashboardTexts.mapLegendOther,
};

const LEGEND = (Object.keys(TONE_LABEL) as DotTone[]).map((tone): [DotTone, string] => [
  tone,
  TONE_LABEL[tone],
]);

export default function KoreaMapCard() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    // 서버가 한 번에 주는 최대는 50곳이다(그보다 크게 요청하면 400).
    getOpportunities(1, 50, controller.signal, { bookmarked: 'true' })
      .then((envelope) => {
        if (controller.signal.aborted) return;
        const counts: Record<string, number> = {};
        const located: Array<{ card: OpportunityCard; center: [number, number] }> = [];
        let unknown = 0;
        for (const card of envelope.data) {
          const center = card.region ? REGION_CENTER[card.region.trim()] : undefined;
          if (!center) {
            unknown += 1;
            continue;
          }
          // 거리와 상관없이 위치(시·군)를 아는 회사는 모두 보인다. 본사와의 거리는 점 팝업에 적는다.
          const code = provinceOf(card.region);
          if (code) counts[code] = (counts[code] ?? 0) + 1;
          located.push({ card, center });
        }
        setState({
          kind: 'ready',
          counts,
          dots: spread(located),
          total: envelope.data.length,
          placed: located.length,
          unknown,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  const counts = state.kind === 'ready' ? state.counts : {};
  const dots = state.kind === 'ready' ? state.dots : [];
  const names = new Map(PROVINCES.map((p) => [p.code, p.name]));
  const listed = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${names.get(code) ?? code} ${n}곳`);
  const noteStyle = {
    margin: '8px 0 0',
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;

  return (
    <div data-testid="korea-map-card">
      <KoreaMap
        counts={counts}
        dots={dots}
        hq={
          REGION_CENTER[HQ_REGION]
            ? {
                lon: REGION_CENTER[HQ_REGION][0],
                lat: REGION_CENTER[HQ_REGION][1],
                label: HQ_LABEL,
              }
            : undefined
        }
      />
      <ul
        data-testid="korea-map-legend"
        style={{
          listStyle: 'none',
          margin: '8px 0 0',
          padding: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: typography.fontSizeSecondary,
        }}
      >
        <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: colors.text,
              display: 'inline-block',
            }}
          />
          {dashboardTexts.mapLegendHq}
        </li>
        {LEGEND.map(([tone, label]) => (
          <li key={tone} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: DOT_COLORS[tone],
                display: 'inline-block',
              }}
            />
            {label}
            {state.kind === 'ready' ? ` ${dots.filter((d) => d.tone === tone).length}` : ''}
          </li>
        ))}
      </ul>
      <p data-testid="korea-map-note" style={noteStyle}>
        {state.kind === 'loading' ? dashboardTexts.mapLoading : null}
        {state.kind === 'error' ? dashboardTexts.mapError : null}
        {state.kind === 'ready'
          ? state.total === 0
            ? dashboardTexts.mapNoBookmark
            : `${dashboardTexts.mapSummary(state.total, state.placed, state.unknown)}${
                listed.length ? ` · ${listed.join(', ')}` : ''
              }`
          : null}
      </p>
    </div>
  );
}
