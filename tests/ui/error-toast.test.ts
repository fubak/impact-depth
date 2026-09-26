import { describe, expect, it } from 'vitest';
// @ts-expect-error node builtins are outside the game tsconfig (types: vite/client)
import { readFileSync } from 'node:fs';
import {
  bindMasterVolume,
  ErrorToast,
  formatErrorSummary,
  installErrorHandlers,
  recordCapturedError,
  reducedMotionGates,
  resolveReducedMotion,
  resolveStartupQuality,
  summarizeRejection,
  type ErrorRecord,
  type MasterVolumeAudio,
} from '../../src/ui/error-toast';

const helm: ErrorRecord = {
  kind: 'error',
  message: 'boom at helm',
  source: 'app.ts',
  line: 12,
  column: 3,
  stack: 'Error: boom at helm\n    at frame (app.ts:12:3)',
};

describe('error toast formatting', () => {
  it('puts the message and source location in the copyable summary', () => {
    const summary = formatErrorSummary(helm);
    expect(summary).toContain('error: boom at helm');
    expect(summary).toContain('app.ts:12:3');
    expect(summary).toContain('at frame');
  });

  it('omits a location when the host did not report one', () => {
    const summary = formatErrorSummary({ ...helm, source: '', stack: '' });
    expect(summary).toBe('error: boom at helm');
    expect(summary).not.toContain('@');
  });
});

describe('captured error counter', () => {
  it('counts each captured error and keeps that error in the summary', () => {
    const first = recordCapturedError(0, helm);
    expect(first.count).toBe(1);
    expect(first.summary).toContain('boom at helm');
    const second = recordCapturedError(first.count, summarizeRejection(new Error('rejected wave')));
    expect(second.count).toBe(2);
    expect(second.summary).toContain('unhandledrejection: rejected wave');
  });
});

describe('injected window errors', () => {
  it('shows a toast and raises the counter for onerror and unhandledrejection', () => {
    const parent = fakeParent();
    const toast = new ErrorToast(parent.node as unknown as ParentNode);
    let errors = 0;
    const host = fakeHost();
    const release = installErrorHandlers(host as unknown as Window, (record) => {
      const recorded = recordCapturedError(errors, record);
      errors = recorded.count;
      toast.show(recorded.summary, recorded.count);
    });

    host.onerror?.('boom at helm', 'app.ts', 12, 3, new Error('boom at helm'));
    expect(errors).toBe(1);
    expect(parent.root.hidden).toBe(false);
    expect(parent.summary.value).toContain('boom at helm');
    expect(parent.summary.value).toContain('app.ts:12:3');
    expect(parent.label.textContent).toBe('Error captured');

    host.emitRejection({ reason: new Error('rejected wave') });
    expect(errors).toBe(2);
    expect(parent.summary.value).toContain('rejected wave');
    expect(parent.label.textContent).toBe('2 errors captured');

    parent.copy.click();
    expect(parent.copied).toContain('rejected wave');
    release();
    host.onerror?.('after unbind', 'app.ts', 1, 1, new Error('after unbind'));
    expect(errors).toBe(2);
    parent.restore();
  });
});

describe('saved play preferences at startup', () => {
  it('forces reduced motion off the OS when the override says so', () => {
    expect(resolveReducedMotion('reduce', false)).toBe(true);
    expect(resolveReducedMotion('allow', true)).toBe(false);
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('system', false)).toBe(false);
  });

  it('zeroes shake, hit-freeze and flash under reduced motion', () => {
    expect(reducedMotionGates(true)).toEqual({ shakeScale: 0, freezeScale: 0, emitFlash: false });
    expect(reducedMotionGates(false)).toEqual({ shakeScale: 1, freezeScale: 1, emitFlash: true });
  });

  it('lets ?quality= win, then a saved profile, then the auto profile', () => {
    const auto = { quality: 'high' as const, qualityForced: false };
    expect(resolveStartupQuality({ quality: 'low', qualityForced: true }, 'high')).toEqual({
      quality: 'low',
      qualityForced: true,
    });
    expect(resolveStartupQuality(auto, 'medium')).toEqual({
      quality: 'medium',
      qualityForced: true,
    });
    expect(resolveStartupQuality(auto, 'auto')).toEqual({ quality: 'high', qualityForced: false });
  });

  it('scales the master bus by the saved linear volume after unlock and unmute', () => {
    const gain = { value: 0 };
    const audio: MasterVolumeAudio & { master: { gain: { value: number } } | null } = {
      isMuted: false,
      master: null,
      unlock() {
        this.master = { gain };
        gain.value = 0.22;
      },
      setMuted(muted: boolean) {
        this.isMuted = muted;
        if (this.master) this.master.gain.value = muted ? 0 : 0.22;
      },
    };
    bindMasterVolume(audio, 0.5);
    audio.unlock();
    expect(gain.value).toBeCloseTo(0.11);
    audio.setMuted(true);
    expect(gain.value).toBe(0);
    audio.setMuted(false);
    expect(gain.value).toBeCloseTo(0.11);
  });
});

describe('startup wiring', () => {
  it('app and main apply the toast, counter, motion gates, volume and quality', () => {
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(app).toContain('noteCapturedError');
    expect(app).toContain('recordCapturedError(this.errorCount');
    expect(app).toContain('resolveReducedMotion(');
    expect(app).toContain('resolveStartupQuality(');
    expect(app).toContain('bindMasterVolume(this.audio');
    expect(app).toContain('reducedMotionGates(this.reducedMotion)');
    expect(app).toContain('gates.emitFlash ? events : []');
    expect(app).toContain('errors: this.errorCount');
    expect(main).toContain('installErrorHandlers');
    expect(main).toContain('noteCapturedError');
  });
});

function fakeParent() {
  const copied: { text: string } = { text: '' };
  const summary = {
    tag: 'textarea',
    value: '',
    readOnly: false,
    rows: 0,
    style: {} as Record<string, string>,
    setAttribute() {},
    focus() {},
    select() {},
  };
  const label = { tag: 'p', dataset: {} as Record<string, string>, textContent: '' };
  const copy = {
    tag: 'button',
    type: '',
    textContent: '',
    click() {
      const listener = copy.listeners.click?.[0];
      listener?.();
    },
    listeners: {} as Record<string, Array<() => void>>,
    addEventListener(type: string, fn: () => void) {
      copy.listeners[type] = [fn];
    },
  };
  const root = {
    tag: 'div',
    className: '',
    id: '',
    hidden: false,
    style: {} as Record<string, string>,
    children: [] as unknown[],
    setAttribute() {},
    append(...kids: unknown[]) {
      root.children.push(...kids);
    },
    querySelector(selector: string) {
      return selector === '[data-role="label"]' ? label : null;
    },
    remove() {},
  };
  const node = {
    append(child: unknown) {
      if (child === root) parent.root = root;
    },
  };
  const parent = {
    node,
    root,
    summary,
    label,
    copy,
    copied: '',
    restore() {
      globalThis.document = previousDocument;
      if (previousClipboard) {
        Object.defineProperty(globalThis.navigator, 'clipboard', previousClipboard);
      } else {
        delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
      }
    },
  };
  const previousDocument = globalThis.document;
  const clipboard = {
    writeText(text: string) {
      copied.text = text;
      parent.copied = text;
      return Promise.resolve();
    },
  };
  const previousClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  globalThis.document = {
    createElement(tag: string) {
      if (tag === 'textarea') return summary;
      if (tag === 'p') return label;
      if (tag === 'button') return copy;
      return root;
    },
  } as unknown as Document;
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: clipboard,
  });
  return parent;
}

function fakeHost(): {
  onerror: ((...args: unknown[]) => boolean | void) | null;
  addEventListener(type: string, listener: (event: { reason: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { reason: unknown }) => void): void;
  emitRejection(event: { reason: unknown }): void;
} {
  let reject: ((event: { reason: unknown }) => void) | null = null;
  return {
    onerror: null,
    addEventListener(_type: string, listener: (event: { reason: unknown }) => void) {
      reject = listener;
    },
    removeEventListener(_type: string, _listener: (event: { reason: unknown }) => void) {
      reject = null;
    },
    emitRejection(event) {
      reject?.(event);
    },
  };
}
