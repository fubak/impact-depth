/** Shared constants and helpers for browser smoke / E2E / visual / FPS probes. */

export const DEFAULT_URL = 'http://127.0.0.1:8080/';
export const VIEWPORT = { width: 1440, height: 900 };
export const VIEWPORT_COMPACT = { width: 1024, height: 700 };
export const SMOKE_TIMEOUT_MS = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS || 45000);
export const E2E_TIMEOUT_MS = Number(process.env.BROWSER_E2E_TIMEOUT_MS || 45000);
export const POLL_MS = 100;

/** Chromium launch args suitable for headless CI containers. */
export const CHROMIUM_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

export const MODE_LABEL = {
  tactical: 'TACTICAL',
  chase: 'CHASE',
  bridge: 'BRIDGE',
  periscope: 'PERISCOPE',
  free: 'FREE CAMERA',
  map: 'MAP',
  sonar: 'SONAR PLOT',
};

export const MODE_KEY = {
  tactical: 'Digit1',
  chase: 'Digit2',
  bridge: 'Digit3',
  periscope: 'Digit4',
  free: 'Digit5',
  map: 'Digit6',
  sonar: 'Digit7',
};

/**
 * Median of a numeric sample (sorted copy).
 * @param {number[]} values
 */
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Approximate percentile (nearest-rank).
 * @param {number[]} values
 * @param {number} p 0–100
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @param {() => Promise<boolean>} predicate
 * @param {string} label
 */
export async function pollUntil(page, timeoutMs, predicate, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await page.waitForTimeout(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

/**
 * @param {import('playwright').Page} page
 */
export function attachErrorCollectors(page) {
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {string[]} */
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  return { consoleErrors, pageErrors };
}

/**
 * Track failed same-origin (first-party) asset/document responses.
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 */
export function attachFailedRequestTracker(page, baseUrl) {
  const origin = new URL(baseUrl).origin;
  /** @type {{ url: string, status: number }[]} */
  const failed = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.startsWith(origin)) return;
    const status = response.status();
    if (status >= 400) failed.push({ url, status });
  });
  return failed;
}

/**
 * @param {import('playwright').Page} page
 */
export async function clearTutorialFlag(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('silent-depths-tutorial-v1');
    } catch {
      /* ignore */
    }
  });
}

/**
 * Observable playing phase: Begin overlay gone, Pause chrome present, tutorial closed.
 * @param {import('playwright').Page} page
 */
export async function assertPlaying(page) {
  const overlayHidden = await page.locator('#patrol-overlay').getAttribute('hidden');
  if (overlayHidden === null) {
    const text = await page
      .locator('#patrol-overlay')
      .innerText()
      .catch(() => '');
    throw new Error(`Expected #patrol-overlay hidden while playing; got: ${text.slice(0, 160)}`);
  }
  const beginCount = await page.locator('button[data-action="begin"]').count();
  if (beginCount > 0) throw new Error('Begin Patrol still present — not in playing phase');
  const pause = page.getByRole('button', { name: /^(Pause|Resume)$/ });
  if ((await pause.count()) < 1) throw new Error('Expected Pause/Resume control while playing');
  const tutorialHidden = await page.locator('#tutorial-overlay').getAttribute('hidden');
  if (tutorialHidden === null) throw new Error('Tutorial still open — blocking patrol');
}

/**
 * @param {import('playwright').Page} page
 * @param {keyof typeof MODE_LABEL} mode
 */
export async function assertMode(page, mode) {
  const label = MODE_LABEL[mode];
  const hudText = await page.locator('#hud').innerText();
  if (!hudText.includes(label)) {
    throw new Error(`Expected HUD to include ${label}; got: ${hudText.slice(0, 240)}`);
  }
  if (mode === 'periscope') {
    const hidden = await page.locator('#periscope-overlay').getAttribute('hidden');
    if (hidden !== null) throw new Error('Periscope overlay should be visible');
  } else if (mode === 'sonar') {
    const hidden = await page.locator('#sonar-overlay').getAttribute('hidden');
    if (hidden !== null) throw new Error('Sonar overlay should be visible');
  } else {
    const periHidden = await page.locator('#periscope-overlay').getAttribute('hidden');
    const sonarHidden = await page.locator('#sonar-overlay').getAttribute('hidden');
    if (periHidden === null) throw new Error(`Periscope overlay should be hidden in ${mode}`);
    if (sonarHidden === null) throw new Error(`Sonar overlay should be hidden in ${mode}`);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {keyof typeof MODE_KEY} mode
 */
export async function setMode(page, mode) {
  await page.keyboard.press(MODE_KEY[mode]);
  await pollUntil(
    page,
    4000,
    async () => {
      const hudText = await page.locator('#hud').innerText();
      return hudText.includes(MODE_LABEL[mode]);
    },
    `HUD mode ${mode}`,
  );
  await assertMode(page, mode);
}

/**
 * Click Begin Patrol, skip tutorial if shown, assert playing.
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function beginPatrolAndSkipTutorial(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? E2E_TIMEOUT_MS;
  await page.waitForSelector('#hud', { timeout: timeoutMs });
  await page.waitForSelector('button[data-action="begin"]', { timeout: timeoutMs });
  await page.locator('button[data-action="begin"]').first().click({ timeout: timeoutMs });

  await pollUntil(
    page,
    timeoutMs,
    async () => {
      const beginGone = (await page.locator('button[data-action="begin"]').count()) === 0;
      const overlayHidden = (await page.locator('#patrol-overlay').getAttribute('hidden')) !== null;
      return beginGone && overlayHidden;
    },
    'patrol overlay to dismiss after Begin',
  );

  const skip = page.locator('button[data-tutorial-action="skip"]');
  const skipVisible = await skip.isVisible().catch(() => false);
  if (skipVisible) {
    await skip.click({ timeout: timeoutMs });
    await pollUntil(
      page,
      timeoutMs,
      async () => (await page.locator('#tutorial-overlay').getAttribute('hidden')) !== null,
      'tutorial to close after Skip',
    );
  }

  await assertPlaying(page);
}

/**
 * Snapshot whether a control is visible and has a non-zero hit target.
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
export async function controlReachable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) return { ok: false, reason: 'missing' };
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.pointerEvents === 'none'
    ) {
      return { ok: false, reason: 'not-interactive' };
    }
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return { ok: false, reason: 'tiny' };
    if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {
      return { ok: false, reason: 'offscreen' };
    }
    return { ok: true, reason: 'ok', box: { x: r.x, y: r.y, w: r.width, h: r.height } };
  }, selector);
}

/**
 * Read WebGL renderer string for reports (may be SwiftShader in headless).
 * @param {import('playwright').Page} page
 */
export async function readRendererInfo(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    if (!(canvas instanceof HTMLCanvasElement)) return { renderer: null, vendor: null };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { renderer: null, vendor: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return { renderer: 'unknown', vendor: 'unknown' };
    return {
      renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
    };
  });
}

/**
 * Best-effort quality label from look-dev perf strip when open; else default high.
 * @param {import('playwright').Page} page
 */
export async function readQualityLabel(page) {
  return page.evaluate(() => {
    const perf = document.querySelector('[data-perf]');
    const text = perf?.textContent ?? '';
    const match = text.match(/\b(HIGH|MEDIUM|LOW)\b/i);
    return match ? match[1].toLowerCase() : 'high';
  });
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<{
 *   backend: string,
 *   requestedBackend: string,
 *   ready: boolean,
 *   fallbackReason: string | null,
 *   missionGeneration: number,
 *   worldVersion: string,
 * } | null>}
 */
export async function readEnvironmentDiagnostics(page) {
  return page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app || typeof app.getEnvironmentDiagnostics !== 'function') return null;
    return app.getEnvironmentDiagnostics();
  });
}

/**
 * Full performance probe (quality, world, graphics memory/programs, environment).
 * @param {import('playwright').Page} page
 */
export async function readPerformanceProbe(page) {
  return page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app || typeof app.getPerformanceProbe !== 'function') return null;
    return app.getPerformanceProbe();
  });
}

/** Three.js cache residuals allowed after backend/quality teardown cycles. */
export const RESOURCE_CYCLE_SLACK_MULTIPLIER = 3;
export const RESOURCE_CYCLE_SLACK_ABS = 32;

/**
 * @param {unknown} probe
 * @returns {{ geometries: number, textures: number, programs: number }}
 */
export function extractResourceCounts(probe) {
  const memory = probe?.graphics?.memory ?? {};
  return {
    geometries: Number(memory.geometries ?? 0),
    textures: Number(memory.textures ?? 0),
    programs: Number(probe?.graphics?.programs ?? 0),
  };
}

/** @param {number} baseline */
export function resourceCycleSlackLimit(baseline) {
  return baseline * RESOURCE_CYCLE_SLACK_MULTIPLIER + RESOURCE_CYCLE_SLACK_ABS;
}

/**
 * @param {{ geometries: number, textures: number, programs: number }} baseline
 * @param {{ geometries: number, textures: number, programs: number }} current
 * @param {string} label
 * @returns {string[]}
 */
export function checkResourceCycleSlack(baseline, current, label) {
  /** @type {string[]} */
  const failures = [];
  for (const key of /** @type {const} */ (['geometries', 'textures', 'programs'])) {
    const limit = resourceCycleSlackLimit(baseline[key]);
    if (current[key] > limit) {
      failures.push(
        `${label}: ${key}=${current[key]} exceeds slack limit ${limit} (warmup baseline ${baseline[key]})`,
      );
    }
  }
  return failures;
}

/**
 * @param {Array<{ geometries: number, textures: number, programs: number }>} samples
 * @param {string} label
 * @returns {string[]}
 */
export function checkResourceCycleMonotonicGrowth(samples, label) {
  /** @type {string[]} */
  const failures = [];
  if (samples.length < 3) return failures;
  for (const key of /** @type {const} */ (['geometries', 'textures', 'programs'])) {
    let strictIncreases = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i][key] > samples[i - 1][key]) strictIncreases += 1;
    }
    if (strictIncreases === samples.length - 1) {
      failures.push(
        `${label}: ${key} strictly increased every cycle (${samples[0][key]} → ${samples.at(-1)?.[key]})`,
      );
    }
  }
  return failures;
}

/**
 * Helm orders: deep then return to fire-legal periscope / 1/3.
 * @param {import('playwright').Page} page
 */
export async function navigateHelm(page) {
  await setMode(page, 'tactical');
  const before = await page.locator('[aria-label="Depth order"]').innerText();
  await page.keyboard.press('KeyV');
  await pollUntil(
    page,
    5000,
    async () => {
      const text = await page.locator('[aria-label="Depth order"]').innerText();
      return text.includes('DEEP') || text.includes('→ DEEP');
    },
    'depth order to show DEEP',
  );
  const afterDepth = await page.locator('[aria-label="Depth order"]').innerText();
  if (afterDepth === before) throw new Error('Depth HUD did not change after KeyV');

  await page.keyboard.press('KeyP');
  await pollUntil(
    page,
    5000,
    async () => {
      const cls =
        (await page
          .locator('button[data-action="speed"][data-value="flank"]')
          .getAttribute('class')) ?? '';
      return cls.includes('active') || cls.includes('pending');
    },
    'Flank speed button active/pending',
  );
  await page.keyboard.press('KeyX');
  await page.keyboard.press('KeyI');
  await pollUntil(
    page,
    8000,
    async () => {
      const text = await page.locator('[aria-label="Depth order"]').innerText();
      return text.includes('PERISCOPE');
    },
    'return to periscope depth order',
  );
}

/**
 * Acquire with KeyT and fire Mk-14 with KeyF.
 * @param {import('playwright').Page} page
 */
export async function fireSelected(page) {
  await setMode(page, 'tactical');
  await page.keyboard.press('KeyX');
  const magBefore = await page.locator('[aria-label="Weapons"]').innerText();
  const mk14Match = magBefore.match(/Mk-14\s+(\d+)/i);
  const ammoBefore = mk14Match ? Number(mk14Match[1]) : null;

  await page.keyboard.press('KeyT');
  await pollUntil(
    page,
    4000,
    async () => {
      const orders = await page.locator('[aria-label="Active orders"]').innerText();
      return !/TARGET\s*NONE/i.test(orders.replace(/\s+/g, ' '));
    },
    'target lock after KeyT',
  );

  await page.keyboard.press('KeyF');
  await pollUntil(
    page,
    6000,
    async () => {
      const mag = await page.locator('[aria-label="Weapons"]').innerText();
      const hud = await page.locator('#hud').innerText();
      const toasts = await page
        .locator('.hud-toasts')
        .innerText()
        .catch(() => '');
      const mk14 = mag.match(/Mk-14\s+(\d+)/i);
      const ammoDropped =
        ammoBefore !== null && mk14 !== null && Number(mk14[1]) === ammoBefore - 1;
      const reload = /RELOAD/i.test(mag);
      const firedToast = /MK-14/i.test(`${hud}\n${toasts}`);
      return ammoDropped || reload || firedToast;
    },
    'magazine/toast change after fire',
  );
}

/**
 * @param {import('playwright').Page} page
 */
export async function pauseAndResume(page) {
  await page.keyboard.press('Space');
  await pollUntil(
    page,
    4000,
    async () => {
      const bannerHidden = await page.locator('#pause-banner').getAttribute('hidden');
      const resume = await page.getByRole('button', { name: 'Resume' }).count();
      return bannerHidden === null && resume > 0;
    },
    'pause banner and Resume control',
  );
  await page.keyboard.press('Space');
  await pollUntil(
    page,
    4000,
    async () => {
      const bannerHidden = await page.locator('#pause-banner').getAttribute('hidden');
      const pause = await page.getByRole('button', { name: 'Pause' }).count();
      return bannerHidden !== null && pause > 0;
    },
    'resume to playing',
  );
  await assertPlaying(page);
}

/**
 * Reload the same URL (keeps ocean/world query) and begin patrol again.
 * @param {import('playwright').Page} page
 */
export async function restartPatrolViaReload(page) {
  await page.reload({ waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  await page.waitForSelector('button[data-action="begin"]', { timeout: E2E_TIMEOUT_MS });
  await beginPatrolAndSkipTutorial(page);
  await assertMode(page, 'tactical');
}
