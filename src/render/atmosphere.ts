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
  const ambient = isNight ? 0.22 : 0.58 + Math.max(0, sunDir.y) * 0.28;

  return { sunDir, sunColor, moonDir, fogColor, skyTop, skyHorizon, ambient, isNight };
}

export class Atmosphere {
  readonly group = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly sunDisc: THREE.Mesh;
  readonly moonDisc: THREE.Mesh;
  readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private followX = 0;
  private followZ = 0;
  private lastSunDir = new THREE.Vector3(0.4, 0.8, 0.2);

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xd8f0ff, 0x5a9a78, 0.72);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0cf, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -100;
    this.sun.shadow.camera.right = 100;
    this.sun.shadow.camera.top = 100;
    this.sun.shadow.camera.bottom = -100;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.04;
    this.group.add(this.sun);

    this.moon = new THREE.DirectionalLight(0x8899aa, 0.2);
    this.moon.castShadow = false;
    this.group.add(this.moon);
    this.group.add(this.sun.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
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
          // Soft clamp to avoid white mountain/sky blowout
          col = min(col, vec3(1.05));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), this.skyMat);
    this.group.add(this.sky);

    const discGeo = new THREE.CircleGeometry(5.5, 32);
    this.sunDisc = new THREE.Mesh(
      discGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff0cf, fog: false, depthWrite: false }),
    );
    this.moonDisc = new THREE.Mesh(
      discGeo.clone(),
      new THREE.MeshBasicMaterial({ color: 0xc8d2dc, fog: false, depthWrite: false, transparent: true }),
    );
    this.group.add(this.sunDisc, this.moonDisc);
  }

  apply(settings: AtmosphereSettings, scene: THREE.Scene): AtmosphereState {
    const state = evaluateAtmosphere(settings);
    scene.background = state.skyHorizon.clone();
    scene.fog = new THREE.FogExp2(state.fogColor.getHex(), settings.fogDensity);

    this.hemi.intensity = state.ambient;
    this.hemi.color.copy(state.skyHorizon);
    this.hemi.groundColor.set(0x5a9a78);

    this.lastSunDir.copy(state.sunDir);
    const intensityScale = settings.sunIntensity ?? 1;
    this.sun.position.set(
      this.followX + state.sunDir.x * 140,
      state.sunDir.y * 140,
      this.followZ + state.sunDir.z * 140,
    );
    this.sun.intensity = state.isNight
      ? 0.12 * intensityScale
      : (0.75 + Math.max(0, state.sunDir.y) * 1.1) * intensityScale;
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

    this.skyMat.uniforms.uTop.value.copy(state.skyTop);
    this.skyMat.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.skyMat.uniforms.uSunDir.value.copy(state.sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(state.sunColor);

    this.sunDisc.position.set(
      this.followX + state.sunDir.x * 300,
      state.sunDir.y * 300,
      this.followZ + state.sunDir.z * 300,
    );
    this.sunDisc.lookAt(this.followX, 0, this.followZ);
    this.sunDisc.visible = state.sunDir.y > -0.02;

    this.moonDisc.position.set(
      this.followX + state.moonDir.x * 280,
      state.moonDir.y * 280,
      this.followZ + state.moonDir.z * 280,
    );
    this.moonDisc.lookAt(this.followX, 0, this.followZ);
    this.moonDisc.visible = state.isNight || state.moonDir.y > 0.15;
    (this.moonDisc.material as THREE.MeshBasicMaterial).opacity = state.isNight ? 1 : 0.3;

    return state;
  }

  follow(x: number, z: number): void {
    this.followX = x;
    this.followZ = z;
    this.sky.position.set(x, 0, z);
    this.sun.position.set(
      x + this.lastSunDir.x * 140,
      this.lastSunDir.y * 140,
      z + this.lastSunDir.z * 140,
    );
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.sunDisc.geometry.dispose();
    (this.sunDisc.material as THREE.Material).dispose();
    this.moonDisc.geometry.dispose();
    (this.moonDisc.material as THREE.Material).dispose();
  }
}
