import type { WaveComponent, WaveSample } from './types';

/** Four directional Gerstner-style swell components (normalized base amplitudes). */
export const BASE_WAVES: readonly WaveComponent[] = [
  { amplitude: 0.55, wavelength: 48, direction: 0.35, steepness: 0.55, phase: 0.1 },
  { amplitude: 0.32, wavelength: 22, direction: 1.85, steepness: 0.7, phase: 1.2 },
  { amplitude: 0.22, wavelength: 12, direction: -0.9, steepness: 0.8, phase: 2.4 },
  { amplitude: 0.12, wavelength: 6.5, direction: 2.6, steepness: 0.9, phase: 0.7 },
] as const;

const TWO_PI = Math.PI * 2;
const G = 9.81;

export function waveNumber(wavelength: number): number {
  return TWO_PI / Math.max(wavelength, 0.001);
}

export function waveAngularFrequency(k: number): number {
  return Math.sqrt(G * k);
}

export function scaledWaves(
  waveHeight: number,
  choppiness: number,
  seaState: number,
): WaveComponent[] {
  const heightScale = waveHeight * (0.45 + seaState * 0.9);
  const steepScale = choppiness * (0.55 + seaState * 0.55);
  return BASE_WAVES.map((w) => ({
    ...w,
    amplitude: w.amplitude * heightScale,
    steepness: Math.min(1, w.steepness * steepScale),
  }));
}

/**
 * Analytical Gerstner displacement + approximate surface normal at (x, z).
 * Matches the ocean ShaderMaterial so vessels track the free surface.
 */
export function sampleGerstner(
  x: number,
  z: number,
  time: number,
  waves: readonly WaveComponent[],
): WaveSample {
  let height = 0;
  let dx = 0;
  let dz = 0;
  let nx = 0;
  let nz = 0;

  for (const wave of waves) {
    const k = waveNumber(wave.wavelength);
    const omega = waveAngularFrequency(k);
    const dirX = Math.cos(wave.direction);
    const dirZ = Math.sin(wave.direction);
    const phase = k * (dirX * x + dirZ * z) - omega * time + wave.phase;
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);
    const Qi = wave.steepness / (k * wave.amplitude * waves.length || 1);
    const Q = Number.isFinite(Qi) ? Qi : 0;

    height += wave.amplitude * sinP;
    dx += Q * wave.amplitude * dirX * cosP;
    dz += Q * wave.amplitude * dirZ * cosP;

    // Partial derivatives for normal (approximate from vertical + horizontal stretch)
    nx += dirX * k * wave.amplitude * cosP;
    nz += dirZ * k * wave.amplitude * cosP;
  }

  const ny = 1;
  const len = Math.hypot(nx, ny, nz) || 1;

  return {
    height,
    dx,
    dz,
    normalX: -nx / len,
    normalY: ny / len,
    normalZ: -nz / len,
  };
}

/** Heave / pitch / roll from nearby samples — suitable for ship orientation. */
export function sampleAttitude(
  x: number,
  z: number,
  time: number,
  waves: readonly WaveComponent[],
  heading: number,
  sampleSpan = 4,
): { heave: number; pitch: number; roll: number } {
  const center = sampleGerstner(x, z, time, waves);
  const forwardX = Math.cos(heading);
  const forwardZ = Math.sin(heading);
  const rightX = -forwardZ;
  const rightZ = forwardX;

  const bow = sampleGerstner(x + forwardX * sampleSpan, z + forwardZ * sampleSpan, time, waves);
  const stern = sampleGerstner(x - forwardX * sampleSpan, z - forwardZ * sampleSpan, time, waves);
  const port = sampleGerstner(x + rightX * sampleSpan * 0.6, z + rightZ * sampleSpan * 0.6, time, waves);
  const starboard = sampleGerstner(
    x - rightX * sampleSpan * 0.6,
    z - rightZ * sampleSpan * 0.6,
    time,
    waves,
  );

  const pitch = Math.atan2(bow.height - stern.height, sampleSpan * 2);
  const roll = Math.atan2(starboard.height - port.height, sampleSpan * 1.2);

  return {
    heave: center.height,
    pitch,
    roll,
  };
}

export function seaStateLabel(seaState: number): string {
  if (seaState < 0.15) return '0 CALM';
  if (seaState < 0.3) return '1 LIGHT';
  if (seaState < 0.45) return '2 MODERATE';
  if (seaState < 0.6) return '3 FRESH';
  if (seaState < 0.75) return '4 STRONG';
  if (seaState < 0.9) return '5 ROUGH';
  return '6 HIGH';
}
