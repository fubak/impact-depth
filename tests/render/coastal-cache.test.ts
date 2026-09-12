import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoastalFieldCache } from '../../src/render/ocean/coastal-cache';

const mockBedSampler = (x: number, z: number): number => {
  // Simple synthetic bed: flat at -10m with a circular island at origin
  const distFromOrigin = Math.sqrt(x * x + z * z);
  if (distFromOrigin < 100) {
    // Island: rises to +5m at center, falls to sea level at edge
    const height = 5 * (1 - distFromOrigin / 100);
    return Math.max(height, -10);
  }
  return -10; // Deep water elsewhere
};

describe('CoastalFieldCache', () => {
  let cache: CoastalFieldCache;

  beforeEach(() => {
    cache = new CoastalFieldCache();
  });

  afterEach(() => {
    cache.dispose();
  });

  it('should build and cache coastal field', async () => {
    const spec = {
      originX: -512,
      originZ: -512,
      extent: 1024,
      resolution: 64,
      swellDirection: 0.5,
    };

    const field = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field).toBeDefined();
    expect(field!.resolution).toBe(64);
    expect(field!.extent).toBe(1024);
    expect(field!.data).toBeInstanceOf(Float32Array);
    expect(field!.data.length).toBe(64 * 64 * 4); // RGBA format
  });

  it('should return cached field for same parameters', async () => {
    const spec = {
      originX: -256,
      originZ: -256,
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };

    const field1 = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    const field2 = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field1).toBe(field2); // Same object reference
  });

  it('should build new field for different parameters', async () => {
    const spec1 = {
      originX: -256,
      originZ: -256,
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };

    const spec2 = {
      ...spec1,
      swellDirection: 0.7, // Different swell direction
    };

    const field1 = await cache.buildOrRetrieve(
      spec1,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    const field2 = await cache.buildOrRetrieve(
      spec2,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field1).not.toBe(field2);
    expect(field1!.swellDirection).toBeCloseTo(0.3);
    expect(field2!.swellDirection).toBeCloseTo(0.7);
  });

  it('should miss cache when coastal window origin moves', async () => {
    const base = {
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };
    const field1 = await cache.buildOrRetrieve(
      { ...base, originX: -256, originZ: -256 },
      'legacy-v1',
      42,
      mockBedSampler,
    );
    // Drop currentSpec so the Map key path is exercised (not the hot currentSpec short-circuit).
    cache.reset();
    await cache.buildOrRetrieve(
      { ...base, originX: -256, originZ: -256 },
      'legacy-v1',
      42,
      mockBedSampler,
    );
    const fieldMoved = await cache.buildOrRetrieve(
      { ...base, originX: 0, originZ: 128 },
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field1).toBeDefined();
    expect(fieldMoved).toBeDefined();
    expect(fieldMoved).not.toBe(field1);
    expect(fieldMoved!.originX).toBe(0);
    expect(fieldMoved!.originZ).toBe(128);
  });

  it('should handle aborted builds gracefully', async () => {
    const controller = new AbortController();
    const spec = {
      originX: -256,
      originZ: -256,
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };

    // Abort immediately
    controller.abort();

    const field = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
      controller.signal,
    );

    expect(field).toBeNull();
  });

  it('should reset cache correctly', async () => {
    const spec = {
      originX: -256,
      originZ: -256,
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };

    const field1 = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field1).toBeDefined();
    expect(cache.getCurrentField()).toBe(field1);

    cache.reset();

    expect(cache.getCurrentField()).toBeNull();

    const field2 = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      42,
      mockBedSampler,
    );

    expect(field2).toBeDefined();
    expect(field2).not.toBe(field1); // New field built after reset
  });

  it('should provide diagnostic information', async () => {
    const diagnostics1 = cache.getDiagnostics();
    expect(diagnostics1.cacheSize).toBe(0);
    expect(diagnostics1.hasCurrent).toBe(false);
    expect(diagnostics1.hasCurrentSpec).toBe(false);

    const spec = {
      originX: -256,
      originZ: -256,
      extent: 512,
      resolution: 32,
      swellDirection: 0.3,
    };

    await cache.buildOrRetrieve(spec, 'legacy-v1', 42, mockBedSampler);

    const diagnostics2 = cache.getDiagnostics();
    expect(diagnostics2.cacheSize).toBe(1);
    expect(diagnostics2.hasCurrent).toBe(true);
    expect(diagnostics2.hasCurrentSpec).toBe(true);
  });

  it('should handle terrain field boundary conditions', async () => {
    const spec = {
      originX: -100,
      originZ: -100,
      extent: 200,
      resolution: 16,
      swellDirection: 0.0,
    };

    const field = await cache.buildOrRetrieve(
      spec,
      'legacy-v1',
      1,
      mockBedSampler,
    );

    expect(field).toBeDefined();
    expect(field!.data).toBeInstanceOf(Float32Array);
    
    // Check that we got sensible travel delay values (not infinite)
    let hasFiniteTravelDelay = false;
    for (let i = 0; i < field!.data.length; i += 4) {
      const travelDelay = field!.data[i]; // Red channel = travel delay
      if (isFinite(travelDelay) && Math.abs(travelDelay) < 100) {
        hasFiniteTravelDelay = true;
        break;
      }
    }
    
    expect(hasFiniteTravelDelay).toBe(true);
  });
});