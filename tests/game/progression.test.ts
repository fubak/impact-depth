import { describe, expect, it } from 'vitest';
import {
  awardXp,
  choosePerk,
  offerPerks,
  XP_PER_KILL,
  xpToNext,
} from '../../src/game/sim/progression';
import { PERK_IDS, PERKS } from '../../src/game/sim/perks';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { systems } from '../../src/game/sim/systems';
import type { GameState, Ship, ShipKind } from '../../src/game/sim/types';

const base = (seed = 7): GameState => startMission(createGame(seed));

/** A hull on its last tick of sinking: the damage system counts it as sunk. */
function dyingShip(state: GameState, kind: ShipKind, id: string): Ship {
  const template = state.ships[0]!;
  return { ...template, id, kind, hp: 0, sinking: 0.001, path: [], formationAnchorId: null };
}

/** Sink one ship of `kind` through the real damage system. */
function sink(state: GameState, kind: ShipKind): GameState {
  const live = state.ships.filter((ship) => ship.sinking === undefined);
  const withWreck = {
    ...state,
    ships: [...live, dyingShip(state, kind, `wreck-${state.stats.shipsSunk}-${kind}`)],
  };
  return systems.damage(withWreck, [], 1 / 60);
}

const leveledOnce = (seed = 7) => sink(sink(base(seed), 'merchant'), 'patrol'); // 60 + 80 = 140 XP -> level 2, 75 left // Plan 030 XP retune

describe('XP curve', () => {
  it('uses 65 + 30*(n-1) XP to leave level n', () => { // Plan 030 XP retune
    expect(xpToNext(1)).toBe(65); // Plan 030 XP retune
    expect(xpToNext(2)).toBe(95); // Plan 030 XP retune
    expect(xpToNext(5)).toBe(185); // Plan 030 XP retune
  });

  it('pays the planned XP by hull class', () => {
    expect(XP_PER_KILL).toEqual({ // Plan 030 XP retune
      merchant: 60, // Plan 030 XP retune
      patrol: 80, // Plan 030 XP retune
      destroyer: 120, // Plan 030 XP retune
      cruiser: 180, // Plan 030 XP retune
      sub: 160, // Plan 030 XP retune
      battleship: 340, // Plan 030 XP retune
    }); // Plan 030 XP retune
  });

  it('starts at level 1 with no XP, perks or pending choices', () => {
    const state = createGame(7);
    expect(state.stats.xp).toBe(0);
    expect(state.stats.level).toBe(1);
    expect(state.perks).toEqual([]);
    expect(state.pendingPerks).toEqual([]);
    expect(state.perkQueue).toBe(0);
    expect(state.submarine.critChance).toBe(0);
  });
});

describe('XP from kills', () => {
  it('awards the class XP when a hull goes under, below the level threshold', () => {
    const next = sink(base(), 'merchant');
    expect(next.stats.shipsSunk).toBe(1);
    expect(next.stats.xp).toBe(60); // Plan 030 XP retune
    expect(next.stats.level).toBe(1);
    expect(next.pendingPerks).toEqual([]);
  });

  it('does not award XP when nothing sinks', () => {
    const state = base();
    expect(systems.damage(state, [], 1 / 60).stats.xp).toBe(0);
  });

  it('levels up at the threshold, carries the remainder and offers three distinct perks', () => {
    const next = leveledOnce(); // 60 + 80 = 140 -> level 2, 75 left // Plan 030 XP retune
    expect(next.stats.level).toBe(2);
    expect(next.stats.xp).toBe(75); // Plan 030 XP retune
    expect(next.pendingPerks).toHaveLength(3);
    expect(new Set(next.pendingPerks).size).toBe(3);
    for (const id of next.pendingPerks) expect(PERK_IDS).toContain(id);
    expect(next.perkQueue).toBe(0);
    expect(next.messages.some((message) => /LEVEL 2/.test(message.text))).toBe(true);
  });

  it('queues further level-ups behind an unanswered offer', () => {
    // 340 XP: 65 -> L2 (275), 95 -> L3 (180), 125 -> L4 (55). // Plan 030 XP retune
    const next = sink(base(), 'battleship');
    expect(next.stats.level).toBe(4); // Plan 030 XP retune
    expect(next.stats.xp).toBe(55); // Plan 030 XP retune
    expect(next.pendingPerks).toHaveLength(3);
    expect(next.perkQueue).toBe(2); // Plan 030 XP retune
  });

  it('keeps the offer when more XP arrives without a choice', () => {
    const first = leveledOnce();
    const offer = first.pendingPerks;
    const second = awardXp(first, 200); // 75 + 200 = 275: 95 -> L3 (180), 125 -> L4 (55) // Plan 030 XP retune
    expect(second.stats.level).toBe(4); // Plan 030 XP retune
    expect(second.pendingPerks).toEqual(offer);
    expect(second.perkQueue).toBe(2); // Plan 030 XP retune
  });

  it('ignores zero or negative XP', () => {
    const state = base();
    expect(awardXp(state, 0)).toBe(state);
    expect(awardXp(state, -5)).toBe(state);
  });

  it('never advances rngState, so existing random streams are untouched', () => {
    const state = base();
    const next = sink(state, 'battleship');
    expect(next.rngState).toBe(state.rngState);
  });
});

describe('perk offers', () => {
  it('are deterministic for the same inputs and vary with rngState', () => {
    const a = offerPerks(7, 2, 12345, []);
    const b = offerPerks(7, 2, 12345, []);
    expect(a).toEqual(b);
    const distinct = new Set<string>();
    for (let rng = 1; rng <= 40; rng++) distinct.add(offerPerks(7, 2, rng * 7919, []).join());
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('replays to identical offers from the same seed', () => {
    expect(leveledOnce(11).pendingPerks).toEqual(leveledOnce(11).pendingPerks);
  });

  it('never re-offers an owned non-stackable perk', () => {
    const owned = PERK_IDS.filter((id) => !PERKS[id].stackable).slice(0, 4);
    for (let rng = 1; rng <= 60; rng++) {
      const offer = offerPerks(3, 4, rng * 104729, owned);
      expect(offer).toHaveLength(3);
      for (const id of offer) expect(owned).not.toContain(id);
    }
  });

  it('offers fewer than three when the pool runs short, never throws', () => {
    const owned = PERK_IDS.filter((id) => !PERKS[id].stackable);
    const offer = offerPerks(1, 9, 5, owned);
    expect(offer.length).toBeGreaterThan(0);
    expect(offer.length).toBeLessThanOrEqual(3);
  });
});

describe('choosePerk', () => {
  it('applies exactly the chosen perk and clears the offer', () => {
    const state = leveledOnce();
    const chosen = state.pendingPerks[1]!;
    const next = choosePerk(state, 1);
    expect(next.perks).toEqual([chosen]);
    expect(next.pendingPerks).toEqual([]);
    expect(next.messages.some((message) => message.text.includes(PERKS[chosen].name.toUpperCase()))).toBe(true);
  });

  it('applies once: a second choice with nothing pending is a no-op', () => {
    const once = choosePerk(leveledOnce(), 0);
    const twice = choosePerk(once, 0);
    expect(twice).toBe(once);
    expect(twice.perks).toHaveLength(1);
  });

  it('ignores out-of-range and non-integer indices', () => {
    const state = leveledOnce();
    expect(choosePerk(state, 3)).toBe(state);
    expect(choosePerk(state, -1)).toBe(state);
    expect(choosePerk(state, 0.5)).toBe(state);
    expect(choosePerk(state, Number.NaN)).toBe(state);
  });

  it('draws the next queued offer without repeating an owned perk', () => {
    const state = sink(base(), 'battleship'); // level 4, two queued // Plan 030 XP retune
    const chosen = state.pendingPerks[0]!;
    const next = choosePerk(state, 0);
    expect(next.perkQueue).toBe(1); // Plan 030 XP retune
    expect(next.pendingPerks).toHaveLength(3);
    if (!PERKS[chosen].stackable) expect(next.pendingPerks).not.toContain(chosen);
  });

  it('works through the command path in any phase', () => {
    const state = { ...leveledOnce(), phase: 'paused' as const };
    const next = updateGame(state, [{ type: 'choosePerk', index: 2 }], 0);
    expect(next.perks).toEqual([state.pendingPerks[2]]);
    expect(next.pendingPerks).toEqual([]);
  });
});

describe('never blocks the sim', () => {
  it('keeps stepping while a choice is pending', () => {
    const pending = leveledOnce();
    expect(pending.pendingPerks).toHaveLength(3);
    let state = pending;
    for (let i = 0; i < 120; i++) state = updateGame(state, [], 1 / 60);
    expect(state.tick).toBe(pending.tick + 120);
    expect(state.time).toBeGreaterThan(pending.time);
    expect(state.pendingPerks).toEqual(pending.pendingPerks);
    expect(state.perks).toEqual([]);
  });

  it('leaves a bot that never chooses on identical default numbers', () => {
    const plain = base();
    const withOffer: GameState = {
      ...plain,
      pendingPerks: leveledOnce().pendingPerks,
      stats: { ...plain.stats, xp: 20, level: 2 },
    };
    let a = plain;
    let b = withOffer;
    for (let i = 0; i < 300; i++) {
      a = updateGame(a, [], 1 / 60);
      b = updateGame(b, [], 1 / 60);
    }
    expect(b.submarine).toEqual(a.submarine);
    expect(b.ships).toEqual(a.ships);
    expect(b.rngState).toBe(a.rngState);
  });
});
