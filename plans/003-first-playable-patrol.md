# Plan 003: Deliver the first complete patrol vertical slice

> **Executor instructions:** Build one complete playable loop, not broad partial parity. Preserve the visual demo and use placeholder assets where necessary. Update plan status only after the browser scenario passes.
>
> **Drift check:** require a clean worktree and compare all in-scope files to the Plan 002 completion commit.

## Status

- **Priority:** P1
- **Effort:** L (2–3 weeks)
- **Risk:** HIGH
- **Depends on:** Plan 002
- **Category:** direction, correctness, tests
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

A vertical slice exposes integration mistakes earlier than subsystem-by-subsystem porting. Completion means a player can start a seeded patrol, navigate a finite sector, acquire a freighter, fire one Mk-14, sink it, receive a result, and restart—using the production state/event/render interfaces.

## Current state and references

- Current input is continuous WASD/QE only (`src/input/controls.ts:30-103`).
- Current scene owns fixed mesh instances (`src/render/scene.ts:16-69`).
- PRD sections 2–5 define phases, movement, depth/speed orders, and torpedo behavior.
- Archived behavior references: `engine.ts:246-484` for lifecycle/orders and `engine.ts:614-729` for fire/sonar. Do not port unrelated systems yet.

## Scope

**In scope:** menu/playing/paused/gameover/victory phase shell; seeded world and land collision; submarine ordered movement, battery/noise, one freighter, basic passive contact/selection, single Mk-14, hit/damage/sinking, minimal score/result/restart UI, renderer entity registry, vertical-slice E2E/replay tests.

**Out of scope:** Mk-18, spread, countermeasures, full enemy weapons, all classes, doctrine AI, tutorial, co-op, production glTF assets, broad VFX polish.

## Steps

1. **World and lifecycle:** generate a deterministic 96-unit sector, spawn navigable player/freighter positions, enforce land/floor collision, and implement menu → playing → result → restart with mission flavor recorded in state. Verify identical terrain/spawns for identical seeds.
2. **Command navigation:** add sticky depth/speed orders and plot-course commands. Keep direct helm as an accessibility/debug alternative. Verify silent caps never erase order intent.
3. **Contact and targeting:** derive one passive contact, support select/clear, and raycast tactical input through the sim-plane adapter. Verify camera changes do not change aim coordinates.
4. **Mk-14 tracer bullet:** implement magazine, gating, reload, arm delay, motion, hit, damage, three-second sinking, score event, and cleanup using PRD constants.
5. **Render/UI integration:** replace hard-coded ship ownership with ID-keyed entity creation/sync/disposal. Add minimal launch HUD: phase, hull, battery, noise, depth/speed order, torpedo count/reload, contact, score, and restart.
6. **Scenario test:** create a fixed seed/command replay that completes the patrol without manual timing and an E2E that does the equivalent through UI.

## Verification

- `npm test -- tests/game tests/replay.test.ts` → all deterministic/domain tests pass.
- `npm run test:smoke` → all camera modes and the patrol scenario pass with no console errors.
- `npm run verify` → exit 0.

## Done criteria

- [ ] One complete patrol loop works without look-dev/debug intervention.
- [ ] Land and floor collision cannot be bypassed by direct helm or plotted course.
- [ ] One Mk-14 consumes ammo, reloads, arms, hits, sinks, scores, and cleans up exactly once.
- [ ] Restart with the same seed reproduces the scenario.
- [ ] Renderer owns no gameplay truth and leaks no removed entity resources.
- [ ] Existing Caribbean tactical/periscope/sonar presentation still works.

## STOP conditions

- Raycast/aim results depend on camera FOV or render interpolation.
- Collision requires reading rendered mesh geometry rather than the deterministic world field.
- The vertical slice expands into full combat before its replay/E2E is green.
- Renderer entity cleanup produces growing object/texture counts over five restarts.

## Maintenance notes

This milestone freezes the command, event, snapshot, and entity-registry interfaces used by Plans 004–009. Review those contracts more closely than placeholder visuals.

