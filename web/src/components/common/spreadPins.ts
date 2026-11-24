// 겹치는 지도 핀 펼치기(#898, PM 요청 2026-11-23 "겹치지 않고 여러 개가 있어도 클릭할 수 있게").
// 화면 위치(px 또는 그림 단위)에서 서로 gap보다 가까운 핀들을 한 묶음으로 보고, 묶음 가운데를 중심으로
// 고리 모양으로 gap 간격을 두고 다시 놓는다. 같은 주소(같은 좌표) 회사가 여럿이어도 하나씩 누를 수 있다.
// fixed(거산 본사)는 움직이지 않고, 그 둘레에 다른 핀을 놓는다. 좌표만 다루고 회사 정보는 모른다.

export interface PinSpot {
  x: number;
  y: number;
  /** 움직이지 않는 핀(거산 본사). */
  fixed?: boolean;
}

export interface Placed {
  x: number;
  y: number;
}

const EPS = 0.5;

function clusters(spots: Placed[], gap: number): number[][] {
  const parent = spots.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      if (Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) < gap - EPS) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, number[]>();
  spots.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  return [...groups.values()];
}

/**
 * 가운데를 기준으로 count개의 자리(가운데에서 본 상대 위치). 가운데가 비어 있고 막힌 칸이 없으면 6개까지는
 * 한 고리에 고르게, 그 밖에는 가운데 → 고리 1, 2…(반지름 ring × gap, 자리 수 ⌊2π·ring⌋ → 옆 자리 사이도 gap 이상).
 * blocked(움직이지 않는 칸)와 gap보다 가까운 자리는 건너뛴다.
 */
function ringSlots(count: number, gap: number, centerTaken: boolean, blocked: Placed[]): Placed[] {
  if (count === 0) return [];
  const free = (slot: Placed) =>
    blocked.every((b) => Math.hypot(slot.x - b.x, slot.y - b.y) >= gap - EPS);
  if (!centerTaken && blocked.length === 0 && count <= 6) {
    if (count === 1) return [{ x: 0, y: 0 }];
    const r = gap / (2 * Math.sin(Math.PI / count));
    return Array.from({ length: count }, (_, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / count;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  const slots: Placed[] = [];
  if (!centerTaken && free({ x: 0, y: 0 })) slots.push({ x: 0, y: 0 });
  for (let ring = 1; slots.length < count && ring < 50; ring += 1) {
    const capacity = Math.floor(2 * Math.PI * ring);
    for (let k = 0; k < capacity && slots.length < count; k += 1) {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / capacity;
      const slot = { x: ring * gap * Math.cos(a), y: ring * gap * Math.sin(a) };
      if (free(slot)) slots.push(slot);
    }
  }
  return slots;
}

function layoutOnce(spots: PinSpot[], current: Placed[], gap: number): Placed[] {
  const next = current.map((p) => ({ ...p }));
  for (const group of clusters(current, gap)) {
    if (group.length < 2) continue;
    const fixed = group.filter((i) => spots[i].fixed);
    const movable = group.filter((i) => !spots[i].fixed);
    if (movable.length === 0) continue;
    const center =
      fixed.length > 0
        ? current[fixed[0]]
        : {
            x: group.reduce((sum, i) => sum + current[i].x, 0) / group.length,
            y: group.reduce((sum, i) => sum + current[i].y, 0) / group.length,
          };
    // 원래 방향을 되도록 지키게 가운데에서 본 각도 순으로 자리를 나눈다(같으면 원래 순서).
    const ordered = [...movable].sort((a, b) => {
      const angle = (i: number) => Math.atan2(current[i].y - center.y, current[i].x - center.x);
      return angle(a) - angle(b) || a - b;
    });
    // 움직이지 않는 칸(이 묶음 밖의 것도)은 피해서 놓는다.
    const blocked = spots
      .map((spot, i) => ({ spot, i }))
      .filter(({ spot, i }) => spot.fixed && (fixed.length === 0 || i !== fixed[0]))
      .map(({ i }) => ({ x: current[i].x - center.x, y: current[i].y - center.y }));
    const slots = ringSlots(ordered.length, gap, fixed.length > 0, blocked);
    ordered.forEach((i, k) => {
      next[i] = { x: center.x + slots[k].x, y: center.y + slots[k].y };
    });
  }
  return next;
}

/** 핀 자리를 돌려준다(입력 순서 그대로). 펼친 묶음이 이웃과 새로 겹치면 몇 번 더 펼친다. */
export function spreadPins(spots: PinSpot[], gap: number): Placed[] {
  let current: Placed[] = spots.map(({ x, y }) => ({ x, y }));
  for (let round = 0; round < 8; round += 1) {
    const next = layoutOnce(spots, current, gap);
    const moved = next.some((p, i) => Math.hypot(p.x - current[i].x, p.y - current[i].y) > EPS);
    current = next;
    if (!moved) break;
  }
  return current;
}
