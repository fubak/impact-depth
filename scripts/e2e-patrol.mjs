#!/usr/bin/env node
/**
 * Real patrol E2E journeys against production preview.
 * Expects `npm run preview` already serving (default :8080).
 * Artifacts: artifacts/e2e-patrol.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  CHROMIUM_ARGS,
  DEFAULT_URL,
  DEFAULT_PATROL_MODE,
  E2E_TIMEOUT_MS,
  MODE_LABEL,
  VIEWPORT,
  VIEWPORT_COMPACT,
  attachErrorCollectors,
  attachFailedRequestTracker,
  assertMode,
  assertPlaying,
  beginPatrolAndSkipTutorial,
  controlReachable,
  orbitTacticalCamera,
  plotCanvasWater,
  plotProjectedWaterAfterOrbit,
  pollUntil,
  rightClickProjectedContact,
  rightClickSceneFire,
  setMode,
} from '../tests/e2e/helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const artifactsDir = join(root, 'artifacts');
const url = process.argv[2] || DEFAULT_URL;
const outJson = join(artifactsDir, 'e2e-patrol.json');

mkdirSync(artifactsDir, { recursive: true });

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

  await runJourney('boot-start-tutorial', async () => {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
    navStatus = resp?.status() ?? 0;
    if (navStatus >= 400 || navStatus === 0) {
      throw new Error(`Preview load failed with status ${navStatus}`);
    }
    await beginPatrolAndSkipTutorial(page);
    const hud = await page.locator('#hud').innerText();
    if (!hud.includes('USS NAUTILUS') && !hud.includes('ORDERS')) {
      throw new Error(`Expected playing HUD content; got: ${hud.slice(0, 200)}`);
    }
  });

  await runJourney('pov-switching', async () => {
    /** @type {(keyof typeof MODE_LABEL)[]} */
    const modes = ['tactical', 'chase', 'bridge', 'periscope', 'map', 'sonar'];
    for (const mode of modes) {
      await setMode(page, mode);
    }
    await setMode(page, 'tactical');
  });

  await runJourney('helm-navigation', async () => {
    await setMode(page, 'tactical');
    const before = await page.locator('[aria-label="Depth order"]').innerText();
    await page.keyboard.press('KeyV'); // deep
    await pollUntil(
      page,
      5000,
      async () => {
        const text = await page.locator('[aria-label="Depth order"]').innerText();
        return text.includes('DEEP') || text.includes('→ DEEP');
      },
      'depth order to show DEEP',
    );
    const afterDepth = await page.locator('[aria-label="Depth order"]').innerText();
    if (afterDepth === before) throw new Error('Depth HUD did not change after KeyV');

    await page.keyboard.press('KeyP'); // flank
    await pollUntil(
      page,
      5000,
      async () => {
        const cls =
          (await page
            .locator('button[data-action="speed"][data-value="flank"]')
            .getAttribute('class')) ?? '';
        return cls.includes('active') || cls.includes('pending');
      },
      'Flank speed button active/pending',
    );
    // Return to fire-legal depth for later journeys.
    await page.keyboard.press('KeyX'); // periscope
    await page.keyboard.press('KeyI'); // 1/3
    await pollUntil(
      page,
      8000,
      async () => {
        const text = await page.locator('[aria-label="Depth order"]').innerText();
        return text.includes('PERISCOPE');
      },
      'return to periscope depth order',
    );
  });

  await runJourney('targeting-fire', async () => {
    await setMode(page, 'tactical');
    // Ensure tubes can fire: peri depth, wait for HUD ready if needed.
    await page.keyboard.press('KeyX');
    const projected = await plotProjectedWaterAfterOrbit(page);
    await orbitTacticalCamera(page, -80, 16);
    const secondPlot = await plotCanvasWater(page, { x: 820, y: 310 });
    if (secondPlot.x < 0 || secondPlot.x >= 128 || secondPlot.y < 0 || secondPlot.y >= 128) {
      throw new Error(`Plot ${secondPlot.text} is outside the 128-unit sector`);
    }
    if (
      projected.plot.x < 0 ||
      projected.plot.x >= 128 ||
      projected.plot.y < 0 ||
      projected.plot.y >= 128
    ) {
      throw new Error(`Projected plot ${projected.plot.text} is outside the 128-unit sector`);
    }

    const magBefore = await page.locator('[aria-label="Weapons"]').innerText();
    const mk14Match = magBefore.match(/Mk-14\s+(\d+)/i);
    const ammoBefore = mk14Match ? Number(mk14Match[1]) : null;

    await setMode(page, 'map');
    await rightClickProjectedContact(page);
    await setMode(page, 'tactical');
    await rightClickSceneFire(page);

    await page.keyboard.press('KeyF');
    await pollUntil(
      page,
      6000,
      async () => {
        const mag = await page.locator('[aria-label="Weapons"]').innerText();
        const hud = await page.locator('#hud').innerText();
        const toasts = await page
          .locator('.hud-toasts')
          .innerText()
          .catch(() => '');
        const mk14 = mag.match(/Mk-14\s+(\d+)/i);
        const ammoDropped =
          ammoBefore !== null && mk14 !== null && Number(mk14[1]) === ammoBefore - 1;
        const reload = /RELOAD/i.test(mag);
        const firedToast = /MK-14/i.test(`${hud}\n${toasts}`);
        return ammoDropped || reload || firedToast;
      },
      'magazine/toast change after fire',
    );
  });

  await runJourney('pause-resume', async () => {
    await page.keyboard.press('Space');
    await pollUntil(
      page,
      4000,
      async () => {
        const bannerHidden = await page.locator('#pause-banner').getAttribute('hidden');
        const resume = await page.getByRole('button', { name: 'Resume' }).count();
        return bannerHidden === null && resume > 0;
      },
      'pause banner and Resume control',
    );
    await page.keyboard.press('Space');
    await pollUntil(
      page,
      4000,
      async () => {
        const bannerHidden = await page.locator('#pause-banner').getAttribute('hidden');
        const pause = await page.getByRole('button', { name: 'Pause' }).count();
        return bannerHidden !== null && pause > 0;
      },
      'resume to playing',
    );
    await assertPlaying(page);
  });

  await runJourney('restart-reentry', async () => {
    // Bounded restart without production debug hooks: reload to menu, begin again.
    await page.reload({ waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
    await page.waitForSelector('button[data-action="begin"]', { timeout: E2E_TIMEOUT_MS });
    await beginPatrolAndSkipTutorial(page);
    await assertMode(page, DEFAULT_PATROL_MODE);
  });

  await runJourney('compact-viewport-reachability', async () => {
    await page.setViewportSize(VIEWPORT_COMPACT);
    await page.waitForTimeout(400);
    await assertPlaying(page);
    const critical = [
      'button[data-action="pause"]',
      'button[data-action="fire"]',
      'button[data-action="depth"][data-value="periscope"]',
      'button[data-action="speed"][data-value="oneThird"]',
      '[aria-label="Active orders"]',
      '[aria-label="Minimap; click to plot course"]',
    ];
    for (const sel of critical) {
      const reach = await controlReachable(page, sel);
      if (!reach.ok) throw new Error(`Control not reachable at 1024x700: ${sel} (${reach.reason})`);
    }
    // Keyboard + one HUD click still work at compact size.
    await page.keyboard.press('Digit2');
    await pollUntil(
      page,
      4000,
      async () => (await page.locator('#hud').innerText()).includes(MODE_LABEL.chase),
      'chase mode at compact viewport',
    );
    await page.evaluate(() => {
      document
        .querySelector('button[data-action="depth"][data-value="attack"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await pollUntil(
      page,
      5000,
      async () => {
        const text = await page.locator('[aria-label="Depth order"]').innerText();
        return text.includes('ATTACK') || text.includes('→ ATTACK');
      },
      'depth Atk click at compact viewport',
    );
    await setMode(page, 'tactical');
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

  const result = {
    ok: hardErrors.length === 0 && journeys.every((j) => j.ok),
    url,
    status: navStatus,
    viewportPrimary: VIEWPORT,
    viewportCompact: VIEWPORT_COMPACT,
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
  const fail = {
    ok: false,
    url,
    error: String(err?.message || err),
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
