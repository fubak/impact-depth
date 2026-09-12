#!/usr/bin/env node
/**
 * Spectral ocean E2E against production preview.
 * Expects `npm run preview` already serving (default :8080).
 * Opens ?ocean=spectral&world=legacy-v1&quality=high and fails if the backend
 * silently falls back to Gerstner.
 * Artifacts: artifacts/e2e-ocean.json
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
  fireSelected,
  navigateHelm,
  pauseAndResume,
  pollUntil,
  readEnvironmentDiagnostics,
  restartPatrolViaReload,
  setMode,
} from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifactsDir = join(root, 'artifacts');
const outJson = join(artifactsDir, 'e2e-ocean.json');

mkdirSync(artifactsDir, { recursive: true });

function spectralUrl(base) {
  const url = new URL(base || DEFAULT_URL);
  url.searchParams.set('ocean', 'spectral');
  url.searchParams.set('world', 'legacy-v1');
  url.searchParams.set('quality', 'high');
  return url.toString();
}

const url = spectralUrl(process.argv[2] || DEFAULT_URL);

/** @typedef {{ name: string, ok: boolean, detail?: string, ms: number }} JourneyResult */

/** @type {JourneyResult[]} */
const journeys = [];
/** @type {string[]} */
const hardErrors = [];

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function runJourney(name, fn) {
  const started = Date.now();
  try {
    await fn();
    journeys.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    const detail = String(err?.message || err);
    journeys.push({ name, ok: false, detail, ms: Date.now() - started });
    console.error(`FAIL ${name}: ${detail}`);
    throw err;
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function assertSpectralReady(page) {
  await pollUntil(
    page,
    E2E_TIMEOUT_MS,
    async () => {
      const diag = await readEnvironmentDiagnostics(page);
      return Boolean(diag && diag.backend === 'spectral' && diag.ready);
    },
    'spectral environment backend ready',
  );
  const diag = await readEnvironmentDiagnostics(page);
  if (!diag) throw new Error('window.__silentDepths.getEnvironmentDiagnostics() missing');
  if (diag.backend !== 'spectral' || !diag.ready) {
    throw new Error(
      `spectral coverage failed (silent fallback is not coverage): ${JSON.stringify(diag)}`,
    );
  }
  if (diag.fallbackReason) {
    throw new Error(`spectral fallbackReason=${diag.fallbackReason}`);
  }
}

const browser = await chromium.launch({
  headless: true,
  args: CHROMIUM_ARGS,
});

/** @type {import('playwright').BrowserContext | undefined} */
let context;
/** @type {import('playwright').Page | undefined} */
let page;
/** @type {ReturnType<typeof attachErrorCollectors> | undefined} */
let collectors;
/** @type {ReturnType<typeof attachFailedRequestTracker> | undefined} */
let failedRequests;
let navStatus = 0;

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
  failedRequests = attachFailedRequestTracker(page, url);

  await runJourney('boot-spectral-patrol', async () => {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
    navStatus = resp?.status() ?? 0;
    if (navStatus >= 400 || navStatus === 0) {
      throw new Error(`Preview load failed with status ${navStatus}`);
    }
    await beginPatrolAndSkipTutorial(page);
    await assertSpectralReady(page);
    await assertPlaying(page);
  });

  await runJourney('tactical-and-periscope', async () => {
    await setMode(page, 'tactical');
    await setMode(page, 'periscope');
    await setMode(page, 'tactical');
    await assertSpectralReady(page);
  });

  await runJourney('helm-navigation', async () => {
    await navigateHelm(page);
  });

  await runJourney('targeting-fire', async () => {
    await fireSelected(page);
  });

  await runJourney('pause-resume', async () => {
    await pauseAndResume(page);
  });

  await runJourney('restart-reentry', async () => {
    await restartPatrolViaReload(page);
    await assertSpectralReady(page);
  });

  if (collectors.pageErrors.length || collectors.consoleErrors.length) {
    hardErrors.push(
      `console/page errors: ${JSON.stringify({
        pageErrors: collectors.pageErrors,
        consoleErrors: collectors.consoleErrors,
      })}`,
    );
  }
  if (failedRequests.length) {
    hardErrors.push(`first-party request failures: ${JSON.stringify(failedRequests.slice(0, 20))}`);
  }

  const diagnostics = await readEnvironmentDiagnostics(page);
  const result = {
    ok: hardErrors.length === 0 && journeys.every((j) => j.ok),
    url,
    status: navStatus,
    diagnostics,
    journeys,
    consoleErrors: collectors.consoleErrors,
    pageErrors: collectors.pageErrors,
    failedRequests,
    hardErrors,
  };
  writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) process.exit(hardErrors.length ? 2 : 1);
  process.exit(0);
} catch (err) {
  let diagnostics = null;
  try {
    if (page) diagnostics = await readEnvironmentDiagnostics(page);
  } catch {
    /* ignore */
  }
  const fail = {
    ok: false,
    url,
    error: String(err?.message || err),
    diagnostics,
    journeys,
    consoleErrors: collectors?.consoleErrors ?? [],
    pageErrors: collectors?.pageErrors ?? [],
    failedRequests: failedRequests ?? [],
    hardErrors,
  };
  writeFileSync(outJson, `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
