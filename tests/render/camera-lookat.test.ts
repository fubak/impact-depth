import { describe, expect, it } from 'vitest';
import type { Vector3 } from 'three';
import { CameraRig, type CameraSimState } from '../../src/render/cameras';

function sim(over: Partial<CameraSimState> = {}): CameraSimState {
  return {
    time: 0,
    vessel: { x: 0, z: 0, depth: 20, heading: 0, pitch: 0, roll: 0, heave: 0 },
    ships: [
      { id: 'a', x: 100, z: 0, depth: 0 },
      { id: 'b', x: 0, z: 100, depth: 0 },
    ],
    selectedTargetId: 'a',
    ...over,
  } as unknown as CameraSimState;
}

const lookOf = (rig: CameraRig): Vector3 => (rig as unknown as { lookAt: Vector3 }).lookAt;

describe('CameraRig lookAt damping', () => {
  for (const mode of ['chase', 'periscope'] as const) {
    it(`${mode}: target swap does not jump the aim in one frame`, () => {
      const rig = new CameraRig(1.6);
      rig.setMode(mode);
      rig.update(sim(), 1 / 60);
      const before = lookOf(rig).clone();
      rig.update(sim({ selectedTargetId: 'b' }), 1 / 60);
      const moved = lookOf(rig).distanceTo(before);
      // Raw copy would jump ~100 m (periscope) / ~40 m (chase); damped stays small.
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(25);
    });
  }

  it('snaps exactly to the desired aim after setMode', () => {
    const rig = new CameraRig(1.6);
    rig.setMode('chase');
    rig.update(sim(), 1 / 60);
    rig.setMode('bridge');
    rig.update(sim(), 1 / 60);
    expect(lookOf(rig).x).toBeCloseTo(90, 6);
    expect(lookOf(rig).z).toBeCloseTo(0, 6);
  });
});
