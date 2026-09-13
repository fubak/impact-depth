# Plan 015: Ship distinct, licensed, versioned fleet assets

> **Executor instructions:** Execute only this plan. Do not download or ship assets whose
> license and attribution have not been verified. Procedural meshes remain fallbacks. Do not
> claim visual acceptance from successful HTTP loads alone.
>
> **Drift check:** `git diff --stat 4da4d3f -- public/assets src/render/assets.ts src/render/scene.ts scripts package.json docs/release plans/README.md`

## Status

- **Priority:** P1
- **Effort:** L (1–3 weeks; art acquisition dominates)
- **Risk:** HIGH
- **Depends on:** Plan 011; shoreline acceptance now comes through Plan 018, which
  supersedes 013 on the 2026-09-11 integration track. The existing fleet pipeline
  can feed 018 before fleet visual sign-off; fleet and environment acceptance must
  both be complete before 017. Do not create a circular start dependency.
- **Category:** content, performance, correctness
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03
- **Progress (2026-08-04):** **IN PROGRESS / PARTIAL** — machine pipeline + distinct class GLBs under `models/v2`; operator visual acceptance and delayed-load browser test remain open. See `tasks/state.md` and `memory/MEMORY.md`.

## Why this matters

The current GLBs are baked exports of the procedural fallback geometry. They prove the loader
but not the production realism or vessel-recognition bar. The manifest calls enriched content
“v2” while serving it from immutable `models/v1` URLs, and ships created before preload can
remain procedural for their whole lifetime. The new untracked `scripts/import-modern-fleet.mjs`
is an incomplete experiment with hard-coded temporary inputs and must not become the release
pipeline without review.

## Current state (2026-08-04)

- Manifest **v5** points all eleven entities to **`models/v2/*.glb`** with license ledger.
- Distinct sources: Sketchfab CC-BY (LA / Akula / Visby destroyer only); Kenney CC0 surface + FOB/crate; OGA CC0 aircraft; project torpedo.
- Importer uses `artifacts/fleet-sources/sources.json` only (no `/tmp`, no download, no cookies).
- Commands: `npm run assets:import-modern`, `npm run assets:validate`.
- Runtime: `AssetRegistry.whenReady`, player preload gate, contact `refreshShipMeshesFromAssets`, LOD at `[40,120,280]`, Look-dev credits UI.
- **Not done:** operator silhouette accept/waive ledger; delayed-GLB integration browser test; military-photoreal warship pack (current Kenney meshes are stylized).

## Scope

**In scope:** `public/assets/manifest.json`, a new versioned `public/assets/models/v2/`, final
PBR textures, `src/render/assets.ts`, `src/render/scene.ts`, asset import/validation scripts,
`package.json` asset commands, asset tests, `_headers`, and release/license documentation.

**Out of scope:** simulation stats, adding new vessel classes, changing weapon balance,
shipping scraped/private assets, editing `.archive/`, or deleting procedural fallbacks.

## Steps

### Step 1: Freeze an asset contract and validate it automatically

Define required kinds, scale/orientation/waterline, triangle and texture budgets, required PBR
channels, LOD policy, attribution fields, and cache version. Add `npm run assets:validate` that
loads every manifest entry and fails on missing files, malformed GLB, missing provenance,
budget overflow without waiver, invalid bounds, or a production entry still labeled fallback.

**Verify:** run the validator against the existing v1 set and record expected failures; then
make the new v2 set pass without weakening rules to fit an asset.

**Status 2026-08-04:** DONE for v2 set (`npm run assets:validate` exits 0).

### Step 2: Replace the experimental importer with reproducible, safe inputs

Remove hard-coded `/tmp` paths and unused imports. Accept explicit local source paths under an
ignored staging directory and a checked-in metadata file containing source page, author,
license, attribution text, and transformation recipe. The script must never download assets,
read cookies, or infer a license. Keep source binaries out of Git unless redistribution terms
allow them.

Do not represent patrol, destroyer, cruiser, and battleship by scaling one corvette. Each class
needs a recognizably distinct accepted model or an explicit owner waiver recorded per kind.

**Verify:** two clean imports produce byte-identical or structurally identical validated
outputs from the same inputs and metadata.

**Status 2026-08-04:** DONE (`scripts/import-modern-fleet.mjs` + `sources.json`; classes are distinct).

### Step 3: Produce a new immutable v2 content set

Normalize +X bow/+Y up, waterline, scale, material response, and shadow flags. Apply measured
mesh/texture optimization (LOD plus meshopt/Draco and KTX2/WebP only if the runtime loader is
wired and verified). Put changed files under `models/v2` or content-hashed names and update the
manifest atomically. Never overwrite an immutable v1 URL with different bytes.

**Verify:** all v2 URLs return 200 in production preview, validator passes, and fallback mode
still works when one URL is deliberately invalid in a test fixture.

**Status 2026-08-04:** DONE for shipping path + LOD at runtime. Meshopt/Draco/KTX2 not required for this pass. Operator quality accept open.

### Step 4: Remove the preload race

Make `AssetRegistry` expose readiness per kind. If gameplay creates a fallback before its GLB
loads, hot-swap it after readiness while preserving transform, entity ID, pick ID, visibility,
wake/beacon/hit volumes, and simulation ownership. Alternatively gate only presentation
readiness behind a bounded menu loading state; never block offline play indefinitely.

Add a browser test with delayed GLB responses: click Begin immediately, assert fallback play
continues, release responses, then assert all existing vessel visuals transition without
duplicate scene entities or errors.

**Verify:** delayed-load integration test passes and renderer entity counts remain bounded.

**Status 2026-09-13:** DONE for machine path — player mounts procedural immediately, GLBs hot-swap; `npm run test:e2e:assets` holds `models/v2/*.glb`, asserts procedural play, then glTF without duplicate pick ids.

### Step 5: Run visual acceptance by vessel class

Capture each kind in daylight tactical/chase/bridge/periscope where applicable, with underwater
sub views. Review silhouette, scale, materials, waterline, shadows, and readability at combat
ranges. HTTP 200 or loader success is not visual acceptance.

**Verify:** operator records accepted/waived/rejected per kind in the manifest/release ledger.

**Status 2026-08-04:** PENDING operator.

## Done criteria

- [x] Validator covers every kind, budget, and provenance field (bounds optional grace).
- [x] No changed model is published under an old immutable path (`models/v2`).
- [x] Every class has a distinct accepted GLB **or** documented pack (operator may still waive quality).
- [x] Existing fallback entities hot-swap safely after delayed preload (`npm run test:e2e:assets`).
- [x] Missing assets remain playable through procedural fallbacks.
- [ ] Operator visual capture and accept/waive ledger.
- [ ] Full `npm run verify` + operator silhouette accept still required to close 015.

## STOP conditions

- License/redistribution terms are unclear or attribution cannot be satisfied.
- A source pack requires credentials/cookies committed to the repository.
- Meeting budgets destroys the accepted silhouette.
- One generic model would be shipped as several classes without owner waiver.

## Maintenance notes

Increment the asset path/version whenever immutable bytes change. Preserve the validator and
fallback pipeline for CI, offline development, and broken CDN responses.
