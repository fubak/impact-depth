import '../styles/tutorial.css';
import type { GamePhase } from '../game/sim/types';

type Anchor =
  'center' | 'status' | 'depth' | 'tactics' | 'magazine' | 'minimap' | 'contacts' | 'canvas';
type Mode = 'quick' | 'tour';

/** Bumped so players who finished the old Next-only tour see the exercises once. */
export const TUTORIAL_STORAGE_KEY = 'silent-depths-tutorial-v2';

export type TutorialExercise = 'steer' | 'fire' | 'dodge';

type Step = {
  title: string;
  body: string;
  tip: string;
  anchor: Anchor;
  /** Live exercise. The sim runs and Next stays locked until the action lands. */
  exercise?: TutorialExercise;
};

const QUICK_START: readonly Step[] = [
  {
    title: 'Steer',
    body: 'A gold mark is off the bow. Turn with A and D and drive into it. Next stays locked until you arrive. The clock runs on this exercise.',
    tip: 'Drag the tactical view and use the wheel to zoom.',
    anchor: 'canvas',
    exercise: 'steer',
  },
  {
    title: 'Depth & stealth',
    body: 'Surface is fast and exposed. Periscope depth lets you see. Deep plus Quiet hides you from hydrophones. Battery drains underwater. This card pauses the clock.',
    tip: 'One-third plus Quiet is a reliable transit. Snorkel charges but exposes you.',
    anchor: 'depth',
  },
  {
    title: 'Fire',
    body: 'From attack depth, fire an Mk-14 at the selected merchant. Next stays locked until a torpedo leaves the tube. The clock runs.',
    tip: 'Tubes launch within 60° of the bow. Ping tells escorts where you are.',
    anchor: 'magazine',
    exercise: 'fire',
  },
  {
    title: 'Survive',
    body: 'Hedgehogs are falling on your present course. Turn out of that lane before they arrive. A hit resets the exercise. The clock runs.',
    tip: 'The full tour stays on Help. Stay quiet, shoot from the beam, and get home.',
    anchor: 'center',
    exercise: 'dodge',
  },
];

export const FULL_TOUR: readonly Step[] = [
  {
    title: 'Welcome aboard, Captain',
    body: 'This tour covers helm, stealth, weapons, and the combat AI. Reopen Help from the HUD whenever you need it.',
    tip: 'Dark blue is deep water. Land is impassable.',
    anchor: 'center',
  },
  {
    title: 'Plot a course',
    body: 'Click open water or the tactical plot to set a waypoint. The boat navigates around shoals. Right-click fires at the selected target.',
    tip: 'Drag the tactical view and use the wheel to zoom.',
    anchor: 'canvas',
  },
  {
    title: 'Hull, battery & noise',
    body: 'Hull is life. Battery drains underwater. Noise is what enemy hydrophones hear.',
    tip: 'The layer badge shows your side of the thermocline.',
    anchor: 'status',
  },
  {
    title: 'Depth & speed',
    body: 'Surface is fast but exposed. Periscope depth enables visual attacks. Deep is quieter and safer but slower.',
    tip: 'One-third plus Quiet is a reliable transit profile.',
    anchor: 'depth',
  },
  {
    title: 'Stealth tactics',
    body: 'Quiet lowers noise. Scope is risky but useful at periscope depth. Snorkel charges batteries but exposes you.',
    tip: 'Ambush, Stalk, Intercept, Evade and Home can take the helm. Open Doctrine if those buttons are hidden.',
    anchor: 'tactics',
  },
  {
    title: 'Ambush doctrine',
    body: 'Ambush approaches quietly on a target beam, rises for the shot, fires a spread, and breaks deep.',
    tip: 'Stalk trails, Intercept closes, Evade disengages, and Home docks at FOB Argus.',
    anchor: 'tactics',
  },
  {
    title: 'Magazine & sonar',
    body: 'Mk-14s are straight runners. Mk-18s seek. Decoy and Bubble screen defeat threats. Ping improves contacts but reveals you.',
    tip: 'Primary row is always Fire + tubes. Gear folds decoys, bubbles, spread, and ping.',
    anchor: 'magazine',
  },
  {
    title: 'Hydrophone picture',
    body: 'Passive contacts give bearing and approximate range. Active returns are sharper, but escorts hear your ping.',
    tip: 'Select a contact to aim manual fire or give AI a target.',
    anchor: 'contacts',
  },
  {
    title: 'Minimap & FOB',
    body: 'The tactical plot shows contacts, crates, land, and FOB Argus. Dock inside its cyan ring to repair and restock safely.',
    tip: 'Legend under the plot: you, contacts, FOB, crates, land, waypoint.',
    anchor: 'minimap',
  },
  {
    title: 'What hunts you',
    body: 'Destroyers use Hedgehog, capital ships depth charge, enemy submarines torpedo, and aircraft punish shallow noise.',
    tip: 'Go quiet and deep below the layer; bubbles, then Home if flooding.',
    anchor: 'center',
  },
  {
    title: 'You are on station',
    body: 'Clear two waves. Reopen this guide from Help anytime.',
    tip: 'Stay quiet, shoot from the beam, and get home.',
    anchor: 'center',
  },
];

/** Survive card. Charges sit on the bow track, inside the distance a steady helm will sail. */
export const HEDGEHOG_BEAT_INDEX = 3;

export const STEER_BEAT_INDEX = 0;
export const FIRE_BEAT_INDEX = 2;

/** Gold mark for the steer exercise, off the bow so a straight helm misses it. */
export function steerLessonMark(x: number, y: number, heading: number): { x: number; y: number } {
  const aim = heading + 0.55;
  const dist = 7;
  return { x: x + Math.cos(aim) * dist, y: y + Math.sin(aim) * dist };
}

/** True when the boat has entered the steer mark. */
export function steerLessonDone(
  subX: number,
  subY: number,
  mark: { x: number; y: number },
): boolean {
  return Math.hypot(mark.x - subX, mark.y - subY) <= 3.5;
}

/** True when a tube launched after the fire card opened. */
export function fireLessonDone(firedBefore: number, firedNow: number): boolean {
  return firedNow > firedBefore;
}

/**
 * True when the boat has left the lane the pattern was laid on.
 * `cross` is the absolute cross-track distance from the heading at spawn.
 */
export function dodgeLessonDone(crossTrack: number, hpBefore: number, hpNow: number): boolean {
  return hpNow >= hpBefore && crossTrack >= 3;
}

/** Five charges 5 units ahead, across the bow. Radius 1.7, so a steady helm sails into them. */
export function threateningHedgehogPattern(
  x: number,
  y: number,
  heading: number,
): Array<{
  id: string;
  kind: 'hedgehog';
  sourceId: string;
  x: number;
  y: number;
  z: number;
  vz: number;
  fuse: number;
  damage: number;
  radius: number;
  targetDepth: number;
}> {
  const across = heading + Math.PI / 2;
  return Array.from({ length: 5 }, (_, index) => {
    const spread = (index - 2) * 1.35;
    return {
      id: `tutorial-hog-${index}`,
      kind: 'hedgehog' as const,
      sourceId: 'tutorial',
      x: x + Math.cos(heading) * 5 + Math.cos(across) * spread,
      y: y + Math.sin(heading) * 5 + Math.sin(across) * spread,
      z: 0.5,
      vz: 0,
      fuse: 8,
      damage: 18,
      radius: 1.7,
      targetDepth: 0.5,
    };
  });
}

export function quickStartStepCount(): number {
  return QUICK_START.length;
}

export function fullTourStepCount(): number {
  return FULL_TOUR.length;
}

export interface TutorialPause {
  phase: GamePhase;
  /** True when the overlay, not the player, is holding the sim on paused. */
  heldByTutorial: boolean;
}

/**
 * Pause with the existing phase flag while the tutorial is open.
 * A pause the player already set is left in place when the overlay closes.
 */
export function phaseWhileTutorial(
  phase: GamePhase,
  tutorialOpen: boolean,
  heldByTutorial: boolean,
  exerciseLive = false,
): TutorialPause {
  if (tutorialOpen && !exerciseLive) {
    if (phase === 'playing') return { phase: 'paused', heldByTutorial: true };
    return { phase, heldByTutorial };
  }
  if (heldByTutorial && phase === 'paused') return { phase: 'playing', heldByTutorial: false };
  return { phase, heldByTutorial: exerciseLive ? false : heldByTutorial };
}

/**
 * Fixed-step clock. Explain cards pause it. A live exercise lets it run
 * so steering, firing, and the hedgehog fuse are real.
 */
export function patrolClockRuns(
  phase: GamePhase,
  tutorialOpen: boolean,
  exerciseLive = false,
): boolean {
  if (phase !== 'playing') return false;
  if (!tutorialOpen) return true;
  return exerciseLive;
}

export class TutorialOverlay {
  private step = 0;
  private open = false;
  private mode: Mode = 'quick';
  /** Fired after each card render. The app uses it to spawn the hedgehog beat. */
  onBeat: ((index: number) => void) | null = null;
  /** Return false to keep the current card. Skip and Escape are not gated. */
  mayAdvance: ((fromStep: number) => boolean) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onVisibility?: (open: boolean) => void,
  ) {
    root.addEventListener('click', this.onClick);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Quick-start exercise on the current card. The Help tour never runs one. */
  currentExercise(): TutorialExercise | null {
    if (!this.open || this.mode !== 'quick') return null;
    return this.steps()[this.step]?.exercise ?? null;
  }

  exerciseLive(): boolean {
    return this.currentExercise() !== null;
  }

  /** Lock Next until the live exercise is done. Explain cards stay clickable. */
  setAdvanceEnabled(enabled: boolean): void {
    if (typeof this.root.querySelector !== 'function') return;
    const next = this.root.querySelector('[data-tutorial-action="next"]');
    if (next instanceof HTMLButtonElement) next.disabled = !enabled;
  }

  /** `force` is Help: ignore the seen-flag and open the full tour. */
  show(force = false): void {
    if (!force && this.completed()) return;
    this.mode = force ? 'tour' : 'quick';
    this.open = true;
    this.step = 0;
    this.render();
    this.onVisibility?.(true);
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
  }

  private steps(): readonly Step[] {
    return this.mode === 'quick' ? QUICK_START : FULL_TOUR;
  }

  private completed(): boolean {
    try {
      return localStorage.getItem(TUTORIAL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private finish(): void {
    try {
      localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    const wasOpen = this.open;
    this.open = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
    if (wasOpen) this.onVisibility?.(false);
  }

  private render(): void {
    const steps = this.steps();
    const current = steps[this.step];
    if (!current) return;
    const rect = this.spotRect(current.anchor);
    const style = rect
      ? `--spot-x:${rect.left - 8}px;--spot-y:${rect.top - 8}px;--spot-w:${rect.width + 16}px;--spot-h:${rect.height + 16}px`
      : '';
    const kind = this.mode === 'quick' ? 'QUICK START' : 'TUTORIAL';
    const quickClass = this.mode === 'quick' ? ' tutorial-quick' : '';
    const backDisabled = this.step === 0 ? ' disabled' : '';
    const nextLabel = this.step === steps.length - 1 ? 'Finish' : 'Next';
    const nextDisabled = current.exercise ? ' disabled' : '';
    this.root.hidden = false;
    this.root.innerHTML =
      `<div class="tutorial-dim"${style ? ` style="${style}"` : ''}></div>` +
      `<section class="tutorial-card${quickClass}" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">` +
      `<div class="panel-label">${kind} · ${this.step + 1}/${steps.length}</div>` +
      `<h2 id="tutorial-title">${current.title}</h2>` +
      `<p>${current.body}</p>` +
      `<p class="tutorial-tip"><b>TIP</b> ${current.tip}</p>` +
      `<div class="tutorial-actions">` +
      `<button class="hud-btn" data-tutorial-action="back"${backDisabled}>Back</button>` +
      `<button class="hud-btn" data-tutorial-action="skip">Skip</button>` +
      `<button class="hud-btn active" data-tutorial-action="next"${nextDisabled}>${nextLabel}</button>` +
      `</div></section>`;
    this.onBeat?.(this.step);
    if (typeof this.root.querySelector === 'function') {
      const next = this.root.querySelector('[data-tutorial-action="next"]');
      if (next instanceof HTMLElement) next.focus();
    }
  }

  private spotRect(anchor: Anchor): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function')
      return null;
    const node =
      anchor === 'canvas'
        ? document.querySelector('#scene')
        : document.querySelector(`[data-tutorial="${anchor}"]`);
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    return node.getBoundingClientRect();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const action = readTutorialAction(event.target);
    if (action === 'back' && this.step > 0) {
      this.step -= 1;
      this.render();
    }
    if (action === 'next') {
      if (this.mayAdvance && !this.mayAdvance(this.step)) return;
      if (this.step === this.steps().length - 1) this.finish();
      else {
        this.step += 1;
        this.render();
      }
    }
    if (action === 'skip') this.finish();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.code !== 'Escape') return;
    event.preventDefault();
    this.finish();
  };
}

function readTutorialAction(target: EventTarget | null): string | undefined {
  if (target === null || typeof target !== 'object' || !('closest' in target)) return undefined;
  const closest = target.closest;
  if (typeof closest !== 'function') return undefined;
  const button: unknown = closest.call(target, '[data-tutorial-action]');
  if (button === null || typeof button !== 'object' || !('dataset' in button)) return undefined;
  const dataset = button.dataset;
  if (dataset === null || typeof dataset !== 'object' || !('tutorialAction' in dataset)) {
    return undefined;
  }
  const action = dataset.tutorialAction;
  return typeof action === 'string' ? action : undefined;
}
