import { describe, expect, it } from 'vitest';
import {
  ELITE_STYLE,
  PULSE_AMPLITUDE,
  RARITY_STYLES,
  isElite,
  isEliteName,
  pickupToastText,
  pulseScale,
  rarityStyle,
} from '../../src/game/adapt/loot-style';

describe('RARITY_STYLES', () => {
  it('common is fully neutral (identity)', () => {
    expect(RARITY_STYLES.common).toEqual({
      label: 'COMMON',
      color: 0xc8a46a,
      css: '#c8a46a',
      crateScale: 1,
      emissive: 0,
      beamHeight: 0,
      beamOpacity: 0,
      ringRadius: 0,
      pulseHz: 0,
    });
  });

  it('rare and epic have the specified rows', () => {
    expect(RARITY_STYLES.rare).toEqual({
      label: 'RARE',
      color: 0x3fa9ff,
      css: '#3fa9ff',
      crateScale: 1.35,
      emissive: 0.6,
      beamHeight: 14,
      beamOpacity: 0.32,
      ringRadius: 2.2,
      pulseHz: 0.8,
    });
    expect(RARITY_STYLES.epic).toEqual({
      label: 'EPIC',
      color: 0xc45bff,
      css: '#c45bff',
      crateScale: 1.7,
      emissive: 0.9,
      beamHeight: 26,
      beamOpacity: 0.48,
      ringRadius: 3.0,
      pulseHz: 1.3,
    });
  });

  it('scale and beam height rise common < rare < epic', () => {
    expect(RARITY_STYLES.common.crateScale).toBeLessThan(RARITY_STYLES.rare.crateScale);
    expect(RARITY_STYLES.rare.crateScale).toBeLessThan(RARITY_STYLES.epic.crateScale);
    expect(RARITY_STYLES.common.beamHeight).toBeLessThan(RARITY_STYLES.rare.beamHeight);
    expect(RARITY_STYLES.rare.beamHeight).toBeLessThan(RARITY_STYLES.epic.beamHeight);
  });

  it('rarityStyle maps undefined to common', () => {
    expect(rarityStyle(undefined)).toBe(RARITY_STYLES.common);
    expect(rarityStyle('rare')).toBe(RARITY_STYLES.rare);
    expect(rarityStyle('epic')).toBe(RARITY_STYLES.epic);
  });
});

describe('pulseScale', () => {
  it('is exactly 1 under reduced motion', () => {
    expect(pulseScale(RARITY_STYLES.epic, 0.3, true)).toBe(1);
    expect(pulseScale(RARITY_STYLES.rare, 1.7, true)).toBe(1);
  });

  it('is exactly 1 for common (pulseHz 0)', () => {
    expect(pulseScale(RARITY_STYLES.common, 1.7, false)).toBe(1);
  });

  it('peaks at 1 + PULSE_AMPLITUDE a quarter period in', () => {
    expect(PULSE_AMPLITUDE).toBeCloseTo(0.12, 6);
    expect(pulseScale(RARITY_STYLES.rare, 0, false)).toBeCloseTo(1, 6);
    expect(pulseScale(RARITY_STYLES.rare, 1 / (4 * 0.8), false)).toBeCloseTo(1.12, 6);
  });

  it('stays within [0.88, 1.12] over time', () => {
    for (let t = 0; t <= 10; t += 0.37) {
      const s = pulseScale(RARITY_STYLES.epic, t, false);
      expect(s).toBeGreaterThanOrEqual(0.88 - 1e-9);
      expect(s).toBeLessThanOrEqual(1.12 + 1e-9);
    }
  });

  it('returns 1 for a NaN time', () => {
    expect(pulseScale(RARITY_STYLES.rare, Number.NaN, false)).toBe(1);
  });
});

describe('elite helpers', () => {
  it('ELITE_STYLE carries the elite label and colour', () => {
    expect(ELITE_STYLE).toEqual({
      label: 'ELITE',
      color: 0xffc83d,
      css: '#ffc83d',
      star: '★',
      beaconScale: 1.35,
    });
  });

  it('isElite reads the elite flag only', () => {
    expect(isElite({ elite: true })).toBe(true);
    expect(isElite({})).toBe(false);
    expect(isElite(undefined)).toBe(false);
    expect(isElite(null)).toBe(false);
  });

  it('isEliteName matches the sim prefix', () => {
    expect(isEliteName('ELITE DESTROYER')).toBe(true);
    expect(isEliteName('DESTROYER')).toBe(false);
  });
});

describe('pickupToastText', () => {
  it('uses the rarity word for rare and epic crates', () => {
    expect(pickupToastText('health', 'rare')).toBe('RARE CRATE: +60 hull');
    expect(pickupToastText('health', 'epic')).toBe('EPIC CRATE: +100 hull');
    expect(pickupToastText('ammo', 'rare')).toBe('RARE CRATE: Mk-14 full, +3 Mk-18');
  });

  it('has no rarity word for common or absent rarity', () => {
    expect(pickupToastText('health', undefined)).toBe('CRATE: +35 hull');
    expect(pickupToastText('counter', 'common')).toBe('CRATE: decoys and bubbles full');
  });

  it('covers every kind', () => {
    expect(pickupToastText('hull', 'common')).toBe('CRATE: hull upgrade');
    expect(pickupToastText('weapon', 'common')).toBe('CRATE: weapon upgrade');
    expect(pickupToastText('speed', 'common')).toBe('CRATE: engine upgrade');
  });
});
