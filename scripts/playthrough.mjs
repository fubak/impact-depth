#!/usr/bin/env node
/**
 * Plan 022 playthrough. Prefers the operator's Chrome on CDP :9223, otherwise launches Chromium.
 * Screenshots and report.json land in artifacts/plan-022/playthrough/<ISO>/.
 * A SwiftShader renderer is recorded as NOT A VISUAL PASS (evidence only).
 *
 * Expects `npm run preview` (default http://127.0.0.1:8080/).
 * Usage: node scripts/playthrough.mjs [url]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  E2E_TIMEOUT_MS,
  beginPatrolAndSkipTutorial,
} from '../tests/e2e/helpers.mjs';
import {
  JOURNEY_RUNNERS,
  PLAYTHROUGH_VIEWPORT,
  buildReport,
  connectChromium,
  dumpPlaythroughState,
  hudCoverageFraction,
  mapPlaythroughDump,
  playthroughStamp,
  releaseBrowser,
} from '../tests/e2e/playthrough-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || DEFAULT_URL;
const stamp = playthroughStamp();
const shotDir = join(root, 'artifacts', 'plan-022', 'playthrough', stamp);

mkdirSync(shotDir, { recursive: true });

/**
 * @param {import('playwright').Page} page
 * @param {string} action
 * @param {string} [value]
 */
async function clickHud(page, action, value) {
  const selector = value
    ? `[data-action="${action}"][data-value="${value}"]`
    : `[data-action="${action}"]`;
  const target = page.locator(selector).first();
  const visible = await target.isVisible().catch(() => false);
  if (!visible) {
    const gear = page.locator('[data-action="toggle-gear"]');
    if ((await gear.count()) > 0 && (await gear.isVisible().catch(() => false))) {
      await gear.click();
    }
  }
  await target.click({ timeout: 8_000 });
}

/**
 * @param {import('playwright').Page} page
 */
function createSession(page) {
  return {
    now: () => Date.now(),
    wait: (ms) => page.waitForTimeout(ms),
    dump: () => page.evaluate(dumpPlaythroughState),
    key: (code) => page.keyboard.press(code),
    clickAction: (action, value) => clickHud(page, action, value),
    clickTutorialSkip: () => page.locator('[data-tutorial-action="skip"]').click(),
    setTactic: (tactic) =>
      page.evaluate((name) => window.__silentDepths.debugSetTactic(name), tactic),
    beginSkip: () => beginPatrolAndSkipTutorial(page),
    beginKeepTutorial: async () => {
      await page.evaluate(() => localStorage.removeItem('silent-depths-tutorial-v1'));
      await page.reload({ waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
      await page.locator('button[data-action="begin"]').click({ timeout: E2E_TIMEOUT_MS });
      await page.locator('#tutorial-overlay').waitFor({ state: 'visible', timeout: 8_000 });
    },
    hasSkip: async () => (await page.locator('[data-tutorial-action="skip"]').count()) > 0,
  };
}

/** @type {{ name: string, ok: boolean, detail?: string, ms: number, summary: unknown }[]} */
const journeys = [];
/** @type {{ journey: string, summary: unknown }[]} */
const samples = [];
let hudCoverage = null;
/** @type {{ width: number, height: number }} */
let viewport = PLAYTHROUGH_VIEWPORT;
let renderer = '';

const connected = await connectChromium(chromium, { headless: true, args: CHROMIUM_ARGS });
const { browser, via } = connected;
/** @type {import('playwright').BrowserContext | undefined} */
let context;
/** @type {import('playwright').Page | undefined} */
let page;

try {
  if (via === 'cdp') {
    context = browser.contexts()[0];
    if (!context) throw new Error('CDP browser has no default context');
    page = await context.newPage();
    await page.setViewportSize(PLAYTHROUGH_VIEWPORT);
  } else {
    context = await browser.newContext({ viewport: PLAYTHROUGH_VIEWPORT });
    page = await context.newPage();
  }
  const session = createSession(page);

  for (const journey of JOURNEY_RUNNERS) {
    const started = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
      const status = response?.status() ?? 0;
      if (status >= 400 || status === 0)
        throw new Error(`Preview load failed with status ${status}`);
      const result = await journey.run(session);
      const ms = Date.now() - started;
      journeys.push({
        name: journey.id,
        ok: result.ok,
        detail: result.detail,
        ms,
        summary: result.summary ?? null,
      });
      samples.push({ journey: journey.id, summary: result.summary ?? null });
      if (result.mapped) {
        if (!renderer && result.mapped.renderer) renderer = result.mapped.renderer;
        if (hudCoverage == null && result.mapped.viewport?.width) {
          viewport = result.mapped.viewport;
          hudCoverage = hudCoverageFraction(result.mapped.panels, viewport);
        }
      }
      console.log(`${result.ok ? 'PASS' : 'FAIL'} ${journey.id} (${ms}ms) ${result.detail}`);
    } catch (error) {
      const detail = String(error?.message || error);
      const ms = Date.now() - started;
      journeys.push({ name: journey.id, ok: false, detail, ms, summary: null });
      samples.push({ journey: journey.id, summary: null });
      console.error(`FAIL ${journey.id} (${ms}ms) ${detail}`);
    }
    await page.screenshot({ path: join(shotDir, `${journey.id}.png`) }).catch(() => {});
  }
} finally {
  if (!renderer && page) {
    const raw = await page.evaluate(dumpPlaythroughState).catch(() => null);
    if (raw) {
      const mapped = mapPlaythroughDump(raw);
      renderer = mapped.renderer;
      if (hudCoverage == null && mapped.viewport.width > 0) {
        viewport = mapped.viewport;
        hudCoverage = hudCoverageFraction(mapped.panels, viewport);
      }
    }
  }
  const report = buildReport({
    url,
    connection: via,
    renderer,
    hudCoverage,
    viewport,
    journeys,
    samples,
  });
  const outFile = join(shotDir, 'report.json');
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.visual);
  console.log(outFile);
  await page?.close().catch(() => {});
  if (via === 'launch') await context?.close().catch(() => {});
  await releaseBrowser(browser, via);
}

if (journeys.some((journey) => !journey.ok)) process.exitCode = 1;
