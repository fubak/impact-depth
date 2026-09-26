import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Seabed, seabedAlbedoColor, shouldRebuildSeabedFollow } from '../../src/render/seabed';

describe('seabed follow', () => {
  it('keeps the floor world-locked until the player drifts a large fraction of the patch', () => {
    expect(shouldRebuildSeabedFollow(0, 0, 12, 8, 440, false)).toBe(false);
    expect(shouldRebuildSeabedFollow(0, 0, 18, 11, 440, false)).toBe(false);
    expect(shouldRebuildSeabedFollow(0, 0, 120, 20, 440, false)).toBe(true);
    expect(shouldRebuildSeabedFollow(0, 0, 12, 8, 440, true)).toBe(true);
    expect(shouldRebuildSeabedFollow(Number.NaN, 0, 0, 0, 440, false)).toBe(true);
  });
});

describe('seabed albedo', () => {
  it('darkens with depth without a baked sinusoidal caustic', () => {
    const sand = new THREE.Color('#c8b57a');
    const dark = sand.clone().multiplyScalar(0.78);
    const reef = new THREE.Color(0x4a8870);
    const teal = new THREE.Color(0x2a8a90);
    const shallow = seabedAlbedoColor(10, 10, -3, sand, dark, reef, teal);
    const deep = seabedAlbedoColor(10, 10, -20, sand, dark, reef, teal);
    expect(deep.r + deep.g + deep.b).toBeLessThan(shallow.r + shallow.g + shallow.b);
    const src = seabedAlbedoColor.toString();
    expect(src).not.toMatch(/sin\(wx/);
  });
});

describe('seabed uv', () => {
  it('keeps the texture world-locked across recentres so sand does not swim', () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
    const seabed = new Seabed(100, 10);
    const geo = seabed.mesh.geometry;
    const uv = geo.attributes.uv;
    expect(uv).toBeDefined();
    const pos = geo.attributes.position;
    const env = { sandColor: '#c8b57a' } as never;
    const worldUv = () => {
      const m = new Map<string, [number, number]>();
      const ox = seabed.mesh.position.x;
      const oz = seabed.mesh.position.z;
      for (let i = 0; i < pos.count; i++) {
        m.set(`${ox + pos.getX(i)},${oz + pos.getZ(i)}`, [uv.getX(i), uv.getY(i)]);
      }
      return m;
    };
    seabed.follow(0, 0, env);
    const a = worldUv();
    seabed.follow(40, 30, env);
    const b = worldUv();
    let shared = 0;
    for (const [k, v] of a) {
      const w = b.get(k);
      if (!w) continue;
      shared++;
      expect(w[0]).toBeCloseTo(v[0], 6);
      expect(w[1]).toBeCloseTo(v[1], 6);
    }
    expect(shared).toBeGreaterThan(0);
    expect(uv.getX(0)).not.toBe(uv.getX(1));
  });
});
