#!/usr/bin/env node
/**
 * Plan 015 delayed-GLB journey: Begin while models/v2 is held, play on
 * procedural fallbacks, then release and assert a glTF hot-swap without
 * duplicate pick ids. Expects production preview already serving.
 * Artifacts: artifacts/e2e-delayed-assets.json
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
  pollUntil,
  setMode,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(root, 'artifacts');
const url = process.argv[2] || DEFAULT_URL;
const outJson = join(artifactsDir, 'e2e-delayed-assets.json');

mkdirSync(artifactsDir, { recursive: true });

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

function readAssetProbe() {
  return page.evaluate(() => {
    const app = window.__silentDepths;
    if (!app || typeof app.getDebugProbe !== 'function') return null;
    return app.getDebugProbe().assets;
  });
}

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

  let releaseGlbs = () => undefined;
  const glbGate = new Promise((resolve) => {
    releaseGlbs = resolve;
  });
  let heldGlbs = 0;
  await page.route('**/assets/models/v2/*.glb', async (route) => {
    heldGlbs += 1;
    await glbGate;
    await route.continue();
  });

  const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  const navStatus = resp?.status() ?? 0;
  if (navStatus >= 400 || navStatus === 0) {
    throw new Error(`Preview load failed with status ${navStatus}`);
  }

  await beginPatrolAndSkipTutorial(page);
  await assertPlaying(page);
  await setMode(page, 'tactical');

  const delayed = await pollUntil(
    page,
    8000,
    async () => {
      const probe = await readAssetProbe();
      return Boolean(probe && probe.player?.assetSource === 'procedural' && probe.player.visible);
    },
    'procedural player while GLBs are delayed',
  ).then(() => true);

  if (!delayed) throw new Error('Expected a visible procedural player while GLBs were held');
  const before = await readAssetProbe();
  if (heldGlbs < 1) throw new Error('GLB route never intercepted a models/v2 request');

  releaseGlbs();

  await pollUntil(
    page,
    20000,
    async () => {
      const probe = await readAssetProbe();
      if (!probe) return false;
      const ids = probe.contacts.map((contact) => contact.id);
      const unique = new Set(ids);
      return (
        probe.player.assetSource === 'gltf' && probe.player.visible && ids.length === unique.size
      );
    },
    'glTF hot-swap after delayed GLBs released',
  );

  const after = await readAssetProbe();
  const ids = after.contacts.map((contact) => contact.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Duplicate contact pick ids after hot-swap');
  }

  const result = {
    ok: true,
    url,
    heldGlbs,
    before,
    after,
    consoleErrors: collectors.consoleErrors,
    pageErrors: collectors.pageErrors,
    failedRequests,
  };
  writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (collectors.pageErrors.length || collectors.consoleErrors.length) process.exit(2);
  process.exit(0);
} catch (err) {
  const fail = {
    ok: false,
    url,
    error: String(err?.message || err),
    consoleErrors: collectors?.consoleErrors ?? [],
    pageErrors: collectors?.pageErrors ?? [],
    failedRequests: failedRequests ?? [],
  };
  writeFileSync(outJson, `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
