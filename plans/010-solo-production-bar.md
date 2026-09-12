# Plan 010: Close the solo production bar

> **Executor instructions:** Solo Plans 001–008 are DONE (`solo-rc`). This plan finishes the documented P2 gaps and operator gates so the game is content-complete and shippable at the PRD visual/audio bar—**before** Plan 009 co-op. Execute phases in order; do not start Plan 009 while any P0/P1 item below is open. Do not push unless the operator asks.
>
> **Drift check:** start from a clean worktree on/after `solo-rc` (or newer lighting/polish commits). Re-read `docs/release/solo-rc.md` Known gaps and this plan before editing.

## Status

- **Priority:** P1 for ship feel; blocks “content complete” release gate
- **Effort:** L (3–6 weeks focused; asset authoring can dominate)
- **Risk:** MED (art/audio licensing and GPU QA are the long poles)
- **Depends on:** Plans 001–008 DONE
- **Category:** balance, content, audio, AI polish, deploy, operator QA
- **Planned at:** 2026-08-03 (post lighting polish)

## Why this matters

The deterministic solo loop works, but the RC still ships procedural fleet silhouettes, stub audio, light convoy AI, and no production CDN path. Early patrol deaths and GPU FPS also need an operator-proven pass. Closing these is what turns “playable RC” into the PRD’s production solo bar.

## Current baseline (do not re-litigate)

| Item | State |
|------|--------|
| Plans 001–008 | DONE; tag `solo-rc` |
| Daylighting / fill / IBL | Landed post-RC; still needs POV/night human review |
| Fleet | Procedural fallbacks; `public/assets/manifest.json` glTF URLs null |
| Audio | Procedural WebAudio bus; no authored banks |
| Convoy AI | Lightweight steering; not full formation doctrine |
| Deploy | Local Vite `dist/` only; no CDN/CI publish path |
| Co-op | Plan 009 — deferred until this plan’s P1 gates pass |

## Scope

**In scope**

1. Combat/survival balance (early hull loss, U-boat/ASW pressure, ammo/FOB economy)
2. Operator GPU FPS gate (≥55 high / ≥30 medium) with recorded hardware notes
3. Production glTF fleet + props wired through the asset manifest/fallbacks
4. Authored audio banks on the existing bus (with stub fallback)
5. Convoy formation / escort doctrine polish (still deterministic, still offline)
6. Static production deploy (CDN or equivalent) + cache/CSP/rollback docs
7. Lighting/POV/night human acceptance pass (fix only regressions)
8. Operator wall-clock soak + three human playthroughs; update `docs/release/`

**Out of scope**

- Plan 009 co-op / signaling / auth
- Mobile performance guarantee
- New campaign modes or monetization
- FFT/SPH water rewrite
- Mass art-direction reboot (Caribbean littoral stays)

---

## Phase A — Survival & balance (3–5 days)

**Goal:** first 5 minutes are tense but fair; early game-overs from unfair collision/ASW spam are gone.

### Steps

1. Instrument (temporary HUD/debug or event counters): time-to-first-contact, damage-by-source, flood rate, U-boat proximity damage, wave spawn density, ammo remaining at first sink/death.
2. Reproduce the rapid hull bleed (nearby U-boat / collision / depth pressure) across ≥5 seeds; classify each death cause.
3. Tune **data constants only** (`src/game/sim/constants.ts` and related tables): spawn standoff, U-boat aggression, ASW detection ramp, collision damage, flood rates, wave 1 density. Document every changed PRD number in `docs/release/balance-notes.md`.
4. Add a deterministic regression: “seed X survives ≥N minutes under scripted helm” or “wave-1 damage caps.”
5. Manual gate: three cold starts → Begin Patrol → Skip tutorial → Surf → plot away from land → survive 10 minutes without touching combat.

### Verification

- New/updated vitest(s) green under `npm test`
- `npm run verify` green
- Balance notes committed with before/after constants

### Done when

- [ ] No unexplained sub-2-minute deaths on default seed/path
- [ ] Wave 1 feels patrol-able; difficulty still ramps by later waves
- [ ] Damage sources are attributable in telemetry or tests

### STOP

- Balance “fix” requires rewriting AI architecture mid-phase → park AI work in Phase D
- Owner rejects changing a PRD number with no documented rationale

---

## Phase B — Operator GPU performance gate (2–4 days)

**Goal:** prove the FPS bar on real desktop Chromium + GPU (not llvmpipe).

### Steps

1. Record reference machine: GPU, driver, Chromium version, resolution (1440×900), quality preset.
2. Run `npm run build && npm run preview` (or :8800 prod-like) and `npm run test:perf -- <url>` after Begin Patrol.
3. If &lt;55 FPS high: profile draw calls, water segments, shadows, particles, HUD thrash; apply measured fixes only (LOD, shadow map size, quality hysteresis already exists—tune thresholds with evidence).
4. Confirm medium fallback holds ≥30 FPS when forced.
5. Append results to `docs/release/solo-rc.md` (or `docs/release/perf-notes.md`) with hardware stamp.

### Verification

- Perf script exit 0 on GPU host
- `npm run verify` still green after any renderer changes

### Done when

- [ ] ≥55 FPS high documented on reference GPU desktop
- [ ] ≥30 FPS medium fallback documented
- [ ] No silent visual-bar regressions (lighting/water/land still accepted)

### STOP

- Meeting FPS only by dropping the accepted visual bar without owner approval

---

## Phase C — Production fleet & props (1–3 weeks)

**Goal:** vessel recognition and shore/props meet the PRD realism bar; procedural fallbacks remain for offline/dev.

### Steps

1. Freeze entity→asset map: sub, destroyer, merchant, cruiser, battleship, patrol, U-boat, aircraft, torpedo, FOB, crates, any hero props.
2. Source optimized glTF (custom or licensed). Record license ledger entries in `public/assets/manifest.json` (already scaffolded).
3. Budget: target poly/texture caps per class; compress (Draco/meshopt + KTX2/webp as already patterned).
4. Wire non-null manifest URLs; keep `AssetRegistry` fallback to procedural on load failure.
5. Normalize materials for the current lighting (metalness/roughness/envMapIntensity caps already in `assets.ts`—re-tune after real meshes land).
6. Visual golden update: `npm run test:visual` baselines only after owner accepts look.
7. Chase/bridge/peri/tactical POV checklist for silhouette readability at combat ranges.

### Verification

- Manifest loads in browser; missing URL still falls back without throw
- Smoke + visual gates pass
- License ledger complete for every shipped binary asset

### Done when

- [ ] All launch vessel/prop kinds have accepted glTF (or explicit owner waiver per kind)
- [ ] Fallbacks still work with null/failed loads
- [ ] No P0 texture/material black-hull regressions under daylight IBL

### STOP

- Unlicensed assets or secrets in repo
- Single monolithic multi‑GB pack that breaks first-load budget

---

## Phase D — Convoy & escort AI polish (4–8 days)

**Goal:** merchants hold formation; escorts screen; behavior stays deterministic and replay-stable.

### Steps

1. Define formation slots (lead, wing, trail) and escort screen offsets in sim space.
2. Replace pure flocking where needed with slot seek + separation + land avoidance (reuse pathfinding).
3. Escorts: react to torpedo wakes / detected sub bearing with PRD-consistent ASW pattern (no omniscience).
4. Replay/hash tests for a fixed seed convoy crossing.
5. Soak: 30-min accelerated with convoys active; no NaNs or entity explosions.

### Verification

- Dedicated vitest(s) + existing soak green
- `npm run verify`

### Done when

- [ ] Wave merchants visibly hold formation on chase/tactical cams
- [ ] Escorts screen rather than ignore the lead
- [ ] Replay hashes stable across two runs

### STOP

- AI changes break determinism or Plan 002 command/snapshot contracts

---

## Phase E — Authored audio banks (4–8 days)

**Goal:** replace stub tones with banks on the existing `GameAudio` bus; mute/settings preserved.

### Steps

1. Inventory cues: UI click, helm, sonar ping/return, torpedo launch/run, explosion, depth charge, aircraft, flood alarm, victory/defeat, ambient sea/engine.
2. Author or license short loops/one-shots; document ledger.
3. Load via manifest or `/public/assets/audio/`; decode on first unlock; retain procedural fallback if decode fails.
4. Mix buses: master / SFX / UI / voice(optional none) with existing mute.
5. Reduced-motion / autoplay policy: no sound until user gesture (already required).

### Verification

- Manual mute/unmute and cue checklist
- Smoke still passes without audio hardware
- Missing files do not crash

### Done when

- [ ] Core combat/UI/sonar cues are authored (or owner-waived list documented)
- [ ] Procedural fallback remains for CI/headless
- [ ] No audio unlock / autoplay violations on Chromium

### STOP

- Shipping uncleared samples

---

## Phase F — Production deploy path (2–5 days)

**Goal:** one documented command path from clean clone → public URL → rollback.

### Steps

1. Choose static host (Cloudflare Pages / GitHub Pages / S3+CloudFront / Vercel static—operator picks one).
2. Document env-free build: `npm ci && npm run verify && npm run build`.
3. Cache headers for hashed assets; short TTL or no-cache for `index.html`.
4. CSP suitable for WebGL/WASM/audio workers without `unsafe-eval` if possible; document exceptions.
5. Version stamp in UI or `dist/version.json`.
6. Smoke against production URL; rehearse rollback to previous artifact.
7. Update `docs/release/solo-rc.md` Build/run/rollback section.

### Verification

- Production URL smoke (`test:smoke -- <url>`) exit 0
- Rollback rehearsal noted in release docs

### Done when

- [ ] Public (or staging) URL serves the RC+content build
- [ ] Rollback is a documented one-liner / console action
- [ ] No secrets in client bundle

### STOP

- Deploy design requires a game server or auth before Plan 009

---

## Phase G — Lighting & presentation acceptance (1–2 days)

**Goal:** confirm post-RC lighting across POVs; fix only regressions.

### Checklist

- [ ] Tactical, chase, bridge, peri, free, map — day preset
- [ ] Night / dusk presets readable (not crushed black hulls)
- [ ] Islands, seabed, foliage, vessels lit; no black silhouette regression
- [ ] Quality medium/low still acceptable

Touch `atmosphere` / materials only if a checklist item fails.

---

## Phase H — Operator release gate (2–4 days)

**Goal:** human proof, not agent proof.

### Steps

1. Wall-clock soak ≥2 hours on GPU desktop (pause/resume, tab background, resize).
2. Three human playthroughs: stealth sink, loud/evasive, FOB/resupply path.
3. Triage all new P0/P1; P2 list updated with waivers.
4. Write/update `docs/release/solo-production.md` (or extend `solo-rc.md`) with content/audio/deploy/perf evidence.
5. Tag `solo-production` (or `solo-rc2`) when operator accepts.
6. Only then allow Plan 009 kickoff.

### Done when

- [ ] Soak and three playthroughs signed off
- [ ] Release doc + tag exist
- [ ] `plans/README.md` marks 010 DONE

---

## Suggested execution order

```text
A balance → B GPU FPS → G lighting acceptance (quick)
    ↓
C glTF fleet  ║  E audio   (parallel after A if staffing allows)
    ↓
D convoy AI (needs stable entities; better after C starts)
    ↓
F deploy → H operator gate → tag → Plan 009
```

Prefer **A → B** first for playability. Content (C/E) can parallelize. **D** after entity visuals stabilize. **F/H** last.

## Verification (whole plan)

```bash
npm ci
npm run verify
npm run test:e2e
npm run test:visual
npm run test:perf -- <preview-or-prod-url>
npm run test:soak
```

Plus production URL smoke after Phase F and the Phase H human checklist.

## Done criteria (Plan 010)

- [ ] Early-game survival fair; balance notes published
- [ ] GPU FPS bar met and recorded
- [ ] glTF fleet/props accepted (or per-kind owner waivers)
- [ ] Authored audio banks on bus with stub fallback
- [ ] Convoy/escort formation behavior replay-stable
- [ ] Static CDN/host deploy + rollback documented and rehearsed
- [ ] Lighting POV/night checklist PASS
- [ ] Operator soak + 3 playthroughs PASS
- [ ] Release doc + `solo-production` (or equivalent) tag
- [ ] Plan 009 still untouched until the above P1s clear

## STOP conditions

- Co-op/auth/signaling work sneaks in
- Determinism or offline solo startup regresses
- Unlicensed assets or committed secrets
- FPS gate “passed” only on software rasterizers
- Shipping procedural fleet as final without owner waiver

## Maintenance notes

Keep procedural fallbacks forever for CI and broken CDN assets. Manifest + license ledger are source of truth. After the production tag, Plan 009 must feature-flag co-op and leave this offline path green.
