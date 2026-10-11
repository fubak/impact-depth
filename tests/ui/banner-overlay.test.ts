import { describe, expect, it } from 'vitest';
import type { PickupToast } from '../../src/game/adapt/pickup-toasts';
import {
  BANNER_QUEUE_MAX,
  BannerLayer,
  type BannerQueue,
  type BannerSpec,
  EMPTY_BANNER_QUEUE,
  LOOT_TOAST_TTL,
  advanceBannerQueue,
  bannerSpecFor,
  freshBanners,
  lootBanner,
} from '../../src/ui/banner-overlay';

const msg = (id: string, text: string): { id: string; text: string } => ({ id, text });

const spec = (id: string, ttl = 2): BannerSpec => ({
  id,
  tier: 'combo',
  text: id.toUpperCase(),
  ttl,
});

interface FakeDocument {
  createElement(): FakeNode;
}

interface FakeNode {
  hidden: boolean;
  className: string;
  textContent: string;
  readonly dataset: Record<string, string>;
  readonly classList: { add(name: string): void; remove(name: string): void };
  readonly offsetWidth: number;
  readonly ownerDocument: FakeDocument;
  setAttribute(name: string, value: string): void;
  append(...nodes: FakeNode[]): void;
  remove(): void;
}

/** A node that logs each text, dataset and class write to `writes`, in order. */
function fakeNode(writes: string[], ownerDocument: FakeDocument): FakeNode {
  let text = '';
  const dataset = new Proxy<Record<string, string>>(
    {},
    {
      set(target, key, value: string) {
        writes.push(`data.${String(key)}=${value}`);
        target[String(key)] = value;
        return true;
      },
      deleteProperty(target, key) {
        writes.push(`data.-${String(key)}`);
        delete target[String(key)];
        return true;
      },
    },
  );
  return {
    hidden: false,
    className: '',
    offsetWidth: 0,
    dataset,
    get textContent() {
      return text;
    },
    set textContent(value: string) {
      writes.push(`text=${value}`);
      text = value;
    },
    classList: {
      add(name: string) {
        writes.push(`+${name}`);
      },
      remove(name: string) {
        writes.push(`-${name}`);
      },
    },
    ownerDocument,
    setAttribute() {},
    append() {},
    remove() {},
  };
}

/** Fake layer root plus the banner and loot nodes it creates. */
function fakeBannerDom(): { root: FakeNode; writes: string[] } {
  const writes: string[] = [];
  const doc: FakeDocument = {
    createElement() {
      return fakeNode(writes, doc);
    },
  };
  return { root: fakeNode(writes, doc), writes };
}

describe('bannerSpecFor', () => {
  it.each([
    ['DOUBLE KILL', 'combo', 'DOUBLE KILL', 1.6],
    ['TRIPLE KILL', 'combo', 'TRIPLE KILL', 1.8],
    ['RAMPAGE', 'epic', 'RAMPAGE', 2.2],
    ['CHAIN REACTION', 'combo', 'CHAIN REACTION', 1.4],
    ['BROADSIDE!', 'epic', 'BROADSIDE!', 1.8],
    ['LEVEL 12', 'level', 'LEVEL UP · 12', 2.0],
    ['SECTOR CLEARED', 'epic', 'SECTOR CLEARED', 2.6],
    ['ENDLESS HUNT', 'epic', 'ENDLESS HUNT', 2.2],
    ['WAVE 3 INBOUND', 'wave', 'WAVE 3', 2.0],
  ])('maps "%s" to a %s banner', (text, tier, bannerText, ttl) => {
    expect(bannerSpecFor(msg('m-1', text))).toEqual({ id: 'm-1', tier, text: bannerText, ttl });
  });

  it('maps the level number through the level pattern', () => {
    expect(bannerSpecFor(msg('lvl', 'LEVEL 1'))?.text).toBe('LEVEL UP · 1');
  });

  it('maps the wave number through the wave pattern', () => {
    expect(bannerSpecFor(msg('w', 'WAVE 3 INBOUND'))?.text).toBe('WAVE 3');
  });

  it.each(['HIT BOW · X', 'LEVEL', 'WAVE 3', 'SHIP SUNK', 'LEVEL 12 ', 'rampage'])(
    'returns null for unlisted text "%s"',
    (text) => {
      expect(bannerSpecFor(msg('x', text))).toBeNull();
    },
  );
});

describe('advanceBannerQueue', () => {
  it('shows the first fresh banner at once with shownAt = now', () => {
    const queue = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a')]);
    expect(queue.current).toEqual({ ...spec('a'), shownAt: 10 });
    expect(queue.pending).toEqual([]);
  });

  it('keeps the current banner on screen until its ttl has passed', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a', 2)]);
    const second = advanceBannerQueue(first, 11.9, [spec('b', 2)]);
    expect(second.current?.id).toBe('a');
    expect(second.pending.map((item) => item.id)).toEqual(['b']);
  });

  it('promotes the next pending banner once the ttl has passed', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a', 2)]);
    const second = advanceBannerQueue(first, 11, [spec('b', 2)]);
    const third = advanceBannerQueue(second, 12, []);
    expect(third.current).toEqual({ ...spec('b', 2), shownAt: 12 });
    expect(third.pending).toEqual([]);
  });

  it('clears current when the ttl passes with nothing pending', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a', 2)]);
    const second = advanceBannerQueue(first, 12, []);
    expect(second.current).toBeNull();
    expect(second.pending).toEqual([]);
  });

  it('keeps the newest BANNER_QUEUE_MAX pending after the first is promoted', () => {
    const fresh = ['a', 'b', 'c', 'd', 'e'].map((id) => spec(id));
    const queue = advanceBannerQueue(EMPTY_BANNER_QUEUE, 0, fresh);
    expect(BANNER_QUEUE_MAX).toBe(3);
    expect(queue.current?.id).toBe('a');
    expect(queue.pending.map((item) => item.id)).toEqual(['c', 'd', 'e']);
  });

  it('caps pending while a banner is still on screen', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 0, [spec('a', 9)]);
    const second = advanceBannerQueue(
      first,
      1,
      ['b', 'c', 'd', 'e'].map((id) => spec(id)),
    );
    expect(second.current?.id).toBe('a');
    expect(second.pending.map((item) => item.id)).toEqual(['c', 'd', 'e']);
  });

  it('does not mutate the input queue', () => {
    const input: BannerQueue = { current: null, pending: [spec('x')] };
    const snapshot = JSON.parse(JSON.stringify(input)) as BannerQueue;
    advanceBannerQueue(input, 0, [spec('y')]);
    expect(input).toEqual(snapshot);
  });

  it('expires the current banner when the clock runs backward', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a', 2)]);
    const back = advanceBannerQueue(first, 5, []);
    expect(back.current).toBeNull();
    expect(back.pending).toEqual([]);
  });

  it('promotes the next pending banner, stamped with the new time, when the clock runs backward', () => {
    const first = advanceBannerQueue(EMPTY_BANNER_QUEUE, 10, [spec('a', 2)]);
    const back = advanceBannerQueue(first, 9, [spec('b', 2)]);
    expect(back.current).toEqual({ ...spec('b', 2), shownAt: 9 });
    expect(back.pending).toEqual([]);
  });
});

describe('BannerLayer', () => {
  const shown = (item: BannerSpec, shownAt = 0): BannerQueue => ({
    current: { ...item, shownAt },
    pending: [],
  });
  const epic: BannerSpec = { id: 'rampage', tier: 'epic', text: 'RAMPAGE', ttl: 2, rarity: 'epic' };

  it('writes text, tier, rarity and the entrance class once when a banner appears', () => {
    const { root, writes } = fakeBannerDom();
    const layer = new BannerLayer(root as unknown as HTMLElement, false);
    writes.length = 0;
    layer.render(shown(epic), EMPTY_BANNER_QUEUE);
    expect(writes).toEqual([
      'text=RAMPAGE',
      'data.tier=epic',
      'data.rarity=epic',
      '-is-in',
      '+is-in',
    ]);
  });

  it('writes nothing on later frames while the same banner id stays on screen', () => {
    const { root, writes } = fakeBannerDom();
    const layer = new BannerLayer(root as unknown as HTMLElement, false);
    layer.render(shown(epic), EMPTY_BANNER_QUEUE);
    writes.length = 0;
    layer.render(shown(epic, 0.5), EMPTY_BANNER_QUEUE);
    layer.render(shown(epic, 1), EMPTY_BANNER_QUEUE);
    expect(writes).toEqual([]);
  });

  it('restarts the entrance animation only when the id changes', () => {
    const { root, writes } = fakeBannerDom();
    const layer = new BannerLayer(root as unknown as HTMLElement, false);
    const next: BannerSpec = { id: 'double', tier: 'combo', text: 'DOUBLE KILL', ttl: 1.6 };
    layer.render(shown(epic), EMPTY_BANNER_QUEUE);
    writes.length = 0;
    layer.render(shown(next), EMPTY_BANNER_QUEUE);
    expect(writes).toEqual([
      'text=DOUBLE KILL',
      'data.tier=combo',
      'data.-rarity',
      '-is-in',
      '+is-in',
    ]);
  });

  it('shows the same banner again after it was hidden', () => {
    const { root, writes } = fakeBannerDom();
    const layer = new BannerLayer(root as unknown as HTMLElement, false);
    layer.render(shown(epic), EMPTY_BANNER_QUEUE);
    layer.render(EMPTY_BANNER_QUEUE, EMPTY_BANNER_QUEUE);
    writes.length = 0;
    layer.render(shown(epic), EMPTY_BANNER_QUEUE);
    expect(writes).toContain('text=RAMPAGE');
    expect(writes).toContain('+is-in');
  });

  it('setReducedMotion sets and clears data-reduced on the layer root', () => {
    const { root } = fakeBannerDom();
    const layer = new BannerLayer(root as unknown as HTMLElement, false);
    expect(root.dataset.reduced).toBeUndefined();
    layer.setReducedMotion(true);
    expect(root.dataset.reduced).toBe('1');
    layer.setReducedMotion(false);
    expect(root.dataset.reduced).toBeUndefined();
  });
});

describe('freshBanners', () => {
  const messages = [msg('m1', 'RAMPAGE'), msg('m2', 'HIT BOW · X'), msg('m3', 'WAVE 2 INBOUND')];

  it('returns every banner-able message the first time it is seen', () => {
    const result = freshBanners(messages, new Set());
    expect(result.fresh.map((item) => item.id)).toEqual(['m1', 'm3']);
    expect([...result.seen].sort()).toEqual(['m1', 'm3']);
  });

  it('returns nothing for messages that are already seen', () => {
    const first = freshBanners(messages, new Set());
    const second = freshBanners(messages, first.seen);
    expect(second.fresh).toEqual([]);
    expect([...second.seen].sort()).toEqual(['m1', 'm3']);
  });

  it('drops ids that left the message list, so they show again if they return', () => {
    const first = freshBanners(messages, new Set());
    const gone = freshBanners([msg('m3', 'WAVE 2 INBOUND')], first.seen);
    expect([...gone.seen]).toEqual(['m3']);
    expect(gone.fresh).toEqual([]);
    const back = freshBanners(messages, gone.seen);
    expect(back.fresh.map((item) => item.id)).toEqual(['m1']);
  });
});

describe('lootBanner', () => {
  it('maps a pickup toast to a loot banner spec', () => {
    const toast: PickupToast = { id: 'pickup-7', rarity: 'epic', text: 'EPIC TORPEDO CRATE' };
    expect(LOOT_TOAST_TTL).toBe(2.2);
    expect(lootBanner(toast)).toEqual({
      id: 'pickup-7',
      tier: 'loot',
      text: 'EPIC TORPEDO CRATE',
      ttl: LOOT_TOAST_TTL,
      rarity: 'epic',
    });
  });
});
