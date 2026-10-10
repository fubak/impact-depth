import { describe, expect, it } from 'vitest';
import { createGame, startMission } from '../../../src/game/sim/api';
import { ORDNANCE_DODGE_RANGE, ordnanceDodgeGoal } from '../../../src/game/sim/autopilot';
import type { DepthCharge, GameState } from '../../../src/game/sim/types';

function charge(x: number, y: number, kind: DepthCharge['kind'] = 'hedgehog'): DepthCharge {
  return {
    id: `c-${x}-${y}`,
    kind,
    sourceId: 'escort',
    x,
    y,
    z: 0.1,
    vx: 0,
    vy: 0,
    vz: 0.2,
    fuse: 5,
    damage: 34,
    radius: 0.18,
    targetDepth: 0.45,
  };
}

function withCharges(charges: DepthCharge[]): GameState {
  const state = startMission(createGame(19));
  return { ...state, depthCharges: charges };
}

describe('exfil ordnance dodge', () => {
  it('does nothing without charges in the water', () => {
    expect(ordnanceDodgeGoal(withCharges([]))).toBeNull();
  });

  it('ignores charges beyond the dodge range, shells and bombs', () => {
    const s = withCharges([]);
    const { x, y } = s.submarine;
    const far = withCharges([charge(x + ORDNANCE_DODGE_RANGE + 1, y)]);
    const shell = withCharges([charge(x + 2, y, 'shell')]);
    expect(ordnanceDodgeGoal(far)).toBeNull();
    expect(ordnanceDodgeGoal(shell)).toBeNull();
  });

  it('runs directly away from a pattern ahead of the boat', () => {
    const s = withCharges([]);
    const { x, y } = s.submarine;
    const goal = ordnanceDodgeGoal(withCharges([charge(x + 3, y), charge(x + 3, y + 0.5)]))!;
    expect(goal.x).toBeLessThan(x);
  });

  it('goes abeam when the pattern is on top of the boat', () => {
    const s = withCharges([]);
    const { x, y, heading } = s.submarine;
    const goal = ordnanceDodgeGoal(withCharges([charge(x, y)]))!;
    const along = (goal.x - x) * Math.cos(heading) + (goal.y - y) * Math.sin(heading);
    const across = -(goal.x - x) * Math.sin(heading) + (goal.y - y) * Math.cos(heading);
    expect(Math.abs(across)).toBeGreaterThan(Math.abs(along));
  });
});
