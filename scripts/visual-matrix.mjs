#!/usr/bin/env node
/**
 * Plan 018 finish — four-combo visual matrix capture.
 *
 * Captures gerstner|spectral × legacy-v1|littoral-v2 at high quality with a
 * day/dusk/night × calm/storm condition subset and seven POVs (free attempted;
 * skipped with reason if flaky).
 *
 * Expects `npm run preview` (or vite preview) already serving.
 *
 * Usage:
 *   node scripts/visual-matrix.mjs [preview-url]
 *
 * Default preview URL: tests/e2e/helpers.mjs DEFAULT_URL (http://127.0.0.1:8080/)
 * Plan 018 lead uses port 8082:
 *   node scripts/visual-matrix.mjs http://127.0.0.1:8082/
 *   MATRIX_COMBOS=spectral-legacy,spectral-littoral node scripts/visual-matrix.mjs http://127.0.0.1:8082/
 *
 * Artifacts:
 *   artifacts/plan-018-finish/{gerstner-legacy,gerstner-littoral,spectral-legacy,spectral-littoral}/
 *   artifacts/plan-018-finish/matrix-report.md
 *   artifacts/plan-018-finish/matrix-manifest.json
 *
 * Screenshots are human-review artifacts — not self-approved PASS criteria.
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
  readEnvironmentDiagnostics,
  readQualityLabel,
  readRendererInfo,
  setMode,
} from '../tests/e2e/helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = join(root, 'artifacts', 'plan-018-finish');
const baseUrl = process.argv[2] || DEFAULT_URL;

/** @type {{ id: string, ocean: 'gerstner' | 'spectral', world: 'legacy-v1' | 'littoral-v2' }[]} */
const ALL_COMBOS = [
  { id: 'gerstner-legacy', ocean: 'gerstner', world: 'legacy-v1' },
  { id: 'gerstner-littoral', ocean: 'gerstner', world: 'littoral-v2' },
  { id: 'spectral-legacy', ocean: 'spectral', world: 'legacy-v1' },
  { id: 'spectral-littoral', ocean: 'spectral', world: 'littoral-v2' },
];

const comboFilter = (process.env.MATRIX_COMBOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {typeof ALL_COMBOS} */
const COMBOS = comboFilter.length
  ? ALL_COMBOS.filter((c) => comboFilter.includes(c.id))
  : ALL_COMBOS;

if (comboFilter.length && COMBOS.length === 0) {
  throw new Error(`MATRIX_COMBOS matched no combos: ${comboFilter.join(',')}`);
}

/** @type {{ file: string, mode: 'tactical' | 'chase' | 'bridge' | 'periscope' | 'map' | 'sonar' | 'free' }[]} */
const POVS = [
  { file: 'caribbean-noon-tactical', mode: 'tactical' },
  { file: 'underwater-chase', mode: 'chase' },
  { file: 'bridge-convoy', mode: 'bridge' },
  { file: 'periscope-convoy', mode: 'periscope' },
  { file: 'shore-map', mode: 'map' },
  { file: 'sonar-plot', mode: 'sonar' },
  { file: 'free', mode: 'free' },
];

/** @type {Record<string, { timeOfDay: number, seaState: number, sunElevation?: number }>} */
const CONDITIONS = {
  'day-calm': { timeOfDay: 0.42, seaState: 0.25 },
  'day-storm': { timeOfDay: 0.42, seaState: 0.65 },
  'dusk-calm': { timeOfDay: 0.74, seaState: 0.25 },
  'night-calm': { timeOfDay: 0.9, seaState: 0.25, sunElevation: -5 },
};

/**
 * @param {string} comboId
 * @returns {{ condition: string, mode: 'tactical' | 'chase' | 'bridge' | 'periscope' | 'map' | 'sonar' | 'free', filename: string }[]}
 */
const fileFilter = (process.env.MATRIX_FILES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function capturePlanForCombo(comboId) {
  /** @type {{ condition: string, mode: 'tactical' | 'chase' | 'bridge' | 'periscope' | 'map' | 'sonar' | 'free', filename: string }[]} */
  const plan = [];

  for (const { file, mode } of POVS) {
    plan.push({ condition: 'day-calm', mode, filename: `${file}.png` });
  }

  const extraConditions = ['day-storm', 'dusk-calm', 'night-calm'];
  const extraModes =
    comboId === 'spectral-littoral'
      ? /** @type {const} */ (['tactical', 'chase', 'bridge'])
      : /** @type {const} */ (['tactical']);

  for (const condition of extraConditions) {
    for (const mode of extraModes) {
      plan.push({ condition, mode, filename: `${condition}-${mode}.png` });
    }
  }

  if (!fileFilter.length) return plan;
  return plan.filter((shot) => fileFilter.some((token) => shot.filename.includes(token)));
}

/**
 * @param {string} base
 * @param {{ ocean: string, world: string }} combo
 */
function comboUrl(base, combo) {
  const url = new URL(base || DEFAULT_URL);
  url.searchParams.set('ocean', combo.ocean);
  url.searchParams.set('world', combo.world);
  url.searchParams.set('quality', 'high');
  return url.toString();
}

/**
 * @param {import('playwright').Page} page
 */
async function openLookDev(page) {
  const panel = page.locator('#lookdev');
  if ((await panel.getAttribute('hidden')) !== null) {
    await page.keyboard.press('KeyH');
    await pollUntil(
      page,
      4000,
      async () => (await panel.getAttribute('hidden')) === null,
      'look-dev panel open',
    );
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function closeLookDev(page) {
  const panel = page.locator('#lookdev');
  if ((await panel.getAttribute('hidden')) === null) {
    await page.keyboard.press('KeyH');
    await pollUntil(
      page,
      4000,
      async () => (await panel.getAttribute('hidden')) !== null,
      'look-dev panel close',
    );
  }
}

/**
 * Asset-credit rebuilds replace look-dev innerHTML; wait until sliders exist,
 * then set every field in one evaluate so a mid-pass re-render cannot strand us.
 * @param {import('playwright').Page} page
 * @param {string} conditionId
 */
async function applyCondition(page, conditionId) {
  const condition = CONDITIONS[conditionId];
  if (!condition) throw new Error(`Unknown condition ${conditionId}`);
  const sunElevation = condition.sunElevation ?? 58;
  const payload = {
    timeOfDay: condition.timeOfDay,
    seaState: condition.seaState,
    sunElevation,
  };

  let lastError = 'look-dev sliders missing';
  for (let attempt = 0; attempt < 6; attempt++) {
    await openLookDev(page);
    try {
      await page.waitForFunction(
        () => {
          const root = document.querySelector('#lookdev');
          if (!(root instanceof HTMLElement) || root.hidden) return false;
          return Boolean(
            root.querySelector('input[data-field="timeOfDay"]') &&
            root.querySelector('input[data-field="seaState"]') &&
            root.querySelector('input[data-field="sunElevation"]'),
          );
        },
        { timeout: 4000 },
      );
      await page.evaluate((fields) => {
        const set = (field, value) => {
          const node = document.querySelector(`#lookdev input[data-field="${field}"]`);
          if (!(node instanceof HTMLInputElement)) {
            throw new Error(`missing look-dev input ${field}`);
          }
          node.value = String(value);
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('timeOfDay', fields.timeOfDay);
        set('seaState', fields.seaState);
        set('sunElevation', fields.sunElevation);
      }, payload);
      await page.waitForTimeout(500);
      await closeLookDev(page);
      await page.waitForTimeout(200);
      return;
    } catch (err) {
      lastError = String(err?.message || err);
      await page.keyboard.press('KeyH').catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`applyCondition ${conditionId} failed: ${lastError}`);
}

/**
 * @param {import('playwright').Page} page
 * @param {'gerstner' | 'spectral'} backend
 */
async function assertBackendReady(page, backend) {
  await pollUntil(
    page,
    E2E_TIMEOUT_MS,
    async () => {
      const diag = await readEnvironmentDiagnostics(page);
      return Boolean(diag && diag.backend === backend && diag.ready);
    },
    `${backend} environment backend ready`,
  );
  const diag = await readEnvironmentDiagnostics(page);
  if (!diag) throw new Error('window.__silentDepths.getEnvironmentDiagnostics() missing');
  if (diag.backend !== backend || !diag.ready) {
    throw new Error(
      `${backend} coverage failed (silent fallback is not coverage): ${JSON.stringify(diag)}`,
    );
  }
  if (backend === 'spectral' && diag.fallbackReason) {
    throw new Error(`spectral fallbackReason=${diag.fallbackReason}`);
  }
}

/**
 * @param {import('playwright').Page} page
 */
async function waitForCanvas(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('#scene');
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return Boolean(gl) && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: E2E_TIMEOUT_MS },
  );
  await page.waitForTimeout(600);
}

/**
 * @param {{
 *   combo: typeof COMBOS[number],
 *   url: string,
 *   captures: ReturnType<typeof capturePlanForCombo>,
 *   taken: ManifestEntry[],
 *   skipped: SkippedEntry[],
 *   errors: string[],
 * }} ctx
 * @param {import('playwright').Page} page
 */
async function captureCombo(ctx, page) {
  const comboDir = join(artifactsRoot, ctx.combo.id);
  mkdirSync(comboDir, { recursive: true });

  const resp = await page.goto(ctx.url, { waitUntil: 'load', timeout: E2E_TIMEOUT_MS });
  const status = resp?.status() ?? 0;
  if (status >= 400 || status === 0) {
    throw new Error(`Preview load failed with status ${status}`);
  }

  await beginPatrolAndSkipTutorial(page);
  await waitForCanvas(page);
  await assertBackendReady(page, ctx.combo.ocean);
  await assertPlaying(page);
  await page
    .waitForSelector('#lookdev .lookdev-credits, #lookdev .lookdev-credit-empty', {
      state: 'attached',
      timeout: 15000,
    })
    .catch(() => undefined);

  let activeCondition = null;
  for (const shot of ctx.captures) {
    const relPath = join(ctx.combo.id, shot.filename);
    const outPath = join(comboDir, shot.filename);

    /** @type {ManifestEntry} */
    const entry = {
      combo: ctx.combo.id,
      condition: shot.condition,
      mode: shot.mode,
      file: relPath.replace(/\\/g, '/'),
      ok: false,
    };

    try {
      if (shot.condition !== activeCondition) {
        await applyCondition(page, shot.condition);
        activeCondition = shot.condition;
      }
      if (shot.mode === 'free') {
        try {
          await setMode(page, 'free');
        } catch (freeErr) {
          const reason = String(freeErr?.message || freeErr);
          ctx.skipped.push({
            combo: ctx.combo.id,
            condition: shot.condition,
            mode: shot.mode,
            file: entry.file,
            reason: `free POV flaky in headless: ${reason}`,
          });
          entry.ok = false;
          entry.skipReason = ctx.skipped[ctx.skipped.length - 1].reason;
          ctx.taken.push(entry);
          continue;
        }
      } else {
        await setMode(page, shot.mode);
      }

      await page.waitForTimeout(500);
      await assertPlaying(page);
      await page.screenshot({ path: outPath });
      entry.ok = true;
      ctx.taken.push(entry);
    } catch (err) {
      const msg = String(err?.message || err);
      entry.error = msg;
      ctx.taken.push(entry);
      ctx.errors.push(`${ctx.combo.id}/${shot.filename}: ${msg}`);
    }
  }

  const diagnostics = await readEnvironmentDiagnostics(page);
  return diagnostics;
}

/** @typedef {{ combo: string, condition: string, mode: string, file: string, ok: boolean, error?: string, skipReason?: string }} ManifestEntry */
/** @typedef {{ combo: string, condition: string, mode: string, file: string, reason: string }} SkippedEntry */

/** @type {ManifestEntry[]} */
const manifestEntries = [];
/** @type {SkippedEntry[]} */
const skippedEntries = [];
/** @type {string[]} */
const allErrors = [];
/** @type {{ combo: string, url: string, diagnostics: unknown }[]} */
const comboResults = [];

mkdirSync(artifactsRoot, { recursive: true });

/** @type {{ combo: string, condition: string, mode: string, file: string }[]} */
const plannedFiles = COMBOS.flatMap((combo) =>
  capturePlanForCombo(combo.id).map((shot) => ({
    combo: combo.id,
    condition: shot.condition,
    mode: shot.mode,
    file: `${combo.id}/${shot.filename}`.replace(/\\/g, '/'),
  })),
);

/**
 * @param {{
 *   manifestEntries: ManifestEntry[],
 *   skippedEntries: SkippedEntry[],
 *   allErrors: string[],
 *   comboResults: { combo: string, url: string, diagnostics: unknown }[],
 *   rendererInfo: { renderer: string | null, vendor: string | null },
 *   quality: string,
 * }} state
 */
function writeMatrixArtifacts(state) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    viewport: VIEWPORT,
    quality: state.quality,
    renderer: state.rendererInfo,
    combos: COMBOS.map((c) => ({
      id: c.id,
      url: comboUrl(baseUrl, c),
      captures: capturePlanForCombo(c.id).length,
    })),
    plannedFiles,
    files: state.manifestEntries,
    skipped: state.skippedEntries,
    errors: state.allErrors,
    ok:
      state.allErrors.length === 0 &&
      state.manifestEntries.length === plannedFiles.length &&
      state.manifestEntries.every((e) => e.ok || e.skipReason),
  };

  writeFileSync(
    join(artifactsRoot, 'matrix-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const reportLines = [
    '# Plan 018 finish — visual matrix report',
    '',
    '**Status:** Machine capture only — **not operator PASS.**',
    '',
    'Lead: inspect every PNG and fill Pass / Notes columns after Wave 3 capture.',
    '',
    '## Commands',
    '',
    '```sh',
    'npm run build',
    'npx vite preview --host 127.0.0.1 --port 8082',
    'node scripts/visual-matrix.mjs http://127.0.0.1:8082/',
    '```',
    '',
    '## URLs',
    '',
    '| Combo | URL |',
    '| --- | --- |',
  ];

  for (const combo of COMBOS) {
    reportLines.push(`| ${combo.id} | \`${comboUrl(baseUrl, combo)}\` |`);
  }

  reportLines.push(
    '',
    '## Condition subset (look-dev KeyH)',
    '',
    '| Condition | timeOfDay | seaState | sunElevation |',
    '| --- | ---: | ---: | ---: |',
    '| day-calm | 0.42 | ≤0.28 (0.25) | default |',
    '| day-storm | 0.42 | ≥0.6 (0.65) | default |',
    '| dusk-calm | 0.74 | ≤0.28 (0.25) | default |',
    '| night-calm | 0.90 | ≤0.28 (0.25) | -5 |',
    '',
    '## Capture matrix',
    '',
    '| Combo | Condition | POV | File | Pass | Notes |',
    '| --- | --- | --- | --- | --- | --- |',
  );

  /** @type {Map<string, ManifestEntry | SkippedEntry>} */
  const outcomeByFile = new Map();
  for (const entry of state.manifestEntries) outcomeByFile.set(entry.file, entry);
  for (const skip of state.skippedEntries) outcomeByFile.set(skip.file, skip);

  for (const combo of COMBOS) {
    for (const shot of capturePlanForCombo(combo.id)) {
      const file = `${combo.id}/${shot.filename}`.replace(/\\/g, '/');
      const outcome = outcomeByFile.get(file);
      if (outcome && 'skipReason' in outcome && outcome.skipReason) {
        reportLines.push(
          `| ${combo.id} | ${shot.condition} | ${shot.mode} | \`${file}\` | SKIP | ${outcome.skipReason} |`,
        );
      } else if (outcome && 'reason' in outcome) {
        reportLines.push(
          `| ${combo.id} | ${shot.condition} | ${shot.mode} | \`${file}\` | SKIP | ${outcome.reason} |`,
        );
      } else if (outcome && 'error' in outcome && outcome.error) {
        reportLines.push(
          `| ${combo.id} | ${shot.condition} | ${shot.mode} | \`${file}\` | FAIL | ${outcome.error} |`,
        );
      } else {
        reportLines.push(`| ${combo.id} | ${shot.condition} | ${shot.mode} | \`${file}\` | | |`);
      }
    }
  }

  reportLines.push(
    '',
    '## Skipped / flaky POVs',
    '',
    state.skippedEntries.length
      ? state.skippedEntries.map((s) => `- **${s.file}:** ${s.reason}`).join('\n')
      : '- (none)',
    '',
    '## Run summary',
    '',
    `- Captured files: ${state.manifestEntries.filter((e) => e.ok).length} / ${plannedFiles.length}`,
    `- Skipped: ${state.skippedEntries.length}`,
    `- Errors: ${state.allErrors.length}`,
    `- Generated: ${manifest.generatedAt}`,
    '',
    '### Diagnostics (last combo)',
    '',
    '```json',
    JSON.stringify(state.comboResults[state.comboResults.length - 1]?.diagnostics ?? null, null, 2),
    '```',
    '',
    '---',
    '',
    '**Explicit:** This report and PNG artifacts are **not operator PASS**. Operator gates remain in `docs/release/plan-018-operator-accept.md`.',
    '',
  );

  writeFileSync(join(artifactsRoot, 'matrix-report.md'), `${reportLines.join('\n')}\n`);
  return manifest;
}

if (!comboFilter.length) {
  writeMatrixArtifacts({
    manifestEntries: [],
    skippedEntries: [],
    allErrors: [],
    comboResults: [],
    rendererInfo: { renderer: null, vendor: null },
    quality: 'high',
  });
}

const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
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

let rendererInfo = { renderer: null, vendor: null };
let quality = 'high';

try {
  for (const combo of COMBOS) {
    const url = comboUrl(baseUrl, combo);
    const captures = capturePlanForCombo(combo.id);
    const failedRequests = attachFailedRequestTracker(page, url);

    console.log(`Capturing ${combo.id} → ${url}`);
    try {
      const diagnostics = await captureCombo(
        {
          combo,
          url,
          captures,
          taken: manifestEntries,
          skipped: skippedEntries,
          errors: allErrors,
        },
        page,
      );

      if (failedRequests.length) {
        allErrors.push(...failedRequests.map((f) => `${combo.id}: request ${f.status} ${f.url}`));
      }

      comboResults.push({ combo: combo.id, url, diagnostics });
      rendererInfo = await readRendererInfo(page);
      quality = await readQualityLabel(page);
    } catch (err) {
      const detail = `${combo.id}: ${String(err?.message || err)}`;
      allErrors.push(detail);
      console.error(detail);
    }
  }

  allErrors.push(...pageErrors, ...consoleErrors);
} finally {
  await browser.close();
}

const manifest = comboFilter.length
  ? {
      generatedAt: new Date().toISOString(),
      filtered: comboFilter,
      files: manifestEntries,
      skipped: skippedEntries,
      errors: allErrors,
      ok:
        allErrors.length === 0 &&
        manifestEntries.length === plannedFiles.length &&
        manifestEntries.every((e) => e.ok || e.skipReason),
    }
  : writeMatrixArtifacts({
      manifestEntries,
      skippedEntries,
      allErrors,
      comboResults,
      rendererInfo,
      quality,
    });

if (comboFilter.length) {
  writeFileSync(
    join(artifactsRoot, 'matrix-manifest-partial.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

console.log(JSON.stringify(manifest, null, 2));

if (!manifest.ok) {
  process.exitCode = allErrors.length ? 2 : 1;
}
