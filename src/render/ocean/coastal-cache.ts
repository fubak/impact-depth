/** Cached coastal field management with world version tracking. */

import type { WorldVersion } from '../environment/types';
import { buildCoastalField, type BedSampler, type CoastalField, type CoastalFieldConfig } from './coastal';

export interface CoastalCacheKey {
  readonly worldVersion: WorldVersion;
  readonly terrainSeed: number;
  readonly swellDirection: number;
  readonly extent: number;
  readonly resolution: number;
  readonly originX: number;
  readonly originZ: number;
}

export interface CoastalFieldSpec {
  readonly originX: number;
  readonly originZ: number;
  readonly extent: number;
  readonly resolution: number;
  readonly swellDirection: number;
}

interface CachedEntry {
  readonly key: CoastalCacheKey;
  readonly field: CoastalField;
  readonly timestamp: number;
}

export class CoastalFieldCache {
  private cache = new Map<string, CachedEntry>();
  private maxEntries = 4;
  private maxAge = 300_000; // 5 minutes
  private currentSpec: CoastalFieldSpec | null = null;
  private currentField: CoastalField | null = null;
  private pendingBuild: AbortController | null = null;

  private keyString(key: CoastalCacheKey): string {
    return `${key.worldVersion}:${key.terrainSeed}:${key.swellDirection.toFixed(3)}:${key.extent}:${key.resolution}:${key.originX.toFixed(1)}:${key.originZ.toFixed(1)}`;
  }

  private cleanup(): void {
    const now = performance.now();
    const entries = Array.from(this.cache.entries());
    
    // Remove expired entries
    for (const [keyStr, entry] of entries) {
      if (now - entry.timestamp > this.maxAge) {
        this.cache.delete(keyStr);
      }
    }
    
    // Remove oldest entries if over limit
    if (this.cache.size > this.maxEntries) {
      const sorted = entries
        .filter(([keyStr]) => this.cache.has(keyStr))
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      while (this.cache.size > this.maxEntries) {
        const [keyStr] = sorted.shift()!;
        this.cache.delete(keyStr);
      }
    }
  }

  getCurrentField(): CoastalField | null {
    return this.currentField;
  }

  async buildOrRetrieve(
    spec: CoastalFieldSpec,
    worldVersion: WorldVersion,
    terrainSeed: number,
    bedSampler: BedSampler,
    signal?: AbortSignal,
  ): Promise<CoastalField | null> {
    // Check if current field is still valid
    if (this.currentSpec && this.currentField && this.specsEqual(this.currentSpec, spec)) {
      return this.currentField;
    }

    const key: CoastalCacheKey = {
      worldVersion,
      terrainSeed,
      swellDirection: spec.swellDirection,
      extent: spec.extent,
      resolution: spec.resolution,
      originX: spec.originX,
      originZ: spec.originZ,
    };

    const keyStr = this.keyString(key);
    const cached = this.cache.get(keyStr);

    if (cached) {
      // Update access time
      this.cache.set(keyStr, { ...cached, timestamp: performance.now() });
      this.currentSpec = spec;
      this.currentField = cached.field;
      return cached.field;
    }

    // Cancel any pending build
    if (this.pendingBuild) {
      this.pendingBuild.abort();
      this.pendingBuild = null;
    }

    // Start new build
    this.pendingBuild = new AbortController();
    const buildSignal = signal 
      ? AbortSignal.any([signal, this.pendingBuild.signal])
      : this.pendingBuild.signal;

    try {
      const config: CoastalFieldConfig = {
        originX: spec.originX,
        originZ: spec.originZ,
        extent: spec.extent,
        resolution: spec.resolution,
        physics: { swellDirection: spec.swellDirection },
        signal: buildSignal,
      };

      const field = buildCoastalField(bedSampler, config);
      
      if (buildSignal.aborted) {
        return null;
      }

      // Cache the result
      this.cache.set(keyStr, {
        key,
        field,
        timestamp: performance.now(),
      });

      this.currentSpec = spec;
      this.currentField = field;
      this.cleanup();
      
      return field;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      throw error;
    } finally {
      if (this.pendingBuild && this.pendingBuild.signal === buildSignal) {
        this.pendingBuild = null;
      }
    }
  }

  private specsEqual(a: CoastalFieldSpec, b: CoastalFieldSpec): boolean {
    return (
      a.originX === b.originX &&
      a.originZ === b.originZ &&
      a.extent === b.extent &&
      a.resolution === b.resolution &&
      Math.abs(a.swellDirection - b.swellDirection) < 1e-6
    );
  }

  reset(): void {
    // Cancel any pending build
    if (this.pendingBuild) {
      this.pendingBuild.abort();
      this.pendingBuild = null;
    }

    // Clear cache and current state
    this.cache.clear();
    this.currentSpec = null;
    this.currentField = null;
  }

  dispose(): void {
    this.reset();
  }

  getDiagnostics() {
    return {
      cacheSize: this.cache.size,
      maxEntries: this.maxEntries,
      hasCurrent: this.currentField !== null,
      hasCurrentSpec: this.currentSpec !== null,
      isPending: this.pendingBuild !== null,
    };
  }
}