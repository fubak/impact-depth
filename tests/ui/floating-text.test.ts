import { describe, expect, it } from 'vitest';
import type { HitNumber } from '../../src/game/adapt/hit-numbers';
import {
  CRIT_POP_SCALE,
  CRIT_POP_S,
  FLOAT_CAP,
  FLOAT_LIFE_S,
  FLOAT_RISE_PX,
  floaterFrame,
  hitNumberClass,
  hitNumberText,
  pickSlot,
} from '../../src/ui/floating-text';

describe('floaterFrame', () => {
  it('shows a damage number at full opacity, unrisen and unscaled at age 0', () => {
    const frame = floaterFrame('damage', 0, false);
    expect(frame.visible).toBe(true);
    expect(frame.risePx).toBeCloseTo(0, 6);
    expect(frame.opacity).toBe(1);
    expect(frame.scale).toBe(1);
  });

  it('rises on an ease-out curve (t = 0.5 gives 3/4 of the rise)', () => {
    const frame = floaterFrame('damage', 0.45, false);
    expect(frame.risePx).toBeCloseTo(FLOAT_RISE_PX * 0.75, 3);
    expect(frame.risePx).toBeCloseTo(34.5, 3);
  });

  it('holds opacity 1 until t = 0.6 then fades linearly to 0', () => {
    const frame = floaterFrame('damage', 0.8, false);
    expect(frame.visible).toBe(true);
    expect(frame.opacity).toBeCloseTo(1 - (0.889 - 0.6) / 0.4, 2);
    expect(frame.opacity).toBeCloseTo(1 - (0.8 / 0.9 - 0.6) / 0.4, 3);
  });

  it('is invisible once age reaches the kind lifetime', () => {
    expect(floaterFrame('damage', 0.9, false).visible).toBe(false);
    expect(floaterFrame('damage', 2, false).visible).toBe(false);
  });

  it('is invisible for a negative age', () => {
    expect(floaterFrame('damage', -0.1, false).visible).toBe(false);
    expect(floaterFrame('kill', -1, false).visible).toBe(false);
  });

  it('uses the per-kind lifetimes', () => {
    expect(FLOAT_LIFE_S).toEqual({ damage: 0.9, crit: 1.2, kill: 1.3 });
    expect(floaterFrame('crit', 1.1, false).visible).toBe(true);
    expect(floaterFrame('crit', 1.2, false).visible).toBe(false);
    expect(floaterFrame('kill', 1.25, false).visible).toBe(true);
    expect(floaterFrame('kill', 1.3, false).visible).toBe(false);
  });

  it('pops a crit to 1 + CRIT_POP_SCALE at age 0 and settles by CRIT_POP_S', () => {
    expect(CRIT_POP_S).toBe(0.15);
    expect(CRIT_POP_SCALE).toBe(0.4);
    expect(floaterFrame('crit', 0, false).scale).toBeCloseTo(1.4, 6);
    expect(floaterFrame('crit', 0.075, false).scale).toBeCloseTo(1.2, 6);
    expect(floaterFrame('crit', CRIT_POP_S, false).scale).toBe(1);
  });

  it('does not pop non-crit kinds', () => {
    expect(floaterFrame('damage', 0, false).scale).toBe(1);
    expect(floaterFrame('kill', 0, false).scale).toBe(1);
  });

  it('under reduced motion has no rise and no pop but still shows and fades', () => {
    for (const age of [0, 0.3, 0.7]) {
      const frame = floaterFrame('crit', age, true);
      expect(frame.risePx).toBe(0);
      expect(frame.scale).toBe(1);
      expect(frame.visible).toBe(true);
    }
    expect(floaterFrame('damage', 0.8, true).opacity).toBeCloseTo(
      floaterFrame('damage', 0.8, false).opacity,
      6,
    );
  });
});

describe('hitNumberText', () => {
  it('formats damage, crit and kill', () => {
    expect(hitNumberText({ kind: 'damage', amount: 42 })).toBe('-42');
    expect(hitNumberText({ kind: 'crit', amount: 84 })).toBe('CRIT 84!');
    expect(hitNumberText({ kind: 'kill', amount: 180 })).toBe('+180 XP');
  });
});

describe('hitNumberClass', () => {
  it('maps kind to a class', () => {
    expect(hitNumberClass({ kind: 'damage', elite: false })).toBe('fx-num is-damage');
    expect(hitNumberClass({ kind: 'crit', elite: false })).toBe('fx-num is-crit');
    expect(hitNumberClass({ kind: 'kill', elite: false })).toBe('fx-num is-kill');
  });

  it('appends is-elite for elite targets', () => {
    expect(hitNumberClass({ kind: 'damage', elite: true })).toBe('fx-num is-damage is-elite');
    expect(hitNumberClass({ kind: 'kill', elite: true })).toBe('fx-num is-kill is-elite');
  });

  it('accepts a full HitNumber', () => {
    const n: HitNumber = { id: 'h', kind: 'crit', x: 0, y: 0, amount: 9, elite: false };
    expect(hitNumberClass(n)).toBe('fx-num is-crit');
  });
});

describe('pickSlot', () => {
  it('pool size is 16', () => {
    expect(FLOAT_CAP).toBe(16);
  });

  it('returns the first dead slot', () => {
    const slots = [
      { live: true, born: 1 },
      { live: false, born: 0 },
      { live: false, born: 0 },
    ];
    expect(pickSlot(slots)).toBe(1);
  });

  it('returns the oldest live slot when all are live', () => {
    const slots = [
      { live: true, born: 5 },
      { live: true, born: 2 },
      { live: true, born: 9 },
    ];
    expect(pickSlot(slots)).toBe(1);
  });
});
