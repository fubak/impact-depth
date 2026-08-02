# Plan 002: Build the deterministic game-domain foundation

> **Executor instructions:** Execute only this plan. Read `docs/prd.md` sections 2–7, 9–17, and 18 before editing. Use the archive only through read-only inspection. Update `plans/README.md` when done.
>
> **Drift check:** `git status --short` must be empty. Record `git log -1 --format=%h` in the completion note, then inspect `git diff --stat <Plan-001-SHA>..HEAD -- src/core src/game tests package.json`.

## Status

- **Priority:** P1
- **Effort:** L (1–2 weeks)
- **Risk:** HIGH
- **Depends on:** Plan 001
- **Category:** architecture, correctness, tests
- **Planned at:** 2026-08-02 planning snapshot; execute after Plan 001 baseline

## Why this matters

The look-dev state cannot grow safely into the PRD contract. Establish one pure, deterministic game domain before adding more rendering or UI. The archive provides proven field names and formulas, but its large engine must be decomposed into testable subsystems rather than pasted wholesale.

## Current state

- `src/core/types.ts:70-106` models only motion telemetry and three surface contacts.
- `src/core/sim.ts:64-125` creates a fixed diorama; `stepSim` at lines 261–276 updates motion only.
- `src/app.ts:142-159` already owns fixed-step scheduling and is the integration seam to preserve.
- The required public API is listed in `docs/prd.md` section 15.
- Archived references: `src/game/types.ts:1-260`, `src/game/engine.ts:246-1273`, `src/game/world.ts`, and `src/game/iso.ts`. Treat formulas as characterization targets, not architecture.

## Scope

**In scope:** create `src/game/sim/**`, `src/game/commands/**`, `src/game/events/**`, `src/game/replay/**`; adapt `src/core/types.ts`, `src/core/sim.ts`, and `src/app.ts` through compatibility adapters; add `tests/game/**` and replay fixtures.

**Out of scope:** finished combat behavior, AI tactics, Three.js visuals, HUD redesign, audio, multiplayer, auth, React/TanStack, `.archive/**`.

## Target architecture

- `GameState` is serializable data only.
- `GameCommand` is a discriminated union for player intent.
- `GameEvent` is a discriminated union for render/audio/UI effects.
- `stepGame(state, commands, dt)` is deterministic and has no DOM, Three.js, WebAudio, timers, network, or `Math.random()` calls.
- A seeded RNG lives in state or a deterministic context and is covered by replay tests.
- Render receives immutable `RenderSnapshot`; UI emits commands.
- Preserve the PRD section 15 API via a small facade even if internals use reducers/systems.

## Steps

### Step 1: Define the authoritative schema and coordinate contract

Create types for phases, submarine, ships, ordnance, countermeasures, aircraft, terrain seed, base, powerups, sonar contacts, autopilot, stats, and settings. Use sim `x/y` in `[0,96)` and normalized depth `z` in `[0,0.95]`; define explicit helpers mapping sim coordinates/depth to Three.js `x/z/y` meters.

**Verify:** type-level fixture constructs a complete `GameState`; unit tests prove depth/world conversions round-trip within tolerance.

### Step 2: Add deterministic RNG, commands, events, and snapshots

Ban implicit randomness from simulation modules with lint or a focused test. Define stable command timestamps/ticks and canonical snapshot serialization. Events must carry enough information for VFX/audio without allowing render code to mutate state.

**Verify:** same seed + commands over 10,000 ticks produces byte-identical canonical snapshots.

### Step 3: Split the fixed step into ordered systems

Create an explicit order such as: commands → autopilot intent → submarine → world collision/base → sonar → enemies → ordnance → damage/outcomes → pickups/waves → cleanup/events. Initially systems may be no-op scaffolds, but ordering and ownership must be tested. Preserve bounded catch-up from `src/core/sim.ts:28-47`.

**Verify:** an order-spy test proves system order; pause prevents state time/ticks from advancing.

### Step 4: Provide a compatibility facade and render snapshot adapter

Keep the current visual demo playable by adapting the new state to the existing `GameScene`, HUD, periscope, and sonar inputs. Do not duplicate authoritative state in the adapter.

**Verify:** current tactical/periscope/sonar browser smoke remains green; current controls still move and dive the boat.

### Step 5: Create PRD constant and API contract tests

Centralize numeric design constants and create tests for high-risk values: world size, land level, thermocline, victory target, FOB radius, active sonar timing, DC engagement range, and day length. Export every section 15 command through one facade, with unimplemented gameplay commands returning explicit typed rejections rather than silently doing nothing.

**Verify:** `npm run verify` passes; an API export test covers every required symbol by name.

## Verification

- `npm test -- tests/game tests/replay.test.ts` passes, including the 10,000-tick replay.
- `npm run test:smoke` keeps the existing tactical, periscope, and sonar prototype playable.
- `npm run verify` exits 0 with no simulation import of Three.js, DOM, WebAudio, or network modules.

## Done criteria

- [ ] Simulation modules have no Three.js/DOM/WebAudio/network imports.
- [ ] No simulation path uses `Math.random()` or wall-clock time.
- [ ] Coordinate/depth contract is documented and tested.
- [ ] Required API surface exists with explicit results.
- [ ] Current look-dev remains playable via an adapter.
- [ ] 10,000-tick deterministic replay passes.
- [ ] `npm run verify` and browser smoke pass.

## STOP conditions

- The implementation requires changing PRD numeric behavior without a documented product decision.
- State cannot be serialized without functions/classes/cycles.
- A render or UI module must become authoritative for gameplay.
- More than one source of truth for vessel position/depth is introduced.

## Maintenance notes

Reviewers should scrutinize hidden nondeterminism, mutation through snapshots, and coordinate ambiguity. Future co-op and replay debugging depend on this foundation.
