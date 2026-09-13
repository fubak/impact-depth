# Plan 018 finish gaps — machine close + browser visual proof

Date: 2026-09-12  
Status: **MACHINE COMPLETE — operator STOP** (O1–O3 PENDING; defaults unchanged)  
Parent: [018-realism-upgrade-execution.md](018-realism-upgrade-execution.md)  
Authority: [AGENTS.md](../AGENTS.md) — one plan per session; do **not** self-approve operator GPU/lighting/fleet/production gates; do **not** flip defaults until the operator records ACCEPT.

## 0. Outcome

Close every **machine-completable** remaining gap from the 2026-09-12 audit so Plan 018’s candidate is visually proven in a real browser (headed Chromium against `vite preview`), with artifacts under `artifacts/plan-018-finish/`. Leave only true operator gates for human sign-off, then (only after ACCEPT) activate spectral + littoral-v2 defaults in a tiny follow-up change.

### In scope (agents must finish)

| ID | Gap | Done when |
| --- | --- | --- |
| G1 | Spectral foam cellular/honeycomb | Foam reads irregular breakers/wakes in spectral captures; unit + browser e2e still green |
| G2 | Optics / caustics visual thinness | Reflection/refraction and caustics visible on real receivers in POV captures; no RT/WebGL errors |
| G3 | Incomplete browser matrix | All four backend×world combos captured; day/dusk/night × calm/storm subset; seven POVs; lifecycle subset |
| G4 | Phase H 20× resource cycles | Harness proves ≤N owned resources after 20 mission/backend and 20 resize/quality cycles |
| G5 | FPS bench plan defaults | `FPS_WARMUP_MS`/`FPS_BENCH_MS` defaults match plan intent when unset; `PERF_AUTHORITATIVE` rejects software |
| G6 | Vegetation / terrain look-dev polish | Non-tube fronds or clearly improved silhouettes; wet-sand band; pause freezes wind; no HDR dependency |
| G7 | Docs honesty | §11 caveats cleared or accurately narrowed; `tasks/state.md`, review, matrix report match evidence |
| G8 | Full machine gates | `npm ci && npm run verify`, `format:check`, `assets:validate`, `assets:validate:ocean`, build, smoke, e2e, e2e:ocean, visual matrix |

### Out of scope / STOP (operator only)

| ID | Gate | Agent duty |
| --- | --- | --- |
| O1 | Hardware GPU ≥55 (`PERF_AUTHORITATIVE=1`, headed, discrete GPU) | Run probe if hardware available; **never** mark PASS yourself |
| O2 | Lighting / fleet visual ACCEPT | Prepare capture pack + checklist; wait for operator |
| O3 | Default flip to `spectral` + `littoral-v2` | Only after O1+O2 ACCEPT text in review doc |
| O4 | Plan 017 soak / production tag / deploy | Do not start |

### Non-goals

- No React/auth/multiplayer.
- No CDN/runtime network assets; no CSP loosening.
- No balance/island redesign.
- No committing secrets; no force-push; commit only if the operator asks in the execution session.
- Preserve Gerstner fallback and legacy replay forever.

---

## 1. Starting inventory (verify before coding)

Working tree may already contain post-merge hitch/bed/foam soften fixes on `master`. Before Wave 1:

1. `git status -sb` and list dirty paths.
2. Confirm preview strategy: `npm run build && npx vite preview --host 127.0.0.1 --port 8082`.
3. Baseline hitch sample (spectral+littoral+high, 12 s moving) → save JSON under `artifacts/plan-018-finish/baseline-hitch.json`.
4. Re-read `docs/release/realism-upgrade-review.md` and this file.

If hitch regresses (>100 ms frames), fix coastal snap/async **before** foam cosmetics.

---

## 2. Parallel agent map

Use Task subagents. Prefer **composer-2.5-fast** (or inherit if unavailable) for narrow files; keep the lead agent on integration, browser proof, and merge conflict ownership of `scene.ts` / `ocean.ts` / `app.ts`.

| Wave | Agent | Model | Owns (exclusive) | Must not touch |
| --- | --- | --- | --- | --- |
| W1-A | Foam polish | lesser | `src/render/ocean/foam.ts`, foam uniforms in `spectrum.ts` / `spectral-backend.ts`, foam tests | `scene.ts`, `optics.ts` |
| W1-B | Resource cycle harness | lesser | `scripts/resource-cycle.mjs` (new) or `tests/render/resource-cycles.test.ts`, thin hooks already exported | ocean shaders |
| W1-C | FPS bench defaults | lesser | `scripts/fps-bench.mjs` only | gameplay |
| W1-D | Matrix capture expander | lesser | `scripts/visual-golden.mjs` / new `scripts/visual-matrix.mjs`, artifact layout docs | render internals |
| W1-E | Vegetation silhouette | lesser | `src/render/environment/vegetation.ts` (+ focused tests) | bed authority, ocean |
| W2-A | Optics visual pass | medium | `src/render/ocean/optics.ts`, bind path in `ocean.ts` if required | coastal solver |
| W2-B | Caustics / surface effects | medium | `caustics.ts`, `surface-effects.ts`, receiver hooks in seabed/hull materials | world sim |
| W3 | Lead integrator | same session lead | `scene.ts` wiring, conflict merge, full browser matrix, visual inspection, docs | — |
| W4 | Operator package | lead | review checklist, capture index; **STOP** for ACCEPT | defaults until ACCEPT |

### Parallelism rules

- Launch W1-A…E in one message (parallel).
- Wait for all W1 before W2.
- Launch W2-A and W2-B in parallel after W1 merge/rebase into the lead tree.
- W3 is serial: build → preview → matrix → **read every PNG** with the image tool → fix regressions → re-capture.
- Never two agents edit `scene.ts` concurrently.

---

## 3. Wave details

### Wave 1-A — Foam (G1)

**Problem:** Cascade foam history still reads cellular/honeycomb on spectral water.

**Work:**

1. Audit foam derive + history ping-pong + storm/shore attenuation uniforms.
2. Soften breaking threshold / decay / history advection so foam follows crests and wakes irregularly.
3. Ensure pause freezes foam evolution; restart clears histories (existing contract).
4. Unit: foam pause/reset if missing; keep spectral e2e green.

**Browser proof:**

- Capture `caribbean-noon-tactical` + `bridge-convoy` before/after at same seed/pose.
- Lead inspects PNGs: fail if regular honeycomb grid dominates mid-ocean.

**Exit:** Foam defect downgraded to low or closed in review with image evidence.

### Wave 1-B — Resource cycles (G4)

**Problem:** Plan requires ≥20 mission/backend and ≥20 resize/quality cycles with bounded owned resources; only unit dispose tests exist.

**Work:**

1. Add a Playwright (or Vitest+mock where GL unavailable) cycle harness that:
   - Starts preview URL, begins patrol.
   - Alternates `?ocean=gerstner|spectral` and `?world=legacy-v1|littoral-v2` via reload or in-app restart if exposed.
   - Resizes viewport and cycles `quality=high|medium|low` twenty times each class.
   - Reads diagnostics (`renderer.info` textures/geometries/programs + any app-owned counters) after warmup and after cycles.
2. Assert counts settle within documented slack (allow known Three.js cache residuals; explain in report).
3. Save `artifacts/plan-018-finish/resource-cycles.json`.

**Exit:** Harness exits 0; report shows no unbounded growth.

### Wave 1-C — FPS bench (G5)

**Work:**

1. When env unset, use warmup ≥30000 ms and sample ≥60000 ms **only if** `PERF_AUTHORITATIVE=1`; keep short defaults for casual `test:fps` so CI stays cheap.
2. Document exact env matrix in script header and `matrix-report`.
3. Authoritative mode already rejects software — verify and add a unit/script self-check if missing.

**Exit:** Script comments + behavior match Plan 018 §7; casual runs still fast.

### Wave 1-D — Matrix expander (G3 tooling)

**Work:**

1. Script accepts a matrix mode that captures **all four** backend×world pairs into:
   - `artifacts/plan-018-finish/{gerstner-legacy,gerstner-littoral,spectral-legacy,spectral-littoral}/`
2. For each combo, capture the seven POVs (or scripted six + free if free is flaky — document).
3. Condition subset (minimum):
   - day calm, day storm, dusk calm, night calm (via existing weather/time hooks or URL/debug if present; else seed fixed times through public API / look-dev keys — prefer existing controls).
4. Write `artifacts/plan-018-finish/matrix-report.md` with commands, URLs, pass/fail, and “not operator PASS”.

**Exit:** One command produces the four directories + report skeleton.

### Wave 1-E — Vegetation (G6)

**Work:**

1. Improve palm/frond/ground-cover geometry so silhouettes are not tube trees (tapered fronds, varied canopy).
2. Keep seeded placement, density LOD, wind sway, pause freeze, shadow-consistent deformation.
3. Wet-sand band already partially present — verify against littoral bed; no land over navigable water.
4. Focused geometry/wind unit tests.

**Browser proof:** Tactical + shore-map spectral captures show improved foliage; lead image-inspects.

**Exit:** Review notes “look-dev foliage improved”; still no HDR claim.

### Wave 2-A — Optics (G2)

**Work:**

1. Verify reflection includes sky/land/fleet; refraction includes bed/hulls; membership excludes HUD/rings/labels.
2. Fix any empty/inverted reflection, border smear, or failed restore (`finally` hygiene).
3. Ensure map (ortho) and periscope crossing do not break depth encoding.
4. Add/extend tests for restore-after-throw and membership.

**Browser proof:** Side-by-side Gerstner vs spectral bridge + periscope captures show non-black reflections and underwater bed detail; no console WebGL errors during e2e:ocean.

### Wave 2-B — Caustics / surface effects (G2)

**Work:**

1. Ensure caustics project on seabed and submerged hulls with sun/wave coupling; attenuate at night/depth.
2. Spray/bubbles/impacts bounded; no permanent wakes from submerged subs; pause/reset safe.
3. Capture underwater-chase + combat splash if e2e can fire once.

**Browser proof:** Underwater chase PNG shows moving light pattern on bed/hull (visible, not necessarily photoreal).

### Wave 3 — Lead integration + full browser visual verification

**Sequence (mandatory):**

1. Merge all worker diffs; resolve conflicts; `npm run typecheck` + `npm test`.
2. `npm run build` → preview on `127.0.0.1:8082`.
3. Run:
   - `npm run test:smoke -- http://127.0.0.1:8082/`
   - `npm run test:e2e -- http://127.0.0.1:8082/`
   - `npm run test:e2e:ocean -- http://127.0.0.1:8082/`
   - matrix script for all four combos
4. Hitch sample spectral+littoral+high ≥12 s moving → `hitch-final.json` (0 frames >100 ms target).
5. **Visual verification (required):** Open every new PNG with the image Read tool. For each, record a one-line pass/fail in `matrix-report.md` (content present: water, island, fleet/HUD as expected; no blank RT; foam not honeycomb-dominant; optics not empty black slab).
6. If any visual fail → fix → re-capture **that** combo only → re-inspect.
7. `npm run verify`, `format:check`, `assets:validate`, `assets:validate:ocean`.
8. Update:
   - `docs/release/realism-upgrade-review.md` (candidate = commit or dirty inventory)
   - `tasks/state.md`, `memory/MEMORY.md`
   - Plan 018 §11: clear machine caveats; leave O1–O3 unchecked
   - `plans/README.md` row for 018

### Wave 4 — Operator package + defaults STOP

1. Produce `docs/release/plan-018-operator-accept.md` with:
   - How to run headed `PERF_AUTHORITATIVE=1` bench
   - Checklist: lighting day/dusk/night, fleet waterline calm/storm, foam OK, ≥55 p95
   - Explicit lines: `GPU: PENDING|ACCEPT`, `LIGHTING: PENDING|ACCEPT`, `FLEET: PENDING|ACCEPT`
2. **STOP.** Do not change `parseRuntimeSelection` defaults until all three ACCEPT.
3. After operator ACCEPT (same or later session): one-line default change + rollback note + re-run smoke/e2e/matrix on bare URL; document rollback (`?ocean=gerstner&world=legacy-v1`).

---

## 4. Browser visual acceptance rubric (agent-side)

Agents may mark **machine visual PASS** only when all hold:

| Check | Fail if |
| --- | --- |
| Canvas populated | Solid black/cleared RT, missing ocean or island in tactical |
| Spectral foam | Regular honeycomb tiles dominate open water |
| Optics | Mirror band empty/inverted; UI chrome reflected; persistent hidden meshes |
| Caustics | Flat unlit bed with zero projected variation underwater at noon |
| Hitch | Any frame >100 ms in post-warmup 12 s cruise sample |
| Foliage | Unchanged tube-only trees with no canopy variation (vs pre-W1-E baseline) |
| Errors | Uncaught pageerror, shader compile error, unexpected 404 for local assets |

Agents must **not** convert machine visual PASS into operator ACCEPT.

---

## 5. Evidence layout

```
artifacts/plan-018-finish/
  baseline-hitch.json
  hitch-final.json
  resource-cycles.json
  matrix-report.md
  gerstner-legacy/*.png
  gerstner-littoral/*.png
  spectral-legacy/*.png
  spectral-littoral/*.png
  before-after/foam-*.png          # optional A/B
  before-after/foliage-*.png
```

Do not commit huge binary dumps unless the operator asks; keep reports and a curated subset if repo policy prefers.

---

## 6. Commands (exact)

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
npm run assets:validate
npm run assets:validate:ocean
npm run build
npx vite preview --host 127.0.0.1 --port 8082
```

Separate terminal:

```sh
npm run test:smoke -- http://127.0.0.1:8082/
npm run test:e2e -- http://127.0.0.1:8082/
npm run test:e2e:ocean -- http://127.0.0.1:8082/
# matrix (after W1-D lands — adjust script name to match implementation)
node scripts/visual-matrix.mjs http://127.0.0.1:8082/
```

Optional directional FPS (not operator PASS):

```sh
npm run test:fps -- "http://127.0.0.1:8082/?ocean=spectral&world=littoral-v2&quality=high"
```

Operator-only authoritative (human GPU machine):

```sh
# PowerShell
$env:PERF_AUTHORITATIVE=1; $env:PERF_HEADED=1; $env:PERF_QUALITY="high"
npm run test:fps -- "http://127.0.0.1:8082/?ocean=spectral&world=littoral-v2&quality=high"
```

---

## 7. Completion checklist

- [x] W1-A foam machine visual PASS (images inspected)
- [x] W1-B resource-cycles.json green
- [x] W1-C fps-bench authoritative/casual split documented + verified
- [x] W1-D four-combo matrix tooling works
- [x] W1-E foliage improved (images inspected)
- [x] W2-A optics machine visual PASS
- [x] W2-B caustics/effects machine visual PASS — map follow-square closed via altitude fade; chase still peri-depth so bed pattern is not a hero receiver shot (operator lighting)
- [x] W3 hitch-final: 0 frames >100 ms
- [x] W3 full matrix PNGs inspected line-by-line in report
- [x] W3 `verify` + asset validators green; `format:check` PASS
- [x] Docs/state/README/§11 updated honestly
- [x] Operator accept doc ready with PENDING markers
- [x] Defaults unchanged until operator ACCEPT (then tiny activation + bare-URL regression)

Writing this plan completes none of these checkboxes.

**Honesty notes (2026-09-13):** W1-A honeycomb closed on spectral tactical/storm after Tessendorf lambda cut. Spectral **map** follow-square was projected detail caustics, not FFT foam; closed by fading receivers above ~70–120 m camera height. `format:check` PASS. Operator GPU ≥55 / lighting / fleet **not** self-approved. Defaults unchanged.

---

## 8. Stop and recovery

Stop dependent waves on: blank spectral canvas, RT feedback loop, coastal hitch return, legacy replay drift, unrecoverable WebGL context issues, or unbounded GPU resource growth.

Preserve dirty user work; do not reset hard, force-push, or tag production. Escalate model tier only after a lesser agent fails with a clear reasoning gap.
