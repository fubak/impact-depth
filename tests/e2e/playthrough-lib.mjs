/**
 * Pure playthrough judgments and the CDP-or-launch browser attach.
 * The script in scripts/playthrough.mjs drives a live preview; these functions
 * decide pass/fail so a build without A2 fails fire-and-hit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Operator Chrome remote-debugging port from Plan 022. */
export const CDP_ENDPOINT = 'http://127.0.0.1:9223';

/** D1 reads HUD coverage at this size. */
export const PLAYTHROUGH_VIEWPORT = { width: 1280, height: 720 };

/** Tubes will engage a selected hull inside this range (sim units). */
export const ENGAGE_RANGE = 22;

/** A2: a hit flash must be alive within this window. */
export const FLASH_WINDOW_MS = 1000;

export const DOCTRINES = ['ambush', 'stalk', 'intercept', 'evade', 'exfil'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * @param {import('playwright').BrowserType} chromium
 * @param {{ endpoint?: string, headless?: boolean, args?: string[] }} [options]
 */
export async function connectChromium(chromium, options = {}) {
  const endpoint = options.endpoint ?? CDP_ENDPOINT;
  try {
    const browser = await chromium.connectOverCDP(endpoint);
    return { browser, via: 'cdp', endpoint };
  } catch (error) {
    const browser = await chromium.launch({
      headless: options.headless !== false,
      args: options.args ?? [],
    });
    return {
      browser,
      via: 'launch',
      endpoint,
      cdpError: String(error?.message || error),
    };
  }
}

/**
 * CDP attach must not kill the operator's Chrome. Launch owns its process.
 * @param {{ close?: () => Promise<void>, disconnect?: () => Promise<void> } | null} browser
 * @param {'cdp' | 'launch' | undefined} via
 */
export async function releaseBrowser(browser, via) {
  if (!browser) return;
  if (via === 'cdp' && typeof browser.disconnect === 'function') {
    await browser.disconnect();
    return;
  }
  if (typeof browser.close === 'function') await browser.close();
}

/** @param {Date} [date] */
export function playthroughStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Page-side probe. Must stay free of closures: Playwright stringifies it.
 * Reads A2's getGameSummary / getCombatEventLog when those methods exist.
 */
export function dumpPlaythroughState() {
  const app = window.__silentDepths;
  const canvas = document.querySelector('#scene');
  let renderer = '';
  if (canvas instanceof HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(
        ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
    }
  }
  const summaryCallable = typeof app?.getGameSummary === 'function';
  const logCallable = typeof app?.getCombatEventLog === 'function';
  let summary = null;
  let events = [];
  if (summaryCallable) {
    try {
      summary = app.getGameSummary();
    } catch (error) {
      summary = { error: String(error?.message || error) };
    }
  }
  if (logCallable) {
    try {
      const log = app.getCombatEventLog();
      events = Array.isArray(log) ? log : [];
    } catch {
      events = [];
    }
  }
  let flashes = 0;
  if (typeof app?.getPresentationGauntlet === 'function') {
    try {
      flashes = Number(app.getPresentationGauntlet()?.vfx?.byKind?.flash ?? 0);
    } catch {
      flashes = 0;
    }
  }
  const hud = document.querySelector('#hud');
  const tutorial = document.querySelector('#tutorial-overlay');
  const label = tutorial?.querySelector('.panel-label')?.textContent ?? '';
  const stepMatch = label.match(/(\d+)\s*\/\s*(\d+)/);
  const overlay = document.querySelector('#patrol-overlay');
  const panels = Array.from(document.querySelectorAll('#hud .hud-block'), (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
  return {
    renderer,
    summaryCallable,
    logCallable,
    summary,
    events,
    flashes: Number.isFinite(flashes) ? flashes : 0,
    hudText: hud?.innerText ?? '',
    tutorialOpen: Boolean(tutorial) && tutorial.hidden === false,
    tutorialSteps: stepMatch ? Number(stepMatch[2]) : null,
    overlayText: overlay && overlay.hidden === false ? (overlay.innerText ?? '') : '',
    panels,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

/** @param {Record<string, any> | null | undefined} raw */
export function mapPlaythroughDump(raw) {
  const data = raw ?? {};
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : null;
  const summaryOk = data.summaryCallable === true && summary != null && summary.error == null;
  return {
    hasSummary: summaryOk,
    hasLog: data.logCallable === true && Array.isArray(data.events),
    summary: summaryOk ? summary : null,
    events: Array.isArray(data.events) ? data.events : [],
    flashes: Number(data.flashes ?? 0) || 0,
    hudText: String(data.hudText ?? ''),
    tutorialOpen: data.tutorialOpen === true,
    tutorialSteps: Number.isFinite(data.tutorialSteps) ? data.tutorialSteps : null,
    overlayText: String(data.overlayText ?? ''),
    panels: Array.isArray(data.panels) ? data.panels : [],
    viewport: data.viewport ?? { width: 0, height: 0 },
    renderer: String(data.renderer ?? ''),
  };
}

/** @param {string} renderer */
export function isSwiftShaderRenderer(renderer) {
  return /swiftshader/i.test(renderer ?? '');
}

/**
 * @param {{
 *   renderer?: string,
 *   connection?: string,
 *   hudCoverage?: number | null,
 *   viewport?: { width: number, height: number },
 *   journeys?: unknown[],
 *   samples?: unknown[],
 *   url?: string,
 * }} input
 */
export function buildReport(input) {
  const renderer = String(input.renderer ?? '');
  const isSwiftShader = isSwiftShaderRenderer(renderer);
  // SwiftShader captures are evidence only. Never claim an operator visual pass.
  const visual = isSwiftShader ? 'NOT A VISUAL PASS' : 'EVIDENCE ONLY';
  return {
    url: input.url ?? '',
    connection: input.connection ?? '',
    renderer,
    isSwiftShader,
    visual,
    hudCoverage: input.hudCoverage ?? null,
    viewport: input.viewport ?? PLAYTHROUGH_VIEWPORT,
    journeys: input.journeys ?? [],
    samples: input.samples ?? [],
  };
}

/** @param {{ x: number, y: number, w: number, h: number }} rect */
function clipRect(rect, viewport) {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(viewport.width, rect.x + rect.w);
  const y2 = Math.min(viewport.height, rect.y + rect.h);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/** Area of the union of axis-aligned rectangles. */
export function unionArea(rects) {
  const boxes = [];
  const xs = [];
  for (const rect of rects) {
    if (!(rect.w > 0) || !(rect.h > 0)) continue;
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.w;
    const y2 = rect.y + rect.h;
    boxes.push({ x1, y1, x2, y2 });
    xs.push(x1, x2);
  }
  xs.sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index];
    const right = xs[index + 1];
    const width = right - left;
    if (width <= 0) continue;
    const spans = boxes
      .filter((box) => box.x1 <= left && box.x2 >= right)
      .map((box) => [box.y1, box.y2])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let covered = 0;
    let start = null;
    let end = null;
    for (const [y1, y2] of spans) {
      if (start === null) {
        start = y1;
        end = y2;
      } else if (y1 <= end) {
        end = Math.max(end, y2);
      } else {
        covered += end - start;
        start = y1;
        end = y2;
      }
    }
    if (start !== null && end !== null) covered += end - start;
    area += covered * width;
  }
  return area;
}

/** Union of HUD panel rects divided by the viewport. Overlap counts once. */
export function hudCoverageFraction(rects, viewport) {
  const area = viewport.width * viewport.height;
  if (!(area > 0)) return 0;
  const clipped = rects.map((rect) => clipRect(rect, viewport));
  return unionArea(clipped) / area;
}

/** @param {Record<string, any> | null} summary */
export function nearestRange(summary) {
  const ships = summary?.ships;
  if (!Array.isArray(ships)) return null;
  let best = null;
  for (const ship of ships) {
    const range = Number(ship?.range);
    if (!Number.isFinite(range)) continue;
    if (best === null || range < best) best = range;
  }
  return best;
}

/** @param {Record<string, any> | null} summary */
export function incomingCount(summary) {
  const value = summary?.incoming;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  if (value === true) return 1;
  return 0;
}

/** @param {ReturnType<typeof mapPlaythroughDump>} mapped */
export function sawIncomingThreat(mapped) {
  if (incomingCount(mapped.summary) > 0) return true;
  return mapped.events.some((event) => event.type === 'torpedoLaunch' && event.owner === 'enemy');
}

/**
 * Negative control: a preview without A2 has neither summary nor the event log,
 * so fire-and-hit fails even if a torpedo visually left the tube.
 * @param {ReturnType<typeof mapPlaythroughDump>} mapped
 */
export function judgeFireAndHit(mapped) {
  if (!mapped.hasSummary || !mapped.hasLog) {
    return { ok: false, detail: 'missing A2 getGameSummary/getCombatEventLog' };
  }
  const hit = mapped.events.some((event) => event.type === 'torpedoHit');
  if (!hit) return { ok: false, detail: 'no torpedoHit in getCombatEventLog' };
  if (mapped.flashes < 1) {
    return { ok: false, detail: 'no flash alive in getPresentationGauntlet().vfx' };
  }
  return { ok: true, detail: 'torpedoHit with flash' };
}

/** @param {string} hudText */
export function judgeStealth(hudText) {
  const quiet = hudText.includes('QUIET');
  const deep = hudText.includes('→ DEEP');
  const slow = hudText.includes('1/3');
  if (quiet && deep && slow) return { ok: true, detail: 'quiet, deep, one-third' };
  return { ok: false, detail: `stealth HUD missing quiet=${quiet} deep=${deep} slow=${slow}` };
}

/** @param {{ beforeText: string, afterText: string, beforeCharges: number | null, afterCharges: number | null, events: { type: string }[] }} trace */
export function judgeBubble(trace) {
  const before = bubbleCount(trace.beforeText);
  const after = bubbleCount(trace.afterText);
  const textDrop = before != null && after != null && after < before;
  const chargeDrop =
    trace.beforeCharges != null &&
    trace.afterCharges != null &&
    trace.afterCharges < trace.beforeCharges;
  const event = trace.events.some((item) => item.type === 'countermeasure');
  if (textDrop || chargeDrop || event) return { ok: true, detail: 'bubble screen deployed' };
  return { ok: false, detail: 'bubble count did not drop' };
}

/** @param {string} text */
function bubbleCount(text) {
  const match = text.match(/Bubbles ×(\d+)/);
  return match ? Number(match[1]) : null;
}

/** @param {{ beforeText: string, afterText: string, events: { type: string }[] }} trace */
export function judgePing(trace) {
  const cooling = /Ping\s+\d+s/.test(trace.afterText);
  const event = trace.events.some((item) => item.type === 'sonarPing');
  if (cooling || event) return { ok: true, detail: 'active ping' };
  return { ok: false, detail: 'ping did not start a cooldown' };
}

/** @param {{ requested: string, actual: string | undefined }[]} rows */
export function judgeDoctrines(rows) {
  const missing = DOCTRINES.filter(
    (tactic) => !rows.some((row) => row.requested === tactic && row.actual === tactic),
  );
  if (missing.length === 0) return { ok: true, detail: 'all doctrines engaged' };
  return { ok: false, detail: `doctrine mismatch: ${missing.join(', ')}` };
}

/** @param {ReturnType<typeof mapPlaythroughDump>} mapped */
export function judgeWave2(mapped) {
  const fromSummary = Number(mapped.summary?.wave);
  const hudMatch = mapped.hudText.match(/Wave\s+(\d+)/);
  const fromHud = hudMatch ? Number(hudMatch[1]) : NaN;
  const wave = Number.isFinite(fromSummary) && fromSummary > 0 ? fromSummary : fromHud;
  if (wave >= 2) return { ok: true, detail: `wave ${wave}` };
  return { ok: false, detail: `wave ${Number.isFinite(wave) ? wave : 'unknown'}` };
}

/** @param {{ sawEnded: boolean, sawBegin: boolean }} trace */
export function judgeGameoverRestart(trace) {
  if (!trace.sawEnded) return { ok: false, detail: 'never reached gameover' };
  if (!trace.sawBegin) return { ok: false, detail: 'restart did not return to Begin Patrol' };
  return { ok: true, detail: 'gameover then restart' };
}

/** @param {{ sawIncoming: boolean, deployed: boolean }} trace */
export function judgeIncomingDecoy(trace) {
  if (!trace.sawIncoming) return { ok: false, detail: 'no incoming torpedo observed' };
  if (!trace.deployed)
    return { ok: false, detail: 'decoy was not deployed against the incoming torpedo' };
  return { ok: true, detail: 'decoy against incoming torpedo' };
}

/** @param {{ opened: boolean, hadSkip: boolean, closed: boolean, steps: number | null }} trace */
export function judgeTutorial(trace) {
  if (!trace.opened) return { ok: false, detail: 'tutorial did not open' };
  if (!trace.hadSkip) return { ok: false, detail: 'missing data-tutorial-action=skip' };
  if (!trace.closed) return { ok: false, detail: 'skip did not close the tutorial' };
  const quick = trace.steps != null && trace.steps <= 4;
  return {
    ok: true,
    detail: quick
      ? `quick start ${trace.steps} steps`
      : `tutorial skip closed a ${trace.steps}-step tour`,
  };
}

/** @param {{ now: () => number, wait: (ms: number) => Promise<void> }} session @param {number} ms */
async function advance(session, ms) {
  const before = session.now();
  await session.wait(ms);
  return session.now() > before;
}

/** @param {{ budgetMs?: number, now: () => number }} session @param {number} fallback */
function limit(session, fallback) {
  return session.now() + (session.budgetMs ?? fallback);
}

/** @param {ReturnType<typeof mapPlaythroughDump>} mapped @param {object} judged */
function finish(mapped, judged) {
  return { ...judged, summary: mapped.summary ?? null, mapped };
}

export async function runStealthApproach(session) {
  await session.beginSkip();
  await session.key('KeyR');
  await session.key('KeyV');
  await session.key('KeyI');
  await advance(session, 400);
  const mapped = mapPlaythroughDump(await session.dump());
  return finish(mapped, judgeStealth(mapped.hudText));
}

export async function runFireAndHit(session) {
  await session.beginSkip();
  await session.key('KeyB');
  await session.setTactic('intercept');
  const deadline = limit(session, 90_000);
  let mapped = mapPlaythroughDump(null);
  let hitAt = null;
  while (session.now() <= deadline) {
    mapped = mapPlaythroughDump(await session.dump());
    if (!mapped.hasSummary || !mapped.hasLog) break;
    const hit = mapped.events.some((event) => event.type === 'torpedoHit');
    if (hit && mapped.flashes >= 1) break;
    if (hit) {
      hitAt = hitAt ?? session.now();
      if (session.now() - hitAt > FLASH_WINDOW_MS) break;
    }
    const range = nearestRange(mapped.summary);
    if (!hit && range != null && range <= ENGAGE_RANGE) await session.key('KeyF');
    if (!(await advance(session, 200))) break;
  }
  return finish(mapped, judgeFireAndHit(mapped));
}

export async function runIncomingDecoy(session) {
  await session.beginSkip();
  await session.key('KeyZ');
  await session.key('KeyP');
  await session.clickAction('sonar');
  await session.setTactic('intercept');
  const deadline = limit(session, 120_000);
  let mapped = mapPlaythroughDump(null);
  let sawIncoming = false;
  let decoysBefore = null;
  let deployed = false;
  while (session.now() <= deadline) {
    mapped = mapPlaythroughDump(await session.dump());
    if (!sawIncoming && sawIncomingThreat(mapped)) {
      sawIncoming = true;
      decoysBefore = typeof mapped.summary?.decoys === 'number' ? mapped.summary.decoys : null;
      await session.clickAction('weapon', 'decoy');
      await session.key('KeyF');
    }
    if (sawIncoming) {
      const spent =
        (decoysBefore != null &&
          typeof mapped.summary?.decoys === 'number' &&
          mapped.summary.decoys < decoysBefore) ||
        mapped.events.some((event) => event.type === 'countermeasure' && event.kind === 'foxer') ||
        mapped.hudText.includes('FOXER');
      if (spent) {
        deployed = true;
        break;
      }
    }
    if (!(await advance(session, 250))) break;
  }
  return finish(mapped, judgeIncomingDecoy({ sawIncoming, deployed }));
}

export async function runBubble(session) {
  await session.beginSkip();
  const before = mapPlaythroughDump(await session.dump());
  await session.clickAction('screen');
  await advance(session, 300);
  const after = mapPlaythroughDump(await session.dump());
  return finish(
    after,
    judgeBubble({
      beforeText: before.hudText,
      afterText: after.hudText,
      beforeCharges: numberOrNull(before.summary?.cmCharges),
      afterCharges: numberOrNull(after.summary?.cmCharges),
      events: after.events,
    }),
  );
}

export async function runPing(session) {
  await session.beginSkip();
  const before = mapPlaythroughDump(await session.dump());
  await session.clickAction('sonar');
  await advance(session, 300);
  const after = mapPlaythroughDump(await session.dump());
  return finish(
    after,
    judgePing({ beforeText: before.hudText, afterText: after.hudText, events: after.events }),
  );
}

export async function runDoctrines(session) {
  await session.beginSkip();
  const rows = [];
  for (const tactic of DOCTRINES) {
    const probe = await session.setTactic(tactic);
    rows.push({ requested: tactic, actual: probe?.tactic });
  }
  const mapped = mapPlaythroughDump(await session.dump());
  return finish(mapped, judgeDoctrines(rows));
}

export async function runWave2(session) {
  await session.beginSkip();
  await session.key('KeyB');
  await session.setTactic('intercept');
  const deadline = limit(session, 240_000);
  let mapped = mapPlaythroughDump(null);
  while (session.now() <= deadline) {
    mapped = mapPlaythroughDump(await session.dump());
    if (judgeWave2(mapped).ok) break;
    const range = nearestRange(mapped.summary);
    if (range != null && range <= ENGAGE_RANGE) await session.key('KeyF');
    if (!(await advance(session, 250))) break;
  }
  return finish(mapped, judgeWave2(mapped));
}

export async function runGameoverRestart(session) {
  await session.beginSkip();
  await session.key('KeyZ');
  await session.key('KeyP');
  await session.clickAction('sonar');
  await session.setTactic('intercept');
  const deadline = limit(session, 180_000);
  let mapped = mapPlaythroughDump(null);
  let sawEnded = false;
  while (session.now() <= deadline) {
    mapped = mapPlaythroughDump(await session.dump());
    sawEnded = mapped.summary?.phase === 'gameover' || mapped.overlayText.includes('PATROL ENDED');
    if (sawEnded) break;
    if (!(await advance(session, 250))) break;
  }
  if (sawEnded) {
    await session.clickAction('restart');
    await advance(session, 400);
    mapped = mapPlaythroughDump(await session.dump());
  }
  const sawBegin = mapped.overlayText.includes('Begin Patrol') || mapped.summary?.phase === 'menu';
  return finish(mapped, judgeGameoverRestart({ sawEnded, sawBegin }));
}

export async function runTutorialQuickStart(session) {
  await session.beginKeepTutorial();
  const opened = mapPlaythroughDump(await session.dump());
  const hadSkip = await session.hasSkip();
  await session.clickTutorialSkip();
  await advance(session, 200);
  const closed = mapPlaythroughDump(await session.dump());
  return finish(
    closed,
    judgeTutorial({
      opened: opened.tutorialOpen,
      hadSkip,
      closed: !closed.tutorialOpen,
      steps: opened.tutorialSteps,
    }),
  );
}

/** @param {unknown} value */
function numberOrNull(value) {
  return typeof value === 'number' ? value : null;
}

export const JOURNEY_RUNNERS = [
  { id: 'stealth-approach', run: runStealthApproach },
  { id: 'fire-and-hit', run: runFireAndHit },
  { id: 'incoming-torpedo-decoy', run: runIncomingDecoy },
  { id: 'bubble', run: runBubble },
  { id: 'ping', run: runPing },
  { id: 'doctrines', run: runDoctrines },
  { id: 'wave-2', run: runWave2 },
  { id: 'gameover-restart', run: runGameoverRestart },
  { id: 'tutorial-quick-start', run: runTutorialQuickStart },
];

if (process.env.VITEST) {
  const { describe, expect, it } = await import('vitest');

  function fakeSession(overrides = {}) {
    const dumps = overrides.dumps ?? [{}];
    let index = 0;
    let time = overrides.time ?? 0;
    const keys = [];
    const clicks = [];
    const session = {
      keys,
      clicks,
      budgetMs: overrides.budgetMs ?? 2_000,
      now: () => time,
      async wait(ms) {
        time += ms;
      },
      async dump() {
        const raw = dumps[Math.min(index, dumps.length - 1)];
        index += 1;
        return raw;
      },
      async key(code) {
        keys.push(code);
      },
      async clickAction(action, value) {
        clicks.push(value ? `${action}:${value}` : action);
      },
      async clickTutorialSkip() {
        clicks.push('tutorial-skip');
      },
      async setTactic(tactic) {
        return { tactic };
      },
      async beginSkip() {},
      async beginKeepTutorial() {},
      async hasSkip() {
        return true;
      },
    };
    return Object.assign(session, overrides, { keys, clicks });
  }

  const a2 = (extra) => ({
    summaryCallable: true,
    logCallable: true,
    summary: { phase: 'playing', wave: 1, decoys: 1, cmCharges: 2, ships: [] },
    events: [],
    flashes: 0,
    hudText: '',
    overlayText: '',
    ...extra,
  });

  describe('playthrough lib', () => {
    it('marks a SwiftShader renderer as NOT A VISUAL PASS', () => {
      const report = buildReport({
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)))',
        journeys: [{ name: 'fire-and-hit', ok: true }],
        samples: [{ journey: 'fire-and-hit', summary: { phase: 'playing' } }],
        hudCoverage: 0.2,
      });
      expect(report.isSwiftShader).toBe(true);
      expect(JSON.stringify(report)).toContain('NOT A VISUAL PASS');
    });

    it('does not call a discrete GPU capture a visual pass', () => {
      const report = buildReport({
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0)',
      });
      expect(report.isSwiftShader).toBe(false);
      expect(JSON.stringify(report)).not.toContain('NOT A VISUAL PASS');
      expect(report.visual).toBe('EVIDENCE ONLY');
    });

    it('fails fire-and-hit on a preview without A2 (negative control)', async () => {
      const session = fakeSession({
        dumps: [
          { summaryCallable: false, logCallable: false, events: null, flashes: 0, hudText: '' },
        ],
      });
      const result = await runFireAndHit(session);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('getGameSummary');
    });

    it('fails fire-and-hit when the log has no torpedoHit', async () => {
      const session = fakeSession({
        dumps: [
          a2({
            summary: { phase: 'playing', ships: [{ range: 30 }] },
            events: [{ type: 'torpedoLaunch' }],
          }),
        ],
      });
      const result = await runFireAndHit(session);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('torpedoHit');
    });

    it('fails fire-and-hit when a hit produces no flash within 1s', async () => {
      const session = fakeSession({
        budgetMs: 5_000,
        dumps: [a2({ events: [{ type: 'torpedoHit', id: 't1' }], flashes: 0 })],
      });
      const result = await runFireAndHit(session);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('flash');
    });

    it('passes fire-and-hit only after a torpedoHit and a live flash, and fires inside range', async () => {
      const session = fakeSession({
        dumps: [
          a2({ summary: { phase: 'playing', ships: [{ range: 10 }] }, events: [], flashes: 0 }),
          a2({
            summary: { phase: 'playing', ships: [{ range: 9 }] },
            events: [{ type: 'torpedoHit', id: 't1', targetId: 'freighter-1' }],
            flashes: 2,
          }),
        ],
      });
      const result = await runFireAndHit(session);
      expect(result.ok).toBe(true);
      expect(session.keys).toContain('KeyF');
      expect(result.detail).toContain('torpedoHit');
    });

    it('counts overlapping HUD panels once', () => {
      const viewport = { width: 200, height: 100 };
      const fraction = hudCoverageFraction(
        [
          { x: 0, y: 0, w: 100, h: 100 },
          { x: 50, y: 0, w: 100, h: 100 },
        ],
        viewport,
      );
      expect(fraction).toBeCloseTo(0.75, 5);
      expect(
        hudCoverageFraction(
          [
            { x: 0, y: 0, w: 100, h: 100 },
            { x: 0, y: 0, w: 100, h: 100 },
          ],
          { width: 100, height: 100 },
        ),
      ).toBeCloseTo(1, 5);
    });

    it('drives every doctrine through debugSetTactic and fails a manual echo', async () => {
      const engaged = [];
      const okSession = fakeSession({
        async setTactic(tactic) {
          engaged.push(tactic);
          return { tactic };
        },
      });
      const ok = await runDoctrines(okSession);
      expect(ok.ok).toBe(true);
      expect(engaged).toEqual(DOCTRINES);

      const stuck = fakeSession({
        async setTactic() {
          return { tactic: 'manual' };
        },
      });
      const bad = await runDoctrines(stuck);
      expect(bad.ok).toBe(false);
    });

    it('tries CDP at 127.0.0.1:9223 before launch', async () => {
      let launched = false;
      const browser = { kind: 'cdp' };
      const connected = await connectChromium({
        async connectOverCDP(endpoint) {
          expect(endpoint).toBe(CDP_ENDPOINT);
          return browser;
        },
        async launch() {
          launched = true;
          return { kind: 'launch' };
        },
      });
      expect(connected.via).toBe('cdp');
      expect(connected.browser).toBe(browser);
      expect(launched).toBe(false);
    });

    it('falls back to chromium.launch when CDP refuses', async () => {
      const connected = await connectChromium(
        {
          async connectOverCDP() {
            throw new Error('ECONNREFUSED 9223');
          },
          async launch(options) {
            return { kind: 'launch', options };
          },
        },
        { args: ['--no-sandbox'] },
      );
      expect(connected.via).toBe('launch');
      expect(connected.browser.options.args).toContain('--no-sandbox');
      expect(connected.cdpError).toContain('ECONNREFUSED');
    });

    it('wires the playthrough script and npm script to the journey list', () => {
      const script = readFileSync(join(ROOT, 'scripts/playthrough.mjs'), 'utf8');
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      expect(pkg.scripts['test:playthrough']).toBe('node scripts/playthrough.mjs');
      expect(script).toContain('connectChromium');
      expect(script).toContain('buildReport');
      expect(script).toContain('hudCoverageFraction');
      expect(script).toContain('for (const journey of JOURNEY_RUNNERS)');
      expect(script).toContain('PLAYTHROUGH_VIEWPORT');
      expect(JOURNEY_RUNNERS.map((journey) => journey.id)).toEqual([
        'stealth-approach',
        'fire-and-hit',
        'incoming-torpedo-decoy',
        'bubble',
        'ping',
        'doctrines',
        'wave-2',
        'gameover-restart',
        'tutorial-quick-start',
      ]);
      expect(playthroughStamp(new Date('2026-09-26T00:00:00.000Z'))).toBe(
        '2026-09-26T00-00-00-000Z',
      );
    });

    it('accepts a bubble drop, a ping cooldown, wave 2, and a restart', async () => {
      const bubble = await runBubble(
        fakeSession({
          dumps: [
            { hudText: 'Bubbles ×2', summaryCallable: false, events: [] },
            { hudText: 'Bubbles ×1', summaryCallable: false, events: [] },
          ],
        }),
      );
      expect(bubble.ok).toBe(true);

      const ping = await runPing(
        fakeSession({
          dumps: [
            { hudText: 'Ping', summaryCallable: false, events: [] },
            { hudText: 'Ping 4s', summaryCallable: false, events: [] },
          ],
        }),
      );
      expect(ping.ok).toBe(true);

      const wave = await runWave2(
        fakeSession({
          dumps: [a2({ summary: { wave: 1, ships: [] } }), a2({ summary: { wave: 2, ships: [] } })],
        }),
      );
      expect(wave.ok).toBe(true);

      const restartSession = fakeSession({
        dumps: [
          a2({ summary: { phase: 'playing' }, overlayText: '' }),
          a2({ summary: { phase: 'gameover' }, overlayText: 'PATROL ENDED' }),
          a2({ summary: { phase: 'menu' }, overlayText: 'Begin Patrol' }),
        ],
      });
      const restart = await runGameoverRestart(restartSession);
      expect(restart.ok).toBe(true);
      expect(restart.detail).toContain('restart');
      expect(restartSession.clicks).toContain('restart');
    });

    it('deploys a decoy only after an incoming enemy torpedo', async () => {
      const quiet = await runIncomingDecoy(
        fakeSession({ dumps: [a2({ summary: { incoming: 0, decoys: 1, ships: [] } })] }),
      );
      expect(quiet.ok).toBe(false);
      expect(quiet.detail).toContain('incoming');

      const attackedSession = fakeSession({
        dumps: [
          a2({ summary: { incoming: 1, decoys: 1, ships: [] }, events: [] }),
          a2({
            summary: { incoming: 1, decoys: 0, ships: [] },
            events: [{ type: 'countermeasure', kind: 'foxer' }],
            hudText: 'FOXER AWAY',
          }),
        ],
      });
      const attacked = await runIncomingDecoy(attackedSession);
      expect(attacked.ok).toBe(true);
      expect(attackedSession.clicks).toContain('weapon:decoy');
      expect(attackedSession.keys).toContain('KeyF');
    });

    it('orders a quiet deep creep and closes the tutorial with skip', async () => {
      const stealthSession = fakeSession({
        dumps: [{ hudText: 'QUIET · manual\n12 m → DEEP\n4 kn → 1/3', summaryCallable: false }],
      });
      const stealth = await runStealthApproach(stealthSession);
      expect(stealth.ok).toBe(true);
      expect(stealthSession.keys).toEqual(['KeyR', 'KeyV', 'KeyI']);

      const tutorialSession = fakeSession({
        dumps: [
          { tutorialOpen: true, tutorialSteps: 4, hudText: '' },
          { tutorialOpen: false, hudText: '' },
        ],
      });
      const tutorial = await runTutorialQuickStart(tutorialSession);
      expect(tutorial.ok).toBe(true);
      expect(tutorial.detail).toContain('quick start');
      expect(tutorialSession.clicks).toContain('tutorial-skip');
    });
  });
}
