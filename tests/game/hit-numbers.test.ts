import { describe, expect, it } from 'vitest';
import { deriveHitNumbers } from '../../src/game/adapt/hit-numbers';
import { createGame, startMission } from '../../src/game/sim/api';
import { xpForKill } from '../../src/game/sim/progression';
import type { Detonation, GameState, Ship } from '../../src/game/sim/types';

function setup(): { s: GameState; ship: Ship } {
  const s = startMission(createGame(7));
  const ship = s.ships[0]!;
  return { s, ship };
}

function torpedoHit(hitId: string | null, overrides: Partial<Detonation> = {}): Detonation {
  return {
    id: 'mk14-9',
    kind: 'torpedo',
    owner: 'player',
    x: 10,
    y: 11,
    z: 0.3,
    yield: 60,
    hitId,
    surface: false,
    ...overrides,
  };
}

function hitStates(
  s: GameState,
  ship: Ship,
  hpAfter: number,
  det: Detonation,
  messages: GameState['messages'] = [],
): { prev: GameState; next: GameState } {
  const prev: GameState = { ...s, detonations: [] };
  const next: GameState = {
    ...s,
    ships: s.ships.map((x) => (x.id === ship.id ? { ...x, hp: hpAfter } : x)),
    detonations: [det],
    messages,
  };
  return { prev, next };
}

describe('deriveHitNumbers: hits', () => {
  it('reports a plain player hit as damage with the rounded hp loss', () => {
    const { s, ship } = setup();
    const det = torpedoHit(ship.id);
    const { prev, next } = hitStates(s, ship, ship.hp - 42, det);
    expect(deriveHitNumbers(prev, next)).toEqual([
      { id: 'hit-mk14-9', kind: 'damage', x: 10, y: 11, amount: 42, elite: false },
    ]);
  });

  it('marks the hit as a crit when a crit message carries the detonation id prefix', () => {
    const { s, ship } = setup();
    const det = torpedoHit(ship.id);
    const crit = { id: 'crit-mk14-9-0', text: 'CRIT -84', ttl: 2.8 };
    const { prev, next } = hitStates(s, ship, ship.hp - 42, det, [crit]);
    expect(deriveHitNumbers(prev, next)).toEqual([
      { id: 'hit-mk14-9', kind: 'crit', x: 10, y: 11, amount: 42, elite: false },
    ]);
  });

  it('ignores enemy-owned detonations', () => {
    const { s, ship } = setup();
    const det = torpedoHit(ship.id, { owner: 'enemy' });
    const { prev, next } = hitStates(s, ship, ship.hp - 42, det);
    expect(deriveHitNumbers(prev, next)).toEqual([]);
  });

  it('ignores hitId null and hitId player', () => {
    const { s, ship } = setup();
    for (const hitId of [null, 'player']) {
      const det = torpedoHit(hitId);
      const { prev, next } = hitStates(s, ship, ship.hp - 42, det);
      expect(deriveHitNumbers(prev, next)).toEqual([]);
    }
  });

  it('ignores a detonation that was already present in prev', () => {
    const { s, ship } = setup();
    const det = torpedoHit(ship.id);
    const { next } = hitStates(s, ship, ship.hp - 42, det);
    const prev: GameState = { ...s, detonations: [det] };
    expect(deriveHitNumbers(prev, next)).toEqual([]);
  });

  it('ignores an hp drop smaller than one point', () => {
    const { s, ship } = setup();
    const det = torpedoHit(ship.id);
    const { prev, next } = hitStates(s, ship, ship.hp - 0.4, det);
    expect(deriveHitNumbers(prev, next)).toEqual([]);
  });

  it('skips a hit whose target is missing from prev', () => {
    const { s, ship } = setup();
    const det = torpedoHit('ghost-ship');
    const { prev, next } = hitStates(s, ship, ship.hp - 42, det);
    expect(deriveHitNumbers(prev, next)).toEqual([]);
  });
});

describe('deriveHitNumbers: kills', () => {
  it('reports a removed ship as a kill worth its XP', () => {
    const { s, ship } = setup();
    const prev: GameState = { ...s, detonations: [] };
    const next: GameState = {
      ...s,
      ships: s.ships.filter((x) => x.id !== ship.id),
      detonations: [],
    };
    expect(deriveHitNumbers(prev, next)).toEqual([
      {
        id: `kill-${ship.id}`,
        kind: 'kill',
        x: ship.x,
        y: ship.y,
        amount: xpForKill(ship),
        elite: false,
      },
    ]);
  });

  it('flags an elite kill and uses the elite XP', () => {
    const { s, ship } = setup();
    const elite: Ship = { ...ship, elite: true };
    const prev: GameState = {
      ...s,
      ships: s.ships.map((x) => (x.id === ship.id ? elite : x)),
      detonations: [],
    };
    const next: GameState = {
      ...s,
      ships: s.ships.filter((x) => x.id !== ship.id),
      detonations: [],
    };
    expect(deriveHitNumbers(prev, next)).toEqual([
      {
        id: `kill-${ship.id}`,
        kind: 'kill',
        x: ship.x,
        y: ship.y,
        amount: xpForKill(elite),
        elite: true,
      },
    ]);
  });

  it('lists hits before kills', () => {
    const { s, ship } = setup();
    const other = s.ships[1]!;
    const det = torpedoHit(other.id);
    const prev: GameState = { ...s, detonations: [] };
    const next: GameState = {
      ...s,
      ships: s.ships
        .filter((x) => x.id !== ship.id)
        .map((x) => (x.id === other.id ? { ...x, hp: x.hp - 42 } : x)),
      detonations: [det],
      messages: [],
    };
    const numbers = deriveHitNumbers(prev, next);
    expect(numbers.map((n) => n.kind)).toEqual(['damage', 'kill']);
  });
});
