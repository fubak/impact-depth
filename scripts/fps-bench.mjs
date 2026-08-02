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

mkdirSync(artifactsDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [...CHROMIUM_ARGS, '--use-gl=angle', '--enable-webgl'],
});

try {
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });

  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('#hud', { timeout: 45000 });
  const begin = page.locator('button[data-action="begin"]');
  if ((await begin.count()) > 0) {
    await begin.first().click();
    await page.waitForTimeout(800);
  }

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
    note: 'Headless probe after Begin Patrol. GPU desktop Chromium is authoritative for ≥55 FPS.',
  };

  const outPath = join(artifactsDir, 'fps-bench.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
} finally {
  await browser.close();
}
