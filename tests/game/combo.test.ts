import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission } from '../../src/game/sim/api';
import {
  COMBO_BONUS_CAP,
  COMBO_WINDOW,
  CRIT_MULTIPLIER,
  comboBanner,
  comboBonusFraction,
  critRoll,
  expireCombo,
  registerKills,
  rollCrit,
} from '../../src/game/sim/combo';
import { advanceOrdnance } from '../../src/game/sim/ordnance-physics';
import { SINK_DURATION } from '../../src/game/sim/ship-damage';
import { systems } from '../../src/game/sim/systems';
import { getTerrain, isLand } from '../../src/game/sim/world';
import type { GameState, Ship, ShipKind, Torpedo } from '../../src/game/sim/types';

const base = (seed = 7): GameState => startMission(createGame(seed));

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

function targetShip(partial: Partial<Ship> = {}): Ship {
  return {
    id: 'target-1',
    kind: 'merchant',
    name: 'TEST MERCHANT',
    x: 20,
    y: 0,
    heading: 0,
    speed: 0,
    hp: 500,
    maxHp: 500,
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

/** A player fish about to cross the hull on its next step. */
function playerFish(partial: Partial<Torpedo> = {}): Torpedo {
  return {
    id: 'fish-1',
    owner: 'player',
    kind: 'mk14',
    x: 20,
    y: -0.05,
    z: 0.06,
    heading: Math.PI / 2,
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

/** One torpedo strike on one merchant, with the boat's crit chance set. */
function strike(critChance: number, tick = 100, fish: Partial<Torpedo> = {}): {
  before: GameState;
  after: GameState;
  lost: number;
} {
  const start = base();
  const sea = clearWater(start);
  const before: GameState = {
    ...start,
    tick,
    ships: [targetShip({ x: sea.x, y: sea.y })],
    torpedoes: [playerFish({ x: sea.x, y: sea.y - 0.05, ...fish })],
    messages: [],
    submarine: { ...start.submarine, critChance, x: sea.x - 30, y: sea.y - 30 },
  };
  const after = advanceOrdnance(before, FIXED_DT);
  return { before, after, lost: before.ships[0]!.hp - after.ships[0]!.hp };
}

const critMessages = (state: GameState) => state.messages.filter((m) => m.text.startsWith('CRIT'));

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

const at = (state: GameState, time: number): GameState => ({ ...state, time });

describe('combat state defaults', () => {
  it('starts with no streak, no bonus and no crit chance', () => {
    const state = createGame(7);
    expect(state.stats.combo).toBe(0);
    expect(state.stats.comboExpires).toBe(0);
    expect(state.stats.bonusScore).toBe(0);
    expect(state.submarine.critChance).toBe(0);
  });
});

describe('crit roll', () => {
  it('is deterministic for the same seed, tick and torpedo', () => {
    expect(critRoll(7, 100, 'fish-1')).toBe(critRoll(7, 100, 'fish-1'));
    expect(critRoll(99, 4000, 'tp-12')).toBe(critRoll(99, 4000, 'tp-12'));
  });

  it('stays in [0, 1) and varies with each input', () => {
    const rolls = new Set<number>();
    for (let tick = 0; tick < 200; tick++) {
      const roll = critRoll(7, tick, 'fish-1');
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
      rolls.add(roll);
    }
    expect(rolls.size).toBeGreaterThan(190);
    expect(critRoll(7, 100, 'fish-1')).not.toBe(critRoll(8, 100, 'fish-1'));
    expect(critRoll(7, 100, 'fish-1')).not.toBe(critRoll(7, 100, 'fish-2'));
  });

  it('never rolls at zero chance and always crits at full chance', () => {
    for (let tick = 0; tick < 50; tick++) {
      expect(rollCrit(7, tick, 'fish-1', 0)).toBe(false);
      expect(rollCrit(7, tick, 'fish-1', 1)).toBe(true);
    }
  });

  it('crits exactly when the seeded roll falls under the chance', () => {
    const chance = 0.15;
    let crits = 0;
    for (let tick = 0; tick < 2000; tick++) {
      const crit = rollCrit(7, tick, 'fish-1', chance);
      expect(crit).toBe(critRoll(7, tick, 'fish-1') < chance);
      if (crit) crits++;
    }
    expect(crits / 2000).toBeGreaterThan(0.1);
    expect(crits / 2000).toBeLessThan(0.2);
  });
});

describe('crit on a player torpedo hit', () => {
  it('is off by default: no message and the random stream is untouched', () => {
    const { before, after, lost } = strike(0);
    expect(lost).toBeGreaterThan(0);
    expect(critMessages(after)).toHaveLength(0);
    expect(after.rngState).toBe(before.rngState);
  });

  it('deals double damage and posts CRIT -N when the roll lands', () => {
    const plain = strike(0);
    const crit = strike(1);
    expect(CRIT_MULTIPLIER).toBe(2);
    expect(crit.lost).toBeCloseTo(plain.lost * 2, 9);
    const messages = critMessages(crit.after);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe(`CRIT -${Math.round(crit.lost)}`);
    expect(crit.after.rngState).toBe(crit.before.rngState);
  });

  it('is deterministic: the same inputs give the same outcome', () => {
    const a = strike(0.5, 321);
    const b = strike(0.5, 321);
    expect(a.after.ships).toEqual(b.after.ships);
    expect(a.after.messages).toEqual(b.after.messages);
  });

  it('follows the seeded roll for a partial chance', () => {
    const chance = 0.5;
    const seed = base().seed;
    const lowTick = Array.from({ length: 400 }, (_, i) => i).find(
      (tick) => critRoll(seed, tick, 'fish-1') < chance,
    )!;
    const highTick = Array.from({ length: 400 }, (_, i) => i).find(
      (tick) => critRoll(seed, tick, 'fish-1') >= chance,
    )!;
    expect(critMessages(strike(chance, lowTick).after)).toHaveLength(1);
    expect(critMessages(strike(chance, highTick).after)).toHaveLength(0);
  });

  it('does not crit on a miss or an unarmed fish', () => {
    const unarmed = strike(1, 100, { armDelay: 5, run: 0 });
    expect(unarmed.lost).toBe(0);
    expect(critMessages(unarmed.after)).toHaveLength(0);
  });
});

describe('combo bonus helpers', () => {
  it('adds 10% per step beyond the first and caps at 50%', () => {
    expect(comboBonusFraction(0)).toBe(0);
    expect(comboBonusFraction(1)).toBe(0);
    expect(comboBonusFraction(2)).toBeCloseTo(0.1, 9);
    expect(comboBonusFraction(5)).toBeCloseTo(0.4, 9);
    expect(comboBonusFraction(6)).toBeCloseTo(COMBO_BONUS_CAP, 9);
    expect(comboBonusFraction(40)).toBeCloseTo(COMBO_BONUS_CAP, 9);
  });

  it('names streaks 2, 3 and 5 only', () => {
    expect(comboBanner(1)).toBeNull();
    expect(comboBanner(2)).toBe('DOUBLE KILL');
    expect(comboBanner(3)).toBe('TRIPLE KILL');
    expect(comboBanner(4)).toBeNull();
    expect(comboBanner(5)).toBe('RAMPAGE');
    expect(comboBanner(6)).toBeNull();
  });
});

describe('combo streak', () => {
  it('opens a 12 second window on the first kill with no bonus or banner', () => {
    const state = at(base(), 30);
    const next = registerKills(state, [150]);
    expect(next.stats.combo).toBe(1);
    expect(next.stats.comboExpires).toBe(30 + COMBO_WINDOW);
    expect(next.stats.bonusScore).toBe(0);
    expect(next.messages).toEqual(state.messages);
  });

  it('extends inside the window and pays 10% of that kill per extra step', () => {
    let state = registerKills(at(base(), 30), [150]);
    state = registerKills(at(state, 38), [200]);
    expect(state.stats.combo).toBe(2);
    expect(state.stats.comboExpires).toBe(38 + COMBO_WINDOW);
    expect(state.stats.bonusScore).toBe(20); // 10% of 200
    state = registerKills(at(state, 40), [300]);
    expect(state.stats.combo).toBe(3);
    expect(state.stats.bonusScore).toBe(20 + 60); // 20% of 300
  });

  it('counts a kill exactly at the window edge but not after it', () => {
    const first = registerKills(at(base(), 10), [150]);
    expect(registerKills(at(first, 10 + COMBO_WINDOW), [150]).stats.combo).toBe(2);
    const late = registerKills(at(first, 10 + COMBO_WINDOW + 0.01), [150]);
    expect(late.stats.combo).toBe(1);
    expect(late.stats.bonusScore).toBe(0);
  });

  it('caps the bonus at +50% however long the streak runs', () => {
    let state = at(base(), 0);
    for (let i = 0; i < 9; i++) state = registerKills(at(state, i * 2), [100]);
    expect(state.stats.combo).toBe(9);
    // steps 2..9 pay 10, 20, 30, 40, 50, 50, 50, 50
    expect(state.stats.bonusScore).toBe(10 + 20 + 30 + 40 + 50 * 4);
  });

  it('handles several kills in one step as consecutive streak steps', () => {
    const next = registerKills(at(base(), 5), [150, 150]);
    expect(next.stats.combo).toBe(2);
    expect(next.stats.bonusScore).toBe(15);
    expect(next.messages.map((m) => m.text)).toContain('DOUBLE KILL');
  });

  it('never touches the base score', () => {
    const state = { ...at(base(), 5), stats: { ...base().stats, score: 450 } };
    const next = registerKills(registerKills(state, [150]), [150]);
    expect(next.stats.score).toBe(450);
  });

  it('posts banners at streaks 2, 3 and 5 with a short lifetime', () => {
    let state = at(base(), 0);
    const seen: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const before = state.messages.length;
      state = registerKills(at(state, i), [150]);
      seen.push(state.messages.slice(before).map((m) => m.text));
    }
    expect(seen).toEqual([
      [],
      ['DOUBLE KILL'],
      ['TRIPLE KILL'],
      [],
      ['RAMPAGE'],
      [],
    ]);
    const banner = state.messages.find((m) => m.text === 'RAMPAGE')!;
    expect(banner.ttl).toBeCloseTo(3, 9);
    expect(new Set(state.messages.map((m) => m.id)).size).toBe(state.messages.length);
  });

  it('is a no-op for an empty kill list', () => {
    const state = base();
    expect(registerKills(state, [])).toBe(state);
  });

  it('does not mutate the state it was given', () => {
    const state = at(base(), 5);
    const frozen = JSON.stringify(state.stats);
    registerKills(state, [150, 150]);
    expect(JSON.stringify(state.stats)).toBe(frozen);
  });
});

describe('combo expiry', () => {
  it('resets the streak once sim time passes the window', () => {
    const live = registerKills(at(base(), 10), [150]);
    expect(expireCombo(at(live, 10 + COMBO_WINDOW))).toEqual(at(live, 10 + COMBO_WINDOW));
    const expired = expireCombo(at(live, 10 + COMBO_WINDOW + 0.5));
    expect(expired.stats.combo).toBe(0);
    expect(expired.stats.bonusScore).toBe(live.stats.bonusScore);
  });

  it('returns the same state when there is nothing to expire', () => {
    const state = base();
    expect(expireCombo(state)).toBe(state);
  });
});

describe('combo through the damage system', () => {
  it('keeps score as base points and puts the streak bonus in bonusScore', () => {
    const first = sink(at(base(), 20), 'merchant');
    expect(first.stats.score).toBe(150);
    expect(first.stats.combo).toBe(1);
    expect(first.stats.bonusScore).toBe(0);

    const second = sink(at(first, 24), 'merchant');
    expect(second.stats.score).toBe(300);
    expect(second.stats.combo).toBe(2);
    expect(second.stats.bonusScore).toBe(15);
    expect(second.messages.some((m) => m.text === 'DOUBLE KILL')).toBe(true);
  });

  it('restarts the streak when the window has lapsed before the next kill', () => {
    const first = sink(at(base(), 20), 'merchant');
    const later = sink(at(first, 20 + COMBO_WINDOW + 3), 'merchant');
    expect(later.stats.combo).toBe(1);
    expect(later.stats.bonusScore).toBe(0);
    expect(later.stats.score).toBe(300);
  });

  it('clears an expired streak on a step with no kill', () => {
    const live = sink(at(base(), 20), 'merchant');
    const quiet = systems.damage(at(live, 20 + COMBO_WINDOW + 1), [], FIXED_DT);
    expect(quiet.stats.combo).toBe(0);
  });

  it('leaves a quiet default step untouched', () => {
    const state = base();
    expect(systems.damage(state, [], FIXED_DT)).toBe(state);
  });
});
