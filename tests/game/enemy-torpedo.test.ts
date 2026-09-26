import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, snapToNavigable, startMission, updateGame } from '../../src/game/sim/api';
import { FOXER_SEDUCE_ODDS, FOXER_SEDUCE_RANGE } from '../../src/game/sim/constants';
import { seduceRoll } from '../../src/game/sim/systems';
import type { GameState, Ship, Torpedo } from '../../src/game/sim/types';

const SIM_CAP = 30;

function angleBetween(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * A loud attack-depth boat so the sub can hear across ~8 units (same side of the layer).
 * Wave-1 subs only shoot when hasContact is true; alert alone is not enough.
 */
function hearingBoat(state: GameState): GameState {
  return {
    ...state,
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      z: 0.4,
      targetDepth: 0.4,
      invuln: 0,
      silentRunning: false,
      speed: state.submarine.maxSpeed,
      targetSpeed: state.submarine.maxSpeed,
      speedOrder: 'flank',
      noise: 1,
    },
  };
}

function placeSub(state: GameState, template: Ship): GameState {
  const boat = state.submarine;
  for (let step = 0; step < 24; step += 1) {
    const theta = (step / 24) * Math.PI * 2;
    const snapped = snapToNavigable(state, {
      x: boat.x + Math.cos(theta) * 8,
      y: boat.y + Math.sin(theta) * 8,
    });
    const distance = Math.hypot(snapped.x - boat.x, snapped.y - boat.y);
    if (distance < 2.5 || distance > 14) continue;
    const ship: Ship = {
      ...template,
      kind: 'sub',
      name: 'U-BOAT',
      x: snapped.x,
      y: snapped.y,
      heading: Math.atan2(boat.y - snapped.y, boat.x - snapped.x),
      speed: 0,
      hp: Math.max(template.hp, 351),
      maxHp: Math.max(template.maxHp, 351),
      alert: 1,
      holdContact: 8,
      weaponCooldown: 0,
      path: [],
      formationAnchorId: null,
      formationRole: null,
      lastKnownX: boat.x,
      lastKnownY: boat.y,
    };
    return { ...state, ships: [ship], aircraft: [], depthCharges: [], torpedoes: [] };
  }
  throw new Error('no water cell about 8 units out for the enemy sub');
}

function untilEnemyTorpedo(state: GameState): { state: GameState; torpedo: Torpedo } {
  const limit = Math.ceil(SIM_CAP / FIXED_DT);
  let next = state;
  for (let index = 0; index < limit; index += 1) {
    next = updateGame(next, [], FIXED_DT);
    const torpedo = next.torpedoes.find((item) => item.kind === 'enemy' && item.owner === 'enemy');
    if (torpedo) return { state: next, torpedo };
  }
  throw new Error('enemy sub did not fire within 30s');
}

function step(state: GameState, seconds: number): GameState {
  const count = Math.round(seconds / FIXED_DT);
  let next = state;
  for (let index = 0; index < count; index += 1) next = updateGame(next, [], FIXED_DT);
  return next;
}

function armedMission(): { state: GameState; torpedo: Torpedo } {
  let state = hearingBoat(startMission(createGame(7)));
  const template = state.ships.find((ship) => ship.kind === 'sub') ?? state.ships[0]!;
  state = placeSub(state, template);
  return untilEnemyTorpedo(state);
}

describe('enemy torpedo homing', () => {
  it('turns an enemy fish toward the boat after the boat leaves the launch bearing', () => {
    const { state, torpedo } = armedMission();
    const launchHeading = torpedo.heading;
    // Park off the bow so "closer than launch heading" is not already zero.
    const parked: GameState = {
      ...state,
      countermeasures: [],
      submarine: {
        ...state.submarine,
        x: torpedo.x + Math.cos(launchHeading + Math.PI / 2) * 10,
        y: torpedo.y + Math.sin(launchHeading + Math.PI / 2) * 10,
        speed: 0,
        targetSpeed: 0,
        speedOrder: 'stop',
      },
    };
    const later = step(parked, 0.45);
    const lived = later.torpedoes.find((item) => item.id === torpedo.id);
    expect(lived).toBeDefined();
    const desired = Math.atan2(later.submarine.y - lived!.y, later.submarine.x - lived!.x);
    expect(angleBetween(lived!.heading, desired)).toBeLessThan(
      angleBetween(launchHeading, desired),
    );
  });

  it('follows the foxer only when this torpedo id loses the seduce roll', () => {
    const { state, torpedo } = armedMission();
    const launchHeading = torpedo.heading;
    const roll = seduceRoll(state.seed, torpedo.id);
    expect(FOXER_SEDUCE_ODDS).toBe(0.7);
    if (roll < FOXER_SEDUCE_ODDS) {
      const foxer = {
        id: 'foxer-seduce',
        kind: 'foxer' as const,
        x: torpedo.x + Math.cos(launchHeading + Math.PI) * 8,
        y: torpedo.y + Math.sin(launchHeading + Math.PI) * 8,
        z: torpedo.z,
        life: 14,
        radius: 3.5,
      };
      expect(Math.hypot(foxer.x - torpedo.x, foxer.y - torpedo.y)).toBeLessThanOrEqual(
        FOXER_SEDUCE_RANGE,
      );
      expect(Math.hypot(foxer.x - state.submarine.x, foxer.y - state.submarine.y)).toBeGreaterThan(
        1,
      );
      const later = step({ ...state, countermeasures: [foxer] }, 0.45);
      const lived = later.torpedoes.find((item) => item.id === torpedo.id);
      expect(lived).toBeDefined();
      const desired = Math.atan2(foxer.y - lived!.y, foxer.x - lived!.x);
      expect(angleBetween(lived!.heading, desired)).toBeLessThan(
        angleBetween(launchHeading, desired),
      );
      return;
    }
    const parked: GameState = {
      ...state,
      countermeasures: [],
      submarine: {
        ...state.submarine,
        x: torpedo.x + Math.cos(launchHeading + Math.PI / 2) * 10,
        y: torpedo.y + Math.sin(launchHeading + Math.PI / 2) * 10,
        speed: 0,
        targetSpeed: 0,
        speedOrder: 'stop',
      },
    };
    const later = step(parked, 0.45);
    const lived = later.torpedoes.find((item) => item.id === torpedo.id);
    expect(lived).toBeDefined();
    const desired = Math.atan2(later.submarine.y - lived!.y, later.submarine.x - lived!.x);
    expect(angleBetween(lived!.heading, desired)).toBeLessThan(
      angleBetween(launchHeading, desired),
    );
  });
});
