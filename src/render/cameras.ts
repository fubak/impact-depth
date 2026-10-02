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
  /** Follow a running fish (world metres). Chase/tactical/free only. */
  cinema?: { x: number; y: number; z: number; heading: number };
  /** Instantly lerp onto the current desired eye (snap back from cinema). */
  snapToTarget?: boolean;
};

/** Metres above keel for orbit/chase pivot (hull geometric centre). */
export const HULL_PIVOT_ABOVE_KEEL_M = 1.15;

/** Orbit views circle the hull centre; `relative` spins with the sub's heading. */
type OrbitView = {
  theta: number;
  phi: number;
  radius: number;
  minRadius: number;
  maxRadius: number;
  minPhi: number;
  maxPhi: number;
  relative: boolean;
};

const orbitDefaults = (): Partial<Record<ViewMode, OrbitView>> => ({
  tactical: { theta: 2.45, phi: 1.12, radius: 72, minRadius: 30, maxRadius: 200, minPhi: 0.35, maxPhi: 1.82, relative: false },
  chase: { theta: 0, phi: 1.32, radius: 26, minRadius: 12, maxRadius: 90, minPhi: 0.5, maxPhi: 1.75, relative: true },
  free: { theta: 0.6, phi: 1.0, radius: 48, minRadius: 10, maxRadius: 200, minPhi: 0.15, maxPhi: 1.85, relative: false },
  sonar: { theta: 0, phi: 0.12, radius: 95, minRadius: 30, maxRadius: 200, minPhi: 0.02, maxPhi: 1.2, relative: false },
});

/** Azimuth that places the eye directly astern of `heading`. */
export const sternTheta = (heading: number): number => Math.atan2(-Math.cos(heading), -Math.sin(heading));

export class CameraRig {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private readonly perspective: THREE.PerspectiveCamera;
  private readonly mapCamera: THREE.OrthographicCamera;
  /** Tactical orbit accessors (tests / e2e helpers). Higher phi = more oblique. */
  get orbitTheta(): number {
    return this.orbits.tactical!.theta;
  }
  set orbitTheta(value: number) {
    this.orbits.tactical!.theta = value;
  }
  get orbitPhi(): number {
    return this.orbits.tactical!.phi;
  }
  set orbitPhi(value: number) {
    this.orbits.tactical!.phi = value;
  }
  get orbitRadius(): number {
    return this.orbits.tactical!.radius;
  }
  set orbitRadius(value: number) {
    this.orbits.tactical!.radius = value;
  }
  periYaw = 0;
  periPitch = 0.02;
  bridgeYaw = 0;
  bridgePitch = 0;
  mapTheta = 0;
  private readonly orbits = orbitDefaults();
  private readonly offset = new THREE.Vector3();
  private readonly desiredOffset = new THREE.Vector3();
  private offsetSeeded = false;

  private readonly target = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly currentPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private snapLook = true;
  private readonly projectScratch = new THREE.Vector3();
  private activeMode: ViewMode = 'tactical';
  readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly waterHit = new THREE.Vector3();
  private immersion: ImmersionState = { underwater: false, waterHeight: 0, eyeRelative: 0 };
  private lastHeading: number | null = null;
  private yawRate = 0;

  constructor(aspect: number) {
    this.perspective = new THREE.PerspectiveCamera(42, aspect, 0.2, 1200);
    this.mapCamera = new THREE.OrthographicCamera(-70 * aspect, 70 * aspect, 70, -70, 0.2, 1200);
    this.camera = this.perspective;
    this.camera.position.set(-40, 28, 55);
    this.currentPos.copy(this.camera.position);
  }

  setMode(mode: ViewMode): void {
    this.activeMode = mode;
    this.snapLook = true;
    if (!this.orbits[mode]) this.offsetSeeded = false;
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
    if (this.activeMode === 'map') {
      this.mapTheta -= dx * 0.005;
      return;
    }
    const view = this.orbits[this.activeMode];
    if (!view) return;
    view.theta -= dx * 0.005;
    view.phi = THREE.MathUtils.clamp(view.phi - dy * 0.0035, view.minPhi, view.maxPhi);
  }

  bridgeLook(dx: number, dy: number): void {
    this.bridgeYaw = THREE.MathUtils.clamp(this.bridgeYaw - dx * 0.0035, -Math.PI, Math.PI);
    this.bridgePitch = THREE.MathUtils.clamp(this.bridgePitch - dy * 0.0025, -0.7, 0.8);
  }

  periLook(dx: number, dy: number): void {
    this.periYaw = THREE.MathUtils.clamp(this.periYaw - dx * 0.0025, -1.1, 1.1);
    this.periPitch = THREE.MathUtils.clamp(this.periPitch - dy * 0.002, -0.78, 0.42);
  }

  zoom(delta: number): void {
    if (this.activeMode === 'map') {
      this.mapCamera.zoom = THREE.MathUtils.clamp(this.mapCamera.zoom * Math.exp(-delta * 0.001), 0.4, 4);
      this.mapCamera.updateProjectionMatrix();
      return;
    }
    const view = this.orbits[this.activeMode];
    if (view) {
      view.radius = THREE.MathUtils.clamp(view.radius + delta * 0.05, view.minRadius, view.maxRadius);
      return;
    }
    const [min, max] = this.activeMode === 'periscope' ? [12, 40] : [40, 80];
    this.perspective.fov = THREE.MathUtils.clamp(this.perspective.fov + delta * 0.02, min, max);
    this.perspective.updateProjectionMatrix();
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
    const motion = presentation?.reducedMotion || sim.paused ? 0 : 1;
    const step = Math.max(0, Math.min(0.25, dt));
    if (this.lastHeading !== null && step > 0) {
      let dh = v.heading - this.lastHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const rate = THREE.MathUtils.clamp(dh / step, -1.2, 1.2);
      this.yawRate += (rate - this.yawRate) * (1 - Math.exp(-step * 2.5));
    }
    this.lastHeading = v.heading;
    // Surface motion fades out as the boat goes deep (the sea no longer moves her).
    const surfaceBlend = THREE.MathUtils.clamp(1 - v.depth / 9, 0, 1) * motion;
    const heave = Number.isFinite(v.heave) ? v.heave : 0;
    const roll = Number.isFinite(v.roll) ? v.roll : 0;
    const pitch = Number.isFinite(v.pitch) ? v.pitch : 0;
    const visualY = visualKeelY(v.depth, DEFAULT_SUB_HULL_HEIGHT_M);
    const hullY =
      this.activeMode === 'periscope' || this.activeMode === 'sonar' ? -v.depth : visualY;
    const pivotY = hullY + HULL_PIVOT_ABOVE_KEEL_M;
    this.target.set(v.x, pivotY, v.z);

    const orbit = this.orbits[this.activeMode];
    if (orbit) {
      const theta = orbit.relative ? sternTheta(v.heading) + orbit.theta : orbit.theta;
      const flat = Math.sin(orbit.phi) * orbit.radius;
      this.desiredOffset.set(
        Math.sin(theta) * flat,
        Math.cos(orbit.phi) * orbit.radius,
        Math.cos(theta) * flat,
      );
      // The chase boat rides the same swell as the hull it follows.
      if (this.activeMode === 'chase') this.desiredOffset.y += heave * 0.45 * surfaceBlend;
      this.desiredLook.copy(this.target);
    } else if (this.activeMode === 'bridge') {
      this.desiredPos.set(
        v.x + Math.cos(v.heading) * 4.4,
        hullY + 2.4 + heave * surfaceBlend,
        v.z + Math.sin(v.heading) * 4.4,
      );
      const bridgeHeading = v.heading + this.bridgeYaw;
      this.desiredLook.set(
        v.x + Math.cos(bridgeHeading) * 90,
        hullY + 2.4 + Math.sin(this.bridgePitch) * 90,
        v.z + Math.sin(bridgeHeading) * 90,
      );
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
      this.desiredLook.set(
        v.x + Math.cos(heading) * lookDist,
        lookY,
        v.z + Math.sin(heading) * lookDist,
      );
      this.camera.rotation.order = 'YXZ';
    } else if (this.activeMode === 'map') {
      this.desiredPos.set(v.x, 150, v.z);
      this.desiredLook.set(v.x, 0, v.z);
    }

    const cinema = presentation?.cinema;
    if (
      orbit &&
      cinema &&
      (this.activeMode === 'chase' || this.activeMode === 'tactical' || this.activeMode === 'free')
    ) {
      this.target.set(cinema.x, cinema.y, cinema.z);
      const stern = -8;
      this.desiredOffset.set(
        Math.cos(cinema.heading) * stern,
        2.2,
        Math.sin(cinema.heading) * stern,
      );
    }

    const k = presentation?.snapToTarget ? 1 : 1 - Math.exp(-5.5 * dt);
    if (orbit) {
      // Eye = live hull centre + smoothed offset, so the sub never drifts off-centre.
      if (!this.offsetSeeded) {
        this.offset.copy(this.currentPos).sub(this.target);
        this.offsetSeeded = true;
      }
      this.offset.lerp(this.desiredOffset, k);
      this.currentPos.copy(this.target).add(this.offset);
      this.lookAt.copy(this.target);
      this.snapLook = false;
    } else {
      if (this.activeMode !== 'map' && presentation?.sampleTerrainY) {
        const bed = presentation.sampleTerrainY(this.desiredPos.x, this.desiredPos.z);
        this.desiredPos.y = clampCameraAboveTerrain(this.desiredPos.y, bed);
      }
      this.currentPos.lerp(
        this.desiredPos,
        this.activeMode === 'periscope' ? Math.min(1, k * 1.8) : k,
      );
      if (this.snapLook || this.activeMode === 'map') {
        this.lookAt.copy(this.desiredLook);
        this.snapLook = false;
      } else {
        const kl = 1 - Math.exp(-(this.activeMode === 'periscope' ? 9 : 5.5) * dt);
        this.lookAt.lerp(this.desiredLook, kl);
      }
    }
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
    if (this.activeMode === 'map') this.camera.up.set(Math.sin(this.mapTheta), 0, -Math.cos(this.mapTheta));
    else this.camera.up.set(0, 1, 0);
    if (this.activeMode === 'periscope') {
      this.camera.lookAt(this.lookAt);
      this.camera.rotateZ(v.roll * 0.35);
    } else if (this.activeMode === 'bridge') {
      // The bridge is bolted to the hull: it pitches and rolls with her.
      this.camera.lookAt(this.lookAt);
      this.camera.rotateX(pitch * 0.8 * surfaceBlend);
      this.camera.rotateZ(-roll * 0.85 * surfaceBlend);
    } else if (this.activeMode === 'chase') {
      // A chase boat banks gently with the hull it follows.
      this.camera.lookAt(this.lookAt);
      this.camera.rotateZ(-roll * 0.3 * surfaceBlend - this.yawRate * 0.05 * motion);
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
