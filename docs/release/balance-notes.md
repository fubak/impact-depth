# Balance notes — Plan 010 Phase A

**Date:** 2026-08-03  
**Goal:** Wave-1 opening patrol is tense but fair; no unexplained sub-2-minute deaths from spawn geometry.

## Root cause

Wave-1 escorts and the U-boat shared the innermost spawn ring (radius 12) around `(50,48)` while the player spawned at `x ∈ [42,48], y=48`. Combined with `twoThirds` cruise noise (~0.45) and `weaponCooldown: 0`, contacts engaged within seconds.

## Changes

| Symbol | Before | After | Rationale |
|--------|--------|-------|-----------|
| `DEFAULT_CRUISE` | `1.6` | `0.85` | Quiet opening signature |
| `createSubmarine.speedOrder` | `twoThirds` | `oneThird` | Matches cruise; player can still order flank |
| `seedWave` ring radius | `12 + (i%3)*4` → 12/16/20 | `34 + (i%3)*8` → 34/42/50 | Outside ~17u passive detection envelope |
| Wave-1 escort count | `2+min(3,wave)` (=3) | `1` | Fewer simultaneous lethal contacts at open |
| Wave-1 `weaponCooldown` | `0` | `6 + (i%4)*1.5` | Opening grace before ordnance |
| `startMission` `invuln` | `0` (unused) | `8` seconds | Wired into `applyPlayerDamage` + seamount crush |

| Seamount crush | any depth above terrain+0.08 | require `depth > 0.62` and terrain clearance +0.2 | Attack-depth shelf transit was shredding hull at ~18 DPS |

## Verification

- `tests/game/survival.balance.test.ts` — min spawn distance >18 across seeds; 10-min quiet helm on seed 19 keeps HP >80.
- Full suite: `npm test` / `npm run verify`.

## Plan 022 S4 playtest findings (2026-09-26)

Measured by `tests/game/playtest/*` on seeds 1, 7, 19, 42, 91 (headless bots, current `master`).

- Silent bot, stopped at attack depth: first `alert > 0.25` after 11.8 s, 10.5 s, 15.4 s, 9.8 s, 24.4 s. Stealth at the opening is weaker than the start state suggests; Plan 022 G1 tunes this against the OD6 band.
- Ambush, stalk and intercept doctrines each fire within 180 s on every seed.
- Defect (pinned with `it.fails`): the Evade doctrine dies before the helm returns to manual on seeds 7, 42 and 91.
- Defect (pinned with `it.fails`): Exfil is sunk before reaching the FOB on all five seeds.

Flipping an `it.fails` to a passing test is the acceptance signal for fixing the matching defect.
