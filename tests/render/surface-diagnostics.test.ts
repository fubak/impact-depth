import { describe, expect, it } from 'vitest';
import { formatSurfaceDiagnostics } from '../../src/render/presentation/surface-diagnostics';

describe('surface diagnostics copy', () => {
  it('stays off the player HUD and names probe generation, age, and draft', () => {
    const line = formatSurfaceDiagnostics({
      surfaceHeight: 0.42,
      hullDraft: 1.1,
      requestedX: 12,
      requestedZ: -4,
      resolvedX: 11.8,
      resolvedZ: -3.9,
      source: 'probe',
      missionGeneration: 3,
      backendGeneration: 2,
      probeAge: 0.08,
      readbackCount: 14,
      cadenceHz: 10,
    });
    expect(line).toMatch(/probe/i);
    expect(line).toMatch(/gen 3\/2/);
    expect(line).toMatch(/0\.08s/);
    expect(line).toMatch(/10 Hz/);
    expect(line).not.toMatch(/ORDERS|PERISCOPE|FIRE/);
  });
});
