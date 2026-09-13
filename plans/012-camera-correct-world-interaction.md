# Plan 012: Make plotting and firing camera-correct

> **Executor instructions:** Execute only this plan. Preserve deterministic simulation ownership:
> camera math converts screen input into commands, while the simulation remains Three.js-free.
> Run each gate before continuing and update only this plan's row in `plans/README.md`.
>
> **Drift check:** `git diff --stat 4da4d3f -- src/app.ts src/input/controls.ts src/render/cameras.ts src/game/sim tests`
> Planned against `4da4d3f` plus the dirty Plan 010 snapshot on 2026-08-03. Stop if the
> interaction code no longer matches the current-state facts below.

## Status

- **Priority:** P1
- **Effort:** M (2–4 days)
- **Risk:** MED
- **Depends on:** Plan 011
- **Category:** bug, tests
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

Empty-water clicks currently map viewport percentages directly to the 128-unit sector. The
ordered destination changes when the player rotates, pans, zooms, or switches camera. Right
click fires at the old selected target rather than what was clicked. These are core tactical
controls, so attractive visuals cannot compensate for their unreliability.

## Current state

- `CameraRig.setPickRay()` in `src/render/cameras.ts:145-153` correctly creates a camera ray.
- `src/app.ts:254-257` uses that ray only for ship picking.
- `src/app.ts:273-276` converts raw screen ratios directly to `WORLD_SIZE` coordinates.
- `src/app.ts:249-252` makes every right click call `fireWeapon(this.game)` immediately.
- World/simulation conversion already exists in `src/game/sim/coords.ts:3-8`; reuse
  `worldMetersToSim` rather than duplicating it.
- Input must continue to emit commands; rendering must not mutate simulation state.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `npx vitest run tests/render/picking.test.ts tests/game/targeting.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Browser E2E | `npm run test:e2e -- http://127.0.0.1:8080/` | interaction journey passes |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope:** `src/app.ts`, `src/input/controls.ts`, `src/render/cameras.ts`,
`src/game/sim/coords.ts`, the minimum command/state/API files under `src/game/sim/` required
for explicit point aim, `tests/render/picking.test.ts` (create),
`tests/game/targeting.test.ts` (create), and the Plan 011 E2E journey.

**Out of scope:** camera art direction, AI targeting, weapon balance, renderer visuals, HUD
redesign, multiplayer, and `.archive/`.

## Steps

### Step 1: Add a reusable camera-to-water-plane projection

Add a `CameraRig` method that creates the existing pick ray and intersects it with the world
water plane `Y=0`. Return a world `Vector3` or `null` when the ray is parallel or points away.
Do not allocate a new `Plane`, `Raycaster`, or temporary vector per pointer event.

Unit-test perspective tactical cameras at multiple orbit angles and the orthographic map
camera. Project known world points to screen, invert them through the new helper, and assert
the recovered X/Z values within a documented tolerance.

**Verify:** `npx vitest run tests/render/picking.test.ts` -> all projection cases pass.

### Step 2: Convert the world intersection through the authoritative coordinate helper

Replace the screen-percentage fallback in `App.handleWorldInteraction` with:

1. ship raycast;
2. water-plane intersection;
3. `worldMetersToSim(world.x, world.z)`;
4. `snapToNavigable`;
5. the existing `orderMove` command path.

Plotting should be enabled only in views where a water-plane order is comprehensible
(tactical, free, and map unless the current UX contract specifies fewer). A miss or invalid
intersection must be a no-op, not an order to `(0,0)`.

**Verify:** new unit cases demonstrate the same visible world point produces the same sim
order after tactical orbit/zoom changes.

### Step 3: Make right-click act on the clicked target or point

For a ship hit, select that ship first and fire through the deterministic command API in the
same user action. For empty water, represent an explicit aim point in simulation coordinates
and pass it through a typed simulation command; unguided shots may use it, while weapons that
require an entity must return an existing-style player message rather than silently firing at
an old target. Clear stale point aim when an entity is selected and vice versa.

Do not store Three.js vectors or ray information in simulation state. Replay hashes must
include any new aim state/command deterministically.

**Verify:** `npx vitest run tests/game/targeting.test.ts tests/game/replay.10000.test.ts` ->
clicked-ship fire, clicked-point fire/rejection, stale-target clearing, and replay all pass.

### Step 4: Extend the browser interaction journey

In the real E2E from Plan 011, rotate tactical camera, click a known visible water location,
and verify the plotted marker/order corresponds to that world location. Then right-click a
visible contact and verify selection/ammunition/projectile state changes through HUD output.

**Verify:** `npm run test:e2e -- http://127.0.0.1:8080/` -> targeting journey passes with zero
console/page errors.

## Done criteria

- [x] Screen percentages are no longer used as world coordinates in `src/app.ts`.
- [x] Plotting is stable across orbit, zoom, viewport, and map camera.
- [x] Right-click never fires at an unrelated stale target.
- [x] Point/entity aim remains deterministic and replay-stable.
- [x] Focused tests and patrol E2E targeting journey pass. `npm run verify` still required at session close.

## STOP conditions

- The required point-fire behavior conflicts with the accepted weapon design; report the
  exact conflict and request an owner decision rather than inventing weapon semantics.
- The implementation would import Three.js into `src/game/sim/`.
- A production-only test hook is required to verify the result.

## Maintenance notes

Any future camera or coordinate-scale change must run the inverse-projection tests. Co-op
must replicate the resulting sim command/coordinates, never screen coordinates.

