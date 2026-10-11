import { describe, expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import { BLIND_ZONE } from '../../src/game/sim/contact';
import {
  CREEPER_SPEED_FRAC,
  CREEP_ENGAGE_RANGE,
  CREEP_MAX_TARGET_SPEED,
  HOLDER_PING_PERIOD,
  HOLDER_SPEED_FRAC,
  HOLDER_STANDOFF,
  SIGNAL_MAX_AGE,
  assignCreepRoles,
  creeperIntent,
  creepSweepPulse,
} from '../../src/game/sim/creeping-attack';
import { PATTERN_DROP_RANGE, escortIntent } from '../../src/game/sim/escort-doctrine';
import { shipMachineryNoise } from '../../src/game/sim/sonar';
import type { GameState } from '../../src/game/sim/types';
import {
  FIXED_DT,
  lab,
  prosecutor,
  ship,
  shipMaxSpeed,
  shipFixture,
  stepFor,
} from './support/escort-lab';

const SUB = { hp: 9999, maxHp: 9999, x: 60, y: 60 };

/** Holder candidate 6 u east of a stationary, audible boat; second escort 7 u south. */
function pairLab(): GameState {
  return lab([prosecutor('esc-a', 66, 60), prosecutor('esc-b', 60, 67)], SUB);
}

describe('creeping attack (A6) — role assignment', () => {
  it('names the nearest escort with contact holder and the next one creeper', () => {
    const state = lab([prosecutor('esc-a', 66, 60), prosecutor('esc-b', 60, 68)], SUB);
    const roles = assignCreepRoles(state);
    expect(roles.get('esc-a')).toEqual({ role: 'holder', partnerId: 'esc-b' });
    expect(roles.get('esc-b')).toEqual({ role: 'creeper', partnerId: 'esc-a' });
  });

  it('writes the roles onto the ships through real update steps', () => {
    const state = stepFor(pairLab(), 0.5);
    expect(ship(state, 'esc-a').role).toBe('holder');
    expect(ship(state, 'esc-b').role).toBe('creeper');
    expect(ship(state, 'esc-a').creepPartnerId).toBe('esc-b');
    expect(ship(state, 'esc-b').creepPartnerId).toBe('esc-a');
  });

  it('needs two prosecuting escorts: a lone prosecutor gets no role', () => {
    const state = stepFor(lab([prosecutor('esc-a', 66, 60)], SUB), 0.5);
    expect(ship(state, 'esc-a').role).toBeUndefined();
    expect(assignCreepRoles(lab([prosecutor('esc-a', 66, 60)], SUB)).size).toBe(0);
  });

  it('does not creep against a boat that is running (datum speed above the gate)', () => {
    const fast = CREEP_MAX_TARGET_SPEED + 0.4;
    const state = lab(
      [
        prosecutor('esc-a', 66, 60, { datumVx: fast }),
        prosecutor('esc-b', 60, 67, { datumVx: fast }),
      ],
      SUB,
    );
    expect(assignCreepRoles(state).size).toBe(0);
  });

  it('keeps the same holder as the creeper closes inside the holder range', () => {
    const state = lab(
      [
        prosecutor('esc-a', 66, 60, { role: 'holder', creepPartnerId: 'esc-b' }),
        prosecutor('esc-b', 60.5, 60, { role: 'creeper', creepPartnerId: 'esc-a' }),
      ],
      SUB,
    );
    const roles = assignCreepRoles(state);
    expect(roles.get('esc-a')?.role).toBe('holder');
    expect(roles.get('esc-b')?.role).toBe('creeper');
  });

  it('ignores escorts that are screening, searching or sinking', () => {
    const state = lab(
      [
        prosecutor('esc-a', 66, 60),
        prosecutor('esc-b', 60, 67, { doctrine: 'search' }),
        prosecutor('esc-c', 55, 60, { doctrine: 'screen' }),
        prosecutor('esc-d', 55, 64, { sinking: 3 }),
      ],
      SUB,
    );
    expect(assignCreepRoles(state).size).toBe(0);
  });
});

describe('creeping attack (A6) — holder', () => {
  it('slows to the holder cap, pings, and never enters the dead zone', () => {
    expect(HOLDER_SPEED_FRAC).toBeLessThanOrEqual(0.4);
    expect(HOLDER_STANDOFF).toBeGreaterThanOrEqual(1.6 * BLIND_ZONE - 1e-9);
    let closest = Infinity;
    let maxFrac = 0;
    let pingSteps = 0;
    let steps = 0;
    stepFor(pairLab(), 40, (next) => {
      const holder = ship(next, 'esc-a');
      const dist = Math.hypot(holder.x - next.submarine.x, holder.y - next.submarine.y);
      closest = Math.min(closest, dist);
      if (holder.role === 'holder' && dist < CREEP_ENGAGE_RANGE) {
        maxFrac = Math.max(maxFrac, (holder.actualSpeed ?? 0) / shipMaxSpeed.destroyer);
        steps += 1;
        if (holder.pinging) pingSteps += 1;
      }
      return next;
    });
    expect(steps).toBeGreaterThan(100);
    expect(maxFrac).toBeLessThanOrEqual(0.4 + 1e-6);
    expect(pingSteps).toBe(steps);
    expect(closest).toBeGreaterThanOrEqual(1.6 * BLIND_ZONE - 0.05);
  }, 30_000);

  it('feeds fresh datum fixes to the creeper', () => {
    const start = pairLab();
    // Give the creeper a stale, wrong datum; the holder's live fix must replace it.
    const stale = {
      ...start,
      time: 5,
      ships: start.ships.map((s) =>
        s.id === 'esc-b'
          ? { ...s, datumX: 40, datumY: 40, lastFixTime: 0 }
          : { ...s, lastFixTime: 5 },
      ),
    };
    const next = stepFor(stale, 1);
    const creeper = ship(next, 'esc-b');
    expect(creeper.datumX).toBeCloseTo(60, 0);
    expect(creeper.datumY).toBeCloseTo(60, 0);
    expect(next.time - (creeper.lastFixTime ?? -99)).toBeLessThan(SIGNAL_MAX_AGE);
  });

  it('pings on its own short cadence; the creeper never does', () => {
    const t = HOLDER_PING_PERIOD * 3;
    expect(creepSweepPulse('holder', false, t, FIXED_DT)).toBe(true);
    expect(creepSweepPulse('holder', false, t + 0.5, FIXED_DT)).toBe(false);
    expect(creepSweepPulse('creeper', true, t, FIXED_DT)).toBe(false);
    expect(creepSweepPulse(undefined, true, 8, FIXED_DT)).toBe(true);
    expect(creepSweepPulse(undefined, false, 8, FIXED_DT)).toBe(false);
  });
});

describe('creeping attack (A6) — creeper', () => {
  it('creeps at the creeper cap and is quieter to the player hydrophone', () => {
    expect(CREEPER_SPEED_FRAC).toBeLessThanOrEqual(0.35);
    let maxFrac = 0;
    let steps = 0;
    stepFor(pairLab(), 20, (next) => {
      const creeper = ship(next, 'esc-b');
      const dist = Math.hypot(creeper.x - next.submarine.x, creeper.y - next.submarine.y);
      if (
        creeper.role === 'creeper' &&
        dist < CREEP_ENGAGE_RANGE &&
        next.depthCharges.length === 0
      ) {
        maxFrac = Math.max(maxFrac, (creeper.actualSpeed ?? 0) / shipMaxSpeed.destroyer);
        steps += 1;
      }
      return next;
    });
    expect(steps).toBeGreaterThan(100);
    expect(maxFrac).toBeLessThanOrEqual(0.35 + 1e-6);
    const plain = shipFixture({ kind: 'destroyer', speed: 1 });
    expect(shipMachineryNoise({ ...plain, role: 'creeper' })).toBeLessThan(
      shipMachineryNoise(plain),
    );
  }, 30_000);

  it('drops only inside the pattern range of the holder datum, and never from the holder', () => {
    let state = pairLab();
    let dropped: { creeperDist: number; source: string } | null = null;
    for (let index = 0; index < Math.round(60 / FIXED_DT) && !dropped; index += 1) {
      const before = state;
      state = stepFor(state, FIXED_DT);
      if (state.depthCharges.length > 0) {
        const creeper = ship(before, 'esc-b');
        const datum = ship(before, 'esc-a');
        dropped = {
          creeperDist: Math.hypot(creeper.x - (datum.datumX ?? 0), creeper.y - (datum.datumY ?? 0)),
          source: state.depthCharges[0]!.sourceId,
        };
      }
    }
    expect(dropped).not.toBeNull();
    expect(dropped!.source).toBe('esc-b');
    expect(dropped!.creeperDist).toBeLessThanOrEqual(PATTERN_DROP_RANGE + 0.05);
  }, 30_000);

  it('keeps creeping — no drop — while it is outside the signal range', () => {
    const state = pairLab();
    const early = stepFor(state, 3);
    expect(early.depthCharges).toHaveLength(0);
    const creeper = ship(early, 'esc-b');
    expect(Math.hypot(creeper.x - 60, creeper.y - 60)).toBeGreaterThan(PATTERN_DROP_RANGE);
  });

  it('will not drop on a stale holder signal', () => {
    const state = lab([prosecutor('esc-a', 66, 60), prosecutor('esc-b', 60.4, 60)], SUB);
    const creeper = ship(state, 'esc-b');
    const holder = { ...ship(state, 'esc-a'), lastFixTime: state.time - (SIGNAL_MAX_AGE + 2) };
    const base = escortIntent(creeper, null, state, FIXED_DT, 99);
    const stale = creeperIntent(base, creeper, holder, state);
    expect(stale.action).toBeNull();
    const fresh = creeperIntent(base, creeper, { ...holder, lastFixTime: state.time }, state);
    expect(fresh.action).toBe('pattern');
    expect(fresh.ship.doctrine).toBe('reattack');
  });
});

describe('creeping attack (A6) — contact loss and determinism', () => {
  it('reverts both ships to the existing search when contact is lost', () => {
    let state = stepFor(pairLab(), 1);
    expect(ship(state, 'esc-a').role).toBe('holder');
    // The boat slips away deep and silent: nobody hears it, nobody has a fix.
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: 20,
        y: 20,
        z: 0.9,
        targetDepth: 0.9,
        silentRunning: true,
      },
    };
    state = stepFor(state, 9);
    for (const id of ['esc-a', 'esc-b']) {
      expect(ship(state, id).doctrine, id).toBe('search');
      expect(ship(state, id).role, id).toBeUndefined();
    }
  }, 30_000);

  it('is deterministic and uses no randomness', () => {
    const run = () => canonicalSnapshot(stepFor(pairLab(), 12));
    expect(run()).toBe(run());
  }, 30_000);
});
