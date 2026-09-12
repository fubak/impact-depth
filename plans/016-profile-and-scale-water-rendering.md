# Plan 016: Make water effects scale to the GPU budget

> **SUPERSEDED BY [Plan 018](018-ocean-world-engine-integration.md), 2026-09-11.**
> Retained as historical reference. Plan 018 replaces this implementation scope,
> explicitly permits FFT, and retains quality scaling, bounded resources, hardware
> p95 performance thresholds and operator evidence. This plan is not marked DONE.

> **Executor instructions:** Execute only this plan. Optimize from measurements, not guesses.
> Software renderers may be used for correctness but can never satisfy the hardware GPU gate.
> Preserve the accepted Caribbean visual bar unless the owner approves a documented tradeoff.
>
> **Drift check:** `git diff --stat 4da4d3f -- src/render/ocean.ts src/render/water-ripples.ts src/render/quality.ts src/render/renderer.ts src/render/scene.ts src/app.ts scripts/fps-bench.mjs tests/render docs/release/perf-notes.md`

## Status

- **Priority:** P1
- **Effort:** L (4–8 days plus GPU operator run)
- **Risk:** HIGH
- **Depends on:** Plans 013 and 015
- **Category:** performance, rendering, tests
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

The ripple pass allocates a viewport-times-DPR render target and creates two meshes/material
clones per ripple, up to roughly 160 draw calls. Adaptive quality changes renderer DPR, water
segments, and particle cap but does not resize or scale the ripple pass. The ocean shader is
also one of the heaviest full-screen paths. Real GPU evidence is still pending.

## Current state

- `water-ripples.ts:74-80` sizes the render target at `width*dpr` by `height*dpr`.
- `water-ripples.ts:83-105` creates two unculled meshes and cloned materials per ripple; cap is 80.
- `ocean.ts:586-590` emits wakes every 0.08 seconds for moving bodies.
- `scene.ts:224-227` applies quality only to water segments and particle cap.
- `app.ts:350-352` can change renderer DPR without calling `scene.resize`, leaving the ripple
  target at its old high-DPR size.
- `scripts/fps-bench.mjs` samples rAF but does not record GPU renderer, draw calls, triangles,
  render-target size, forced quality, or reject SwiftShader as authoritative.

## Scope

**In scope:** the listed render/quality/app files, FPS/benchmark scripts, render performance
tests, and `docs/release/perf-notes.md`.

**Out of scope:** changing simulation tick rate, lowering art quality silently, mobile targets,
FFT/SPH, production asset acquisition, or marking an operator gate complete on CI.

## Steps

### Step 1: Make benchmark evidence trustworthy

Extend the FPS report with unmasked renderer/vendor, Chromium version, viewport, device pixel
ratio, forced quality, median/p95/p99 frame time, draw calls, triangles, textures, programs,
ripple target dimensions/count, and sample duration. Support explicit high/medium runs.
Add an authoritative mode that exits nonzero for SwiftShader/llvmpipe/software renderers.
Keep a clearly labeled directional mode for CI.

**Verify:** CI directional report identifies software rendering; authoritative mode rejects it.

### Step 2: Put ripple cost into quality profiles

Extend `QualityProfile` with ripple render scale, maximum active ripples, emission interval,
and ocean normal-overlay count. On every profile change, resize the ripple target using the
new renderer DPR and render scale. Example starting points to measure, not blindly accept:

- high: half-resolution ripple target, visually sufficient count;
- medium: quarter-resolution, lower count/rate;
- low: quarter-resolution or disabled interactive ripples with wake ribbons retained.

Add tests that high->medium->low reduces target pixel count and caps deterministically.

**Verify:** focused quality tests pass and runtime instrumentation reports the expected target.

### Step 3: Batch ripple rendering

Replace per-ripple mesh/material clones with an instanced mesh, one dynamic buffer, or a
single shader-driven accumulation representation. Preserve expansion/fade and wake direction.
No material or geometry allocation should occur for every emitted ripple. Keep resources
bounded and disposed.

**Verify:** a stress test emits the maximum ripple count and asserts bounded scene children,
materials, geometries, and draw calls.

### Step 4: Profile the ocean shader and scene

Measure after Plans 013/015. Remove obsolete duplicated height/noise work, hoist invariant
calculations, and scale normal overlays/caustics/shore detail by quality. Inspect shadows,
overdraw, transparent ordering, fleet LOD, and allocations only where metrics identify cost.

**Verify:** before/after reports use the same seed, camera, viewport, quality, and hardware.
Visual captures show no unapproved shoreline, transparency, lighting, or vessel regression.

### Step 5: Run the real GPU gate

On the operator's Chromium/GPU machine, record hardware/driver/browser and run high and forced
medium at 1440x900 in an active patrol reference scene. Requirements remain >=55 FPS high and
>=30 FPS medium using p95 frame-time evidence, with no progressive resource growth.

**Verify:** attach reports to `docs/release/perf-notes.md`. Only the operator may mark the GPU
gate PASS after confirming the renderer is hardware accelerated.

## Done criteria

- [ ] Quality changes resize and cap the ripple pass.
- [ ] Ripple emission causes no per-ripple material/geometry allocation.
- [ ] Benchmark records renderer and scene metrics and rejects software GPU proof.
- [ ] High and medium GPU thresholds have operator-recorded evidence.
- [ ] `npm run verify`, E2E, visual capture, and performance tests pass.

## STOP conditions

- Target FPS requires silently reducing the accepted visual bar.
- Benchmark renderer is software in authoritative mode.
- Optimization changes deterministic simulation timing/state.
- Memory/resource counts continue growing after the bounded ripple lifetime.

## Maintenance notes

Re-run both high and medium reports whenever ocean shader, quality profiles, fleet LOD, shadow
settings, or DPR policy changes. Keep the reference scene and seed stable.
