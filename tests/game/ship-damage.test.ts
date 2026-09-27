import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, fireWeapon, startMission, updateGame } from '../../src/game/sim/api';
import {
  SINK_DURATION,
  advanceShipDamage,
  applyTorpedoHit,
  hullHalfLength,
} from '../../src/game/sim/ship-damage';
import { getTerrain, isLand } from '../../src/game/sim/world';
import type { GameState, Ship, Torpedo } from '../../src/game/sim/types';

function mission(seed = 19): GameState {
  return startMission(createGame(seed));
}

function loneBoat(state: GameState, z = 0.5): GameState {
  return {
    ...state,
    aircraft: [],
    depthCharges: [],
    torpedoes: [],
    shells: [],
    countermeasures: [],
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      z,
      targetDepth: z,
      speed: 0,
      targetSpeed: 0,
      invuln: 0,
      silentRunning: false,
    },
  };
}

/** Open ocean: a spot with several units of water all around it. */
function clearWater(state: GameState): { x: number; y: number } {
  const terrain = getTerrain(state.terrainSeed);
  for (let x = 10; x < 120; x += 1) {
    for (let y = 10; y < 120; y += 1) {
      let clear = true;
      for (let a = 0; a < Math.PI * 2 && clear; a += Math.PI / 6) {
        for (const r of [1.5, 3]) {
          if (isLand(terrain, x + Math.cos(a) * r, y + Math.sin(a) * r)) clear = false;
        }
      }
      if (clear && !isLand(terrain, x, y)) return { x, y };
    }
  }
  throw new Error('no clear water on this terrain');
}

function shipFixture(partial: Partial<Ship> = {}): Ship {
  return {
    id: 'target-1',
    kind: 'merchant',
    name: 'TEST MERCHANT',
    x: 20,
    y: 0,
    heading: 0, // steaming +x
    speed: 1.2,
    hp: 60,
    maxHp: 60,
    flooding: 0,
    fire: 0,
    speedFactor: 1,
    sinkDuration: SINK_DURATION.merchant,
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

/** Player fish on a collision course with a ship. */
function torpedoAt(partial: Partial<Torpedo>): Torpedo {
  return {
    id: 'fish-1',
    owner: 'player',
    kind: 'mk14',
    x: 20,
    y: -2,
    z: 0.06,
    heading: Math.PI / 2, // +y, straight at the hull
    speed: 9.5,
    runSpeed: 9.5,
    lockId: null,
    life: 20,
    armDelay: 0,
    damage: 55,
    targetId: null,
    sourceId: 'player',
    turnRate: 1.2,
    run: 10,
    ...partial,
  };
}

describe('ship damage — hit location', () => {
  it('a stern hit wrecks propulsion while an amidships hit floods', () => {
    // Track point projects onto the hull axis: -L is the screws, midships the back.
    const ship = shipFixture();
    const half = hullHalfLength(ship);
    const stern = applyTorpedoHit(ship, ship.x - half * 0.9, ship.y, 55).ship;
    const mid = applyTorpedoHit(ship, ship.x, ship.y, 55).ship;
    expect(stern.speedFactor).toBeLessThan(0.5);
    expect(mid.speedFactor).toBe(1);
    expect(mid.flooding).toBeGreaterThan(stern.flooding);
  });

  it('flooding keeps draining the hull even with no further hits', () => {
    // Damage control can slow but not fully stop a flooded hull — a wounded
    // ship is a clock, not a score entry.
    const hurt = shipFixture({ flooding: 0.6, speed: 0 });
    let now = hurt;
    for (let i = 0; i < 240; i++) {
      const step = advanceShipDamage(now, FIXED_DT);
      now = step.ship ?? now;
      if (step.ship === null) break;
    }
    expect(now.hp).toBeLessThan(hurt.hp);
    expect(now.flooding).toBeGreaterThan(hurt.flooding - 0.01); // DC only slows it
    const dry = shipFixture({ speed: 0 });
    let still = dry;
    for (let i = 0; i < 240; i++) {
      const step = advanceShipDamage(still, FIXED_DT);
      still = step.ship ?? still;
    }
    expect(still.hp).toBe(dry.hp); // no flooding, no bleed
  });

  it('a mortally hit ship stays afloat for its class duration', () => {
    const out = applyTorpedoHit(shipFixture({ hp: 30 }), 20, 0, 55);
    expect(out.lethal).toBe(true);
    expect(out.ship.sinking).toBeDefined();
    expect(out.ship.sinking).toBeGreaterThan(5); // sinks over seconds, not instantly
    expect(out.ship.sinking).toBeLessThanOrEqual(SINK_DURATION.merchant);
    expect(out.ship.sinkStyle).toBeDefined();
  });
});

describe('ship damage — in the sim', () => {
  it('a lethal torpedo counts the kill only when the hull finally goes down', () => {
    let state = loneBoat(mission());
    const sea = clearWater(state);
    const ship = shipFixture({ x: sea.x, y: sea.y, hp: 30, speed: 1.2 });
    const fish = torpedoAt({ x: sea.x, y: sea.y - 2 });
    // Keep the boat out of the firing line.
    state = {
      ...state,
      ships: [ship],
      torpedoes: [fish],
      submarine: { ...state.submarine, x: sea.x - 30, y: sea.y - 30 },
    };
    const sunkBefore = state.stats.shipsSunk;
    // First contact — hit lands but the hull is still in the ship list.
    for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.ships[0]?.sinking !== undefined) break;
    }
    expect(state.ships).toHaveLength(1);
    expect(state.ships[0]!.sinking).toBeDefined();
    expect(state.stats.shipsSunk).toBe(sunkBefore); // not sunk yet — still settling
    expect(state.messages.some((m) => m.text.includes('MORTALLY HIT'))).toBe(true);
    // Ride the sink out — the kill registers at removal, not at impact.
    for (let i = 0; i < Math.round(SINK_DURATION.merchant / FIXED_DT) + 20; i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.ships.length === 0) break;
    }
    expect(state.ships).toHaveLength(0);
    expect(state.stats.shipsSunk).toBe(sunkBefore + 1);
    expect(state.messages.some((m) => m.text.includes('SHIP SUNK'))).toBe(true);
  });

  it('a sinking ship stops shooting and is not auto-locked', () => {
    // A dead-in-the-water sinking escort must not be a threat or a target —
    // its weapon cooldown is already zeroed and the engagement loop skips it.
    let state = loneBoat(mission());
    const sea = clearWater(state);
    const escort = shipFixture({
      id: 'dd-dying',
      kind: 'destroyer',
      name: 'DD DYING',
      x: sea.x,
      y: sea.y,
      hp: 10,
      maxHp: 120,
      sinking: SINK_DURATION.destroyer,
      alert: 1,
      weaponCooldown: 0,
      sinkDuration: SINK_DURATION.destroyer,
    });
    state = {
      ...state,
      ships: [escort],
      submarine: { ...state.submarine, x: sea.x - 8, y: sea.y, z: 0.5 },
    };
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
    }
    expect(state.torpedoes).toHaveLength(0); // never fired back
    expect(state.depthCharges).toHaveLength(0);
    // Now try to fire at it — the only contact is sinking, so the fish is a
    // dumb straight runner rather than a locked solution.
    const fired = fireWeapon(state);
    expect(fired.torpedoes).toHaveLength(1);
    expect(fired.torpedoes[0]!.lockId).toBeNull();
  });
});
