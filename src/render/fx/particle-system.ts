import * as THREE from 'three';

/**
 * Instanced billboard particle system: one CPU struct-of-arrays simulation,
 * two draw calls (additive + alpha-blended). Deterministic — all jitter is
 * seeded LCG; Math.random is never used.
 */

export const ATLAS_COLS = 4;
export const ATLAS_CELL = 128;
const ATLAS_SIZE = ATLAS_COLS * ATLAS_CELL;

/** Atlas frame indices (4×4 grid, row-major, v=0 at buffer bottom). */
export const ATLAS = {
  soft: 0,
  smokeA: 1,
  smokeB: 2,
  smokeC: 3,
  fireA: 4,
  fireB: 5,
  fireC: 6,
  spark: 7,
  bubble: 8,
  droplet: 9,
  debris: 10,
  ring: 11,
  foam: 12,
  glow: 13,
  silt: 14,
  dense: 15,
} as const;

export type Rgba = readonly [number, number, number, number];

export type SurfaceDeath = 'bubble' | 'splash';

export interface ParticleSpawn {
  /** Diagnostic bucket name — surfaced in getDiagnostics().byKind. */
  kind: string;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Constant vertical acceleration (negative falls). */
  gravity?: number;
  /** Exponential velocity damping, per second. */
  drag?: number;
  /** Upward acceleration while below the water line. */
  buoyancy?: number;
  /** Terminal rise speed while underwater (bubbles). */
  terminal?: number;
  /** Lateral wobble amplitude in m/s while underwater. */
  wobble?: number;
  size0: number;
  size1?: number;
  rot?: number;
  rotSpeed?: number;
  color0?: Rgba;
  /** Optional mid-life stop for a three-stop gradient. */
  colorMid?: Rgba;
  color1?: Rgba;
  ttl: number;
  /** Seconds after `now` before the particle becomes visible. */
  delay?: number;
  frame?: number;
  /** true → additive draw call; false → alpha draw call. */
  additive?: boolean;
  /** Eviction priority; lower is evicted first. */
  priority?: number;
  /** Velocity-aligned stretch factor (sparks). */
  stretch?: number;
  surfaceDeath?: SurfaceDeath;
  /** Emit a small `trail` side event every N seconds while alive. */
  trailInterval?: number;
}

export interface ParticleSideEvent {
  preset: 'surfacePuff' | 'splash' | 'trail';
  x: number;
  y: number;
  z: number;
  size: number;
}

const WHITE: Rgba = [1, 1, 1, 1];
const FADE_OUT: Rgba = [1, 1, 1, 0];
const MAX_STEP = 0.25;
const WOBBLE_FREQ = 2.7;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Value-noise fBm for the smoke/fire atlas cells. Deterministic per seed. */
function makeNoise(seed: number): (u: number, v: number) => number {
  const rand = lcg(seed);
  const lattice = new Float32Array(8 * 8);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
  const value = (x: number, y: number): number => {
    const xi = Math.floor(x) & 7;
    const yi = Math.floor(y) & 7;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const at = (ix: number, iy: number) => lattice[((iy & 7) * 8 + (ix & 7)) | 0]!;
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (u, v) => {
    let sum = 0;
    let amp = 0.55;
    let scale = 3;
    for (let octave = 0; octave < 3; octave += 1) {
      sum += value(u * scale, v * scale) * amp;
      amp *= 0.5;
      scale *= 2;
    }
    return sum;
  };
}

function paintCell(
  data: Uint8Array,
  frame: number,
  shader: (u: number, v: number) => [number, number, number, number],
): void {
  const col = frame % ATLAS_COLS;
  const row = Math.floor(frame / ATLAS_COLS);
  for (let y = 0; y < ATLAS_CELL; y += 1) {
    for (let x = 0; x < ATLAS_CELL; x += 1) {
      const [r, g, b, a] = shader((x + 0.5) / ATLAS_CELL, (y + 0.5) / ATLAS_CELL);
      const i = (((row * ATLAS_CELL + y) * ATLAS_SIZE + col * ATLAS_CELL + x) * 4) | 0;
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
}

const radial = (u: number, v: number): number =>
  Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);

/** Identical pixels in browser and Node so tests and renders agree. */
export function buildAtlasData(): Uint8Array {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const smoke = [makeNoise(101), makeNoise(202), makeNoise(303)];
  const fire = [makeNoise(404), makeNoise(505), makeNoise(606)];

  paintCell(data, ATLAS.soft, (u, v) => {
    const t = radial(u, v);
    const a = t * t * (0.55 + 0.45 * t);
    return [1, 1, 1, a];
  });
  for (let i = 0; i < 3; i += 1) {
    const noise = smoke[i]!;
    paintCell(data, ATLAS.smokeA + i, (u, v) => {
      const t = radial(u, v);
      const n = noise(u, v);
      const a = Math.max(0, t - 0.08) * (0.35 + 0.65 * n) * 0.9;
      const shade = 0.82 + n * 0.18;
      return [shade, shade, shade, a];
    });
  }
  for (let i = 0; i < 3; i += 1) {
    const noise = fire[i]!;
    paintCell(data, ATLAS.fireA + i, (u, v) => {
      const t = radial(u, v);
      const n = noise(u * 1.2 + i * 0.3, v * 1.2);
      const core = Math.pow(t, 1.6);
      const a = Math.min(1, core * (0.75 + 0.5 * n) + Math.max(0, t - 0.55) * 0.35);
      return [1, 0.92 + n * 0.08, 0.75 + n * 0.2, a];
    });
  }
  paintCell(data, ATLAS.spark, (u, v) => {
    const across = Math.exp(-Math.pow((v - 0.5) * 9, 2));
    const along = radial(u, 0.5);
    return [1, 0.95, 0.8, Math.min(1, across * along * 1.6)];
  });
  paintCell(data, ATLAS.bubble, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const rim = Math.max(0, 1 - Math.abs(r - 0.62) * 8);
    const glint = Math.max(0, 1 - Math.hypot(u - 0.36, v - 0.62) * 14);
    return [0.9, 0.98, 1, Math.min(1, rim * 0.9 + glint * 0.8 + (r < 0.5 ? 0.08 : 0))];
  });
  paintCell(data, ATLAS.droplet, (u, v) => {
    const t = Math.max(0, 1 - Math.hypot((u - 0.5) * 2.4, (v - 0.5) * 1.4));
    return [0.92, 0.97, 1, t * t];
  });
  paintCell(data, ATLAS.debris, (u, v) => {
    // Small irregular shard, roughly half the cell, with a lit upper edge.
    const a = Math.atan2(v - 0.5, u - 0.5);
    const jag = 0.34 + 0.14 * Math.sin(a * 3 + 1.2) + 0.09 * Math.sin(a * 7 + 2.1);
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const inside = r < jag ? 1 : 0;
    const litEdge = Math.max(0, 1 - Math.abs(r - jag) * 9) * Math.max(0, 0.5 - u) * 2;
    const shade = 0.2 + 0.12 * Math.max(0, 0.5 - v) + litEdge * 0.5;
    return [shade, shade * 0.95, shade * 0.85, inside * 0.95];
  });
  paintCell(data, ATLAS.ring, (u, v) => {
    // Thin, ragged foam band — dashes of noise break the perfect annulus.
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = Math.atan2(v - 0.5, u - 0.5);
    const dashes = 0.55 + 0.45 * Math.sin(a * 11 + 0.8) * Math.sin(a * 5 - 1.7);
    const band = Math.max(0, 1 - Math.abs(r - 0.68) * 9) * Math.max(0, dashes);
    return [0.95, 1, 1, band * 0.8];
  });
  paintCell(data, ATLAS.foam, (u, v) => {
    const noise = smoke[0]!;
    const t = radial(u, v);
    const n = noise(u * 1.6 + 0.4, v * 1.6);
    return [0.96, 1, 1, Math.max(0, t - 0.15) * (n > 0.42 ? 0.85 : 0.25)];
  });
  paintCell(data, ATLAS.glow, (u, v) => {
    const t = radial(u, v);
    return [1, 0.9, 0.7, Math.pow(t, 3)];
  });
  paintCell(data, ATLAS.silt, (u, v) => {
    const noise = smoke[1]!;
    const t = radial(u, v);
    const n = noise(u * 1.3 + 0.7, v * 1.3 + 0.2);
    return [0.55, 0.45, 0.32, Math.max(0, t - 0.1) * (0.3 + 0.5 * n)];
  });
  paintCell(data, ATLAS.dense, (u, v) => {
    const noise = smoke[2]!;
    const t = radial(u, v);
    const n = noise(u + 0.25, v + 0.5);
    return [0.75, 0.75, 0.78, Math.max(0, t - 0.05) * (0.55 + 0.45 * n)];
  });
  return data;
}

export function createAtlasTexture(): THREE.Texture {
  const data = buildAtlasData();
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.putImageData === 'function') {
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(data), ATLAS_SIZE, ATLAS_SIZE),
        0,
        0,
      );
      const tex = new THREE.CanvasTexture(canvas);
      tex.flipY = false;
      tex.needsUpdate = true;
      return tex;
    }
  }
  const tex = new THREE.DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aVelocity;
attribute vec4 aParams;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec2 corner = position.xy;
  float size = aParams.x;
  float stretch = aParams.w;
  vec3 vv = (viewMatrix * vec4(aVelocity, 0.0)).xyz;
  vec2 vdir = vv.xy;
  float vmag = length(vdir);
  vec2 dir;
  float len = size;
  float wid = size;
  if (stretch > 0.001 && vmag > 0.01) {
    dir = normalize(vdir);
    len *= 1.0 + stretch * vmag;
    wid *= 0.35;
  } else {
    float rot = aParams.y;
    dir = vec2(cos(rot), sin(rot));
  }
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 quad = dir * (corner.x * len) + perp * (corner.y * wid);
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += quad;
  float col = mod(aParams.z, 4.0);
  float row = floor(aParams.z / 4.0);
  vUv = vec2((col + uv.x) * 0.25, (row + uv.y) * 0.25);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 tex = texture2D(map, vUv);
  vec4 color = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a);
  if (color.a < 0.004) discard;
  gl_FragColor = color;
}
`;

interface Bucket {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  offset: THREE.InstancedBufferAttribute;
  velocity: THREE.InstancedBufferAttribute;
  params: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
}

function makeBucket(
  atlas: THREE.Texture,
  capacity: number,
  additive: boolean,
  name: string,
): Bucket {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const offset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const velocity = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const color = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  for (const attribute of [offset, velocity, params, color]) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }
  geometry.setAttribute('aOffset', offset);
  geometry.setAttribute('aVelocity', velocity);
  geometry.setAttribute('aParams', params);
  geometry.setAttribute('aColor', color);
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, geometry, offset, velocity, params, color };
}

/** Number of float lanes per particle in the CPU simulation. */
export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly maxCapacity: number;
  private cap: number;
  private count = 0;
  private peak = 0;
  private lastNow: number | undefined;
  private readonly atlas: THREE.Texture;
  private readonly additive: Bucket;
  private readonly alpha: Bucket;
  private readonly kindIds = new Map<string, number>();
  private readonly kindNames: string[] = [];
  private emitCounter = 0;

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly buoyancy: Float32Array;
  private readonly terminal: Float32Array;
  private readonly wobble: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly rot: Float32Array;
  private readonly rotSpeed: Float32Array;
  private readonly c0: Float32Array;
  private readonly cm: Float32Array;
  private readonly c1: Float32Array;
  private readonly born: Float32Array;
  private readonly ttl: Float32Array;
  private readonly frame: Float32Array;
  private readonly additiveFlag: Uint8Array;
  private readonly priority: Float32Array;
  private readonly stretch: Float32Array;
  private readonly surfaceDeath: Uint8Array;
  private readonly trailInterval: Float32Array;
  private readonly trailNext: Float32Array;
  private readonly seed: Float32Array;
  private readonly prevY: Float32Array;
  private readonly kindIndex: Uint16Array;

  constructor(cap: number, maxCapacity = 3000) {
    this.maxCapacity = Math.max(cap, maxCapacity);
    this.cap = Math.min(cap, this.maxCapacity);
    const n = this.maxCapacity;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.buoyancy = new Float32Array(n);
    this.terminal = new Float32Array(n);
    this.wobble = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.rotSpeed = new Float32Array(n);
    this.c0 = new Float32Array(n * 4);
    this.cm = new Float32Array(n * 4);
    this.c1 = new Float32Array(n * 4);
    this.born = new Float32Array(n);
    this.ttl = new Float32Array(n);
    this.frame = new Float32Array(n);
    this.additiveFlag = new Uint8Array(n);
    this.priority = new Float32Array(n);
    this.stretch = new Float32Array(n);
    this.surfaceDeath = new Uint8Array(n);
    this.trailInterval = new Float32Array(n);
    this.trailNext = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.prevY = new Float32Array(n);
    this.kindIndex = new Uint16Array(n);
    this.group.name = 'particle-system';
    this.atlas = createAtlasTexture();
    this.additive = makeBucket(this.atlas, n, true, 'particles-additive');
    this.alpha = makeBucket(this.atlas, n, false, 'particles-alpha');
    this.group.add(this.additive.mesh, this.alpha.mesh);
  }

  emit(spec: ParticleSpawn, now: number): void {
    if (this.count >= this.cap) this.evictOne();
    const i = this.count;
    this.count += 1;
    this.peak = Math.max(this.peak, this.count);
    let kindId = this.kindIds.get(spec.kind);
    if (kindId === undefined) {
      kindId = this.kindNames.length;
      this.kindNames.push(spec.kind);
      this.kindIds.set(spec.kind, kindId);
    }
    const color0 = spec.color0 ?? WHITE;
    const colorMid = spec.colorMid ?? spec.color1 ?? FADE_OUT;
    const color1 = spec.color1 ?? FADE_OUT;
    this.px[i] = spec.x;
    this.py[i] = spec.y;
    this.pz[i] = spec.z;
    this.vx[i] = spec.vx ?? 0;
    this.vy[i] = spec.vy ?? 0;
    this.vz[i] = spec.vz ?? 0;
    this.gravity[i] = spec.gravity ?? 0;
    this.drag[i] = spec.drag ?? 0;
    this.buoyancy[i] = spec.buoyancy ?? 0;
    this.terminal[i] = spec.terminal ?? 0;
    this.wobble[i] = spec.wobble ?? 0;
    this.size0[i] = spec.size0;
    this.size1[i] = spec.size1 ?? spec.size0;
    this.rot[i] = spec.rot ?? 0;
    this.rotSpeed[i] = spec.rotSpeed ?? 0;
    for (let c = 0; c < 4; c += 1) {
      this.c0[i * 4 + c] = color0[c];
      this.cm[i * 4 + c] = colorMid[c];
      this.c1[i * 4 + c] = color1[c];
    }
    this.born[i] = now + (spec.delay ?? 0);
    this.ttl[i] = Math.max(0.05, spec.ttl);
    this.frame[i] = spec.frame ?? 0;
    this.additiveFlag[i] = spec.additive ? 1 : 0;
    this.priority[i] = spec.priority ?? 3;
    this.stretch[i] = spec.stretch ?? 0;
    this.surfaceDeath[i] = spec.surfaceDeath === 'bubble' ? 1 : spec.surfaceDeath === 'splash' ? 2 : 0;
    this.trailInterval[i] = spec.trailInterval ?? 0;
    this.trailNext[i] = this.born[i] + (spec.trailInterval ?? 0);
    this.emitCounter += 1;
    this.seed[i] = (this.emitCounter % 1024) / 1024;
    this.prevY[i] = spec.y;
    this.kindIndex[i] = kindId;
  }

  setCap(cap: number): void {
    this.cap = Math.min(cap, this.maxCapacity);
    while (this.count > this.cap) this.evictOne();
  }

  /**
   * Advance the CPU simulation and refill the instanced buffers.
   * Returns side events (bubble surface puffs, spray re-entry splashes,
   * debris smoke trails) for the facade to re-emit as ordinary particles.
   */
  update(now: number, waterY = 0): ParticleSideEvent[] {
    // A backward time jump means a mission restart — parked delayed particles
    // would otherwise sit forever with negative ages.
    if (this.lastNow !== undefined && now < this.lastNow - 1e-6) this.count = 0;
    const dt =
      this.lastNow === undefined
        ? 0
        : Math.min(MAX_STEP, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const events: ParticleSideEvent[] = [];
    for (let i = this.count - 1; i >= 0; i--) {
      const born = this.born[i]!;
      const ttl = this.ttl[i]!;
      const age = now - born;
      if (age < 0) continue; // delayed: occupies a slot but stays parked
      if (age >= ttl) {
        this.removeAt(i);
        continue;
      }
      if (dt > 0) {
        const below = this.py[i]! < waterY;
        const terminal = this.terminal[i]!;
        if (terminal > 0 && below) {
          // Bubbles ease toward terminal rise speed instead of free buoyancy.
          const ease = Math.min(1, dt * 3.5);
          this.vy[i] = this.vy[i]! + (terminal - this.vy[i]!) * ease;
        } else {
          this.vy[i] = this.vy[i]! + (this.gravity[i]! + (below ? this.buoyancy[i]! : 0)) * dt;
        }
        const damp = Math.max(0, 1 - this.drag[i]! * dt);
        this.vx[i] = this.vx[i]! * damp;
        this.vy[i] = this.vy[i]! * damp;
        this.vz[i] = this.vz[i]! * damp;
        const wobble = this.wobble[i]!;
        if (wobble > 0 && below) {
          const phase = this.seed[i]! * Math.PI * 2;
          this.px[i] = this.px[i]! + Math.sin(age * WOBBLE_FREQ + phase) * wobble * dt;
          this.pz[i] = this.pz[i]! + Math.cos(age * WOBBLE_FREQ * 0.83 + phase) * wobble * dt;
        }
        this.px[i] = this.px[i]! + this.vx[i]! * dt;
        this.py[i] = this.py[i]! + this.vy[i]! * dt;
        this.pz[i] = this.pz[i]! + this.vz[i]! * dt;
        this.rot[i] = this.rot[i]! + this.rotSpeed[i]! * dt;
      }
      const death = this.surfaceDeath[i]!;
      const y = this.py[i]!;
      if (death === 1 && y >= waterY) {
        events.push({ preset: 'surfacePuff', x: this.px[i]!, y: waterY, z: this.pz[i]!, size: this.size0[i]! });
        this.removeAt(i);
        continue;
      }
      if (death === 2 && this.vy[i]! < 0 && this.prevY[i]! > waterY && y <= waterY) {
        events.push({ preset: 'splash', x: this.px[i]!, y: waterY, z: this.pz[i]!, size: this.size0[i]! });
        this.removeAt(i);
        continue;
      }
      this.prevY[i] = y;
      const trailInterval = this.trailInterval[i]!;
      if (trailInterval > 0 && now >= this.trailNext[i]!) {
        this.trailNext[i] = this.trailNext[i]! + trailInterval;
        events.push({ preset: 'trail', x: this.px[i]!, y, z: this.pz[i]!, size: this.size0[i]! });
      }
    }
    this.writeBuffers(now, waterY);
    return events;
  }

  /** Color over life with optional mid stop. */
  private colorAt(i: number, t: number, out: Float32Array, o: number): void {
    if (t < 0.5) {
      const k = t * 2;
      for (let c = 0; c < 4; c += 1) {
        out[o + c] = this.c0[i * 4 + c]! + (this.cm[i * 4 + c]! - this.c0[i * 4 + c]!) * k;
      }
    } else {
      const k = t * 2 - 1;
      for (let c = 0; c < 4; c += 1) {
        out[o + c] = this.cm[i * 4 + c]! + (this.c1[i * 4 + c]! - this.cm[i * 4 + c]!) * k;
      }
    }
  }

  private writeBuffers(now: number, waterY: number): void {
    let addCount = 0;
    let alphaCount = 0;
    const tmp = this.writeColor;
    for (let i = 0; i < this.count; i += 1) {
      const age = now - this.born[i]!;
      if (age < 0) continue;
      const t = age / this.ttl[i]!;
      const bucket = this.additiveFlag[i] === 1 ? this.additive : this.alpha;
      const w = this.additiveFlag[i] === 1 ? addCount : alphaCount;
      bucket.offset.array[w * 3] = this.px[i]!;
      bucket.offset.array[w * 3 + 1] = this.py[i]!;
      bucket.offset.array[w * 3 + 2] = this.pz[i]!;
      bucket.velocity.array[w * 3] = this.vx[i]!;
      bucket.velocity.array[w * 3 + 1] = this.vy[i]!;
      bucket.velocity.array[w * 3 + 2] = this.vz[i]!;
      const size = this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t;
      bucket.params.array[w * 4] = size;
      bucket.params.array[w * 4 + 1] = this.rot[i]!;
      bucket.params.array[w * 4 + 2] = this.frame[i]!;
      bucket.params.array[w * 4 + 3] = this.stretch[i]!;
      this.colorAt(i, t, tmp, 0);
      const depth = waterY - this.py[i]!;
      if (depth > 0) {
        // Blue-green tint + extinction with depth below the water line.
        const fade = Math.exp(-depth * 0.045);
        tmp[0] = tmp[0]! * fade + 0.2 * (1 - fade);
        tmp[1] = tmp[1]! * fade + 0.5 * (1 - fade);
        tmp[2] = tmp[2]! * fade + 0.55 * (1 - fade);
        tmp[3] = tmp[3]! * (0.3 + 0.7 * fade);
      }
      bucket.color.array[w * 4] = tmp[0]!;
      bucket.color.array[w * 4 + 1] = tmp[1]!;
      bucket.color.array[w * 4 + 2] = tmp[2]!;
      bucket.color.array[w * 4 + 3] = tmp[3]!;
      if (this.additiveFlag[i] === 1) addCount += 1;
      else alphaCount += 1;
    }
    this.finishBucket(this.additive, addCount);
    this.finishBucket(this.alpha, alphaCount);
  }

  private writeColor = new Float32Array(4);

  private finishBucket(bucket: Bucket, count: number): void {
    bucket.geometry.instanceCount = count;
    bucket.offset.needsUpdate = true;
    bucket.velocity.needsUpdate = true;
    bucket.params.needsUpdate = true;
    bucket.color.needsUpdate = true;
  }

  getDiagnostics(): {
    alive: number;
    cap: number;
    peak: number;
    byKind: Record<string, number>;
  } {
    const byKind: Record<string, number> = {};
    for (const name of this.kindNames) byKind[name] = 0;
    for (let i = 0; i < this.count; i += 1) {
      byKind[this.kindNames[this.kindIndex[i]!]!] =
        (byKind[this.kindNames[this.kindIndex[i]!]!] ?? 0) + 1;
    }
    return { alive: this.count, cap: this.cap, peak: this.peak, byKind };
  }

  /** Test/debug view of the live particles. */
  snapshot(): Array<{
    kind: string;
    x: number;
    y: number;
    z: number;
    size: number;
    additive: boolean;
    born: number;
    ttl: number;
  }> {
    const out = [];
    for (let i = 0; i < this.count; i += 1) {
      out.push({
        kind: this.kindNames[this.kindIndex[i]!]!,
        x: this.px[i]!,
        y: this.py[i]!,
        z: this.pz[i]!,
        size: this.size0[i]!,
        additive: this.additiveFlag[i] === 1,
        born: this.born[i]!,
        ttl: this.ttl[i]!,
      });
    }
    return out;
  }

  dispose(): void {
    for (const bucket of [this.additive, this.alpha]) {
      bucket.geometry.dispose();
      (bucket.mesh.material as THREE.Material).dispose();
    }
    this.atlas.dispose();
    this.count = 0;
  }

  /** Lowest priority first (wake < bubbles < smoke < blast kinds), oldest wins ties. */
  private evictOne(): void {
    let victim = -1;
    let bestPriority = Infinity;
    let bestBorn = Infinity;
    for (let i = 0; i < this.count; i += 1) {
      const priority = this.priority[i]!;
      const born = this.born[i]!;
      if (priority < bestPriority || (priority === bestPriority && born < bestBorn)) {
        bestPriority = priority;
        bestBorn = born;
        victim = i;
      }
    }
    if (victim >= 0) this.removeAt(victim);
  }

  private removeAt(index: number): void {
    const last = this.count - 1;
    if (index !== last) this.copySlot(last, index);
    this.count = last;
  }

  private copySlot(from: number, to: number): void {
    this.px[to] = this.px[from]!;
    this.py[to] = this.py[from]!;
    this.pz[to] = this.pz[from]!;
    this.vx[to] = this.vx[from]!;
    this.vy[to] = this.vy[from]!;
    this.vz[to] = this.vz[from]!;
    this.gravity[to] = this.gravity[from]!;
    this.drag[to] = this.drag[from]!;
    this.buoyancy[to] = this.buoyancy[from]!;
    this.terminal[to] = this.terminal[from]!;
    this.wobble[to] = this.wobble[from]!;
    this.size0[to] = this.size0[from]!;
    this.size1[to] = this.size1[from]!;
    this.rot[to] = this.rot[from]!;
    this.rotSpeed[to] = this.rotSpeed[from]!;
    for (let c = 0; c < 4; c += 1) {
      this.c0[to * 4 + c] = this.c0[from * 4 + c]!;
      this.cm[to * 4 + c] = this.cm[from * 4 + c]!;
      this.c1[to * 4 + c] = this.c1[from * 4 + c]!;
    }
    this.born[to] = this.born[from]!;
    this.ttl[to] = this.ttl[from]!;
    this.frame[to] = this.frame[from]!;
    this.additiveFlag[to] = this.additiveFlag[from]!;
    this.priority[to] = this.priority[from]!;
    this.stretch[to] = this.stretch[from]!;
    this.surfaceDeath[to] = this.surfaceDeath[from]!;
    this.trailInterval[to] = this.trailInterval[from]!;
    this.trailNext[to] = this.trailNext[from]!;
    this.seed[to] = this.seed[from]!;
    this.prevY[to] = this.prevY[from]!;
    this.kindIndex[to] = this.kindIndex[from]!;
  }
}
