/**
 * Applies a LightGrade to the atmosphere state and its lights. Identity or
 * undefined grades are a strict no-op, so a clear day renders as before. Never
 * mutates the input state; graded colours and vectors are fresh objects.
 */
import * as THREE from 'three';
import type { AtmosphereState } from '../atmosphere';
import { IDENTITY_GRADE, type LightGrade } from './light-grade';

export interface GradeLights {
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  moon: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export interface OceanKeyLight {
  dir: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number };
}

export const MOON_GLINT_RGB = [0.32, 0.38, 0.55] as const;
export const MOON_RIM_RGB = [0.62, 0.72, 0.95] as const;

const SUN_DESAT_SHARE = 0.5;

function isIdentityGrade(grade: LightGrade | undefined): boolean {
  if (grade === undefined) return true;
  if (grade === IDENTITY_GRADE) return true;
  return (
    grade.ambientFloor === 0 &&
    grade.ambientAdd === 0 &&
    grade.moonIntensity === 0 &&
    grade.moonRim === 0 &&
    grade.moonGlint === 0 &&
    grade.skyFloor[0] === 0 &&
    grade.skyFloor[1] === 0 &&
    grade.skyFloor[2] === 0 &&
    grade.desaturate === 0 &&
    grade.goldenScale === 1 &&
    grade.envIntensityFloor === 0
  );
}

/** Pulls a colour toward its luminance grey by `amount` (0..1). Returns a new Color. */
function desaturated(color: THREE.Color, amount: number): THREE.Color {
  const out = color.clone();
  if (amount <= 0) return out;
  const luma = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return out.lerp(new THREE.Color(luma, luma, luma), amount);
}

function gradeSky(
  color: THREE.Color,
  desaturate: number,
  floor: readonly [number, number, number] | null,
): THREE.Color {
  const out = desaturated(color, desaturate);
  if (floor) {
    out.setRGB(Math.max(out.r, floor[0]), Math.max(out.g, floor[1]), Math.max(out.b, floor[2]));
  }
  return out;
}

/** New graded state (never mutates `state`). Identity or undefined grade → returns `state` itself. */
export function gradeAtmosphereState(
  state: AtmosphereState,
  grade: LightGrade | undefined,
): AtmosphereState {
  if (isIdentityGrade(grade) || grade === undefined) return state;
  const floor = state.isNight ? grade.skyFloor : null;
  return {
    ...state,
    sunDir: state.sunDir.clone(),
    moonDir: state.moonDir.clone(),
    sunColor: desaturated(state.sunColor, grade.desaturate * SUN_DESAT_SHARE),
    skyTop: gradeSky(state.skyTop, grade.desaturate, floor),
    skyHorizon: gradeSky(state.skyHorizon, grade.desaturate, floor),
    fogColor: gradeSky(state.fogColor, grade.desaturate, floor),
    golden: state.golden * grade.goldenScale,
  };
}

/** After Atmosphere.apply has set its intensities: floors and moon rim. Identity/undefined → no-op. */
export function applyGradeLights(
  lights: GradeLights,
  state: AtmosphereState,
  grade: LightGrade | undefined,
  scene: THREE.Scene,
): void {
  if (isIdentityGrade(grade) || grade === undefined) return;
  lights.hemi.intensity = Math.max(lights.hemi.intensity, grade.ambientFloor);
  lights.ambient.intensity += grade.ambientAdd;
  if (!state.isNight) return;
  lights.moon.intensity = Math.max(lights.moon.intensity, grade.moonIntensity);
  lights.rim.intensity = grade.moonRim;
  lights.rim.color.setRGB(...MOON_RIM_RGB);
  scene.environmentIntensity = Math.max(scene.environmentIntensity, grade.envIntensityFloor);
}

/** Ocean key light: the sun normally; dim cool moonlight at night when grade.moonGlint > 0. Plain objects. */
export function oceanKeyLight(
  state: AtmosphereState,
  grade: LightGrade | undefined,
): OceanKeyLight {
  if (!grade || !state.isNight || grade.moonGlint <= 0) {
    return {
      dir: { x: state.sunDir.x, y: state.sunDir.y, z: state.sunDir.z },
      color: { r: state.sunColor.r, g: state.sunColor.g, b: state.sunColor.b },
    };
  }
  const glint = grade.moonGlint;
  return {
    dir: { x: state.moonDir.x, y: state.moonDir.y, z: state.moonDir.z },
    color: {
      r: MOON_GLINT_RGB[0] * glint,
      g: MOON_GLINT_RGB[1] * glint,
      b: MOON_GLINT_RGB[2] * glint,
    },
  };
}
