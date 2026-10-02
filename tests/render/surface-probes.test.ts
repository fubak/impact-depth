import { describe, expect, it } from 'vitest';
import {
  PROBE_CADENCE_HZ,
  PROBE_MAX_AGE,
  PROBE_SPATIAL_TOLERANCE_M,
  SurfaceProbeQueue,
  buildFootprintRequests,
  decodeProbeOutput,
  filterProbeResults,
  isFreshProbe,
  prioritizeProbeRequests,
  probeSampleId,
  shouldRequestProbes,
  type SurfaceProbeResult,
} from '../../src/render/ocean/surface-probes';

function sample(overrides: Partial<SurfaceProbeResult> = {}): SurfaceProbeResult {
  return {
    id: 'ship-a:center',
    entityId: 'ship-a',
    site: 'center',
    x: 4,
    z: -2,
    height: 1.2,
    slopeX: 0.01,
    slopeZ: -0.02,
    time: 10,
    queryX: 4,
    queryZ: -2,
    originX: 4,
    originZ: -2,
    missionGeneration: 3,
    backendGeneration: 2,
    ...overrides,
  };
}

describe('surface probe tagging', () => {
  it('builds five footprint requests tagged by entity and site', () => {
    const requests = buildFootprintRequests('escort', 0, 0, 0, 8);
    expect(requests).toHaveLength(5);
    expect(requests.map((item) => item.site)).toEqual([
      'center',
      'bow',
      'stern',
      'port',
      'starboard',
    ]);
    expect(requests[0]?.id).toBe(probeSampleId('escort', 'center'));
    expect(requests.every((item) => item.entityId === 'escort')).toBe(true);
  });

  it('decodes readback texels with mission, backend, time, and query position', () => {
    const batch = buildFootprintRequests('p', 1, 2, 0, 4).slice(0, 1);
    const output = new Float32Array([0.8, 0.1, -0.05, 1]);
    const decoded = decodeProbeOutput(batch, output, {
      time: 12.5,
      missionGeneration: 7,
      backendGeneration: 4,
    });
    const first = decoded[0]!;
    expect(first.entityId).toBe('p');
    expect(first.height).toBeCloseTo(0.8, 5);
    expect(first.slopeX).toBeCloseTo(0.1, 5);
    expect(first.slopeZ).toBeCloseTo(-0.05, 5);
    expect(first.time).toBe(12.5);
    expect(first.queryX).toBe(1);
    expect(first.queryZ).toBe(2);
    expect(first.originX).toBe(1);
    expect(first.originZ).toBe(2);
    expect(first.missionGeneration).toBe(7);
    expect(first.backendGeneration).toBe(4);
  });
});

describe('surface probe freshness', () => {
  it('drops stale mission, backend, despawned, and aged samples', () => {
    const live = new Set(['ship-a']);
    expect(
      isFreshProbe(sample(), {
        missionGeneration: 3,
        backendGeneration: 2,
        now: 10.1,
        livingIds: live,
      }),
    ).toBe(true);
    expect(
      isFreshProbe(sample(), { missionGeneration: 4, backendGeneration: 2, livingIds: live }),
    ).toBe(false);
    expect(
      isFreshProbe(sample(), { missionGeneration: 3, backendGeneration: 9, livingIds: live }),
    ).toBe(false);
    expect(
      isFreshProbe(sample(), {
        missionGeneration: 3,
        backendGeneration: 2,
        livingIds: new Set(['other']),
      }),
    ).toBe(false);
    expect(
      isFreshProbe(sample(), {
        missionGeneration: 3,
        backendGeneration: 2,
        now: 10 + PROBE_MAX_AGE + 0.01,
        livingIds: live,
      }),
    ).toBe(false);
    expect(
      filterProbeResults([sample(), sample({ entityId: 'dead', id: 'dead:center' })], {
        missionGeneration: 3,
        backendGeneration: 2,
        livingIds: live,
      }),
    ).toHaveLength(1);
  });

  it('keeps a camera waterline sample even when it is not a living ship id', () => {
    expect(
      isFreshProbe(sample({ entityId: 'camera', id: 'camera:center', site: 'center' }), {
        missionGeneration: 3,
        backendGeneration: 2,
        livingIds: new Set(['ship-a']),
      }),
    ).toBe(true);
  });

  it('rejects a sample whose query point has moved beyond the spatial tolerance', () => {
    const live = new Set(['ship-a']);
    const query = {
      missionGeneration: 3,
      backendGeneration: 2,
      now: 10.1,
      livingIds: live,
      positions: new Map([['ship-a', { x: 40, z: -2 }]]),
      maxSpatialError: PROBE_SPATIAL_TOLERANCE_M,
    };
    expect(
      isFreshProbe(sample({ queryX: 4, queryZ: -2, x: 4, z: -2, originX: 4, originZ: -2 }), query),
    ).toBe(false);
    expect(
      isFreshProbe(
        sample({ queryX: 39.5, queryZ: -2.2, x: 39.5, z: -2.2, originX: 39.5, originZ: -2.2 }),
        query,
      ),
    ).toBe(true);
  });

  it('does not treat bow/stern site offset as spatial drift of the hull', () => {
    const live = new Set(['ship-a']);
    expect(
      isFreshProbe(
        sample({
          site: 'stern',
          x: -4,
          z: -2,
          queryX: -4,
          queryZ: -2,
          originX: 4,
          originZ: -2,
        }),
        {
          missionGeneration: 3,
          backendGeneration: 2,
          now: 10.1,
          livingIds: live,
          positions: new Map([['ship-a', { x: 6, z: -2 }]]),
          maxSpatialError: PROBE_SPATIAL_TOLERANCE_M,
        },
      ),
    ).toBe(true);
  });
});

describe('surface probe cadence and priority', () => {
  it('issues around 10 Hz and never while a readback is pending', () => {
    expect(PROBE_CADENCE_HZ).toBe(10);
    expect(shouldRequestProbes(false, null, 1)).toBe(true);
    expect(shouldRequestProbes(true, 1, 1.5)).toBe(false);
    expect(shouldRequestProbes(false, 1, 1.05)).toBe(false);
    expect(shouldRequestProbes(false, 1, 1.11)).toBe(true);
  });

  it('keeps the player and near-camera hulls when the batch exceeds capacity', () => {
    const far = Array.from({ length: 12 }, (_, i) => ({
      entityId: `far-${i}`,
      x: 400 + i * 20,
      z: 400,
      heading: 0,
      span: 8,
      depth: 0,
    }));
    const requests = prioritizeProbeRequests(
      [
        { entityId: 'player', x: 0, z: 0, heading: 0, span: 7, depth: 0 },
        { entityId: 'near', x: 12, z: 4, heading: 0.2, span: 8, depth: 0 },
        ...far,
      ],
      { x: 0, z: 0 },
      16,
    );
    expect(requests.some((item) => item.entityId === 'player')).toBe(true);
    expect(requests.some((item) => item.entityId === 'near')).toBe(true);
    expect(requests.some((item) => item.entityId === 'camera')).toBe(true);
    expect(requests.length).toBeLessThanOrEqual(16);
    expect(requests.filter((item) => item.entityId.startsWith('far-')).length).toBeLessThan(
      far.length * 5,
    );
  });
});

describe('SurfaceProbeQueue reset', () => {
  it('invalidates consumed results without starting a second readback', () => {
    const queue = new SurfaceProbeQueue(8);
    expect(queue.hasPendingReadback).toBe(false);
    expect(queue.capacity).toBe(8);
    queue.reset();
    expect(queue.consume({ missionGeneration: 1, backendGeneration: 1 })).toEqual([]);
    queue.reset();
    expect(queue.hasPendingReadback).toBe(false);
    queue.dispose();
    queue.dispose();
  });
});
