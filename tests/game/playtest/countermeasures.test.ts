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
    runSpeed: 7.5,
    // Fixtures that exercise homing pre-lock the fish — acquisition is tested separately.
    lockId: 'player',
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
      torpedoes: [incoming(state, origin.x - 0.4, origin.y)],
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
            // Charges now blast from their real depth — put this one on the boat.
            z: state.submarine.z,
            vx: 0,
            vy: 0,
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

  function holdTime(bubble: boolean): number {
    let state = quietOcean(startMission(createGame(6)));
    const escort = state.ships.find((ship) => ship.kind !== 'merchant' && ship.kind !== 'sub');
    expect(escort).toBeDefined();
    const boat = { x: escort!.x + 40, y: escort!.y };
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: boat.x,
        y: boat.y,
        speed: 0,
        targetSpeed: 0,
        silentRunning: true,
        noise: 0.05,
      },
      ships: state.ships.map((ship) =>
        ship.id === escort!.id
          ? {
              ...ship,
              holdContact: 6,
              alert: 0.2,
              weaponCooldown: 999,
              speed: 0,
              path: [],
              formationAnchorId: null,
            }
          : { ...ship, x: boat.x - 80, y: boat.y - 80, speed: 0, holdContact: 0 },
      ),
      countermeasures: bubble
        ? [{ id: 'screen', kind: 'bubble', x: boat.x, y: boat.y, z: 0.5, life: 40, radius: 4.5 }]
        : [],
    };
    let elapsed = 0;
    while (elapsed < 40) {
      const holder = state.ships.find((ship) => ship.id === escort!.id);
      if (!holder || holder.holdContact <= 0) break;
      state = updateGame(state, [], FIXED_DT);
      elapsed += FIXED_DT;
    }
    return elapsed;
  }

  it('a bubble screen breaks escort contact in less than half the open-ocean time', () => {
    const bare = holdTime(false);
    const screened = holdTime(true);
    expect(bare).toBeGreaterThan(5);
    expect(screened).toBeGreaterThan(0);
    expect(screened).toBeLessThan(bare * 0.5);
  });

  function mk18Hits(seed: number, decoy: boolean): boolean {
    let state = quietOcean(startMission(createGame(seed)));
    const boat = state.submarine;
    state = {
      ...state,
      submarine: { ...boat, speed: 0, targetSpeed: 0, targetDepth: boat.z },
      torpedoes: [
        {
          id: 'mk18-shot',
          owner: 'enemy',
          kind: 'mk18',
          sourceId: 'hunter',
          x: boat.x - 14,
          y: boat.y,
          z: boat.z,
          heading: 0,
          speed: 8,
          runSpeed: 8,
          lockId: 'player',
          life: 8,
          armDelay: 0,
          damage: 40,
          targetId: 'player',
          turnRate: 1.6,
          run: 0,
        },
      ],
      countermeasures: decoy
        ? [
            {
              id: 'fox',
              kind: 'foxer',
              x: boat.x - 3,
              y: boat.y + 4.5,
              z: boat.z,
              life: 14,
              radius: 3.5,
            },
          ]
        : [],
    };
    state = step(state, 4);
    return state.submarine.hp < 100;
  }

  it('a decoy cuts Mk-18 hit rate to at most 40 percent across 20 seeds', () => {
    const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
    const withDecoy = seeds.filter((seed) => mk18Hits(seed, true)).length / seeds.length;
    const bare = seeds.filter((seed) => mk18Hits(seed, false)).length / seeds.length;
    // Without the seduction roll the off-track foxer never touches the torpedo.
    expect(bare).toBeGreaterThanOrEqual(0.7);
    expect(withDecoy).toBeLessThanOrEqual(0.4);
    expect(withDecoy).toBeGreaterThan(0);
  }, 30_000);
});
