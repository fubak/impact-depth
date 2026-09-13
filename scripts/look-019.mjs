#!/usr/bin/env node
/**
 * Plan 019 look-match captures: bridge waterline + tactical shallows.
 * Screenshots are human-review artifacts — not self-approved PASS.
 *
 * Expects preview already serving.
 *   node scripts/look-019.mjs http://127.0.0.1:8082/
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
  assertPlaying,
  attachErrorCollectors,
  attachFailedRequestTracker,
  beginPatrolAndSkipTutorial,
  setMode,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts', 'plan-019');
const url = process.argv[2] || DEFAULT_URL;

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
const hdrHits = [];
page.on('response', (res) => {
  if (res.url().includes('kloofendal') || res.url().includes('.hdr')) {
    hdrHits.push({ url: res.url(), status: res.status() });
  }
});

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
  await page.waitForTimeout(1200);
  await assertPlaying(page);

  const outdoor = await page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app || typeof app.getOutdoorLightingDiagnostics !== 'function') return null;
    return app.getOutdoorLightingDiagnostics();
  });

  await setMode(page, 'bridge');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, 'bridge-waterline.png') });

  await setMode(page, 'tactical');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, 'tactical-shallows.png') });

  const rollback = new URL(url);
  rollback.searchParams.set('ocean', 'gerstner');
  rollback.searchParams.set('world', 'legacy-v1');
  const rollbackResp = await page.goto(rollback.toString(), { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  if ((rollbackResp?.status() ?? 0) >= 400) {
    throw new Error(`Gerstner rollback load failed with status ${rollbackResp?.status()}`);
  }
  await page.waitForSelector('#hud', { timeout: E2E_TIMEOUT_MS });
  await beginPatrolAndSkipTutorial(page);
  await assertPlaying(page);
  await setMode(page, 'tactical');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(artifacts, 'rollback-gerstner-tactical.png') });
  const rollbackEnv = await page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app || typeof app.getEnvironmentDiagnostics !== 'function') return null;
    return app.getEnvironmentDiagnostics();
  });

  const probe = {
    url,
    outdoor,
    hdrHits,
    rollback: rollback.toString(),
    rollbackEnv,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(),
  };
  writeFileSync(join(artifacts, 'probe.json'), `${JSON.stringify(probe, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, ...probe }, null, 2));
} finally {
  await browser.close();
}
