# Plan 017: Polish and release the solo production build

> **Executor instructions:** This is the final solo release gate, not a feature-expansion plan.
> Execute only after Plans 011, 012, 014, 015 and 018 are DONE/accepted. Plans 013 and
> 016 are superseded by 018, not required to be falsely marked DONE. The executor may prepare evidence and fix objectively
> failed items, but it must pause for every named operator acceptance. Do not tag, deploy,
> push, or mark DONE without explicit operator approval.
>
> **Drift check:** `git diff --stat 4da4d3f -- src public scripts tests docs/release plans package.json`

## Status

- **Priority:** P1
- **Effort:** L (4–10 days including human soak/playthroughs)
- **Risk:** MED
- **Depends on:** Plans 011, 012, 014, 015, and accepted 018 (replaces 013/016 on the 2026-09-11 integration track)
- **Category:** visual polish, docs, release
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

The final step is to turn independently working systems into an accepted product build. The
current unobscured frame reaches the bright Caribbean direction but remains visibly look-dev:
foliage is neon/low-detail, scene scale reads toy-like, ocean detail can be noisy/washed out,
and no complete POV/lighting/quality review exists. Deployment, rollback, wall-clock soak, and
three human playthroughs also remain unproven.

## Current state

- `docs/release/lighting-acceptance.md` leaves bridge/periscope/free/map, night/dusk, and
  medium/low pending.
- `docs/release/perf-notes.md` leaves both hardware GPU gates pending.
- `docs/release/solo-production-status.md` leaves the operator gate pending.
- `docs/release/balance-notes.md:16` says spawn radius `26 + 6n`, while
  `src/game/sim/create.ts:71` currently uses `34 + 8n`.
- `docs/release/solo-production.md` describes Cloudflare Pages but contains no deployment ID,
  production smoke result, rollback rehearsal, or version stamp evidence.
- Plan 009 co-op must remain untouched until this plan is explicitly accepted.

## Scope

**In scope:** settings/material/lighting/foliage/UI CSS changes proven necessary by the visual
checklist; release scripts/docs; version stamp; balance-note reconciliation; production smoke;
and final acceptance evidence.

**Out of scope:** new campaign modes, co-op/auth/signaling, mobile parity, new simulation
features, wholesale art-direction changes, or editing `.archive/`.

## Steps

### Step 1: Freeze an acceptance candidate

Start from a reviewed, clean commit containing Plans 011, 012, 014, 015 and accepted 018. Record commit, asset manifest
version, Node/Chromium versions, and a clean `npm ci && npm run verify`. Reconcile all release
notes with code constants, especially balance spawn geometry. Add a visible or machine-readable
build version without exposing secrets.

**Verify:** worktree is clean except generated ignored artifacts; verify and all asset gates pass.

### Step 2: Run a structured visual polish pass

At 1440x900 high, then 1024x700 and medium/low, capture daylight tactical/chase/bridge/
periscope/free/map/sonar plus underwater and shoreline frames. Review and tune only failed
items:

- Caribbean water remains blue/turquoise, transparent overhead, reflective at grazing angles;
- submarines, floor, bathymetry, beaches, surface ships, and wakes remain readable;
- no water appears on land;
- foliage color/roughness/density looks natural rather than emissive/neon;
- mountains/islands have believable scale, silhouette, material breakup, and atmosphere;
- vessel waterlines, scale, lighting, shadows, and class recognition are credible;
- foam/noise/caustics support depth instead of washing out the whole screen;
- HUD remains legible without covering critical controls at 1024x700;
- dusk/night preserves silhouettes and instrument readability without crushed blacks.

For each change, capture before/after under identical camera/settings. Do not use the tutorial
or menu dimmer as visual evidence.

**Verify:** operator marks every row PASS/WAIVED/FAIL in `lighting-acceptance.md`; unresolved
FAIL blocks the release.

### Step 3: Run three human playthroughs and a wall-clock soak

On hardware Chromium/GPU:

1. stealth patrol and sink;
2. loud/evasive combat using sonar/countermeasures;
3. FOB/resupply/progression path.

Then run at least two wall-clock hours including pause/resume, background tab, resize, camera
switching, restart, and quality transitions. Record crashes, console errors, memory trend,
visual degradation, unclear controls, damage causes, and outcome. Fix P0/P1 issues in narrowly
scoped follow-up work; list accepted P2s with owner rationale.

**Verify:** operator signs all three playthroughs and soak in release docs. Automated accelerated
soak does not substitute for this step.

### Step 4: Deploy and rehearse rollback

Deploy the exact accepted commit/artifact to the chosen static host. Ensure changed immutable
assets use new versioned URLs, `index.html` is no-store, CSP works, and required media/models
return 200. Run smoke, real E2E, and a short manual patrol against the public URL. Record the
deployment ID and source commit. Roll back to the prior known-good deployment, rerun smoke,
then restore the candidate and rerun it.

**Verify:** production and rollback smoke evidence is recorded with URLs/IDs and timestamps.
Documentation alone is not rehearsal.

### Step 5: Close the production gate

Update `docs/release/solo-production-status.md`, `docs/release/solo-production.md`, and
`plans/README.md` with evidence links and remaining waivers. Only after explicit operator
approval, tag the exact accepted commit `solo-production` (or agreed equivalent). Leave Plan
009 TODO until that approval is recorded.

**Verify:** release tag resolves to the documented clean commit; production URL smoke/E2E pass;
Plans 011, 012, 014, 015, 018 and 017 are DONE; 013/016 remain recorded as superseded;
no pending P0/P1 or unacknowledged operator gate remains.

## Done criteria

- [ ] Full visual matrix is operator PASS or explicitly waived per item.
- [ ] High/medium GPU performance evidence passes Plan 018 thresholds (carried forward from 016).
- [ ] Three human playthroughs and >=2-hour wall-clock soak are signed off.
- [ ] Balance/content/audio/license documentation matches shipped bytes and constants.
- [ ] Production deploy and rollback were actually rehearsed.
- [ ] Public URL passes smoke and real patrol E2E.
- [ ] Operator explicitly approves and creates the production tag.
- [ ] Co-op remains untouched and capped at ten for the later Plan 009.

## STOP conditions

- Any P0/P1 remains open.
- Any asset/license provenance is incomplete.
- GPU or visual gates fail and the only proposed fix silently lowers the approved bar.
- Deployment/rollback cannot be exercised on the selected host.
- Cursor is asked to self-approve a human/operator criterion.

## Maintenance notes

After this tag, Plan 009 must preserve offline solo startup and deterministic replay. Every
future release should reuse the real E2E, visual matrix, GPU benchmark, asset validator,
wall-clock soak, and rollback evidence rather than reintroducing document-only gates.
