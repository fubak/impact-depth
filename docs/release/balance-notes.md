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
| `seedWave` ring radius | `12 + (i%3)*4` → 12/16/20 | `26 + (i%3)*6` → 26/32/38 | Outside ~17u passive detection envelope |
| Wave-1 escort count | `2+min(3,wave)` (=3) | `1` | Fewer simultaneous lethal contacts at open |
| Wave-1 `weaponCooldown` | `0` | `6 + (i%4)*1.5` | Opening grace before ordnance |
| `startMission` `invuln` | `0` (unused) | `8` seconds | Wired into `applyPlayerDamage` + seamount crush |

| Seamount crush | any depth above terrain+0.08 | require `depth > 0.62` and terrain clearance +0.2 | Attack-depth shelf transit was shredding hull at ~18 DPS |

## Verification

- `tests/game/survival.balance.test.ts` — min spawn distance >18 across seeds; 10-min quiet helm on seed 19 keeps HP >80.
- Full suite: `npm test` / `npm run verify`.
