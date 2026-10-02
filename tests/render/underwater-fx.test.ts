import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { UnderwaterFx } from '../../src/render/fx/underwater-rays';

/**
 * Light shafts and marine snow must only exist below the surface and below
 * the low-quality bar — otherwise they leak into the above-water frame as
 * additive noise that bloom would amplify.
 */
describe('UnderwaterFx', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, -8, 0);
  const noon = { x: 0.2, y: 0.85, z: 0.1 };

  function frame(over: Partial<Parameters<UnderwaterFx['update']>[0]> = {}) {
    return {
      camera,
      underwater: true,
      waterHeight: 0,
      sunDir: noon,
      isNight: false,
      time: 1,
      dt: 0.05,
      ...over,
    };
  }

  const settle = (fx: UnderwaterFx, f = frame(), frames = 60) => {
    for (let i = 0; i < frames; i += 1) fx.update({ ...f, time: i * f.dt });
  };

  it('stays hidden while the camera is above water', () => {
    const fx = new UnderwaterFx();
    camera.position.set(0, 4, 0);
    settle(fx, frame({ underwater: false }));
    expect(fx.group.visible).toBe(false);
    fx.dispose();
  });

  it('shows shafts and snow underwater on high quality', () => {
    const fx = new UnderwaterFx();
    fx.setQuality('high');
    camera.position.set(0, -8, 0);
    settle(fx);
    expect(fx.group.visible).toBe(true);
    const snow = fx.group.getObjectByName('marine-snow') as THREE.Points;
    expect(snow.geometry.drawRange.count).toBe(400);
    fx.dispose();
  });

  it('is fully off on low quality', () => {
    const fx = new UnderwaterFx();
    fx.setQuality('low');
    camera.position.set(0, -8, 0);
    settle(fx);
    expect(fx.snowCount).toBe(0);
    expect(fx.group.visible).toBe(false);
    fx.dispose();
  });

  it('halves the snow cloud on medium quality', () => {
    const fx = new UnderwaterFx();
    fx.setQuality('medium');
    expect(fx.snowCount).toBe(200);
    camera.position.set(0, -8, 0);
    settle(fx);
    const snow = fx.group.getObjectByName('marine-snow') as THREE.Points;
    expect(snow.geometry.drawRange.count).toBe(200);
    fx.dispose();
  });

  it('fades shafts out at night while snow keeps drifting', () => {
    const fx = new UnderwaterFx();
    fx.setQuality('high');
    camera.position.set(0, -8, 0);
    settle(fx, frame({ isNight: true }));
    const ray = fx.group.children.find((c) => c.name === 'underwater-ray') as THREE.Mesh;
    const mat = ray.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uIntensity!.value as number).toBeLessThan(0.01);
    fx.dispose();
  });

  it('tilts shafts along the refracted sun direction, steeper than the sun', () => {
    const fx = new UnderwaterFx();
    fx.setQuality('high');
    camera.position.set(0, -8, 0);
    // Low sun (20° elevation): refracted ray should be noticeably steeper.
    const elev = Math.asin(0.34);
    const sunDir = { x: Math.cos(elev), y: Math.sin(elev), z: 0 };
    settle(fx, frame({ sunDir }));
    const ray = fx.group.children.find((c) => c.name === 'underwater-ray') as THREE.Mesh;
    // The shaft's vertical extent should dominate: local +Y maps toward -down.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ray.quaternion);
    const airTiltFromVertical = Math.acos(Math.min(1, sunDir.y));
    const waterTiltFromVertical = Math.acos(Math.min(1, up.y));
    expect(waterTiltFromVertical).toBeLessThan(airTiltFromVertical);
    expect(up.x).toBeLessThan(0); // tilts away from the sun azimuth (+X sun → -X lean)
    fx.dispose();
  });
});
