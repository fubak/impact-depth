export type QualityName = 'high' | 'medium' | 'low';

export type SpectralFftSize = {
  swell: number;
  wind: number;
  chop: number;
};

export type QualityProfile = {
  name: QualityName;
  dpr: number;
  waterSegments: number;
  shadows: boolean;
  particleCap: number;
  /** Cascade FFT sizes from `fftSizeForQuality` (spectrum.ts). */
  spectralFftSize: SpectralFftSize;
};

export const QUALITY_PROFILES: Record<QualityName, QualityProfile> = {
  high: {
    name: 'high',
    dpr: 1.75,
    waterSegments: 200,
    shadows: true,
    particleCap: 120,
    spectralFftSize: { swell: 128, wind: 256, chop: 128 },
  },
  medium: {
    name: 'medium',
    dpr: 1.25,
    waterSegments: 128,
    shadows: true,
    particleCap: 72,
    spectralFftSize: { swell: 128, wind: 128, chop: 128 },
  },
  low: {
    name: 'low',
    dpr: 1,
    waterSegments: 72,
    shadows: false,
    particleCap: 36,
    spectralFftSize: { swell: 64, wind: 64, chop: 64 },
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
