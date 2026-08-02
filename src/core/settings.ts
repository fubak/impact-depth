import type { LookDevSettings, PresetId } from './types';

export const STORAGE_KEY = 'silent-depths-lookdev-v4';

export const DEFAULT_SETTINGS: LookDevSettings = {
  atmosphere: {
    timeOfDay: 0.42,
    fogDensity: 0.0007,
    exposure: 0.95,
    sunElevation: 58,
    sunAzimuth: 145,
    sunIntensity: 1.18,
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
    foliageColor: '#4aa05c',
    rockColor: '#889888',
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
      foliageColor: '#318048',
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

export function loadSettings(): LookDevSettings {
  if (typeof localStorage === 'undefined') {
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    return parseSettingsJson(raw) ?? cloneSettings(DEFAULT_SETTINGS);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: LookDevSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, settingsToJson(settings));
  } catch {
    // Ignore quota / private mode failures
  }
}

export function isPresetId(value: string): value is PresetId {
  return value === 'caribbean-noon' || value === 'trade-wind-morning' || value === 'golden-cay';
}
