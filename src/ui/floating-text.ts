import '../styles/floats.css';
import type { HitNumber, HitNumberKind } from '../game/adapt/hit-numbers';

export const FLOAT_CAP = 16;
export const FLOAT_LIFE_S: Readonly<Record<HitNumberKind, number>> = {
  damage: 0.9,
  crit: 1.2,
  kill: 1.3,
};
export const FLOAT_RISE_PX = 46;
/** Starts above the waterline projection. */
export const FLOAT_START_OFFSET_PX = 34;
/** Slot % 3 → -14, 0, +14 so stacked hits fan out. */
export const FLOAT_JITTER_PX = 14;
export const CRIT_POP_S = 0.15;
export const CRIT_POP_SCALE = 0.4;

const FADE_START_T = 0.6;
const JITTER_BY_SLOT: readonly number[] = [-FLOAT_JITTER_PX, 0, FLOAT_JITTER_PX];

export interface FloaterFrame {
  readonly visible: boolean;
  readonly risePx: number;
  readonly opacity: number;
  readonly scale: number;
}

const HIDDEN_FRAME: FloaterFrame = { visible: false, risePx: 0, opacity: 0, scale: 1 };

/**
 * Pose of one floating number at `ageS` seconds after it spawned.
 * Rise is ease-out; opacity holds 1 until t = 0.6 then fades linearly; a crit pops once.
 * Reduced motion removes the rise and the pop but keeps the text and the fade.
 */
export function floaterFrame(
  kind: HitNumberKind,
  ageS: number,
  reducedMotion: boolean,
): FloaterFrame {
  const life = FLOAT_LIFE_S[kind];
  if (ageS < 0 || ageS >= life) return HIDDEN_FRAME;
  const t = ageS / life;
  const risePx = reducedMotion ? 0 : FLOAT_RISE_PX * (1 - (1 - t) ** 2);
  const opacity = t <= FADE_START_T ? 1 : (1 - t) / (1 - FADE_START_T);
  const pop =
    kind === 'crit' && !reducedMotion ? 1 + CRIT_POP_SCALE * Math.max(0, 1 - ageS / CRIT_POP_S) : 1;
  return { visible: true, risePx, opacity, scale: pop };
}

export function hitNumberText(n: Pick<HitNumber, 'kind' | 'amount'>): string {
  if (n.kind === 'crit') return `CRIT ${n.amount}!`;
  if (n.kind === 'kill') return `+${n.amount} XP`;
  return `-${n.amount}`;
}

const KIND_CLASS: Readonly<Record<HitNumberKind, string>> = {
  damage: 'is-damage',
  crit: 'is-crit',
  kill: 'is-kill',
};

export function hitNumberClass(n: Pick<HitNumber, 'kind' | 'elite'>): string {
  return n.elite ? `fx-num ${KIND_CLASS[n.kind]} is-elite` : `fx-num ${KIND_CLASS[n.kind]}`;
}

/** First slot that is not live; else the live slot with the smallest `born` (oldest). */
export function pickSlot(slots: readonly { live: boolean; born: number }[]): number {
  let oldest = -1;
  let oldestBorn = Infinity;
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    if (!slot.live) return i;
    if (slot.born < oldestBorn) {
      oldest = i;
      oldestBorn = slot.born;
    }
  }
  return oldest;
}

export interface FloatProjection {
  readonly sx: number;
  readonly sy: number;
  readonly onScreen: boolean;
}

/** Maps a HitNumber position (sim units, as stored on the HitNumber) to screen pixels. */
export type FloatProjector = (x: number, y: number) => FloatProjection;

interface FloatSlot {
  readonly el: HTMLDivElement;
  live: boolean;
  born: number;
  kind: HitNumberKind;
  x: number;
  y: number;
}

/**
 * A slot is live only while its age is in [0, life). A negative age means the sim clock
 * restarted after the slot was born, so the slot counts as dead and can be recycled.
 */
function isLive(slot: FloatSlot, nowS: number): boolean {
  if (!slot.live) return false;
  const age = nowS - slot.born;
  return age >= 0 && age < FLOAT_LIFE_S[slot.kind];
}

/** Pool of FLOAT_CAP pre-built DOM nodes. Hits never create elements. */
export class FloatingTextLayer {
  private reducedMotion: boolean;
  private readonly slots: FloatSlot[] = [];
  /** Reused on every spawn so picking a slot does not allocate an array per hit. */
  private readonly pickView: { live: boolean; born: number }[] = [];

  constructor(root: HTMLElement, reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    root.classList.add('fx-layer');
    root.setAttribute('aria-hidden', 'true');
    const doc = root.ownerDocument;
    for (let i = 0; i < FLOAT_CAP; i += 1) {
      const el = doc.createElement('div');
      el.className = 'fx-num';
      el.hidden = true;
      root.appendChild(el);
      this.slots.push({ el, live: false, born: 0, kind: 'damage', x: 0, y: 0 });
      this.pickView.push({ live: false, born: 0 });
    }
  }

  /** Runtime toggle; the next update() applies it to every number still on screen. */
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  spawn(numbers: readonly HitNumber[], nowS: number): void {
    for (const n of numbers) {
      for (let i = 0; i < this.slots.length; i += 1) {
        const slot = this.slots[i];
        const view = this.pickView[i];
        view.live = isLive(slot, nowS);
        view.born = slot.born;
      }
      const slot = this.slots[pickSlot(this.pickView)];
      slot.live = true;
      slot.born = nowS;
      slot.kind = n.kind;
      slot.x = n.x;
      slot.y = n.y;
      slot.el.textContent = hitNumberText(n);
      slot.el.className = hitNumberClass(n);
    }
  }

  update(nowS: number, project: FloatProjector): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i];
      if (!slot.live) continue;
      if (!isLive(slot, nowS)) {
        slot.live = false;
        slot.el.hidden = true;
        continue;
      }
      const age = nowS - slot.born;
      const frame = floaterFrame(slot.kind, age, this.reducedMotion);
      const p = frame.visible ? project(slot.x, slot.y) : null;
      if (!frame.visible || !p || !p.onScreen) {
        slot.el.hidden = true;
        continue;
      }
      const jitter = JITTER_BY_SLOT[i % JITTER_BY_SLOT.length];
      slot.el.hidden = false;
      slot.el.style.transform =
        `translate(${p.sx + jitter}px, ${p.sy - FLOAT_START_OFFSET_PX - frame.risePx}px) ` +
        `translate(-50%, -50%) scale(${frame.scale})`;
      slot.el.style.opacity = String(frame.opacity);
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.live = false;
      slot.el.hidden = true;
    }
  }
}
