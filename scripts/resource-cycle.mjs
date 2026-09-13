#!/usr/bin/env node
/**
 * Plan 018 G4 — 20× mission/backend and 20× resize/quality resource cycles.
 * Expects preview already serving (default http://127.0.0.1:8082/).
 * Asserts WebGL owned-resource counts stay within documented slack vs warmup baseline.
 * Artifacts: artifacts/plan-018-finish/resource-cycles.json
 *
 * Not an operator GPU PASS.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  E2E_TIMEOUT_MS,
  RESOURCE_CYCLE_SLACK_ABS,
  RESOURCE_CYCLE_SLACK_MULTIPLIER,
  VIEWPORT,
  VIEWPORT_COMPACT,
  attachErrorCollectors,
  attachFailedRequestTracker,
  assertPlaying,
  beginPatrolAndSkipTutorial,
  checkResourceCycleMonotonicGrowth,
  checkResourceCycleSlack,
  extractResourceCounts,
  pollUntil,
  readEnvironmentDiagnostics,
  readPerformanceProbe,
  readRendererInfo,
} from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outJson = join(root, 'artifacts', 'plan-018-finish', 'resource-cycles.json');

/** Preview on 8082 when 8080 is busy (see tasks/state.md). */
const DEFAULT_RESOURCE_CYCLE_URL = 'http://127.0.0.1:8082/';

const CYCLE_COUNT = 20;
const WARMUP_MS = Number(process.env.RESOURCE_CYCLE_WARMUP_MS || 2500);
const SETTLE_MS = Number(process.env.RESOURCE_CYCLE_SETTLE_MS || 400);

const OCEANS = ['gerstner', 'spectral'];
const WORLDS = ['legacy-v1', 'littoral-v2'];
const QUALITIES = ['high', 'medium', 'low'];
const VIEWPORTS = [VIEWPORT, VIEWPORT_COMPACT];

/**
 * @param {string} base
 * @param {{ ocean?: string, world?: string, quality?: string }} params
 */
function buildUrl(base, params) {
  const url = new URL(base || DEFAULT_RESOURCE_CYCLE_URL);
  if (params.ocean) url.searchParams.set('ocean', params.ocean);
  if (params.world) url.searchParams.set('world', params.world);
  if (params.quality) url.searchParams.set('quality', params.quality);
  return url.toString();
}

/**
 * @param {import('playwright').Page} page
 * @param {{ ocean?: string, world?: string, quality?: string }} expected
 */
async function waitForEnvironmentReady(page, expected = {}) {
  await pollUntil(
    page,
    E2E_TIMEOUT_MS,
    async () => {
      const diag = await readEnvironmentDiagnostics(page);
      if (!diag?.ready) return false;
      if (expected.ocean && diag.backend !== expected.ocean) return false;
      if (expected.world && diag.worldVersion !== expected.world) return false;
      return true;
    },
    'environment diagnostics ready',
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} targetUrl
 * @param {{ ocean?: string, world?: string, quality?: string }} expected
 */
async function gotoPatrolReady(page, targetUrl, expected = {}) {
  const resp = await page.goto(targetUrl, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  const status = resp?.status() ?? 0;
  if (status >= 400 || status === 0) {
    throw new Error(`Preview load failed with status ${status} for ${targetUrl}`);
  }
  await page.waitForSelector('#hud', { timeout: E2E_TIMEOUT_MS });
  await beginPatrolAndSkipTutorial(page);
  await waitForEnvironmentReady(page, expected);
  await assertPlaying(page);
  if (expected.quality) {
    const probe = await readPerformanceProbe(page);
    if (probe?.quality !== expected.quality) {
      throw new Error(
        `qualityForced mismatch: expected ${expected.quality}, probe quality=${probe?.quality ?? 'missing'}`,
      );
    }
  }
  await page.waitForTimeout(SETTLE_MS);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const scriptPath = fileURLToPath(import.meta.url);
  const argvPath = resolve(process.argv[1]);
  return scriptPath === argvPath || scriptPath.toLowerCase() === argvPath.toLowerCase();
}

async function runResourceCycleHarness() {
  const baseUrl = process.argv[2] || DEFAULT_RESOURCE_CYCLE_URL;
  mkdirSync(dirname(outJson), { recursive: true });

  /** @type {string[]} */
  const hardErrors = [];
  /** @type {Array<{ class: string, index: number, url: string, counts: ReturnType<typeof extractResourceCounts>, environment: unknown, ms: number }>} */
  const cycleSnapshots = [];

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  /** @type {import('playwright').BrowserContext | undefined} */
  let context;
  /** @type {import('playwright').Page | undefined} */
  let page;
  /** @type {ReturnType<typeof attachErrorCollectors> | undefined} */
  let collectors;
  /** @type {ReturnType<typeof attachFailedRequestTracker> | undefined} */
  let failedRequests;

  try {
    context = await browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript(() => {
      try {
        localStorage.removeItem('silent-depths-tutorial-v1');
      } catch {
        /* ignore */
      }
    });
    page = await context.newPage();
    collectors = attachErrorCollectors(page);
    failedRequests = attachFailedRequestTracker(page, baseUrl);

    const bootUrl = buildUrl(baseUrl, {
      ocean: 'gerstner',
      world: 'legacy-v1',
      quality: 'high',
    });
    console.log(`Boot ${bootUrl}`);
    await gotoPatrolReady(page, bootUrl, {
      ocean: 'gerstner',
      world: 'legacy-v1',
      quality: 'high',
    });
    await page.waitForTimeout(WARMUP_MS);

    const warmupProbe = await readPerformanceProbe(page);
    if (!warmupProbe)
      throw new Error('window.__silentDepths.getPerformanceProbe() missing after warmup');
    const warmupCounts = extractResourceCounts(warmupProbe);
    const warmupEnvironment = await readEnvironmentDiagnostics(page);
    const warmupRenderer = await readRendererInfo(page);

    /** @type {ReturnType<typeof extractResourceCounts>[]} */
    const classASamples = [warmupCounts];
    /** @type {ReturnType<typeof extractResourceCounts>[]} */
    const classBSamples = [];

    console.log(`Class A: ${CYCLE_COUNT} mission/backend reload cycles`);
    for (let i = 0; i < CYCLE_COUNT; i++) {
      const started = Date.now();
      const ocean = OCEANS[i % OCEANS.length];
      const world = WORLDS[i % WORLDS.length];
      const cycleUrl = buildUrl(baseUrl, { ocean, world, quality: 'high' });
      await gotoPatrolReady(page, cycleUrl, { ocean, world, quality: 'high' });
      const probe = await readPerformanceProbe(page);
      const counts = extractResourceCounts(probe);
      const environment = await readEnvironmentDiagnostics(page);
      classASamples.push(counts);
      cycleSnapshots.push({
        class: 'A',
        index: i,
        url: cycleUrl,
        counts,
        environment,
        ms: Date.now() - started,
      });
      hardErrors.push(...checkResourceCycleSlack(warmupCounts, counts, `class-A cycle ${i + 1}`));
      console.log(
        `  A${i + 1}/${CYCLE_COUNT} ocean=${ocean} world=${world} geo=${counts.geometries} tex=${counts.textures} prog=${counts.programs}`,
      );
    }

    hardErrors.push(...checkResourceCycleMonotonicGrowth(classASamples, 'class-A'));

    const afterClassAProbe = await readPerformanceProbe(page);
    const afterClassACounts = extractResourceCounts(afterClassAProbe);
    hardErrors.push(...checkResourceCycleSlack(warmupCounts, afterClassACounts, 'after class-A'));

    console.log(`Class B: ${CYCLE_COUNT} resize/quality cycles`);
    for (let i = 0; i < CYCLE_COUNT; i++) {
      const started = Date.now();
      const viewport = VIEWPORTS[i % VIEWPORTS.length];
      const quality = QUALITIES[i % QUALITIES.length];
      await page.setViewportSize(viewport);
      const diag = await readEnvironmentDiagnostics(page);
      const cycleUrl = buildUrl(baseUrl, {
        ocean: diag?.backend ?? 'gerstner',
        world: diag?.worldVersion ?? 'legacy-v1',
        quality,
      });
      await gotoPatrolReady(page, cycleUrl, { quality });
      const probe = await readPerformanceProbe(page);
      const counts = extractResourceCounts(probe);
      const environment = await readEnvironmentDiagnostics(page);
      classBSamples.push(counts);
      cycleSnapshots.push({
        class: 'B',
        index: i,
        url: cycleUrl,
        counts,
        environment,
        ms: Date.now() - started,
      });
      hardErrors.push(...checkResourceCycleSlack(warmupCounts, counts, `class-B cycle ${i + 1}`));
      console.log(
        `  B${i + 1}/${CYCLE_COUNT} ${viewport.width}×${viewport.height} quality=${quality} geo=${counts.geometries} tex=${counts.textures} prog=${counts.programs}`,
      );
    }

    hardErrors.push(...checkResourceCycleMonotonicGrowth(classBSamples, 'class-B'));

    const finalProbe = await readPerformanceProbe(page);
    const finalCounts = extractResourceCounts(finalProbe);
    hardErrors.push(...checkResourceCycleSlack(warmupCounts, finalCounts, 'after class-B'));

    if (collectors.pageErrors.length || collectors.consoleErrors.length) {
      hardErrors.push(
        `console/page errors: ${JSON.stringify({
          pageErrors: collectors.pageErrors.slice(0, 5),
          consoleErrors: collectors.consoleErrors.slice(0, 5),
        })}`,
      );
    }
    if (failedRequests.length) {
      hardErrors.push(
        `first-party request failures: ${JSON.stringify(failedRequests.slice(0, 10))}`,
      );
    }

    const report = {
      ok: hardErrors.length === 0,
      url: baseUrl,
      cycleCount: CYCLE_COUNT,
      warmupMs: WARMUP_MS,
      settleMs: SETTLE_MS,
      slackPolicy: {
        formula: 'limit = baseline * RESOURCE_CYCLE_SLACK_MULTIPLIER + RESOURCE_CYCLE_SLACK_ABS',
        RESOURCE_CYCLE_SLACK_MULTIPLIER,
        RESOURCE_CYCLE_SLACK_ABS,
        rationale:
          'Three.js retains shader programs and shared texture caches across backend/quality switches; owned geometry/texture counts should not grow unbounded (3× warmup + 32 headroom). Strict monotonic increase across all cycles also fails.',
      },
      warmup: {
        probe: warmupProbe,
        counts: warmupCounts,
        environment: warmupEnvironment,
        renderer: warmupRenderer,
      },
      afterClassA: { counts: afterClassACounts, probe: afterClassAProbe },
      final: {
        counts: finalCounts,
        probe: finalProbe,
        environment: await readEnvironmentDiagnostics(page),
      },
      classASamples,
      classBSamples,
      cycles: cycleSnapshots,
      consoleErrors: collectors.consoleErrors,
      pageErrors: collectors.pageErrors,
      failedRequests,
      hardErrors,
      result: hardErrors.length === 0 ? 'PASS' : 'FAIL',
      note: 'Resource-cycle harness only; not operator GPU ≥55 ACCEPT.',
    };

    writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${outJson}`);
    process.exit(hardErrors.length === 0 ? 0 : 1);
  } catch (err) {
    const fail = {
      ok: false,
      url: baseUrl,
      error: String(err?.message || err),
      cycles: cycleSnapshots,
      consoleErrors: collectors?.consoleErrors ?? [],
      pageErrors: collectors?.pageErrors ?? [],
      failedRequests: failedRequests ?? [],
      hardErrors,
      result: 'FAIL',
      note: 'Resource-cycle harness only; not operator GPU ≥55 ACCEPT.',
    };
    writeFileSync(outJson, `${JSON.stringify(fail, null, 2)}\n`);
    console.error(JSON.stringify(fail, null, 2));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

if (isDirectRun()) {
  runResourceCycleHarness().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
