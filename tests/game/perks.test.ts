import { describe, expect, it } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import { choosePerk } from '../../src/game/sim/progression';
import {
  CHAIN_REACTION_DAMAGE,
  CHAIN_REACTION_RADIUS,
  HOT_TUBES_RELOAD_RATE,
  PERKS,
  PERK_IDS,
  PREDATOR_CRIT_CHANCE,
  hasPerk,
} from '../../src/game/sim/perks';
import { makeTorpedo } from '../../src/game/sim/ordnance-physics';
import { systems } from '../../src/game/sim/systems';
import type { GameState, PerkId, Ship } from '../../src/game/sim/types';

const base = (): GameState => startMission(createGame(7));
const withPerk = (state: GameState, id: PerkId): GameState => ({
  ...state,
  perks: [...state.perks, id],
});
/** Take a perk through the real draft path. */
function draft(state: GameState, id: PerkId): GameState {
  return choosePerk({ ...state, pendingPerks: [id] }, 0);
}
const ship = (state: GameState, id: string, patch: Partial<Ship>): Ship => ({
  ...state.ships[0]!,
  id,
  kind: 'destroyer',
  path: [],
  formationAnchorId: null,
  sinking: undefined,
  ...patch,
});

describe('perk definitions', () => {
  it('describes every perk in plain words', () => {
    for (const id of PERK_IDS) {
      expect(PERKS[id].id).toBe(id);
      expect(PERKS[id].name.length).toBeGreaterThan(0);
      expect(PERKS[id].description.length).toBeGreaterThan(10);
    }
    expect(PERK_IDS).toHaveLength(8);
  });

  it('hasPerk reads the owned list', () => {
    expect(hasPerk(base(), 'ghost')).toBe(false);
    expect(hasPerk(withPerk(base(), 'ghost'), 'ghost')).toBe(true);
  });
});

describe('hotTubes', () => {
  it('reloads 20% faster', () => {
    const state = { ...base(), submarine: { ...base().submarine, reloadMk14: 2, reloadMk18: 2 } };
    const plain = systems.submarine(state, [], 0.5).submarine;
    const fast = systems.submarine(withPerk(state, 'hotTubes'), [], 0.5).submarine;
    expect(plain.reloadMk14).toBeCloseTo(1.5);
    expect(fast.reloadMk14).toBeCloseTo(2 - 0.5 * HOT_TUBES_RELOAD_RATE);
    expect(fast.reloadMk18).toBeCloseTo(2 - 0.5 * HOT_TUBES_RELOAD_RATE);
    // 20% less wall-clock time to clear the same reload.
    expect(1 / HOT_TUBES_RELOAD_RATE).toBeCloseTo(0.8);
  });
});

describe('heavyWarheads', () => {
  it('adds 25% to player torpedo damage', () => {
    const state = base();
    const boosted = withPerk(state, 'heavyWarheads');
    for (const kind of ['mk14', 'mk18'] as const) {
      const normal = makeTorpedo(state, kind, null).damage;
      expect(makeTorpedo(boosted, kind, null).damage).toBeCloseTo(normal * 1.25);
    }
  });
});

describe('ironHull', () => {
  it('adds 25 max HP and heals 25', () => {
    const state = { ...base(), submarine: { ...base().submarine, hp: 60 } };
    const next = draft(state, 'ironHull');
    expect(next.submarine.maxHp).toBe(125);
    expect(next.submarine.hp).toBe(85);
  });

  it('does not heal past the new maximum', () => {
    const next = draft(base(), 'ironHull');
    expect(next.submarine.maxHp).toBe(125);
    expect(next.submarine.hp).toBe(125);
  });

  it('can be drafted again for another 25', () => {
    const once = draft(base(), 'ironHull');
    const twice = draft(once, 'ironHull');
    expect(twice.submarine.maxHp).toBe(150);
  });
});

describe('salvage', () => {
  it('refunds one extra Mk-14 per kill', () => {
    const state = base();
    const sub = { ...state.submarine, torpedoes: 2 };
    const dying = (s: GameState): GameState => ({
      ...s,
      submarine: sub,
      ships: [ship(s, 'dead', { hp: 0, sinking: 0.001 }), ship(s, 'alive', { x: 90, y: 90 })],
    });
    expect(systems.damage(dying(state), [], 1 / 60).submarine.torpedoes).toBe(3);
    expect(systems.damage(dying(withPerk(state, 'salvage')), [], 1 / 60).submarine.torpedoes).toBe(4);
  });

  it('still respects the magazine cap', () => {
    const state = withPerk(base(), 'salvage');
    const full = {
      ...state,
      ships: [ship(state, 'dead', { hp: 0, sinking: 0.001 })],
    };
    const next = systems.damage(full, [], 1 / 60);
    expect(next.submarine.torpedoes).toBe(next.submarine.maxTorpedoes);
  });
});

describe('quietProp', () => {
  it('scales boat noise by 0.75', () => {
    const state = {
      ...base(),
      submarine: { ...base().submarine, silentRunning: false, speed: 1.5, targetSpeed: 1.5 },
    };
    const plain = systems.submarine(state, [], 1 / 60).submarine.noise;
    const quiet = systems.submarine(withPerk(state, 'quietProp'), [], 1 / 60).submarine.noise;
    expect(plain).toBeGreaterThan(0.3);
    expect(quiet).toBeCloseTo(plain * 0.75, 6);
  });
});

describe('predator', () => {
  it('stores a 15% crit chance and rolls nothing yet', () => {
    const state = base();
    const next = draft(state, 'predator');
    expect(next.submarine.critChance).toBeCloseTo(PREDATOR_CRIT_CHANCE);
    expect(PREDATOR_CRIT_CHANCE).toBe(0.15);
    expect(next.rngState).toBe(state.rngState);
    expect(makeTorpedo(next, 'mk14', null).damage).toBe(makeTorpedo(state, 'mk14', null).damage);
  });
});

describe('chainReaction', () => {
  const scene = (): GameState => {
    const state = base();
    return {
      ...state,
      ships: [
        ship(state, 'wreck', { x: 40, y: 40, hp: 0, sinking: 0.001 }),
        ship(state, 'near', { x: 40 + CHAIN_REACTION_RADIUS - 1, y: 40, hp: 100, maxHp: 100 }),
        ship(state, 'far', { x: 40 + CHAIN_REACTION_RADIUS + 3, y: 40, hp: 100, maxHp: 100 }),
        ship(state, 'frail', { x: 40, y: 40 + 2, hp: 20, maxHp: 100 }),
      ],
    };
  };
  const byId = (state: GameState, id: string) => state.ships.find((s) => s.id === id)!;

  it('does nothing without the perk', () => {
    const next = systems.damage(scene(), [], 1 / 60);
    expect(byId(next, 'near').hp).toBe(100);
    expect(byId(next, 'frail').sinking).toBeUndefined();
  });

  it('deals 30 damage to live hulls inside 6 units when a ship sinks', () => {
    const next = systems.damage(withPerk(scene(), 'chainReaction'), [], 1 / 60);
    expect(next.ships.some((s) => s.id === 'wreck')).toBe(false);
    expect(byId(next, 'near').hp).toBeCloseTo(100 - CHAIN_REACTION_DAMAGE);
    expect(byId(next, 'far').hp).toBe(100);
  });

  it('can start a hull sinking, which then pays out its own kill', () => {
    const next = systems.damage(withPerk(scene(), 'chainReaction'), [], 1 / 60);
    expect(byId(next, 'frail').sinking).toBeGreaterThan(0);
  });

  it('is skipped when nothing sinks', () => {
    const state = withPerk(scene(), 'chainReaction');
    const quiet = { ...state, ships: state.ships.filter((s) => s.id !== 'wreck') };
    expect(byId(systems.damage(quiet, [], 1 / 60), 'near').hp).toBe(100);
  });
});

describe('ghost', () => {
  const quiet = (): GameState => ({
    ...base(),
    submarine: { ...base().submarine, battery: 50, silentRunning: true, z: 0.5, snorkel: false },
  });

  it('silent running drains no battery', () => {
    const plain = systems.submarine(quiet(), [], 1).submarine.battery;
    const ghost = systems.submarine(withPerk(quiet(), 'ghost'), [], 1).submarine.battery;
    expect(plain).toBeLessThan(50);
    expect(ghost).toBe(50);
  });

  it('loud running still drains', () => {
    const loud = withPerk(quiet(), 'ghost');
    const state = { ...loud, submarine: { ...loud.submarine, silentRunning: false } };
    expect(systems.submarine(state, [], 1).submarine.battery).toBeLessThan(50);
  });
});
