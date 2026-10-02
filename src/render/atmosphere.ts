import * as THREE from 'three';
import type { AtmosphereSettings } from '../core/types';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface AtmosphereState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  moonDir: THREE.Vector3;
  fogColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  ambient: number;
  isNight: boolean;
  /** Sun elevation in degrees (negative below the horizon). */
  sunElevation: number;
  /** 0 at high sun … 1 at the golden-hour horizon. Drives warm grading + sea SSS. */
  golden: number;
  /** 0 by day … 1 once the sun is well below the horizon. */
  twilight: number;
}

type Rgb = readonly [number, number, number];

/**
 * Piecewise-smooth colour ramp keyed by sun elevation (degrees). Keys are
 * authored as display (sRGB) values and converted to the linear working space.
 */
function ramp(elevation: number, keys: ReadonlyArray<readonly [number, Rgb]>, out: THREE.Color): THREE.Color {
  if (elevation <= keys[0]![0]) return out.setRGB(...keys[0]![1], THREE.SRGBColorSpace);
  for (let i = 1; i < keys.length; i++) {
    const [e1, c1] = keys[i]!;
    if (elevation <= e1) {
      const [e0, c0] = keys[i - 1]!;
      const t = smoothstep(e0, e1, elevation);
      return out.setRGB(
        THREE.MathUtils.lerp(c0[0], c1[0], t),
        THREE.MathUtils.lerp(c0[1], c1[1], t),
        THREE.MathUtils.lerp(c0[2], c1[2], t),
        THREE.SRGBColorSpace,
      );
    }
  }
  return out.setRGB(...keys[keys.length - 1]![1], THREE.SRGBColorSpace);
}

/** Blackbody-ish sun tint: neutral at height, amber at golden hour, ember on the horizon. */
const SUN_KEYS: ReadonlyArray<readonly [number, Rgb]> = [
  [-4, [0.45, 0.52, 0.65]],
  [0, [1.0, 0.36, 0.12]],
  [5, [1.0, 0.5, 0.22]],
  [14, [1.0, 0.7, 0.42]],
  [30, [1.0, 0.88, 0.7]],
  [50, [1.0, 0.94, 0.82]],
];
const ZENITH_KEYS: ReadonlyArray<readonly [number, Rgb]> = [
  [-8, [0.015, 0.03, 0.07]],
  [-2, [0.06, 0.08, 0.2]],
  [3, [0.14, 0.2, 0.42]],
  [12, [0.2, 0.36, 0.66]],
  [30, [0.22, 0.5, 0.84]],
  [50, [0.18, 0.48, 0.86]],
];
const HORIZON_KEYS: ReadonlyArray<readonly [number, Rgb]> = [
  [-8, [0.04, 0.06, 0.11]],
  [-2, [0.42, 0.24, 0.26]],
  [2, [1.0, 0.5, 0.26]],
  [8, [1.0, 0.66, 0.4]],
  [18, [0.98, 0.84, 0.68]],
  [32, [0.86, 0.93, 1.0]],
  [50, [0.84, 0.94, 1.0]],
];
const FOG_KEYS: ReadonlyArray<readonly [number, Rgb]> = [
  [-8, [0.05, 0.08, 0.12]],
  [-2, [0.3, 0.22, 0.28]],
  [3, [0.82, 0.52, 0.42]],
  [10, [0.9, 0.68, 0.55]],
  [22, [0.88, 0.84, 0.82]],
  [35, [0.84, 0.93, 1.0]],
];

export function evaluateAtmosphere(settings: AtmosphereSettings): AtmosphereState {
  const tod = ((settings.timeOfDay % 1) + 1) % 1;
  const dayFactor = Math.sin(((tod - 0.25) * Math.PI * 2 + Math.PI * 2) % (Math.PI * 2));
  const elevFromTod = dayFactor * 70;
  const elev = THREE.MathUtils.lerp(elevFromTod, settings.sunElevation, 0.7);
  const az = (settings.sunAzimuth * Math.PI) / 180;
  const el = (elev * Math.PI) / 180;

  const sunDir = new THREE.Vector3(
    Math.cos(el) * Math.cos(az),
    Math.sin(el),
    Math.cos(el) * Math.sin(az),
  ).normalize();

  const isNight = elev < -1.5 || tod < 0.16 || tod > 0.84;
  // Continuous: every quantity is a smooth function of elevation, so a slow
  // day cycle grades through golden hour instead of snapping between palettes.
  const rampElev = isNight ? Math.min(elev, -6) : elev;
  const sunColor = ramp(rampElev, SUN_KEYS, new THREE.Color());
  const skyTop = ramp(rampElev, ZENITH_KEYS, new THREE.Color());
  const skyHorizon = ramp(rampElev, HORIZON_KEYS, new THREE.Color());
  const fogColor = ramp(rampElev, FOG_KEYS, new THREE.Color());
  const golden = isNight ? 0 : 1 - smoothstep(3, 30, elev);
  const twilight = isNight ? 1 : 1 - smoothstep(-6, 2, elev);

  const moonDir = sunDir.clone().multiplyScalar(-1);
  // Brighter overall exposure envelope: night floor raised, day ramps higher
  // with sun elevation; golden hour drops ambient so the warm key carves form.
  const ambient = isNight ? 0.22 : 0.3 + Math.max(0, sunDir.y) * 0.22 + (1 - golden) * 0.06;

  return {
    sunDir,
    sunColor,
    moonDir,
    fogColor,
    skyTop,
    skyHorizon,
    ambient,
    isNight,
    sunElevation: elev,
    golden,
    twilight,
  };
}

/** Shared GLSL for sky radiance so the dome, PMREM capture and water horizon agree. */
export const SKY_RADIANCE_GLSL = /* glsl */ `
float skyHg(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5) * 0.0795775;
}

// Linear HDR sky radiance for a view direction. Authored for ACES at ~1.0 exposure.
vec3 skyRadiance(
  vec3 dir, vec3 sunDir, vec3 top, vec3 horizon, vec3 sunColor,
  float golden, float twilight
) {
  float y = dir.y;
  float h = max(y, 0.0);
  float zen = pow(h, 0.45);
  vec3 col = mix(horizon, top, smoothstep(0.0, 1.0, zen));
  vec2 flatDir = normalize(dir.xz + vec2(1e-5));
  vec2 flatSun = normalize(sunDir.xz + vec2(1e-5));
  float sunSide = 0.5 + 0.5 * dot(flatDir, flatSun);
  // Golden hour: ember band on the sun side, dusky rose "belt" on the antisolar side.
  vec3 antiSolar = mix(top * 1.25, vec3(0.55, 0.36, 0.52), 0.6);
  float band = exp(-h * 7.0);
  col = mix(col, mix(antiSolar, horizon * 1.1, pow(sunSide, 1.6)), band * golden * 0.9);
  float cosT = dot(dir, sunDir);
  // Two-lobe Mie forward scatter: tight aureole + broad warm glow that grows near sunset.
  float mieTight = skyHg(cosT, 0.86);
  float mieWide = skyHg(cosT, 0.45);
  float horizonGain = 0.45 + 0.55 * exp(-h * 3.5);
  col += sunColor * (mieTight * (0.05 + golden * 0.11) + mieWide * golden * 0.55) * horizonGain;
  // Below the horizon fade to a dim haze (the sea covers it, but reflections sample it).
  col = mix(col, horizon * 0.35 + top * 0.1, smoothstep(0.0, -0.35, y));
  col *= mix(1.0, 0.18, twilight);
  return max(col, vec3(0.0));
}
`;

const SHADOW_TEXEL = 280 / 2048;
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Snap a world point to the shadow map texel grid in light space (keeps depth axis). */
export function snapToShadowTexel(
  point: THREE.Vector3,
  lightDir: THREE.Vector3,
  texel = SHADOW_TEXEL,
): THREE.Vector3 {
  const ref = Math.abs(lightDir.y) > 0.99 ? _up.set(1, 0, 0) : _up.set(0, 1, 0);
  _right.crossVectors(ref, lightDir).normalize();
  const upAxis = new THREE.Vector3().crossVectors(lightDir, _right).normalize();
  const px = point.dot(_right);
  const py = point.dot(upAxis);
  const dx = Math.round(px / texel) * texel - px;
  const dy = Math.round(py / texel) * texel - py;
  return point.clone().addScaledVector(_right, dx).addScaledVector(upAxis, dy);
}

export class Atmosphere {
  readonly group = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  /** Soft opposite-side key fill so hull shadow faces don't crush to black. */
  readonly fill: THREE.DirectionalLight;
  /** Upward teal bounce approximating light scattered off the sea surface. */
  readonly bounce: THREE.DirectionalLight;
  /** Low, sun-side warm light so silhouettes separate from the sky at golden hour. */
  readonly rim: THREE.DirectionalLight;
  readonly sunDisc: THREE.Mesh;
  readonly moonDisc: THREE.Mesh;
  readonly sky: THREE.Mesh;
  readonly clouds: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly cloudMat: THREE.ShaderMaterial;
  private followX = 0;
  private followZ = 0;
  private lastSunDir = new THREE.Vector3(0.4, 0.8, 0.2);
  private cloudTime = 0;
  private lastState: AtmosphereState | null = null;
  private readonly fog = new THREE.FogExp2(0xffffff, 0.001);
  private readonly background = new THREE.Color();
  private readonly snapped = new THREE.Vector3();

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xd8f0ff, 0x5a9a78, 0.72);
    this.group.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.group.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff0cf, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.camera.left = -140;
    this.sun.shadow.camera.right = 140;
    this.sun.shadow.camera.top = 140;
    this.sun.shadow.camera.bottom = -140;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun);

    this.moon = new THREE.DirectionalLight(0x8899aa, 0.2);
    this.moon.castShadow = false;
    this.group.add(this.moon);
    this.group.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xbfd9e8, 0.35);
    this.fill.castShadow = false;
    this.group.add(this.fill);
    this.group.add(this.fill.target);

    this.bounce = new THREE.DirectionalLight(0x2fb5a0, 0.22);
    this.bounce.castShadow = false;
    this.group.add(this.bounce);
    this.group.add(this.bounce.target);

    this.rim = new THREE.DirectionalLight(0xffc89a, 0);
    this.rim.castShadow = false;
    this.group.add(this.rim);
    this.group.add(this.rim.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d9fe3) },
        uHorizon: { value: new THREE.Color(0xd5efff) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.94, 0.81) },
        uGolden: { value: 0 },
        uTwilight: { value: 0 },
        uSunDiscGain: { value: 1 },
        uStars: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uGolden;
        uniform float uTwilight;
        uniform float uSunDiscGain;
        uniform float uStars;
        uniform float uFlash;
        uniform float uTime;
        varying vec3 vDir;
        float starHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        ${SKY_RADIANCE_GLSL}
        void main() {
          vec3 dir = normalize(vDir);
          vec3 sd = normalize(uSunDir);
          vec3 col = skyRadiance(dir, sd, uTop, uHorizon, uSunColor, uGolden, uTwilight);
          // Sun disc with limb darkening; HDR so bloom blooms the disc, not the sky.
          float cosT = dot(dir, sd);
          float radius = mix(0.99993, 0.99984, uGolden);
          float disc = smoothstep(radius, radius + 0.00004, cosT);
          float limb = 0.55 + 0.45 * smoothstep(radius, 1.0, cosT);
          // Horizon extinction squashes and reddens the disc as it sets.
          float extinction = smoothstep(-0.012, 0.03, dir.y);
          col += uSunColor * vec3(1.0, 0.86, 0.7) * disc * limb * 16.0 * uSunDiscGain * extinction;
          // Night: a sparse, twinkling star field that fades out toward the hazy horizon.
          if (uStars > 0.001 && dir.y > 0.0) {
            vec2 cell = vec2(atan(dir.z, dir.x) * 260.0, asin(clamp(dir.y, 0.0, 1.0)) * 260.0);
            vec2 id = floor(cell);
            float h = starHash(id);
            float star = step(0.9975, h);
            vec2 f = fract(cell) - 0.5;
            float core = exp(-dot(f, f) * 40.0);
            float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
            vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(h * 91.0));
            col += tint * star * core * twinkle * uStars * smoothstep(0.02, 0.25, dir.y) * 2.2;
          }
          // Storm lightning briefly floods the whole dome cold-white.
          col += vec3(0.55, 0.6, 0.75) * uFlash * (0.35 + 0.65 * smoothstep(-0.05, 0.6, dir.y));
          // Faint dither so the long gradients never band on 8-bit swapchains.
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          col += (n - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // Large enough vs camera far plane so the dome never clips as the boat travels.
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.skyMat);
    this.sky.renderOrder = -2;
    this.group.add(this.sky);

    this.cloudMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.94, 0.81) },
        uCloudColor: { value: new THREE.Color(0xf4f8fc) },
        uShadowColor: { value: new THREE.Color(0x8a96a8) },
        uCoverage: { value: 0.72 },
        uOpacity: { value: 0.78 },
        uGolden: { value: 0 },
        uTwilight: { value: 0 },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uCloudColor;
        uniform vec3 uShadowColor;
        uniform float uCoverage;
        uniform float uOpacity;
        uniform float uGolden;
        uniform float uTwilight;
        uniform float uFlash;
        varying vec3 vDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * noise(p);
            p = mat2(1.6, 1.2, -1.2, 1.6) * p;
            a *= 0.5;
          }
          return v;
        }

        float density(vec2 uv) {
          float n = fbm(uv * 0.95);
          n += 0.42 * fbm(uv * 2.4 - uTime * 0.025);
          n += 0.18 * fbm(uv * 5.2 + uTime * 0.01);
          return n;
        }

        void main() {
          vec3 dir = normalize(vDir);
          float elev = dir.y;
          if (elev < -0.04) discard;
          vec3 sd = normalize(uSunDir);
          vec2 uv = dir.xz / max(0.12, elev + 0.42);
          uv += vec2(uTime * 0.018, uTime * 0.011);
          float n = density(uv);
          float lo = 1.0 - uCoverage;
          float soft = smoothstep(lo - 0.12, lo + 0.34, n);
          float hard = smoothstep(lo + 0.08, lo + 0.42, n);
          float clouds = mix(soft, hard, 0.55);
          // Self-shadow: density a step toward the sun darkens the body.
          vec2 toSun = normalize(sd.xz + vec2(1e-4)) * 0.18;
          float nSun = density(uv + toSun);
          float shade = clamp((nSun - n) * 2.6 + 0.55, 0.0, 1.0);
          // High cirrus streaks catch the last light at golden hour.
          vec2 cuv = dir.xz / max(0.08, elev + 0.25);
          float cirrus = smoothstep(0.55, 0.85, fbm(vec2(cuv.x * 0.6, cuv.y * 3.2) + uTime * 0.006));
          cirrus *= smoothstep(0.04, 0.3, elev) * (0.25 + 0.75 * uGolden);
          float band = smoothstep(-0.04, 0.06, elev) * (1.0 - smoothstep(0.42, 0.88, elev));
          float horizonBoost = 1.0 + 0.85 * (1.0 - smoothstep(0.02, 0.28, elev));
          clouds *= band * horizonBoost;

          float cosT = dot(dir, sd);
          float forward = pow(max(cosT, 0.0), 6.0);
          vec2 flatDir = normalize(dir.xz + vec2(1e-5));
          vec2 flatSun = normalize(sd.xz + vec2(1e-5));
          float sunSide = 0.5 + 0.5 * dot(flatDir, flatSun);
          // Lit face: sun colour; shadowed belly: sky-tinted shadow colour. At golden
          // hour bellies go slate-violet and only sun-facing tops and rims catch fire.
          vec3 lit = mix(uCloudColor, uSunColor * 1.25, uGolden * 0.8);
          lit *= mix(1.0, mix(0.45, 1.0, sunSide), uGolden);
          vec3 slate = vec3(0.16, 0.15, 0.26);
          vec3 shadowed = mix(uShadowColor, slate, uGolden * 0.75);
          vec3 col = mix(shadowed, lit, shade * (0.55 + 0.45 * hard));
          // Silver lining: thin edges glow toward the sun.
          float edge = (1.0 - hard) * soft;
          col += uSunColor * edge * forward * (1.6 + uGolden * 3.0);
          // Underside warm glow from the sun below the deck at sunset.
          col += uSunColor * uGolden * (1.0 - shade) * 0.25 * smoothstep(0.25, 0.0, elev) * sunSide;
          col = mix(col, uSunColor * 1.2 + vec3(0.25, 0.08, 0.12), cirrus * uGolden * 0.5);
          col *= mix(1.0, 0.25, uTwilight);
          // Lightning lights the cloud deck from inside: thick cores glow, edges stay dark.
          col += vec3(0.8, 0.85, 1.0) * uFlash * (0.4 + 0.9 * hard) * (0.6 + 0.4 * n);
          float alpha = max(clouds, cirrus * 0.55) * uOpacity * (0.5 + 0.5 * clamp(elev + 0.15, 0.0, 1.0));
          if (alpha < 0.012) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(860, 64, 32), this.cloudMat);
    this.clouds.renderOrder = -1;
    this.group.add(this.clouds);

    const discGeo = new THREE.CircleGeometry(5.5, 32);
    // The sky shader now draws the sun disc with limb darkening; this mesh is kept
    // for API stability (tests / probes) but never rendered.
    this.sunDisc = new THREE.Mesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff0cf, fog: false, depthWrite: false }),
    );
    this.sunDisc.visible = false;
    this.moonDisc = new THREE.Mesh(
      discGeo.clone(),
      new THREE.MeshBasicMaterial({
        color: 0xc8d2dc,
        fog: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.group.add(this.sunDisc, this.moonDisc);
  }

  get state(): AtmosphereState | null {
    return this.lastState;
  }

  apply(
    settings: AtmosphereSettings,
    scene: THREE.Scene,
    dt = 1 / 60,
    presentation?: { cloudCoverage?: number; lightning?: number; fogDensity?: number },
  ): AtmosphereState {
    const state = evaluateAtmosphere(settings);
    this.lastState = state;
    this.cloudTime += dt;
    const fogDensity = presentation?.fogDensity ?? settings.fogDensity;
    this.background.copy(state.skyHorizon);
    scene.background = this.background;
    this.fog.color.copy(state.fogColor);
    // Reassert every frame: OutdoorLighting.update scales fog.density in place.
    // Golden hour thickens the marine layer a touch for atmospheric depth.
    this.fog.density = fogDensity * (1 + state.golden * 0.9);
    scene.fog = this.fog;
    scene.environmentIntensity = state.isNight ? 0.28 : 0.62 * (1 - state.golden * 0.15);

    const flash = Math.max(0, presentation?.lightning ?? 0);
    this.hemi.intensity = state.ambient * (1 - state.golden * 0.3) + flash * 0.85;
    this.hemi.color.copy(state.skyTop).lerp(state.skyHorizon, 0.5);
    this.hemi.groundColor.set(0x5a9a78).lerp(new THREE.Color(0x203848), state.golden * 0.7);

    this.ambient.intensity = (state.isNight ? 0.16 : 0.32 - state.golden * 0.12) + flash * 0.45;
    this.ambient.color.copy(state.sunColor).lerp(state.skyTop, 0.35 + state.golden * 0.4);

    this.lastSunDir.copy(state.sunDir);
    const intensityScale = settings.sunIntensity ?? 1;
    this.placeSun(this.followX, this.followZ);
    // Grazing light is warmer and a little brighter so it can carve hull form.
    this.sun.intensity = state.isNight
      ? 0.22 * intensityScale
      : (1.35 + Math.max(0, state.sunDir.y) * 1.8 + state.golden * 0.75) * intensityScale;
    this.sun.color.copy(state.sunColor);
    // castShadow stays true (toggling recompiles lit materials); fade instead.
    this.sun.shadow.intensity = state.isNight ? 0 : smoothstep(0.02, 0.12, state.sunDir.y);

    this.moon.position.set(
      this.followX + state.moonDir.x * 110,
      state.moonDir.y * 110,
      this.followZ + state.moonDir.z * 110,
    );
    this.moon.intensity = state.isNight ? 0.3 : 0.04;

    this.fill.position.set(
      this.followX - state.sunDir.x * 90,
      Math.max(20, state.sunDir.y * 60 + 30),
      this.followZ - state.sunDir.z * 90,
    );
    this.fill.target.position.set(this.followX, 0, this.followZ);
    this.fill.target.updateMatrixWorld();
    // Cool sky fill opposite a warm key: the classic sunset split.
    this.fill.intensity = state.isNight
      ? 0.08
      : 0.14 + Math.max(0, state.sunDir.y) * 0.1 + state.golden * 0.1;
    this.fill.color.copy(state.skyTop).lerp(new THREE.Color(0.45, 0.55, 0.9), state.golden * 0.5);

    this.placeRim(this.followX, this.followZ);
    this.rim.intensity = state.isNight ? 0 : state.golden * 0.7 * intensityScale;
    this.rim.color.copy(state.sunColor).lerp(state.skyHorizon, 0.3);

    this.bounce.position.set(this.followX, -20, this.followZ);
    this.bounce.target.position.set(this.followX, 20, this.followZ);
    this.bounce.target.updateMatrixWorld();
    this.bounce.intensity = state.isNight ? 0.06 : 0.16 + Math.max(0, state.sunDir.y) * 0.12;
    this.bounce.color.set(0x2fb5a0).lerp(new THREE.Color(0xd08a5a), state.golden * 0.55);

    this.skyMat.uniforms.uTop.value.copy(state.skyTop);
    this.skyMat.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.skyMat.uniforms.uSunDir.value.copy(state.sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(state.sunColor);
    this.skyMat.uniforms.uGolden.value = state.golden;
    this.skyMat.uniforms.uTwilight.value = state.isNight ? 1 : state.twilight;
    this.skyMat.uniforms.uSunDiscGain.value = state.isNight ? 0 : 1;
    this.skyMat.uniforms.uStars.value = state.isNight ? 1 : state.twilight * 0.6;
    this.skyMat.uniforms.uFlash.value = flash;
    this.skyMat.uniforms.uTime.value = this.cloudTime;
    this.cloudMat.uniforms.uFlash.value = flash;

    const cloudCoverage = presentation?.cloudCoverage ?? (state.isNight ? 0.48 : 0.74);
    this.cloudMat.uniforms.uTime.value = this.cloudTime;
    this.cloudMat.uniforms.uSunDir.value.copy(state.sunDir);
    this.cloudMat.uniforms.uSunColor.value.copy(state.sunColor);
    this.cloudMat.uniforms.uCloudColor.value.copy(
      state.isNight ? new THREE.Color(0x6a7584) : new THREE.Color(0xf2f6fa),
    );
    this.cloudMat.uniforms.uShadowColor.value
      .copy(state.skyTop)
      .lerp(new THREE.Color(0x8a96a8), 0.55)
      .multiplyScalar(state.isNight ? 0.35 : 1);
    this.cloudMat.uniforms.uCoverage.value = cloudCoverage;
    // High sun: broken trade-wind cumulus rather than an overcast sheet.
    this.cloudMat.uniforms.uOpacity.value = state.isNight ? 0.4 : 0.56 + state.golden * 0.26;
    this.cloudMat.uniforms.uGolden.value = state.golden;
    this.cloudMat.uniforms.uTwilight.value = state.isNight ? 1 : state.twilight;

    this.sunDisc.position.set(
      this.followX + state.sunDir.x * 520,
      state.sunDir.y * 520,
      this.followZ + state.sunDir.z * 520,
    );
    this.sunDisc.lookAt(this.followX, 0, this.followZ);

    this.moonDisc.position.set(
      this.followX + state.moonDir.x * 480,
      state.moonDir.y * 480,
      this.followZ + state.moonDir.z * 480,
    );
    this.moonDisc.lookAt(this.followX, 0, this.followZ);
    this.moonDisc.visible = state.isNight || state.moonDir.y > 0.15;
    (this.moonDisc.material as THREE.MeshBasicMaterial).opacity = state.isNight ? 1 : 0.3;

    return state;
  }

  private placeRim(x: number, z: number): void {
    const d = this.lastSunDir;
    this.rim.position.set(x + d.x * 80, 6 + Math.max(0, d.y) * 40, z + d.z * 80);
    this.rim.target.position.set(x, 3, z);
    this.rim.target.updateMatrixWorld();
  }

  private placeSun(x: number, z: number): void {
    const d = this.lastSunDir;
    this.snapped.copy(snapToShadowTexel(this.snapped.set(x, 0, z), d));
    this.sun.target.position.copy(this.snapped);
    this.sun.position.set(
      this.snapped.x + d.x * 140,
      this.snapped.y + d.y * 140,
      this.snapped.z + d.z * 140,
    );
    this.sun.target.updateMatrixWorld();
  }

  reset(): void {
    this.cloudTime = 0;
  }

  follow(x: number, z: number): void {
    this.followX = x;
    this.followZ = z;
    this.sky.position.set(x, 0, z);
    this.clouds.position.set(x, 0, z);
    this.placeSun(x, z);
    this.placeRim(x, z);

    this.fill.position.set(
      x - this.lastSunDir.x * 90,
      Math.max(20, this.lastSunDir.y * 60 + 30),
      z - this.lastSunDir.z * 90,
    );
    this.fill.target.position.set(x, 0, z);
    this.fill.target.updateMatrixWorld();

    this.bounce.position.set(x, -20, z);
    this.bounce.target.position.set(x, 20, z);
    this.bounce.target.updateMatrixWorld();
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.clouds.geometry.dispose();
    this.cloudMat.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.moonDisc.geometry.dispose();
    (this.moonDisc.material as THREE.Material).dispose();
  }
}
