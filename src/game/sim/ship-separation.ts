import { clampSim } from './coords';
import { shipClearRadius } from './pathfinding';
import type { Ship } from './types';

const PASSES = 3;

/** Push overlapping hulls apart. Does not use the player's position. */
export function separateShips(ships: readonly Ship[]): Ship[] {
  const next = ships.map((ship) => ({ ...ship }));
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < next.length; i++) {
      const a = next[i]!;
      if (a.sinking !== undefined) continue;
      const ra = shipClearRadius(a.kind);
      for (let j = i + 1; j < next.length; j++) {
        const b = next[j]!;
        if (b.sinking !== undefined) continue;
        const min = ra + shipClearRadius(b.kind) + 0.2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= min) continue;
        let nx: number;
        let ny: number;
        if (dist < 1e-4) {
          const angle = i * 2.399963;
          nx = Math.cos(angle);
          ny = Math.sin(angle);
        } else {
          nx = dx / dist;
          ny = dy / dist;
        }
        const push = (min - Math.max(dist, 1e-4)) * 0.5;
        a.x = clampSim(a.x - nx * push);
        a.y = clampSim(a.y - ny * push);
        b.x = clampSim(b.x + nx * push);
        b.y = clampSim(b.y + ny * push);
      }
    }
  }
  return next;
}
