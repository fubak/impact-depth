import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, setSpeedOrder, startMission, updateGame } from '../../src/game/sim/api';
import type { GameState, Ship } from '../../src/game/sim/types';

function tick(state: GameState, seconds: number): GameState {
  let s = state;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) s = updateGame(s, [], FIXED_DT);
  return s;
}

/** Outside FOB, flank so noise recompute stays high, parked next to a hostile. */
function stageNear(
  state: GameState,
  host: Ship,
  opts: { xOff: number; z: number; alert: number; hold: number },
): GameState {
  const next: GameState = {
    ...state,
    base: { ...state.base, x: -200, y: -200 },
    submarine: {
      ...state.submarine,
      x: host.x + opts.xOff,
      y: host.y,
      z: opts.z,
      targetDepth: opts.z,
      silentRunning: false,
      snorkel: false,
      invuln: 0,
      hp: 100,
      speed: state.submarine.maxSpeed,
      targetSpeed: state.submarine.maxSpeed,
      speedOrder: 'flank',
    },
    ships: state.ships.map((s) =>
      s.id === host.id
        ? { ...s, weaponCooldown: 0, alert: opts.alert, holdContact: opts.hold, path: [], speed: 0 }
        : s,
    ),
  };
  return setSpeedOrder(next, 'flank');
}

function sawKind(
  state: GameState,
  host: Ship,
  z: number,
  xOff: number,
  kind: string,
  seconds = 1.2,
): boolean {
  let s = stageNear(state, host, { xOff, z, alert: 0.9, hold: 4 });
  // Extra pin for enemy subs so they cannot close under min launch range.
  if (host.kind === 'sub') {
    s = {
      ...s,
      ships: s.ships.map((ship) =>
        ship.id === host.id
          ? { ...ship, speed: 0, path: [], weaponCooldown: 0, alert: 0.9, holdContact: 4 }
          : ship,
      ),
    };
  }
  const lim = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < lim; i++) {
    s = updateGame(s, [], FIXED_DT);
    if (kind === 'enemy-torp') {
      if (s.torpedoes.some((t) => t.owner === 'enemy')) return true;
    } else if (s.depthCharges.some((d) => d.kind === kind)) {
      return true;
    }
  }
  return false;
}

describe('enemy + sonar live path', () => {
  it('spawns combat units and advances the full SYSTEM_ORDER each frame', () => {
    let state = startMission(createGame(42));
    expect(state.phase).toBe('playing');
    expect(state.ships.some((s) => s.kind === 'merchant')).toBe(true);
    expect(
      state.ships.some(
        (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
      ),
    ).toBe(true);
    expect(state.ships.some((s) => s.kind === 'sub')).toBe(true);
    const tick0 = state.tick;
    state = tick(state, 1);
    expect(state.tick).toBeGreaterThan(tick0);
  });

  it('escort fires hedgehog when it currently detects a submerged boat', () => {
    const state = startMission(createGame(42));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    expect(sawKind(state, escort, 0.3, 2.2, 'hedgehog')).toBe(true);
  });

  it('battleship drops depth charges when it holds contact', () => {
    let state = startMission(createGame(42));
    const template = state.ships[0]!;
    state = {
      ...state,
      ships: [
        {
          ...template,
          id: 'bb-live',
          kind: 'battleship',
          name: 'BB',
          hp: 420,
          maxHp: 420,
          speed: 1.35,
          heading: 0,
          path: [],
        },
      ],
    };
    expect(sawKind(state, state.ships[0]!, 0.32, 2, 'depthCharge')).toBe(true);
  });

  it('enemy sub fires a torpedo in the launch band', () => {
    const state = startMission(createGame(42));
    const enemy = state.ships.find((s) => s.kind === 'sub')!;
    expect(sawKind(state, enemy, 0.35, 8, 'enemy-torp')).toBe(true);
  });

  it('builds passive hydrophone contacts when ships are nearby', () => {
    let state = startMission(createGame(42));
    const ship = state.ships[0]!;
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: ship.x + 4,
        y: ship.y,
        z: 0.28,
        targetDepth: 0.28,
      },
    };
    state = tick(state, 1);
    expect(state.sonarContacts.length).toBeGreaterThan(0);
  });

  it('aircraft drop bombs on a shallow noisy boat', () => {
    let state = startMission(createGame(42));
    state = setSpeedOrder(state, 'flank');
    state = {
      ...state,
      aircraftCooldown: 0,
      aircraft: [
        {
          id: 'a1',
          x: state.submarine.x + 1,
          y: state.submarine.y,
          heading: 0,
          life: 20,
          cooldown: 0,
          active: true,
        },
      ],
      submarine: {
        ...state.submarine,
        z: 0.08,
        targetDepth: 0.08,
        silentRunning: false,
        invuln: 0,
        speed: state.submarine.maxSpeed,
        targetSpeed: state.submarine.maxSpeed,
        speedOrder: 'flank',
      },
    };
    let sawBomb = false;
    for (let i = 0; i < Math.ceil(2 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.depthCharges.some((d) => d.kind === 'bomb')) sawBomb = true;
    }
    expect(sawBomb || state.submarine.hp < 100).toBe(true);
  });

  it('shells fire when the boat is shallow in gun range', () => {
    const state = startMission(createGame(42));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    expect(sawKind(state, escort, 0.1, 3, 'shell')).toBe(true);
  });
});
