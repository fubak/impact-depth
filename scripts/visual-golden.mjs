#!/usr/bin/env node
/**
 * Deterministic visual captures after entering a real patrol.
 * Screenshots are human-review artifacts — not self-approved PASS criteria.
 * Expects `npm run preview` already serving (default :8080).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  E2E_TIMEOUT_MS,
  VIEWPORT,
  attachErrorCollectors,
  attachFailedRequestTracker,
  assertPlaying,
  beginPatrolAndSkipTutorial,
  readQualityLabel,
  readRendererInfo,
  setMode,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts', 'visual');
const url = process.argv[2] || DEFAULT_URL;

/** @type {[string, 'tactical' | 'chase' | 'bridge' | 'periscope' | 'map' | 'sonar'][]} */
const captures = [
  ['caribbean-noon-tactical', 'tactical'],
  ['underwater-chase', 'chase'],
  ['bridge-convoy', 'bridge'],
  ['periscope-convoy', 'periscope'],
  ['shore-map', 'map'],
  ['sonar-plot', 'sonar'],
];

mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
const context = await browser.newContext({ viewport: VIEWPORT });
await context.addInitScript(() => {
  try {
    localStorage.removeItem('silent-depths-tutorial-v1');
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
const { consoleErrors, pageErrors } = attachErrorCollectors(page);
const failedRequests = attachFailedRequestTracker(page, url);
const errors = [];

try {
  const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  const status = resp?.status() ?? 0;
  if (status >= 400 || status === 0) {
    throw new Error(`Preview load failed with status ${status}`);
  }

  await page.waitForSelector('#hud', { timeout: E2E_TIMEOUT_MS });
  await beginPatrolAndSkipTutorial(page);

  // Wait for first-party canvas + WebGL before capturing.
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#scene');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return Boolean(gl) && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: E2E_TIMEOUT_MS },
  );
  await page.waitForTimeout(600);

  await assertPlaying(page);
  const patrolHidden = (await page.locator('#patrol-overlay').getAttribute('hidden')) !== null;
  const tutorialHidden = (await page.locator('#tutorial-overlay').getAttribute('hidden')) !== null;
  if (!patrolHidden) throw new Error('#patrol-overlay still visible — menu/result obscures canvas');
  if (!tutorialHidden)
    throw new Error('#tutorial-overlay still visible — tutorial obscures canvas');

  /** @type {{ name: string, mode: string, path: string }[]} */
  const taken = [];
  for (const [name, mode] of captures) {
    await setMode(page, mode);
    await page.waitForTimeout(500);
    await assertPlaying(page);
    const path = join(artifacts, `${name}.png`);
    await page.screenshot({ path });
    taken.push({ name, mode, path });
  }

  const rendererInfo = await readRendererInfo(page);
  const quality = await readQualityLabel(page);
  const allErrors = [...pageErrors, ...consoleErrors, ...errors];
  if (failedRequests.length) {
    allErrors.push(...failedRequests.map((f) => `request ${f.status} ${f.url}`));
  }

  const report = {
    ok: allErrors.length === 0,
    url,
    status,
    phase: 'playing',
    viewport: VIEWPORT,
    quality,
    renderer: rendererInfo.renderer,
    vendor: rendererInfo.vendor,
    overlay: {
      patrolHidden: true,
      tutorialHidden: true,
    },
    modes: taken.map((c) => c.mode),
    captures: taken,
    errors: allErrors,
    note: 'Screenshots are human-review artifacts; do not treat capture exit 0 as visual PASS.',
  };

  writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (report.phase !== 'playing') process.exitCode = 1;
  if (!patrolHidden || !tutorialHidden) process.exitCode = 1;
  if (taken.length !== 6) process.exitCode = 1;
  if (allErrors.length) process.exitCode = 2;
} catch (err) {
  const fail = {
    ok: false,
    url,
    phase: 'unknown',
    error: String(err?.message || err),
    errors: [...pageErrors, ...consoleErrors, String(err?.message || err)],
    failedRequests,
  };
  writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
