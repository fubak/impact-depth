import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../../src/game/adapt/combat-events';
import { advanceWrecks, wreckPose } from '../../src/render/presentation/wrecks';

const sunk: CombatEvent = { type: 'shipSunk', id: 'freighter-1', kind: 'merchant', x: 10, y: 12 };

describe('presentation wrecks', () => {
  it('lists and sinks for six seconds, then leaves the sim ship list alone', () => {
    let wrecks = advanceWrecks([], [sunk], 0);
    expect(wrecks).toHaveLength(1);
    wrecks = advanceWrecks(wrecks, [], 6);
    expect(wrecks).toHaveLength(0);
    const mid = wreckPose(3);
    expect(mid.list).toBeCloseTo(0.2);
    expect(mid.sink).toBeCloseTo(4);
    const sub = wreckPose(3, 'sub');
    expect(sub.sink).toBeGreaterThan(mid.sink);
    expect(sub.pitch).toBeGreaterThan(0);
    const simShips = [{ id: 'other' }];
    expect(simShips.some((ship) => ship.id === sunk.id)).toBe(false);
  });
});
