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
import {
  ESCORT_QUIET_HUNT_AFTER,
  ESCORT_QUIET_SWEEP_GROWTH,
  ESCORT_QUIET_SWEEP_RADIUS,
  WORLD_CENTER,
} from '../../src/game/sim/constants';
import { escortSweepRadius } from '../../src/game/sim/systems';

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

/** Silent one-third cruise, no ping. Quiet sweep is capped, so this is not the old OD6 median. */
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
  it('does not detect every silent cruise through an uncapped quiet sweep', () => {
    const times = SEEDS.map((seed) => firstAlert(passiveCruise(seed), 160));
    // Plan 024 caps quiet sweep growth at 18. Boats that stay outside that
    // radius may never alert. Detections that do happen stay after the opening minute.
    // The loud ≤15s band is the other test. Do not raise ESCORT_QUIET_SWEEP_CAP to restore OD6.
    const detected = times.filter((time) => time > 0);
    expect(detected.length).toBeLessThan(SEEDS.length);
    for (const time of detected) expect(time).toBeGreaterThan(60);
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

  it('caps a late quiet sweep and still hides a deep silent boat', () => {
    const time = 62 + 1000;
    const jitter = 1;
    const grown = Math.max(0, time - ESCORT_QUIET_HUNT_AFTER) * ESCORT_QUIET_SWEEP_GROWTH;
    const uncapped = (ESCORT_QUIET_SWEEP_RADIUS + grown) * jitter;
    expect(uncapped).toBeGreaterThan(18);
    const quiet = {
      ...createGame(1).submarine,
      silentRunning: true,
      speedOrder: 'oneThird' as const,
      z: 0.4,
    };
    expect(escortSweepRadius(quiet, time, jitter, false)).toBeLessThanOrEqual(18 * jitter);
    expect(escortSweepRadius({ ...quiet, z: 0.6 }, time, jitter, false)).toBe(0);
  });
});
