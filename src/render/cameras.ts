import * as THREE from 'three';
import type { SimState, ViewMode } from '../core/types';

export class CameraRig {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly mapCamera: THREE.OrthographicCamera;
  /** Orbit: higher phi = more oblique / horizon-forward */
  orbitTheta = 2.45;
  orbitPhi = 1.12;
  orbitRadius = 108;
  periYaw = 0;
  periPitch = 0.02;

  private readonly target = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly currentPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly convoyFocus = new THREE.Vector3();
  private activeMode: ViewMode = 'tactical';

  constructor(aspect: number) {
    this.perspective = new THREE.PerspectiveCamera(42, aspect, 0.2, 1200);
    this.mapCamera = new THREE.OrthographicCamera(-70 * aspect, 70 * aspect, 70, -70, 0.2, 1200);
    this.camera = this.perspective;
    this.camera.position.set(-40, 28, 55);
    this.currentPos.copy(this.camera.position);
  }

  setMode(mode: ViewMode): void {
    this.activeMode = mode;
    const next = mode === 'map' ? this.mapCamera : this.perspective;
    if (this.camera !== next) {
      this.currentPos.copy(this.camera.position);
      this.camera = next;
    }
    if (mode === 'map') return;
    if (mode === 'tactical') {
      this.perspective.fov = 42;
      this.perspective.near = 0.5;
    } else if (mode === 'periscope') {
      this.perspective.fov = 28;
      this.perspective.near = 0.15;
    } else {
      this.perspective.fov = mode === 'bridge' ? 62 : 55;
      this.perspective.near = 0.5;
    }
    this.perspective.updateProjectionMatrix();
  }

  orbit(dx: number, dy: number): void {
    this.orbitTheta -= dx * 0.005;
    this.orbitPhi = THREE.MathUtils.clamp(this.orbitPhi - dy * 0.0035, 0.55, 1.38);
  }

  periLook(dx: number, dy: number): void {
    this.periYaw = THREE.MathUtils.clamp(this.periYaw - dx * 0.0025, -1.1, 1.1);
    this.periPitch = THREE.MathUtils.clamp(this.periPitch - dy * 0.002, -0.25, 0.35);
  }

  zoom(delta: number): void {
    this.orbitRadius = THREE.MathUtils.clamp(this.orbitRadius + delta * 0.05, 40, 160);
  }

  update(sim: SimState, dt: number): void {
    const v = sim.vessel;
    this.target.set(v.x, Math.max(-v.depth + 1, -8), v.z);

    // Soft look bias toward convoy centroid for cinematic tactical framing
    let cx = 0;
    let cz = 0;
    for (const s of sim.ships) {
      cx += s.x;
      cz += s.z;
    }
    const n = Math.max(1, sim.ships.length);
    this.convoyFocus.set(cx / n, 1.2, cz / n);

    if (this.activeMode === 'tactical' || this.activeMode === 'free') {
      const x = this.target.x + Math.sin(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      const y = this.target.y + Math.cos(this.orbitPhi) * this.orbitRadius + 6;
      const z = this.target.z + Math.cos(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      this.desiredPos.set(x, y, z);
      this.lookAt.lerpVectors(this.target, this.convoyFocus, 0.32);
      this.lookAt.y = 1.2;
    } else if (this.activeMode === 'chase') {
      const stern = -14;
      this.desiredPos.set(v.x + Math.cos(v.heading) * stern, this.target.y + 6, v.z + Math.sin(v.heading) * stern);
      this.lookAt.set(v.x + Math.cos(v.heading) * 16, this.target.y + 1.5, v.z + Math.sin(v.heading) * 16);
    } else if (this.activeMode === 'bridge') {
      this.desiredPos.set(v.x + Math.cos(v.heading) * 0.9, Math.max(1.2, -v.depth + 4.2), v.z + Math.sin(v.heading) * 0.9);
      this.lookAt.set(v.x + Math.cos(v.heading) * 90, this.desiredPos.y + 2, v.z + Math.sin(v.heading) * 90);
    } else if (this.activeMode === 'periscope') {
      const heading = v.heading + this.periYaw;
      // Mast/optic extends to near waterline even when the hull is submerged
      const mastReach = 9.5;
      const eyeY = Math.max(0.35, -v.depth + mastReach) + v.heave * 0.15;
      this.desiredPos.set(v.x, eyeY, v.z);
      const lookDist = 100;
      this.lookAt.set(
        v.x + Math.cos(heading) * lookDist,
        eyeY + Math.sin(this.periPitch) * 35 + v.pitch * 4,
        v.z + Math.sin(heading) * lookDist,
      );
      this.camera.rotation.order = 'YXZ';
    } else if (this.activeMode === 'map') {
      this.desiredPos.set(v.x, 150, v.z);
      this.lookAt.set(v.x, 0, v.z);
    } else {
      this.desiredPos.set(v.x, 95, v.z + 0.01);
      this.lookAt.set(v.x, 0, v.z);
    }

    const k = 1 - Math.exp(-5.5 * dt);
    this.currentPos.lerp(this.desiredPos, this.activeMode === 'periscope' ? Math.min(1, k * 1.8) : k);
    this.camera.position.copy(this.currentPos);
    this.camera.up.set(0, 1, 0);
    if (this.activeMode === 'periscope') {
      this.camera.lookAt(this.lookAt);
      this.camera.rotateZ(v.roll * 0.35);
    } else {
      this.camera.lookAt(this.lookAt);
    }
  }

  resize(aspect: number): void {
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.mapCamera.left = -70 * aspect;
    this.mapCamera.right = 70 * aspect;
    this.mapCamera.updateProjectionMatrix();
  }
}
