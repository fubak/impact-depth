#!/usr/bin/env node
/**
 * Presentation gauntlet: views, particles, hit splashes, VFX, audio unlock.
 * Finite stations. Screenshots are review artifacts, not self-approved PASS.
 *
 *   node scripts/gauntlet-presentation.mjs [url]
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
const artifacts = join(root, 'artifacts', 'gauntlet');
const url = process.argv[2] || DEFAULT_URL;

mkdirSync(artifacts, { recursive: true });

/** @type {{ name: string, ok: boolean, detail?: unknown }[]} */
const stations = [];

/**
 * @param {string} name
 * @param {() => Promise<unknown>} fn
 */
async function station(name, fn) {
  try {
    const detail = await fn();
    stations.push({ name, ok: true, detail: detail ?? true });
    console.log(`PASS ${name}`);
  } catch (err) {
    const detail = String(err?.message || err);
    stations.push({ name, ok: false, detail });
    console.error(`FAIL ${name}: ${detail}`);
    throw err;
  }
}

const browser = await chromium.launch({
  headless: true,
  args: [...CHROMIUM_ARGS, '--use-gl=angle', '--use-angle=swiftshader'],
});
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
  await station('boot', async () => {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
    const status = resp?.status() ?? 0;
    if (status >= 400 || status === 0) throw new Error(`load status ${status}`);
    await page.waitForSelector('#hud', { timeout: E2E_TIMEOUT_MS });
    await beginPatrolAndSkipTutorial(page);
    await page.waitForFunction(
      () => {
        const canvas = document.querySelector('#scene');
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        return Boolean(gl) && canvas.width > 0;
      },
      { timeout: E2E_TIMEOUT_MS },
    );
    await assertPlaying(page);
    return { status };
  });

  await station('views', async () => {
    const shots = [];
    for (const mode of /** @type {const} */ (['tactical', 'bridge', 'periscope'])) {
      await setMode(page, mode);
      await page.waitForTimeout(250);
      const file = join(artifacts, `${mode}.png`);
      await page.screenshot({ path: file });
      shots.push(mode);
    }
    await setMode(page, 'tactical');
    return { shots };
  });

  await station('hit-vfx', async () => {
    const burst = await page.evaluate(() => {
      const app = window.__silentDepths;
      if (!app || typeof app.debugBurstPresentationFx !== 'function') {
        throw new Error('debugBurstPresentationFx missing');
      }
      return app.debugBurstPresentationFx();
    });
    await page.waitForTimeout(120);
    const probe = await page.evaluate(() => window.__silentDepths.getPresentationGauntlet());
    if (!burst?.vfx || burst.vfx.alive < 3) {
      throw new Error(`expected ≥3 VFX particles, got ${JSON.stringify(burst)}`);
    }
    if ((probe?.surface?.splashAlive ?? 0) < 1 && (burst.splash ?? 0) < 1) {
      throw new Error(`expected a splash slot, got ${JSON.stringify(probe?.surface)}`);
    }
    await page.screenshot({ path: join(artifacts, 'hit-vfx.png') });
    return { burst, surface: probe.surface, vfx: probe.vfx };
  });

  await station('audio', async () => {
    await page
      .locator('button[data-action="mute"]')
      .click({ timeout: 4000 })
      .catch(() => undefined);
    await page.mouse.click(20, 20);
    const audio = await page.evaluate(() => {
      const app = window.__silentDepths;
      app.getAudioDiagnostics && app.debugBurstPresentationFx();
      return app.getAudioDiagnostics();
    });
    if (!audio) throw new Error('audio diagnostics missing');
    if (audio.contextState === 'none' && audio.unlocked === false) {
      throw new Error(`audio never unlocked: ${JSON.stringify(audio)}`);
    }
    return audio;
  });

  await station('clean-console', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(' | '));
    const fatal = consoleErrors.filter((line) => !/THREE\.WebGLRenderer: Context Lost/i.test(line));
    if (fatal.length) throw new Error(fatal.slice(0, 3).join(' | '));
    return { consoleErrors: consoleErrors.length, failedRequests: failedRequests.length };
  });

  const report = {
    ok: true,
    url,
    stations,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(),
    note: 'Machine gauntlet. Screenshots are not GPU/visual ACCEPT.',
  };
  writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, passed: stations.length }, null, 2));
} catch (err) {
  const report = {
    ok: false,
    url,
    error: String(err?.message || err),
    stations,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.slice(),
  };
  writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
