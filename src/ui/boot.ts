/** Plain-language copy shown when the page cannot create a WebGL2 context. */
export interface WebGlFailureCopy {
  title: string;
  body: string;
}

export interface WebGlProbeCanvas {
  getContext(type: string): unknown;
}

/**
 * Failure-copy renderer. The DOM mount and the unit test both read this so the
 * fallback text cannot drift from the message the acceptance test pins.
 */
export function renderWebGlFailureCopy(): WebGlFailureCopy {
  return {
    title: 'Graphics acceleration required',
    body:
      'Silent Depths needs WebGL 2 and could not start it. Enable hardware acceleration ' +
      'in your browser settings, then reload this page. Supported browsers: current ' +
      'Chrome, Edge, Firefox, and Safari.',
  };
}

/** Asset-load line for the boot overlay. `loaded`/`total` are registry entries. */
export function bootProgressLabel(loaded: number, total: number): string {
  if (total <= 0) return 'Loading fleet assets…';
  const done = Math.max(0, Math.min(loaded, total));
  const pct = Math.round((done / total) * 100);
  return `Loading fleet assets ${pct}%`;
}

/** True when a throwaway canvas can obtain a WebGL2 context. */
export function isWebGL2Available(
  createCanvas: () => WebGlProbeCanvas = defaultProbeCanvas,
): boolean {
  try {
    return Boolean(createCanvas().getContext('webgl2'));
  } catch {
    return false;
  }
}

function defaultProbeCanvas(): WebGlProbeCanvas {
  if (typeof document === 'undefined') return { getContext: () => null };
  return document.createElement('canvas');
}

export function setBootProgress(loaded: number, total: number): void {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('boot-overlay');
  if (!overlay || overlay.dataset.boot === 'failed' || overlay.dataset.boot === 'ready') return;
  const status = document.getElementById('boot-status');
  if (status) status.textContent = bootProgressLabel(loaded, total);
  const pct = total <= 0 ? 0 : Math.round((Math.max(0, Math.min(loaded, total)) / total) * 100);
  const track = overlay.querySelector('.boot-track');
  if (track instanceof HTMLElement) track.setAttribute('aria-valuenow', String(pct));
  const bar = document.getElementById('boot-bar');
  if (bar instanceof HTMLElement) bar.style.width = `${pct}%`;
}

/** Hide the loading overlay once assets have settled. Leaves the node for probes. */
export function hideBootOverlay(): void {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('boot-overlay');
  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.boot = 'ready';
}

/** Replace the loading card with the WebGL2 failure help. */
export function showWebGlFailure(): void {
  if (typeof document === 'undefined') return;
  const overlay = ensureBootOverlay();
  const copy = renderWebGlFailureCopy();
  overlay.hidden = false;
  overlay.removeAttribute('aria-hidden');
  overlay.dataset.boot = 'failed';
  overlay.replaceChildren(failureCard(copy));
}

function ensureBootOverlay(): HTMLElement {
  const existing = document.getElementById('boot-overlay');
  if (existing) return existing;
  const overlay = document.createElement('div');
  overlay.id = 'boot-overlay';
  overlay.className = 'boot-overlay';
  overlay.setAttribute('role', 'alert');
  (document.getElementById('app') ?? document.body).append(overlay);
  return overlay;
}

function failureCard(copy: WebGlFailureCopy): HTMLElement {
  const card = document.createElement('div');
  card.className = 'boot-card';
  const kicker = document.createElement('p');
  kicker.className = 'boot-kicker';
  kicker.textContent = 'Silent Depths';
  const title = document.createElement('h1');
  title.className = 'boot-title';
  title.id = 'boot-failure-title';
  title.textContent = copy.title;
  const body = document.createElement('p');
  body.className = 'boot-status';
  body.id = 'boot-failure-body';
  body.textContent = copy.body;
  card.append(kicker, title, body);
  return card;
}
