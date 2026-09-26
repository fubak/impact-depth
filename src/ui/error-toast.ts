import type { QualityPreference, ReducedMotionPreference } from '../core/settings';
import type { RuntimeSelection } from '../core/runtime-selection';
import type { QualityName } from '../render/quality';

/** One captured `window.onerror` or `unhandledrejection`. */
export interface ErrorRecord {
  kind: 'error' | 'unhandledrejection';
  message: string;
  source: string;
  line: number;
  column: number;
  stack: string;
}

/** Audio surface H1 can scale without a new volume API on `GameAudio`. */
export interface MasterVolumeAudio {
  isMuted: boolean;
  unlock(): void;
  setMuted(muted: boolean): void;
}

type MasterBus = { master: { gain: { value: number } } | null };

const SUMMARY_MAX = 1200;

/** `reduce` / `allow` override the OS. `system` follows `prefers-reduced-motion`. */
export function resolveReducedMotion(
  preference: ReducedMotionPreference,
  systemReduce: boolean,
): boolean {
  if (preference === 'reduce') return true;
  if (preference === 'allow') return false;
  return systemReduce;
}

/**
 * Explicit `?quality=` wins (`qualityForced`). Else a saved high/medium/low profile,
 * locked so the governor does not drift. Else the auto capability profile.
 */
export function resolveStartupQuality(
  runtime: Pick<RuntimeSelection, 'quality' | 'qualityForced'>,
  saved: QualityPreference,
): { quality: QualityName; qualityForced: boolean } {
  if (runtime.qualityForced) {
    return { quality: runtime.quality, qualityForced: true };
  }
  if (saved === 'high' || saved === 'medium' || saved === 'low') {
    return { quality: saved, qualityForced: true };
  }
  return { quality: runtime.quality, qualityForced: false };
}

/** Shake, hit-freeze and combat flash scale. Reduced motion zeroes all three. */
/** Flash can be suppressed. A sinking still has to reach the wreck presenter. */
export function presentationEvents<T extends { type: string }>(
  events: readonly T[],
  emitFlash: boolean,
): T[] {
  if (emitFlash) return [...events];
  return events.filter((event) => event.type === 'shipSunk');
}

export function reducedMotionGates(reduced: boolean): {
  shakeScale: number;
  freezeScale: number;
  emitFlash: boolean;
} {
  if (reduced) return { shakeScale: 0, freezeScale: 0, emitFlash: false };
  return { shakeScale: 1, freezeScale: 1, emitFlash: true };
}

/** Copyable one-block summary. Location is included when the browser provided one. */
export function formatErrorSummary(record: ErrorRecord): string {
  const where = record.source !== '' ? ` @ ${record.source}:${record.line}:${record.column}` : '';
  const head = `${record.kind}: ${record.message}${where}`;
  const body = record.stack && record.stack !== record.message ? `\n${record.stack}` : '';
  const text = `${head}${body}`;
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

/** Bump the `getGameSummary().errors` counter and return the toast copy. */
export function recordCapturedError(
  count: number,
  record: ErrorRecord,
): { count: number; summary: string } {
  return { count: count + 1, summary: formatErrorSummary(record) };
}

export function summarizeWindowError(
  message: string | Event,
  source?: string,
  line?: number,
  column?: number,
  error?: Error | null,
): ErrorRecord {
  const fromError = error?.message;
  const fromEvent = typeof message === 'string' ? message : '';
  return {
    kind: 'error',
    message: fromError || fromEvent || 'Unknown error',
    source: source ?? '',
    line: line ?? 0,
    column: column ?? 0,
    stack: error?.stack ?? '',
  };
}

export function summarizeRejection(reason: unknown): ErrorRecord {
  if (reason instanceof Error) {
    return {
      kind: 'unhandledrejection',
      message: reason.message || 'Unhandled rejection',
      source: '',
      line: 0,
      column: 0,
      stack: reason.stack ?? '',
    };
  }
  return {
    kind: 'unhandledrejection',
    message: typeof reason === 'string' ? reason : 'Unhandled rejection',
    source: '',
    line: 0,
    column: 0,
    stack: '',
  };
}

/** Show a toast and keep counting. Returns an unbind for HMR dispose. */
export function installErrorHandlers(
  host: Window,
  onRecord: (record: ErrorRecord) => void,
): () => void {
  const previous = host.onerror;
  host.onerror = (message, source, line, column, error) => {
    const thrown = error instanceof Error ? error : null;
    onRecord(summarizeWindowError(message, source, line, column, thrown));
    if (typeof previous === 'function') return previous(message, source, line, column, error);
    return false;
  };
  const onReject = (event: PromiseRejectionEvent): void => {
    onRecord(summarizeRejection(event.reason));
  };
  host.addEventListener('unhandledrejection', onReject);
  return () => {
    host.onerror = previous;
    host.removeEventListener('unhandledrejection', onReject);
  };
}

/**
 * Scale the WebAudio master bus by the saved linear volume (0–1).
 * Full scale is whatever `unlock` / `setMuted(false)` writes before we multiply.
 */
export function bindMasterVolume(audio: MasterVolumeAudio, linear: number): void {
  const scale = clamp01(linear);
  const bus = audio as MasterVolumeAudio & MasterBus;
  let fullScale = 0.22;
  let sawFull = false;

  const captureFull = (): void => {
    const master = bus.master;
    if (sawFull || !master || audio.isMuted || master.gain.value <= 0) return;
    fullScale = master.gain.value;
    sawFull = true;
  };

  const apply = (): void => {
    const master = bus.master;
    if (!master) return;
    captureFull();
    master.gain.value = audio.isMuted ? 0 : fullScale * scale;
  };

  const unlock = audio.unlock.bind(audio);
  audio.unlock = () => {
    unlock();
    apply();
  };
  const setMuted = audio.setMuted.bind(audio);
  audio.setMuted = (muted: boolean) => {
    setMuted(muted);
    apply();
  };
  apply();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** On-screen error with a selectable, copyable summary. Mounted outside the HUD. */
export class ErrorToast {
  private readonly root: HTMLElement;
  private readonly summary: HTMLTextAreaElement;

  constructor(parent: ParentNode) {
    this.root = document.createElement('div');
    this.root.className = 'toast';
    this.root.id = 'error-toast';
    this.root.setAttribute('role', 'alert');
    this.root.hidden = true;
    this.root.style.position = 'absolute';
    this.root.style.left = '50%';
    this.root.style.bottom = '12%';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.zIndex = '40';
    this.root.style.maxWidth = '36rem';
    this.root.style.pointerEvents = 'auto';

    const label = document.createElement('p');
    label.dataset.role = 'label';
    label.textContent = 'Error captured';

    this.summary = document.createElement('textarea');
    this.summary.readOnly = true;
    this.summary.rows = 4;
    this.summary.setAttribute('aria-label', 'Error summary');
    this.summary.style.width = '100%';
    this.summary.style.resize = 'none';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => this.copySummary());

    this.root.append(label, this.summary, copy);
    parent.append(this.root);
  }

  show(summary: string, count: number): void {
    this.root.hidden = false;
    const label = this.root.querySelector('[data-role="label"]');
    if (label) label.textContent = count === 1 ? 'Error captured' : `${count} errors captured`;
    this.summary.value = summary;
  }

  dispose(): void {
    this.root.remove();
  }

  private copySummary(): void {
    const text = this.summary.value;
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      void clipboard.writeText(text);
      return;
    }
    this.summary.focus();
    this.summary.select();
  }
}
