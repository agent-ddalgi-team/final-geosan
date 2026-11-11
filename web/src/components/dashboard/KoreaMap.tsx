// 대한민국 시·도 지도(그림). 시·도 경계와 이름을 보이고, 관심 기업이 있는 시·도는 연한 파랑으로 칠하고 곳수를 적는다.
// 회사 한 곳 한 곳의 정확한 위치(좌표)는 서버가 주지 않으므로 점은 찍지 않는다. 시·도 단위까지만 보인다.
import { useRef, useState } from 'react';
import { PROVINCES } from '../../data/koreaProvinces';
import { colors, statusPalette, typography } from '../../theme/tokens';

const LON0 = 125.9;
const LAT0 = 38.75;
const K = 84;
const CX = Math.cos((36 * Math.PI) / 180);
const VIEW_W = 330;
const VIEW_H = 520;

function project(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * K * CX + 24, (LAT0 - lat) * K + 10];
}

function pathOf(ring: number[][]): string {
  return (
    ring
      .map(([lon, lat], i) => {
        const [x, y] = project(lon, lat);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ') + ' Z'
  );
}

/** 이름이 서로 겹치기 쉬운 작은 시·도는 글자 위치를 조금 옮긴다. */
const LABEL_SHIFT: Record<string, [number, number]> = {
  '11': [0, -1],
  '23': [-9, 3],
  '31': [7, -8],
  '29': [9, 2],
  '25': [-10, 6],
  '24': [-6, 2],
  '22': [4, 0],
  '26': [8, -4],
  '21': [2, 4],
};

const SHAPES = PROVINCES.map((province) => {
  let best: number[][] | null = null;
  let bestArea = -1;
  for (const ring of province.rings) {
    const xs = ring.map(([lon, lat]) => project(lon, lat)[0]);
    const ys = ring.map(([lon, lat]) => project(lon, lat)[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  const xs = (best ?? []).map(([lon, lat]) => project(lon, lat)[0]);
  const ys = (best ?? []).map(([lon, lat]) => project(lon, lat)[1]);
  const [dx, dy] = LABEL_SHIFT[province.code] ?? [0, 0];
  return {
    code: province.code,
    name: province.name,
    d: province.rings.map(pathOf).join(' '),
    small: bestArea < 900,
    lx: (Math.min(...xs) + Math.max(...xs)) / 2 + dx,
    ly: (Math.min(...ys) + Math.max(...ys)) / 2 + dy + 3,
  };
});

/** 점 색 4가지: 관심(파랑) · 진행 중(빨강) · 성사(초록) · 보류·거절(회색). 이름은 점 위에 마우스를 올리면 보인다. */
export type DotTone = 'interest' | 'progress' | 'won' | 'other';

export const DOT_COLORS: Record<DotTone, string> = {
  interest: statusPalette.ask.fg,
  progress: statusPalette.no.fg,
  won: statusPalette.ok.fg,
  other: colors.textSecondary,
};

export interface MapDot {
  id: string;
  name: string;
  lon: number;
  lat: number;
  tone: DotTone;
  /** 점 색의 글자 이름(관심·진행 중…). 색만으로 알리지 않으려고 팝업에 글자로도 적는다. */
  toneLabel: string;
  /** 어느 시·도 시·군인지(예: "충남 당진시"). */
  place: string;
  /** 본사 시·군 가운데에서 이 시·군 가운데까지 직선 거리(km, 반올림). 본사를 모르면 null. */
  distKm: number | null;
}

interface Hover {
  dot: MapDot;
  /** 지도 영역 왼쪽 위 기준 점 위치(px). */
  left: number;
  top: number;
  width: number;
}

const POPUP_WIDTH = 220;

interface Props {
  /** 시·도 코드(예: '34' 충남) → 관심 기업 곳수. 없는 시·도는 칠하지 않는다. */
  counts: Record<string, number>;
  /** 회사 점. 시·군의 가운데 근처에 찍힌다(정확한 주소가 아니다). */
  dots?: MapDot[];
  /** 본사 위치와 "가까운 곳" 반경(km). 주면 점선 원과 본사 표시를 그린다. */
  hq?: { lon: number; lat: number; radiusKm?: number; label: string };
}

/** 지도 1km가 화면 몇 칸인지(위도 방향). 경도 방향도 거의 같아 한 값으로 둥글게 그린다. */
const PX_PER_KM = K / 110.57;

export default function KoreaMap({ counts, dots = [], hq }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  // 점 위에 마우스를 올리거나 키보드로 오면 그 점 위(공간이 없으면 아래)에 작은 팝업을 띄운다.
  const show = (dot: MapDot, target: Element) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect();
    const c = target.getBoundingClientRect();
    setHover({
      dot,
      left: c.left - w.left + c.width / 2,
      top: c.top - w.top,
      width: w.width,
    });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        data-testid="korea-map"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="대한민국 시·도 지도"
        style={{ width: '100%', maxHeight: 520, display: 'block' }}
      >
        {SHAPES.map((shape) => (
          <path
            key={shape.code}
            data-testid={`korea-map-province-${shape.code}`}
            data-has={counts[shape.code] ? 'true' : 'false'}
            d={shape.d}
            fill={counts[shape.code] ? statusPalette.ask.bg : statusPalette.neutral.bg}
            stroke={colors.bgContainer}
            strokeWidth={1.1}
            strokeLinejoin="round"
          />
        ))}
        {SHAPES.map((shape) => {
          const n = counts[shape.code];
          return (
            <text
              key={shape.code}
              x={shape.lx}
              y={shape.ly}
              textAnchor="middle"
              fontSize={shape.small ? 9.5 : 11.5}
              fontWeight={n ? 700 : 500}
              fill={n ? statusPalette.ask.fg : colors.textSecondary}
              style={{ pointerEvents: 'none' }}
            >
              {n ? `${shape.name} ${n}` : shape.name}
            </text>
          );
        })}
        {hq
          ? (() => {
              const [x, y] = project(hq.lon, hq.lat);
              return (
                <g data-testid="korea-map-hq">
                  {hq.radiusKm ? (
                    <circle
                      cx={x}
                      cy={y}
                      r={hq.radiusKm * PX_PER_KM}
                      fill="none"
                      stroke={colors.textSecondary}
                      strokeWidth={1.2}
                      strokeDasharray="4 3"
                      style={{ pointerEvents: 'none' }}
                    />
                  ) : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill={colors.text}
                    stroke={colors.bgContainer}
                    strokeWidth={2}
                  >
                    <title>{hq.label}</title>
                  </circle>
                </g>
              );
            })()
          : null}
        {dots.map((dot) => {
          const [x, y] = project(dot.lon, dot.lat);
          return (
            <circle
              key={dot.id}
              data-testid="korea-map-dot"
              data-tone={dot.tone}
              role="img"
              tabIndex={0}
              aria-label={`${dot.name}, ${dot.place}, ${dot.toneLabel}${
                dot.distKm === null ? '' : `, 본사에서 약 ${dot.distKm}km`
              }`}
              cx={x}
              cy={y}
              r={6.5}
              fill={DOT_COLORS[dot.tone]}
              stroke={colors.bgContainer}
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(event) => show(dot, event.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onFocus={(event) => show(dot, event.currentTarget)}
              onBlur={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hover ? (
        <div
          data-testid="korea-map-popup"
          role="tooltip"
          style={{
            position: 'absolute',
            left: Math.min(
              Math.max(hover.left, POPUP_WIDTH / 2),
              Math.max(POPUP_WIDTH / 2, hover.width - POPUP_WIDTH / 2),
            ),
            top: hover.top,
            width: POPUP_WIDTH,
            maxWidth: '100%',
            boxSizing: 'border-box',
            // 점 위로 띄운다. 위쪽 공간이 모자라면 점 아래로 내린다.
            transform:
              hover.top < 110 ? 'translate(-50%, 22px)' : 'translate(-50%, calc(-100% - 10px))',
            zIndex: 10,
            pointerEvents: 'none',
            background: colors.bgContainer,
            border: `1px solid ${colors.borderSecondary}`,
            borderRadius: 10,
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.16)',
            padding: '8px 12px',
            fontSize: typography.fontSizeSecondary,
            display: 'grid',
            gap: 2,
          }}
        >
          <strong>{hover.dot.name}</strong>
          <span style={{ color: colors.textSecondary }}>위치: {hover.dot.place} 근처</span>
          {hover.dot.distKm === null ? null : (
            <span style={{ color: colors.textSecondary }}>
              본사에서 약 {hover.dot.distKm}km(직선)
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: DOT_COLORS[hover.dot.tone],
                display: 'inline-block',
              }}
            />
            {hover.dot.toneLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
