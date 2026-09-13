import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { seabedAlbedoColor, shouldRebuildSeabedFollow } from '../../src/render/seabed';

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
