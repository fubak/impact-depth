import { expect, it } from 'vitest';
import { findPath, makeClear, resolveClearStep } from '../../src/game/sim/pathfinding';
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

it('picks a land-avoidance step aligned with heading instead of the first ring cell', () => {
  const blocked = new Set(['11,10']);
  const clear = (x: number, y: number) => !blocked.has(`${Math.round(x)},${Math.round(y)}`);
  const clampPos = (x: number, y: number) => ({ x, y });
  const stepped = resolveClearStep(10, 10, 0, 11, 10, clear, clampPos);
  expect(clear(stepped.x, stepped.y)).toBe(true);
  expect(stepped.x - 10).toBeGreaterThan(0);
  expect(Math.abs(stepped.heading)).toBeLessThan(Math.PI / 2);
});
