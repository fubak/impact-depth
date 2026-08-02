import type { ControlIntent } from '../core/sim';
import { createControlIntent } from '../core/sim';
import type { ViewMode } from '../core/types';

export type InputCallbacks = {
  setViewMode: (mode: ViewMode) => void;
  togglePause: () => void;
  togglePanel: () => void;
  orbit: (dx: number, dy: number) => void;
  periLook: (dx: number, dy: number) => void;
  zoom: (delta: number) => void;
  getViewMode: () => ViewMode;
};

export class InputController {
  readonly intent: ControlIntent = createControlIntent();
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
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
      if (e.repeat && ['Space', 'Digit1', 'Digit2', 'Digit3', 'KeyH'].includes(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Digit1') this.cb.setViewMode('tactical');
      if (e.code === 'Digit2') this.cb.setViewMode('periscope');
      if (e.code === 'Digit3') this.cb.setViewMode('sonar');
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
      if (e.button !== 0) return;
      const tag = (e.target as HTMLElement)?.closest?.('aside, button, input, select, label, a');
      if (tag) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.target.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.cb.getViewMode() === 'periscope') this.cb.periLook(dx, dy);
      else if (this.cb.getViewMode() === 'tactical') this.cb.orbit(dx, dy);
    };
    this.onPointerUp = (e) => {
      this.dragging = false;
      try {
        this.target.releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.onWheel = (e) => {
      if (this.cb.getViewMode() === 'tactical') {
        e.preventDefault();
        this.cb.zoom(e.deltaY);
      }
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
