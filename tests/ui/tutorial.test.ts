import { describe, expect, it } from 'vitest';
// @ts-expect-error node builtins are outside the game tsconfig (types: vite/client)
import { readFileSync } from 'node:fs';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, setPhase, startMission, updateGame } from '../../src/game/sim/api';
import type { GameState } from '../../src/game/sim/types';
import {
  TutorialOverlay,
  dodgeLessonDone,
  fireLessonDone,
  fullTourStepCount,
  patrolClockRuns,
  phaseWhileTutorial,
  quickStartStepCount,
  steerLessonDone,
  steerLessonMark,
  threateningHedgehogPattern,
} from '../../src/ui/tutorial';

function stepTotal(html: string): number | null {
  const match = html.match(/(\d+)\s*\/\s*(\d+)/);
  return match ? Number(match[2]) : null;
}

function mount() {
  let html = '';
  let hidden = true;
  let onClick: ((event: MouseEvent) => void) | undefined;
  const keys: Array<(event: KeyboardEvent) => void> = [];
  const hadWindow = 'window' in globalThis;
  const priorWindow = globalThis.window;
  globalThis.window = {
    addEventListener(_type: string, fn: (event: KeyboardEvent) => void) {
      keys.push(fn);
    },
    removeEventListener() {},
  } as unknown as Window & typeof globalThis;
  const el = {
    get hidden() {
      return hidden;
    },
    set hidden(value: boolean) {
      hidden = value;
    },
    get innerHTML() {
      return html;
    },
    set innerHTML(value: string) {
      html = value;
    },
    addEventListener(type: string, fn: (event: MouseEvent) => void) {
      if (type === 'click') onClick = fn;
    },
  } as unknown as HTMLElement;
  return {
    el,
    html: () => html,
    get hidden() {
      return hidden;
    },
    click(action: string) {
      const target = {
        closest: (selector: string) =>
          selector === '[data-tutorial-action]' ? { dataset: { tutorialAction: action } } : null,
      };
      onClick?.({ target } as unknown as MouseEvent);
    },
    escape() {
      const event = { code: 'Escape', preventDefault() {} } as unknown as KeyboardEvent;
      for (const fn of keys) fn(event);
    },
    restore() {
      if (hadWindow) globalThis.window = priorWindow;
      else delete (globalThis as { window?: Window }).window;
    },
  };
}

/** Same pause transition the frame loop applies when the overlay opens or closes. */
function applyTutorialPause(
  game: GameState,
  open: boolean,
  held: boolean,
  exerciseLive = false,
): {
  game: GameState;
  held: boolean;
} {
  const next = phaseWhileTutorial(game.phase, open, held, exerciseLive);
  return { game: setPhase(game, next.phase), held: next.heldByTutorial };
}

describe('tutorial quick start (A3)', () => {
  it('opens four cards and keeps skip and Escape', () => {
    expect(quickStartStepCount()).toBeLessThanOrEqual(4);
    expect(quickStartStepCount()).toBe(4);
    const root = mount();
    const overlay = new TutorialOverlay(root.el);
    overlay.show();
    expect(root.html()).toContain('data-tutorial-action="skip"');
    expect(root.html()).toContain('tutorial-quick');
    expect(stepTotal(root.html())).toBe(quickStartStepCount());
    expect(root.html()).toContain('Steer');
    root.click('next');
    expect(root.html()).toContain('Depth & stealth');
    root.click('next');
    expect(root.html()).toContain('Fire');
    root.click('next');
    expect(root.html()).toContain('Survive');
    expect(root.html()).toContain('>Finish<');
    expect(stepTotal(root.html())).toBe(4);
    root.escape();
    expect(overlay.isOpen()).toBe(false);
    expect(root.hidden).toBe(true);
    root.restore();
  });

  it('opens the 11-step tour from Help and still skips', () => {
    expect(fullTourStepCount()).toBe(11);
    const root = mount();
    const overlay = new TutorialOverlay(root.el);
    overlay.show(true);
    expect(stepTotal(root.html())).toBe(11);
    expect(root.html()).toContain('Welcome aboard, Captain');
    expect(root.html()).toContain('data-tutorial-action="skip"');
    root.click('skip');
    expect(overlay.isOpen()).toBe(false);
    expect(root.hidden).toBe(true);
    root.restore();
  });

  it('runs the clock on an exercise and pauses it on an explain card', () => {
    let game = startMission(createGame(3));
    const before = game.time;
    let held = false;
    const root = mount();
    const overlay = new TutorialOverlay(root.el, (open) => {
      const paused = applyTutorialPause(game, open, held, overlay.exerciseLive());
      game = paused.game;
      held = paused.held;
    });
    overlay.show();
    expect(overlay.currentExercise()).toBe('steer');
    if (patrolClockRuns(game.phase, overlay.isOpen(), overlay.exerciseLive())) {
      game = updateGame(game, [], FIXED_DT);
    }
    expect(game.phase).toBe('playing');
    expect(game.time).toBeCloseTo(before + FIXED_DT);

    root.click('next');
    const explained = applyTutorialPause(game, overlay.isOpen(), held, overlay.exerciseLive());
    game = explained.game;
    held = explained.held;
    const atExplain = game.time;
    if (patrolClockRuns(game.phase, overlay.isOpen(), overlay.exerciseLive())) {
      game = updateGame(game, [], FIXED_DT);
    }
    expect(overlay.currentExercise()).toBeNull();
    expect(game.phase).toBe('paused');
    expect(game.time).toBe(atExplain);

    root.click('skip');
    expect(overlay.isOpen()).toBe(false);
    const resumed = applyTutorialPause(game, false, held, false);
    game = resumed.game;
    expect(patrolClockRuns(game.phase, overlay.isOpen(), false)).toBe(true);
    root.restore();
  });

  it('does not let Next satisfy an exercise until the action is done', () => {
    const root = mount();
    const overlay = new TutorialOverlay(root.el);
    overlay.mayAdvance = () => false;
    overlay.show();
    expect(root.html()).toContain('disabled');
    root.click('next');
    expect(root.html()).toContain('Steer');
    expect(overlay.currentExercise()).toBe('steer');
    root.restore();
  });

  it('leaves a player pause in place when the tour closes', () => {
    const opened = phaseWhileTutorial('paused', true, false);
    expect(opened).toEqual({ phase: 'paused', heldByTutorial: false });
    expect(phaseWhileTutorial(opened.phase, false, opened.heldByTutorial).phase).toBe('paused');
  });

  it('wires the pause gate and threat layer into the frame loop', () => {
    const source = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    expect(source).toContain('this.tutorial.exerciseLive()');
    expect(source).toContain('phaseWhileTutorial(');
    expect(source).toContain(
      'if (this.tutorial.isOpen() && !this.tutorial.exerciseLive()) return;',
    );
    expect(source).toContain('new ThreatIndicatorLayer');
    expect(source).toContain('behind');
  });

  it('requires a real steer, a launched torpedo, and a turn out of the hedgehog lane', () => {
    const mark = steerLessonMark(0, 0, 0);
    expect(steerLessonDone(mark.x, mark.y, mark)).toBe(true);
    expect(steerLessonDone(0, 0, mark)).toBe(false);
    expect(fireLessonDone(2, 2)).toBe(false);
    expect(fireLessonDone(2, 3)).toBe(true);
    expect(dodgeLessonDone(3, 100, 100)).toBe(true);
    expect(dodgeLessonDone(3, 100, 80)).toBe(false);
    expect(dodgeLessonDone(1, 100, 100)).toBe(false);
    const pattern = threateningHedgehogPattern(0, 0, 0);
    expect(pattern).toHaveLength(5);
    const impact = { x: 5, y: 0 };
    expect(
      pattern.some(
        (charge) => Math.hypot(charge.x - impact.x, charge.y - impact.y) <= charge.radius,
      ),
    ).toBe(true);
    const escaped = { x: 5, y: 6 };
    expect(
      pattern.every(
        (charge) => Math.hypot(charge.x - escaped.x, charge.y - escaped.y) > charge.radius,
      ),
    ).toBe(true);
  });
});
