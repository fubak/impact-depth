#!/usr/bin/env node
/**
 * Phase 4: live tutorial exercises and HUD layout at three desktop sizes.
 *   npm run test:e2e:tutorial -- http://127.0.0.1:8111/?quality=low
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, assertPlaying, pollUntil } from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] || 'http://127.0.0.1:8080/?quality=low';
const outDir = join(root, 'artifacts/plan-025/phase-4');
const timeoutMs = Number(process.env.BROWSER_E2E_TIMEOUT_MS || 180000);

function wrap(delta) {
  let value = delta;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function compassOf(dx, dy) {
  const sim = Math.atan2(dy, dx);
  return Math.round(((-sim * 180) / Math.PI + 90 + 360) % 360);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function clickHud(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 20 });
}

/**
 * @param {import('playwright').Page} page
 */
async function nextEnabled(page) {
  return page.locator('button[data-tutorial-action="next"]').isEnabled();
}

/**
 * @param {{ x: number, y: number, width: number, height: number }} a
 * @param {{ x: number, y: number, width: number, height: number }} b
 */
function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function boxOf(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing ${selector}`);
  return box;
}

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: CHROMIUM_ARGS,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.addInitScript(() => {
  try {
    localStorage.removeItem('silent-depths-tutorial-v1');
    localStorage.removeItem('silent-depths-tutorial-v2');
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
/** @type {string | null} */
let held = null;

try {
  mkdirSync(outDir, { recursive: true });
  const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  if ((response?.status() ?? 0) >= 400) throw new Error(`Preview status ${response?.status()}`);
  await page.waitForSelector('button[data-action="begin"]', { timeout: timeoutMs });
  await clickHud(page, 'button[data-action="begin"]');
  await pollUntil(
    page,
    timeoutMs,
    async () => (await page.locator('#tutorial-title').innerText().catch(() => '')) === 'Steer',
    'steer card',
  );
  if (await nextEnabled(page)) throw new Error('Steer Next was already enabled');
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('[data-lesson-mark]').count()) === 1,
    'steer mark',
  );

  const steerStart = Date.now();
  while (Date.now() - steerStart < 90000) {
    if (await nextEnabled(page)) break;
    const mark = page.locator('[data-lesson-mark]');
    if ((await mark.count()) !== 1) throw new Error('Steer mark missing');
    const mx = Number(await mark.getAttribute('cx'));
    const my = Number(await mark.getAttribute('cy'));
    const px = Number(await page.locator('[data-field="player"]').getAttribute('cx'));
    const py = Number(await page.locator('[data-field="player"]').getAttribute('cy'));
    const hdg = Number((await page.locator('[data-field="hdg"]').innerText()).replace('°', ''));
    const delta = wrap(compassOf(mx - px, my - py) - hdg);
    const next = Math.abs(delta) < 12 ? null : delta > 0 ? 'KeyA' : 'KeyD';
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
  if (!(await nextEnabled(page))) throw new Error('Steer exercise did not unlock Next');
  await page.screenshot({ path: join(outDir, 'steer-1280x720.png') });
  await clickHud(page, 'button[data-tutorial-action="next"]');
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('#tutorial-title').innerText()) === 'Depth & stealth',
    'depth card',
  );
  if (!(await nextEnabled(page))) throw new Error('Explain card locked Next');
  await clickHud(page, 'button[data-tutorial-action="next"]');
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('#tutorial-title').innerText()) === 'Fire',
    'fire card',
  );
  if (await nextEnabled(page)) throw new Error('Fire Next was already enabled');
  const fireStart = Date.now();
  while (Date.now() - fireStart < 30000) {
    if (await nextEnabled(page)) break;
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(600);
  }
  if (!(await nextEnabled(page))) throw new Error('Fire exercise did not unlock Next');
  await page.screenshot({ path: join(outDir, 'fire-1280x720.png') });
  await clickHud(page, 'button[data-tutorial-action="next"]');
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('#tutorial-title').innerText()) === 'Survive',
    'dodge card',
  );
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('.threat-marker').count()) > 0,
    'dodge threat marker',
  );
  const dodgeText = await page.locator('.threat-marker').first().innerText();
  if (!dodgeText.includes('DC')) throw new Error(`Dodge marker was not a charge: ${dodgeText}`);
  await page.screenshot({ path: join(outDir, 'dodge-1280x720.png') });
  const dodgeStart = Date.now();
  const dodgeHdg = Number((await page.locator('[data-field="hdg"]').innerText()).replace('°', ''));
  while (Date.now() - dodgeStart < 90000) {
    if (await nextEnabled(page)) break;
    const hdg = Number((await page.locator('[data-field="hdg"]').innerText()).replace('°', ''));
    const turned = Math.abs(wrap(hdg - dodgeHdg));
    const next = turned < 80 ? 'KeyA' : null;
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
  if (!(await nextEnabled(page))) throw new Error('Dodge exercise did not unlock Next');
  const hull = await page.locator('[data-field="hull"]').innerText();
  await clickHud(page, 'button[data-tutorial-action="next"]');
  await pollUntil(
    page,
    8000,
    async () => (await page.locator('#tutorial-overlay').getAttribute('hidden')) !== null,
    'tutorial to finish',
  );
  await assertPlaying(page);
  const stored = await page.evaluate(() => localStorage.getItem('silent-depths-tutorial-v2'));
  if (stored !== '1') throw new Error(`Tutorial version was not stored, got ${stored}`);

  /** @type {Record<string, unknown>[]} */
  const layouts = [];
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    const score = await boxOf(page, '.hud-score');
    const contacts = await boxOf(page, '.hud-contacts');
    const help = await boxOf(page, '.help-strip');
    const objective = await boxOf(page, '[data-field="objective"]');
    if (overlaps(score, contacts)) {
      throw new Error(`Score overlaps contacts at ${size.width}x${size.height}`);
    }
    if (overlaps(help, objective)) {
      throw new Error(`Help strip overlaps the objective at ${size.width}x${size.height}`);
    }
    await page.screenshot({ path: join(outDir, `hud-${size.width}x${size.height}.png`) });
    layouts.push({ size, score, contacts, help, objective });
  }

  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.25';
  });
  await page.waitForTimeout(300);
  const zoomedScore = await boxOf(page, '.hud-score');
  const zoomedContacts = await boxOf(page, '.hud-contacts');
  if (overlaps(zoomedScore, zoomedContacts)) throw new Error('Score overlaps contacts at 125% zoom');
  await page.screenshot({ path: join(outDir, 'hud-1280x720-zoom125.png') });

  const report = {
    ok: true,
    url,
    hullAfterDodge: hull,
    layouts,
  };
  writeFileSync(join(outDir, 'tutorial-e2e.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, hullAfterDodge: hull, url }));
} catch (error) {
  if (held) await page.keyboard.up(held).catch(() => {});
  mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: join(outDir, 'failure.png') }).catch(() => {});
  const fail = { ok: false, error: String(error?.message || error) };
  writeFileSync(join(outDir, 'tutorial-e2e.json'), `${JSON.stringify(fail, null, 2)}\n`);
  console.error(fail.error);
  process.exit(1);
} finally {
  await browser.close();
}
