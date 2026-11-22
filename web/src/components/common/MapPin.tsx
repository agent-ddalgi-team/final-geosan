// 지도 핀(#898). PM 요청 2026-11-23: 회사는 작은 색 점으로만 구분(그림 없음), 거산 본사만 집 모양.
// 관심 = 빨간 점, 진행 중 = 파란 점, 올해 성공 = 노란 점, 거산 본사 = 초록 핀 안 흰 집. 색은 theme/tokens의 mapPinPalette만 쓴다.
// 같은 모양을 세 곳에서 쓴다: 네이버 지도 표시(HTML 문자열, pinHtml), 키 없을 때의 자리표시 지도(SVG 안 MapPinMark),
// 범례(MapPinIcon). 핀에는 회사 정보가 없다(모양·색만, 계약 C4 screenMapRule).
import { mapPinPalette, type MapPinKind } from '../../theme/tokens';

/** 거산 본사 집 그림(24×24 칸 기준). */
const HOUSE = 'M4.5 11.4 12 4.8l7.5 6.6V19.5h-5v-4.8h-5v4.8h-5Z';
const HOUSE_TRANSFORM = 'translate(6 6) scale(0.8333)';

/** 시험·범례에서 읽는 모양 이름: 본사는 house, 회사는 dot. */
export function pinShapeName(kind: MapPinKind): 'house' | 'dot' {
  return kind === 'HQ' ? 'house' : 'dot';
}

/** 32×32 칸 안의 모양(SVG 조각 문자열). 점은 흰 테두리로 지도 위에서 또렷하게. */
function shapeSvg(kind: MapPinKind): string {
  const { bg, icon } = mapPinPalette[kind];
  if (kind === 'HQ') {
    return (
      `<circle cx="16" cy="16" r="14.5" fill="${bg}" stroke="#fff" stroke-width="2"/>` +
      `<path transform="${HOUSE_TRANSFORM}" d="${HOUSE}" fill="${icon}"/>`
    );
  }
  return `<circle cx="16" cy="16" r="12.5" fill="${bg}" stroke="#fff" stroke-width="5"/>`;
}

/** 네이버 지도 표시용 HTML(지름 size px). 옅은 그림자로 지도 위에서 떠 보인다. */
export function pinHtml(kind: MapPinKind, size: number): string {
  return (
    `<div data-pin="${pinShapeName(kind)}" style="width:${size}px;height:${size}px;cursor:pointer;` +
    `filter:drop-shadow(0 1px 2px rgba(0,0,0,0.35))">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">` +
    shapeSvg(kind) +
    `</svg></div>`
  );
}

function Shape({ kind, legend = false }: { kind: MapPinKind; legend?: boolean }) {
  const { bg, icon } = mapPinPalette[kind];
  if (kind === 'HQ') {
    return (
      <>
        <circle
          cx={16}
          cy={16}
          r={14.5}
          fill={bg}
          stroke={legend ? 'none' : '#fff'}
          strokeWidth={2}
        />
        <path transform={HOUSE_TRANSFORM} d={HOUSE} fill={icon} />
      </>
    );
  }
  return legend ? (
    <circle cx={16} cy={16} r={10} fill={bg} />
  ) : (
    <circle cx={16} cy={16} r={12.5} fill={bg} stroke="#fff" strokeWidth={5} />
  );
}

/** SVG 안에 (x, y)를 가운데로 그리는 핀. 자리표시 지도에서 쓴다. */
export function MapPinMark({
  kind,
  x,
  y,
  size,
}: {
  kind: MapPinKind;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <g
      data-pin={pinShapeName(kind)}
      data-kind={kind}
      transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / 32})`}
    >
      <Shape kind={kind} />
    </g>
  );
}

/** 글 줄 안에 넣는 작은 핀(범례). 글자가 뜻을 함께 말하므로 그림은 숨긴다. */
export function MapPinIcon({ kind, size = 16 }: { kind: MapPinKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      data-pin={pinShapeName(kind)}
      data-kind={kind}
      style={{ verticalAlign: 'middle', flex: 'none' }}
    >
      <Shape kind={kind} legend />
    </svg>
  );
}
