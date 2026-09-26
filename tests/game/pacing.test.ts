import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setDepthOrder,
  setSpeedOrder,
  sonarPulse,
  startMission,
  toggleSilentRunning,
  updateGame,
} from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import type { GameState } from '../../src/game/sim/types';
import { WORLD_CENTER } from '../../src/game/sim/constants';

const SEEDS = [1, 7, 19, 42, 91] as const;

function steps(state: GameState, seconds: number, ping = false): GameState {
  const count = Math.max(1, Math.round(seconds / FIXED_DT));
  let next = state;
  for (let index = 0; index < count; index += 1) {
    if (ping && next.sonarCooldown <= 0 && next.sonarPing <= 0) next = sonarPulse(next);
    next = updateGame(next, [], FIXED_DT);
  }
  return next;
}

function firstAlert(state: GameState, limitSec: number, ping = false): number {
  const count = Math.ceil(limitSec / FIXED_DT);
  let next = state;
  for (let index = 0; index < count; index += 1) {
    if (ping && next.sonarCooldown <= 0 && next.sonarPing <= 0) next = sonarPulse(next);
    next = updateGame(next, [], FIXED_DT);
    if (next.ships.some((ship) => ship.alert > 0.25)) return next.time;
  }
  return -1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Silent one-third cruise, no ping. OD6's passive band — not the stopped-attack pin. */
function passiveCruise(seed: number): GameState {
  return startMission(createGame(seed));
}

function loudBoat(seed: number): GameState {
  let state = setSpeedOrder(startMission(createGame(seed)), 'flank');
  if (state.submarine.silentRunning) state = toggleSilentRunning(state);
  return state;
}

describe('wave escalation', () => {
  it('wave 2 arrives alert and on the outer ring; wave 6 is capped at 0.5', () => {
    const wave2 = seedWave(4, 2);
    expect(wave2.every((ship) => ship.alert === 0.2)).toBe(true);
    for (const ship of wave2) {
      const radius = Math.hypot(ship.x - (WORLD_CENTER + 2), ship.y - WORLD_CENTER);
      expect(radius).toBeGreaterThanOrEqual(30);
      expect(radius).toBeLessThanOrEqual(55);
    }
    expect(seedWave(4, 1).every((ship) => ship.alert === 0)).toBe(true);
    expect(seedWave(4, 6).every((ship) => ship.alert === 0.5)).toBe(true);
  });
});

describe('escort pacing', () => {
  it('detects a passive silent cruise inside the 60–150s band', () => {
    const times = SEEDS.map((seed) => firstAlert(passiveCruise(seed), 160));
    // A hunt that never expands leaves these at -1. OD6 (plan 022): median 60–150s.
    expect(times.every((time) => time > 60)).toBe(true);
    const mid = median(times);
    expect(mid).toBeGreaterThanOrEqual(60);
    expect(mid).toBeLessThanOrEqual(150);
  }, 60_000);

  it('detects a loud flank-and-ping boat within 15s on every pacing seed', () => {
    for (const seed of SEEDS) {
      const time = firstAlert(loudBoat(seed), 15, true);
      expect(time, `seed ${seed}`).toBeGreaterThan(0);
      expect(time, `seed ${seed}`).toBeLessThanOrEqual(15);
    }
  }, 30_000);

  it('a sweep misses a deep silent stop and catches a loud boat at the same range', () => {
    const place = (state: GameState) => {
      const escort = state.ships.find((ship) => ship.kind !== 'merchant' && ship.kind !== 'sub');
      expect(escort).toBeDefined();
      return {
        ...state,
        submarine: { ...state.submarine, speed: 0, targetSpeed: 0 },
        ships: state.ships.map((ship) =>
          ship.id === escort!.id
            ? {
                ...ship,
                x: state.submarine.x + 18,
                y: state.submarine.y,
                alert: 0,
                holdContact: 0,
                lastKnownX: undefined,
                lastKnownY: undefined,
                weaponCooldown: 999,
                path: [],
                formationAnchorId: null,
                speed: 0,
              }
            : { ...ship, x: state.submarine.x - 80, y: state.submarine.y - 80, alert: 0 },
        ),
      };
    };
    const hidden = setSpeedOrder(setDepthOrder(place(startMission(createGame(3))), 'deep'), 'stop');
    expect(hidden.submarine.silentRunning).toBe(true);
    expect(firstAlert(hidden, 20)).toBe(-1);

    let exposed = setSpeedOrder(place(startMission(createGame(3))), 'flank');
    if (exposed.submarine.silentRunning) exposed = toggleSilentRunning(exposed);
    // Hold station so passive hearing cannot close the 18-unit gap. Flank order keeps the sweep loud.
    exposed = {
      ...exposed,
      submarine: { ...exposed.submarine, speed: 0, targetSpeed: 0 },
    };
    const caught = firstAlert(exposed, 8, true);
    expect(caught).toBeGreaterThan(0);
    expect(caught).toBeLessThanOrEqual(8);
  });

  it('spreads an escort fix to a warship inside 30 units and not beyond', () => {
    let state = startMission(createGame(5));
    const hunters = state.ships.filter((ship) => ship.kind !== 'merchant');
    const lead = hunters[0]!;
    const wing = hunters[1] ?? hunters[0]!;
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: 4,
        y: 4,
        z: 0.82,
        targetDepth: 0.82,
        speed: 0,
        targetSpeed: 0,
        silentRunning: true,
        noise: 0.05,
      },
      ships: [
        {
          ...lead,
          x: 40,
          y: 40,
          alert: 0.85,
          holdContact: 4,
          lastKnownX: 10,
          lastKnownY: 10,
          weaponCooldown: 999,
          path: [],
          formationAnchorId: null,
          speed: 0,
        },
        {
          ...wing,
          id: 'wing-far',
          x: 40,
          y: 80,
          alert: 0,
          holdContact: 0,
          lastKnownX: undefined,
          lastKnownY: undefined,
          weaponCooldown: 999,
          path: [],
          formationAnchorId: null,
          speed: 0,
        },
        {
          ...wing,
          id: 'wing-near',
          x: 52,
          y: 40,
          alert: 0,
          holdContact: 0,
          weaponCooldown: 999,
          path: [],
          formationAnchorId: null,
          speed: 0,
        },
      ],
    };
    state = updateGame(state, [], FIXED_DT);
    const near = state.ships.find((ship) => ship.id === 'wing-near')!;
    const far = state.ships.find((ship) => ship.id === 'wing-far')!;
    expect(near.alert).toBeGreaterThanOrEqual(0.24);
    expect(far.alert).toBeLessThan(0.24);
    // The datum stays with the ship that earned it.
    expect(near.lastKnownX).toBeUndefined();
  });

  it('a deep, silent, stopped boat survives 120s on at least 4 of 5 seeds', () => {
    const alive = SEEDS.filter((seed) => {
      let state = setDepthOrder(startMission(createGame(seed)), 'deep');
      state = setSpeedOrder(state, 'stop');
      state = {
        ...state,
        submarine: { ...state.submarine, speed: 0, targetSpeed: 0, silentRunning: true },
      };
      state = steps(state, 120);
      return state.submarine.hp > 0 && state.phase === 'playing';
    });
    expect(alive.length).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
