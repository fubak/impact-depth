import { expect, it } from 'vitest';
import { findPath, makeClear } from '../../src/game/sim/pathfinding';
import { createTerrain } from '../../src/game/sim/world';

it('finds deterministic, navigable paths within a bounded search', () => {
  const clear = makeClear(createTerrain(73), 0.65);
  const start = { x: 12, y: 22 };
  const goal = { x: 81, y: 68 };
  const first = findPath(start, goal, clear, 900);
  const second = findPath(start, goal, clear, 900);
  expect(first).toEqual(second);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(201);
  expect(first.every((point) => clear(point.x, point.y))).toBe(true);
});
