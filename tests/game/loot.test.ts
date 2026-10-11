import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission } from '../../src/game/sim/api';
import { PICKUP_LIFE, PICKUP_MAX } from '../../src/game/sim/constants';
import {
  HEALTH_BY_RARITY,
  LOOT_DROP_CHANCE,
  LOOT_RARITY_WEIGHTS,
  SEEKERS_BY_RARITY,
  dropLoot,
  hashUnit,
  rarityOf,
  rollLoot,
} from '../../src/game/sim/loot';
import { SINK_DURATION } from '../../src/game/sim/ship-damage';
import { systems } from '../../src/game/sim/systems';
import type {
  GameState,
  Powerup,
  PowerupKind,
  PowerupRarity,
  Ship,
  ShipKind,
} from '../../src/game/sim/types';

const base = (seed = 7): GameState => startMission(createGame(seed));
const RARITIES: readonly PowerupRarity[] = ['common', 'rare', 'epic'];
const KINDS: readonly ShipKind[] = [
  'merchant',
  'patrol',
  'destroyer',
  'cruiser',
  'sub',
  'battleship',
];

function wreckShip(
  state: GameState,
  kind: ShipKind,
  id: string,
  partial: Partial<Ship> = {},
): Ship {
  const template = state.ships[0]!;
  return {
    ...template,
    id,
    kind,
    x: 31.5,
    y: 40.25,
    hp: 0,
    sinking: 0.001,
    sinkDuration: SINK_DURATION[kind],
    path: [],
    formationAnchorId: null,
    ...partial,
  };
}

/** Sink one ship through the real damage system. */
function sink(state: GameState, ship: Ship): GameState {
  const live = state.ships.filter((s) => s.sinking === undefined);
  return systems.damage({ ...state, ships: [...live, ship] }, [], FIXED_DT);
}

const crate = (id: string, partial: Partial<Powerup> = {}): Powerup => ({
  id,
  kind: 'health',
  x: 1,
  y: 1,
  life: 50,
  ...partial,
});

describe('loot tables', () => {
  it('weights sum to 1 for every class and favour better rarity for bigger hulls', () => {
    for (const kind of KINDS) {
      const w = LOOT_RARITY_WEIGHTS[kind];
      expect(w.common + w.rare + w.epic).toBeCloseTo(1, 9);
    }
    expect(LOOT_RARITY_WEIGHTS.merchant.epic).toBeLessThan(LOOT_RARITY_WEIGHTS.destroyer.epic);
    expect(LOOT_RARITY_WEIGHTS.destroyer.epic).toBeLessThan(LOOT_RARITY_WEIGHTS.cruiser.epic);
    expect(LOOT_RARITY_WEIGHTS.cruiser.epic).toBeLessThan(LOOT_RARITY_WEIGHTS.battleship.epic);
    expect(LOOT_RARITY_WEIGHTS.merchant.common).toBeGreaterThan(
      LOOT_RARITY_WEIGHTS.battleship.common,
    );
  });

  it('uses a modest chance for common classes and a higher one for escorts', () => {
    expect(LOOT_DROP_CHANCE.merchant).toBeLessThanOrEqual(0.35);
    for (const kind of ['patrol', 'destroyer', 'cruiser'] as const) {
      expect(LOOT_DROP_CHANCE[kind]).toBeGreaterThan(LOOT_DROP_CHANCE.merchant);
    }
    for (const kind of KINDS) {
      expect(LOOT_DROP_CHANCE[kind]).toBeGreaterThan(0);
      expect(LOOT_DROP_CHANCE[kind]).toBeLessThanOrEqual(1);
    }
  });

  it('scales health and seekers by rarity, common matching the old values', () => {
    expect(HEALTH_BY_RARITY).toEqual({ common: 35, rare: 60, epic: 100 });
    expect(SEEKERS_BY_RARITY).toEqual({ common: 2, rare: 3, epic: 4 });
  });

  it('treats a crate with no rarity as common', () => {
    expect(rarityOf(crate('c'))).toBe('common');
    expect(rarityOf(crate('c', { rarity: 'epic' }))).toBe('epic');
  });
});

describe('seeded loot roll', () => {
  it('hashUnit is deterministic, in [0, 1) and varies with every input', () => {
    expect(hashUnit(7, 100, 'ship-a', 1)).toBe(hashUnit(7, 100, 'ship-a', 1));
    const seen = new Set<number>();
    for (let tick = 0; tick < 300; tick++) {
      const u = hashUnit(7, tick, 'ship-a', 1);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      seen.add(u);
    }
    expect(seen.size).toBeGreaterThan(290);
    expect(hashUnit(7, 100, 'ship-a', 1)).not.toBe(hashUnit(8, 100, 'ship-a', 1));
    expect(hashUnit(7, 100, 'ship-a', 1)).not.toBe(hashUnit(7, 100, 'ship-b', 1));
    expect(hashUnit(7, 100, 'ship-a', 1)).not.toBe(hashUnit(7, 100, 'ship-a', 2));
  });

  it('is deterministic for the same seed, tick and ship', () => {
    const ship = wreckShip(base(), 'cruiser', 'wave-3-cruiser-4');
    for (let tick = 0; tick < 80; tick++) {
      expect(rollLoot(7, tick, ship)).toEqual(rollLoot(7, tick, ship));
    }
  });

  it('drops at about the class chance and draws every kind and rarity', () => {
    const ship = wreckShip(base(), 'destroyer', 'd-1');
    let drops = 0;
    const kinds = new Set<PowerupKind>();
    const rarities = new Set<PowerupRarity>();
    const total = 3000;
    for (let tick = 0; tick < total; tick++) {
      const loot = rollLoot(11, tick, ship);
      if (loot === null) continue;
      drops++;
      kinds.add(loot.kind);
      rarities.add(loot.rarity);
    }
    expect(drops / total).toBeGreaterThan(LOOT_DROP_CHANCE.destroyer - 0.05);
    expect(drops / total).toBeLessThan(LOOT_DROP_CHANCE.destroyer + 0.05);
    expect(kinds.size).toBe(6);
    expect(rarities.size).toBe(3);
  });

  it('gives bigger classes better odds of rare and epic drops', () => {
    const share = (kind: ShipKind) => {
      const ship = wreckShip(base(), kind, `${kind}-x`);
      let drops = 0;
      let good = 0;
      for (let tick = 0; tick < 6000; tick++) {
        const loot = rollLoot(5, tick, ship);
        if (loot === null) continue;
        drops++;
        if (loot.rarity !== 'common') good++;
      }
      return good / drops;
    };
    const merchant = share('merchant');
    const destroyer = share('destroyer');
    const cruiser = share('cruiser');
    const battleship = share('battleship');
    expect(merchant).toBeLessThan(destroyer);
    expect(destroyer).toBeLessThan(cruiser);
    expect(cruiser).toBeLessThan(battleship);
    // observed share tracks the table within sampling noise
    expect(merchant).toBeCloseTo(1 - LOOT_RARITY_WEIGHTS.merchant.common, 1);
    expect(battleship).toBeCloseTo(1 - LOOT_RARITY_WEIGHTS.battleship.common, 1);
  });

  it('always drops, and never common, for an elite hull', () => {
    const ship = wreckShip(base(), 'destroyer', 'wave-2-destroyer-3', { elite: true });
    for (let tick = 0; tick < 400; tick++) {
      const loot = rollLoot(3, tick, ship);
      expect(loot).not.toBeNull();
      expect(loot!.rarity === 'rare' || loot!.rarity === 'epic').toBe(true);
    }
  });
});

describe('dropLoot', () => {
  const dropTick = (ship: Ship, seed: number): number => {
    for (let tick = 1; tick < 500; tick++) if (rollLoot(seed, tick, ship) !== null) return tick;
    throw new Error('no drop found');
  };
  const missTick = (ship: Ship, seed: number): number => {
    for (let tick = 1; tick < 500; tick++) if (rollLoot(seed, tick, ship) === null) return tick;
    throw new Error('no miss found');
  };

  it('puts a crate at the wreck with the rolled rarity and the normal pickup life', () => {
    const start = base();
    const ship = wreckShip(start, 'cruiser', 'c-1');
    const tick = dropTick(ship, start.seed);
    const next = dropLoot({ ...start, tick }, [ship]);
    const roll = rollLoot(start.seed, tick, ship)!;
    expect(next.powerups).toHaveLength(start.powerups.length + 1);
    const dropped = next.powerups[next.powerups.length - 1]!;
    expect(dropped).toMatchObject({
      x: ship.x,
      y: ship.y,
      kind: roll.kind,
      rarity: roll.rarity,
      life: PICKUP_LIFE,
    });
    expect(next.powerups.slice(0, start.powerups.length)).toEqual(start.powerups);
  });

  it('leaves the state untouched when the roll misses', () => {
    const start = base();
    const ship = wreckShip(start, 'merchant', 'm-1');
    const tick = missTick(ship, start.seed);
    const state = { ...start, tick };
    expect(dropLoot(state, [ship])).toBe(state);
    expect(dropLoot(state, [])).toBe(state);
  });

  it('is deterministic and never advances rngState', () => {
    const start = base();
    const ship = wreckShip(start, 'battleship', 'b-1');
    const state = { ...start, tick: dropTick(ship, start.seed), rngState: 123456 };
    const a = dropLoot(state, [ship]);
    const b = dropLoot(state, [ship]);
    expect(a).toEqual(b);
    expect(a.rngState).toBe(123456);
  });

  it('does not mutate its input', () => {
    const start = base();
    const ship = wreckShip(start, 'battleship', 'b-1', { elite: true });
    const state = { ...start, tick: 9 };
    const frozen = JSON.stringify(state.powerups);
    dropLoot(state, [ship]);
    expect(JSON.stringify(state.powerups)).toBe(frozen);
  });

  it('never grows the board past PICKUP_MAX', () => {
    const start = base();
    const full = Array.from({ length: PICKUP_MAX }, (_, i) => crate(`full-${i}`));
    const elites = [0, 1, 2].map((i) => wreckShip(start, 'destroyer', `e-${i}`, { elite: true }));
    expect(dropLoot({ ...start, tick: 4, powerups: full }, elites).powerups).toHaveLength(
      PICKUP_MAX,
    );
    const nearFull = full.slice(0, PICKUP_MAX - 1);
    const filled = dropLoot({ ...start, tick: 4, powerups: nearFull }, elites);
    expect(filled.powerups).toHaveLength(PICKUP_MAX);
  });

  it('gives each wreck its own crate id even on the same tick', () => {
    const start = base();
    const elites = [0, 1, 2].map((i) => wreckShip(start, 'cruiser', `e-${i}`, { elite: true }));
    const next = dropLoot({ ...start, tick: 12, powerups: [] }, elites);
    expect(new Set(next.powerups.map((p) => p.id)).size).toBe(3);
  });
});

describe('loot through the damage system', () => {
  it('drops the rolled crate when a ship is removed as sunk, without touching rngState', () => {
    const start = base();
    const ship = wreckShip(start, 'destroyer', 'wave-2-destroyer-9', { elite: true });
    const state = { ...start, tick: 77, rngState: 424242, powerups: [] };
    const next = sink(state, ship);
    expect(next.powerups).toHaveLength(1);
    const roll = rollLoot(state.seed, 77, ship)!;
    expect(next.powerups[0]).toMatchObject({
      x: ship.x,
      y: ship.y,
      kind: roll.kind,
      rarity: roll.rarity,
    });
    expect(next.rngState).toBe(424242);
  });

  it('respects PICKUP_MAX when a kill lands on a full board', () => {
    const start = base();
    const full = Array.from({ length: PICKUP_MAX }, (_, i) => crate(`full-${i}`));
    const ship = wreckShip(start, 'battleship', 'b-9', { elite: true });
    const next = sink({ ...start, tick: 50, powerups: full }, ship);
    expect(next.powerups).toHaveLength(PICKUP_MAX);
  });

  it('adds no crate for a hull that is still afloat', () => {
    const start = base();
    const quiet = systems.damage(start, [], FIXED_DT);
    expect(quiet.powerups).toEqual(start.powerups);
  });
});

describe('rarity scales pickup magnitude', () => {
  /** Put one crate on the boat and run the pickup system once. */
  function take(
    kind: PowerupKind,
    rarity: PowerupRarity | undefined,
    sub: Partial<GameState['submarine']> = {},
  ) {
    const start = base();
    const submarine = { ...start.submarine, ...sub };
    const pickup: Powerup = {
      id: 'p',
      kind,
      x: submarine.x,
      y: submarine.y,
      life: 60,
      ...(rarity ? { rarity } : {}),
    };
    const next = systems.pickupsWaves({ ...start, submarine, powerups: [pickup] }, [], FIXED_DT);
    expect(next.stats.powerupsTaken).toBe(1);
    return next.submarine;
  }

  it('restores 35 / 60 / 100 hull for common / rare / epic health', () => {
    const wounded = { hp: 1, maxHp: 300 };
    expect(take('health', 'common', wounded).hp).toBeCloseTo(36, 6);
    expect(take('health', 'rare', wounded).hp).toBeCloseTo(61, 6);
    expect(take('health', 'epic', wounded).hp).toBeCloseTo(101, 6);
  });

  it('never repairs past max hull', () => {
    expect(take('health', 'epic', { hp: 90, maxHp: 100 }).hp).toBe(100);
  });

  it('refills torpedoes and adds 2 / 3 / 4 seekers', () => {
    const empty = { torpedoes: 0, seekers: 0, maxSeekers: 10 };
    for (const [rarity, seekers] of [
      ['common', 2],
      ['rare', 3],
      ['epic', 4],
    ] as const) {
      const sub = take('ammo', rarity, empty);
      expect(sub.torpedoes).toBe(sub.maxTorpedoes);
      expect(sub.seekers).toBe(seekers);
    }
  });

  it('caps seekers at the magazine size', () => {
    const sub = take('ammo', 'epic', { seekers: 4, maxSeekers: 5 });
    expect(sub.seekers).toBe(5);
  });

  it('leaves tier and counter pickups the same at every rarity', () => {
    for (const kind of ['hull', 'weapon', 'speed', 'counter'] as const) {
      const sub = { cmCharges: 0, decoys: 0 };
      const common = take(kind, 'common', sub);
      expect(take(kind, 'rare', sub)).toEqual(common);
      expect(take(kind, 'epic', sub)).toEqual(common);
    }
  });

  it('treats an unmarked map crate exactly like a common one', () => {
    const wounded = { hp: 1, maxHp: 300 };
    expect(take('health', undefined, wounded)).toEqual(take('health', 'common', wounded));
    const empty = { torpedoes: 0, seekers: 0, maxSeekers: 10 };
    expect(take('ammo', undefined, empty)).toEqual(take('ammo', 'common', empty));
  });

  it('keeps the seeded map crates unmarked so default behaviour is unchanged', () => {
    for (const pickup of base().powerups) expect(rarityOf(pickup)).toBe('common');
  });
});

describe('every rarity is reachable', () => {
  it('exposes the three rarities in order', () => {
    expect(RARITIES).toEqual(['common', 'rare', 'epic']);
    expect(Object.keys(HEALTH_BY_RARITY)).toEqual(RARITIES);
  });
});
