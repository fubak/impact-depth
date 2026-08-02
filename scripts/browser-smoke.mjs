#!/usr/bin/env node
/**
 * Headless Chromium smoke: load production preview, assert one WebGL canvas,
 * switch tactical / periscope / sonar with Digit1/4/7, fail on page/console errors.
 * Artifacts land under artifacts/ (gitignored).
 *
 * Expects `npm run preview` already serving on :8080.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  MODE_LABEL,
  SMOKE_TIMEOUT_MS,
  VIEWPORT,
} from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifactsDir = join(root, 'artifacts');
const url = process.argv[2] || DEFAULT_URL;
const outPng = process.argv[3] || join(artifactsDir, 'browser-smoke.png');
const outJson = join(artifactsDir, 'browser-smoke.json');

mkdirSync(artifactsDir, { recursive: true });
mkdirSync(dirname(outPng), { recursive: true });

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: CHROMIUM_ARGS,
});

/** @type {import('playwright').Page | undefined} */
let page;

try {
  page = await browser.newPage({ viewport: VIEWPORT });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));

  const resp = await page.goto(url, { waitUntil: 'load', timeout: SMOKE_TIMEOUT_MS });
  const status = resp?.status() ?? 0;
  await page.waitForSelector('#hud', { timeout: SMOKE_TIMEOUT_MS });
  await page.waitForTimeout(800);

  const canvasCount = await page.locator('#scene').count();
  const webglOk = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return Boolean(gl);
  });

  /** @param {'tactical' | 'periscope' | 'sonar'} mode */
  const assertMode = async (mode) => {
    const code = mode === 'tactical' ? 'Digit1' : mode === 'periscope' ? 'Digit4' : 'Digit7';
    await page.keyboard.press(code);
    await page.waitForTimeout(400);
    const hudText = await page.locator('#hud').innerText();
    const label = MODE_LABEL[mode];
    if (!hudText.includes(label)) {
      throw new Error(
        `Expected HUD to include ${label} after ${code}; got: ${hudText.slice(0, 200)}`,
      );
    }
    if (mode === 'periscope') {
      const hidden = await page.locator('#periscope-overlay').getAttribute('hidden');
      if (hidden !== null) throw new Error('Periscope overlay should be visible');
    }
    if (mode === 'sonar') {
      const hidden = await page.locator('#sonar-overlay').getAttribute('hidden');
      if (hidden !== null) throw new Error('Sonar overlay should be visible');
    }
    if (mode === 'tactical') {
      const periHidden = await page.locator('#periscope-overlay').getAttribute('hidden');
      const sonarHidden = await page.locator('#sonar-overlay').getAttribute('hidden');
      if (periHidden === null) throw new Error('Periscope overlay should be hidden in tactical');
      if (sonarHidden === null) throw new Error('Sonar overlay should be hidden in tactical');
    }
  };

  await assertMode('tactical');
  await assertMode('periscope');
  await assertMode('sonar');
  await assertMode('tactical');

  await page.screenshot({ path: outPng, fullPage: false });

  const result = {
    ok: true,
    url,
    status,
    title: await page.title(),
    viewport: VIEWPORT,
    canvasCount,
    webglOk,
    modes: ['tactical', 'periscope', 'sonar'],
    consoleErrors,
    pageErrors,
    screenshot: outPng,
  };

  writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));

  if (status >= 400 || status === 0) process.exit(1);
  if (canvasCount < 1 || !webglOk) process.exit(1);
  if (pageErrors.length || consoleErrors.length) process.exit(2);
  process.exit(0);
} catch (err) {
  const fail = {
    ok: false,
    url,
    error: String(err?.message || err),
    consoleErrors,
    pageErrors,
  };
  writeFileSync(outJson, `${JSON.stringify(fail, null, 2)}\n`);
  console.error(JSON.stringify(fail, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
