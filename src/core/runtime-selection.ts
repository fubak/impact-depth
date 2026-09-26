import type { QualityName } from '../render/quality';
import type { OceanBackendName, WorldVersion } from '../render/environment/types';

export interface RuntimeSelection {
  ocean: OceanBackendName;
  world: WorldVersion;
  quality: QualityName;
  /** True when `?quality=` is a valid profile — governor must not auto-change. */
  qualityForced: boolean;
  diagnostics: readonly string[];
}

export interface DeviceCapabilities {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  isMobile?: boolean;
}

const OCEANS = new Set<OceanBackendName>(['gerstner', 'spectral']);
const WORLDS = new Set<WorldVersion>(['legacy-v1', 'littoral-v2']);
const QUALITIES = new Set<QualityName>(['high', 'medium', 'low']);

/**
 * Select quality profile based on device capabilities.
 * Returns 'low' when deviceMemory ≤ 4, hardwareConcurrency ≤ 4, or the UA is mobile.
 * Pure function: no global side effects, testable with a capabilities object.
 */
export function selectQualityFromCapabilities(capabilities: DeviceCapabilities): QualityName {
  const { deviceMemory, hardwareConcurrency, isMobile } = capabilities;

  if (deviceMemory !== undefined && deviceMemory <= 4) return 'low';
  if (hardwareConcurrency !== undefined && hardwareConcurrency <= 4) return 'low';
  if (isMobile === true) return 'low';

  return 'high';
}

/** Parse `?ocean=&world=&quality=`. Unknown values diagnose and fall back; never corrupt state. */
export function parseRuntimeSelection(
  search: string,
  capabilities: DeviceCapabilities = getDefaultCapabilities(),
): RuntimeSelection {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const diagnostics: string[] = [];

  const oceanRaw = params.get('ocean');
  let ocean: OceanBackendName = 'spectral';
  if (oceanRaw) {
    if (OCEANS.has(oceanRaw as OceanBackendName)) ocean = oceanRaw as OceanBackendName;
    else {
      ocean = 'gerstner';
      diagnostics.push(`unknown ocean=${oceanRaw}; using gerstner`);
    }
  }

  const worldRaw = params.get('world');
  let world: WorldVersion = 'legacy-v1';
  if (worldRaw) {
    if (WORLDS.has(worldRaw as WorldVersion)) world = worldRaw as WorldVersion;
    else diagnostics.push(`unknown world=${worldRaw}; using legacy-v1`);
  }

  const qualityRaw = params.get('quality');
  let quality: QualityName;
  let qualityForced = false;
  if (qualityRaw) {
    if (QUALITIES.has(qualityRaw as QualityName)) {
      quality = qualityRaw as QualityName;
      qualityForced = true;
    } else {
      quality = selectQualityFromCapabilities(capabilities);
      diagnostics.push(`unknown quality=${qualityRaw}; using ${quality}`);
    }
  } else {
    quality = selectQualityFromCapabilities(capabilities);
  }

  return { ocean, world, quality, qualityForced, diagnostics };
}

/**
 * Get default capabilities from navigator API when available.
 * Falls back to undefined values in environments where navigator is unavailable.
 */
function getDefaultCapabilities(): DeviceCapabilities {
  // Safe checks for navigator APIs
  const isMobile =
    typeof navigator !== 'undefined' && /mobile|android|iphone|ipad|windows phone/i.test(navigator.userAgent);

  return {
    deviceMemory:
      typeof navigator !== 'undefined' ? (navigator as any).deviceMemory : undefined,
    hardwareConcurrency:
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
    isMobile,
  };
}
