#!/usr/bin/env node
/**
 * Plan 021 session A baseline: record commit metadata + surface diagnostics.
 * Screenshots are human-review artifacts — not self-approved PASS.
 *
 * Expects preview already serving.
 *   node scripts/look-021.mjs http://127.0.0.1:8082/
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  E2E_TIMEOUT_MS,
  VIEWPORT,
  assertPlaying,
  attachErrorCollectors,
  attachFailedRequestTracker,
  beginPatrolAndSkipTutorial,
  setMode,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts', 'plan-021');
const url = process.argv[2] || DEFAULT_URL;
const commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();

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

try {
  const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  const status = resp?.status() ?? 0;
  if (status >= 400 || status === 0) {
    throw new Error(`Preview load failed with status ${status}`);
  }

  await page.waitForSelector('#hud', { timeout: E2E_TIMEOUT_MS });
  await beginPatrolAndSkipTutorial(page);
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#scene');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return Boolean(gl) && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: E2E_TIMEOUT_MS },
  );
  await page.waitForTimeout(1500);
  await assertPlaying(page);

  const snapshot = await page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app) return null;
    return {
      surface: typeof app.getSurfaceDiagnostics === 'function' ? app.getSurfaceDiagnostics() : null,
      environment:
        typeof app.getEnvironmentDiagnostics === 'function'
          ? app.getEnvironmentDiagnostics()
          : null,
      outdoor:
        typeof app.getOutdoorLightingDiagnostics === 'function'
          ? app.getOutdoorLightingDiagnostics()
          : null,
      performance: typeof app.getPerformanceProbe === 'function' ? app.getPerformanceProbe() : null,
    };
  });

  await setMode(page, 'bridge');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, 'bridge-waterline.png') });

  await setMode(page, 'tactical');
  await page.evaluate(() => {
    const app = window.__silentDepths;
    const cameras = app?.cameras;
    const vessel = app?.sim?.vessel;
    if (!cameras || !vessel) return;
    cameras.orbitTheta = Math.atan2(vessel.x - 55, vessel.z + 95);
    cameras.orbitRadius = 108;
    cameras.orbitPhi = 1.05;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(artifacts, 'tactical-cay.png') });

  const report = {
    commit,
    url,
    viewport: VIEWPORT,
    snapshot,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(),
    note: 'Baseline capture for Plan 021 A/B. Not visual or GPU certification.',
  };
  writeFileSync(join(artifacts, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, commit, snapshot: snapshot?.surface ?? null }, null, 2));
} finally {
  await browser.close();
}
