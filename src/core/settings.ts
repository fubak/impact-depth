import type { LookDevSettings, PresetId } from './types';

/** Current envelope. v5 stored a bare look-dev document; v6 adds play preferences. */
export const STORAGE_KEY = 'silent-depths-lookdev-v6';
export const LEGACY_STORAGE_KEY = 'silent-depths-lookdev-v5';

export type ReducedMotionPreference = 'system' | 'reduce' | 'allow';
export type QualityPreference = 'auto' | 'high' | 'medium' | 'low';

export interface PlayPreferences {
  /** Linear gain, 0–1. */
  masterVolume: number;
  /** `system` follows the OS; `reduce` forces reduced motion; `allow` forces full motion. */
  reducedMotion: ReducedMotionPreference;
  quality: QualityPreference;
  captions: boolean;
  pauseOnBlur: boolean;
}

export const DEFAULT_PLAY_PREFERENCES: PlayPreferences = {
  masterVolume: 1,
  reducedMotion: 'system',
  quality: 'auto',
  captions: true,
  pauseOnBlur: true,
};

const ENVELOPE_VERSION = 6;

export const DEFAULT_SETTINGS: LookDevSettings = {
  atmosphere: {
    timeOfDay: 0.42,
    fogDensity: 0.0007,
    exposure: 1.15,
    sunElevation: 58,
    sunAzimuth: 145,
    sunIntensity: 1.35,
  },
  ocean: {
    seaState: 0.34,
    waveHeight: 0.55,
    choppiness: 0.45,
    deepColor: '#0b88c4',
    shallowColor: '#42dde0',
    foamAmount: 0.14,
    clarity: 0.72,
    absorption: 0.36,
  },
  environment: {
    sandColor: '#c8b57a',
    foliageColor: '#243e2c',
    rockColor: '#6a6e62',
  },
  presentation: {
    hudOpacity: 0.92,
    labelDensity: 0.45,
    filmGrain: 0.03,
    vignette: 0.08,
    tacticalGrid: false,
  },
  preset: 'caribbean-noon',
};

export const PRESETS: Record<PresetId, LookDevSettings> = {
  'caribbean-noon': {
    ...structuredClone(DEFAULT_SETTINGS),
    preset: 'caribbean-noon',
  },
  'trade-wind-morning': {
    atmosphere: {
      timeOfDay: 0.28,
      fogDensity: 0.0022,
      exposure: 0.88,
      sunElevation: 28,
      sunAzimuth: 95,
      sunIntensity: 0.95,
    },
    ocean: {
      seaState: 0.38,
      waveHeight: 0.68,
      choppiness: 0.52,
      deepColor: '#0a7fb8',
      shallowColor: '#40d4d0',
      foamAmount: 0.18,
      clarity: 0.68,
      absorption: 0.42,
    },
    environment: {
      sandColor: '#cbb882',
      foliageColor: '#2a5c34',
      rockColor: '#5a6a56',
    },
    presentation: {
      hudOpacity: 0.92,
      labelDensity: 0.5,
      filmGrain: 0.04,
      vignette: 0.1,
      tacticalGrid: false,
    },
    preset: 'trade-wind-morning',
  },
  'golden-cay': {
    atmosphere: {
      timeOfDay: 0.72,
      fogDensity: 0.0026,
      exposure: 0.88,
      sunElevation: 18,
      sunAzimuth: 250,
      sunIntensity: 1.02,
    },
    ocean: {
      seaState: 0.26,
      waveHeight: 0.45,
      choppiness: 0.38,
      deepColor: '#0a72a8',
      shallowColor: '#38c8c4',
      foamAmount: 0.12,
      clarity: 0.7,
      absorption: 0.42,
    },
    environment: {
      sandColor: '#d0b070',
      foliageColor: '#286c3e',
      rockColor: '#645a4a',
    },
    presentation: {
      hudOpacity: 0.92,
      labelDensity: 0.4,
      filmGrain: 0.05,
      vignette: 0.12,
      tacticalGrid: false,
    },
    preset: 'golden-cay',
  },
};

export function cloneSettings(settings: LookDevSettings): LookDevSettings {
  return structuredClone(settings);
}

export function applyPreset(id: PresetId): LookDevSettings {
  return cloneSettings(PRESETS[id]);
}

export type SettingsPatch = {
  atmosphere?: Partial<LookDevSettings['atmosphere']>;
  ocean?: Partial<LookDevSettings['ocean']>;
  environment?: Partial<LookDevSettings['environment']>;
  presentation?: Partial<LookDevSettings['presentation']>;
  preset?: string;
};

export function mergeSettings(base: LookDevSettings, partial: SettingsPatch): LookDevSettings {
  return {
    atmosphere: { ...base.atmosphere, ...partial.atmosphere },
    ocean: { ...base.ocean, ...partial.ocean },
    environment: { ...base.environment, ...partial.environment },
    presentation: { ...base.presentation, ...partial.presentation },
    preset: partial.preset ?? base.preset,
  };
}

export function settingsToJson(settings: LookDevSettings): string {
  return JSON.stringify(settings, null, 2);
}

export function parseSettingsJson(raw: string): LookDevSettings | null {
  try {
    const parsed = JSON.parse(raw) as SettingsPatch;
    if (!parsed || typeof parsed !== 'object') return null;
    return mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return null;
  }
}

interface StoredEnvelope {
  lookdev: LookDevSettings;
  play: PlayPreferences;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReducedMotion(value: unknown): value is ReducedMotionPreference {
  return value === 'system' || value === 'reduce' || value === 'allow';
}

function isQualityPreference(value: unknown): value is QualityPreference {
  return value === 'auto' || value === 'high' || value === 'medium' || value === 'low';
}

function clonePlay(play: PlayPreferences): PlayPreferences {
  return {
    masterVolume: play.masterVolume,
    reducedMotion: play.reducedMotion,
    quality: play.quality,
    captions: play.captions,
    pauseOnBlur: play.pauseOnBlur,
  };
}

/** Rejects a bad volume or an unknown override/quality instead of clamping garbage into a pref. */
function normalizePlayPreferences(value: unknown): PlayPreferences {
  if (!isRecord(value)) return clonePlay(DEFAULT_PLAY_PREFERENCES);
  const volume = value.masterVolume;
  const reduced = value.reducedMotion;
  const quality = value.quality;
  const volumeOk =
    typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && volume <= 1;
  if (!volumeOk || !isReducedMotion(reduced) || !isQualityPreference(quality)) {
    return clonePlay(DEFAULT_PLAY_PREFERENCES);
  }
  return {
    masterVolume: volume,
    reducedMotion: reduced,
    quality,
    captions: typeof value.captions === 'boolean' ? value.captions : true,
    pauseOnBlur: typeof value.pauseOnBlur === 'boolean' ? value.pauseOnBlur : true,
  };
}

function parseEnvelope(raw: string): StoredEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== ENVELOPE_VERSION || !isRecord(parsed.lookdev)) {
      return null;
    }
    const lookdev = parseSettingsJson(JSON.stringify(parsed.lookdev));
    if (!lookdev) return null;
    return { lookdev, play: normalizePlayPreferences(parsed.play) };
  } catch {
    return null;
  }
}

function browserStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function freshEnvelope(): StoredEnvelope {
  return { lookdev: cloneSettings(DEFAULT_SETTINGS), play: clonePlay(DEFAULT_PLAY_PREFERENCES) };
}

function writeEnvelope(store: Storage, envelope: StoredEnvelope): void {
  const body = {
    version: ENVELOPE_VERSION,
    lookdev: envelope.lookdev,
    play: envelope.play,
  };
  store.setItem(STORAGE_KEY, JSON.stringify(body, null, 2));
  store.removeItem(LEGACY_STORAGE_KEY);
}

/** Read v6, or copy a v5 look-dev document forward and drop the old key. */
function readEnvelope(): StoredEnvelope {
  const store = browserStorage();
  if (!store) return freshEnvelope();
  try {
    const current = store.getItem(STORAGE_KEY);
    if (current) {
      const parsed = parseEnvelope(current);
      if (parsed) return parsed;
    }
    const legacyRaw = store.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const lookdev = parseSettingsJson(legacyRaw);
      if (lookdev) {
        const migrated: StoredEnvelope = { lookdev, play: clonePlay(DEFAULT_PLAY_PREFERENCES) };
        writeEnvelope(store, migrated);
        return migrated;
      }
    }
    return freshEnvelope();
  } catch {
    return freshEnvelope();
  }
}

export function loadSettings(): LookDevSettings {
  return cloneSettings(readEnvelope().lookdev);
}

export function loadPlayPreferences(): PlayPreferences {
  return clonePlay(readEnvelope().play);
}

export function saveSettings(settings: LookDevSettings): void {
  const store = browserStorage();
  if (!store) return;
  try {
    const current = readEnvelope();
    writeEnvelope(store, { lookdev: cloneSettings(settings), play: current.play });
  } catch {
    // Ignore quota / private mode failures
  }
}

export function savePlayPreferences(prefs: unknown): PlayPreferences {
  const normalized = normalizePlayPreferences(prefs);
  const store = browserStorage();
  if (!store) return normalized;
  try {
    const current = readEnvelope();
    writeEnvelope(store, { lookdev: current.lookdev, play: normalized });
  } catch {
    // Ignore quota / private mode failures
  }
  return normalized;
}

export function isPresetId(value: string): value is PresetId {
  return value === 'caribbean-noon' || value === 'trade-wind-morning' || value === 'golden-cay';
}
