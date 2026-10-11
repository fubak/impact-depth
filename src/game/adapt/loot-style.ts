import { ELITE_NAME_PREFIX } from '../sim/elites';
import { HEALTH_BY_RARITY, SEEKERS_BY_RARITY } from '../sim/loot';
import type { PowerupKind, PowerupRarity } from '../sim/types';

export interface RarityStyle {
  readonly label: 'COMMON' | 'RARE' | 'EPIC';
  /** Hex colour for Three.js. */
  readonly color: number;
  /** Same colour for CSS. */
  readonly css: string;
  readonly crateScale: number;
  /** MeshStandardMaterial.emissiveIntensity; 0 = leave the crate material alone. */
  readonly emissive: number;
  /** Metres; 0 = no beam. */
  readonly beamHeight: number;
  readonly beamOpacity: number;
  /** Metres; 0 = no ring. */
  readonly ringRadius: number;
  /** 0 = no pulse. */
  readonly pulseHz: number;
}

export const RARITY_STYLES: Readonly<Record<PowerupRarity, RarityStyle>> = {
  common: {
    label: 'COMMON',
    color: 0xc8a46a,
    css: '#c8a46a',
    crateScale: 1,
    emissive: 0,
    beamHeight: 0,
    beamOpacity: 0,
    ringRadius: 0,
    pulseHz: 0,
  },
  rare: {
    label: 'RARE',
    color: 0x3fa9ff,
    css: '#3fa9ff',
    crateScale: 1.35,
    emissive: 0.6,
    beamHeight: 14,
    beamOpacity: 0.32,
    ringRadius: 2.2,
    pulseHz: 0.8,
  },
  epic: {
    label: 'EPIC',
    color: 0xc45bff,
    css: '#c45bff',
    crateScale: 1.7,
    emissive: 0.9,
    beamHeight: 26,
    beamOpacity: 0.48,
    ringRadius: 3.0,
    pulseHz: 1.3,
  },
};

export const PULSE_AMPLITUDE = 0.12;

export const rarityStyle = (rarity: PowerupRarity | undefined): RarityStyle =>
  RARITY_STYLES[rarity ?? 'common'];

/** 1 + 0.12·sin(2π·hz·t); exactly 1 under reduced motion, for hz 0, or for non-finite t. */
export function pulseScale(style: RarityStyle, timeS: number, reducedMotion: boolean): number {
  if (reducedMotion || style.pulseHz === 0 || !Number.isFinite(timeS)) {
    return 1;
  }
  return 1 + PULSE_AMPLITUDE * Math.sin(2 * Math.PI * style.pulseHz * timeS);
}

export const ELITE_STYLE = {
  label: 'ELITE',
  color: 0xffc83d,
  css: '#ffc83d',
  star: '★',
  beaconScale: 1.35,
} as const;

export const isElite = (ship: { elite?: boolean } | null | undefined): boolean =>
  ship?.elite === true;

export const isEliteName = (name: string): boolean => name.startsWith(ELITE_NAME_PREFIX);

const RARITY_PREFIX: Readonly<Record<PowerupRarity, string>> = {
  common: 'CRATE: ',
  rare: 'RARE CRATE: ',
  epic: 'EPIC CRATE: ',
};

/** Toast for a collected crate, e.g. 'RARE CRATE: +60 hull'. Common/absent rarity has no rarity word. */
export function pickupToastText(kind: PowerupKind, rarity: PowerupRarity | undefined): string {
  const r: PowerupRarity = rarity ?? 'common';
  const prefix = RARITY_PREFIX[r];
  switch (kind) {
    case 'health':
      return `${prefix}+${HEALTH_BY_RARITY[r]} hull`;
    case 'ammo':
      return `${prefix}Mk-14 full, +${SEEKERS_BY_RARITY[r]} Mk-18`;
    case 'hull':
      return `${prefix}hull upgrade`;
    case 'weapon':
      return `${prefix}weapon upgrade`;
    case 'speed':
      return `${prefix}engine upgrade`;
    case 'counter':
      return `${prefix}decoys and bubbles full`;
  }
}
