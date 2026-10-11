import { describe, expect, it } from 'vitest';
import type { GameState, Ship } from '../../src/game/sim/types';
import { HIT_STOP_KILL_S } from '../../src/game/adapt/hit-stop';
import { JuiceLayer } from '../../src/ui/juice-layer';

interface FakeDocument {
  createElement(): FakeEl;
}

interface FakeEl {
  id: string;
  className: string;
  hidden: boolean;
  textContent: string;
  readonly dataset: Record<string, string>;
  readonly style: { transform: string; opacity: string };
  readonly children: FakeEl[];
  readonly ownerDocument: FakeDocument;
  readonly classList: { add(name: string): void; remove(name: string): void };
  setAttribute(name: string, value: string): void;
  append(...nodes: FakeEl[]): void;
  appendChild(node: FakeEl): FakeEl;
  insertBefore(node: FakeEl, before: FakeEl | null): FakeEl;
  remove(): void;
}

/** Minimal DOM element: enough for JuiceLayer and the layers it builds. */
function fakeEl(ownerDocument: FakeDocument): FakeEl {
  const children: FakeEl[] = [];
  return {
    id: '',
    className: '',
    hidden: false,
    textContent: '',
    dataset: {},
    style: { transform: '', opacity: '' },
    children,
    ownerDocument,
    classList: { add() {}, remove() {} },
    setAttribute() {},
    append(...nodes: FakeEl[]) {
      children.push(...nodes);
    },
    appendChild(node: FakeEl) {
      children.push(node);
      return node;
    },
    insertBefore(node: FakeEl) {
      children.push(node);
      return node;
    },
    remove() {},
  };
}

function fakeParent(): FakeEl {
  const doc: FakeDocument = {
    createElement() {
      return fakeEl(doc);
    },
  };
  return fakeEl(doc);
}

const childById = (parent: FakeEl, id: string): FakeEl => {
  const found = parent.children.find((child) => child.id === id);
  if (!found) throw new Error(`no child #${id}`);
  return found;
};

const project = () => ({ sx: 100, sy: 200, onScreen: true });

/** A GameState carrying only the fields the juice derivations read, with one ship that dies. */
function killStates(): { prev: GameState; next: GameState } {
  const ship = {
    id: 'enemy-1',
    kind: 'destroyer',
    name: 'Test',
    x: 10,
    y: 20,
    heading: 0,
    speed: 0,
    hp: 0,
    maxHp: 100,
    elite: false,
  } as unknown as Ship;
  const base = {
    detonations: [],
    powerups: [],
    stats: { powerupsTaken: 0 },
    submarine: { x: 0, y: 0 },
    messages: [],
  };
  return {
    prev: { ...base, ships: [ship] } as unknown as GameState,
    next: { ...base, ships: [] } as unknown as GameState,
  };
}

describe('JuiceLayer reduced motion', () => {
  it('constructed in reduced motion marks the banner root and takes no hit stop', () => {
    const parent = fakeParent();
    const layer = new JuiceLayer(parent as unknown as HTMLElement, null, true);
    expect(childById(parent, 'fx-banners').dataset.reduced).toBe('1');
    const { prev, next } = killStates();
    layer.observe(prev, next);
    expect(layer.takeHitStop()).toBe(0);
  });

  it('setReducedMotion sets and clears data-reduced on the banner root', () => {
    const parent = fakeParent();
    const layer = new JuiceLayer(parent as unknown as HTMLElement, null, false);
    const banners = childById(parent, 'fx-banners');
    expect(banners.dataset.reduced).toBeUndefined();
    layer.setReducedMotion(true);
    expect(banners.dataset.reduced).toBe('1');
    layer.setReducedMotion(false);
    expect(banners.dataset.reduced).toBeUndefined();
  });

  it('setReducedMotion(true) gives no hit stop, and false restores it', () => {
    const parent = fakeParent();
    const layer = new JuiceLayer(parent as unknown as HTMLElement, null, false);
    const { prev, next } = killStates();
    layer.observe(prev, next);
    expect(layer.takeHitStop()).toBeCloseTo(HIT_STOP_KILL_S, 6);

    layer.setReducedMotion(true);
    layer.observe(prev, next);
    expect(layer.takeHitStop()).toBe(0);

    layer.setReducedMotion(false);
    layer.observe(prev, next);
    expect(layer.takeHitStop()).toBeCloseTo(HIT_STOP_KILL_S, 6);
  });

  it('setReducedMotion reaches the floats on the next frame', () => {
    const parent = fakeParent();
    const layer = new JuiceLayer(parent as unknown as HTMLElement, null, false);
    const { prev, next } = killStates();
    layer.observe(prev, next);
    layer.frame(next, 0, project);
    layer.frame(next, 0.3, project);
    const floatNode = childById(parent, 'fx-floats').children[0];
    const withRise = floatNode.style.transform;
    expect(withRise).not.toBe('translate(86px, 166px) translate(-50%, -50%) scale(1)');

    layer.setReducedMotion(true);
    layer.frame(next, 0.3, project);
    expect(floatNode.style.transform).toBe('translate(86px, 166px) translate(-50%, -50%) scale(1)');
  });
});
