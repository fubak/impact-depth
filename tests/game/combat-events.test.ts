import { describe, expect, it } from 'vitest';
import { collectOverSteps, deriveCombatEvents } from '../../src/game/adapt/combat-events';
import { createGame, startMission } from '../../src/game/sim/api';
import type { DepthCharge, GameState, Powerup, Ship, Torpedo } from '../../src/game/sim/types';

function mission(): { state: GameState; ship: Ship } {
  const started = startMission(createGame(1));
  const ship = started.ships[0];
  if (!ship) throw new Error('mission should spawn a ship');
  return {
    ship,
    state: {
      ...started,
      phase: 'playing',
      ships: [],
      torpedoes: [],
      depthCharges: [],
      countermeasures: [],
      powerups: [],
      sonarPing: 0,
    },
  };
}

function shipAt(template: Ship, id: string, x: number, y: number, hp: number): Ship {
  return { ...template, id, name: id, x, y, hp, maxHp: Math.max(hp, template.maxHp) };
}

function torpedo(id: string, x: number, y: number, z: number): Torpedo {
  return {
    id,
    owner: 'player',
    kind: 'mk14',
    sourceId: 'player',
    x,
    y,
    z,
    heading: 0.4,
    speed: 9.5,
    life: 8,
    armDelay: 0,
    damage: 48,
    targetId: null,
    turnRate: 2.2,
    run: 4,
  };
}

const adapterSource = import.meta.glob<string>('../../src/game/adapt/combat-events.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
});

describe('deriveCombatEvents', () => {
  it('attributes one step of a two-torpedo spread to two different hulls', () => {
    const { state, ship } = mission();
    // Both fish are closer to ship-a. Exclusive nearest-match is what keeps the target ids apart.
    const shipA = shipAt(ship, 'ship-a', 0, 0, 100);
    const shipB = shipAt(ship, 'ship-b', 2.5, 0, 100);
    const first = torpedo('t1', 0, 0, 0.4);
    const second = torpedo('t2', 0.4, 0, 0.4);
    const prev = { ...state, ships: [shipA, shipB], torpedoes: [first, second] };
    const next = {
      ...prev,
      ships: [
        { ...shipA, hp: 40 },
        { ...shipB, hp: 55 },
      ],
      torpedoes: [],
    };

    const hits = deriveCombatEvents(prev, next).filter((event) => event.type === 'torpedoHit');

    expect(hits).toHaveLength(2);
    expect(hits.map((event) => event.targetId).sort()).toEqual(['ship-a', 'ship-b']);
    expect(hits).toEqual(
      expect.arrayContaining([
        { type: 'torpedoHit', id: 't1', targetId: 'ship-a', x: 0, y: 0, z: 0.4 },
        { type: 'torpedoHit', id: 't2', targetId: 'ship-b', x: 0.4, y: 0, z: 0.4 },
      ]),
    );
  });

  it('keeps every event from nine fixed steps, the catch-up a 7 fps frame performs', () => {
    const { state } = mission();
    const states: GameState[] = [{ ...state, stats: { ...state.stats, wave: 1 } }];
    for (let step = 1; step <= 9; step += 1) {
      const prev = states[step - 1]!;
      states.push({
        ...prev,
        tick: prev.tick + 1,
        countermeasures: [
          { id: `cm-${step}`, kind: 'bubble', x: step, y: 0, z: 0.2, life: 10, radius: 4 },
        ],
      });
    }
    const born = torpedo('mid', 1, 2, 0.2);
    states[3] = { ...states[3]!, torpedoes: [born] };
    states[4] = { ...states[4]!, torpedoes: [{ ...born, x: 2 }] };

    const events = collectOverSteps(states);

    const countermeasures = events.filter((event) => event.type === 'countermeasure');
    expect(countermeasures.map((event) => event.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(events).toContainEqual({
      type: 'torpedoLaunch',
      owner: 'player',
      id: 'mid',
      x: 1,
      y: 2,
      z: 0.2,
      heading: 0.4,
    });
    expect(events).toContainEqual({ type: 'torpedoExpired', id: 'mid', x: 2, y: 2, z: 0.2 });
  });

  it('emits torpedoExpired when the fish vanishes and no hull within 3 units lost hp', () => {
    const { state, ship } = mission();
    const near = shipAt(ship, 'near', 0, 0, 80);
    const far = shipAt(ship, 'far', 20, 0, 100);
    const spent = torpedo('spent', 0.2, 0.1, 0.5);
    const prev = { ...state, ships: [near, far], torpedoes: [spent] };
    const next = {
      ...prev,
      ships: [near, { ...far, hp: 40 }],
      torpedoes: [],
    };

    const events = deriveCombatEvents(prev, next);

    expect(events.some((event) => event.type === 'torpedoHit')).toBe(false);
    expect(events).toContainEqual({ type: 'torpedoExpired', id: 'spent', x: 0.2, y: 0.1, z: 0.5 });
  });

  it('does not import three', () => {
    const source = adapterSource['../../src/game/adapt/combat-events.ts'];
    expect(source).toEqual(expect.any(String));
    expect(source).not.toMatch(/from\s+['"]three['"]/);
    expect(source).not.toMatch(/import\s+['"]three['"]/);
  });

  it('derives the other cues from one snapshot pair', () => {
    const { state, ship } = mission();
    const sub = { ...state.submarine, x: 10, y: 12, z: 0.5, hp: 90 };
    const victim = shipAt(ship, 'victim', 5, 5, 30);
    const nearCharge: DepthCharge = {
      id: 'dc-near',
      kind: 'depthCharge',
      sourceId: 'escort',
      x: 10,
      y: 12,
      z: 0.45,
      vz: 1.6,
      fuse: 0,
      damage: 45,
      radius: 2,
      targetDepth: 0.5,
    };
    const farCharge: DepthCharge = { ...nearCharge, id: 'dc-far', x: 40, y: 40, radius: 1 };
    const taken: Powerup = { id: 'kit', kind: 'health', x: 10, y: 12, life: 20 };
    const missed: Powerup = { id: 'far-kit', kind: 'ammo', x: 30, y: 30, life: 1 };
    const prev: GameState = {
      ...state,
      submarine: sub,
      ships: [victim],
      depthCharges: [nearCharge, farCharge],
      powerups: [taken, missed],
      stats: { ...state.stats, wave: 1, powerupsTaken: 0 },
    };
    const next: GameState = {
      ...prev,
      phase: 'victory',
      submarine: { ...sub, hp: 70 },
      ships: [],
      torpedoes: [{ ...torpedo('fish', 3, 4, 0.3), heading: 1.2, owner: 'enemy' }],
      depthCharges: [],
      countermeasures: [{ id: 'fox', kind: 'foxer', x: 8, y: 9, z: 0.2, life: 14, radius: 3.5 }],
      powerups: [],
      sonarPing: 4.8,
      stats: { ...prev.stats, wave: 2, powerupsTaken: 1 },
    };

    const events = deriveCombatEvents(prev, next);

    expect(events).toContainEqual({
      type: 'torpedoLaunch',
      owner: 'enemy',
      id: 'fish',
      x: 3,
      y: 4,
      z: 0.3,
      heading: 1.2,
    });
    expect(events).toContainEqual({
      type: 'shipSunk',
      id: 'victim',
      kind: victim.kind,
      x: 5,
      y: 5,
    });
    expect(events).toContainEqual({ type: 'chargeBlast', x: 10, y: 12, z: 0.45, near: true });
    expect(events).toContainEqual({ type: 'chargeBlast', x: 40, y: 40, z: 0.45, near: false });
    expect(events).toContainEqual({ type: 'playerHit', damage: 20, x: 10, y: 12 });
    expect(events).toContainEqual({ type: 'countermeasure', kind: 'foxer', x: 8, y: 9 });
    expect(events).toContainEqual({ type: 'sonarPing' });
    expect(events.filter((event) => event.type === 'pickup')).toEqual([
      { type: 'pickup', x: 10, y: 12 },
    ]);
    expect(events).toContainEqual({ type: 'waveStart', wave: 2 });
    expect(events).toContainEqual({ type: 'victory' });

    const over = deriveCombatEvents(
      { ...state, submarine: { ...sub, hp: 10 } },
      { ...state, phase: 'gameover', submarine: { ...sub, hp: 0 } },
    );
    expect(over).toContainEqual({ type: 'playerHit', damage: 10, x: 10, y: 12 });
    expect(over).toContainEqual({ type: 'gameover' });
    expect(over.some((event) => event.type === 'victory')).toBe(false);

    const decayed = deriveCombatEvents({ ...state, sonarPing: 4.8 }, { ...state, sonarPing: 4.5 });
    expect(decayed.some((event) => event.type === 'sonarPing')).toBe(false);
  });
});
