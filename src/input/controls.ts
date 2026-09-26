import type { ControlIntent } from '../core/sim';
import { createControlIntent } from '../core/sim';
import type { ViewMode } from '../core/types';

/** Canvas-drag click only — HUD pointerups must not become world picks/plots. */
export function shouldDispatchWorldInteract(
  dragging: boolean,
  pointerMoved: boolean,
  button: number,
): boolean {
  return dragging && !pointerMoved && (button === 0 || button === 2);
}

export type InputCallbacks = {
  setViewMode: (mode: ViewMode) => void;
  togglePause: () => void;
  togglePanel: () => void;
  orbit: (dx: number, dy: number) => void;
  periLook: (dx: number, dy: number) => void;
  bridgeLook: (dx: number, dy: number) => void;
  zoom: (delta: number) => void;
  getViewMode: () => ViewMode;
  interact: (button: 0 | 2, x: number, y: number) => void;
};

export class InputController {
  readonly intent: ControlIntent = createControlIntent();
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pointerMoved = false;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;
  private readonly target: HTMLElement;
  private readonly cb: InputCallbacks;

  constructor(target: HTMLElement, cb: InputCallbacks) {
    this.target = target;
    this.cb = cb;

    this.onKeyDown = (e) => {
      if (e.repeat && ['Space', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyH'].includes(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.cb.setViewMode('tactical');
      if (e.code === 'Digit2') this.cb.setViewMode('chase');
      if (e.code === 'Digit3') this.cb.setViewMode('bridge');
      if (e.code === 'Digit4') this.cb.setViewMode('periscope');
      if (e.code === 'Digit5') this.cb.setViewMode('free');
      if (e.code === 'Digit6') this.cb.setViewMode('map');
      if (e.code === 'Digit7') this.cb.setViewMode('sonar');
      if (e.code === 'Space') {
        e.preventDefault();
        this.cb.togglePause();
      }
      if (e.code === 'KeyH') this.cb.togglePanel();
    };
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this.onPointerDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const tag = (e.target as HTMLElement)?.closest?.('aside, button, input, select, label, a, #hud, .hud');
      if (tag) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.pointerMoved = false;
      this.target.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.pointerMoved = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const mode = this.cb.getViewMode();
      if (mode === 'periscope') this.cb.periLook(dx, dy);
      else if (mode === 'bridge') this.cb.bridgeLook(dx, dy);
      else this.cb.orbit(dx, dy);
    };
    this.onPointerUp = (e) => {
      // Only canvas drags become world clicks. HUD buttons must not also plot a
      // waypoint under the cursor (that was overwriting Ambush/Stalk on the same click).
      if (shouldDispatchWorldInteract(this.dragging, this.pointerMoved, e.button)) {
        this.cb.interact(e.button as 0 | 2, e.clientX, e.clientY);
      }
      this.dragging = false;
      this.pointerMoved = false;
      try {
        this.target.releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
    };
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    this.onWheel = (e) => {
      e.preventDefault();
      this.cb.zoom(e.deltaY);
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(): void {
    const forward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const yaw =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const depth =
      (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);

    this.intent.surge = forward;
    this.intent.yaw = yaw;
    this.intent.depth = depth;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('wheel', this.onWheel);
  }
}
