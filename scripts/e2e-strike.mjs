#!/usr/bin/env node
/**
 * Convoy-strike journey on a production preview.
 * Steers from the objective bearing and the heading readout. No sim coordinates.
 *
 *   npm run test:e2e:strike -- http://127.0.0.1:8110/
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  VIEWPORT,
  assertPlaying,
  attachErrorCollectors,
  attachFailedRequestTracker,
  pollUntil,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || DEFAULT_URL;
const outDir = join(root, 'artifacts/plan-025/phase-3');
const timeoutMs = Number(process.env.BROWSER_E2E_TIMEOUT_MS || 180000);

/** @param {number} bearing @param {number} heading */
function compassDelta(bearing, heading) {
  let delta = bearing - heading;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/**
 * @param {import('playwright').Page} page
 */
async function startStrike(page) {
  await page.waitForSelector('button[data-action="strike"]', { timeout: timeoutMs });
  await clickHud(page, 'button[data-action="strike"]');
  await pollUntil(
    page,
    timeoutMs,
    async () => (await page.locator('button[data-action="strike"]').count()) === 0,
    'strike menu to dismiss',
  );
  const skip = page.locator('button[data-tutorial-action="skip"]');
  if (await skip.isVisible().catch(() => false)) {
    await clickHud(page, 'button[data-tutorial-action="skip"]');
    await pollUntil(
      page,
      timeoutMs,
      async () => (await page.locator('#tutorial-overlay').getAttribute('hidden')) !== null,
      'tutorial to close',
    );
  }
  await assertPlaying(page);
}

/**
 * @param {import('playwright').Page} page
 */
async function clickHud(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 20 });
}

/**
 * @param {import('playwright').Page} page
 */
async function readCue(page) {
  const objective = (await page.locator('[data-field="objective"]').innerText()).trim();
  const hdg = Number((await page.locator('[data-field="hdg"]').innerText()).replace('°', ''));
  const match = objective.match(/Reach the exit\s+(\d+)°\s+(\d+)u/);
  return {
    objective,
    hdg,
    bearing: match ? Number(match[1]) : null,
    distance: match ? Number(match[2]) : null,
  };
}

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: CHROMIUM_ARGS,
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
const collectors = attachErrorCollectors(page);
const failedRequests = attachFailedRequestTracker(page, url);
/** @type {string | null} */
let held = null;
const wallStart = Date.now();

try {
  const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  const status = response?.status() ?? 0;
  if (status >= 400 || status === 0) throw new Error(`Preview load failed with status ${status}`);
  await startStrike(page);

  const opening = await readCue(page);
  if (opening.objective !== 'Sink the merchant') {
    throw new Error(`Expected attack objective, got ${opening.objective}`);
  }
  const exitLater = await page.locator('[data-exit="later"]').count();
  if (exitLater !== 1) throw new Error(`Expected one pending exit marker, saw ${exitLater}`);
  const target = (await page.locator('[data-field="target"]').innerText()).trim();
  if (!target.includes('MERCHANT'))
    throw new Error(`Expected the merchant selected, got ${target}`);

  const fightStart = Date.now();
  let extractAt = 0;
  // Wall-clock budget is generous: the software renderer advances sim time far
  // slower than real time, and escorts legitimately screen the merchant now.
  while (Date.now() - fightStart < 300000) {
    const cue = await readCue(page);
    if (cue.objective.startsWith('Reach the exit')) {
      extractAt = Date.now();
      const open = await page.locator('[data-exit="open"]').count();
      if (open !== 1) throw new Error(`Exit ring did not open after the sink (count ${open})`);
      break;
    }
    if (
      (
        await page
          .locator('#patrol-overlay h1')
          .innerText()
          .catch(() => '')
      ).includes('PATROL ENDED')
    ) {
      throw new Error(
        `Strike ended in defeat before extraction: ${await page.locator('#patrol-overlay').innerText()}`,
      );
    }
    // Screening escorts can sink first, clearing the lock. Re-acquire the
    // merchant before firing so fish stay aimed at the mission target.
    const locked = (await page.locator('[data-field="target"]').innerText()).trim();
    if (!locked.includes('MERCHANT')) {
      for (let press = 0; press < 4; press += 1) {
        await page.keyboard.press('KeyT');
        await page.waitForTimeout(250);
        const now = (await page.locator('[data-field="target"]').innerText()).trim();
        if (now.includes('MERCHANT')) break;
      }
    }
    await page.keyboard.press('KeyF');
    if ((Date.now() - fightStart) % 5000 < 800) {
      const weapons = (await page.locator('[aria-label="Weapons"]').innerText()).replaceAll(
        '\n',
        ' | ',
      );
      const clock = await page.locator('[data-field="time"]').innerText();
      const sunkNow = await page.locator('[data-field="sunk"]').innerText();
      console.log(`fight t=${clock} sunk=${sunkNow} obj=${cue.objective} weapons=${weapons}`);
    }
    await page.waitForTimeout(700);
  }
  if (!extractAt) {
    const weapons = (await page.locator('[aria-label="Weapons"]').innerText()).replaceAll(
      '\n',
      ' | ',
    );
    const clock = await page.locator('[data-field="time"]').innerText();
    const sunkNow = await page.locator('[data-field="sunk"]').innerText();
    const course = await page.locator('[data-field="course"]').innerText();
    throw new Error(
      `Merchant was not sunk within 120s (t=${clock} sunk=${sunkNow} course=${course} weapons=${weapons})`,
    );
  }

  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyP');
  const steerStart = Date.now();
  while (Date.now() - steerStart < 90000) {
    const title = await page
      .locator('#patrol-overlay h1')
      .innerText()
      .catch(() => '');
    if (title.includes('SECTOR CLEARED')) break;
    if (title.includes('PATROL ENDED')) {
      throw new Error(
        `Defeat during extraction: ${await page.locator('#patrol-overlay').innerText()}`,
      );
    }
    const cue = await readCue(page);
    if (cue.bearing === null) throw new Error(`Extraction objective lost: ${cue.objective}`);
    const delta = compassDelta(cue.bearing, cue.hdg);
    const next = Math.abs(delta) < 8 ? null : delta > 0 ? 'KeyA' : 'KeyD';
    if (next !== held) {
      if (held) await page.keyboard.up(held);
      if (next) await page.keyboard.down(next);
      held = next;
    }
    await page.waitForTimeout(200);
  }
  if (held) {
    await page.keyboard.up(held);
    held = null;
  }

  const resultText = await page.locator('#patrol-overlay').innerText();
  if (!resultText.includes('SECTOR CLEARED')) {
    throw new Error(`Expected one victory card, got: ${resultText.slice(0, 240)}`);
  }
  if (!resultText.includes('Merchant sunk'))
    throw new Error(`Victory card missing the strike line: ${resultText}`);
  const restartButtons = await page.locator('button[data-action="restart"]').count();
  if (restartButtons !== 1) throw new Error(`Expected one Restart control, saw ${restartButtons}`);
  const simClock = (
    await page
      .locator('[data-field="time"]')
      .innerText()
      .catch(() => '')
  ).trim();
  const sunk = (
    await page
      .locator('[data-field="sunk"]')
      .innerText()
      .catch(() => '')
  ).trim();

  await clickHud(page, 'button[data-action="restart"]');
  await pollUntil(
    page,
    timeoutMs,
    async () => (await page.locator('button[data-action="begin"]').count()) === 1,
    'menu after restart',
  );
  await startStrike(page);
  const retry = await readCue(page);
  const sunkRetry = (await page.locator('[data-field="sunk"]').innerText()).trim();
  if (retry.objective !== 'Sink the merchant') {
    throw new Error(`Retry did not reset the objective: ${retry.objective}`);
  }
  if (sunkRetry !== '0') throw new Error(`Retry kept sunk count ${sunkRetry}`);
  if ((await page.locator('[data-exit="later"]').count()) !== 1) {
    throw new Error('Retry did not restore the pending exit marker');
  }

  const report = {
    ok:
      collectors.pageErrors.length === 0 &&
      collectors.consoleErrors.length === 0 &&
      failedRequests.length === 0,
    url,
    wallClockMs: Date.now() - wallStart,
    simClock,
    sunk,
    pageErrors: collectors.pageErrors,
    consoleErrors: collectors.consoleErrors,
    failedRequests,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'strike-e2e.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(2);
} catch (error) {
  if (held) await page.keyboard.up(held).catch(() => {});
  mkdirSync(outDir, { recursive: true });
  const fail = {
    ok: false,
    url,
    error: String(error?.message || error),
    wallClockMs: Date.now() - wallStart,
    pageErrors: collectors.pageErrors,
    consoleErrors: collectors.consoleErrors,
  };
  writeFileSync(join(outDir, 'strike-e2e.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(fail.error);
  process.exit(1);
} finally {
  await browser.close();
}
