import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LootBeacons, styleCrate } from '../../src/render/fx/loot-beacons';
import type { LootBeaconEntry } from '../../src/render/fx/loot-beacons';
import { RARITY_STYLES } from '../../src/game/adapt/loot-style';

const entry = (id: string, rarity?: LootBeaconEntry['rarity']): LootBeaconEntry => ({
  id,
  x: 10,
  y: 0.08,
  z: -4,
  rarity,
});

function standardCrate(): THREE.Group {
  const crate = new THREE.Group();
  crate.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x8b5a30 }),
    ),
  );
  return crate;
}

function firstStandardMaterial(crate: THREE.Group): THREE.MeshStandardMaterial {
  const mesh = crate.children[0] as THREE.Mesh;
  return mesh.material as THREE.MeshStandardMaterial;
}

describe('LootBeacons.sync', () => {
  it('adds a beacon for rare and epic entries only', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('c1', 'common'), entry('r1', 'rare'), entry('e1', 'epic')], 0, false);
    expect(beacons.count).toBe(2);
    expect(beacons.group.name).toBe('loot-beacons');
    expect(beacons.group.getObjectByName('loot-beacon:c1')).toBeUndefined();
  });

  it('sizes the epic beam to 26 m and the rare beam to 14 m', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('r1', 'rare'), entry('e1', 'epic')], 0, false);
    const epicBeam = beacons.group.getObjectByName('loot-beacon:e1')!.getObjectByName('beam')!;
    const rareBeam = beacons.group.getObjectByName('loot-beacon:r1')!.getObjectByName('beam')!;
    expect(epicBeam.scale.y).toBe(26);
    expect(rareBeam.scale.y).toBe(14);
  });

  it('removes a stale beacon when its entry drops out', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('c1', 'common'), entry('r1', 'rare'), entry('e1', 'epic')], 0, false);
    beacons.sync([entry('c1', 'common'), entry('e1', 'epic')], 0.1, false);
    expect(beacons.count).toBe(1);
    expect(beacons.group.getObjectByName('loot-beacon:r1')).toBeUndefined();
    expect(beacons.group.children).toHaveLength(1);
  });

  it('places each beacon at its entry position', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('e1', 'epic')], 0, false);
    const group = beacons.group.getObjectByName('loot-beacon:e1')!;
    expect(group.position.x).toBe(10);
    expect(group.position.y).toBeCloseTo(0.08, 9);
    expect(group.position.z).toBe(-4);
  });

  it('keeps the ring scale identical across time under reduced motion', () => {
    const beacons = new LootBeacons();
    const ringScale = () =>
      beacons.group.getObjectByName('loot-beacon:e1')!.getObjectByName('ring')!.scale.x;
    beacons.sync([entry('e1', 'epic')], 0.3, true);
    const first = ringScale();
    beacons.sync([entry('e1', 'epic')], 1.1, true);
    expect(ringScale()).toBe(first);
    expect(first).toBe(RARITY_STYLES.epic.ringRadius);
  });

  it('pulses the ring when motion is allowed', () => {
    const beacons = new LootBeacons();
    const ringScale = () =>
      beacons.group.getObjectByName('loot-beacon:e1')!.getObjectByName('ring')!.scale.x;
    beacons.sync([entry('e1', 'epic')], 0.3, false);
    const first = ringScale();
    beacons.sync([entry('e1', 'epic')], 1.1, false);
    expect(ringScale()).not.toBe(first);
    const radius = RARITY_STYLES.epic.ringRadius;
    expect(first).toBeGreaterThanOrEqual(radius * 0.88 - 1e-9);
    expect(first).toBeLessThanOrEqual(radius * 1.12 + 1e-9);
  });

  it('shares one geometry and one material per style across beacons', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('r1', 'rare'), entry('r2', 'rare')], 0, false);
    const beamA = beacons.group.getObjectByName('loot-beacon:r1')!.getObjectByName('beam')!;
    const beamB = beacons.group.getObjectByName('loot-beacon:r2')!.getObjectByName('beam')!;
    expect((beamA as THREE.Mesh).geometry).toBe((beamB as THREE.Mesh).geometry);
    expect((beamA as THREE.Mesh).material).toBe((beamB as THREE.Mesh).material);
  });

  it('dispose clears the group and releases shared resources', () => {
    const beacons = new LootBeacons();
    beacons.sync([entry('r1', 'rare'), entry('e1', 'epic')], 0, false);
    const spy = vi.spyOn(THREE.Material.prototype, 'dispose');
    beacons.dispose();
    expect(beacons.count).toBe(0);
    expect(beacons.group.children).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });
});

describe('styleCrate', () => {
  it('leaves a common crate at scale 1 with no emissive', () => {
    const crate = standardCrate();
    const intensityBefore = firstStandardMaterial(crate).emissiveIntensity;
    styleCrate(crate, 'common', 0.3, false);
    expect(crate.scale.x).toBe(1);
    expect(firstStandardMaterial(crate).emissive.getHex()).toBe(0);
    expect(firstStandardMaterial(crate).emissiveIntensity).toBe(intensityBefore);
  });

  it('treats an absent rarity as common', () => {
    const crate = standardCrate();
    styleCrate(crate, undefined, 0.3, false);
    expect(crate.scale.x).toBe(1);
    expect(firstStandardMaterial(crate).emissive.getHex()).toBe(0);
  });

  it('gives a rare crate the rare emissive and a pulsing scale', () => {
    const crate = standardCrate();
    styleCrate(crate, 'rare', 0.3, false);
    const material = firstStandardMaterial(crate);
    expect(material.emissive.getHex()).toBe(0x3fa9ff);
    expect(material.emissiveIntensity).toBe(0.6);
    expect(crate.scale.x).toBeGreaterThanOrEqual(1.35 * 0.88 - 1e-9);
    expect(crate.scale.x).toBeLessThanOrEqual(1.35 * 1.12 + 1e-9);
  });

  it('tints the material once across repeated calls', () => {
    const crate = standardCrate();
    const material = firstStandardMaterial(crate);
    const spy = vi.spyOn(material.emissive, 'setHex');
    styleCrate(crate, 'epic', 0.3, false);
    styleCrate(crate, 'epic', 0.6, false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('keeps the crate scale fixed under reduced motion', () => {
    const crate = standardCrate();
    styleCrate(crate, 'epic', 1.1, true);
    expect(crate.scale.x).toBe(1.7);
  });

  it('tints a glTF-sourced crate on a copy so the shared template stays untouched', () => {
    const crate = standardCrate();
    const mesh = crate.children[0] as THREE.Mesh;
    mesh.userData.fromGltf = true;
    const shared = mesh.material as THREE.MeshStandardMaterial;
    styleCrate(crate, 'rare', 0.3, false);
    expect(shared.emissive.getHex()).toBe(0);
    expect(mesh.material).not.toBe(shared);
    expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x3fa9ff);
  });
});
