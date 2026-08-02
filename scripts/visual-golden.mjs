#!/usr/bin/env node
/** Optional deterministic visual captures; review artifacts rather than pixel-compare in CI. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CHROMIUM_ARGS, DEFAULT_URL, VIEWPORT } from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(root, 'artifacts', 'visual');
const url = process.argv[2] || DEFAULT_URL;
const captures = [
  ['caribbean-noon-tactical', 'Digit1'],
  ['underwater-chase', 'Digit2'],
  ['bridge-convoy', 'Digit3'],
  ['periscope-convoy', 'Digit4'],
  ['shore-map', 'Digit6'],
];

mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  for (const [name, key] of captures) {
    await page.keyboard.press(key);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(artifacts, `${name}.png`) });
  }
  writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify({ url, captures, errors }, null, 2)}\n`);
  if (errors.length) process.exitCode = 2;
} finally {
  await browser.close();
}
