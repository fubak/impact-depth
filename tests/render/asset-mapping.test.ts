import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  chooseAssetSource,
  fleetClassScale,
  prefersAuthoredGltf,
  simKindToAssetEntity,
  AssetRegistry,
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

describe('asset registry preload with stub loader', () => {
  let requestedUrls: string[];

  beforeEach(() => {
    requestedUrls = [];
    // Mock the global fetch to return a manifest with all 11 entity kinds
    globalThis.fetch = vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('manifest.json')) {
        const manifest = {
          version: 1,
          licenseLedger: [],
          entities: {
            sub_nautilus: { gltf: 'models/sub_nautilus.glb', fallback: 'sub_nautilus' },
            patrol: { gltf: 'models/patrol.glb', fallback: 'patrol' },
            destroyer: { gltf: 'models/destroyer.glb', fallback: 'destroyer' },
            freighter: { gltf: 'models/freighter.glb', fallback: 'freighter' },
            cruiser: { gltf: 'models/cruiser.glb', fallback: 'cruiser' },
            battleship: { gltf: 'models/battleship.glb', fallback: 'battleship' },
            uboat: { gltf: 'models/uboat.glb', fallback: 'uboat' },
            aircraft: { gltf: 'models/aircraft.glb', fallback: 'aircraft' },
            fob_argus: { gltf: 'models/fob_argus.glb', fallback: 'fob_argus' },
            torpedo: { gltf: 'models/torpedo.glb', fallback: 'torpedo' },
            crate: { gltf: 'models/crate.glb', fallback: 'crate' },
          },
          textures: { hullMetal: 'metal.jpg', seabedSand: 'sand.jpg' },
        };
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
  });

  it('only requests GLB URLs for authored kinds: sub_nautilus, uboat, destroyer', async () => {
    const registry = new AssetRegistry();
    // Replace the private loader with a spy that tracks requests
    (registry as any).loader = {
      loadAsync: vi.fn(async (url: string) => {
        requestedUrls.push(url);
        // Return a minimal GLTF scene
        return {
          scene: new THREE.Group(),
          scenes: [],
          cameras: [],
          animations: [],
          asset: {},
          parser: {},
          userData: {},
        };
      }),
    };

    await registry.preload();
    await registry.whenReady;

    // Extract the filenames from requested URLs
    const requestedFileNames = requestedUrls
      .map((url) => url.split('/').pop())
      .sort();

    // Only the three authored kinds should be requested
    expect(requestedFileNames).toEqual([
      'destroyer.glb',
      'sub_nautilus.glb',
      'uboat.glb',
    ]);

    // Verify that non-authored kinds are not loaded
    const report = registry.getLoadReport();
    expect(report.sub_nautilus).toBe('gltf');
    expect(report.uboat).toBe('gltf');
    expect(report.destroyer).toBe('gltf');
    expect(report.freighter).toBe('missing');
    expect(report.cruiser).toBe('missing');
    expect(report.battleship).toBe('missing');
    expect(report.patrol).toBe('missing');
    expect(report.aircraft).toBe('missing');
    expect(report.fob_argus).toBe('missing');
    expect(report.torpedo).toBe('missing');
    expect(report.crate).toBe('missing');
  });
});
