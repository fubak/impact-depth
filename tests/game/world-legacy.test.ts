import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { createTerrain, isLand } from '../../src/game/sim/world';
import { resolveWorldVersion } from '../../src/game/world/definition';
import { createLegacyWorld, legacyLandMask } from '../../src/game/world/legacy';
import { getWorld } from '../../src/game/world/queries';
import { canonicalSnapshot } from '../../src/game/replay';

describe('legacy-v1 world wrapper', () => {
  it('normalizes missing and unknown versions to legacy-v1', () => {
    expect(resolveWorldVersion(undefined)).toBe('legacy-v1');
    expect(resolveWorldVersion(null)).toBe('legacy-v1');
    expect(resolveWorldVersion('nope')).toBe('legacy-v1');
    expect(resolveWorldVersion('littoral-v2')).toBe('littoral-v2');
    expect(getWorld('legacy-v1', 19).version).toBe('legacy-v1');
  });

  it('keeps littoral-v2 on its own cache key without replacing legacy generation', () => {
    const v1 = getWorld('legacy-v1', 19);
    const v2 = getWorld('littoral-v2', 19);
    expect(v1.version).toBe('legacy-v1');
    expect(v2.version).toBe('littoral-v2');
    expect(v2).not.toBe(v1);
    expect(v1.bedNormalized).toEqual(createTerrain(19).heights);
  });

  it('matches createTerrain heights and land masks for seeds 19 and 77', () => {
    for (const seed of [19, 77]) {
      const world = createLegacyWorld(seed);
      const terrain = createTerrain(seed);
      expect(world.bedNormalized).toEqual(terrain.heights);
      const mask = legacyLandMask(world);
      const expected: number[] = [];
      for (let y = 0; y < terrain.size; y++) {
        for (let x = 0; x < terrain.size; x++) {
          expected.push(isLand(terrain, x + 0.5, y + 0.5) ? 1 : 0);
        }
      }
      expect(mask).toEqual(expected);
      expect(world.bedNormalized.length).toBe(terrain.size * terrain.size);
    }
  });

  it('keeps 10000-tick command outcomes identical aside from explicit worldVersion metadata', () => {
    const run = (seed: number) => {
      let state = startMission(createGame(seed));
      for (let tick = 0; tick < 10_000; tick++) {
        const commands =
          tick % 180 === 0
            ? [{ type: 'helm' as const, surge: 1, yaw: tick % 360 ? 0 : 1, depth: 0 }]
            : [];
        state = updateGame(state, commands, 1 / 60);
      }
      return state;
    };
    const a = run(19);
    const b = run(19);
    expect(a.worldVersion).toBe('legacy-v1');
    expect(canonicalSnapshot(a)).toBe(canonicalSnapshot(b));
    const parsed = JSON.parse(canonicalSnapshot(a)) as { worldVersion: string; seed: number };
    expect(parsed.worldVersion).toBe('legacy-v1');
    expect(parsed.seed).toBe(19);
  }, 30_000);
});
