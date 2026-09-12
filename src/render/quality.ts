export type QualityName = 'high' | 'medium' | 'low';

export type SpectralFftSize = {
  swell: number;
  wind: number;
  chop: number;
};

export type SpectralCadence = {
  swell: number;
  wind: number;
  chop: number;
};

export type QualityProfile = {
  name: QualityName;
  dpr: number;
  waterSegments: number;
  shadows: boolean;
  shadowCadence: number;
  particleCap: number;
  vegetationDensity: number;
  vegetationLodDistance: number;
  vegetationShadows: boolean;
  opticsScale: number;
  opticsCadence: number;
  foamScale: number;
  foamCadence: number;
  causticsScale: number;
  causticsCadence: number;
  /** Cascade FFT sizes from `fftSizeForQuality` (spectrum.ts). */
  spectralFftSize: SpectralFftSize;
  /** Number of presentation frames between cascade updates. */
  spectralCadence: SpectralCadence;
};

export const QUALITY_PROFILES: Record<QualityName, QualityProfile> = {
  high: {
    name: 'high',
    dpr: 1.75,
    waterSegments: 200,
    shadows: true,
    shadowCadence: 1,
    particleCap: 120,
    vegetationDensity: 1,
    vegetationLodDistance: 340,
    vegetationShadows: true,
    opticsScale: 0.65,
    opticsCadence: 2,
    foamScale: 1,
    foamCadence: 1,
    causticsScale: 1,
    causticsCadence: 1,
    spectralFftSize: { swell: 128, wind: 256, chop: 128 },
    spectralCadence: { swell: 2, wind: 1, chop: 1 },
  },
  medium: {
    name: 'medium',
    dpr: 1.25,
    waterSegments: 128,
    shadows: true,
    shadowCadence: 2,
    particleCap: 72,
    vegetationDensity: 0.7,
    vegetationLodDistance: 260,
    vegetationShadows: true,
    opticsScale: 0.45,
    opticsCadence: 3,
    foamScale: 0.7,
    foamCadence: 2,
    causticsScale: 0.65,
    causticsCadence: 2,
    spectralFftSize: { swell: 128, wind: 128, chop: 128 },
    spectralCadence: { swell: 3, wind: 1, chop: 2 },
  },
  low: {
    name: 'low',
    dpr: 1,
    waterSegments: 72,
    shadows: false,
    shadowCadence: 4,
    particleCap: 36,
    vegetationDensity: 0.4,
    vegetationLodDistance: 180,
    vegetationShadows: false,
    opticsScale: 0.3,
    opticsCadence: 4,
    foamScale: 0.45,
    foamCadence: 3,
    causticsScale: 0.4,
    causticsCadence: 4,
    spectralFftSize: { swell: 64, wind: 64, chop: 64 },
    spectralCadence: { swell: 4, wind: 2, chop: 2 },
  },
};

/** Hysteresis prevents an unstable device from toggling visual quality every frame. */
export class QualityGovernor {
  current: QualityName;
  readonly locked: boolean;
  private slowFor = 0;
  private fastFor = 0;

  constructor(opts?: { initial?: QualityName; locked?: boolean }) {
    this.current = opts?.initial ?? 'high';
    this.locked = opts?.locked ?? false;
  }

  update(frameMs: number, dt: number): QualityName {
    if (this.locked) return this.current;
    this.slowFor = frameMs > 24 ? this.slowFor + dt : Math.max(0, this.slowFor - dt * 0.5);
    this.fastFor = frameMs < 15 ? this.fastFor + dt : Math.max(0, this.fastFor - dt * 0.5);
    if (this.slowFor > 3 && this.current !== 'low') {
      this.current = this.current === 'high' ? 'medium' : 'low';
      this.slowFor = 0;
    } else if (this.fastFor > 8 && this.current !== 'high') {
      this.current = this.current === 'low' ? 'medium' : 'high';
      this.fastFor = 0;
    }
    return this.current;
  }
}
