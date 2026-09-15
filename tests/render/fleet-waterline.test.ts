import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { analyzeHullWaterline, fitPresentationHull } from '../../src/render/hull-fit';
import {
  createAircraft,
  createBattleship,
  createCruiser,
  createDestroyer,
  createMerchant,
  createPatrolBoat,
  createSubmarine,
  createUboat,
} from '../../src/render/vessels';

function countTris(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.geometry) return;
    const index = object.geometry.index;
    const pos = object.geometry.getAttribute('position');
    tris += index ? index.count / 3 : pos.count / 3;
  });
  return Math.floor(tris);
}

const fleet = [
  { kind: 'freighter', build: createMerchant, minTris: 600 },
  { kind: 'patrol', build: createPatrolBoat, minTris: 450 },
  { kind: 'cruiser', build: createCruiser, minTris: 700 },
  { kind: 'battleship', build: createBattleship, minTris: 900 },
  { kind: 'destroyer', build: createDestroyer, minTris: 650 },
  { kind: 'sub_nautilus', build: createSubmarine, minTris: 2200 },
  { kind: 'uboat', build: createUboat, minTris: 2200 },
  { kind: 'aircraft', build: createAircraft, minTris: 400 },
] as const;

describe('per-class hull waterline', () => {
  it.each(fleet)('$kind sits on the water with superstructure dry', ({ kind, build }) => {
    const root = build();
    fitPresentationHull(root, kind);
    const { height, hullBodyHeight, draft } = analyzeHullWaterline(root);
    expect(height).toBeGreaterThan(1);
    expect(draft).toBeGreaterThan(0.2);
    expect(draft / height).toBeLessThan(0.22);
    if (kind !== 'aircraft' && kind !== 'sub_nautilus' && kind !== 'uboat') {
      expect(hullBodyHeight).toBeGreaterThan(0.5);
      expect(draft).toBeLessThan(hullBodyHeight * 0.45);
    }
  });
});

describe('procedural fleet density', () => {
  it.each(fleet)(
    '$kind has a denser hull than the old box/low-seg fallback',
    ({ build, minTris }) => {
      const root = build();
      expect(countTris(root)).toBeGreaterThanOrEqual(minTris);
    },
  );
});
