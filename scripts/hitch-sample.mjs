#!/usr/bin/env node
/**
 * Cruise hitch sampler: rAF deltas after Begin Patrol while moving.
 * Writes JSON with over-100ms frame counts. Not an operator GPU PASS.
 *
 * Usage:
 *   node scripts/hitch-sample.mjs <url> [out.json]
 * Env:
 *   HITCH_WARMUP_MS (default 2500)
 *   HITCH_SAMPLE_MS (default 12000)
 *   HITCH_THRESHOLD_MS (default 100)
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
  beginPatrolAndSkipTutorial,
  median,
  percentile,
  readEnvironmentDiagnostics,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || DEFAULT_URL;
const outPath = process.argv[3] || join(root, 'artifacts', 'plan-018-finish', 'hitch-sample.json');
const warmupMs = Number(process.env.HITCH_WARMUP_MS || 2500);
const sampleMs = Number(process.env.HITCH_SAMPLE_MS || 12000);
const thresholdMs = Number(process.env.HITCH_THRESHOLD_MS || 100);

mkdirSync(dirname(outPath), { recursive: true });

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
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(warmupMs);

  const frameTimes = await page.evaluate(async (ms) => {
    return new Promise((resolve) => {
      /** @type {number[]} */
      const deltas = [];
      let last = performance.now();
      const start = last;
      function tick(now) {
        deltas.push(now - last);
        last = now;
        if (now - start >= ms) {
          resolve(deltas);
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, sampleMs);

  const overThreshold = frameTimes.filter((dt) => dt > thresholdMs);
  const med = median(frameTimes);
  const p95 = percentile(frameTimes, 95);
  const p99 = percentile(frameTimes, 99);
  const max = frameTimes.reduce((a, b) => Math.max(a, b), 0);
  const environment = await readEnvironmentDiagnostics(page);
  const probe = await page.evaluate(() => window.__silentDepths?.getPerformanceProbe?.() ?? null);
  const errors = [...pageErrors, ...consoleErrors];
  if (failedRequests.length) {
    errors.push(...failedRequests.map((f) => `request ${f.status} ${f.url}`));
  }

  const report = {
    url,
    warmupMs,
    sampleMs,
    thresholdMs,
    frames: frameTimes.length,
    overThreshold: overThreshold.length,
    overThresholdMs: overThreshold.map((dt) => Number(dt.toFixed(3))),
    frameTimeMs: {
      median: Number(med.toFixed(3)),
      p95: Number(p95.toFixed(3)),
      p99: Number(p99.toFixed(3)),
      max: Number(max.toFixed(3)),
    },
    fps: { median: med > 0 ? Number((1000 / med).toFixed(1)) : 0 },
    environment,
    probe,
    errors,
    result: overThreshold.length === 0 && errors.length === 0 ? 'CLEAN' : 'FAIL',
    note: 'Machine hitch sample only; not operator GPU ≥55 ACCEPT.',
  };

  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== 'CLEAN') process.exitCode = 1;
} catch (err) {
  const fail = {
    url,
    result: 'FAIL',
    error: String(err?.message || err),
    errors: [...pageErrors, ...consoleErrors, String(err?.message || err)],
  };
  writeFileSync(outPath, `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
