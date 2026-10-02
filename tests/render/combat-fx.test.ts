import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  burstParticles,
  createLcg,
  FLASH_TTL_S,
  MAX_ADDITIVE_SCALE_M,
} from '../../src/render/presentation/combat-fx';
import { combatEventBursts } from '../../src/render/presentation/combat-event-fx';
import { bloomEmitterGain } from '../../src/render/post';
import { VfxPool } from '../../src/render/vfx';

describe('combat fx presets', () => {
  it('torpedoHit spawns a hull-scale fireball plus water column, debris and secondaries', () => {
    const list = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 });
    expect(list.length).toBeGreaterThanOrEqual(40);
    expect(Math.max(...list.map((p) => p.scale))).toBeGreaterThanOrEqual(10);
    const fire = list.filter((p) => p.kind === 'fireball').map((p) => p.scale);
    expect(Math.max(...fire)).toBeGreaterThanOrEqual(5);
    const debris = list.filter((p) => p.kind === 'debris');
    expect(debris.length).toBeGreaterThanOrEqual(10);
    expect(debris.length).toBeLessThanOrEqual(16);
    const delayed = list.filter((p) => (p.delay ?? 0) > 0);
    expect(delayed.length).toBeGreaterThanOrEqual(8); // 2–3 secondary bursts
    const sparks = list.filter((p) => p.kind === 'spark');
    expect(sparks.length).toBeGreaterThanOrEqual(10);
  });

  it('the torpedo-hit water column ballistic apex reaches at least 40 m', () => {
    const list = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 });
    const spray = list.filter((p) => p.kind === 'spray' && (p.vy ?? 0) > 20);
    expect(spray.length).toBeGreaterThan(3);
    // Integrate launch velocity under the spec gravity: apex = dy + vy² / 2g.
    const apex = Math.max(...spray.map((p) => p.dy + (p.vy * p.vy) / (2 * 9.8)));
    expect(apex).toBeGreaterThanOrEqual(40);
    const column = spray.every((p) => Math.abs(p.dx) <= 4 && Math.abs(p.dz) <= 4);
    expect(column).toBe(true); // ~8 m wide
  });

  it('the torpedo-hit smoke column lives 8–12 s', () => {
    const list = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 });
    const smoke = list.filter((p) => p.kind === 'smoke');
    expect(smoke.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...smoke.map((p) => p.ttl ?? 0))).toBeGreaterThanOrEqual(8);
    expect(Math.max(...smoke.map((p) => p.ttl ?? 0))).toBeLessThanOrEqual(12);
  });

  it('blows a submarine into bubbles and a surface column, not a fireball', () => {
    const underwater = burstParticles({ preset: 'subBurst', x: 0, y: -8, z: 0, intensity: 1 });
    expect(underwater.some((particle) => particle.kind === 'bubbles')).toBe(true);
    expect(underwater.some((particle) => particle.kind === 'fireball')).toBe(false);
    const bursts = combatEventBursts({
      type: 'shipSunk',
      id: 'u-1',
      kind: 'sub',
      x: 4,
      y: 5,
    });
    expect(bursts.map((burst) => burst.preset)).toEqual(['subSink', 'surfaceBreak']);
    expect(bursts[0]!.y).toBeLessThan(0);
    expect(bursts[1]!.y).toBeGreaterThan(bursts[0]!.y);
  });

  it('is deterministic for the same spec', () => {
    const spec = { preset: 'sink', x: 3, y: -2, z: 9, intensity: 1 } as const;
    expect(burstParticles(spec)).toEqual(burstParticles(spec));
    expect(createLcg(1)()).toBe(createLcg(1)());
  });

  it('silt only appears when the detonation is near the seabed', () => {
    const near = burstParticles({
      preset: 'chargeBlast',
      x: 0,
      y: -24,
      z: 0,
      intensity: 1,
      bedY: -27,
    });
    const far = burstParticles({
      preset: 'chargeBlast',
      x: 0,
      y: -8,
      z: 0,
      intensity: 1,
      bedY: -27,
    });
    expect(near.some((p) => p.kind === 'silt')).toBe(true);
    expect(far.some((p) => p.kind === 'silt')).toBe(false);
  });

  it('keeps the near-white flash brief so the burst cannot bloom into a blob', () => {
    // Bloom amplifies additive sprites; a long-lived near-white flash plus a
    // halo reads as overexposure, not an explosion (plan-026 rework).
    const presets = ['torpedoHit', 'chargeBlast', 'playerHit', 'launch', 'gunMuzzle'] as const;
    for (const preset of presets) {
      const flashes = burstParticles({ preset, x: 0, y: 0, z: 0, intensity: 1 }).filter(
        (p) => p.kind === 'flash',
      );
      expect(flashes.length).toBeGreaterThan(0);
      for (const flash of flashes) {
        expect(flash.ttl ?? 0).toBeLessThanOrEqual(FLASH_TTL_S);
      }
    }
  });

  it('bounds additive sprite footprints so stacked sprites cannot fill the frame', () => {
    const presets = ['torpedoHit', 'chargeBlast'] as const;
    for (const preset of presets) {
      const additive = burstParticles({ preset, x: 0, y: 0, z: 0, intensity: 1 }).filter(
        (p) => p.additive,
      );
      expect(additive.length).toBeGreaterThan(0);
      for (const p of additive) {
        expect(Math.max(p.scale, p.sizeEnd ?? 0)).toBeLessThanOrEqual(MAX_ADDITIVE_SCALE_M);
      }
    }
  });

  it('keeps fireball sprites on a coloured ramp so additive stacks clip to orange', () => {
    // Fireballs must not start near-white: stacked additive sprites that all
    // begin white clip to a featureless white blob with a hard rim.
    const fireballs = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 }).filter(
      (p) => p.kind === 'fireball',
    );
    expect(fireballs.length).toBeGreaterThan(0);
    for (const p of fireballs) {
      expect(p.color0![2]).toBeLessThanOrEqual(0.6);
    }
  });

  it('binds the shared bloom emitter gain on the additive particle bucket', () => {
    // The emitter pass dims additive sprites via this uniform; if the binding
    // is lost the halo returns to full strength and the blob clips to white.
    const pool = new VfxPool(10);
    const mesh = pool.group.getObjectByName('particles-additive') as THREE.Mesh;
    const material = mesh.material as THREE.ShaderMaterial;
    expect(material.uniforms.uBloomGain).toBe(bloomEmitterGain);
    pool.dispose();
  });

  it('emitBurst puts the particles into the pool', () => {
    const pool = new VfxPool(200);
    pool.emitBurst({ preset: 'torpedoHit', x: 5, y: 1, z: 2, intensity: 1 }, 0);
    expect(pool.getDiagnostics().alive).toBeGreaterThanOrEqual(40);
    const big = pool.debugParticles().some((p) => p.size >= 10);
    expect(big).toBe(true);
    pool.dispose();
  });
});
