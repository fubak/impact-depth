import { describe, expect, it } from 'vitest';
import {
  chooseAssetSource,
  fleetClassScale,
  prefersAuthoredGltf,
  simKindToAssetEntity,
} from '../../src/render/assets';
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

  it('does not flash a procedural hull while GLBs are still loading', () => {
    expect(chooseAssetSource({ hasGltf: false, registryReady: false })).toBe('pending');
    expect(chooseAssetSource({ hasGltf: true, registryReady: false })).toBe('gltf');
    expect(chooseAssetSource({ hasGltf: false, registryReady: true })).toBe('procedural');
  });

  it('keeps Kenney kit classes on authored procedural hulls', () => {
    expect(prefersAuthoredGltf('sub_nautilus')).toBe(true);
    expect(prefersAuthoredGltf('destroyer')).toBe(true);
    expect(prefersAuthoredGltf('freighter')).toBe(false);
    expect(prefersAuthoredGltf('battleship')).toBe(false);
    expect(prefersAuthoredGltf('aircraft')).toBe(false);
    expect(chooseAssetSource({ hasGltf: true, registryReady: true, preferGltf: false })).toBe(
      'procedural',
    );
  });

  it('keeps residual class scales slight now that meshes are class-specific', () => {
    expect(fleetClassScale('destroyer')).toBe(1);
    expect(fleetClassScale('patrol')).toBeLessThan(1);
    expect(fleetClassScale('battleship')).toBeGreaterThan(1);
    expect(fleetClassScale('cruiser')).toBeGreaterThan(1);
    expect(fleetClassScale('uboat')).toBe(fleetClassScale('sub'));
  });
});
