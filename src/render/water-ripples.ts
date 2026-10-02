import * as THREE from 'three';

type Ripple = {
  minus: THREE.Mesh;
  plus: THREE.Mesh;
  life: number;
};

/**
 * CheapWater-style screen-space ripple normals (mqnc / red-reddington).
 * Ripple quads live in world XZ; the pass is rendered with the main camera into
 * an offscreen target that the ocean fragment shader samples via gl_FragCoord.
 */
export class WaterRipplePass {
  readonly scene = new THREE.Scene();
  readonly target: THREE.WebGLRenderTarget;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly minusMaterial: THREE.MeshBasicMaterial;
  private readonly plusMaterial: THREE.MeshBasicMaterial;
  private readonly ripples: Ripple[] = [];
  private order = 0;
  private readonly resolution = new THREE.Vector2(1, 1);
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.scene.background = new THREE.Color(0.5, 0.5, 0.5);

    this.minusMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.5, 0.5, 0.5),
      blending: THREE.CustomBlending,
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const map = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/textures/water-ripple.png`);
    map.colorSpace = THREE.NoColorSpace;
    map.flipY = false;
    this.plusMaterial = new THREE.MeshBasicMaterial({
      map,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.target.texture.generateMipmaps = false;
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  get resolutionUniform(): THREE.Vector2 {
    return this.resolution;
  }

  resize(width: number, height: number, dpr = 1): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.target.width === w && this.target.height === h) return;
    this.target.setSize(w, h);
    this.resolution.set(w, h);
  }

  /** World-space ripple on the water plane (Y≈0). */
  spawn(x: number, z: number, strength = 0.35): void {
    if (this.ripples.length > 80) return;
    const opacity = THREE.MathUtils.clamp(strength, 0.12, 0.85);
    const scale = 3.5 + opacity * 6;

    const minus = new THREE.Mesh(this.geometry, this.minusMaterial.clone());
    minus.rotation.x = -Math.PI / 2;
    minus.position.set(x, 0.02, z);
    minus.scale.set(scale, scale, 1);
    minus.material.opacity = opacity;
    minus.renderOrder = this.order++;
    minus.frustumCulled = false;

    const plus = new THREE.Mesh(this.geometry, this.plusMaterial.clone());
    plus.rotation.x = -Math.PI / 2;
    plus.position.set(x, 0.03, z);
    plus.scale.set(scale, scale, 1);
    plus.material.opacity = opacity;
    plus.renderOrder = this.order++;
    plus.frustumCulled = false;

    this.scene.add(minus, plus);
    this.ripples.push({ minus, plus, life: opacity });
  }

  update(dt: number): void {
    const grow = dt * 4.5;
    const fade = dt / 5.5;
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i]!;
      ripple.minus.scale.x += grow;
      ripple.minus.scale.y += grow;
      ripple.plus.scale.x += grow;
      ripple.plus.scale.y += grow;
      const minusMat = ripple.minus.material as THREE.MeshBasicMaterial;
      const plusMat = ripple.plus.material as THREE.MeshBasicMaterial;
      minusMat.opacity -= fade;
      plusMat.opacity -= fade;
      if (minusMat.opacity <= 0.02) {
        this.scene.remove(ripple.minus, ripple.plus);
        minusMat.dispose();
        plusMat.dispose();
        this.ripples.splice(i, 1);
      }
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const prev = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAutoClear;
  }

  /** Convenience: emit a wake ripple behind a moving hull. */
  emitWake(x: number, z: number, heading: number, speed: number, stern = 6): void {
    if (speed < 0.12) return;
    this.tmp.set(x - Math.cos(heading) * stern, 0, z - Math.sin(heading) * stern);
    this.spawn(this.tmp.x, this.tmp.z, Math.min(0.85, 0.22 + speed * 0.14));
  }

  dispose(): void {
    for (const ripple of this.ripples) {
      this.scene.remove(ripple.minus, ripple.plus);
      (ripple.minus.material as THREE.Material).dispose();
      (ripple.plus.material as THREE.Material).dispose();
    }
    this.ripples.length = 0;
    this.geometry.dispose();
    this.minusMaterial.dispose();
    this.plusMaterial.map?.dispose();
    this.plusMaterial.dispose();
    this.target.dispose();
  }
}
