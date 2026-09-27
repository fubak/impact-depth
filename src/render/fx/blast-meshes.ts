import * as THREE from 'three';
import { BLOOM_LAYER } from '../post';

/**
 * Pooled mesh effects that sit beside the particle system: expanding gas
 * bubbles under water, spray domes and plume columns above it, and foam shock
 * rings on the surface. Pools are preallocated and never grow at runtime.
 */

const GAS_BUBBLE_POOL = 6;
const DOME_POOL = 4;
const PLUME_POOL = 4;
const RING_POOL = 6;

const GAS_BUBBLE_LIFE = 2.4;
const DOME_LIFE = 1.3;
const PLUME_LIFE = 2.1;
const RING_LIFE = 0.9;

/** Cheap deterministic hash-noise shared by the blast shaders. */
const NOISE_GLSL = /* glsl */ `
float blastHash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.453, 45.164))) * 43758.5453);
}
float blastNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = blastHash(i);
  float b = blastHash(i + vec3(1.0, 0.0, 0.0));
  float c = blastHash(i + vec3(0.0, 1.0, 0.0));
  float d = blastHash(i + vec3(1.0, 1.0, 0.0));
  float e = blastHash(i + vec3(0.0, 0.0, 1.0));
  float f2 = blastHash(i + vec3(1.0, 0.0, 1.0));
  float g = blastHash(i + vec3(0.0, 1.0, 1.0));
  float h = blastHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(a, b, f.x), mix(c, d, f.x), f.y),
    mix(mix(e, f2, f.x), mix(g, h, f.x), f.y),
    f.z
  );
}
`;

const GAS_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
${NOISE_GLSL}
void main() {
  // Churning surface: noise displaces the silhouette so it reads as a gas
  // cloud, not a glass ball.
  float n = blastNoise(normal * 1.8 + vec3(uSeed) + vec3(0.0, uTime * 0.9, 0.0));
  vec3 displaced = position * (1.0 + (n - 0.5) * 0.6);
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vView = -mv.xyz;
  vPos = position;
  gl_Position = projectionMatrix * mv;
}
`;

const GAS_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
${NOISE_GLSL}
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float n = blastNoise(vPos * 2.4 + vec3(uSeed * 1.7));
  // Patchy interior + a silhouette that dissolves toward the rim.
  float a = (0.15 + 0.42 * facing + 0.26 * n) * uAlpha;
  a *= smoothstep(0.05, 0.55, facing);
  gl_FragColor = vec4(0.82, 0.95, 1.0, a);
}
`;

const RING_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  // Broken foam: angular noise erases whole arcs so the ring reads as ragged
  // wash, not a drawn ellipse.
  vec2 dir = vec2(cos(a), sin(a));
  float churn = blastNoise(vec3(dir * 3.4, uSeed));
  float gaps = smoothstep(0.32, 0.62, churn);
  float band = smoothstep(0.8, 0.9, r) * (1.0 - smoothstep(0.93, 1.0, r));
  float alpha = band * gaps * uAlpha;
  if (alpha < 0.008) discard;
  gl_FragColor = vec4(0.92, 0.97, 1.0, alpha);
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface PoolSlot<T> {
  mesh: THREE.Mesh;
  born: number;
  active: boolean;
  data: T;
}

export class BlastMeshes {
  readonly group = new THREE.Group();
  private readonly gasBubbles: PoolSlot<{ radius: number }>[];
  private readonly domes: PoolSlot<{ radius: number }>[];
  private readonly plumes: PoolSlot<{ height: number; radius: number }>[];
  private readonly rings: PoolSlot<{ radius: number }>[];

  constructor() {
    this.group.name = 'blast-meshes';
    this.gasBubbles = this.buildGasBubbles();
    this.domes = this.buildDomes();
    this.plumes = this.buildPlumes();
    this.rings = this.buildRings();
  }

  private buildGasBubbles(): PoolSlot<{ radius: number }>[] {
    const slots: PoolSlot<{ radius: number }>[] = [];
    for (let i = 0; i < GAS_BUBBLE_POOL; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uAlpha: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: slots.length * 13.7 },
        },
        vertexShader: GAS_VERT,
        fragmentShader: GAS_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), material);
      mesh.name = 'blast-gas-bubble';
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      slots.push({ mesh, born: 0, active: false, data: { radius: 1 } });
    }
    return slots;
  }

  private buildDomes(): PoolSlot<{ radius: number }>[] {
    const slots: PoolSlot<{ radius: number }>[] = [];
    for (let i = 0; i < DOME_POOL; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xeaf6ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        material,
      );
      mesh.name = 'blast-dome';
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.layers.enable(BLOOM_LAYER);
      this.group.add(mesh);
      slots.push({ mesh, born: 0, active: false, data: { radius: 1 } });
    }
    return slots;
  }

  private buildPlumes(): PoolSlot<{ height: number; radius: number }>[] {
    const slots: PoolSlot<{ height: number; radius: number }>[] = [];
    for (let i = 0; i < PLUME_POOL; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xdfeef6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 1, 1, 12, 1, true),
        material,
      );
      mesh.name = 'blast-plume';
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.layers.enable(BLOOM_LAYER);
      this.group.add(mesh);
      slots.push({ mesh, born: 0, active: false, data: { height: 1, radius: 1 } });
    }
    return slots;
  }

  private buildRings(): PoolSlot<{ radius: number }>[] {
    const slots: PoolSlot<{ radius: number }>[] = [];
    for (let i = 0; i < RING_POOL; i += 1) {
      const material = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 }, uSeed: { value: i * 7.3 } },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.05, 1, 64), material);
      mesh.name = 'blast-ring';
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.layers.enable(BLOOM_LAYER);
      this.group.add(mesh);
      slots.push({ mesh, born: 0, active: false, data: { radius: 1 } });
    }
    return slots;
  }

  private claim<T>(pool: PoolSlot<T>[]): PoolSlot<T> {
    let oldest = pool[0]!;
    for (const slot of pool) {
      if (!slot.active) return slot;
      if (slot.born < oldest.born) oldest = slot;
    }
    return oldest;
  }

  /** Underwater detonation: a growing gas globe that pulses, rises and fades. */
  spawnGasBubble(x: number, y: number, z: number, yieldPower: number, now: number): void {
    const slot = this.claim(this.gasBubbles);
    slot.active = true;
    slot.born = now;
    slot.data.radius = Math.min(7, Math.max(4, 4 + yieldPower * 0.055));
    slot.mesh.position.set(x, y, z);
    slot.mesh.userData.startY = y;
    slot.mesh.visible = true;
  }

  /** White spray dome on the surface over an underwater blast. */
  spawnDome(x: number, z: number, radius: number, now: number): void {
    const slot = this.claim(this.domes);
    slot.active = true;
    slot.born = now;
    slot.data.radius = radius;
    slot.mesh.position.set(x, 0, z);
    slot.mesh.visible = true;
  }

  /** Vertical water column for shallow underwater blasts. */
  spawnPlume(x: number, z: number, height: number, radius: number, now: number): void {
    const slot = this.claim(this.plumes);
    slot.active = true;
    slot.born = now;
    slot.data.height = height;
    slot.data.radius = radius;
    slot.mesh.position.set(x, 0, z);
    slot.mesh.visible = true;
  }

  /** Expanding foam ring on the water. */
  spawnRing(x: number, z: number, radius: number, now: number): void {
    const slot = this.claim(this.rings);
    slot.active = true;
    slot.born = now;
    slot.data.radius = radius;
    slot.mesh.position.set(x, 0.12, z);
    slot.mesh.visible = true;
  }

  update(now: number): void {
    for (const slot of this.gasBubbles) {
      if (!slot.active) continue;
      const age = now - slot.born;
      if (age >= GAS_BUBBLE_LIFE || age < 0) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const radius = slot.data.radius;
      const grow = Math.min(1, age / 0.55);
      // After full expansion the globe pulses twice while shrinking away.
      const shrinkStart = 1.1;
      let scale = radius * (0.35 + 0.65 * grow);
      if (age > shrinkStart) {
        const t = (age - shrinkStart) / (GAS_BUBBLE_LIFE - shrinkStart);
        const pulse = 1 + Math.sin(t * Math.PI * 4) * 0.09;
        scale = radius * pulse * (1 - t * 0.45);
      }
      scale = Math.max(0.01, scale);
      slot.mesh.scale.setScalar(scale);
      const material = slot.mesh.material as THREE.ShaderMaterial;
      material.uniforms.uTime!.value = now;
      // Rise toward the surface but stop while still submerged, and dissolve
      // before the crown could clip the water plane — no hard cut line.
      const startY = (slot.mesh.userData.startY as number | undefined) ?? slot.mesh.position.y;
      slot.mesh.userData.startY = startY;
      const capY = -scale * 0.9 - 0.9;
      slot.mesh.position.y = Math.min(startY + age * 4, capY);
      const clearance = -0.4 - (slot.mesh.position.y + scale * 0.75);
      const surfaceFade = Math.min(1, Math.max(0, clearance / 2.5));
      material.uniforms.uAlpha!.value =
        Math.min(1, age / 0.15) *
        Math.max(0, 1 - (age - (GAS_BUBBLE_LIFE - 0.7)) / 0.7) *
        surfaceFade;
    }
    for (const slot of this.domes) {
      if (!slot.active) continue;
      const age = now - slot.born;
      if (age >= DOME_LIFE || age < 0) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.5), 3);
      const radius = slot.data.radius * grow;
      slot.mesh.scale.set(radius, radius * 0.55, radius);
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity =
        0.75 * Math.max(0, 1 - Math.max(0, age - 0.45) / (DOME_LIFE - 0.45));
    }
    for (const slot of this.plumes) {
      if (!slot.active) continue;
      const age = now - slot.born;
      if (age >= PLUME_LIFE || age < 0) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.7), 2);
      const sag = age > 1.2 ? 1 - ((age - 1.2) / (PLUME_LIFE - 1.2)) * 0.4 : 1;
      const height = slot.data.height * grow * sag;
      slot.mesh.scale.set(slot.data.radius, height, slot.data.radius);
      slot.mesh.position.y = height * 0.5;
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity =
        0.6 * Math.min(1, age / 0.15) * Math.max(0, 1 - age / PLUME_LIFE);
    }
    for (const slot of this.rings) {
      if (!slot.active) continue;
      const age = now - slot.born;
      if (age >= RING_LIFE || age < 0) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, age / 0.75), 2);
      const radius = Math.max(0.01, slot.data.radius * grow);
      slot.mesh.scale.setScalar(radius);
      (slot.mesh.material as THREE.ShaderMaterial).uniforms.uAlpha!.value =
        0.15 * Math.max(0, 1 - age / RING_LIFE);
    }
  }

  reset(): void {
    for (const pool of [this.gasBubbles, this.domes, this.plumes, this.rings]) {
      for (const slot of pool) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  getDiagnostics(): { gasBubbles: number; domes: number; plumes: number; rings: number } {
    const count = (pool: PoolSlot<unknown>[]) => pool.filter((s) => s.active).length;
    return {
      gasBubbles: count(this.gasBubbles),
      domes: count(this.domes),
      plumes: count(this.plumes),
      rings: count(this.rings),
    };
  }

  dispose(): void {
    for (const pool of [this.gasBubbles, this.domes, this.plumes, this.rings]) {
      for (const slot of pool) {
        slot.mesh.geometry.dispose();
        (slot.mesh.material as THREE.Material).dispose();
        this.group.remove(slot.mesh);
      }
    }
  }
}
