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
}

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

  const isNight = elev < 0 || tod < 0.16 || tod > 0.84;
  const dawn = smoothstep(0.15, 0.28, tod) * (1 - smoothstep(0.28, 0.4, tod));
  const dusk = smoothstep(0.68, 0.8, tod) * (1 - smoothstep(0.8, 0.92, tod));

  const sunColor = new THREE.Color();
  if (isNight) {
    sunColor.setRGB(0.45, 0.52, 0.65);
  } else if (dawn > 0.05 || dusk > 0.05) {
    sunColor.setRGB(1.0, 0.78, 0.52);
  } else {
    sunColor.setRGB(1.0, 0.94, 0.81); // #fff0cf-ish
  }

  const fogColor = new THREE.Color();
  if (isNight) fogColor.setRGB(0.05, 0.08, 0.12);
  else if (dawn > 0.1 || dusk > 0.1) fogColor.setRGB(0.85, 0.78, 0.7);
  else fogColor.setRGB(0.84, 0.93, 1.0); // sea mist

  const skyTop = new THREE.Color();
  const skyHorizon = new THREE.Color();
  if (isNight) {
    skyTop.setRGB(0.02, 0.04, 0.08);
    skyHorizon.setRGB(0.05, 0.07, 0.12);
  } else if (dawn > 0.1 || dusk > 0.1) {
    skyTop.setRGB(0.35, 0.5, 0.75);
    skyHorizon.setRGB(0.95, 0.75, 0.55);
  } else {
    skyTop.setRGB(0.24, 0.62, 0.89); // #3d9fe3
    skyHorizon.setRGB(0.84, 0.94, 1.0); // #d5efff
  }

  const moonDir = sunDir.clone().multiplyScalar(-1);
  // Brighter overall exposure envelope: night floor raised, day ramps higher
  // with sun elevation so noon reads bright without blowing out dawn/dusk.
  const ambient = isNight ? 0.38 : 0.78 + Math.max(0, sunDir.y) * 0.35;

  return { sunDir, sunColor, moonDir, fogColor, skyTop, skyHorizon, ambient, isNight };
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

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d9fe3) },
        uHorizon: { value: new THREE.Color(0xd5efff) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.94, 0.81) },
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
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 1.15));
          float sun = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 220.0);
          col += uSunColor * sun * 0.55;
          float glow = pow(max(dot(normalize(vDir), normalize(uSunDir)), 0.0), 6.0);
          col += uSunColor * glow * 0.1;
          col = min(col, vec3(1.05));
          gl_FragColor = vec4(col, 1.0);
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
        uCloudColor: { value: new THREE.Color(0xf4f8fc) },
        uCoverage: { value: 0.72 },
        uOpacity: { value: 0.78 },
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
        uniform vec3 uCloudColor;
        uniform float uCoverage;
        uniform float uOpacity;
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
            p *= 2.03;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          // Horizon + mid-sky band — readable from the high chase camera.
          float elev = dir.y;
          if (elev < -0.08) discard;
          vec2 uv = dir.xz / max(0.12, elev + 0.42);
          uv += vec2(uTime * 0.018, uTime * 0.011);
          float n = fbm(uv * 0.95);
          n += 0.42 * fbm(uv * 2.4 - uTime * 0.025);
          n += 0.18 * fbm(uv * 5.2 + uTime * 0.01);
          float soft = smoothstep(1.0 - uCoverage - 0.12, 1.0 - uCoverage + 0.34, n);
          float hard = smoothstep(1.0 - uCoverage + 0.08, 1.0 - uCoverage + 0.42, n);
          float clouds = mix(soft, hard, 0.55);
          // Fat horizon bank + thinner high wisps.
          float band = smoothstep(-0.06, 0.08, elev) * (1.0 - smoothstep(0.42, 0.88, elev));
          float horizonBoost = 1.0 + 0.85 * (1.0 - smoothstep(0.02, 0.28, elev));
          clouds *= band * horizonBoost;
          float lit = 0.58 + 0.42 * max(dot(dir, normalize(uSunDir)), 0.0);
          vec3 col = mix(uCloudColor * 0.82, uCloudColor, hard) * lit;
          float alpha = clouds * uOpacity * (0.5 + 0.5 * clamp(elev + 0.15, 0.0, 1.0));
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
        }
      `,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(860, 64, 32), this.cloudMat);
    this.clouds.renderOrder = -1;
    this.group.add(this.clouds);

    const discGeo = new THREE.CircleGeometry(5.5, 32);
    this.sunDisc = new THREE.Mesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff0cf, fog: false, depthWrite: false }),
    );
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

  apply(
    settings: AtmosphereSettings,
    scene: THREE.Scene,
    dt = 1 / 60,
    presentation?: { cloudCoverage?: number; lightning?: number; fogDensity?: number },
  ): AtmosphereState {
    const state = evaluateAtmosphere(settings);
    this.cloudTime += dt;
    const fogDensity = presentation?.fogDensity ?? settings.fogDensity;
    scene.background = state.skyHorizon.clone();
    scene.fog = new THREE.FogExp2(state.fogColor.getHex(), fogDensity);
    scene.environmentIntensity = state.isNight ? 0.35 : 0.95;

    const flash = Math.max(0, presentation?.lightning ?? 0);
    this.hemi.intensity = state.ambient + flash * 0.85;
    this.hemi.color.copy(state.skyHorizon);
    this.hemi.groundColor.set(0x5a9a78);

    this.ambient.intensity = (state.isNight ? 0.16 : 0.32) + flash * 0.45;
    this.ambient.color.copy(state.sunColor);

    this.lastSunDir.copy(state.sunDir);
    const intensityScale = settings.sunIntensity ?? 1;
    this.sun.position.set(
      this.followX + state.sunDir.x * 140,
      state.sunDir.y * 140,
      this.followZ + state.sunDir.z * 140,
    );
    this.sun.intensity = state.isNight
      ? 0.16 * intensityScale
      : (0.95 + Math.max(0, state.sunDir.y) * 1.35) * intensityScale;
    this.sun.color.copy(state.sunColor);
    this.sun.castShadow = !state.isNight && state.sunDir.y > 0.1;
    this.sun.target.position.set(this.followX, 0, this.followZ);
    this.sun.target.updateMatrixWorld();

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
    this.fill.intensity = state.isNight ? 0.12 : 0.3 + Math.max(0, state.sunDir.y) * 0.18;
    this.fill.color.copy(state.skyTop);

    this.bounce.position.set(this.followX, -20, this.followZ);
    this.bounce.target.position.set(this.followX, 20, this.followZ);
    this.bounce.target.updateMatrixWorld();
    this.bounce.intensity = state.isNight ? 0.06 : 0.16 + Math.max(0, state.sunDir.y) * 0.12;

    this.skyMat.uniforms.uTop.value.copy(state.skyTop);
    this.skyMat.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.skyMat.uniforms.uSunDir.value.copy(state.sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(state.sunColor);

    this.cloudMat.uniforms.uTime.value = this.cloudTime;
    this.cloudMat.uniforms.uSunDir.value.copy(state.sunDir);
    this.cloudMat.uniforms.uCloudColor.value.copy(
      state.isNight ? new THREE.Color(0x6a7584) : new THREE.Color(0xf2f6fa),
    );
    this.cloudMat.uniforms.uCoverage.value =
      presentation?.cloudCoverage ?? (state.isNight ? 0.48 : 0.74);
    this.cloudMat.uniforms.uOpacity.value = state.isNight ? 0.4 : 0.82;

    this.sunDisc.position.set(
      this.followX + state.sunDir.x * 520,
      state.sunDir.y * 520,
      this.followZ + state.sunDir.z * 520,
    );
    this.sunDisc.lookAt(this.followX, 0, this.followZ);
    this.sunDisc.visible = state.sunDir.y > -0.02;

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

  reset(): void {
    this.cloudTime = 0;
  }

  follow(x: number, z: number): void {
    this.followX = x;
    this.followZ = z;
    this.sky.position.set(x, 0, z);
    this.clouds.position.set(x, 0, z);
    this.sun.position.set(
      x + this.lastSunDir.x * 140,
      this.lastSunDir.y * 140,
      z + this.lastSunDir.z * 140,
    );
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();

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
