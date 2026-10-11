import { describe, expect, it } from 'vitest';
import type { PickupToast } from '../../src/game/adapt/pickup-toasts';
import {
  BANNER_QUEUE_MAX,
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
