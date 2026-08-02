import { expect, it, vi } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import { stepGame } from '../../src/game/sim/step';
import { SYSTEM_ORDER, systems } from '../../src/game/sim/systems';

it('runs systems in the specified order', () => {
  const calls: string[] = [];
  const spies = SYSTEM_ORDER.map((name) => vi.spyOn(systems, name).mockImplementation((state) => { calls.push(name); return state; }));
  stepGame(startMission(createGame()), [], 1 / 60);
  expect(calls).toEqual([...SYSTEM_ORDER]);
  spies.forEach((spy) => spy.mockRestore());
});
