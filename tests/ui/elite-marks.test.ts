import { describe, expect, it } from 'vitest';
import {
  contactClass,
  crateClass,
  eliteTargetText,
  mapShipClass,
  mapShipRadius,
  targetCardClass,
} from '../../src/ui/elite-marks';
import { ELITE_STYLE } from '../../src/game/adapt/loot-style';

describe('targetCardClass', () => {
  it('returns an empty class with no target', () => {
    expect(targetCardClass(undefined)).toBe('');
  });

  it('keeps the old engaged class for a normal ship', () => {
    expect(targetCardClass({})).toBe('engaged');
    expect(targetCardClass({ elite: false })).toBe('engaged');
  });

  it('adds elite for an elite ship', () => {
    expect(targetCardClass({ elite: true })).toBe('engaged elite');
  });
});

describe('eliteTargetText', () => {
  it('prefixes the star for an elite', () => {
    expect(eliteTargetText({ elite: true }, 'X')).toBe('★ X');
    expect(eliteTargetText({ elite: true }, 'X')).toBe(`${ELITE_STYLE.star} X`);
  });

  it('returns the text unchanged for a normal ship', () => {
    expect(eliteTargetText({}, 'X')).toBe('X');
    expect(eliteTargetText({ elite: false }, 'X')).toBe('X');
  });
});

describe('mapShipClass', () => {
  it('keeps the old classes for a normal ship', () => {
    expect(mapShipClass({ id: 'a', kind: 'destroyer' }, 'a')).toBe('ship selected');
    expect(mapShipClass({ id: 'a', kind: 'destroyer' }, null)).toBe('ship');
  });

  it('keeps the old sub class', () => {
    expect(mapShipClass({ id: 'u', kind: 'sub' }, null)).toBe('ship sub');
    expect(mapShipClass({ id: 'u', kind: 'sub' }, 'u')).toBe('ship selected sub');
  });

  it('adds elite last for an elite ship', () => {
    expect(mapShipClass({ id: 'e', kind: 'cruiser', elite: true }, null)).toBe('ship elite');
    expect(mapShipClass({ id: 'e', kind: 'cruiser', elite: true }, 'e')).toBe(
      'ship selected elite',
    );
    expect(mapShipClass({ id: 'e', kind: 'sub', elite: true }, 'e')).toBe(
      'ship selected sub elite',
    );
  });
});

describe('mapShipRadius', () => {
  it('uses 1.4 for normal ships and 1.7 for subs', () => {
    expect(mapShipRadius({ kind: 'destroyer' })).toBe(1.4);
    expect(mapShipRadius({ kind: 'sub' })).toBe(1.7);
  });

  it('uses 2.0 for an elite', () => {
    expect(mapShipRadius({ kind: 'cruiser', elite: true })).toBe(2.0);
  });

  it('checks sub before elite', () => {
    expect(mapShipRadius({ kind: 'sub' })).toBe(1.7);
    expect(mapShipRadius({ kind: 'sub', elite: true })).toBe(1.7);
  });
});

describe('crateClass', () => {
  it('keeps the old crate class for common or missing rarity', () => {
    expect(crateClass({})).toBe('crate');
    expect(crateClass({ rarity: 'common' })).toBe('crate');
  });

  it('adds rare and epic classes', () => {
    expect(crateClass({ rarity: 'rare' })).toBe('crate rare');
    expect(crateClass({ rarity: 'epic' })).toBe('crate epic');
  });
});

describe('contactClass', () => {
  it('keeps the old contact classes for a normal contact', () => {
    expect(contactClass({ id: 'a', name: 'DESTROYER' }, 'a')).toBe('contact active');
    expect(contactClass({ id: 'a', name: 'DESTROYER' }, null)).toBe('contact');
  });

  it('adds elite for an ELITE-prefixed contact name', () => {
    expect(contactClass({ id: 'e', name: 'ELITE DESTROYER' }, null)).toBe('contact elite');
    expect(contactClass({ id: 'e', name: 'ELITE DESTROYER' }, 'e')).toBe('contact active elite');
  });
});
