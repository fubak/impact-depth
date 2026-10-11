#!/usr/bin/env node
/**
 * HUD collision check: no two visible HUD blocks may overlap in tactical or periscope view.
 *
 *   npm run test:e2e:layout -- http://127.0.0.1:8080/?quality=low
 */
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, DEFAULT_URL } from '../tests/e2e/helpers.mjs';

const url = process.argv[2] || DEFAULT_URL;
const SIZES = [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [1024, 700],
];
const HUD =
  '.hud-block, .help-strip, .hud-chrome, .peri-range, .peri-bearing, .hud-mission, .hud-minimap, .tutorial-card';

const overlaps = (page) =>
  page.evaluate((selector) => {
    const visible = [...document.querySelectorAll(selector)].filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && !el.closest('[hidden]');
    });
    const name = (el) => (el.getAttribute('aria-label') || el.id || el.className).toString();
    const out = [];
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        if (visible[i].contains(visible[j]) || visible[j].contains(visible[i])) continue;
        const a = visible[i].getBoundingClientRect();
        const b = visible[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) out.push(`${name(visible[i])} x ${name(visible[j])}`);
      }
    }
    return out;
  }, HUD);

const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
const failures = [];
for (const [width, height] of SIZES) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('button[data-action="begin"]');
  await page.locator('button[data-action="begin"]').first().click();
  await page.waitForTimeout(1200);
  const skip = page.locator('button[data-tutorial-action="skip"]');
  if (await skip.isVisible().catch(() => false)) {
    const tutorialHits = await overlaps(page);
    for (const hit of tutorialHits) failures.push(`${width}x${height} tutorial: ${hit}`);
    console.log(
      `${width}x${height} tutorial: ${tutorialHits.length ? tutorialHits.join('; ') : 'ok'}`,
    );
    await skip.click();
  }
  for (const [key, mode] of [
    ['1', 'tactical'],
    ['4', 'periscope'],
  ]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(1200);
    const hits = await overlaps(page);
    for (const hit of hits) failures.push(`${width}x${height} ${mode}: ${hit}`);
    console.log(`${width}x${height} ${mode}: ${hits.length ? hits.join('; ') : 'ok'}`);
  }
  await page.close();
}
await browser.close();
if (failures.length) {
  if (process.env.GITHUB_ACTIONS) {
    // Check-run annotation, readable without log access.
    console.log(`::error title=HUD layout overlaps::${failures.slice(0, 12).join(' | ')}`);
  }
  console.error(`FAIL ${failures.length} HUD overlap(s)`);
  process.exit(1);
}
console.log('PASS hud-layout');
