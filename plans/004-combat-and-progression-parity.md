# Plan 004: Complete weapons, damage, FOB, powerups, waves, and outcomes

> **Executor instructions:** Port behavior in small subsystem slices with tests. The PRD is authoritative when archive behavior differs. Do not touch AI doctrine or final visuals.
>
> **Drift check:** clean worktree; compare `src/game/**`, renderer entity interfaces, and UI command contracts against the Plan 003 completion commit.

## Status

- **Priority:** P1
- **Effort:** L (2–3 weeks)
- **Risk:** HIGH
- **Depends on:** Plan 003
- **Category:** correctness, tests, direction
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

This plan completes the player's mechanical toolbox and the sector reward loop. It converts the tracer bullet into the full combat/progression contract without mixing in enemy tactical intelligence or presentation polish.

## References

- PRD sections 4, 5, 9, 10, 16, and 17 are the source of truth.
- Archived `engine.ts:596-729` covers countermeasures, fire, and active sonar commands; `engine.ts:730-1175` covers FOB, submarine, ordnance, damage, and cleanup.
- Archived `types.ts:95-148` defines ordnance/countermeasure shapes. Decompose behavior into dedicated systems.

## Scope

**In scope:** submarine systems damage/flood/stress; Mk-14/Mk-18/spread; Foxer and bubble screen; torpedo aspect damage; depth charges, Hedgehog, shells, enemy torpedoes as deterministic primitives; FOB safety/repair/restock; all six powerups and tiers; wave composition data, scoring/stats, wave clear/restock, victory/gameover.

**Out of scope:** enemy decision logic and firing permission (Plan 005 calls these primitives), production VFX/assets, full HUD/tutorial, co-op.

## Steps and gates

1. **Player vessel rules:** implement sticky orders, silent/scope/snorkel, battery, caps, tubes, flood, stress, tiers, and damage reduction. Verify every PRD table boundary with parameterized tests.
2. **Player weapons:** add Mk-18 seeking, spread offsets, target/point fire, reload separation, arm windows, aspect multipliers, depth gating, and typed rejection reasons. Verify exact ammo and integer reload-display source values.
3. **Threat primitives:** implement enemy torpedo, DC, Hedgehog, shell, and aircraft-bomb state transitions without autonomous spawning. Verify source attribution prevents random DCs.
4. **Countermeasures:** bubble and Foxer masking/diversion/damage rules, magazines, cooldown, and lifecycle. Verify they cannot double-apply or persist after expiry.
5. **FOB and pickups:** implement safe ring, docking hold, repair/reload rates, six pickup kinds, spawn caps/lifetimes, and deterministic spawn locations.
6. **Waves/outcomes/stats:** implement score table, wave composition data, restock, victory target 8, +1000 victory, gameover, and all stats.
7. **Characterization suite:** port archived edge cases as tests without copying archive architecture; add a replay spanning two waves and all player weapon types.

## Verification

- `npm test -- tests/game/combat tests/game/progression tests/replay.test.ts` passes.
- `npm run test:smoke` exercises fire, countermeasure, dock, pickup, wave clear, gameover, and restart.
- `npm run verify` exits 0.

## Done criteria

- [ ] Every numeric rule in PRD sections 4, 5, 9, 10, and 16 has a named test.
- [ ] Threat ordnance can only be created with a valid shooter/source command.
- [ ] FOB blocks damage and enemy fire into its radius.
- [ ] All six powerups cap correctly and survive replay serialization.
- [ ] Victory occurs only after the wave clears with at least eight sinks.
- [ ] No rendering or audio call occurs inside the sim.

## STOP conditions

- Archive and PRD disagree on a value not resolved by “PRD wins.”
- A weapon needs frame-rate-dependent collision to work.
- An event can award score/damage more than once after replay or host correction.
- Plan 005 AI behavior is required to test a primitive; use a deterministic test command instead.

## Maintenance notes

Keep damage source IDs and event IDs stable; Plan 009 uses them for idempotency. Review swept collision at high torpedo speeds and vertical separation carefully.

