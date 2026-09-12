import * as THREE from 'three';
import type { SimState, ViewMode } from '../core/types';

/** Optional lock id is presentation-only; picking/commands stay on the mean sea plane. */
export type CameraSimState = SimState & { selectedTargetId?: string | null };

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
  readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

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

  update(
    sim: CameraSimState,
    dt: number,
    presentation?: { lightning?: number; reducedMotion?: boolean },
  ): void {
    const v = sim.vessel;
    // Frame the hull itself; surface bias was hiding deep boats under the water sheet.
    const hullY = -v.depth;
    this.target.set(v.x, hullY + 1.5, v.z);

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
      const x =
        this.target.x + Math.sin(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      const y = this.target.y + Math.cos(this.orbitPhi) * this.orbitRadius + 6;
      const z =
        this.target.z + Math.cos(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      // Stay above water, but allow the look to drop so the hull is in frame when deep.
      const floorY = 6 + Math.min(14, Math.max(0, v.depth - 4) * 0.35);
      this.desiredPos.set(x, Math.max(y, floorY), z);
      this.lookAt.lerpVectors(this.target, this.convoyFocus, 0.22);
      this.lookAt.y = THREE.MathUtils.lerp(hullY + 2, 3.5, Math.min(1, 4 / Math.max(4, v.depth)));
    } else if (this.activeMode === 'chase') {
      // Follow the hull underwater at attack depth — do not pin the eye to the surface.
      const stern = -12;
      const heightAboveHull = 3.8;
      this.desiredPos.set(
        v.x + Math.cos(v.heading) * stern,
        hullY + heightAboveHull,
        v.z + Math.sin(v.heading) * stern,
      );
      this.lookAt.set(v.x + Math.cos(v.heading) * 6, hullY + 1.2, v.z + Math.sin(v.heading) * 6);
    } else if (this.activeMode === 'bridge') {
      this.desiredPos.set(
        v.x + Math.cos(v.heading) * 0.9,
        Math.max(1.2, -v.depth + 4.2),
        v.z + Math.sin(v.heading) * 0.9,
      );
      this.lookAt.set(
        v.x + Math.cos(v.heading) * 90,
        this.desiredPos.y + 2,
        v.z + Math.sin(v.heading) * 90,
      );
    } else if (this.activeMode === 'periscope') {
      // Mast/optic extends to near waterline even when the hull is submerged
      const mastReach = 9.5;
      const eyeY = Math.max(0.35, -v.depth + mastReach) + v.heave * 0.15;
      this.desiredPos.set(v.x, eyeY, v.z);
      const locked = sim.selectedTargetId
        ? sim.ships.find((ship) => ship.id === sim.selectedTargetId)
        : undefined;
      let heading = v.heading + this.periYaw;
      let lookDist = 100;
      let lookY = eyeY + Math.sin(this.periPitch) * 35 + v.pitch * 4;
      if (locked) {
        const dx = locked.x - v.x;
        const dz = locked.z - v.z;
        heading = Math.atan2(dz, dx) + this.periYaw;
        lookDist = Math.max(12, Math.hypot(dx, dz));
        lookY = -locked.depth + 2.2 + Math.sin(this.periPitch) * 12 + v.pitch * 4;
      }
      this.lookAt.set(
        v.x + Math.cos(heading) * lookDist,
        lookY,
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
    this.currentPos.lerp(
      this.desiredPos,
      this.activeMode === 'periscope' ? Math.min(1, k * 1.8) : k,
    );
    this.camera.position.copy(this.currentPos);
    const lightning = presentation?.lightning ?? 0;
    if (lightning > 0 && !presentation?.reducedMotion) {
      this.camera.position.x += lightning * 0.18;
      this.camera.position.y += lightning * 0.1;
    }
    this.camera.up.set(0, 1, 0);
    if (this.activeMode === 'periscope') {
      this.camera.lookAt(this.lookAt);
      this.camera.rotateZ(v.roll * 0.35);
    } else {
      this.camera.lookAt(this.lookAt);
    }
    this.camera.updateMatrixWorld();
  }

  resize(aspect: number): void {
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.mapCamera.left = -70 * aspect;
    this.mapCamera.right = 70 * aspect;
    this.mapCamera.updateProjectionMatrix();
  }

  /** NDC pick ray for world interaction (click-to-select). */
  setPickRay(clientX: number, clientY: number, canvas: DOMRect): THREE.Raycaster {
    this.ndc.set(
      ((clientX - canvas.left) / Math.max(1, canvas.width)) * 2 - 1,
      -(((clientY - canvas.top) / Math.max(1, canvas.height)) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster;
  }
}
