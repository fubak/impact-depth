# Plan 019 — Demo-look water first

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not commit unless the operator asks** (user git rule overrides writing-plans commit steps).

**Goal:** A fresh boot of Silent Depths reads as the same Caribbean spectral water + photographed sky as [iamtechartist/ocean-simulation](https://github.com/iamtechartist/ocean-simulation) @ `3f756c128f7775f76e9fc7e93ad2f4e825df4354`, judged on **bridge (waterline)** and **tactical island shallows**, without copying the demo island or loosening CSP.

**Architecture:** Keep the existing spectral FFT pipeline. Stage Poly Haven Kloofendal 1k HDR **locally**. `OutdoorLighting` tries `PMREMGenerator.fromEquirectangular` and fail-closes to today's procedural sky PMREM. Atmosphere still writes a horizon `Color` into `scene.background` every `sync`; OutdoorLighting restores the HDR background **after** that call. Ocean already planar-reflects the scene (`uReflection`); IBL + photographed background is the primary look lever. World stays `legacy-v1`. Honeycomb is a fail.

**Tech Stack:** Vite, Three.js `0.185.0`, `RGBELoader` from `three/examples/jsm/loaders/RGBELoader.js` (same import style as `GLTFLoader` in `src/render/assets.ts`), Playwright capture scripts already in `scripts/`.

## Global Constraints

- One canvas, one rAF. CPU sim remains gameplay authority (`src/game/sim/**`).
- World default remains `legacy-v1`. Do not flip `?world=` default.
- Spectral becomes the **empty-URL** ocean default. `?ocean=gerstner` is the rollback. Unknown `ocean=` still falls back to Gerstner.
- No `esm.sh`, no Poly Haven at runtime, no `connect-src` / CSP whitelist for CDNs.
- Missing/corrupt HDR → procedural PMREM, boot continues. Spectral GPU fail → Gerstner (existing contract).
- Honeycomb in storm or noon tactical is a **fail**. Do not raise `SPECTRUM_PACK_GLSL` chop above the 018 value `min(0.72, pow(uGain, .75)) * 0.40`.
- Do not copy the 1100 m demo island, OrbitControls shell, or demo weather GUI.
- Do not start Plans 012 / 014 / 015 / 017 / 020 in this session.
- Do not self-approve GPU ≥55, soak, lighting ACCEPT, or fleet ACCEPT.
- Commit only if the operator asks.

### Approved product decisions (brainstorming 2026-09-13)

- **C — water-first, then art.** Milestone 1 = water + lighting only. Keep patrol islands, seven POVs, HUD.
- **HDR A:** Stage the same Poly Haven *Kloofendal 48d Partly Cloudy Pure Sky* **1k** HDR (CC0) under `public/assets/environment/v1/` with license/hash. Staging is a one-shot script.
- **Accept views:** bridge waterline + tactical island shallows vs demo Waterline/Shallows at Caribbean noon.
- Approach 1: retune existing spectral pipeline. Do not iframe the demo. Do not transplant the whole fragment unless recapture still looks “our teal.”

### Out of scope (Plan 020)

Island restyle, instanced rocks, leaflet palms. Write 020 only if water-first is still not close.

---

## File map (locked ownership)

| File | Responsibility this plan |
| --- | --- |
| `src/core/runtime-selection.ts` | Empty `ocean` param → `spectral` |
| `tests/game/runtime-selection.test.ts` | Default + unknown-fallback cases |
| `scripts/stage-kloofendal-hdr.mjs` | One-shot local stage; never imported by the game |
| `public/assets/environment/v1/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | Bytes |
| `public/assets/environment/v1/manifest.json` | License, SHA-256, provenance URL |
| `scripts/validate-ocean-assets.mjs` | Missing/corrupt pack is **fail** (exit 1) |
| `package.json` | `assets:stage:kloofendal` script |
| `src/render/environment/sky-source.ts` | Pure `pickSkyLightingSource` (testable, no WebGL) |
| `src/render/environment/sky-lighting.ts` | Diagnostics union; HDR PMREM bind/dispose |
| `src/render/environment/outdoor-lighting.ts` | Async HDR load; restore background after atmosphere |
| `src/render/atmosphere.ts` | Optional: skip writing `scene.background` when HDR owns it (only if OutdoorLighting cannot win the race) |
| `src/render/ocean.ts` | **Lead only.** Uniform/mix retune. No two writers. |
| `src/render/scene.ts` | **Lead only if bind/recover must change.** Prefer not touching it. |
| `scripts/look-019.mjs` | Headed-or-headless two-shot capture into `artifacts/plan-019/` |
| `docs/release/ocean-integration.md` | HDR no longer “skipped”; spectral is default |
| `tests/render/sky-lighting.test.ts` | Source picker + signature tests |

**Never two writers on:** `scene.ts`, `ocean.ts`, `app.ts`.

---

## Model / effort policy

| Tier | Model slug | Use for |
| --- | --- | --- |
| lesser | `composer-2.5-fast` | Scripts, validators, unit tests, manifests, docs-only, `sky-source.ts` |
| lesser-fast | `cursor-grok-4.6-high-fast` | Same as lesser if composer is unavailable |
| lead | inherit | IBL bind, ocean look, preview, PNG inspect |

Do **not** give lesser agents `scene.ts` or `ocean.ts`.

### Parallelism

```
W1-A (lesser) ─┐
               ├─► W2 (lead IBL) ─► W3 (lead ocean) ─► W4 (lead proof/docs)
W1-B (lesser) ─┘
W1-C (lesser) runs after W2 exports `pickSkyLightingSource` OR ships in the same W2 PR as tests written first.
```

- Launch **Task 1 and Task 2 in one message** (no file overlap).
- Task 3 waits until Task 2's pack exists on disk **or** can proceed against the fail-closed path if staging is blocked; do not merge IBL expecting a missing file.
- Task 4 starts only after Task 3 boots without WebGL errors on `:8082`.
- Task 5 is serial after Task 4: capture → **read both PNGs** → honeycomb/milky/empty-sky fail → fix → recapture.

---

## Task 1 — Spectral empty-URL default

**Model:** lesser (`composer-2.5-fast`)  
**Files:**
- Modify: `src/core/runtime-selection.ts` (default `ocean` at the `let ocean` line)
- Test: `tests/game/runtime-selection.test.ts`
- Do not touch: `src/render/**`, validators, docs (`ocean-integration.md` is Task 5)

**Interfaces:**
- Consumes: `OceanBackendName = 'gerstner' | 'spectral'`
- Produces: `parseRuntimeSelection('')` and `parseRuntimeSelection('?world=legacy-v1')` return `ocean: 'spectral'`. Unknown `ocean=fft` still returns `gerstner` with a diagnostic.

- [ ] **Step 1: Write the failing test**

In `tests/game/runtime-selection.test.ts` replace the empty-string case:

```ts
it('defaults to spectral, legacy-v1, high with no params', () => {
  expect(parseRuntimeSelection('')).toEqual({
    ocean: 'spectral',
    world: 'legacy-v1',
    quality: 'high',
    qualityForced: false,
    diagnostics: [],
  });
});

it('keeps spectral when ocean param is omitted but other params exist', () => {
  expect(parseRuntimeSelection('?world=legacy-v1&quality=high').ocean).toBe('spectral');
  expect(parseRuntimeSelection('?world=legacy-v1&quality=high').qualityForced).toBe(true);
});

it('selects gerstner only when asked', () => {
  expect(parseRuntimeSelection('?ocean=gerstner').ocean).toBe('gerstner');
});
```

Keep the existing unknown-value test (`ocean=fft` → gerstner + diagnostic). After this task lands, a bare-URL smoke becomes a spectral boot — Task 5 still owns full e2e, but the lead should run `npm test -- tests/game/runtime-selection.test.ts` before merging this wave. Do not start a headed spectral smoke from the lesser agent (no `scene.ts`).

- [ ] **Step 2: Run it to see red**

```sh
npm test -- tests/game/runtime-selection.test.ts
```

Expected: FAIL — received `gerstner`, expected `spectral`.

- [ ] **Step 3: Minimal implementation**

In `src/core/runtime-selection.ts` default to spectral, but **unknown `ocean=` must still force Gerstner** (do not leave the new default):

```ts
let ocean: OceanBackendName = 'spectral';
if (oceanRaw) {
  if (OCEANS.has(oceanRaw as OceanBackendName)) ocean = oceanRaw as OceanBackendName;
  else {
    ocean = 'gerstner';
    diagnostics.push(`unknown ocean=${oceanRaw}; using gerstner`);
  }
}
```

- [ ] **Step 4: Run tests green**

```sh
npm test -- tests/game/runtime-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Grep leftover default claims in tests only**

```sh
rg -n "defaults to gerstner|ocean: 'gerstner'" tests src/core
```

Fix test strings this task owns. Leave `docs/release/ocean-integration.md` and `memory/MEMORY.md` for Task 5. Leave `tests/render/caustics.test.ts` wording unless it asserts URL default.

---

## Task 2 — Local Kloofendal pack + fail-closed validator

**Model:** lesser (`composer-2.5-fast`)  
**Files:**
- Create: `scripts/stage-kloofendal-hdr.mjs`
- Modify: `scripts/validate-ocean-assets.mjs`, `package.json`
- Create (via script): `public/assets/environment/v1/kloofendal_48d_partly_cloudy_puresky_1k.hdr`, `public/assets/environment/v1/manifest.json`
- Do not touch: `src/**`

**Interfaces:**
- Consumes: either `HDR_SOURCE` (absolute/relative path to an already-downloaded `.hdr`) or `ALLOW_HDR_STAGE=1` to fetch once.
- Produces: pack on disk; `npm run assets:validate:ocean` prints `{ "ok": true, "pack": "environment/v1" }` and exits 0. Missing pack → `{ "ok": false }` exit 1.
- Canonical URL (stage only): `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr`
- Provenance page: `https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky`
- License: `CC0-1.0`

- [ ] **Step 1: Stage script**

`scripts/stage-kloofendal-hdr.mjs`:

```js
#!/usr/bin/env node
/**
 * One-shot local stage of Poly Haven Kloofendal 1k HDR (CC0).
 * Never imported by the game. Never called from app.ts.
 *
 *   HDR_SOURCE=./kloofendal.hdr npm run assets:stage:kloofendal
 *   ALLOW_HDR_STAGE=1 npm run assets:stage:kloofendal
 *
 * PowerShell:
 *   $env:ALLOW_HDR_STAGE='1'; npm run assets:stage:kloofendal
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr';
const FILE = 'kloofendal_48d_partly_cloudy_puresky_1k.hdr';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = resolve(root, 'public/assets/environment/v1');

const sourcePath = process.env.HDR_SOURCE;
const allowFetch = process.env.ALLOW_HDR_STAGE === '1';

if (!sourcePath && !allowFetch) {
  console.error('Set HDR_SOURCE to a local .hdr or ALLOW_HDR_STAGE=1 to fetch once.');
  process.exit(1);
}

mkdirSync(packDir, { recursive: true });
const dest = resolve(packDir, FILE);

let bytes;
if (sourcePath) {
  const abs = resolve(sourcePath);
  if (!existsSync(abs)) {
    console.error(`HDR_SOURCE not found: ${abs}`);
    process.exit(1);
  }
  bytes = readFileSync(abs);
} else {
  const res = await fetch(HDR_URL);
  if (!res.ok) {
    console.error(`fetch failed ${res.status} ${HDR_URL}`);
    process.exit(1);
  }
  bytes = Buffer.from(await res.arrayBuffer());
}

if (bytes.length < 10_000) {
  console.error(`HDR too small (${bytes.length} bytes) — refusing to write`);
  process.exit(1);
}

writeFileSync(dest, bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  files: {
    [FILE]: {
      license: 'CC0-1.0',
      sha256,
      provenance: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
      source: HDR_URL,
    },
  },
};
writeFileSync(resolve(packDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, file: FILE, bytes: bytes.length, sha256 }, null, 2));
```

- [ ] **Step 2: package.json**

Add next to `assets:validate:ocean`:

```json
"assets:stage:kloofendal": "node scripts/stage-kloofendal-hdr.mjs"
```

- [ ] **Step 3: Validator fail-closed**

Replace `noPack()` so it **fails**:

```js
function noPack(reason) {
  console.log(JSON.stringify({ ok: false, pack: 'none', errors: [reason] }, null, 2));
  process.exit(1);
}
```

Also fail when `manifest.json` is missing while files exist, and when `files` is empty. Keep hash/license checks. Update the file header comment: missing pack is no longer a pass.

Required file name must match `FILE` above. If other extensions appear, still allow them **in addition** to the required HDR (do not delete the allowed-ext set).

- [ ] **Step 4: Stage then validate**

```sh
npm run assets:stage:kloofendal
# expect exit 1 and the Set HDR_SOURCE message

# then either:
#   HDR_SOURCE=<path> npm run assets:stage:kloofendal
# or:
#   ALLOW_HDR_STAGE=1 npm run assets:stage:kloofendal

npm run assets:validate:ocean
```

Expected: `{ "ok": true, "pack": "environment/v1" }`, exit 0. Confirm `.gitignore` does **not** ignore `public/assets/environment/`. The HDR + `manifest.json` must be **committed with the 019 implementation** so fresh clones and `assets:validate:ocean` do not depend on a local stage step. (Do not commit in the spec session unless the operator asks.)

- [ ] **Step 5: Confirm no runtime fetch**

```sh
rg -n "polyhaven|esm.sh|kloofendal" src
```

Expected: no matches in `src/`. Staging URL lives only in the script + manifest provenance.

---

## Task 3 — HDR IBL + photographed background

**Model:** lead (inherit)  
**Files:**
- Create: `src/render/environment/sky-source.ts`
- Modify: `src/render/environment/sky-lighting.ts`, `src/render/environment/outdoor-lighting.ts`
- Test: `tests/render/sky-lighting.test.ts`
- Touch `src/render/atmosphere.ts` **only if** OutdoorLighting cannot restore `scene.background` after `atmosphere.apply` (today `scene.sync` calls atmosphere then `outdoorLighting.update` — restore there).
- Do not touch: `ocean.ts` yet. Do not make `bindEnvironment` async. Do not hang boot on fetch.

**Interfaces:**
- Consumes: `/assets/environment/v1/kloofendal_48d_partly_cloudy_puresky_1k.hdr` (public URL) + manifest.
- Produces:

```ts
export type SkyLightingSource = 'hdr-pmrem' | 'procedural-sky-pmrem';

export function pickSkyLightingSource(opts: {
  hdrReady: boolean;
  hdrFailed: boolean;
  isNight: boolean;
}): SkyLightingSource {
  if (opts.hdrFailed || !opts.hdrReady) return 'procedural-sky-pmrem';
  // Night keeps procedural PMREM so the noon HDR does not light a night patrol.
  if (opts.isNight) return 'procedural-sky-pmrem';
  return 'hdr-pmrem';
}
```

`SkyLightingDiagnostics.source` becomes that union. `OutdoorLighting.bind` stays **sync**: start `RGBELoader.load`, keep procedural until success, then `pmrem.fromEquirectangular(texture)`, assign `scene.environment`, set `scene.background` to the equirect (or PMREM) for day, dispose previous targets. On loader error, set `hdrFailed` and stay procedural.

**Must not let procedural PMREM clobber HDR.** Today `SkyLighting.update()` always does `this.scene.environment = next.texture` from `pmrem.fromScene`. While `pickSkyLightingSource` is `hdr-pmrem`, skip that assignment (and skip `fromScene`) or immediately re-bind the HDR PMREM after update. Night / failed HDR still use the existing `fromScene` path.

`OutdoorLighting` has no stored `scene` today. Keep a `private scene: THREE.Scene | null` from `bind()` so `update()` can restore `scene.background`.

Night: do not force the noon HDR as a full-bright sky. `pickSkyLightingSource` already returns procedural at night. Underwater: `GameScene.applyImmersion` may still overwrite background after sync — that is intended. When the camera surfaces, next `outdoorLighting.update` restores HDR.

- [ ] **Step 1: Failing unit tests (no WebGL)**

Add to `tests/render/sky-lighting.test.ts`:

```ts
import { pickSkyLightingSource } from '../../src/render/environment/sky-source';

describe('pickSkyLightingSource', () => {
  it('uses hdr when the pack loaded and it is day', () => {
    expect(pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: false })).toBe(
      'hdr-pmrem',
    );
  });

  it('stays procedural when the pack is missing or failed', () => {
    expect(pickSkyLightingSource({ hdrReady: false, hdrFailed: false, isNight: false })).toBe(
      'procedural-sky-pmrem',
    );
    expect(pickSkyLightingSource({ hdrReady: false, hdrFailed: true, isNight: false })).toBe(
      'procedural-sky-pmrem',
    );
  });

  it('does not use the noon HDR at night', () => {
    expect(pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: true })).toBe(
      'procedural-sky-pmrem',
    );
  });
});
```

- [ ] **Step 2: Run red**

```sh
npm test -- tests/render/sky-lighting.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement picker + loader**

1. Add `sky-source.ts` with the function above (no Three import).
2. `sky-lighting.ts`: import `RGBELoader` at **top of file** (no inline imports). Expand `SkyLightingDiagnostics.source`. Keep procedural `fromScene` path. Add `bindHdrEquirect(texture: THREE.Texture)` that:
   - calls `this.pmrem.fromEquirectangular(texture)`
   - assigns `this.scene.environment = next.texture`
   - disposes the previous PMREM target
   - sets diagnostics `source` via `pickSkyLightingSource`
3. `outdoor-lighting.ts`:
   - `HDR_PUBLIC_PATH = '/assets/environment/v1/kloofendal_48d_partly_cloudy_puresky_1k.hdr'`
   - In `bind`, after constructing `SkyLighting`, call `new RGBELoader().load(HDR_PUBLIC_PATH, onOk, undefined, onErr)`
   - `onOk`: `texture.mapping = THREE.EquirectangularReflectionMapping`; store texture; `skyLighting.bindHdrEquirect(texture)`; set `scene.background` to that texture for day
   - `onErr`: set `hdrFailed = true`; leave procedural
   - In `update`, after `skyLighting.update(...)`: if picker says `hdr-pmrem`, assign `scene.background` to the HDR texture (overwriting atmosphere's horizon Color). If procedural, do not fight atmosphere.
   - `dispose`: dispose loader texture + PMREM (existing SkyLighting.dispose already clears environment)

Do not fetch Poly Haven. Loader URL is same-origin public path only.

- [ ] **Step 4: Tests + typecheck**

```sh
npm test -- tests/render/sky-lighting.test.ts tests/render/environment.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Smoke on preview**

```sh
npm run build
npx vite preview --host 127.0.0.1 --port 8082
```

In another terminal: `npm run test:smoke -- http://127.0.0.1:8082/` (bare URL, no `?ocean=`).

Expected: no shader/console errors. If HDR 404s, patrol still plays and diagnostics stay `procedural-sky-pmrem`.

STOP if boot hangs or WebGL context is lost. Do not start Task 4.

---

## Task 4 — Water look retune (lead only)

**Model:** lead (inherit)  
**Files:**
- Modify only if IBL is not enough: `src/render/ocean.ts` (sky/reflection/spec/foam **uniforms and mix weights**, not cascade GLSL)
- Optionally `src/render/ocean/foam.ts` foam visibility scalars — **not** jacobian threshold that reopens honeycomb
- Do not touch: `src/render/ocean/spectrum.ts` chop/lambda unless a recapture proves honeycomb returned (then **revert**, do not raise chop)

**Current water film (do not rip out):**

```603:637:src/render/ocean.ts
  vec3 skyReflect = mix(uSkyColor * 0.85, vec3(0.78, 0.92, 1.0), fresnel);
  water = mix(water, skyReflect, 0.18 + fresnel * 0.55);
  // ... planar uReflection ...
  water += uSunColor * spec * (0.55 + fresnel * 1.05);
```

Planar reflection already sees `scene.background`. After Task 3, bridge glitter should move **before** fragment surgery. Prefer:

1. `GameScene` currently feeds ocean `skyColor` from `atmo.skyTop` (`scene.ts` ~1047), not horizon. If retuning `uSkyColor`, either keep `skyTop`, switch to `skyHorizon`, or have OutdoorLighting publish a once-sampled HDR average — lead chooses the smallest change that matches the demo. If that requires `scene.ts`, lead does it in this task, not a lesser agent.
2. If still “studio teal”: increase the optics reflection mix vs the cheap `skyReflect` film (the `0.18 + fresnel * 0.55` path) by a small step, then recapture.
3. Restore a little foam **amount** (`foamScale` / `uFoamAmount`) if the demo’s broken foam is missing — not jacobian plates.

- [ ] **Step 1: Capture a before-retune pair** (optional but useful) into `artifacts/plan-019/before/` using Task 5’s script if it already exists; otherwise wait for Task 5’s first capture.

- [ ] **Step 2: Headed compare**

Preview `http://127.0.0.1:8082/` (spectral default, `legacy-v1`). Demo reference: Waterline + Shallows at Caribbean noon (`artifacts/ocean-sources/` if present, else the pinned GitHub commit).

- [ ] **Step 3: Minimal uniform changes, then recapture**

If honeycomb appears in storm or noon tactical: revert the last gain/foam change. Do not edit `SPECTRUM_PACK_GLSL` chop.

- [ ] **Step 4: `?ocean=gerstner` still playable**

Load `http://127.0.0.1:8082/?ocean=gerstner` — water must render, no throw.

---

## Task 5 — Proof, docs, status

**Model:** lead for PNG inspection; lesser may draft docs **after** look-report exists, but must not mark PASS.  
**Files:**
- Create: `scripts/look-019.mjs`, `artifacts/plan-019/look-report.md`, PNGs
- Modify: `docs/release/ocean-integration.md`, `plans/README.md`, `tasks/state.md`, `memory/MEMORY.md`

**Interfaces:**
- Reuse `tests/e2e/helpers.mjs` (`beginPatrolAndSkipTutorial`, `setMode`, `assertPlaying`) like `scripts/visual-golden.mjs`.
- Output:
  - `artifacts/plan-019/bridge-waterline.png`
  - `artifacts/plan-019/tactical-shallows.png`
  - `artifacts/plan-019/look-report.md`

- [ ] **Step 1: Capture script**

`scripts/look-019.mjs`: clone the structure of `scripts/visual-golden.mjs` with two captures:

1. `setMode(page, 'bridge')` → `bridge-waterline.png`
2. `setMode(page, 'tactical')` → `tactical-shallows.png`

URL: `http://127.0.0.1:8082/?world=legacy-v1&quality=high` (no `ocean=` — must default spectral). If the tactical frame is open ocean with no island shelf, add a look-dev camera nudge **in the script only** (do not change gameplay cameras) so an island fills the lower third. Document the nudge in the look-report.

Also capture rollback: `?ocean=gerstner&world=legacy-v1` tactical once as `artifacts/plan-019/rollback-gerstner-tactical.png` to prove the URL still works.

- [ ] **Step 2: Run**

```sh
npm ci && npm run verify
npm run assets:validate:ocean
npm run build
# preview on 8082 in another terminal
node scripts/look-019.mjs http://127.0.0.1:8082/
npm run test:smoke -- http://127.0.0.1:8082/
npm run test:e2e -- http://127.0.0.1:8082/
npm run test:e2e:ocean -- http://127.0.0.1:8082/
```

- [ ] **Step 3: Lead inspects PNGs** (not lesser, not self-PASS)

Fail the look-report if:

- Bridge sky is a flat horizon Color / empty black slab
- Tactical shallows are a milky white plate
- Honeycomb plates in noon tactical or a storm recapture
- HDR 404 / `procedural-sky-pmrem` when the pack is on disk (loader path bug)

- [ ] **Step 4: Docs**

`docs/release/ocean-integration.md`:

- Replace “HDR staging skipped” with the local pack path, CC0, validator fail-closed.
- Default ocean is spectral; rollback `?ocean=gerstner`.
- World default still `legacy-v1`.

`plans/README.md`: Plan 019 status IN PROGRESS or DONE.  
`tasks/state.md`: resume pointer; defaults now spectral + legacy-v1.  
`memory/MEMORY.md`: same default sentence.

- [ ] **Step 5: Completion checkboxes** at the bottom of this file.

---

## Failure / fallback (every task)

| Fault | Behavior |
| --- | --- |
| Missing HDR file | Boot, procedural PMREM, validator exit 1 in CI once pack is required |
| Corrupt HDR / loader error | Procedural PMREM, `source: 'procedural-sky-pmrem'` |
| Spectral GPU init fail | Gerstner, `requestedBackend` remains `spectral` |
| Honeycomb | Revert last water gain/chop; fail look-report |
| Unknown `?ocean=` | Gerstner + diagnostic (unchanged) |

---

## Parallel launch recipe (next session)

One message, two lesser subagents:

1. Task 1 — model `composer-2.5-fast` — exclusive: runtime-selection + its test.
2. Task 2 — model `composer-2.5-fast` — exclusive: stage script, validator, package.json, pack files.

Lead then runs Task 3 → 4 → 5. Do not start 020.

---

## Completion checklist

- [x] Task 1 spectral default tests green
- [x] Task 2 pack on disk + validator fail-closed when missing
- [x] Task 3 HDR IBL bound, procedural fallback works, night not blown out
- [x] Task 4 water retune without honeycomb (Caribbean body + nadir alpha; shore foam still hot)
- [x] Task 5 look-report + gates
- [x] `?ocean=gerstner` still playable
- [x] Milestone 2 (art) **not** started in this session
