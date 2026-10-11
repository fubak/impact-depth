import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, fireBroadside, startMission } from '../../src/game/sim/api';
import { advanceOrdnance } from '../../src/game/sim/ordnance-physics';
import { SINK_DURATION } from '../../src/game/sim/ship-damage';
import { stepGame } from '../../src/game/sim/step';
import {
  BROADSIDE_SALVO,
  DAMAGE_PER_CHARGE,
  KILL_CHARGE,
  ULTIMATE_MAX,
  accrueUltimate,
  broadsideTargets,
  chargeFor,
  isBroadsideReady,
} from '../../src/game/sim/ultimate';
import type { GameState, Ship, ShipKind, Torpedo } from '../../src/game/sim/types';

const SUB_X = 60;
const SUB_Y = 60;

function ship(id: string, kind: ShipKind, dx: number, dy: number, partial: Partial<Ship> = {}): Ship {
  return {
    id,
    kind,
    name: id.toUpperCase(),
    x: SUB_X + dx,
    y: SUB_Y + dy,
    heading: 0,
    speed: 0,
    hp: 200,
    maxHp: 200,
    flooding: 0,
    fire: 0,
    speedFactor: 1,
    sinkDuration: SINK_DURATION[kind],
    listSide: 1,
    alert: 0,
    holdContact: 0,
    weaponCooldown: 99,
    patrolIndex: 0,
    path: [],
    repathTimer: 0,
    ...partial,
  };
}

/** A playing mission with the boat at a known spot and a chosen set of ships. */
function arena(ships: Ship[], charge = ULTIMATE_MAX): GameState {
  const start = startMission(createGame(7));
  return {
    ...start,
    ships,
    torpedoes: [],
    messages: [],
    ultimateCharge: charge,
    submarine: { ...start.submarine, x: SUB_X, y: SUB_Y, heading: 0 },
  };
}

const FIVE_HUNTERS = (): Ship[] => [
  ship('far-cruiser', 'cruiser', 40, 0),
  ship('near-destroyer', 'destroyer', 10, 0),
  ship('mid-patrol', 'patrol', 0, 20),
  ship('behind-sub', 'sub', -30, 0),
  ship('farthest-battleship', 'battleship', 0, -50),
];

const playerFish = (partial: Partial<Torpedo> = {}): Torpedo => ({
  id: 'fish-1',
  owner: 'player',
  kind: 'mk14',
  x: SUB_X,
  y: SUB_Y,
  z: 0.06,
  heading: 0,
  speed: 9.5,
  runSpeed: 9.5,
  lockId: null,
  life: 20,
  armDelay: 0,
  damage: 55,
  targetId: null,
  sourceId: 'player',
  turnRate: 2.2,
  run: 10,
  ...partial,
});

describe('ultimate charge', () => {
  it('starts at zero', () => {
    expect(createGame(7).ultimateCharge).toBe(0);
    expect(startMission(createGame(7)).ultimateCharge).toBe(0);
  });

  it('turns damage into charge at one point per three damage', () => {
    expect(DAMAGE_PER_CHARGE).toBe(3);
    expect(chargeFor(30, 0)).toBeCloseTo(10);
    expect(chargeFor(0, 1)).toBe(KILL_CHARGE);
    expect(KILL_CHARGE).toBe(15);
    expect(chargeFor(0, 0)).toBe(0);
  });

  it('accrues from the damage delta between two states', () => {
    const prev = arena([], 0);
    const next = { ...prev, stats: { ...prev.stats, damageDealt: prev.stats.damageDealt + 45 } };
    expect(accrueUltimate(prev, next).ultimateCharge).toBeCloseTo(15);
  });

  it('accrues 15 per kill', () => {
    const prev = arena([], 0);
    const next = { ...prev, stats: { ...prev.stats, shipsSunk: prev.stats.shipsSunk + 2 } };
    expect(accrueUltimate(prev, next).ultimateCharge).toBe(30);
  });

  it('clamps at 100', () => {
    const prev = arena([], 95);
    const next = {
      ...prev,
      stats: { ...prev.stats, damageDealt: 900, shipsSunk: prev.stats.shipsSunk + 3 },
    };
    expect(accrueUltimate(prev, next).ultimateCharge).toBe(ULTIMATE_MAX);
  });

  it('returns the same state when nothing was dealt', () => {
    const prev = arena([], 10);
    expect(accrueUltimate(prev, prev)).toBe(prev);
  });

  it('accrues through stepGame when a torpedo lands', () => {
    const before: GameState = {
      ...arena([ship('merchant-1', 'merchant', 30, 30)], 0),
      torpedoes: [playerFish({ x: SUB_X + 30, y: SUB_Y + 29.95, heading: Math.PI / 2 })],
    };
    const after = stepGame(before, [], FIXED_DT);
    const dealt = after.stats.damageDealt - before.stats.damageDealt;
    expect(dealt).toBeGreaterThan(0);
    expect(after.ultimateCharge).toBeCloseTo(dealt / DAMAGE_PER_CHARGE, 6);
  });

  it('accrues through stepGame when a ship sinks', () => {
    const dying = ship('wreck', 'merchant', 30, 30, { hp: 0, sinking: 0.001, path: [] });
    const before = arena([dying], 0);
    const after = stepGame(before, [], FIXED_DT);
    expect(after.stats.shipsSunk).toBe(before.stats.shipsSunk + 1);
    expect(after.ultimateCharge).toBeCloseTo(KILL_CHARGE);
  });
});

describe('broadside command', () => {
  it('is not ready below full charge, and the command is a no-op', () => {
    const state = arena(FIVE_HUNTERS(), 99.9);
    expect(isBroadsideReady(state)).toBe(false);
    const after = fireBroadside(state);
    expect(after.torpedoes).toHaveLength(0);
    expect(after.ultimateCharge).toBe(99.9);
    expect(after.messages).toHaveLength(0);
  });

  it('fires exactly four torpedoes when full and there are more than four hunters', () => {
    expect(BROADSIDE_SALVO).toBe(4);
    const state = arena(FIVE_HUNTERS());
    expect(isBroadsideReady(state)).toBe(true);
    const after = fireBroadside(state);
    expect(after.torpedoes).toHaveLength(4);
    expect(after.torpedoes.every((t) => t.kind === 'mk14' && t.owner === 'player')).toBe(true);
    expect(new Set(after.torpedoes.map((t) => t.id)).size).toBe(4);
  });

  it('fires one per hunter when fewer than four are alive', () => {
    const state = arena([ship('only', 'destroyer', 12, 3), ship('trader', 'merchant', 5, 0)]);
    const after = fireBroadside(state);
    expect(after.torpedoes).toHaveLength(1);
    expect(after.torpedoes[0]!.targetId).toBe('only');
  });

  it('targets the nearest hunters in order of distance', () => {
    const state = arena(FIVE_HUNTERS());
    expect(broadsideTargets(state).map((s) => s.id)).toEqual([
      'near-destroyer',
      'mid-patrol',
      'behind-sub',
      'far-cruiser',
    ]);
    const after = fireBroadside(state);
    expect(after.torpedoes.map((t) => t.targetId)).toEqual([
      'near-destroyer',
      'mid-patrol',
      'behind-sub',
      'far-cruiser',
    ]);
    expect(after.torpedoes.map((t) => t.lockId)).toEqual(after.torpedoes.map((t) => t.targetId));
  });

  it('skips merchants and sinking hulls', () => {
    const state = arena([
      ship('trader', 'merchant', 2, 0),
      ship('going-down', 'destroyer', 3, 0, { sinking: 5 }),
      ship('live', 'patrol', 20, 0),
    ]);
    expect(broadsideTargets(state).map((s) => s.id)).toEqual(['live']);
  });

  it('ignores the 60 degree bow arc', () => {
    const state = arena([ship('astern', 'destroyer', -20, 0)]);
    const after = fireBroadside(state);
    const heading = after.torpedoes[0]!.heading;
    const off = Math.abs(Math.atan2(Math.sin(heading - 0), Math.cos(heading - 0)));
    expect(off).toBeGreaterThan(Math.PI / 3 + 0.5);
  });

  it('resets the charge to zero and announces BROADSIDE!', () => {
    const after = fireBroadside(arena(FIVE_HUNTERS()));
    expect(after.ultimateCharge).toBe(0);
    const note = after.messages.find((m) => m.text === 'BROADSIDE!');
    expect(note?.ttl).toBe(3);
  });

  it('counts the salvo in torpedoesFired', () => {
    const state = arena(FIVE_HUNTERS());
    const after = fireBroadside(state);
    expect(after.stats.torpedoesFired).toBe(state.stats.torpedoesFired + 4);
  });

  it('keeps the charge and fires nothing when there is no valid target', () => {
    const state = arena([ship('trader', 'merchant', 5, 0)]);
    const after = fireBroadside(state);
    expect(after.torpedoes).toHaveLength(0);
    expect(after.ultimateCharge).toBe(ULTIMATE_MAX);
    expect(after.messages.some((m) => m.text === 'BROADSIDE!')).toBe(false);
    expect(fireBroadside(arena([])).ultimateCharge).toBe(ULTIMATE_MAX);
  });

  it('costs no ammunition and ignores tube reload', () => {
    const start = arena(FIVE_HUNTERS());
    const state: GameState = {
      ...start,
      submarine: { ...start.submarine, torpedoes: 0, seekers: 0, reloadMk14: 9 },
    };
    const after = fireBroadside(state);
    expect(after.torpedoes).toHaveLength(4);
    expect(after.submarine.torpedoes).toBe(0);
    expect(after.submarine.seekers).toBe(0);
    expect(after.submarine.reloadMk14).toBe(9);
  });

  it('uses the same damage model as a normal Mk-14', () => {
    const state = arena([ship('target', 'destroyer', 15, 0)]);
    const normal = stepGame({ ...state, selectedTargetId: 'target' }, [{ type: 'fireWeapon' }], 0);
    const broadside = fireBroadside(state);
    expect(normal.torpedoes).toHaveLength(1);
    expect(broadside.torpedoes[0]!.damage).toBeCloseTo(normal.torpedoes[0]!.damage, 9);
  });

  it('is deterministic', () => {
    const a = fireBroadside(arena(FIVE_HUNTERS()));
    const b = fireBroadside(arena(FIVE_HUNTERS()));
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const state = arena(FIVE_HUNTERS());
    const snapshot = JSON.stringify(state);
    fireBroadside(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it.each(['menu', 'paused', 'gameover', 'victory'] as const)(
    'is not usable while the phase is %s',
    (phase) => {
      const state = { ...arena(FIVE_HUNTERS()), phase };
      const after = fireBroadside(state);
      expect(after.torpedoes).toHaveLength(0);
      expect(after.ultimateCharge).toBe(ULTIMATE_MAX);
    },
  );

  it('launched fish turn toward their locked target', () => {
    const state = arena([ship('flank', 'destroyer', 6, 20)]);
    const fired = fireBroadside(state);
    const bearing = Math.atan2(20, 6);
    // Knock the fish off line: only a homing fish steers back.
    const skewed: Torpedo = { ...fired.torpedoes[0]!, heading: bearing - 0.8 };
    const stepped = advanceOrdnance({ ...fired, ships: state.ships, torpedoes: [skewed] }, 0.1);
    const fish = stepped.torpedoes[0]!;
    expect(Math.abs(fish.heading - bearing)).toBeLessThan(Math.abs(skewed.heading - bearing));
  });
});
