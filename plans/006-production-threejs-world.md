# Plan 006: Raise the Three.js world to production visual quality

> **Executor instructions:** Preserve simulation interfaces and prove each visual feature at high/medium/low quality. Use the look-dev panel for iteration, then promote accepted values into versioned presets. Never make gameplay depend on rendered geometry.
>
> **Drift check:** compare render snapshot/entity interfaces to the Plan 003 completion commit; stop if Plans 004/005 changed them without an adapter.

## Status

- **Status:** DONE
- **Priority:** P1
- **Effort:** L (3–6 weeks, asset-dependent)
- **Risk:** MED
- **Depends on:** Plan 003; may run alongside Plans 004/005 after interfaces freeze
- **Category:** direction, performance, architecture
- **Planned at:** 2026-08-02 planning snapshot

## Why this matters

The current Caribbean demo proves palette, transparent water, bathymetry, and instrument modes, but it is still a procedural diorama with fixed placeholder ships. Production quality requires an asset/LOD pipeline, correct water-land interaction, underwater lighting, full POV coverage, and readable combat effects under a strict GPU budget.

## Current state

- `src/render/scene.ts:16-69` owns one submarine, one destroyer, two merchants, wakes, and a 200-segment ocean.
- `src/render/cameras.ts:25-102` implements tactical, periscope, and sonar-oriented top-down behavior; chase, bridge, free, map, and transitions are missing.
- `src/render/renderer.ts:3-34` caps DPR and enables ACES/shadows but has no composer or adaptive quality.
- PRD section 8 is the visual acceptance contract.

## Scope

**In scope:** asset manifest and glTF loading; all vessel/weapon/aircraft/FOB/pickup entity views; LOD/pooling/disposal; terrain/shore mask; improved transparent water, shore foam/spray, caustics/absorption; all POVs and transitions; day cycle; restrained post; wakes, damage, sinking, combat VFX; high/medium/low profiles; GPU/CPU counters; visual regression scenes.

**Out of scope:** gameplay formula changes, AI, HUD information architecture, multiplayer, unlicensed assets, mobile-first redesign, FFT/SPH rewrite.

## Steps and gates

1. **Visual specification and asset budget:** freeze scale, texel density, PBR channels, coordinate orientation, silhouette references, triangle/texture budgets, LOD distances, licensing ledger, and fallback meshes. Use `refero-design` for UI/world reference research if available; use image generation only for concepts/textures that have a clear production license path.
2. **Asset pipeline:** add typed manifest, GLTFLoader/KTX2/Meshopt where justified, preload progress, material normalization, instancing, LOD, pools, and deterministic disposal tests. Unique silhouettes are required for every class; U-boats visibly larger.
3. **Terrain and shore:** unify render height with sim seed, eliminate mesh seams, apply land/shore-distance masks, prevent water over dry land, add breakers/spray, and add biome/prop LOD.
4. **Ocean and underwater:** retain Caribbean transparency while adding depth-based absorption, reflection/refraction approximation, sun glint, foam, underwater fog/caustics, and camera-dependent cues. Floor/submarine remain readable in tactical view; surface vessels remain readable above it.
5. **Cameras:** implement tactical default, chase, bridge, periscope, free, and orthographic map with 0.4–0.8s blends. Keep aim raycasts in sim space. Add periscope droplets/stadimeter only after basic usability is green.
6. **VFX and day cycle:** pool torpedo trails, explosions, DC plumes, Hedgehog bursts, splashes, smoke/fire, sinking/listing, pickups, and camera shake. Implement 480s atmosphere cycle and restrained bloom/color grade.
7. **Quality profiles:** high/medium/low control DPR, water resolution, shadows, post, LOD, and particle caps with sticky hysteresis. Expose diagnostics only in a dev panel.
8. **Golden scenes:** automate fixed-seed screenshots for Caribbean noon tactical, periscope convoy, underwater chase, night ambush, shore combat, and heavy-ASW stress.

## Verification

- `npm run test:visual` captures all golden scenes at 1440×900 with no console errors.
- `npm run test:perf` reports reference-scene medians for each quality profile.
- `npm run verify` passes.
- Human visual gate confirms water/sub/floor/surface-vessel separation, natural land, realistic lighting, class silhouettes, and no water on land.

## Done criteria

- [ ] Every PRD entity has a production or explicitly accepted fallback visual.
- [ ] Every asset has source/license/optimization metadata.
- [ ] All six camera modes work and aiming is invariant across them.
- [ ] Water never covers dry land; shore breakers are present.
- [ ] High/medium/low profiles materially change GPU cost without visual-state thrash.
- [ ] Pools and disposal keep GPU object/texture counts bounded through five restarts/waves.
- [ ] Golden scenes pass human review and are reproducible.

## STOP conditions

- An asset has unclear commercial rights.
- A visual system requires simulation to query rendered meshes.
- Full refraction or a post effect breaks the reference performance budget.
- A generated asset is promoted without human approval and provenance.

## Maintenance notes

Asset production is the largest schedule uncertainty. Prefer a coherent small fleet over inconsistent high-detail packs. Review color-space, normal/tangent, shadow, transparency ordering, and disposal issues closely.

