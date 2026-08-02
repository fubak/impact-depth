# Plan 007: Complete HUD, controls, audio, tutorial, and accessibility

> **Executor instructions:** Build UI from game snapshots and commands only. Preserve the dark instrument language over the bright Caribbean world. Test keyboard, pointer, and reduced-motion paths.
>
> **Drift check:** compare command/snapshot/event contracts to the completion commits for Plans 004–006.

## Status

- **Priority:** P1
- **Effort:** L (2–4 weeks)
- **Risk:** MED
- **Depends on:** Plans 004, 005, 006
- **Category:** direction, accessibility, tests
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

The full simulation is unusable without a command surface that preserves player intent and explains acoustic risk. This milestone ports proven HUD/tutorial behavior while adapting it to the multi-POV Three.js game and the current visual language.

## References

- PRD sections 13 and 14 define panels, inputs, tutorial, and sound APIs.
- Current `src/input/controls.ts:30-103` and `src/ui/**` establish lightweight DOM conventions.
- Archived `GameHUD.tsx:16-733`, `TutorialOverlay.tsx:31-546`, `Minimap.tsx`, `GameOverlays.tsx`, and `audio.ts:13-340` are behavior references, not copy targets.

## Scope

**In scope:** all 11 HUD surfaces; minimap/full map; target selection and tactical commands; desktop keyboard/pointer plus touch-safe sizing; menu/pause/victory/gameover/settings/help; 11-step tutorial with DOM/3D anchors; procedural/spatial WebAudio; mute/unlock; accessibility semantics, focus, contrast, reduced motion; responsive desktop layouts down to 1024×700.

**Out of scope:** mobile performance guarantee, co-op roster/chat/auth, gameplay formula changes, final marketing site.

## Steps and gates

1. **Information architecture:** map every HUD value to a snapshot field and every control to a typed command. No component may derive authoritative cooldowns, ammo, detection, or intent independently.
2. **Command HUD:** implement status, score, hydrophone, magazine, tactics, depth, speed, minimap, chrome, messages, and responsive layout. Sticky highlights show orders, not transient capped values.
3. **World interaction:** tactical plot/select/fire, clear/cancel, zoom/pan/follow, POV controls, periscope target/stadimeter, map toggle, and large touch targets where applicable.
4. **Audio:** adapt the archived procedural bus behind game events, attach spatial emitters to the active camera listener where useful, throttle engine/audio spam, and handle browser unlock/mute cleanly.
5. **Tutorial:** port all 11 topics with resilient selectors/entity anchors, replay/skip/reset, camera-aware instructions, and storage key v2.
6. **Accessibility and responsive QA:** semantic buttons/labels, focus order, live-region discipline, color-independent states, reduced motion, mute, contrast, and 1024×700/1440×900 layouts.
7. **E2E journeys:** first launch/tutorial, manual ambush, sonar risk, docking/restock, gameover/restart, victory, keyboard-only, and reduced-motion.

## Verification

- `npm run test:ui` covers command mappings and formatters.
- `npm run test:e2e` passes the named journeys with zero accessibility-critical violations and no console errors.
- `npm run verify` passes.
- Human gate: a new player completes the first sink without developer help and can explain noise, depth, sonar, and FOB.

## Done criteria

- [ ] All PRD section 13 panels/actions exist and do not overlap at target resolutions.
- [ ] Sticky intent is correct under damage, silent running, battery caps, and autopilot.
- [ ] Tutorial has exactly 11 complete, camera-appropriate steps.
- [ ] Every required sound API is event-driven, muteable, and browser-unlock safe.
- [ ] Keyboard-only and reduced-motion journeys pass.
- [ ] UI never mutates game state outside commands.

## STOP conditions

- A UI requires direct mutation of state to remain responsive.
- Archived auth/React infrastructure becomes necessary for a solo UI feature.
- A tutorial anchor depends on brittle generated class names.
- Accessibility requires a product decision that materially changes controls; report it.

## Maintenance notes

Review message cadence, integer reload formatting, focus traps, and overlay stacking. Keep the look-dev panel developer-only in production builds unless explicitly enabled.

