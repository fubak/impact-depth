import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  isPresetId,
  mergeSettings,
  parseSettingsJson,
  settingsToJson,
} from '../src/core/settings';

describe('look-dev settings', () => {
  it('clones Caribbean presets independently', () => {
    const a = applyPreset('caribbean-noon');
    const b = applyPreset('golden-cay');
    expect(a.atmosphere.sunElevation).not.toBe(b.atmosphere.sunElevation);
    expect(a.preset).toBe('caribbean-noon');
    expect(a.ocean.clarity).toBeGreaterThan(0.5);
  });

  it('round-trips JSON', () => {
    const json = settingsToJson(DEFAULT_SETTINGS);
    const parsed = parseSettingsJson(json);
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects invalid JSON', () => {
    expect(parseSettingsJson('{nope')).toBeNull();
  });

  it('merges partial ocean and environment updates', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      ocean: { clarity: 0.5, foamAmount: 0.9 },
      environment: { sandColor: '#abcdef' },
    });
    expect(merged.ocean.clarity).toBe(0.5);
    expect(merged.ocean.foamAmount).toBe(0.9);
    expect(merged.ocean.seaState).toBe(DEFAULT_SETTINGS.ocean.seaState);
    expect(merged.environment.sandColor).toBe('#abcdef');
    expect(merged.environment.foliageColor).toBe(DEFAULT_SETTINGS.environment.foliageColor);
  });

  it('validates tropical preset ids', () => {
    expect(isPresetId('caribbean-noon')).toBe(true);
    expect(isPresetId('trade-wind-morning')).toBe(true);
    expect(isPresetId('golden-cay')).toBe(true);
    expect(isPresetId('north-atlantic')).toBe(false);
  });

  it('defaults to Caribbean Noon with visible water and grid off', () => {
    expect(DEFAULT_SETTINGS.preset).toBe('caribbean-noon');
    expect(DEFAULT_SETTINGS.ocean.shallowColor.toLowerCase()).toBe('#42dde0');
    expect(DEFAULT_SETTINGS.ocean.deepColor.toLowerCase()).toBe('#0b88c4');
    expect(DEFAULT_SETTINGS.ocean.clarity).toBe(0.72);
    expect(DEFAULT_SETTINGS.presentation.tacticalGrid).toBe(false);
  });
});
