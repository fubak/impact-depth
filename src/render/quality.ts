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

/** Ignore hitchy HDR / FFT settle before auto-quality may drop. */
export const QUALITY_BOOT_GRACE = 8;
/** After a quality change, wait before another swap (FFT rebuild is a blink). */
export const QUALITY_CHANGE_COOLDOWN = 10;
export const QUALITY_SLOW_MS = 28;
export const QUALITY_CRITICAL_MS = 40;
export const QUALITY_FAST_MS = 15;
export const QUALITY_DOWNGRADE_AFTER = 3;
export const QUALITY_CRITICAL_AFTER = 5;
export const QUALITY_UPGRADE_AFTER = 8;

/** Hysteresis prevents an unstable device from toggling visual quality every frame. */
export class QualityGovernor {
  current: QualityName;
  readonly locked: boolean;
  private slowFor = 0;
  private criticalFor = 0;
  private fastFor = 0;
  private bootFor = 0;
  private cooldown = 0;

  constructor(opts?: { initial?: QualityName; locked?: boolean }) {
    this.current = opts?.initial ?? 'high';
    this.locked = opts?.locked ?? false;
  }

  update(frameMs: number, dt: number): QualityName {
    if (this.locked) return this.current;
    const step = Math.max(0, dt);
    if (this.bootFor < QUALITY_BOOT_GRACE) {
      this.bootFor += step;
      return this.current;
    }
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - step);
      return this.current;
    }
    this.slowFor = frameMs > QUALITY_SLOW_MS ? this.slowFor + step : Math.max(0, this.slowFor - step * 0.5);
    this.criticalFor =
      frameMs > QUALITY_CRITICAL_MS ? this.criticalFor + step : Math.max(0, this.criticalFor - step * 0.5);
    this.fastFor = frameMs < QUALITY_FAST_MS ? this.fastFor + step : Math.max(0, this.fastFor - step * 0.5);
    if (this.slowFor > QUALITY_DOWNGRADE_AFTER && this.current === 'high') {
      this.current = 'medium';
      this.slowFor = 0;
      this.criticalFor = 0;
      this.fastFor = 0;
      this.cooldown = QUALITY_CHANGE_COOLDOWN;
    } else if (this.criticalFor > QUALITY_CRITICAL_AFTER && this.current === 'medium') {
      this.current = 'low';
      this.slowFor = 0;
      this.criticalFor = 0;
      this.fastFor = 0;
      this.cooldown = QUALITY_CHANGE_COOLDOWN;
    } else if (this.fastFor > QUALITY_UPGRADE_AFTER && this.current !== 'high') {
      this.current = this.current === 'low' ? 'medium' : 'high';
      this.slowFor = 0;
      this.criticalFor = 0;
      this.fastFor = 0;
      this.cooldown = QUALITY_CHANGE_COOLDOWN;
    }
    return this.current;
  }
}
