#!/usr/bin/env node
/**
 * Informational frame-time probe (median + p95). Not a hard gate until Plan 008.
 * Expects `npm run preview` (or `npm run dev`) on :8080.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, DEFAULT_URL, VIEWPORT, median, percentile } from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(__dirname, '..', 'artifacts');
const url = process.argv[2] || DEFAULT_URL;
const sampleMs = Number(process.env.FPS_BENCH_MS || 3000);

mkdirSync(artifactsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: CHROMIUM_ARGS,
});

try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);

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
  const fpsMedian = med > 0 ? 1000 / med : 0;
  const fpsP95 = p95 > 0 ? 1000 / p95 : 0;

  const report = {
    url,
    sampleMs,
    frames: frameTimes.length,
    frameTimeMs: { median: Number(med.toFixed(3)), p95: Number(p95.toFixed(3)) },
    fps: { median: Number(fpsMedian.toFixed(1)), atP95FrameTime: Number(fpsP95.toFixed(1)) },
    note: 'Informational until Plan 008; not a CI failure gate.',
  };

  const outPath = join(artifactsDir, 'fps-bench.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
} finally {
  await browser.close();
}
