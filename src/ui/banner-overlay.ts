import '../styles/banners.css';
import type { PickupToast } from '../game/adapt/pickup-toasts';
import type { PowerupRarity } from '../game/sim/types';

export type BannerTier = 'combo' | 'epic' | 'level' | 'wave' | 'loot';

export interface BannerSpec {
  readonly id: string;
  readonly tier: BannerTier;
  readonly text: string;
  readonly ttl: number;
  readonly rarity?: PowerupRarity;
}

export const BANNER_QUEUE_MAX = 3;
export const LOOT_TOAST_TTL = 2.2;

const LEVEL_TTL = 2.0;
const WAVE_TTL = 2.0;
const LEVEL_PATTERN = /^LEVEL (\d+)$/;
const WAVE_PATTERN = /^WAVE (\d+) INBOUND$/;

const FIXED_BANNERS: ReadonlyMap<string, { readonly tier: BannerTier; readonly ttl: number }> =
  new Map([
    ['DOUBLE KILL', { tier: 'combo', ttl: 1.6 }],
    ['TRIPLE KILL', { tier: 'combo', ttl: 1.8 }],
    ['RAMPAGE', { tier: 'epic', ttl: 2.2 }],
    ['CHAIN REACTION', { tier: 'combo', ttl: 1.4 }],
    ['BROADSIDE!', { tier: 'epic', ttl: 1.8 }],
    ['SECTOR CLEARED', { tier: 'epic', ttl: 2.6 }],
    ['ENDLESS HUNT', { tier: 'epic', ttl: 2.2 }],
  ]);

/** Message → banner, or null. */
export function bannerSpecFor(message: { id: string; text: string }): BannerSpec | null {
  const fixed = FIXED_BANNERS.get(message.text);
  if (fixed) return { id: message.id, tier: fixed.tier, text: message.text, ttl: fixed.ttl };
  const level = LEVEL_PATTERN.exec(message.text);
  if (level) {
    return { id: message.id, tier: 'level', text: `LEVEL UP · ${level[1]}`, ttl: LEVEL_TTL };
  }
  const wave = WAVE_PATTERN.exec(message.text);
  if (wave) return { id: message.id, tier: 'wave', text: `WAVE ${wave[1]}`, ttl: WAVE_TTL };
  return null;
}

export interface BannerQueue {
  readonly current: (BannerSpec & { readonly shownAt: number }) | null;
  readonly pending: readonly BannerSpec[];
}

export const EMPTY_BANNER_QUEUE: BannerQueue = Object.freeze({
  current: null,
  pending: Object.freeze([]) as readonly BannerSpec[],
});

function keepNewest(items: readonly BannerSpec[]): readonly BannerSpec[] {
  return items.slice(-BANNER_QUEUE_MAX);
}

/**
 * Appends fresh specs to the pending list (keeping the newest BANNER_QUEUE_MAX), expires the
 * current banner once its ttl has passed and promotes the next pending one. A clock that ran
 * backward (nowS before shownAt, e.g. after a restart) counts as expired. Pure.
 */
export function advanceBannerQueue(
  queue: BannerQueue,
  nowS: number,
  fresh: readonly BannerSpec[],
): BannerQueue {
  const live =
    queue.current !== null &&
    nowS >= queue.current.shownAt &&
    nowS - queue.current.shownAt < queue.current.ttl
      ? queue.current
      : null;
  const waiting: readonly BannerSpec[] = [...queue.pending, ...fresh];
  if (live !== null) return { current: live, pending: keepNewest(waiting) };
  const [next, ...rest] = waiting;
  if (next === undefined) return { current: null, pending: [] };
  return { current: { ...next, shownAt: nowS }, pending: keepNewest(rest) };
}

/** Banner-able messages not yet seen; `seen` becomes the ids of the banner-able messages still present. Pure. */
export function freshBanners(
  messages: readonly { id: string; text: string }[],
  seen: ReadonlySet<string>,
): { fresh: BannerSpec[]; seen: ReadonlySet<string> } {
  const specs = messages
    .map((message) => bannerSpecFor(message))
    .filter((spec): spec is BannerSpec => spec !== null);
  return {
    fresh: specs.filter((spec) => !seen.has(spec.id)),
    seen: new Set(specs.map((spec) => spec.id)),
  };
}

export function lootBanner(toast: PickupToast): BannerSpec {
  return {
    id: toast.id,
    tier: 'loot',
    text: toast.text,
    ttl: LOOT_TOAST_TTL,
    rarity: toast.rarity,
  };
}

function restartAnimation(el: HTMLElement): void {
  el.classList.remove('is-in');
  void el.offsetWidth;
  el.classList.add('is-in');
}

/**
 * Shows `spec` in `el`; returns the id now on screen (null when hidden). The id fully determines
 * text, tier and rarity, so those are written only when the id changes, along with the restart.
 */
function show(
  el: HTMLDivElement,
  spec: BannerQueue['current'],
  previous: string | null,
): string | null {
  if (spec === null) {
    el.hidden = true;
    return null;
  }
  el.hidden = false;
  if (spec.id !== previous) {
    el.textContent = spec.text;
    el.dataset.tier = spec.tier;
    if (spec.rarity === undefined) delete el.dataset.rarity;
    else el.dataset.rarity = spec.rarity;
    restartAnimation(el);
  }
  return spec.id;
}

/** DOM for the centre-screen banner and the loot toast. Every node is pointer-events: none. */
export class BannerLayer {
  private readonly root: HTMLElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly lootEl: HTMLDivElement;
  private bannerId: string | null = null;
  private lootId: string | null = null;

  constructor(root: HTMLElement, reducedMotion: boolean) {
    const doc = root.ownerDocument;
    this.root = root;
    root.className = 'fx-banner-layer';
    root.setAttribute('aria-hidden', 'true');
    if (reducedMotion) root.dataset.reduced = '1';
    this.bannerEl = doc.createElement('div');
    this.bannerEl.className = 'fx-banner';
    this.bannerEl.hidden = true;
    this.lootEl = doc.createElement('div');
    this.lootEl.className = 'fx-loot';
    this.lootEl.hidden = true;
    root.append(this.bannerEl, this.lootEl);
  }

  /** Sets or clears data-reduced on the layer root so the CSS reduced-motion rules apply. */
  setReducedMotion(value: boolean): void {
    if (value) this.root.dataset.reduced = '1';
    else delete this.root.dataset.reduced;
  }

  render(banners: BannerQueue, loot: BannerQueue): void {
    this.bannerId = show(this.bannerEl, banners.current, this.bannerId);
    this.lootId = show(this.lootEl, loot.current, this.lootId);
  }

  dispose(): void {
    this.bannerEl.remove();
    this.lootEl.remove();
  }
}
