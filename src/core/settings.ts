import type { LookDevSettings, PresetId } from './types';

export const STORAGE_KEY = 'silent-depths-lookdev-v5';

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
  /**
   * Cinematic sunset (Plan 021): grazing ember sun just above the horizon, held
   * so the patrol never drifts to night, warmer haze for atmospheric depth,
   * deeper sapphire water so the sun road and crest glow carry the frame.
   */
  'sunset-passage': {
    atmosphere: {
      timeOfDay: 0.74,
      fogDensity: 0.0021,
      exposure: 1.1,
      sunElevation: 8,
      sunAzimuth: 128,
      sunIntensity: 1.25,
      dayLengthSeconds: 0,
    },
    ocean: {
      seaState: 0.42,
      waveHeight: 0.72,
      choppiness: 0.5,
      deepColor: '#0a3d66',
      shallowColor: '#2aa6a8',
      foamAmount: 0.2,
      clarity: 0.62,
      absorption: 0.55,
    },
    environment: {
      sandColor: '#c79a68',
      foliageColor: '#2a4a30',
      rockColor: '#5e4a40',
    },
    presentation: {
      hudOpacity: 0.92,
      labelDensity: 0.4,
      filmGrain: 0.04,
      vignette: 0.16,
      tacticalGrid: false,
    },
    preset: 'sunset-passage',
  },
};

/** Presentation day phase in [0, 1). Presets may hold time with `dayLengthSeconds: 0`. */
export function presentationDayPhase(atmosphere: LookDevSettings['atmosphere'], time: number): number {
  const length = atmosphere.dayLengthSeconds ?? 480;
  const advance = length > 0 ? (time % length) / length : 0;
  return (((atmosphere.timeOfDay + advance) % 1) + 1) % 1;
}

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
  return (
    value === 'caribbean-noon' ||
    value === 'trade-wind-morning' ||
    value === 'golden-cay' ||
    value === 'sunset-passage'
  );
}
