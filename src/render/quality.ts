export type QualityName = 'high' | 'medium' | 'low';

export type QualityProfile = {
  name: QualityName;
  dpr: number;
  waterSegments: number;
  shadows: boolean;
  particleCap: number;
};

export const QUALITY_PROFILES: Record<QualityName, QualityProfile> = {
  high: { name: 'high', dpr: 1.75, waterSegments: 200, shadows: true, particleCap: 120 },
  medium: { name: 'medium', dpr: 1.25, waterSegments: 128, shadows: true, particleCap: 72 },
  low: { name: 'low', dpr: 1, waterSegments: 72, shadows: false, particleCap: 36 },
};

/** Hysteresis prevents an unstable device from toggling visual quality every frame. */
export class QualityGovernor {
  current: QualityName = 'high';
  private slowFor = 0;
  private fastFor = 0;

  update(frameMs: number, dt: number): QualityName {
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
