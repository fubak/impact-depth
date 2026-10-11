import { describe, expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import {
  ATTACK_RUN_CAP,
  ATTACK_RUN_RANGE,
  ATTACK_RUN_SPEED_FRAC,
  SEARCH_GIVE_UP,
  escortIntent,
} from '../../src/game/sim/escort-doctrine';
import {
  LISTEN_INTERVAL,
  LISTEN_SPEED_FRAC,
  THREAT_RANGE,
  THREAT_SPEED_FRAC,
  combHeading,
} from '../../src/game/sim/escort-realism';
import type { GameState } from '../../src/game/sim/types';
import {
  FIXED_DT,
  angleDiff,
  lab,
  playerTorpedo,
  prosecutor,
  ship,
  shipFixture,
  shipMaxSpeed,
  stepFor,
} from './support/escort-lab';

const SUB = { hp: 9999, maxHp: 9999, x: 60, y: 60 };
/** Deep, silent and far from every escort in these labs: nobody hears it. */
const GONE = { x: 10, y: 10, z: 0.9, targetDepth: 0.9, silentRunning: true };
const frac = (state: GameState, id: string) =>
  (ship(state, id).actualSpeed ?? 0) / shipMaxSpeed[ship(state, id).kind];

describe('escort speeds (A7)', () => {
  it('a searching escort never exceeds 0.6 of class speed', () => {
    const lost = lab(
      [
        shipFixture({
          doctrine: 'search',
          x: 75,
          datumX: 70,
          datumY: 60,
          lastFixTime: -20,
          alert: 0.5,
        }),
      ],
      { ...SUB, ...GONE },
    );
    let worst = 0;
    stepFor(lost, 15, (next) => {
      worst = Math.max(worst, frac(next, 'escort-1'));
      return next;
    });
    expect(worst).toBeGreaterThan(0.3);
    expect(worst).toBeLessThanOrEqual(0.6 + 1e-6);
  }, 30_000);

  it('an escort holding the contact with no free attack lane idles at or under 0.6', () => {
    const state = lab([], SUB);
    const holding = prosecutor('esc-h', 64, 60, { holdContact: 3 });
    const intent = escortIntent(holding, { x: 60, y: 60 }, state, FIXED_DT, ATTACK_RUN_CAP);
    expect(intent.ship.doctrine).toBe('prosecute');
    expect(intent.speedFrac).not.toBeNull();
    expect(intent.speedFrac!).toBeLessThanOrEqual(0.6);
  });

  it('prosecute outside the run range is still a flat-out closing speed', () => {
    const state = lab([], SUB);
    const far = prosecutor('esc-f', 60 + ATTACK_RUN_RANGE + 6, 60);
    const intent = escortIntent(far, { x: 60, y: 60 }, state, FIXED_DT, 0);
    expect(intent.speedFrac).toBe(1);
  });

  it('the attack run ramps to at least 0.8 of class speed', () => {
    const state = lab([], SUB);
    const runner = prosecutor('esc-r', 64, 60, { doctrine: 'attackRun' });
    const intent = escortIntent(runner, { x: 60, y: 60 }, state, FIXED_DT, 0);
    expect(intent.speedFrac!).toBeGreaterThanOrEqual(0.8);
    expect(ATTACK_RUN_SPEED_FRAC).toBeGreaterThanOrEqual(0.8);
    // And the hull really makes that speed once the run commits.
    const run = lab(
      [prosecutor('esc-r', 68, 60, { doctrine: 'attackRun', weaponCooldown: 999 })],
      SUB,
    );
    const after = stepFor(run, 1);
    expect(frac(after, 'esc-r')).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });
});

describe('post-attack listening (A10)', () => {
  /** One escort 0.5 u from a stationary boat, pattern ready to drop. */
  function atTheDatum(sub: Partial<GameState['submarine']> = {}): GameState {
    return lab(
      [prosecutor('esc-a', 60.6, 60, { doctrine: 'attackRun', heading: Math.PI, holdContact: 4 })],
      { ...SUB, ...sub },
    );
  }

  it('slows to listen for the listening interval after a pattern release', () => {
    expect(LISTEN_INTERVAL).toBeGreaterThanOrEqual(7);
    expect(LISTEN_INTERVAL).toBeLessThanOrEqual(9);
    const state = stepFor(atTheDatum(), FIXED_DT * 2);
    expect(state.depthCharges.length).toBeGreaterThan(0);
    expect(ship(state, 'esc-a').doctrine).toBe('reattack');
    expect(ship(state, 'esc-a').listenTimer ?? 0).toBeGreaterThan(LISTEN_INTERVAL - 0.2);
    let worst = 0;
    stepFor(state, LISTEN_INTERVAL - 0.5, (next) => {
      worst = Math.max(worst, frac(next, 'esc-a'));
      return next;
    });
    expect(worst).toBeLessThanOrEqual(LISTEN_SPEED_FRAC + 1e-6);
    expect(worst).toBeGreaterThan(0);
  }, 30_000);

  it('re-attacks when contact is regained after listening', () => {
    // An audible boat: the escort keeps hearing it through the listening interval.
    const seen = new Set<string>();
    const state = stepFor(atTheDatum(), LISTEN_INTERVAL + 3, (next) => {
      seen.add(ship(next, 'esc-a').doctrine ?? 'screen');
      return next;
    });
    expect(seen.has('reattack')).toBe(true);
    expect(seen.has('prosecute')).toBe(true);
    expect(seen.has('search')).toBe(false);
    expect(ship(state, 'esc-a').doctrine).not.toBe('search');
  }, 30_000);

  it('falls to expanding-square search, then back to screen, when contact stays lost', () => {
    let state = stepFor(atTheDatum(), FIXED_DT * 2);
    // The boat slips away deep and silent as the charges fall.
    state = { ...state, submarine: { ...state.submarine, ...GONE } };
    const seen = new Set<string>();
    state = stepFor(state, LISTEN_INTERVAL + SEARCH_GIVE_UP + 12, (next) => {
      seen.add(ship(next, 'esc-a').doctrine ?? 'screen');
      return next;
    });
    expect(seen.has('search')).toBe(true);
    expect(ship(state, 'esc-a').doctrine).toBe('screen');
  }, 60_000);

  it('a hedgehog release also starts the listening interval', () => {
    const state = lab(
      [prosecutor('esc-h', 63.5, 60, { heading: Math.PI, holdContact: 4, weaponCooldown: 0 })],
      SUB,
    );
    const after = stepFor(state, FIXED_DT * 3);
    expect(after.depthCharges.some((c) => c.kind === 'hedgehog')).toBe(true);
    expect(ship(after, 'esc-h').listenTimer ?? 0).toBeGreaterThan(LISTEN_INTERVAL - 0.2);
  });
});

describe('torpedo evasion (A9)', () => {
  it('combs bow-on or stern-on, whichever needs the smaller turn', () => {
    const bearing = Math.PI / 2;
    expect(combHeading(0.3, bearing)).toBeCloseTo(bearing, 6);
    expect(combHeading(2.5, bearing)).toBeCloseTo(bearing, 6);
    expect(Math.abs(angleDiff(combHeading(-1.2, bearing), -Math.PI / 2))).toBeLessThan(1e-6);
  });

  function threatened(heading: number, bearing: number, range = 12): GameState {
    const escort = shipFixture({ id: 'esc-t', x: 60, y: 60, heading, alert: 0.3 });
    const state = lab([escort], { ...SUB, ...GONE });
    const torpedo = playerTorpedo({
      x: 60 + Math.cos(bearing) * range,
      y: 60 + Math.sin(bearing) * range,
      heading: bearing + Math.PI,
    });
    return { ...state, torpedoes: [torpedo] };
  }
  /** Keep the torpedo parked on its mark so the threat lasts the whole run. */
  const hold = (state: GameState) => (next: GameState) => ({ ...next, torpedoes: state.torpedoes });

  it('turns its stern to a torpedo that needs the smaller stern turn, and runs', () => {
    const start = threatened(-1.2, Math.PI / 2);
    const after = stepFor(start, 2, hold(start));
    const escort = ship(after, 'esc-t');
    const sternOn = Math.abs(angleDiff(escort.heading, -Math.PI / 2));
    const bowOn = Math.abs(angleDiff(escort.heading, Math.PI / 2));
    expect(sternOn).toBeLessThan(0.12);
    expect(sternOn).toBeLessThan(bowOn);
    expect(frac(after, 'esc-t')).toBeGreaterThanOrEqual(0.9 - 1e-6);
    expect(THREAT_SPEED_FRAC).toBeGreaterThanOrEqual(0.9);
    expect(escort.threatTimer ?? 0).toBeGreaterThan(0);
  }, 30_000);

  it('turns its bow to a torpedo that is closer to the bow', () => {
    const start = threatened(0.3, Math.PI / 2);
    const after = stepFor(start, 2, hold(start));
    expect(Math.abs(angleDiff(ship(after, 'esc-t').heading, Math.PI / 2))).toBeLessThan(0.12);
  }, 30_000);

  it('resumes doctrine once the threat has passed', () => {
    const start = threatened(0.3, Math.PI / 2);
    let state = stepFor(start, 2, hold(start));
    expect(frac(state, 'esc-t')).toBeGreaterThanOrEqual(0.9 - 1e-6);
    state = { ...state, torpedoes: [] };
    state = stepFor(state, 3);
    expect(ship(state, 'esc-t').threatTimer ?? 0).toBe(0);
    expect(frac(state, 'esc-t')).toBeLessThan(0.9);
  }, 30_000);

  it('ignores a torpedo beyond the threat range or running past', () => {
    const far = threatened(0.3, Math.PI / 2, THREAT_RANGE + 4);
    expect(ship(stepFor(far, 1, hold(far)), 'esc-t').threatTimer ?? 0).toBe(0);
    const crossing = threatened(0.3, Math.PI / 2, 10);
    const passing = {
      ...crossing,
      torpedoes: [{ ...crossing.torpedoes[0]!, heading: 0 }],
    };
    expect(ship(stepFor(passing, 1, hold(passing)), 'esc-t').threatTimer ?? 0).toBe(0);
  });

  it('runs deterministically with torpedoes in the water', () => {
    const run = () => {
      const start = threatened(0.3, Math.PI / 2);
      return canonicalSnapshot(stepFor(start, 5, hold(start)));
    };
    expect(run()).toBe(run());
  }, 30_000);
});
