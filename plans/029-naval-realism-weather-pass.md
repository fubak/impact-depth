# Plan 029 — Naval realism: ship AI doctrine, sea state, weather and day/night

> **Status: MACHINE WORK LANDED (2026-10-11).** E1-E4 implemented and unit-tested (1172 tests); A1-A15 met in code/tests; browser layout and smoke verified on CI only. Visual realism, key `Y` for the weather panel (E is dive trim) and all operator gates PENDING. Branch `plan-029-realism`. Machine verification only. "Looks hyper-realistic" is a visual judgement that needs a
> GPU and a human eye: it is an **operator gate** and is not self-approved (AGENTS.md). What this plan *can* prove is physical
> correctness of the models, doctrine conformance of the AI, and that nothing regresses. Loop criteria are the measurable ones below.

## Research (what real escorts and seas do)

Sources: [Creeping attack](https://en.wikipedia.org/wiki/Creeping_attack), [Hedgehog (weapon)](https://en.wikipedia.org/wiki/Hedgehog_(weapon)),
[Barrage attack](https://en.wikipedia.org/wiki/Barrage_attack_(naval_tactic)), [Ocean-wave spectra](https://wikiwaves.org/Ocean-Wave_Spectra),
Moskowitz 1964 (fully developed seas), deep-sea ambient-noise/wind studies (noise rises with wind speed; detection range falls).

### Surface escort behaviour on a submarine contact (WWII → Cold War)

1. **Screen, then prosecute.** Escorts sweep ahead and on the flanks of the convoy (a screen). On a sonar contact, one or two ships leave
   the screen to prosecute; the rest hold station so the convoy is never stripped of cover.
2. **Active sonar (ASDIC) dead zone.** The beam searches forward; as the attacker closes, contact is lost inside a minimum range and
   over the target. The boat can turn or change depth during that blind interval. Hence the datum prediction the sim already has.
3. **Speed vs sonar.** Sonar degrades at high own speed (flow noise). Searching/holding escorts slow down; flank speed is for the run in.
4. **Creeping attack (Capt. F. J. Walker).** Two ships: a *holder* stays outside the dead zone, keeps contact (pinging, slow) and
   conns the second ship, the *creeper*, which approaches slowly and quietly with **no active sonar**, then drops/fires when the holder
   signals it is over the target. Used throughout the war because the boat cannot hear the creeper.
5. **Weapons.** Depth charges roll from the stern in patterns at set depths (loses contact on the run). Hedgehog fires ahead onto a
   ~30 yd circle while contact is still held; contact-fuzed so near misses do nothing.
6. **After the attack:** reduce speed, **listen** to re-establish contact, then re-attack; if contact is not regained, expanding-square
   search around the last datum, then return to the screen.
7. **Convoy and merchants.** Merchants keep formation and **zigzag** on a pattern; on a torpedo hit or sighting they make an
   **emergency turn** (typically 45°) away from the attack bearing and scatter. Escorts under torpedo threat **comb/turn to present the
   smallest profile** (bow or stern to the track) and run to the bearing.
8. **Environment.** Rough seas raise ambient noise (detection range falls for both sides), slow ships and reduce pattern accuracy;
   night, fog and rain cut visual detection of scopes, snorkels and wakes.

### Sea and light model (physical anchors)

- Fully developed sea (Pierson–Moskowitz): significant wave height `Hs ≈ 0.0214·U²` m with `U` the 10 m wind in m/s (equivalently
  `0.21·U²/g`); peak period `Tp ≈ 0.73·U₁₉.₅` s with `U₁₉.₅ ≈ 1.026·U₁₀`.
- Whitecap coverage (Monahan): `W ≈ 3.84e-6 · U^3.41`.
- Beaufort wind bands (m/s): 0:<0.5, 1:0.5–1.5, 2:1.6–3.3, 3:3.4–5.4, 4:5.5–7.9, 5:8–10.7, 6:10.8–13.8, 7:13.9–17.1, 8:17.2–20.7, 9:20.8–24.4.
- Fetch/duration cap: coastal seas do not reach fully developed heights; cap `Hs` by a fetch factor (default 0.6) so a 128-unit sector
  never shows ocean-scale waves.

## Measurable acceptance criteria (the loop target)

| # | Criterion | Proof |
| --- | --- | --- |
| A1 | `Hs`, `Tp`, whitecap coverage from wind match the formulas above within 1% | unit tests, table of U = 3/6/10/15/20 m/s |
| A2 | Beaufort ↔ wind ↔ `seaState` (0–1) mapping is monotone, covers 0–9, round-trips | unit tests |
| A3 | Default environment (clear, day) is the identity: every factor exactly 1, **all existing tests pass unchanged** | full suite |
| A4 | Rough sea lowers detection range of both escort sonar and the player's hydrophone, monotonically with sea state | unit + sim tests |
| A5 | Night/fog/rain lower visual detection of scope/snorkel/wake; clear day unchanged | unit + sim tests |
| A6 | Creeping attack: with ≥2 prosecuting escorts one becomes `holder` (outside dead zone, slow, pinging) and one `creeper` (slow, silent, no ping) that drops only on the holder's signal | sim tests |
| A7 | Searching escorts hold ≤0.6 speed fraction; attack run ramps to ≥0.8 | sim tests |
| A8 | Merchants zigzag when alerted and make a 45° emergency turn away from a torpedo/hit, scattering | sim tests |
| A9 | Escorts under torpedo threat turn bow/stern-on to the bearing and run | sim tests |
| A10 | Post-attack listening interval, then re-attack, then expanding-square, then return to screen | sim tests |
| A11 | Storm slows ships (speed factor) and widens pattern scatter; calm = identity | sim tests |
| A12 | Player can choose weather (Clear/Partly cloudy/Overcast/Rain/Storm/Fog) and time (Dawn/Day/Dusk/Night) from the menu and in game; `?weather=` / `?time=` URL params | view-model unit tests + CI smoke |
| A13 | Wave rendering parameters derive from wind via the physical model (no hand-tuned magic per preset) | unit tests on the mapping |
| A14 | Rain, fog, cloud cover and lightning are driven by the weather kind | mapping unit tests + CI smoke (no console errors) |
| A15 | Deterministic: same seed + environment ⇒ identical sim; no `Math.random` in sim | existing replay + no-math-random tests |

**Visual realism ("hyper-realistic") is NOT in this table**: it needs a GPU eye-pass (operator).

## Hard constraints (every task)

- Sim deterministic, immutable updates, no `Math.random`, no DOM/Three.js in `src/game/sim/**`.
- Default behaviour unchanged: clear day ⇒ factor 1.0 everywhere; pinned balance tests (`campaign-balance`, `exfil-*`, `doctrines`,
  `escort-doctrine`, `pacing`, `replay.10000`) stay green. Intentional changes update a test with a one-line rationale.
- **No browser/Playwright/preview/WebGL runs locally** (operator's CPU overheats). Verify with `npx vitest run <files> --maxWorkers=1`,
  `npm run typecheck`, `npm run lint`. Browser checks run on CI.
- Shader/GLSL edits: parameter-driven only (uniform scalings, new uniforms with identity defaults); CI smoke fails on shader compile errors.
- New logic in new modules (<400 lines), tests first. Agents do not commit; the orchestrator does.

## Workstreams

**E1 — Environment model and sim effects (first).** New `src/game/sim/environment.ts` (+ `src/core/sea-model.ts` pure physics shared with render):
`WeatherKind`, `TimeOfDayId`, `Environment {weather, timeOfDay, windMs, seaState}`, defaults (clear, day, light breeze), `windFor(weather)`,
`beaufort(U)`, `significantWaveHeight`, `peakPeriod`, `whitecapCoverage`, `seaStateFromWind`, and factor functions
`sonarRangeFactor(env)`, `visualRangeFactor(env)`, `shipSpeedFactor(env)`, `patternScatter(env)`. GameState gets `environment`; command
`setEnvironment`. Hook the factors into escort/player sonar detection, visual (scope/snorkel/wake) detection and ship speed.
Tests: A1–A5, A11, A15. Model: sonnet.

**E2 — Escort and convoy doctrine (after E1, parallel with E3/E4).** Files: `src/game/sim/escort-doctrine.ts`, new `convoy-behavior.ts`,
`creeping-attack.ts`, hooks in `systems.ts` ship movement. Tests: A6–A10 (+A4/A5/A11 integration). Model: sonnet.

**E3 — Sea, weather and light rendering (after E1, parallel).** Files: `src/render/environment/weather.ts` (extend), new
`src/render/environment/weather-model.ts` (pure mapping: weather+time → ocean/atmosphere/rain/fog/cloud/lightning params), new
`src/render/fx/rain.ts` (instanced rain streaks + surface ripple rings, quality-gated), wiring in `scene.ts`/`app.ts`. Tests: A13, A14. Model: sonnet.

**E4 — Player controls (after E1, parallel with E3, disjoint files).** New `src/ui/environment-panel.ts` (+ menu card selects), key `E`
quick panel, URL params in `src/core/runtime-selection.ts`, `src/ui/overlays.ts`/`hud.ts` hooks. Tests: A12 view-model. Model: sonnet.

## Orchestration and loop

1. Branch `plan-029-realism`; commit this plan.
2. E1 → verify → commit. Then E2 ‖ (E3 then E4, same render/UI area, sequential) → verify → commit each.
3. Gate after each: read diff; typecheck; lint; full vitest `--maxWorkers=2`; build. Merge to `main`, ff `master`, push; CI (smoke, Patrol E2E, layout)
   + Pages + live `BUILD_SHA`.
4. **Audit loop:** a read-only reviewer compares the sim against the doctrine list above and the criteria table; each unmet row becomes a
   follow-up task; repeat at most two more passes. Stop when A1–A15 are met; report honestly that A-visual is operator-owned.

## Out of scope

Real GPU realism acceptance, audio, new hull assets, aircraft/ASW-helicopter overhaul, multiplayer. All operator gates stay PENDING.
