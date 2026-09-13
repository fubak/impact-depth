#!/usr/bin/env node
/**
 * Frame-time probe (median + p95) after entering a patrol.
 *
 * Environment matrix (explicit FPS_WARMUP_MS / FPS_BENCH_MS always win when set):
 *
 * Casual (directional, cheap CI):
 *   npm run test:fps -- URL
 *   Defaults when warmup/sample env unset: FPS_WARMUP_MS=1000, FPS_BENCH_MS=4000
 *
 * Authoritative (hardware classification + p95 threshold; not operator GPU PASS):
 *   $env:PERF_AUTHORITATIVE=1; $env:PERF_HEADED=1; $env:PERF_QUALITY="high"; npm run test:fps -- URL
 *   Defaults when warmup/sample env unset: FPS_WARMUP_MS=30000, FPS_BENCH_MS=60000
 *
 * Optional overrides (any mode):
 *   FPS_WARMUP_MS, FPS_BENCH_MS, PERF_HEADED=1, PERF_QUALITY=high|medium|low
 *
 * Headless Chromium is often software-rendered; treat casual numbers as directional.
 * Authoritative mode rejects software or unknown renderers and may emit result MEASURED
 * when checks pass; it does not mark operator GPU PASS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, DEFAULT_URL, VIEWPORT, median, percentile } from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = join(__dirname, '..', 'artifacts');

const CASUAL_WARMUP_MS = 1000;
const CASUAL_SAMPLE_MS = 4000;
const AUTHORITATIVE_WARMUP_MS = 30000;
const AUTHORITATIVE_SAMPLE_MS = 60000;

/** @param {NodeJS.ProcessEnv} env */
function isEnvSet(env, name) {
  const value = env[name];
  return value !== undefined && value !== '';
}

/**
 * Resolve warmup/sample durations from env. Explicit FPS_* vars always win.
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveBenchDurations(env) {
  const authoritative = env.PERF_AUTHORITATIVE === '1';
  const warmupMs = isEnvSet(env, 'FPS_WARMUP_MS')
    ? Number(env.FPS_WARMUP_MS)
    : authoritative
      ? AUTHORITATIVE_WARMUP_MS
      : CASUAL_WARMUP_MS;
  const sampleMs = isEnvSet(env, 'FPS_BENCH_MS')
    ? Number(env.FPS_BENCH_MS)
    : authoritative
      ? AUTHORITATIVE_SAMPLE_MS
      : CASUAL_SAMPLE_MS;
  return { warmupMs, sampleMs, authoritative };
}

/** @param {unknown} probe */
export function authoritativeRejectsSoftwareRenderer(probe) {
  return probe?.graphics?.software !== false || !probe?.graphics?.renderer;
}

function assertSelfCheck(condition, message) {
  if (!condition) {
    throw new Error(`self-check failed: ${message}`);
  }
}

function runSelfCheck() {
  const casual = resolveBenchDurations({});
  assertSelfCheck(casual.warmupMs === CASUAL_WARMUP_MS, `casual warmup ${casual.warmupMs}`);
  assertSelfCheck(casual.sampleMs === CASUAL_SAMPLE_MS, `casual sample ${casual.sampleMs}`);
  assertSelfCheck(!casual.authoritative, 'casual authoritative flag');

  const authoritative = resolveBenchDurations({ PERF_AUTHORITATIVE: '1' });
  assertSelfCheck(
    authoritative.warmupMs === AUTHORITATIVE_WARMUP_MS,
    `authoritative warmup ${authoritative.warmupMs}`,
  );
  assertSelfCheck(
    authoritative.sampleMs === AUTHORITATIVE_SAMPLE_MS,
    `authoritative sample ${authoritative.sampleMs}`,
  );
  assertSelfCheck(authoritative.authoritative, 'authoritative flag');

  const overrideWarmup = resolveBenchDurations({
    PERF_AUTHORITATIVE: '1',
    FPS_WARMUP_MS: '5000',
  });
  assertSelfCheck(overrideWarmup.warmupMs === 5000, 'FPS_WARMUP_MS override');
  assertSelfCheck(
    overrideWarmup.sampleMs === AUTHORITATIVE_SAMPLE_MS,
    'authoritative sample preserved',
  );

  const overrideSample = resolveBenchDurations({ FPS_BENCH_MS: '8000' });
  assertSelfCheck(overrideSample.warmupMs === CASUAL_WARMUP_MS, 'casual warmup preserved');
  assertSelfCheck(overrideSample.sampleMs === 8000, 'FPS_BENCH_MS override');

  assertSelfCheck(
    authoritativeRejectsSoftwareRenderer({ graphics: { software: true, renderer: 'SwiftShader' } }),
    'software renderer rejected',
  );
  assertSelfCheck(
    authoritativeRejectsSoftwareRenderer({ graphics: { software: false } }),
    'missing renderer rejected',
  );
  assertSelfCheck(
    !authoritativeRejectsSoftwareRenderer({
      graphics: { software: false, renderer: 'ANGLE (NVIDIA GeForce RTX 3080)' },
    }),
    'hardware renderer accepted',
  );
  assertSelfCheck(authoritativeRejectsSoftwareRenderer(null), 'missing probe rejected');

  console.log('fps-bench self-check ok');
}

if (process.argv[2] === '--self-check') {
  runSelfCheck();
  process.exit(0);
}

const url = process.argv[2] || DEFAULT_URL;
const { warmupMs, sampleMs, authoritative } = resolveBenchDurations(process.env);
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
  if (authoritative && authoritativeRejectsSoftwareRenderer(probe)) {
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
