#!/usr/bin/env node
/**
 * Frame-time probe (median + p95) after entering a patrol.
 * Headless Chromium is often software-rendered; treat numbers as directional,
 * and prefer a GPU desktop Chromium for the ≥55 FPS acceptance gate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, DEFAULT_URL, VIEWPORT, median, percentile } from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(__dirname, '..', 'artifacts');
const url = process.argv[2] || DEFAULT_URL;
const sampleMs = Number(process.env.FPS_BENCH_MS || 4000);
const warmupMs = Number(process.env.FPS_WARMUP_MS || 1000);
const authoritative = process.env.PERF_AUTHORITATIVE === '1';
const headed = process.env.PERF_HEADED === '1';
const expectedQuality = process.env.PERF_QUALITY || null;

if (expectedQuality && !['high', 'medium', 'low'].includes(expectedQuality)) {
  throw new Error(`PERF_QUALITY must be high, medium, or low; received ${expectedQuality}`);
}
if (authoritative && !headed) {
  throw new Error('PERF_AUTHORITATIVE=1 requires PERF_HEADED=1');
}

mkdirSync(artifactsDir, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: authoritative ? [...CHROMIUM_ARGS] : [...CHROMIUM_ARGS, '--use-gl=angle', '--enable-webgl'],
});

try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const browserErrors = [];
  page.on('pageerror', (e) => {
    browserErrors.push(`PAGEERROR ${e.message}`);
    console.log('PAGEERROR', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      browserErrors.push(`CONSOLE ${m.text()}`);
      console.log('CONSOLE', m.text());
    }
  });

  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('#hud', { timeout: 45000 });
  const begin = page.locator('button[data-action="begin"]');
  if ((await begin.count()) > 0) {
    await begin.first().click();
    await page.waitForTimeout(800);
  }
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

  const med = median(frameTimes);
  const p95 = percentile(frameTimes, 95);
  const p99 = percentile(frameTimes, 99);
  const fpsMedian = med > 0 ? 1000 / med : 0;
  const fpsP95 = p95 > 0 ? 1000 / p95 : 0;

  const probe = await page.evaluate(() => window.__silentDepths?.getPerformanceProbe?.() ?? null);
  const failures = [];
  if (browserErrors.length > 0) failures.push(`${browserErrors.length} browser error(s)`);
  if (!probe) failures.push('performance probe unavailable');
  if (expectedQuality && probe?.quality !== expectedQuality) {
    failures.push(`actual quality ${probe?.quality ?? 'unknown'} did not match ${expectedQuality}`);
  }
  if (
    probe?.environment &&
    (probe.environment.backend !== probe.environment.requestedBackend || !probe.environment.ready)
  ) {
    failures.push('requested and actual backend/readiness did not match');
  }
  if (authoritative && (probe?.graphics?.software !== false || !probe?.graphics?.renderer)) {
    failures.push('authoritative run requires a known hardware renderer');
  }
  const p95Limit =
    expectedQuality === 'high' ? 1000 / 55 : expectedQuality === 'medium' ? 1000 / 30 : null;
  if (authoritative && p95Limit !== null && p95 > p95Limit) {
    failures.push(`p95 ${p95.toFixed(3)}ms exceeded ${p95Limit.toFixed(3)}ms`);
  }

  const report = {
    url,
    warmupMs,
    sampleMs,
    authoritative,
    headed,
    expectedQuality,
    frames: frameTimes.length,
    frameTimeMs: {
      median: Number(med.toFixed(3)),
      p95: Number(p95.toFixed(3)),
      p99: Number(p99.toFixed(3)),
    },
    fps: { median: Number(fpsMedian.toFixed(1)), atP95FrameTime: Number(fpsP95.toFixed(1)) },
    probe,
    browserErrors,
    failures,
    result: failures.length === 0 ? (authoritative ? 'MEASURED' : 'DIRECTIONAL') : 'FAILED',
    note: authoritative
      ? 'Hardware classification and frame-time threshold were enforced; operator acceptance remains separate.'
      : 'Directional probe only; it does not establish a hardware performance PASS.',
  };

  const outPath = join(artifactsDir, 'fps-bench.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
