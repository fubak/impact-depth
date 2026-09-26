import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { blastDamage } from '../../src/game/sim/blast';
import type { DepthCharge, GameState } from '../../src/game/sim/types';
import { getTerrain, isCrushedBySeamount, isLand } from '../../src/game/sim/world';

describe('blastDamage', () => {
  it('ignores a depth miss that the old map-unit radius would have called a hit', () => {
    // horizontal 0 used to deal full damage whenever |depth| <= radius (1.8).
    expect(
      blastDamage({ damage: 30, horizontal: 0, radius: 1.8, depthDelta: 0.93, vertical: 0.22 }),
    ).toBe(0);
  });

  it('deals full damage when the charge is on the boat in both axes', () => {
    expect(
      blastDamage({ damage: 30, horizontal: 0, radius: 1.8, depthDelta: 0, vertical: 0.22 }),
    ).toBe(30);
  });

  it('is a dud exactly at the horizontal radius', () => {
    expect(
      blastDamage({ damage: 30, horizontal: 1.8, radius: 1.8, depthDelta: 0, vertical: 0.22 }),
    ).toBe(0);
  });

  it('falls off linearly on both axes', () => {
    expect(
      blastDamage({
        damage: 30,
        horizontal: 0.9,
        radius: 1.8,
        depthDelta: 0.11,
        vertical: 0.22,
      }),
    ).toBe(30 * 0.5 * 0.5);
  });
});

/** Open water where a 0.95 boat is not crushed, so a dud charge cannot hide behind seabed damage. */
function safeDeepCell(state: GameState): { x: number; y: number } {
  const terrain = getTerrain(state.terrainSeed);
  const clear = (x: number, y: number) =>
    x > 2 &&
    y > 2 &&
    x < 120 &&
    y < 120 &&
    !isLand(terrain, x, y) &&
    !isCrushedBySeamount(terrain, x, y, 0.95) &&
    Math.hypot(x - state.base.x, y - state.base.y) > state.base.radius;
  if (clear(state.submarine.x, state.submarine.y)) {
    return { x: state.submarine.x, y: state.submarine.y };
  }
  for (let y = 4; y < 120; y += 2) {
    for (let x = 4; x < 120; x += 2) {
      if (clear(x, y)) return { x, y };
    }
  }
  throw new Error('no uncrushed water for the blast integration');
}

function chargeOnBoat(state: GameState, z: number): GameState {
  const cell = safeDeepCell(state);
  const charge: DepthCharge = {
    id: 'charge-test',
    kind: 'bomb',
    sourceId: 'test',
    x: cell.x,
    y: cell.y,
    z: 0.05,
    vz: 0,
    fuse: 0,
    damage: 30,
    radius: 1.8,
    targetDepth: 0.02,
  };
  return {
    ...state,
    ships: [],
    torpedoes: [],
    aircraft: [],
    powerups: [],
    countermeasures: [],
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      x: cell.x,
      y: cell.y,
      z,
      targetDepth: z,
      speed: 0,
      targetSpeed: 0,
      hp: 100,
      maxHp: 100,
      hullTier: 0,
      sysFlood: 0,
      invuln: 0,
    },
    depthCharges: [charge],
  };
}

describe('depth-charge vertical window', () => {
  it('a bomb on the boat misses a deep hull and hurts a hull at the charge depth', () => {
    const mission = startMission(createGame(3));
    const deep = updateGame(chargeOnBoat(mission, 0.95), [], FIXED_DT);
    expect(deep.submarine.hp).toBe(100);
    const shallow = updateGame(chargeOnBoat(mission, 0.02), [], FIXED_DT);
    expect(shallow.submarine.hp).toBeLessThan(100);
  });
});
