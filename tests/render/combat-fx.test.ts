import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { burstParticles, createLcg } from '../../src/render/presentation/combat-fx';
import { combatEventBursts } from '../../src/render/presentation/combat-event-fx';
import { VfxPool } from '../../src/render/vfx';

describe('combat fx presets', () => {
  it('torpedoHit spawns >=12 particles with a hull-scale fireball (>=10 m)', () => {
    const list = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 });
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...list.map((p) => p.scale))).toBeGreaterThanOrEqual(10);
    const fire = list.filter((p) => p.kind === 'fireball').map((p) => p.scale);
    expect(Math.min(...fire)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...fire)).toBeLessThanOrEqual(16);
  });

  it('spray column reaches at least 20 m', () => {
    const list = burstParticles({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 });
    const top = Math.max(...list.filter((p) => p.kind === 'spray').map((p) => p.dy));
    expect(top).toBeGreaterThanOrEqual(20);
    expect(list.filter((p) => p.kind === 'spray').length).toBeGreaterThan(3);
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
    expect(bursts.map((burst) => burst.preset)).toEqual(['subBurst', 'surfaceBreak']);
    expect(bursts[0]!.y).toBeLessThan(0);
    expect(bursts[1]!.y).toBeGreaterThan(bursts[0]!.y);
  });

  it('is deterministic for the same spec', () => {
    const spec = { preset: 'sink', x: 3, y: -2, z: 9, intensity: 1 } as const;
    expect(burstParticles(spec)).toEqual(burstParticles(spec));
    expect(createLcg(1)()).toBe(createLcg(1)());
  });

  it('emitBurst puts the particles into the pool', () => {
    const pool = new VfxPool(100);
    pool.emitBurst({ preset: 'torpedoHit', x: 5, y: 1, z: 2, intensity: 1 }, 0);
    expect(pool.getDiagnostics().alive).toBeGreaterThanOrEqual(12);
    const big = pool.group.children.some((c) => (c as THREE.Sprite).scale.x >= 10);
    expect(big).toBe(true);
    pool.dispose();
  });
});
