import { describe, expect, it } from 'vitest';
// @ts-expect-error node builtins are outside the game tsconfig (types: vite/client)
import { readFileSync } from 'node:fs';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, setPhase, startMission, updateGame } from '../../src/game/sim/api';
import type { GameState } from '../../src/game/sim/types';
import {
  TutorialOverlay,
  fullTourStepCount,
  patrolClockRuns,
  phaseWhileTutorial,
  quickStartStepCount,
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
): {
  game: GameState;
  held: boolean;
} {
  const next = phaseWhileTutorial(game.phase, open, held);
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

  it('does not advance game.time while the tutorial is open', () => {
    let game = startMission(createGame(3));
    const before = game.time;
    let held = false;
    const root = mount();
    const overlay = new TutorialOverlay(root.el, (open) => {
      const paused = applyTutorialPause(game, open, held);
      game = paused.game;
      held = paused.held;
    });
    overlay.show();
    if (patrolClockRuns(game.phase, overlay.isOpen())) game = updateGame(game, [], FIXED_DT);
    expect(overlay.isOpen()).toBe(true);
    expect(game.time).toBe(before);
    expect(game.phase).toBe('paused');

    root.click('skip');
    expect(overlay.isOpen()).toBe(false);
    expect(patrolClockRuns(game.phase, overlay.isOpen())).toBe(true);
    game = updateGame(game, [], FIXED_DT);
    expect(game.time).toBeCloseTo(before + FIXED_DT);
    root.restore();
  });

  it('leaves a player pause in place when the tour closes', () => {
    const opened = phaseWhileTutorial('paused', true, false);
    expect(opened).toEqual({ phase: 'paused', heldByTutorial: false });
    expect(phaseWhileTutorial(opened.phase, false, opened.heldByTutorial).phase).toBe('paused');
  });

  it('wires the pause gate and threat layer into the frame loop', () => {
    const source = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    expect(source).toContain('patrolClockRuns(this.game.phase, this.tutorial.isOpen())');
    expect(source).toContain('phaseWhileTutorial(this.game.phase, open, this.tutorialHeldPause)');
    expect(source).toContain('if (this.tutorial.isOpen()) return;');
    expect(source).toContain('new ThreatIndicatorLayer');
    expect(source).toContain('behind');
  });
});
