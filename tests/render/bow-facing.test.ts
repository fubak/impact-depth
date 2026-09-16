import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SurfaceShipState, VesselState, ViewMode } from '../../src/core/types';
import { CameraRig, type CameraSimState } from '../../src/render/cameras';

/**
 * Mirrors AssetRegistry.alignBowPlusX: LA/Akula sail sits forward of midships.
 * If the high-mass cluster is on −X, bow is −X and must be flipped for +X motion.
 */
function alignBowPlusX(scene: THREE.Group): boolean {
  scene.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry?.attributes?.position) return;
    const pos = object.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld);
      points.push(v.clone());
    }
  });
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const yCut = ys[Math.floor(ys.length * 0.9)]!;
  const top = points.filter((p) => p.y >= yCut);
  const sailX = top.reduce((sum, p) => sum + p.x, 0) / top.length;
  if (sailX < 0) {
    scene.rotation.y += Math.PI;
    scene.updateMatrixWorld(true);
    return true;
  }
  return false;
}

function sailXOf(scene: THREE.Group): number {
  scene.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry?.attributes?.position) return;
    const pos = object.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld);
      points.push(v.clone());
    }
  });
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const yCut = ys[Math.floor(ys.length * 0.9)]!;
  const top = points.filter((p) => p.y >= yCut);
  return top.reduce((sum, p) => sum + p.x, 0) / top.length;
}

describe('submarine bow facing', () => {
  it('flips a bow-minus-X hull so the sail ends on +X (forward of midships)', () => {
    const g = new THREE.Group();
    // Fake LA: long hull on X, tall sail on −X (bow currently −X).
    const hull = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 1.5));
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8));
    sail.position.set(-2.2, 1.4, 0);
    g.add(hull, sail);
    expect(sailXOf(g)).toBeLessThan(0);
    const flipped = alignBowPlusX(g);
    expect(flipped).toBe(true);
    expect(sailXOf(g)).toBeGreaterThan(0);
  });

  it('leaves an already bow-plus-X hull alone', () => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 1.5));
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.8));
    sail.position.set(2.2, 1.4, 0);
    g.add(hull, sail);
    const before = sailXOf(g);
    expect(alignBowPlusX(g)).toBe(false);
    expect(sailXOf(g)).toBeCloseTo(before, 5);
  });
});

const ALL_VIEWS: ViewMode[] = ['tactical', 'chase', 'bridge', 'periscope', 'free', 'map', 'sonar'];

function vessel(partial: Partial<VesselState> = {}): VesselState {
  return {
    x: 0,
    z: 0,
    depth: 0,
    heading: 0,
    speed: 0,
    targetSpeed: 0,
    engineOrder: 'stop',
    battery: 1,
    noise: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    ...partial,
  };
}

function ship(partial: Partial<SurfaceShipState> & Pick<SurfaceShipState, 'id'>): SurfaceShipState {
  return {
    kind: 'merchant',
    name: 'target',
    x: 0,
    z: 0,
    depth: 0,
    heading: 0,
    speed: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    ...partial,
  };
}

function sim(partial: Partial<CameraSimState> = {}): CameraSimState {
  return {
    paused: false,
    time: 0,
    viewMode: 'chase',
    mission: 'test',
    vessel: vessel(),
    ships: [],
    selectedTargetId: null,
    ...partial,
  };
}

function snap(rig: CameraRig, state: CameraSimState, mode: ViewMode): void {
  rig.setMode(mode);
  rig.update(state, 4);
  rig.camera.updateMatrixWorld();
}

describe('camera framing (plan 018 I6/I7)', () => {
  it('keeps all seven POVs after a snap update', () => {
    const rig = new CameraRig(16 / 9);
    const state = sim();
    for (const mode of ALL_VIEWS) {
      snap(rig, state, mode);
      expect(Number.isFinite(rig.camera.position.x)).toBe(true);
      expect(Number.isFinite(rig.camera.position.y)).toBe(true);
      expect(Number.isFinite(rig.camera.position.z)).toBe(true);
    }
  });

  it('tactical look-at stays on the player boat, not the convoy centroid', () => {
    const rig = new CameraRig(16 / 9);
    const state = sim({
      vessel: vessel({ x: 0, z: 0 }),
      ships: [ship({ id: 'far', x: 400, z: 0 })],
    });
    snap(rig, state, 'tactical');
    const look = new THREE.Vector3();
    rig.camera.getWorldDirection(look);
    const toPlayer = new THREE.Vector3(0, 0, 0).sub(rig.camera.position).normalize();
    expect(look.dot(toPlayer)).toBeGreaterThan(0.92);
  });

  it('chase at attack depth follows the hull instead of pinning above empty water', () => {
    const rig = new CameraRig(16 / 9);
    const depth = 12;
    const state = sim({ vessel: vessel({ depth, heading: 0 }) });
    snap(rig, state, 'chase');

    expect(rig.camera.position.y).toBeLessThan(0);
    expect(rig.camera.position.y).toBeCloseTo(-depth + 3.8, 5);
    expect(rig.camera.position.x).toBeLessThan(0);

    const hull = new THREE.Vector3(0, -depth, 0).project(rig.camera);
    expect(hull.z).toBeGreaterThan(-1);
    expect(hull.z).toBeLessThan(1);
    expect(hull.y).toBeGreaterThan(-0.45);
    expect(hull.y).toBeLessThan(0.55);
    expect(Math.abs(hull.x)).toBeLessThan(0.35);
  });

  it('periscope aims at the locked contact instead of empty heading horizon', () => {
    const rig = new CameraRig(16 / 9);
    const state = sim({
      vessel: vessel({ depth: 6.72, heading: 0 }),
      selectedTargetId: 'm1',
      ships: [ship({ id: 'm1', x: 0, z: 80 })],
    });
    snap(rig, state, 'periscope');

    const dir = new THREE.Vector3();
    rig.camera.getWorldDirection(dir);
    expect(dir.z).toBeGreaterThan(0.75);
    expect(Math.abs(dir.x)).toBeLessThan(0.25);

    const target = new THREE.Vector3(0, 2.2, 80).project(rig.camera);
    expect(Math.abs(target.x)).toBeLessThan(0.2);
    expect(Math.abs(target.y)).toBeLessThan(0.25);
  });

  it('periscope without a lock still looks along vessel heading', () => {
    const rig = new CameraRig(16 / 9);
    const state = sim({ vessel: vessel({ depth: 6.72, heading: 0 }), selectedTargetId: null });
    snap(rig, state, 'periscope');
    const dir = new THREE.Vector3();
    rig.camera.getWorldDirection(dir);
    expect(dir.x).toBeGreaterThan(0.75);
    expect(Math.abs(dir.z)).toBeLessThan(0.25);
  });
});
