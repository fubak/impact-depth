import * as THREE from 'three';
import type { SimState, ViewMode } from '../core/types';
import { updateImmersion, type ImmersionState } from './presentation/immersion';
import { DEFAULT_SUB_HULL_HEIGHT_M, visualKeelY } from './presentation/coordinates';
import { clampCameraAboveTerrain } from './presentation/world-bed';

/** Optional lock id is presentation-only; picking/commands stay on the mean sea plane. */
export type CameraSimState = SimState & { selectedTargetId?: string | null };

export type CameraPresentation = {
  lightning?: number;
  /** Extra eye jitter (depth-charge near miss). */
  shake?: number;
  reducedMotion?: boolean;
  /** Latest GPU / fallback surface height at the camera xz. */
  waterHeight?: number | null;
  /** Presentation bed at a world XZ. Water is allowed; terrain is not. */
  sampleTerrainY?: (worldX: number, worldZ: number) => number;
};

/** Metres above keel for orbit/chase pivot (hull geometric centre). */
export const HULL_PIVOT_ABOVE_KEEL_M = 1.15;

export class CameraRig {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly mapCamera: THREE.OrthographicCamera;
  /** Orbit: higher phi = more oblique / horizon-forward */
  orbitTheta = 2.45;
  orbitPhi = 1.12;
  orbitRadius = 72;
  periYaw = 0;
  periPitch = 0.02;

  private readonly target = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly currentPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly projectScratch = new THREE.Vector3();
  private activeMode: ViewMode = 'tactical';
  readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly waterHit = new THREE.Vector3();
  private immersion: ImmersionState = { underwater: false, waterHeight: 0, eyeRelative: 0 };

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
    this.orbitPhi = THREE.MathUtils.clamp(this.orbitPhi - dy * 0.0035, 0.35, 1.82);
  }

  periLook(dx: number, dy: number): void {
    this.periYaw = THREE.MathUtils.clamp(this.periYaw - dx * 0.0025, -1.1, 1.1);
    this.periPitch = THREE.MathUtils.clamp(this.periPitch - dy * 0.002, -0.78, 0.42);
  }

  zoom(delta: number): void {
    this.orbitRadius = THREE.MathUtils.clamp(this.orbitRadius + delta * 0.05, 40, 160);
  }

  getImmersion(): ImmersionState {
    return this.immersion;
  }

  /** Project a world-metre point into NDC for screen-proximate picking. */
  projectNdc(x: number, y: number, z: number): { ndcX: number; ndcY: number; clipW: number } {
    this.projectScratch.set(x, y, z).project(this.camera);
    return {
      ndcX: this.projectScratch.x,
      ndcY: this.projectScratch.y,
      clipW: this.projectScratch.z > 1 || this.projectScratch.z < -1 ? -1 : 1,
    };
  }

  lastPickNdc(): { x: number; y: number } {
    return { x: this.ndc.x, y: this.ndc.y };
  }

  update(sim: CameraSimState, dt: number, presentation?: CameraPresentation): void {
    const v = sim.vessel;
    const visualY = visualKeelY(v.depth, DEFAULT_SUB_HULL_HEIGHT_M);
    const hullY =
      this.activeMode === 'periscope' || this.activeMode === 'sonar' ? -v.depth : visualY;
    const pivotY = hullY + HULL_PIVOT_ABOVE_KEEL_M;
    this.target.set(v.x, pivotY, v.z);

    if (this.activeMode === 'tactical' || this.activeMode === 'free') {
      const x =
        this.target.x + Math.sin(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      const y = this.target.y + Math.cos(this.orbitPhi) * this.orbitRadius;
      const z =
        this.target.z + Math.cos(this.orbitTheta) * Math.sin(this.orbitPhi) * this.orbitRadius;
      this.desiredPos.set(x, y, z);
      this.lookAt.copy(this.target);
    } else if (this.activeMode === 'chase') {
      const stern = -12;
      this.desiredPos.set(
        v.x + Math.cos(v.heading) * stern,
        pivotY + 2.6,
        v.z + Math.sin(v.heading) * stern,
      );
      this.lookAt.copy(this.target);
      const locked = sim.selectedTargetId
        ? sim.ships.find((ship) => ship.id === sim.selectedTargetId)
        : undefined;
      if (locked) {
        this.lookAt.x = v.x * 0.7 + locked.x * 0.3;
        this.lookAt.z = v.z * 0.7 + locked.z * 0.3;
        this.lookAt.y = pivotY;
      }
    } else if (this.activeMode === 'bridge') {
      this.desiredPos.set(
        v.x + Math.cos(v.heading) * 0.9,
        hullY + 3.2,
        v.z + Math.sin(v.heading) * 0.9,
      );
      this.lookAt.set(v.x + Math.cos(v.heading) * 90, hullY + 1.4, v.z + Math.sin(v.heading) * 90);
    } else if (this.activeMode === 'periscope') {
      // Mast/optic tracks the hull + mast reach. Sampled water is for immersion
      // hysteresis only — do not pin the eye above crests.
      const mastReach = 9.5;
      const water = presentation?.waterHeight;
      const surfaceBias =
        water === undefined || water === null || !Number.isFinite(water) ? 0 : water * 0.05;
      const eyeY = -v.depth + mastReach + v.heave * 0.15 + surfaceBias;
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

    if (this.activeMode !== 'map' && presentation?.sampleTerrainY) {
      const bed = presentation.sampleTerrainY(this.desiredPos.x, this.desiredPos.z);
      this.desiredPos.y = clampCameraAboveTerrain(this.desiredPos.y, bed);
    }

    const k = 1 - Math.exp(-5.5 * dt);
    this.currentPos.lerp(
      this.desiredPos,
      this.activeMode === 'periscope' ? Math.min(1, k * 1.8) : k,
    );
    if (this.activeMode !== 'map' && presentation?.sampleTerrainY) {
      const bed = presentation.sampleTerrainY(this.currentPos.x, this.currentPos.z);
      this.currentPos.y = clampCameraAboveTerrain(this.currentPos.y, bed);
    }
    this.camera.position.copy(this.currentPos);
    const lightning = presentation?.lightning ?? 0;
    if (lightning > 0 && !presentation?.reducedMotion) {
      this.camera.position.x += lightning * 0.18;
      this.camera.position.y += lightning * 0.1;
    }
    const shake = presentation?.shake ?? 0;
    if (shake > 0 && !presentation?.reducedMotion) {
      this.camera.position.x += Math.sin(sim.time * 47) * shake * 0.55;
      this.camera.position.y += Math.cos(sim.time * 31) * shake * 0.35;
    }
    this.camera.up.set(0, 1, 0);
    if (this.activeMode === 'periscope') {
      this.camera.lookAt(this.lookAt);
      this.camera.rotateZ(v.roll * 0.35);
    } else {
      this.camera.lookAt(this.lookAt);
    }
    this.camera.updateMatrixWorld();
    if (this.camera === this.perspective) {
      const wantNear =
        this.currentPos.y < 1.2 ? 0.12 : this.activeMode === 'periscope' ? 0.15 : 0.5;
      if (Math.abs(this.perspective.near - wantNear) > 0.01) {
        this.perspective.near = wantNear;
        this.perspective.updateProjectionMatrix();
      }
    }
    const waterHeight = presentation?.waterHeight === undefined ? null : presentation.waterHeight;
    this.immersion = updateImmersion({
      eyeY: this.camera.position.y,
      sampledWaterHeight: waterHeight,
      previousUnderwater: this.immersion.underwater,
    });
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

  /**
   * Intersect the pick ray with the mean sea plane (Y=0).
   * Reuses setPickRay plus instance Plane / Vector3 — no per-event allocations.
   * Returns the scratch hit, or null when the ray is parallel or points away.
   */
  intersectWaterPlane(clientX: number, clientY: number, canvas: DOMRect): THREE.Vector3 | null {
    this.setPickRay(clientX, clientY, canvas);
    return this.raycaster.ray.intersectPlane(this.waterPlane, this.waterHit);
  }
}
