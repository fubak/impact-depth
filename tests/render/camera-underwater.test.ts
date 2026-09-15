import { describe, expect, it } from 'vitest';
import { CameraRig, type CameraSimState } from '../../src/render/cameras';
import type { ViewMode } from '../../src/core/types';

function vessel(depth: number) {
  return {
    x: 0,
    z: 0,
    depth,
    heading: 0,
    speed: 4,
    targetSpeed: 4,
    engineOrder: 'half' as const,
    battery: 80,
    noise: 0.2,
    heave: 0,
    pitch: 0.1,
    roll: 0,
  };
}

function state(depth: number): CameraSimState {
  return {
    paused: false,
    time: 1,
    viewMode: 'chase',
    mission: 'patrol',
    selectedTargetId: null,
    vessel: vessel(depth),
    ships: [],
  };
}

function snap(rig: CameraRig, sim: CameraSimState, mode: ViewMode): void {
  rig.setMode(mode);
  for (let i = 0; i < 90; i++) rig.update(sim, 1 / 30, { waterHeight: 0.2 });
}

describe('POV cameras can enter the water', () => {
  it('chase follows the hull below the sheet at attack depth', () => {
    const rig = new CameraRig(16 / 9);
    snap(rig, state(12), 'chase');
    expect(rig.camera.position.y).toBeLessThan(0);
    expect(rig.getImmersion().underwater).toBe(true);
  });

  it('bridge sits on the sail and goes under when the boat dives', () => {
    const rig = new CameraRig(16 / 9);
    snap(rig, state(14), 'bridge');
    expect(rig.camera.position.y).toBeLessThan(-4);
    expect(rig.getImmersion().underwater).toBe(true);
  });

  it('tactical orbit can pitch through the waterline', () => {
    const rig = new CameraRig(16 / 9);
    rig.orbitPhi = 1.72;
    rig.orbitRadius = 50;
    snap(rig, state(0.5), 'tactical');
    expect(rig.camera.position.y).toBeLessThan(0.2);
  });

  it('will not sink the eye through a raised cay', () => {
    const rig = new CameraRig(16 / 9);
    rig.orbitPhi = 1.75;
    rig.orbitRadius = 40;
    rig.setMode('tactical');
    for (let i = 0; i < 90; i++) {
      rig.update(state(0.4), 1 / 30, {
        waterHeight: 0.2,
        sampleTerrainY: () => 6,
      });
    }
    expect(rig.camera.position.y).toBeGreaterThanOrEqual(7);
  });
});
