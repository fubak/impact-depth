/** Scene optics adapted from Techartist ocean-simulation (MIT, 3f756c1).
 * Owned capture targets; standard depth works with perspective AND map cameras.
 */
import * as THREE from 'three';
import { withRendererPass } from './resources';
import { QUALITY_PROFILES, type QualityName } from '../quality';

/** Mark complete subtrees, including subsequently loaded glTF children, as UI cues. */
export function excludeFromWaterCapture(object: THREE.Object3D): void {
  object.userData.waterCapture = false;
}

export function reflectedCamera(source: THREE.Camera): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  if (!(source instanceof THREE.PerspectiveCamera || source instanceof THREE.OrthographicCamera)) {
    throw new Error('Water captures require a perspective or orthographic camera');
  }
  source.updateMatrixWorld(true);
  const camera = source.clone();
  camera.position.setFromMatrixPosition(source.matrixWorld);
  camera.position.y *= -1;
  const direction = source.getWorldDirection(new THREE.Vector3());
  direction.y *= -1;
  const up = new THREE.Vector3(0, 1, 0).transformDirection(source.matrixWorld);
  up.y *= -1;
  camera.up.copy(up);
  camera.lookAt(camera.position.clone().add(direction));
  camera.updateMatrixWorld(true);
  return camera;
}

const bias = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);

export class WaterOptics {
  readonly reflection = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  readonly refraction = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  readonly reflectionMatrix = new THREE.Matrix4();
  readonly refractionMatrix = new THREE.Matrix4();
  readonly inverseProjection = new THREE.Matrix4();
  readonly cameraWorld = new THREE.Matrix4();
  private quality: QualityName = 'high';
  private width = 1;
  private height = 1;
  private dpr = 1;
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private lastCamera = new THREE.Matrix4();
  private lastProjection = new THREE.Matrix4();
  private under = false;
  private reflectionUpdates = 0;
  private refractionUpdates = 0;
  private captureObjects = 0;

  constructor() {
    for (const target of [this.reflection, this.refraction]) {
      target.texture.colorSpace = THREE.LinearSRGBColorSpace;
      target.texture.generateMipmaps = false;
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
    }
    this.refraction.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.refraction.depthTexture.minFilter = THREE.NearestFilter;
    this.refraction.depthTexture.magFilter = THREE.NearestFilter;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width; this.height = height; this.dpr = dpr;
    const scale = QUALITY_PROFILES[this.quality].opticsScale;
    const w = Math.max(1, Math.min(1920, Math.ceil(width * dpr * scale)));
    const h = Math.max(1, Math.min(1200, Math.ceil(height * dpr * scale)));
    if (this.reflection.width === w && this.reflection.height === h) return;
    this.reflection.setSize(w, h); this.refraction.setSize(w, h);
    this.dirty = true;
  }

  setQuality(quality: QualityName): void {
    if (quality === this.quality) return;
    this.quality = quality; this.resize(this.width, this.height, this.dpr);
  }

  reset(): void { this.dirty = true; this.frame = 0; }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, source: THREE.Camera,
    water: THREE.Object3D, surfaceHeight = 0): void {
    if (this.disposed) return;
    source.updateMatrixWorld(true);
    const eyeY = source.getWorldPosition(new THREE.Vector3()).y;
    // Hysteresis stops single-pixel waterline oscillation from flickering captures.
    const nextUnder = this.under ? eyeY < surfaceHeight + .12 : eyeY < surfaceHeight - .12;
    const changed = !source.matrixWorld.equals(this.lastCamera) ||
      !source.projectionMatrix.equals(this.lastProjection) || nextUnder !== this.under;
    this.under = nextUnder;
    const due = this.frame++ % QUALITY_PROFILES[this.quality].opticsCadence === 0;
    if (!this.dirty && !changed && !due) return;
    const hidden: Array<[THREE.Object3D, boolean]> = [];
    scene.traverse((o) => {
      if (o === water || o.userData.waterCapture === false) {
        hidden.push([o, o.visible]); o.visible = false;
      }
    });
    this.captureObjects = 0;
    scene.traverseVisible((o) => { if (o instanceof THREE.Mesh) this.captureObjects++; });
    const reflected = reflectedCamera(source);
    const refracted = source.clone();
    refracted.position.setFromMatrixPosition(source.matrixWorld);
    refracted.quaternion.setFromRotationMatrix(source.matrixWorld);
    refracted.updateMatrixWorld(true);
    try {
      withRendererPass(renderer, () => {
        renderer.xr.enabled = false;
        renderer.autoClear = true;
        renderer.toneMapping = THREE.NoToneMapping;
        // Reuse primary shadows: optical passes must not repeatedly regenerate them.
        const autoShadow = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        try {
          renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, this.under ? -1 : 1, 0), .08)];
          renderer.setRenderTarget(this.reflection);
          renderer.clear(); renderer.render(scene, reflected);
          this.reflectionUpdates++;
          renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, this.under ? 1 : -1, 0), .12)];
          renderer.setRenderTarget(this.refraction);
          renderer.clear(); renderer.render(scene, refracted);
          this.refractionUpdates++;
        } finally { renderer.shadowMap.autoUpdate = autoShadow; }
      });
      this.reflectionMatrix.copy(bias).multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse);
      this.refractionMatrix.copy(bias).multiply(refracted.projectionMatrix).multiply(refracted.matrixWorldInverse);
      this.inverseProjection.copy(refracted.projectionMatrixInverse);
      this.cameraWorld.copy(refracted.matrixWorld);
      this.lastCamera.copy(source.matrixWorld); this.lastProjection.copy(source.projectionMatrix);
      this.dirty = false;
    } finally { for (const [object, visible] of hidden) object.visible = visible; }
  }

  getDiagnostics() {
    return { ready: !this.dirty && !this.disposed, reflectionUpdates: this.reflectionUpdates,
      refractionUpdates: this.refractionUpdates, width: this.reflection.width,
      height: this.reflection.height, estimatedBytes: this.reflection.width * this.reflection.height * 24,
      captureObjects: this.captureObjects, underwater: this.under, quality: this.quality };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.reflection.dispose(); this.refraction.depthTexture?.dispose(); this.refraction.dispose();
  }
}
