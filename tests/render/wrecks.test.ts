import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '../../src/game/adapt/combat-events';
import {
  WRECK_LIFE_S,
  advanceWrecks,
  sinkingPose,
  wreckPose,
} from '../../src/render/presentation/wrecks';

const sunk: CombatEvent = {
  type: 'shipSunk',
  id: 'freighter-1',
  kind: 'merchant',
  x: 10,
  y: 12,
  sinkStyle: 'bow',
  listSide: -1,
};

describe('presentation wrecks', () => {
  it('lists and sinks for six seconds, then leaves the sim ship list alone', () => {
    let wrecks = advanceWrecks([], [sunk], 0);
    expect(wrecks).toHaveLength(1);
    wrecks = advanceWrecks(wrecks, [], 6);
    expect(wrecks).toHaveLength(0);
    const simShips = [{ id: 'other' }];
    expect(simShips.some((ship) => ship.id === sunk.id)).toBe(false);
  });

  it('adopts the hull at its final sinking pose with no visual pop', () => {
    // The live hull reaches sinkingPose(1) the step it is removed; the wreck
    // must start from exactly that pose so the mesh swap is invisible.
    const handoff = sinkingPose(1, 'bow', -1, 'merchant');
    const wreck = wreckPose(0, 'merchant', 'bow', -1);
    expect(wreck.sink).toBeCloseTo(handoff.sink);
    expect(wreck.list).toBeCloseTo(handoff.list);
    expect(wreck.pitch).toBeCloseTo(handoff.pitch);
  });

  it('keeps settling below the surface, submarines deepest', () => {
    const early = wreckPose(0.5, 'merchant', 'bow', 1);
    const late = wreckPose(WRECK_LIFE_S - 0.1, 'merchant', 'bow', 1);
    expect(late.sink).toBeGreaterThan(early.sink);
    const sub = wreckPose(3, 'sub');
    expect(sub.sink).toBeGreaterThan(wreckPose(3, 'merchant', 'bow', 1).sink);
    expect(sub.pitch).toBeGreaterThan(0);
  });

  it('heels onto the struck side as a capsize progresses', () => {
    const pose = sinkingPose(1, 'list', -1, 'merchant');
    expect(pose.list).toBeLessThan(-1); // roll toward listSide
    expect(pose.sink).toBeGreaterThan(0);
  });
});
