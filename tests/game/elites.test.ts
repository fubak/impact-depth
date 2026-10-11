import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission } from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import {
  ELITE_CHANCE,
  ELITE_HP_MULT,
  ELITE_MIN_WAVE,
  ELITE_XP_MULT,
  applyElites,
  eliteIndex,
} from '../../src/game/sim/elites';
import { rollLoot } from '../../src/game/sim/loot';
import { XP_PER_KILL, xpForKill } from '../../src/game/sim/progression';
import { SINK_DURATION } from '../../src/game/sim/ship-damage';
import { systems } from '../../src/game/sim/systems';
import type { GameState, Ship, ShipKind } from '../../src/game/sim/types';
import type { WorldVersion } from '../../src/game/world/definition';

const ESCORTS: readonly ShipKind[] = ['destroyer', 'patrol', 'cruiser'];
const BASE_HP: Record<ShipKind, number> = {
  merchant: 95,
  destroyer: 120,
  patrol: 50,
  cruiser: 200,
  battleship: 420,
  sub: 351,
};
const BASE_NAME: Record<ShipKind, string> = {
  merchant: 'FREIGHTER',
  destroyer: 'DESTROYER',
  patrol: 'PATROL',
  cruiser: 'CRUISER',
  battleship: 'BATTLESHIP',
  sub: 'U-BOAT',
};

const elitesOf = (ships: readonly Ship[]) => ships.filter((ship) => ship.elite === true);

/** Small non-cryptographic fingerprint so the snapshot below stays readable. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** First (seed, wave >= 2) pair that carries an elite. */
function findEliteWave(): { seed: number; wave: number; ships: Ship[] } {
  for (let seed = 1; seed < 80; seed++) {
    for (let wave = 2; wave <= 6; wave++) {
      const ships = seedWave(seed, wave);
      if (elitesOf(ships).length > 0) return { seed, wave, ships };
    }
  }
  throw new Error('no elite wave found');
}

describe('wave 1 is untouched', () => {
  it('never has an elite, for any seed or world', () => {
    for (let seed = 1; seed <= 150; seed++) {
      for (const world of ['legacy-v1', 'littoral-v2'] as const) {
        const ships = seedWave(seed, 1, undefined, world);
        expect(elitesOf(ships)).toHaveLength(0);
        expect(ships.every((ship) => !('elite' in ship))).toBe(true);
      }
    }
  });

  it('seeds byte-for-byte what it did before elites existed', () => {
    // Fingerprints of JSON.stringify(seedWave(seed, 1, ...)); re-captured when the convoy lead and
    // column moved onto a straight lane (elites still add nothing to wave 1).
    const expected: Record<string, string> = {
      '1-legacy-v1-bare': '2dd770b3',
      '1-legacy-v1-player': 'fb7ede52',
      '1-littoral-v2-bare': '2dd770b3',
      '1-littoral-v2-player': 'fb7ede52',
      '7-legacy-v1-bare': 'a9f697ed',
      '7-legacy-v1-player': 'eaf714e7',
      '7-littoral-v2-bare': '625c8146',
      '7-littoral-v2-player': 'd9ee5320',
      '42-legacy-v1-bare': '77e691e8',
      '42-legacy-v1-player': '361d0920',
      '42-littoral-v2-bare': '77e691e8',
      '42-littoral-v2-player': '361d0920',
      '1234-legacy-v1-bare': '881fb94f',
      '1234-legacy-v1-player': '9ce90ae5',
      '1234-littoral-v2-bare': 'd748cec5',
      '1234-littoral-v2-player': '5554b937',
    };
    const actual: Record<string, string> = {};
    for (const seed of [1, 7, 42, 1234]) {
      for (const world of ['legacy-v1', 'littoral-v2'] as const satisfies readonly WorldVersion[]) {
        const game = createGame(seed, world);
        actual[`${seed}-${world}-bare`] = fnv(JSON.stringify(seedWave(seed, 1, undefined, world)));
        actual[`${seed}-${world}-player`] = fnv(
          JSON.stringify(seedWave(seed, 1, game.ships[0], world, game.submarine)),
        );
      }
    }
    expect(actual).toEqual(expected);
  });

  it('applyElites returns the very same array before the minimum wave', () => {
    const ships = seedWave(7, 1);
    expect(applyElites(7, 1, ships)).toBe(ships);
    expect(applyElites(7, ELITE_MIN_WAVE - 1, ships)).toBe(ships);
    expect(eliteIndex(7, 1, ships)).toBe(-1);
  });

  it('starts a mission with no elite', () => {
    expect(elitesOf(startMission(createGame(7)).ships)).toHaveLength(0);
  });
});

describe('elite selection', () => {
  it('starts at wave 2', () => {
    expect(ELITE_MIN_WAVE).toBe(2);
  });

  it('is deterministic for the same seed and wave', () => {
    for (let wave = 2; wave <= 6; wave++) {
      expect(seedWave(9, wave)).toEqual(seedWave(9, wave));
      expect(eliteIndex(9, wave, seedWave(9, wave))).toBe(eliteIndex(9, wave, seedWave(9, wave)));
    }
  });

  it('makes at most one elite per wave and only ever an escort', () => {
    let waves = 0;
    let withElite = 0;
    for (let seed = 1; seed <= 120; seed++) {
      for (let wave = 2; wave <= 6; wave++) {
        const ships = seedWave(seed, wave);
        const elites = elitesOf(ships);
        waves++;
        expect(elites.length).toBeLessThanOrEqual(1);
        if (elites.length === 1) {
          withElite++;
          expect(ESCORTS).toContain(elites[0]!.kind);
        }
      }
    }
    // some waves have one, some do not: it is a seeded "may"
    expect(withElite).toBeGreaterThan(0);
    expect(withElite).toBeLessThan(waves);
    expect(withElite / waves).toBeGreaterThan(ELITE_CHANCE - 0.12);
    expect(withElite / waves).toBeLessThan(ELITE_CHANCE + 0.12);
  });

  it('never picks the lead merchant or a non-escort', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const ships = seedWave(seed, 3);
      const index = eliteIndex(seed, 3, ships);
      if (index >= 0) expect(ESCORTS).toContain(ships[index]!.kind);
    }
  });
});

describe('elite stats', () => {
  const { seed, wave, ships } = findEliteWave();
  const elite = elitesOf(ships)[0]!;

  it('has x1.6 hp and max hp, with the name prefixed ELITE', () => {
    expect(ELITE_HP_MULT).toBe(1.6);
    expect(elite.hp).toBe(Math.round(BASE_HP[elite.kind] * 1.6));
    expect(elite.maxHp).toBe(elite.hp);
    expect(elite.name).toBe(`ELITE ${BASE_NAME[elite.kind]}`);
  });

  it('leaves every other ship at its normal stats', () => {
    for (const ship of ships.filter((candidate) => candidate !== elite)) {
      expect(ship.elite).toBeUndefined();
      expect(ship.hp).toBe(BASE_HP[ship.kind]);
      expect(ship.maxHp).toBe(BASE_HP[ship.kind]);
      expect(ship.name).toBe(BASE_NAME[ship.kind]);
    }
  });

  it('keeps the elite in its formation slot with its original id', () => {
    expect(elite.id).toMatch(new RegExp(`^wave-${wave}-${elite.kind}-\\d+$`));
    expect(elite.formationAnchorId).toBe(ships[0]!.id);
  });

  it('is the same hull as the un-promoted one apart from hp, name and flag', () => {
    const stripped = ships.map((ship) =>
      ship.elite === true
        ? {
            ...ship,
            elite: undefined,
            hp: BASE_HP[ship.kind],
            maxHp: BASE_HP[ship.kind],
            name: BASE_NAME[ship.kind],
          }
        : ship,
    );
    expect(applyElites(seed, wave, stripped).map((s) => s.id)).toEqual(ships.map((s) => s.id));
    expect(elitesOf(applyElites(seed, wave, stripped))[0]!.id).toBe(elite.id);
  });

  it('does not mutate the ships it is given', () => {
    const plain = seedWave(seed, wave).map((ship) => ({ ...ship, elite: undefined }));
    const frozen = JSON.stringify(plain);
    applyElites(seed, wave, plain);
    expect(JSON.stringify(plain)).toBe(frozen);
  });
});

describe('elite rewards', () => {
  it('pays x3 XP', () => {
    expect(ELITE_XP_MULT).toBe(3);
    for (const kind of ESCORTS) {
      expect(xpForKill({ kind, elite: true })).toBe(XP_PER_KILL[kind] * 3);
      expect(xpForKill({ kind })).toBe(XP_PER_KILL[kind]);
      expect(xpForKill({ kind, elite: false })).toBe(XP_PER_KILL[kind]);
    }
  });

  function sinkOne(elite: boolean): GameState {
    const start = startMission(createGame(7));
    const template = start.ships[0]!;
    const ship: Ship = {
      ...template,
      id: 'wave-2-destroyer-5',
      kind: 'destroyer',
      hp: 0,
      sinking: 0.001,
      sinkDuration: SINK_DURATION.destroyer,
      path: [],
      formationAnchorId: null,
      ...(elite ? { elite: true } : {}),
    };
    return systems.damage({ ...start, tick: 31, powerups: [], ships: [ship] }, [], FIXED_DT);
  }

  it('awards triple XP through the damage system', () => {
    const normal = sinkOne(false); // 120 xp -> level 2, 55 left // Plan 030 XP retune
    const elite = sinkOne(true); // 360 xp -> level 4, 75 left // Plan 030 XP retune
    expect(normal.stats.level).toBe(2);
    expect(normal.stats.xp).toBe(55); // Plan 030 XP retune
    expect(elite.stats.level).toBe(4); // Plan 030 XP retune
    expect(elite.stats.xp).toBe(75); // Plan 030 XP retune
  });

  it('always drops a rare or epic crate at the wreck', () => {
    for (let tick = 1; tick <= 60; tick++) {
      const start = startMission(createGame(7));
      const ship: Ship = {
        ...start.ships[0]!,
        id: 'wave-2-cruiser-6',
        kind: 'cruiser',
        hp: 0,
        sinking: 0.001,
        sinkDuration: SINK_DURATION.cruiser,
        path: [],
        formationAnchorId: null,
        elite: true,
        x: 55,
        y: 60,
      };
      const next = systems.damage({ ...start, tick, powerups: [], ships: [ship] }, [], FIXED_DT);
      expect(next.powerups).toHaveLength(1);
      const crate = next.powerups[0]!;
      expect(crate.x).toBe(55);
      expect(crate.y).toBe(60);
      expect(['rare', 'epic']).toContain(crate.rarity);
      expect(crate.rarity).toBe(rollLoot(start.seed, tick, ship)!.rarity);
    }
  });

  it('can roll both rare and epic for an elite', () => {
    const seen = new Set<string>();
    const start = startMission(createGame(7));
    const ship: Ship = { ...start.ships[0]!, id: 'wave-3-cruiser-2', kind: 'cruiser', elite: true };
    for (let tick = 0; tick < 500; tick++) seen.add(rollLoot(7, tick, ship)!.rarity);
    expect([...seen].sort()).toEqual(['epic', 'rare']);
  });
});
