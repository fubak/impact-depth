import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import {
  createGame,
  deployCountermeasure,
  fireWeapon,
  setWeapon,
  startMission,
  updateGame,
} from '../../../src/game/sim/api';
import type { GameState, Torpedo } from '../../../src/game/sim/types';

const step = (state: GameState, seconds: number) => {
  const ticks = Math.max(1, Math.round(seconds / FIXED_DT));
  let next = state;
  for (let index = 0; index < ticks; index += 1) next = updateGame(next, [], FIXED_DT);
  return next;
};

/** Park escorts so a scripted torpedo is the only threat in the water. */
function quietOcean(state: GameState): GameState {
  return {
    ...state,
    ships: state.ships.map((ship) => ({ ...ship, weaponCooldown: 999, alert: 0 })),
    aircraft: [],
    aircraftCooldown: 999,
    depthCharges: [],
    torpedoes: [],
    countermeasures: [],
    submarine: {
      ...state.submarine,
      speed: 0,
      targetSpeed: 0,
      silentRunning: true,
      invuln: 0,
      hp: 100,
    },
  };
}

function incoming(state: GameState, x: number, y: number): Torpedo {
  return {
    id: 'incoming-1',
    owner: 'enemy',
    kind: 'enemy',
    sourceId: 'hunter',
    x,
    y,
    z: state.submarine.z,
    heading: 0,
    speed: 7.5,
    life: 8,
    armDelay: 0,
    damage: 42,
    targetId: 'player',
    turnRate: 1.1,
    run: 0,
  };
}

describe('playtest countermeasures', () => {
  it('a decoy foxer consumes an enemy torpedo that would otherwise run past', () => {
    let state = quietOcean(startMission(createGame(4)));
    const origin = { x: state.submarine.x, y: state.submarine.y };
    state = fireWeapon(setWeapon(state, 'decoy'));
    const foxer = state.countermeasures.find((cm) => cm.kind === 'foxer');
    expect(foxer).toBeDefined();
    state = {
      ...state,
      submarine: { ...state.submarine, x: origin.x, y: origin.y + 8 },
      torpedoes: [incoming(state, origin.x - 5, origin.y)],
    };
    state = step(state, 2);
    expect(state.torpedoes.some((torpedo) => torpedo.owner === 'enemy')).toBe(false);
    expect(state.submarine.hp).toBe(100);

    let bare = quietOcean(startMission(createGame(4)));
    bare = {
      ...bare,
      submarine: { ...bare.submarine, x: origin.x, y: origin.y + 8 },
      torpedoes: [incoming(bare, origin.x - 5, origin.y)],
    };
    bare = step(bare, 2);
    expect(bare.torpedoes.some((torpedo) => torpedo.id === 'incoming-1')).toBe(true);
    expect(bare.submarine.hp).toBe(100);
  });

  it('an enemy torpedo on the boat track deals hull damage', () => {
    let state = quietOcean(startMission(createGame(4)));
    state = {
      ...state,
      torpedoes: [incoming(state, state.submarine.x - 5, state.submarine.y)],
    };
    state = step(state, 2);
    expect(state.submarine.hp).toBeLessThan(100);
  });

  it('a bubble screen cuts depth-charge damage to three quarters', () => {
    const primed = (bubble: boolean) => {
      let state = quietOcean(startMission(createGame(8)));
      if (bubble) state = deployCountermeasure(state);
      state = {
        ...state,
        submarine: { ...state.submarine, targetDepth: state.submarine.z },
        depthCharges: [
          {
            id: 'charge-1',
            kind: 'depthCharge',
            sourceId: 'escort',
            x: state.submarine.x,
            y: state.submarine.y,
            z: 0.05,
            vz: 0,
            fuse: FIXED_DT / 2,
            damage: 45,
            radius: 2.2,
            targetDepth: state.submarine.z,
          },
        ],
      };
      return updateGame(state, [], FIXED_DT);
    };
    const bare = primed(false);
    const screened = primed(true);
    const bareLoss = 100 - bare.submarine.hp;
    const screenedLoss = 100 - screened.submarine.hp;
    expect(bareLoss).toBeGreaterThan(0);
    expect(screenedLoss).toBeCloseTo(bareLoss * 0.75, 5);
  });
});
