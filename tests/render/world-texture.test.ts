import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WORLD_SIZE } from '../../src/game/sim/constants';
import { simToWorldMeters } from '../../src/game/sim/coords';
import { createLegacyWorld, legacyHeight } from '../../src/game/world/legacy';
import {
  createLittoralWorld,
  LITTORAL_GRID,
  sampleLittoralBedMetres,
} from '../../src/game/world/littoral';
import { createPackedBedDataTexture } from '../../src/render/environment/bed-data-texture';
import {
  normalizedBedToMetres,
  packedBedUv,
  packWorldHeightTexture,
  samplePackedBed,
} from '../../src/render/environment/terrain-texture';

describe('world height texture packing', () => {
  it('matches CPU bed metres at texel centers within 0.1 m', () => {
    const world = createLegacyWorld(19);
    const packed = packWorldHeightTexture(world);
    expect(packed.bedMetres.length).toBe(WORLD_SIZE * WORLD_SIZE);
    for (const [x, y] of [
      [0.5, 0.5],
      [64.5, 64.5],
      [127.5, 127.5],
    ] as const) {
      const metres = simToWorldMeters(x, y);
      const packedY = samplePackedBed(packed, metres.x, metres.z);
      const expected = normalizedBedToMetres(legacyHeight(world, x, y));
      expect(Math.abs(packedY - expected)).toBeLessThanOrEqual(0.1);
    }
  });

  it('interpolates coastline and interior samples within 0.25 m of bilinear CPU bed', () => {
    const world = createLegacyWorld(77);
    const packed = packWorldHeightTexture(world);
    const probes = [
      [10.25, 10.25],
      [64.2, 64.8],
      [90.7, 40.3],
    ] as const;
    for (const [x, y] of probes) {
      const metres = simToWorldMeters(x, y);
      const packedY = samplePackedBed(packed, metres.x, metres.z);
      const x0 = Math.floor(x - 0.5) + 0.5;
      const y0 = Math.floor(y - 0.5) + 0.5;
      const tx = x - x0;
      const ty = y - y0;
      const a = normalizedBedToMetres(legacyHeight(world, x0, y0));
      const b = normalizedBedToMetres(legacyHeight(world, x0 + 1, y0));
      const c = normalizedBedToMetres(legacyHeight(world, x0, y0 + 1));
      const d = normalizedBedToMetres(legacyHeight(world, x0 + 1, y0 + 1));
      const expected = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      expect(Math.abs(packedY - expected)).toBeLessThanOrEqual(0.25);
    }
  });

  it('documents texel-center UVs that match GPU LinearFilter sampling', () => {
    const world = createLegacyWorld(19);
    const packed = packWorldHeightTexture(world);
    expect(packed.spec.sampleMode).toBe('texel-center');
    expect(packed.spec.clamp).toBe('edge');
    expect(packed.spec.interpolation).toBe('bilinear');
    const metres = simToWorldMeters(0.5, 0.5);
    const uv = packedBedUv(packed.spec, metres.x, metres.z);
    expect(uv.u).toBeCloseTo(0.5 / packed.spec.size, 10);
    expect(uv.v).toBeCloseTo(0.5 / packed.spec.size, 10);
  });

  it('uploads CPU Float32 bed metres as R32F, not half-float', () => {
    const packed = packWorldHeightTexture(createLegacyWorld(19));
    const texture = createPackedBedDataTexture(packed);
    expect(texture.image.data).toBe(packed.bedMetres);
    expect(texture.image.data).toBeInstanceOf(Float32Array);
    expect(texture.type).toBe(THREE.FloatType);
    expect(texture.type).not.toBe(THREE.HalfFloatType);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.internalFormat).toBe('R32F');
    expect(texture.flipY).toBe(false);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    texture.dispose();
  });

  it('uploads littoral-v2 canonical 1 m bed without downsampling to 128', () => {
    const world = createLittoralWorld(19);
    const packed = packWorldHeightTexture(world);
    expect(packed.spec.size).toBe(LITTORAL_GRID);
    expect(packed.spec.size).toBeGreaterThan(128);
    expect(packed.bedMetres).toBe(world.bedMetres);
    const wx = packed.spec.originX + packed.spec.extent * 0.5;
    const wz = packed.spec.originZ + packed.spec.extent * 0.5;
    expect(
      Math.abs(samplePackedBed(packed, wx, wz) - sampleLittoralBedMetres(world, wx, wz)),
    ).toBeLessThanOrEqual(0.1);
  });
});
