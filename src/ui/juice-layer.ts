import { type HitNumber, deriveHitNumbers } from '../game/adapt/hit-numbers';
import { hitStopSeconds } from '../game/adapt/hit-stop';
import { type PickupToast, derivePickupToasts } from '../game/adapt/pickup-toasts';
import type { GameState } from '../game/sim/types';
import {
  BANNER_QUEUE_MAX,
  BannerLayer,
  type BannerQueue,
  EMPTY_BANNER_QUEUE,
  advanceBannerQueue,
  freshBanners,
  lootBanner,
} from './banner-overlay';
import { FLOAT_CAP, type FloatProjector, FloatingTextLayer } from './floating-text';

/**
 * Coordinates the hit numbers, hit stop, banners and loot toasts for one screen.
 * `observe` buffers per fixed step; `frame` draws once per render. Buffers are replaced, never mutated.
 */
export class JuiceLayer {
  private readonly floatRoot: HTMLDivElement;
  private readonly bannerRoot: HTMLDivElement;
  private readonly floats: FloatingTextLayer;
  private readonly banners: BannerLayer;
  private reducedMotion: boolean;
  private numbers: readonly HitNumber[] = [];
  private toasts: readonly PickupToast[] = [];
  private hitStop = 0;
  private seen: ReadonlySet<string> = new Set();
  private bannerQueue: BannerQueue = EMPTY_BANNER_QUEUE;
  private lootQueue: BannerQueue = EMPTY_BANNER_QUEUE;

  constructor(parent: HTMLElement, before: Element | null, reducedMotion: boolean) {
    const doc = parent.ownerDocument;
    this.reducedMotion = reducedMotion;
    this.floatRoot = doc.createElement('div');
    this.floatRoot.id = 'fx-floats';
    parent.insertBefore(this.floatRoot, before);
    this.floats = new FloatingTextLayer(this.floatRoot, reducedMotion);
    this.bannerRoot = doc.createElement('div');
    this.bannerRoot.id = 'fx-banners';
    parent.appendChild(this.bannerRoot);
    this.banners = new BannerLayer(this.bannerRoot, reducedMotion);
  }

  /** Runtime toggle: floats, banner CSS hook and hit stop (which then gives 0) all follow. */
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    this.floats.setReducedMotion(value);
    this.banners.setReducedMotion(value);
  }

  /** Per fixed step. Reduced motion gives no hit stop (freeze scale 0), text still shows. */
  observe(prev: GameState, next: GameState): void {
    const numbers = deriveHitNumbers(prev, next);
    const toasts = derivePickupToasts(prev, next);
    this.numbers = [...this.numbers, ...numbers].slice(-FLOAT_CAP);
    this.hitStop = Math.max(this.hitStop, hitStopSeconds(numbers, this.reducedMotion ? 0 : 1));
    this.toasts = [...this.toasts, ...toasts].slice(-BANNER_QUEUE_MAX);
  }

  /** Returns the accumulated hit stop in seconds and clears it. */
  takeHitStop(): number {
    const seconds = this.hitStop;
    this.hitStop = 0;
    return seconds;
  }

  /** Per render frame: spawn and move floats, advance the banner and loot queues, then draw. */
  frame(game: GameState, nowS: number, project: FloatProjector): void {
    this.floats.spawn(this.numbers, nowS);
    this.numbers = [];
    this.floats.update(nowS, project);
    const { fresh, seen } = freshBanners(game.messages, this.seen);
    this.seen = seen;
    this.bannerQueue = advanceBannerQueue(this.bannerQueue, nowS, fresh);
    this.lootQueue = advanceBannerQueue(this.lootQueue, nowS, this.toasts.map(lootBanner));
    this.toasts = [];
    this.banners.render(this.bannerQueue, this.lootQueue);
  }

  reset(): void {
    this.numbers = [];
    this.toasts = [];
    this.hitStop = 0;
    this.seen = new Set();
    this.bannerQueue = EMPTY_BANNER_QUEUE;
    this.lootQueue = EMPTY_BANNER_QUEUE;
    this.floats.clear();
    this.banners.render(EMPTY_BANNER_QUEUE, EMPTY_BANNER_QUEUE);
  }

  dispose(): void {
    this.banners.dispose();
    this.floatRoot.remove();
    this.bannerRoot.remove();
  }
}
