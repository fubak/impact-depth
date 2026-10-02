import { describe, expect, it } from 'vitest';
import type { SurfaceShipState, VesselState } from '../../src/core/types';
import { worldMetersToSim } from '../../src/game/sim/coords';
import { CameraRig, type CameraSimState } from '../../src/render/cameras';

/**
 * Inverse-projection slack in world metres. Perspective tactical rays pick up
 * a little error from NDC quantization through a 1280×720 canvas; the
 * orthographic map camera should stay well inside this band.
 */
const WATER_PLANE_TOLERANCE_M = 0.45;

const CANVAS = { left: 0, top: 0, width: 1280, height: 720 } as DOMRect;

const TACTICAL_ORBITS = [
  { theta: 2.45, phi: 1.12, radius: 108 },
  { theta: 0.4, phi: 0.85, radius: 72 },
  { theta: 4.1, phi: 1.3, radius: 140 },
] as const;

const WATER_POINTS = [
  { x: 12, z: 0 },
  { x: 0, z: 18 },
  { x: -16, z: 10 },
  { x: 22, z: -14 },
] as const;

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
    name: 'contact',
    x: 30,
    z: 8,
    depth: 0,
    heading: 0,
    speed: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    sinkProgress: 0,
    listSide: 1,
    fire: 0,
    flooding: 0,
    ...partial,
  };
}

function sim(partial: Partial<CameraSimState> = {}): CameraSimState {
  return {
    paused: false,
    time: 0,
    viewMode: 'tactical',
    mission: 'pick',
    vessel: vessel(),
    ships: [ship({ id: 'c1' })],
    selectedTargetId: null,
    ...partial,
  };
}

function snapTactical(
  rig: CameraRig,
  state: CameraSimState,
  orbit: { theta: number; phi: number; radius: number },
): void {
  rig.setMode('tactical');
  rig.orbitTheta = orbit.theta;
  rig.orbitPhi = orbit.phi;
  rig.orbitRadius = orbit.radius;
  rig.update(state, 4);
  rig.camera.updateMatrixWorld();
  rig.camera.updateProjectionMatrix();
}

function snapMap(rig: CameraRig, state: CameraSimState): void {
  rig.setMode('map');
  rig.update(state, 4);
  rig.camera.updateMatrixWorld();
  rig.camera.updateProjectionMatrix();
}

function ndcToClient(ndcX: number, ndcY: number): { x: number; y: number } {
  return {
    x: ((ndcX + 1) / 2) * CANVAS.width + CANVAS.left,
    y: ((1 - ndcY) / 2) * CANVAS.height + CANVAS.top,
  };
}

function invertWater(rig: CameraRig, worldX: number, worldZ: number): { x: number; z: number } | null {
  const projected = rig.projectNdc(worldX, 0, worldZ);
  if (projected.clipW < 0) return null;
  if (Math.abs(projected.ndcX) > 0.98 || Math.abs(projected.ndcY) > 0.98) return null;
  const client = ndcToClient(projected.ndcX, projected.ndcY);
  const hit = rig.intersectWaterPlane(client.x, client.y, CANVAS);
  if (!hit) return null;
  return { x: hit.x, z: hit.z };
}

describe('CameraRig water-plane picking', () => {
  it('inverts projected sea-plane points under tactical perspective at several orbits', () => {
    const rig = new CameraRig(CANVAS.width / CANVAS.height);
    const state = sim();
    let checked = 0;
    for (const orbit of TACTICAL_ORBITS) {
      snapTactical(rig, state, orbit);
      for (const point of WATER_POINTS) {
        const recovered = invertWater(rig, point.x, point.z);
        if (!recovered) continue;
        expect(
          Math.hypot(recovered.x - point.x, recovered.z - point.z),
          `tactical orbit θ=${orbit.theta} φ=${orbit.phi} r=${orbit.radius} world=(${point.x},${point.z})`,
        ).toBeLessThan(WATER_PLANE_TOLERANCE_M);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('inverts projected sea-plane points under the orthographic map camera', () => {
    const rig = new CameraRig(CANVAS.width / CANVAS.height);
    const state = sim({ viewMode: 'map' });
    snapMap(rig, state);
    let checked = 0;
    for (const point of WATER_POINTS) {
      const recovered = invertWater(rig, point.x, point.z);
      expect(recovered).not.toBeNull();
      expect(Math.hypot(recovered!.x - point.x, recovered!.z - point.z)).toBeLessThan(
        WATER_PLANE_TOLERANCE_M,
      );
      checked += 1;
    }
    expect(checked).toBe(WATER_POINTS.length);
  });

  it('returns the same sim order for one world point after tactical orbit and zoom', () => {
    const rig = new CameraRig(CANVAS.width / CANVAS.height);
    const world = { x: 8, z: -6 };
    const expected = worldMetersToSim(world.x, world.z);
    const recovered: Array<{ x: number; y: number }> = [];
    for (const orbit of TACTICAL_ORBITS) {
      snapTactical(rig, sim(), orbit);
      const hit = invertWater(rig, world.x, world.z);
      expect(hit).not.toBeNull();
      recovered.push(worldMetersToSim(hit!.x, hit!.z));
    }
    for (const simPoint of recovered) {
      expect(simPoint.x).toBeCloseTo(expected.x, 1);
      expect(simPoint.y).toBeCloseTo(expected.y, 1);
    }
  });

  it('returns null when the pick ray is parallel to the sea plane', () => {
    const rig = new CameraRig(CANVAS.width / CANVAS.height);
    snapTactical(rig, sim(), TACTICAL_ORBITS[0]);
    // Horizontal look at Y=10: direction is parallel to the Y=0 sea plane.
    rig.camera.position.set(0, 10, 0);
    rig.camera.up.set(0, 1, 0);
    rig.camera.lookAt(20, 10, 0);
    rig.camera.updateMatrixWorld();
    rig.camera.updateProjectionMatrix();
    const miss = rig.intersectWaterPlane(CANVAS.width / 2, CANVAS.height / 2, CANVAS);
    expect(miss).toBeNull();
  });
});
