import { describe, expect, it } from 'vitest';
import { fleetClassScale, simKindToAssetEntity } from '../../src/render/assets';
import type { ShipKind } from '../../src/game/sim/types';

describe('asset kind mapping', () => {
  it('maps every sim ship kind onto a registry entity', () => {
    const table: Record<ShipKind, string> = {
      merchant: 'freighter',
      patrol: 'patrol',
      destroyer: 'destroyer',
      cruiser: 'cruiser',
      battleship: 'battleship',
      sub: 'uboat',
    };
    for (const [sim, asset] of Object.entries(table) as [ShipKind, string][]) {
      expect(simKindToAssetEntity(sim)).toBe(asset);
    }
  });

  it('maps look-dev uboat kind to the Akula registry entity', () => {
    expect(simKindToAssetEntity('uboat')).toBe('uboat');
  });

  it('keeps residual class scales slight now that meshes are class-specific', () => {
    expect(fleetClassScale('destroyer')).toBe(1);
    expect(fleetClassScale('patrol')).toBeLessThan(1);
    expect(fleetClassScale('battleship')).toBeGreaterThan(1);
    expect(fleetClassScale('cruiser')).toBeGreaterThan(1);
    expect(fleetClassScale('uboat')).toBe(fleetClassScale('sub'));
  });
});
