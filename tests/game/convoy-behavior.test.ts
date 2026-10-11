import { describe, expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import {
  EMERGENCY_TURN,
  MERCHANT_TORPEDO_RANGE,
  ZIGZAG_ANGLE,
  ZIGZAG_LEG,
  convoyAlerted,
  convoyMerchantIntent,
  zigzagOffset,
} from '../../src/game/sim/convoy-behavior';
import { merchantIntent } from '../../src/game/sim/escort-doctrine';
import type { GameState, Ship } from '../../src/game/sim/types';
import {
  FIXED_DT,
  angleDiff,
  lab,
  playerTorpedo,
  ship,
  shipFixture,
  stepFor,
} from './support/escort-lab';

const FAR_SUB = { x: 10, y: 10, z: 0.9, silentRunning: true, hp: 9999, maxHp: 9999 };
const merchantAt = (id: string, x: number, y: number, partial: Partial<Ship> = {}) =>
  shipFixture({ id, kind: 'merchant', x, y, speed: 1.15, hp: 95, maxHp: 95, ...partial });
const run = (m: Ship, state: GameState, basePursuit = 0) =>
  convoyMerchantIntent(
    m,
    merchantIntent(m, basePursuit, state, FIXED_DT),
    basePursuit,
    state,
    FIXED_DT,
    {
      isAnchor: true,
    },
  );

describe('convoy zigzag (A8)', () => {
  it('is a deterministic ±30 degree offset that alternates about every 40 s', () => {
    expect(ZIGZAG_ANGLE).toBeCloseTo(Math.PI / 6, 6);
    expect(ZIGZAG_LEG).toBeGreaterThanOrEqual(35);
    expect(ZIGZAG_LEG).toBeLessThanOrEqual(45);
    const legs = [5, 45, 85, 125].map((t) => zigzagOffset('merch-1', t));
    for (const leg of legs) expect(Math.abs(leg)).toBeCloseTo(Math.PI / 6, 6);
    expect(Math.sign(legs[0]!)).toBe(-Math.sign(legs[1]!));
    expect(Math.sign(legs[1]!)).toBe(-Math.sign(legs[2]!));
    expect(zigzagOffset('merch-1', 5)).toBe(zigzagOffset('merch-1', 5));
  });

  it('only runs when the convoy is alerted', () => {
    const m = merchantAt('merch-1', 60, 60);
    const calm = lab([m, shipFixture({ id: 'esc', x: 64, y: 60, alert: 0 })], FAR_SUB);
    expect(convoyAlerted(m, calm)).toBe(false);
    expect(run(m, calm).heading).toBeNull();
    const alerted = lab([m, shipFixture({ id: 'esc', x: 64, y: 60, alert: 0.6 })], FAR_SUB);
    expect(convoyAlerted(m, alerted)).toBe(true);
    const out = run(m, alerted, 0.2);
    expect(Math.abs(angleDiff(out.heading!, 0.2))).toBeCloseTo(Math.PI / 6, 6);
    // A distant alarm is not the convoy's alarm.
    const distant = lab([m, shipFixture({ id: 'esc', x: 110, y: 60, alert: 0.9 })], FAR_SUB);
    expect(convoyAlerted(m, distant)).toBe(false);
  });

  it('leaves followers on their formation slot and the existing evasive weave alone', () => {
    const m = merchantAt('merch-1', 60, 60);
    const state = lab([m, shipFixture({ id: 'esc', x: 64, y: 60, alert: 0.6 })], FAR_SUB);
    const follower = convoyMerchantIntent(
      m,
      merchantIntent(m, 0, state, FIXED_DT),
      0,
      state,
      FIXED_DT,
      {
        isAnchor: false,
      },
    );
    expect(follower.heading).toBeNull();
    const nervous = merchantAt('merch-2', 60, 62, { alert: 0.6, lastKnownX: 70, lastKnownY: 60 });
    const own = merchantIntent(nervous, 0, state, FIXED_DT);
    const out = convoyMerchantIntent(nervous, own, 0, state, FIXED_DT, { isAnchor: true });
    expect(out.heading).toBe(own.heading);
  });

  it('snakes across the base course in real update steps, flipping each leg', () => {
    const merchant = merchantAt('merch-1', 20, 60, { path: [{ x: 120, y: 60 }] });
    const escort = shipFixture({ id: 'esc', x: 25, y: 65, alert: 1 });
    const bearingOf = (s: Ship) => Math.atan2(60 - s.y, 120 - s.x);
    const keepAlerted = (next: GameState) => {
      const m = ship(next, 'merch-1');
      return {
        ...next,
        ships: next.ships.map((s) =>
          s.id === 'esc' ? { ...s, x: m.x + 4, y: m.y + 4, alert: 1 } : s,
        ),
      };
    };
    let state = lab([merchant, escort], FAR_SUB);
    state = stepFor(state, 30, keepAlerted);
    const first = angleDiff(ship(state, 'merch-1').heading, bearingOf(ship(state, 'merch-1')));
    state = stepFor(state, 40, keepAlerted);
    const second = angleDiff(ship(state, 'merch-1').heading, bearingOf(ship(state, 'merch-1')));
    expect(Math.abs(first)).toBeGreaterThan(0.35);
    expect(Math.abs(second)).toBeGreaterThan(0.35);
    expect(Math.sign(first)).toBe(-Math.sign(second));
  }, 30_000);
});

describe('convoy emergency turn (A8)', () => {
  const torpedoAt = (x: number, y: number, toward: Ship) =>
    playerTorpedo({ x, y, heading: Math.atan2(toward.y - y, toward.x - x) });

  /** An alerted convoy: a consort escort has raised the alarm. */
  const alertedLab = (m: Ship) =>
    lab([m, shipFixture({ id: 'esc', x: 52, y: 56, alert: 1 })], FAR_SUB);

  it('turns 45 degrees away from the bearing of a torpedo detected inside 14 units', () => {
    expect(EMERGENCY_TURN).toBeCloseTo(Math.PI / 4, 6);
    expect(MERCHANT_TORPEDO_RANGE).toBeGreaterThanOrEqual(13);
    expect(MERCHANT_TORPEDO_RANGE).toBeLessThanOrEqual(15);
    const m = merchantAt('merch-1', 60, 60);
    const state = {
      ...alertedLab(m),
      torpedoes: [torpedoAt(67, 64, m)],
    };
    const bearing = Math.atan2(4, 7);
    const out = run(m, state);
    expect(out.ship.emergencyTimer ?? 0).toBeGreaterThan(0);
    expect(Math.abs(angleDiff(out.heading!, m.heading))).toBeCloseTo(Math.PI / 4, 6);
    // Away: the torpedo ends up further off the bow than before.
    expect(Math.abs(angleDiff(bearing, out.heading!))).toBeGreaterThan(
      Math.abs(angleDiff(bearing, m.heading)),
    );
    expect(out.speedFrac).toBe(1);
  });

  it('ignores a torpedo outside range or running past', () => {
    const m = merchantAt('merch-1', 60, 60);
    const far = {
      ...alertedLab(m),
      torpedoes: [torpedoAt(60 + MERCHANT_TORPEDO_RANGE + 3, 62, m)],
    };
    expect(run(m, far).ship.emergencyTimer ?? 0).toBe(0);
    const past = {
      ...alertedLab(m),
      torpedoes: [{ ...torpedoAt(67, 64, m), heading: 0 }],
    };
    expect(run(m, past).ship.emergencyTimer ?? 0).toBe(0);
  });

  it('does not spot the wake while the convoy is still calm', () => {
    const m = merchantAt('merch-1', 60, 60);
    const calm = { ...lab([m], FAR_SUB), torpedoes: [torpedoAt(67, 64, m)] };
    expect(run(m, calm).ship.emergencyTimer ?? 0).toBe(0);
  });

  it('swings the hull through the turn in real update steps, then lets it go', () => {
    const m = merchantAt('merch-1', 60, 60);
    const start = { ...alertedLab(m), torpedoes: [torpedoAt(67, 64, m)] };
    const parked = start.torpedoes;
    let state = stepFor(start, 4, (next) => ({
      ...next,
      torpedoes: parked,
      ships: next.ships.map((s) => (s.id === 'esc' ? { ...s, alert: 1 } : s)),
    }));
    expect(Math.abs(angleDiff(ship(state, 'merch-1').heading, -Math.PI / 4))).toBeLessThan(0.1);
    state = stepFor({ ...state, torpedoes: [] }, 20);
    expect(ship(state, 'merch-1').emergencyTimer ?? 0).toBe(0);
  }, 30_000);

  it('picks the side that keeps the hull out of land', () => {
    const m = merchantAt('merch-1', 60, 60);
    const state = { ...alertedLab(m), torpedoes: [torpedoAt(67, 64, m)] };
    // Water only north of y = 59: the clockwise turn would run ashore.
    const onlyNorth = (_x: number, y: number) => y > 59;
    const out = convoyMerchantIntent(m, merchantIntent(m, 0, state, FIXED_DT), 0, state, FIXED_DT, {
      isAnchor: true,
      clear: onlyNorth,
    });
    expect(angleDiff(out.heading!, Math.PI / 4)).toBeCloseTo(0, 6);
  });
});

describe('convoy scatter (A8)', () => {
  function struck(): GameState {
    const merchants = [
      merchantAt('merch-1', 60, 60),
      merchantAt('merch-2', 62, 64),
      merchantAt('merch-3', 58, 56),
    ];
    const victim = shipFixture({
      id: 'victim',
      x: 66,
      y: 60,
      lastHitX: 66,
      lastHitY: 60,
      lastHitTime: 0,
    });
    return { ...lab([...merchants, victim], FAR_SUB), time: 0.1 };
  }

  it('answers a hit with a 45 degree emergency turn away from it', () => {
    const state = struck();
    const m = ship(state, 'merch-1');
    const out = run(m, state, 0);
    expect(out.ship.emergencyTimer ?? 0).toBeGreaterThan(0);
    expect(Math.abs(angleDiff(out.heading!, m.heading))).toBeCloseTo(Math.PI / 4, 6);
    expect(out.ship.scatterTimer ?? 0).toBeGreaterThan(29);
  });

  it('then scatters on divergent bearings by ship index', () => {
    let state = struck();
    state = stepFor(state, 20);
    const headings = ['merch-1', 'merch-2', 'merch-3'].map((id) => ship(state, id).heading);
    for (let i = 0; i < headings.length; i += 1) {
      for (let j = i + 1; j < headings.length; j += 1) {
        expect(Math.abs(angleDiff(headings[i]!, headings[j]!))).toBeGreaterThan(0.3);
      }
    }
  }, 30_000);

  it('is deterministic', () => {
    const go = () => canonicalSnapshot(stepFor(struck(), 15));
    expect(go()).toBe(go());
  }, 30_000);
});
