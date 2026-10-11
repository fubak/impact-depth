import { describe, expect, it, vi } from 'vitest';
import type { HitNumber, HitNumberKind } from '../../src/game/adapt/hit-numbers';
import {
  CRIT_POP_SCALE,
  CRIT_POP_S,
  FLOAT_CAP,
  FLOAT_LIFE_S,
  FLOAT_RISE_PX,
  FloatingTextLayer,
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

interface FakeNode {
  className: string;
  hidden: boolean;
  textContent: string;
  style: { transform: string; opacity: string };
}

/** Minimal stand-in for the layer root: records every node the layer appends. */
function fakeRoot(): { root: HTMLElement; nodes: FakeNode[] } {
  const nodes: FakeNode[] = [];
  const root = {
    classList: { add() {} },
    setAttribute() {},
    ownerDocument: {
      createElement(): FakeNode {
        return {
          className: '',
          hidden: false,
          textContent: '',
          style: { transform: '', opacity: '' },
        };
      },
    },
    appendChild(node: FakeNode) {
      nodes.push(node);
    },
  };
  return { root: root as unknown as HTMLElement, nodes };
}

const project = () => ({ sx: 100, sy: 200, onScreen: true });

function hit(kind: HitNumberKind, amount: number): HitNumber {
  return { id: `h${amount}`, kind, x: 0, y: 0, amount, elite: false };
}

describe('FloatingTextLayer spawn', () => {
  it('spawns without allocating a new array per hit', () => {
    const { root } = fakeRoot();
    const layer = new FloatingTextLayer(root, false);
    const mapSpy = vi.spyOn(Array.prototype, 'map');
    layer.spawn([hit('damage', 1), hit('crit', 2), hit('kill', 3)], 0);
    const mapCalls = mapSpy.mock.calls.length;
    mapSpy.mockRestore();
    expect(mapCalls).toBe(0);
  });

  it('overwrites the oldest live slot once every slot is live', () => {
    const { root, nodes } = fakeRoot();
    const layer = new FloatingTextLayer(root, false);
    for (let i = 0; i < FLOAT_CAP; i += 1) layer.spawn([hit('damage', i)], i * 0.01);
    layer.spawn([hit('damage', 999)], 0.2);
    expect(nodes[0].textContent).toBe('-999');
    layer.spawn([hit('damage', 1000)], 0.2);
    expect(nodes[1].textContent).toBe('-1000');
    expect(nodes[0].textContent).toBe('-999');
  });

  it('recycles a slot born after the current time (sim clock restarted)', () => {
    const { root, nodes } = fakeRoot();
    const layer = new FloatingTextLayer(root, false);
    layer.spawn([hit('damage', 1), hit('damage', 2)], 10);
    // The clock restarted: slots 0 and 1 now have negative age.
    layer.spawn([hit('damage', 3)], 2);
    expect(nodes[0].textContent).toBe('-3');
    expect(nodes[1].textContent).toBe('-2');
    layer.update(2, project);
    expect(nodes[1].hidden).toBe(true);
  });
});

describe('FloatingTextLayer clear', () => {
  it('hides every node and frees every slot', () => {
    const { root, nodes } = fakeRoot();
    const layer = new FloatingTextLayer(root, false);
    layer.spawn([hit('damage', 1), hit('crit', 2), hit('kill', 3)], 0);
    layer.update(0.1, project);
    expect(nodes.slice(0, 3).every((node) => !node.hidden)).toBe(true);
    layer.clear();
    expect(nodes.every((node) => node.hidden)).toBe(true);
    layer.update(0.1, project);
    expect(nodes.every((node) => node.hidden)).toBe(true);
    // Freed slots are reused from the front, so the next hit lands in slot 0.
    layer.spawn([hit('damage', 9)], 0.1);
    expect(nodes[0].textContent).toBe('-9');
    expect(nodes[3].textContent).toBe('');
  });
});

describe('FloatingTextLayer reduced motion', () => {
  it('setReducedMotion reaches the next update', () => {
    const { root, nodes } = fakeRoot();
    const layer = new FloatingTextLayer(root, false);
    layer.spawn([hit('crit', 84)], 0);
    layer.update(0, project);
    expect(nodes[0].style.transform).toBe(
      'translate(86px, 166px) translate(-50%, -50%) scale(1.4)',
    );
    layer.setReducedMotion(true);
    layer.update(0, project);
    expect(nodes[0].style.transform).toBe('translate(86px, 166px) translate(-50%, -50%) scale(1)');
    layer.setReducedMotion(false);
    layer.update(0, project);
    expect(nodes[0].style.transform).toBe(
      'translate(86px, 166px) translate(-50%, -50%) scale(1.4)',
    );
  });

  it('the constructor option still starts the layer in reduced motion', () => {
    const { root, nodes } = fakeRoot();
    const layer = new FloatingTextLayer(root, true);
    layer.spawn([hit('crit', 84)], 0);
    layer.update(0, project);
    expect(nodes[0].style.transform).toBe('translate(86px, 166px) translate(-50%, -50%) scale(1)');
  });
});
