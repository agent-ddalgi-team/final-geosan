// 겹치는 지도 핀 펼치기(#898). 펼친 뒤 어느 두 핀도 gap보다 가깝지 않은지, 떨어진 핀과 본사는 그대로인지 본다.
import { describe, expect, it } from 'vitest';
import { spreadPins, type PinSpot } from '../spreadPins';

function minDistance(points: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return min;
}

describe('spreadPins', () => {
  it('서로 떨어진 핀은 움직이지 않는다', () => {
    const spots = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(spreadPins(spots, 20)).toEqual(spots);
  });

  it('같은 좌표의 핀 여러 개(같은 주소)를 gap 간격 이상으로 펼친다', () => {
    for (const count of [2, 3, 6, 7, 15]) {
      const spots = Array.from({ length: count }, () => ({ x: 50, y: 50 }));
      const placed = spreadPins(spots, 20);
      expect(placed).toHaveLength(count);
      expect(minDistance(placed)).toBeGreaterThanOrEqual(19.5);
    }
  });

  it('조금씩 겹친 핀 무리도 펼친 뒤에는 겹치지 않는다', () => {
    const spots = [
      { x: 10, y: 10 },
      { x: 14, y: 12 },
      { x: 18, y: 9 },
      { x: 22, y: 15 },
      { x: 200, y: 200 },
      { x: 205, y: 203 },
    ];
    const placed = spreadPins(spots, 20);
    expect(minDistance(placed)).toBeGreaterThanOrEqual(19.5);
  });

  it('거산 본사(fixed)는 그 자리에 두고, 겹친 회사 핀을 그 둘레로 옮긴다', () => {
    const spots: PinSpot[] = [
      { x: 100, y: 100, fixed: true },
      { x: 102, y: 101 },
      { x: 99, y: 98 },
    ];
    const placed = spreadPins(spots, 20);
    expect(placed[0]).toEqual({ x: 100, y: 100 });
    expect(minDistance(placed)).toBeGreaterThanOrEqual(19.5);
  });

  it('움직이지 않는 칸이 여럿(본사 + 이름 자리)이어도 핀끼리·칸과 겹치지 않는다', () => {
    const spots: PinSpot[] = [
      { x: 200, y: 200, fixed: true },
      { x: 186, y: 218, fixed: true },
      { x: 214, y: 218, fixed: true },
      ...Array.from({ length: 9 }, (_, k) => ({ x: 195 + (k % 3) * 4, y: 205 + k })),
      { x: 230, y: 260 },
      { x: 236, y: 262 },
      { x: 240, y: 258 },
    ];
    const placed = spreadPins(spots, 21);
    expect(placed.slice(0, 3)).toEqual(spots.slice(0, 3).map(({ x, y }) => ({ x, y })));
    expect(minDistance(placed)).toBeGreaterThanOrEqual(20.5);
  });
});
