# Plan 013: Make water, shorelines, and terrain share one heightfield

> **SUPERSEDED BY [Plan 018](018-ocean-world-engine-integration.md), 2026-09-11.**
> Retained as historical reference, not a second execution task. Plan 018 carries
> the shared-heightfield/shoreline acceptance obligations and explicitly replaces
> this document's Gerstner-only scope and collision-terrain STOP condition with a
> versioned shared-world migration. This plan is not marked DONE.

> **Executor instructions:** Execute only this plan. Preserve the Caribbean art direction and
> deterministic CPU terrain. Do not replace Gerstner water with FFT/SPH. Update only this
> plan's row after machine tests and clearly leave human visual acceptance pending.
>
> **Drift check:** `git diff --stat 4da4d3f -- src/core/terrain.ts src/render/ocean.ts src/render/scene.ts tests/render scripts/visual-golden.mjs`

## Status

- **Priority:** P1
- **Effort:** L (4–7 days)
- **Risk:** HIGH
- **Depends on:** Plan 011
- **Category:** bug, rendering, tests
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

The ocean shader currently raises water vertices onto dry land and recomputes an approximate
terrain field with different noise offsets from the CPU terrain. This causes water tint and
foam over beaches/mountains and shoreline drift. A shared signed height source will make
transparent water, dry land, depth absorption, floor visibility, and foam agree.

## Current state

- CPU terrain truth is in `src/core/terrain.ts`: `sampleSeabedY`, `sampleIslandHeight`, and
  `ISLAND_SPECS`.
- Shader `terrainHeight()` in `src/render/ocean.ts:109-166` approximates that JS logic but
  omits or changes seed/axis offsets.
- `src/render/ocean.ts:263-265` uses `world.y = max(world.y, floorY)`, lifting the water mesh
  onto land.
- Fragment alpha at `src/render/ocean.ts:429-434` remains visibly nonzero at zero water depth;
  there is no land discard/mask.
- Existing `tests/render/ocean-shore.test.ts` verifies only island uniform packing.

## Scope

**In scope:** `src/core/terrain.ts`, `src/render/ocean.ts`, `src/render/scene.ts`, a new
`src/render/terrain-height-texture.ts` if useful, `tests/render/ocean-shore.test.ts`, new
focused render-helper tests, and shoreline cases in `scripts/visual-golden.mjs`.

**Out of scope:** terrain layout redesign, new islands, FFT/SPH, vessel physics, simulation
collision rules, production fleet assets, or unrelated atmosphere changes.

## Steps

### Step 1: Generate one render heightfield from CPU terrain truth

Build a deterministic signed-height `DataTexture` (or equivalently testable shared lookup)
covering the ocean render extent. Sample the existing CPU seabed and island functions; do not
port a third noise implementation. Use linear filtering and document resolution/world bounds
so shorelines do not alias visibly. Cache it and dispose it with the scene.

Add pure tests comparing sampled texture values against CPU terrain at deep water, shelf,
beach, grass, and mountain points for every island.

**Verify:** `npx vitest run tests/render/ocean-shore.test.ts` -> height samples agree within
the documented interpolation tolerance.

### Step 2: Remove water-on-land geometry behavior

Keep Gerstner displacement on the sea surface. Delete the `max(world.y, floorY)` behavior.
In the fragment shader, sample signed terrain height and:

- discard or fade water where terrain is safely above the wet shoreline threshold;
- retain a narrow controllable wet/foam transition at the beach edge;
- compute water-column depth from the same signed height sample;
- keep subs, boats, and floor readable using depth-aware transparency/fresnel;
- avoid hard pixel stair-steps at the texture sampling resolution.

Do not make the entire ocean uniformly translucent. Grazing angles should remain reflective;
overhead shallows should expose sand and submerged vessels.

**Verify:** shader compiles in `npm run build`; browser E2E has no WebGL errors.

### Step 3: Make shoreline foam consume the same depth

Remove obsolete approximate island uniforms/noise when no longer needed. Drive foam lip,
wash, caustics, and shallow color from the shared water-column depth. Add quality-safe controls
for shoreline width without shifting the actual land boundary.

**Verify:** unit tests show land points produce zero water coverage, shallow points produce a
transition, and deep points remain water-covered.

### Step 4: Add shoreline visual evidence

Capture accepted seed/camera frames for each island from tactical and waterline views, plus an
underwater frame showing seabed and submarine. The visual report must name the seed, camera,
quality, and settings preset. A human must explicitly check: no water on mountain/foliage,
continuous beach foam, no coastline drift, readable sea floor, and no opaque-soup regression.

**Verify:** `npm run test:visual` exits 0 and artifacts contain the named shoreline frames.
Keep human status PENDING until reviewed.

## Test plan

- CPU-to-texture sample parity for all terrain biomes.
- Boundary samples just inside/outside every island shore.
- Resource lifecycle: height texture reused and disposed.
- Browser compilation and console-error check.
- Human screenshot comparison at high/medium/low after Plan 016.

## Done criteria

- [ ] Ocean vertices are not raised onto land.
- [ ] Water coverage/depth/foam derive from one CPU-authored heightfield.
- [ ] Automated shoreline tests pass for all islands.
- [ ] `npm run verify`, E2E, and visual capture commands pass.
- [ ] Human shoreline acceptance is recorded separately, not inferred.

## STOP conditions

- Float/half-float texture support fails on the required Chromium/WebGL2 target and the
  fallback cannot preserve the same signed-height contract.
- Fixing the mask would require changing simulation collision terrain.
- Performance regresses materially before Plan 016 profiling; record evidence and stop.

## Maintenance notes

Any terrain/island change must regenerate the render heightfield and rerun shoreline parity.
The shader must never become an independent source of terrain truth again.
