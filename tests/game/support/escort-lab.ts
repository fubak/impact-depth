import { FIXED_DT } from '../../../src/core/sim';
import { createGame, startMission, updateGame } from '../../../src/game/sim/api';
import { SINK_DURATION } from '../../../src/game/sim/ship-damage';
import { shipMaxSpeed } from '../../../src/game/sim/sonar';
import type { GameState, Ship, Torpedo } from '../../../src/game/sim/types';

export { FIXED_DT, shipMaxSpeed };

export function shipFixture(partial: Partial<Ship> = {}): Ship {
  return {
    id: 'escort-1',
    kind: 'destroyer',
    name: 'TEST ESCORT',
    x: 60,
    y: 60,
    heading: 0,
    speed: 1,
    hp: 120,
    maxHp: 120,
    flooding: 0,
    fire: 0,
    speedFactor: 1,
    sinkDuration: SINK_DURATION.destroyer,
    listSide: 1,
    alert: 0,
    holdContact: 0,
    weaponCooldown: 999,
    patrolIndex: 0,
    path: [],
    repathTimer: 0,
    ...partial,
  };
}

/** A mission state reduced to exactly the ships the test cares about. */
export function lab(
  ships: Ship[],
  sub: Partial<GameState['submarine']> = {},
  seed = 19,
): GameState {
  const base = startMission(createGame(seed));
  return {
    ...base,
    sonarPing: 0,
    sonarCooldown: 0,
    aircraft: [],
    aircraftCooldown: 9999,
    depthCharges: [],
    torpedoes: [],
    shells: [],
    countermeasures: [],
    base: { ...base.base, x: -500, y: -500 },
    autopilot: { ...base.autopilot, enabled: false, tactic: 'manual' },
    submarine: {
      ...base.submarine,
      x: 60,
      y: 60,
      z: 0.4,
      targetDepth: 0.4,
      speed: 0,
      targetSpeed: 0,
      noise: 0.08,
      silentRunning: false,
      snorkel: false,
      scopeUp: false,
      invuln: 0,
      ...sub,
    },
    ships,
  };
}

/** A prosecuting escort that already holds a fresh fix on a boat at (60, 60). */
export function prosecutor(id: string, x: number, y: number, partial: Partial<Ship> = {}): Ship {
  return shipFixture({
    id,
    x,
    y,
    heading: Math.atan2(60 - y, 60 - x),
    doctrine: 'prosecute',
    alert: 0.9,
    holdContact: 3,
    datumX: 60,
    datumY: 60,
    datumVx: 0,
    datumVy: 0,
    lastFixTime: 0,
    weaponCooldown: 0,
    ...partial,
  });
}

export function ship(state: GameState, id: string): Ship {
  const found = state.ships.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ship ${id}`);
  return found;
}

export function stepFor(
  state: GameState,
  seconds: number,
  each?: (next: GameState, index: number) => GameState,
): GameState {
  let current = state;
  const steps = Math.round(seconds / FIXED_DT);
  for (let index = 0; index < steps; index += 1) {
    current = updateGame(current, [], FIXED_DT);
    if (each) current = each(current, index);
  }
  return current;
}

export function playerTorpedo(partial: Partial<Torpedo> = {}): Torpedo {
  return {
    id: 'fish-1',
    owner: 'player',
    kind: 'mk14',
    x: 70,
    y: 60,
    z: 0.02,
    heading: Math.PI,
    speed: 9,
    runSpeed: 9.5,
    lockId: null,
    life: 8,
    armDelay: 0.08,
    damage: 48,
    targetId: null,
    sourceId: 'player',
    turnRate: 2.2,
    run: 0,
    ...partial,
  };
}

export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
