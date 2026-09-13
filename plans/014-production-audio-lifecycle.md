# Plan 014: Make authored audio load, transition, and mix correctly

> **Executor instructions:** Execute only this plan. Audio remains observational and must
> never alter simulation results. Preserve gesture-based unlock and the procedural fallback.
> Do not mark sound content accepted without an operator listening pass.
>
> **Drift check:** `git diff --stat 4da4d3f -- src/game/audio public/assets/audio public/assets/manifest.json scripts/generate-audio-banks.mjs tests/game/audio.test.ts docs/release`

## Status

- **Priority:** P1
- **Effort:** M (3–5 days plus content review)
- **Risk:** MED
- **Depends on:** Plan 011
- **Category:** bug, content, tests
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

The WAV banks are fetched asynchronously, but gameplay starts a fallback oscillator before
they finish. Because `ambientSource` is then non-null, the authored ambient loop never takes
over. Existing tests only cover construction/mute/dispose without AudioContext and cannot
detect this. The current generated banks should remain reliable fallbacks, not be mislabeled
as accepted final audio.

## Current state

- `GameAudio.unlock()` starts `loadBanks()` without awaiting it at `audio.ts:55-70`.
- `startAmbient()` returns if any source exists at `audio.ts:87-110`.
- `observe()` requests ambient immediately once phase is `playing` at `audio.ts:142-145`.
- `engine.wav` is triggered as short one-shots on speed changes rather than a continuous
  engine layer at `audio.ts:153-157`.
- `tests/game/audio.test.ts` does not provide a fake AudioContext or fake fetch/decode path.
- `scripts/generate-audio-banks.mjs` creates deterministic synthesized WAVs; preserve it as
  fallback generation.

## Scope

**In scope:** `src/game/audio/audio.ts`, optional small audio types/helpers under the same
directory, `tests/game/audio.test.ts`, `scripts/generate-audio-banks.mjs`, final bank files
and their license/author ledger in `public/assets/manifest.json`, audio release documentation,
and a browser audio-unlock E2E check.

**Out of scope:** voice acting, music system, simulation changes, UI redesign, autoplay before
gesture, third-party samples without a documented redistributable license, and `.archive/`.

## Steps

### Step 1: Make loading state explicit and testable

Represent bank loading as a single cached promise with terminal states per bank. Inject or
wrap context creation and fetch/decode behind a narrow test seam so Vitest can deterministically
resolve banks without browser audio hardware. Dispose must cancel/ignore late completions and
must not start nodes after context closure.

**Verify:** tests cover successful load, missing file, decode failure, repeated unlock, and
dispose-during-load without unhandled rejection.

### Step 2: Crossfade fallback ambient into loaded banks

Track fallback and buffer sources explicitly with their gain nodes. If the mission starts
before `ambient.wav` loads, start the low fallback; when the bank becomes ready and phase is
still playing, start the authored loop and crossfade over a short deterministic wall-clock
audio interval. Start `ambient2` when ready even if the primary was already running. Ensure
pause/result/restart and mute/unmute do not create duplicate loops.

**Verify:** fake-audio tests assert the fallback starts once, authored source starts after
resolution, fallback stops after fade, and repeated observations leave one ambient stack.

### Step 3: Add a continuous engine layer and explicit mix groups

Introduce small master/UI/SFX/ambience/engine gain groups. Loop the engine bank while playing
and map playback rate/filter/gain smoothly to submarine speed; keep a synthesized continuous
fallback when the bank is absent. One-shot speed-change chatter must not replace the engine
bed. Preserve the existing mute contract and gesture unlock.

**Verify:** tests assert one engine loop, bounded gain/rate values, mute propagation, and clean
stop at result/dispose.

### Step 4: Separate fallback banks from final accepted content

Record for every shipped WAV: creator/source, license, intended cue, duration, and whether it
is `fallback-generated` or `production-accepted`. Replace core banks only with operator-owned
or clearly licensed files. Do not silently call synthesized output authored production audio.
The required listening checklist is UI click, sonar, torpedo, explosion, countermeasure,
alarm, engine, ambience, mute/unmute, restart, and no clipping during combat.

**Verify:** a validation test/script confirms every bank has a ledger entry and decodes in
Chromium. Operator acceptance remains PENDING until heard on the target machine.

## Done criteria

- [x] Loaded ambient banks replace the early fallback without duplicate sources.
- [x] Engine is a continuous speed-responsive layer.
- [x] Fake-context lifecycle/error tests cover asynchronous behavior.
- [x] Every WAV has provenance and fallback/production status.
- [x] Gesture unlock and mute work in Chromium E2E (`scripts/e2e-hud-commands.mjs` Pause/Mute/Help).
- [ ] Human listening acceptance is recorded separately (operator). `npm run verify` still required at session close.

## STOP conditions

- Any sample's redistribution/license terms are unclear.
- Tests require real audio hardware or nondeterministic timing.
- Audio state begins influencing deterministic game state.

## Maintenance notes

Keep generated WAVs as CI/offline fallbacks. Future content replacements must change the
ledger and cache version and must pass the same late-load/restart lifecycle tests.

