# Plan 028 — Captain's Glory: the ARPG fun pass

> **Status: PLANNED.** Execute on branch `plan-028-fun-pass`. Machine verification only; fun/feel, GPU FPS and
> every other operator gate stay **PENDING** and are not self-approved (AGENTS.md).

**Goal:** make Silent Depths feel like an action RPG: kill things, get stronger, make choices, chain big moments,
and read the screen at a glance. Less simulation jargon, more power fantasy. Gameplay truth stays in
`src/game/sim/**` (deterministic, no `Math.random`, no DOM/Three.js).

## Mechanics analysis (what exists, what is flat)

| Area | Today | Problem |
| --- | --- | --- |
| Reward loop | Sink a ship: flat score (150–420) + one salvaged Mk-14 (`systems.ts` damage system) | No growth from your own play; every kill feels the same |
| Progression | Random map crates: hull/weapon/speed tiers capped at 3 (`applyPickup`) | Power comes from luck and pickup walking, not from skill; no build identity |
| Choice | Weapon mode, depth, speed, doctrine | Tactical, not "what kind of captain am I" |
| Feedback | Toast text, score number, explosion VFX | No crits, streaks, big-number moments, or "that was awesome" beats |
| Enemies | Merchants, escorts, subs, aircraft | No elites/bosses to hunt, nothing worth loot |
| Power moments | None | No ability to build toward and unleash |
| Readability | Jargon labels (Doctrine, Atk/Peri, kn, Snorkel); boat is a faint ghost in bright shallows | Technical first impression, hard to find yourself |

## Design pillars

1. **Every kill pays.** XP, loot chance, combo.
2. **Choices that define a run.** Level up → pick 1 of 3 perks.
3. **Spectacle on demand.** Crits, streak banners, a charged "Broadside" ultimate.
4. **Hunt something.** Elite targets with names and guaranteed good loot.
5. **Plain language.** A new player never needs the word "doctrine".

## Hard constraints (every task)

- Sim stays deterministic: no `Math.random`, randomness only from `rngState`/seeded hashes. Immutable updates.
- The sim must **never block** on player input (bots/tests run headless). Pending choices persist; they do not freeze `stepGame`.
  The app layer pauses the clock while an overlay is open.
- No perks/XP effects change default balance until earned: existing tests (`campaign-balance`, `exfil-*`, `doctrines`,
  `pacing`, `progression`, `replay.10000`) must stay green. If a change is intentional, update that test with a one-line rationale.
- **No browser, Playwright or WebGL runs locally** (operator's CPU overheats). Verify with `npx vitest run <files> --maxWorkers=1`,
  `npm run typecheck`, `npm run lint`. Browser journeys run on CI only.
- Small files (<400 lines typical), new logic in new modules, tests first. Commit nothing: the orchestrator commits.
- Do not touch `.archive/`, assets, `plans/` (except this file's status), or the operator gates.

## Workstreams

Each is scoped for a single focused agent. Waves run in order; tasks inside a wave touch disjoint files.

### Wave A (parallel, disjoint files)

**W1 — XP, levels and perk draft (sim).** Files: new `src/game/sim/progression.ts`, `perks.ts`; hooks in `types.ts`, `create.ts`,
`systems.ts` (damage system XP award only), `commands/types.ts` (`choosePerk`), `api.ts` export.
- `stats.xp`, `stats.level`; XP per kill by class (merchant 40, patrol 60, destroyer 100, cruiser 160, sub 140, battleship 300);
  level n needs `80 + 60*(n-1)` XP. Level-up sets `pendingPerks: [PerkId, PerkId, PerkId]` chosen deterministically from `rngState`
  (no repeats of owned non-stackable perks). Unchosen choices persist; further level-ups queue (`perkQueue` count).
- `choosePerk {index}` applies the perk, clears one pending choice. Perks (id → effect, each applied at one site):
  `hotTubes` reload -20%, `heavyWarheads` torpedo damage +25%, `ironHull` +25 max HP and heal 25, `salvage` kills refund +1 extra Mk-14,
  `quietProp` noise ×0.75, `predator` 15% crit chance (crit = ×2 damage; W2 consumes this), `chainReaction` a sinking ship deals
  30 damage to hulls within 6 units, `ghost` silent running drains no battery.
- Tests: XP/level curve, deterministic offers (same seed → same offers), choose applies exactly once, bot with no choices unaffected,
  perk effects (one test each).
- Model: **sonnet**.

**W6 — Find your boat + plain-language copy (UI/render only).** Files: `src/ui/hud.ts`, `src/ui/tutorial.ts`, `src/render/scene.ts`
(own label only), `src/styles/main.css`.
- Player label: larger, higher contrast, always shown in tactical; add a clear hull-tied marker ring. No new shaders.
- Copy: "Doctrine"→"Orders", "Atk"→"Attack depth", "Peri"→"Scope depth", "kn" stays only in the data row; tooltips in plain words.
  Tutorial text rewritten at a 6th-grade reading level, one short sentence per step. Keep `data-*` hooks and ids unchanged
  (E2E uses them).
- Tests: update only string assertions that changed; `npm run test:e2e:layout` is NOT run locally (CI/operator).
- Model: **haiku**.

### Wave B (sequential, after A)

**W2 — Crits, combo streaks and big-number feedback (sim + messages).** Files: new `src/game/sim/combo.ts`; hook in ordnance hit and
damage systems.
- Crit: if `predator` (or later sources) gives chance, roll from a seeded hash of `(seed, tick, torpedo id)` (NOT `rngState`) → ×2
  damage and a `CRIT -N` message. No perk → no crit → existing outcomes unchanged.
- Combo: kills within 12 s extend a streak (`stats.combo`, `comboExpires`); score bonus +10% per streak step (cap +50%) kept in
  `stats.bonusScore` so base score tests keep their meaning; banner messages at 2 ("DOUBLE KILL"), 3 ("TRIPLE KILL"), 5 ("RAMPAGE").
- Tests: crit determinism and off-by-default, combo window/expiry/cap, banner thresholds.
- Model: **sonnet**.

**W3 — Loot rarity and elite hunts (sim).** Files: new `src/game/sim/loot.ts`, `elites.ts`; hooks in `types.ts` (`Powerup.rarity`,
`Ship.elite`), `create.ts`/`systems.ts` wave seeding and kill hook.
- Sunk ships drop a crate at the wreck with `rarity` common/rare/epic (weights by class and `luck`, seeded); rarity scales pickup
  magnitude (health +35/+60/+100, ammo refills + extra seekers, tier pickups unchanged). Drops persist `PICKUP_LIFE`.
- Elites: from wave 2, one escort per wave may be elite (seeded): ×1.6 HP, gold name prefix "ELITE", ×3 XP, guaranteed rare+ drop.
  Wave 1 never has an elite (keeps the opening and the campaign-balance wave-1 sweep unchanged).
- Tests: drop determinism and weights, rarity magnitudes, elite never on wave 1, elite XP/loot.
- Model: **sonnet**.

**W4 — Broadside ultimate (sim).** Files: new `src/game/sim/ultimate.ts`; `commands/types.ts` (`ultimate`), `types.ts`
(`ultimateCharge`), hook in damage dealt/kills.
- Charge 0–100 from damage dealt and kills; at 100 the command fires up to 4 Mk-14 at the nearest 4 live hunters (ignoring the bow
  arc and tube reload), no ammo cost, then charge resets. HUD key: `U`. Bots never issue it, so existing tests are unchanged.
- Tests: charge accrual, fires only when full, targets nearest hunters, no-target no-op keeps the charge, determinism.
- Model: **sonnet**.

### Wave C (after B)

**W5 — Captain's HUD and level-up card (UI).** Files: `src/ui/hud.ts` (+ new `src/ui/captain-panel.ts`, `src/ui/perk-overlay.ts`),
`src/styles/main.css`, `src/app.ts` (open/close overlay, pause clock while `pendingPerks` non-empty and phase is playing, `U` and
`1/2/3` keys while overlay open).
- Captain panel in the score block: level, XP bar, combo (×N with expiry bar), ultimate meter with "U — BROADSIDE" when ready,
  owned perks as small chips. Level-up card: three perk cards with plain-language descriptions; Esc defers (it stays pending).
- Tests: pure view-model functions (`xpBarFraction`, `perkCardText`, `comboLabel`) unit-tested; layout script updated to include the
  card (run on CI, not locally).
- Model: **sonnet**.

## Orchestration

1. Branch `plan-028-fun-pass` from `main`. Orchestrator (this session) commits after each wave.
2. Wave A: W1 (sonnet) and W6 (haiku) in parallel. Verify, commit.
3. Wave B: W2, W3, W4 (sonnet), one at a time (shared sim files). Verify, commit after each.
4. Wave C: W5 (sonnet). Verify, commit.
5. **Verification gate after every wave** (orchestrator, not the agent): read the diff; `npm run typecheck && npm run lint`;
   `npx vitest run --maxWorkers=2` full suite once per wave; confirm existing balance tests untouched or justified; confirm no
   `Math.random`, no browser calls.
6. Merge to `main`, fast-forward `master`, push. CI runs smoke + Patrol E2E + Pages. **Test = green CI + live `BUILD_SHA`.**
7. Update `plans/README.md` and `tasks/state.md`. Fun/feel stays an operator decision.

## Out of scope / deferred

- Underwater mirror-ceiling readability (needs GPU eye-pass; operator gate).
- Escort opening rush retune (Phase 6 human playtests); the "WARSHIP CLOSE" cue already shipped.
- Co-op, new assets, audio mix, world default flip.

## Operator gates (not self-approved)

Fun/feel of the new loop, perk balance, GPU FPS with bloom, lighting, audio, soak, `solo-production` tag.
