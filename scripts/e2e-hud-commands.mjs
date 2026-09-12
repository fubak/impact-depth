#!/usr/bin/env node
/**
 * Click every HUD command and assert the intended game state sticks
 * (no silent overwrite by world-plot on the same pointerup).
 *
 * Usage: node scripts/e2e-hud-commands.mjs [url]
 * Default: http://127.0.0.1:8800/
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8800/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @typedef {{ name: string, ok: boolean, detail?: string }} Check */

/** @type {Check[]} */
const checks = [];

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (err) {
    const detail = String(err?.message || err);
    checks.push({ name, ok: false, detail });
    console.error(`FAIL ${name}: ${detail}`);
  }
}

/**
 * Patrol overlay listens for click; HUD listens for pointerdown.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {'click' | 'pointerdown'} [kind]
 */
async function hudAct(page, selector, kind = 'pointerdown') {
  const ok = await page.evaluate(
    ({ selector: sel, kind: k }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      if (k === 'click') {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      } else {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        el.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }),
        );
        window.dispatchEvent(
          new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }),
        );
      }
      return true;
    },
    { selector, kind },
  );
  if (!ok) throw new Error(`missing ${selector}`);
  await sleep(70);
}

/**
 * @param {import('playwright').Page} page
 * @param {(g: any, app: any, arg: any) => boolean} pred
 * @param {string} label
 * @param {unknown} [arg]
 */
async function expectGame(page, pred, label, arg) {
  const ok = await page.evaluate(
    ({ fnSrc, arg: a }) => {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`return (${fnSrc})`)();
      return fn(window.__silentDepths.game, window.__silentDepths, a);
    },
    { fnSrc: pred.toString(), arg },
  );
  if (!ok) throw new Error(label);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(10000);

try {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('silent-depths-tutorial-v1', '1');
    } catch {
      /* ignore */
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await page.evaluate(() => !!window.__silentDepths);
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('__silentDepths not ready');

  await check('Begin Patrol', async () => {
    await hudAct(page, '#patrol-overlay [data-action="begin"]', 'click');
    await sleep(200);
    await expectGame(page, (g) => g.phase === 'playing' && g.ships.length > 0, 'phase not playing');
  });

  await check('HUD Ambush survives click (no plot overwrite)', async () => {
    await hudAct(page, '[data-action="tactic"][data-value="ambush"]');
    await expectGame(
      page,
      (g) => g.autopilot.enabled && g.autopilot.tactic === 'ambush' && g.autopilot.waypoint == null,
      'ambush overwritten or missing',
    );
  });

  await check('Stop AI', async () => {
    await hudAct(page, '[data-action="stop-ai"]');
    await expectGame(page, (g) => !g.autopilot.enabled && g.autopilot.tactic === 'manual', 'stop-ai failed');
  });

  for (const tactic of ['stalk', 'intercept', 'evade', 'exfil']) {
    await check(`HUD tactic ${tactic}`, async () => {
      await hudAct(page, `[data-action="tactic"][data-value="${tactic}"]`);
      await expectGame(
        page,
        (g, _a, t) => g.autopilot.enabled && g.autopilot.tactic === t && g.autopilot.waypoint == null,
        `${tactic} missing/overwritten`,
        tactic,
      );
      await hudAct(page, '[data-action="stop-ai"]');
    });
  }

  await check('Clear engagement', async () => {
    await page.evaluate(() => {
      const app = window.__silentDepths;
      const id = app.game.ships[0]?.id;
      if (id) app.game = { ...app.game, selectedTargetId: id };
    });
    await hudAct(page, '[data-action="clear"]');
    await expectGame(page, (g) => g.selectedTargetId == null, 'clear did not drop target');
  });

  await check('Silent / Scope / Snorkel toggles', async () => {
    await hudAct(page, '[data-action="depth"][data-value="periscope"]');
    await sleep(80);

    const silent0 = await page.evaluate(() => window.__silentDepths.game.submarine.silentRunning);
    await hudAct(page, '[data-action="silent"]');
    await expectGame(page, (g, _a, b) => g.submarine.silentRunning !== b, 'silent did not toggle', silent0);

    const scope0 = await page.evaluate(() => window.__silentDepths.game.submarine.scopeUp);
    await hudAct(page, '[data-action="scope"]');
    await expectGame(page, (g, _a, b) => g.submarine.scopeUp !== b, 'scope did not toggle', scope0);

    const snorkel0 = await page.evaluate(() => window.__silentDepths.game.submarine.snorkel);
    await hudAct(page, '[data-action="snorkel"]');
    await expectGame(page, (g, _a, b) => g.submarine.snorkel !== b, 'snorkel did not toggle', snorkel0);

    if (await page.evaluate(() => window.__silentDepths.game.submarine.silentRunning)) {
      await hudAct(page, '[data-action="silent"]');
    }
    if (await page.evaluate(() => window.__silentDepths.game.submarine.scopeUp)) {
      await hudAct(page, '[data-action="scope"]');
    }
    if (await page.evaluate(() => window.__silentDepths.game.submarine.snorkel)) {
      await hudAct(page, '[data-action="snorkel"]');
    }
  });

  for (const [order, label] of [
    ['surface', 'Surf'],
    ['periscope', 'Peri'],
    ['attack', 'Atk'],
    ['deep', 'Deep'],
  ]) {
    await check(`Depth ${label}`, async () => {
      const targets = { surface: 0.06, periscope: 0.28, attack: 0.5, deep: 0.82 };
      await hudAct(page, `[data-action="depth"][data-value="${order}"]`);
      await expectGame(
        page,
        (g, _app, expected) => Math.abs(g.submarine.targetDepth - expected) < 0.02,
        `depth ${order} not applied`,
        targets[order],
      );
    });
  }

  for (const order of ['stop', 'oneThird', 'twoThirds', 'flank']) {
    await check(`Speed ${order}`, async () => {
      await hudAct(page, `[data-action="speed"][data-value="${order}"]`);
      await expectGame(
        page,
        (g, _app, expected) => g.submarine.speedOrder === expected,
        `speed ${order} not applied`,
        order,
      );
    });
  }

  await check('Weapon Mk-18 / Foxer / Mk-14', async () => {
    await hudAct(page, '[data-action="weapon"][data-value="seeker"]');
    await expectGame(page, (g) => g.weaponMode === 'seeker', 'mk18 not selected');
    await hudAct(page, '[data-action="weapon"][data-value="decoy"]');
    await expectGame(page, (g) => g.weaponMode === 'decoy', 'foxer not selected');
    await hudAct(page, '[data-action="weapon"][data-value="torpedo"]');
    await expectGame(page, (g) => g.weaponMode === 'torpedo', 'mk14 not selected');
  });

  await check('Spread toggle', async () => {
    const before = await page.evaluate(() => window.__silentDepths.game.torpedoSpread);
    await hudAct(page, '[data-action="spread"]');
    await expectGame(page, (g, _app, b) => g.torpedoSpread !== b, 'spread did not toggle', before);
  });

  await check('Screen / countermeasure', async () => {
    await page.evaluate(() => {
      const app = window.__silentDepths;
      app.game = {
        ...app.game,
        submarine: { ...app.game.submarine, decoys: 3, cmCooldown: 0 },
      };
    });
    const before = await page.evaluate(() => window.__silentDepths.game.countermeasures.length);
    await hudAct(page, '[data-action="screen"]');
    await expectGame(page, (g, _app, b) => g.countermeasures.length > b, 'screen did not deploy', before);
  });

  await check('Sonar pulse', async () => {
    await page.evaluate(() => {
      const app = window.__silentDepths;
      app.game = { ...app.game, sonarCooldown: 0, activePingTimer: 0 };
    });
    await hudAct(page, '[data-action="sonar"]');
    await expectGame(
      page,
      (g) =>
        g.sonarCooldown > 0 ||
        g.activePingTimer > 0 ||
        g.messages.some((m) => /SONAR|PING|ACTIVE|HYDRO/.test(m.text)),
      'sonar had no effect',
    );
  });

  await check('Fire Mk-14 at peri depth', async () => {
    await page.evaluate(() => {
      const app = window.__silentDepths;
      const id = app.game.ships[0]?.id ?? null;
      app.game = {
        ...app.game,
        selectedTargetId: id,
        weaponMode: 'torpedo',
        submarine: {
          ...app.game.submarine,
          z: 0.28,
          targetDepth: 0.28,
          torpedoes: 6,
          reloadMk14: 0,
          sysTubes: 1,
        },
      };
    });
    const before = await page.evaluate(() => window.__silentDepths.game.torpedoes.length);
    await hudAct(page, '[data-action="fire"]');
    await expectGame(page, (g, _app, b) => g.torpedoes.length > b, 'fire did not launch', before);
  });

  await check('Pause / Mute / Help', async () => {
    await hudAct(page, '[data-action="pause"]');
    await expectGame(page, (g) => g.phase === 'paused', 'pause failed');
    await hudAct(page, '[data-action="pause"]');
    await expectGame(page, (g) => g.phase === 'playing', 'unpause failed');

    const mutedBefore = await page.evaluate(() => window.__silentDepths.audio.isMuted);
    await hudAct(page, '[data-action="mute"]');
    const mutedAfter = await page.evaluate(() => window.__silentDepths.audio.isMuted);
    if (mutedAfter === mutedBefore) throw new Error('mute did not toggle');
    if (mutedAfter) await hudAct(page, '[data-action="mute"]');

    await hudAct(page, '[data-action="help"]');
    const helpVisible = await page.evaluate(() => {
      const el = document.getElementById('tutorial-overlay');
      return !!el && !el.hidden;
    });
    if (!helpVisible) throw new Error('help overlay not shown');
    await page.evaluate(() => {
      document
        .querySelector('#tutorial-overlay [data-tutorial-action="skip"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(80);
  });

  await check('Keyboard depth/speed/target', async () => {
    await page.evaluate(() => {
      for (const code of ['KeyV', 'KeyX', 'KeyP', 'Digit0', 'KeyT']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
      }
    });
    await sleep(100);
    await expectGame(page, (g) => Math.abs(g.submarine.targetDepth - 0.28) < 0.05, 'KeyX peri failed');
    await expectGame(page, (g) => g.submarine.speedOrder === 'stop', 'Digit0 stop failed');
    await expectGame(page, (g) => !!g.selectedTargetId, 'KeyT did not select');
  });

  await check('View modes 1–7', async () => {
    const modes = [
      ['Digit1', 'tactical'],
      ['Digit2', 'chase'],
      ['Digit3', 'bridge'],
      ['Digit4', 'periscope'],
      ['Digit5', 'free'],
      ['Digit6', 'map'],
      ['Digit7', 'sonar'],
    ];
    for (const [code, mode] of modes) {
      await page.evaluate((c) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c, bubbles: true }));
      }, code);
      await sleep(50);
      const current = await page.evaluate(() => window.__silentDepths.sim.viewMode);
      if (current !== mode) throw new Error(`${code} expected ${mode} got ${current}`);
    }
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: 'Digit1', bubbles: true }));
    });
  });

  await check('Ambush then depth order cancels AP (intentional)', async () => {
    await hudAct(page, '[data-action="tactic"][data-value="ambush"]');
    await expectGame(page, (g) => g.autopilot.tactic === 'ambush', 'ambush not on');
    await hudAct(page, '[data-action="depth"][data-value="deep"]');
    await expectGame(
      page,
      (g) => !g.autopilot.enabled && g.autopilot.tactic === 'manual' && g.submarine.targetDepth > 0.7,
      'depth did not cancel ambush',
    );
  });
} finally {
  await browser.close().catch(() => undefined);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.error(` - ${f.name}: ${f.detail}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
