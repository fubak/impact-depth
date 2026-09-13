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

const OCEANS = new Set<OceanBackendName>(['gerstner', 'spectral']);
const WORLDS = new Set<WorldVersion>(['legacy-v1', 'littoral-v2']);
const QUALITIES = new Set<QualityName>(['high', 'medium', 'low']);

/** Parse `?ocean=&world=&quality=`. Unknown values diagnose and fall back; never corrupt state. */
export function parseRuntimeSelection(search: string): RuntimeSelection {
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
  let quality: QualityName = 'high';
  let qualityForced = false;
  if (qualityRaw) {
    if (QUALITIES.has(qualityRaw as QualityName)) {
      quality = qualityRaw as QualityName;
      qualityForced = true;
    } else diagnostics.push(`unknown quality=${qualityRaw}; using high`);
  }

  return { ocean, world, quality, qualityForced, diagnostics };
}
