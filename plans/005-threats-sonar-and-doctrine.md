# Plan 005: Complete sonar, enemies, ASW, aircraft, navigation, and doctrine AI

> **Executor instructions:** Implement deterministic decisions and reuse Plan 004's combat primitives. Do not let AI call renderer/UI functions or create un-attributed ordnance.
>
> **Drift check:** clean worktree and compare game contracts to the Plan 004 completion commit.

## Status

- **Priority:** P1
- **Effort:** L (2–4 weeks)
- **Risk:** HIGH
- **Depends on:** Plan 004
- **Category:** correctness, performance, tests
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

Silent Depths becomes a game when the player must reason about sound, depth, terrain, and enemy intent. This milestone completes the threat ecosystem and automated doctrine while keeping it deterministic enough for replays and later host authority.

## References

- PRD sections 3.3, 6, 7, and 11.
- Archived `pathfinding.ts:10-344`, `sonar.ts:19-314`, and `autopilot.ts:53-613` are focused behavior references and are safer to adapt than `engine.ts`.
- Required update order is explicit: autopilot before submarine movement.

## Scope

**In scope:** seeded wave spawns; all six enemy classes/roles; patrol/formation/pathfinding/local avoidance; alert/hold contact; passive/active sonar, thermocline, CM masks and contact aging; class-correct guns/ASW/torpedoes; aircraft lifecycle; sinking behavior; player ambush/stalk/intercept/evade/exfil doctrine; cancel/target semantics; emergency behaviors.

**Out of scope:** final models/VFX/audio/HUD, multiplayer, auth, campaign mode, voice.

## Steps and gates

1. **Navigation:** adapt coarse A*, clearance radii, snapping, line-clear, multi-ray avoidance, patrol routes, screen offsets, and bounded search. Benchmark worst-case path queries and cache/repath deliberately.
2. **Sonar:** implement machinery noise, layer factors, passive/active ranges, strength/jitter/age labels, CM masking, active-ping alert side effects, and stable contact IDs.
3. **Enemy roster and decisions:** implement class stats, roles, formation, alert/hold contact, engagement ranges, and strict weapon matrix. Freighters never fire; U-boats fire torpedoes only; DCs originate from allowed shooters under valid conditions.
4. **Aircraft:** deterministic 55–95s cooldown, 28s life, mast/noise hunt, bomb gate, and fleet alert event.
5. **Doctrine:** adapt the six tactics into a tested state machine. Run it before submarine movement; preserve player intent and make cancel/clear commands immediate.
6. **Scenario matrix:** add seeded replays for every ship class, thermocline crossing, CM masking, every doctrine, path obstruction, FOB safety, wave 1–3 composition, and prolonged ASW.

## Verification

- `npm test -- tests/game/ai tests/game/sonar tests/game/pathfinding tests/replay.test.ts` passes.
- A 30-minute headless accelerated soak finishes with finite values, bounded entity counts, and identical final hash on repeat.
- `npm run verify` and browser smoke pass.

## Done criteria

- [x] All ship classes use only their PRD weapons.
- [x] No AI path enters land and path search respects node budgets.
- [x] Sonar/thermocline/contact decay values have boundary tests.
- [x] Doctrine state transitions and emergency overrides are replay-deterministic.
- [x] Clear target and cancel autopilot stop engagement drift in the next tick.
- [x] Aircraft and ASW events are source-attributed.
- [x] 30-minute soak has no state divergence or unbounded arrays/maps.

## STOP conditions

- AI needs nondeterministic wall-clock timing.
- Pathfinding exceeds its node budget or blocks a frame under benchmark.
- An enemy weapon bypasses Plan 004's command/gating primitives.
- A doctrine modifies sticky order intent as a side effect of a temporary cap.

## Maintenance notes

Keep AI decisions observable through debug events and replay traces. Plan 009 will run these systems only on the host, so avoid dependencies on local camera/UI state.

