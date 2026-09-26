import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPreset,
  DEFAULT_PLAY_PREFERENCES,
  DEFAULT_SETTINGS,
  isPresetId,
  loadPlayPreferences,
  loadSettings,
  mergeSettings,
  parseSettingsJson,
  savePlayPreferences,
  saveSettings,
  settingsToJson,
  STORAGE_KEY,
} from '../src/core/settings';

const LEGACY_KEY = 'silent-depths-lookdev-v5';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

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

describe('play preference persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips master volume, reduced-motion override and quality', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const prefs = {
      masterVolume: 0.35,
      reducedMotion: 'reduce' as const,
      quality: 'low' as const,
    };
    savePlayPreferences(prefs);
    expect(loadPlayPreferences()).toEqual(prefs);

    // Saving look-dev must not drop the play record (the production save path).
    saveSettings(mergeSettings(DEFAULT_SETTINGS, { presentation: { hudOpacity: 0.5 } }));
    expect(loadPlayPreferences()).toEqual(prefs);
    expect(loadSettings().presentation.hudOpacity).toBe(0.5);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"version": 6');
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('migrates a v5 look-dev document onto v6 and fills default play prefs', () => {
    const store = memoryStorage();
    vi.stubGlobal('localStorage', store);
    const legacy = mergeSettings(DEFAULT_SETTINGS, { ocean: { clarity: 0.21 } });
    store.setItem(LEGACY_KEY, settingsToJson(legacy));

    expect(loadSettings().ocean.clarity).toBe(0.21);
    expect(store.getItem(LEGACY_KEY)).toBeNull();
    expect(store.getItem(STORAGE_KEY)).toContain('"version": 6');

    // The old key is gone; a later read still returns the migrated look-dev.
    expect(loadSettings().ocean.clarity).toBe(0.21);
    expect(loadPlayPreferences()).toEqual(DEFAULT_PLAY_PREFERENCES);
  });

  it('drops play fields that are not a volume, override or quality preference', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    savePlayPreferences({ masterVolume: 0.4, reducedMotion: 'reduce', quality: 'high' });
    savePlayPreferences({ masterVolume: 4, reducedMotion: 'nope', quality: 'ultra' });
    expect(loadPlayPreferences()).toEqual(DEFAULT_PLAY_PREFERENCES);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain('"masterVolume": 1');
    expect(raw).not.toContain('nope');
    expect(raw).not.toContain('ultra');
  });
});
