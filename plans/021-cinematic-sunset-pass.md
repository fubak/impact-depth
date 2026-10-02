# Plan 021 — Cinematic sunset pass

> **Status: IN PROGRESS — operator eye-pass pending.** Implementation is complete and machine-verified by the executing agent. GPU FPS, lighting eye-pass and wake/spray eye-pass are **operator gates** and are not self-approved (AGENTS.md). **Do not commit unless the operator asks.**

**Goal:** Take the graphics / water / lighting / physics / particles requirements of a "cinematic pirate ship at sunset" prompt and apply them to Silent Depths: a new **Sunset Passage** preset, plus engine upgrades that benefit every preset. Caribbean Noon remains the default look.

**Architecture:** One consistent linear-HDR colour pipeline (scene → half-float MSAA target → bloom → grade → ACES + sRGB output). Continuous sun-elevation atmosphere instead of three snapped palettes. Ocean shader rewritten around Fresnel / Beer-Lambert / subsurface / sun-glint with a persistent world-locked wake-foam field. Presentation-only hull dynamics and camera coupling; sim authority is untouched.

## Source brief

Operator asked to analyze the engine, then take the graphics/water/lighting/physics/particles requirements from a "cinematic pirate ship at sunset" prompt and apply them to Silent Depths.

- **Skipped by explicit instruction:** ship-specific modelling (sails, rigging, cannons, lanterns).
- Sunset ships as a **new preset**; all presets get the engine upgrades.
- **Caribbean Noon remains the default.** World stays `legacy-v1`; ocean default stays spectral with `?ocean=gerstner` rollback.

## Engine analysis (pre-021 findings)

- **Renderer:** WebGLRenderer r185, ACES tonemapping, PCFShadowMap, no post-processing. Sky dome, cloud dome and ocean were raw `ShaderMaterial`s writing display-referred colour (bypassing tone mapping / colour space) while lit PBR materials went through ACES + sRGB — two inconsistent colour pipelines. Planar optics captures were linear half-float, mixed into display-referred water.
- **Atmosphere:** `evaluateAtmosphere` snapped between 3 discrete palettes (day / dawn-dusk / night). Presets drifted on a hard-coded 480 s day cycle (sunset would reach night in ~40 s). Sun disc was a flat `MeshBasic` circle. HDR IBL (noon Kloofendal) was used for all daytime, mislighting golden hour.
- **Ocean:** spectral FFT (3 cascades) + Gerstner fallback, planar reflection/refraction, caustics, coastal field. Shading used ad-hoc `pow(1-ndv,3.6)` fresnel, a single Phong 160 sun lobe, no subsurface scattering, spectral foam mixed at 5% (effectively off). Milky-look root causes: (a) hull "lid punch" opened alpha over any refraction hit within 16 m — including the seabed — so the fogged main-pass seabed washed the sea; (b) refraction capture carried sky-coloured scene fog with only scalar absorption; (c) heavy scene fog on water.
- **Wake:** flat 2-triangle vertex-coloured V ribbon at 0.22 opacity + CheapWater screen-space ripple quads.
- **Particles:** `SurfaceEffects` InstancedMesh flat-colour planes/rings/spheres (not camera-facing); the splash layer rotated the whole InstancedMesh by -90° X so splash rings rendered at y = z (bug). `VfxPool` allocated a new SphereGeometry + material per emit (torpedo wakes emit every frame).
- **Physics / attitude:** kinematic. Pitch/roll from a 5-point wave footprint (GPU probe or CPU Gerstner), first-order exponential damping; no mass, natural period, overshoot, speed trim, squat or turn heel.
- **Lighting / materials:** hulls carried constant emissive hacks (player emissive = 0.4 x albedo at >= 0.4 intensity, contacts teal 0.28) that flattened form.
- **Cameras:** rigid exponential follow; no motion coupling to hull; player locator ring filled chase/bridge frames.

## Scope

In: atmosphere, sky/cloud shaders, IBL gating, ocean shading, wake foam, surface particles, VFX pooling, hull dynamics, camera motion, post-processing, preset + URL param.
Out: ship modelling (sails/rigging/cannons/lanterns), gameplay/sim changes, `?world=` default, CSP changes, Plans 012 / 014 / 015 / 017 / 009.

## What was implemented (files)

**Atmosphere**
- `src/render/atmosphere.ts` — continuous sun-elevation colour ramps (keys authored in sRGB, converted to linear); new `AtmosphereState` fields `sunElevation` / `golden` / `twilight`; shared `SKY_RADIANCE_GLSL` (gradient, golden-hour ember band + antisolar rose belt, two-lobe Henyey-Greenstein Mie glow); sky shader draws an HDR limb-darkened sun disc with horizon extinction + dither; clouds with self-shadow toward the sun, slate bellies, silver lining, sunset cirrus; warm key / cool fill split, new low rim light, golden-hour fog thickening; sky/cloud shaders now use tonemapping + colorspace includes.
- `src/render/environment/sky-source.ts`, `sky-lighting.ts`, `outdoor-lighting.ts` — HDR IBL only above 24° sun elevation (`HDR_MIN_SUN_ELEVATION_DEG`); procedural PMREM uses the same sky radiance and golden/twilight.

**Presets / settings**
- `src/core/types.ts`, `settings.ts`, `ui/panel.ts`, `app.ts` — `AtmosphereSettings.dayLengthSeconds` (0 = hold); `presentationDayPhase()`; new `sunset-passage` preset (tod 0.74, sun ~7°, az 128, held time, sapphire water, warmer haze); panel button; `?look=<presetId>` URL param.

**Ocean**
- `src/render/ocean.ts` — linear HDR water shader with tonemapping includes; Schlick fresnel on smoothed normal; Beer-Lambert body lit by sky + sun; crest subsurface scattering (backlit waves glow, warmer at golden hour); sky-radiance reflection fallback; spectral RGB transmittance on refraction path length; GGX sun glints + broad "sun road" lobe (HDR, capped at 5 for bloom); whitecaps from spectral crest foam; persistent wake foam + aerated water + wake normal bumps; foam lit by sun/sky; near-opaque sheet when a refraction capture exists; hull punch only where the refraction hit is > 0.8 m above the seabed; aerial-perspective haze with sunward glow; ocean tile edge melts into horizon. `uDebug` uniform for look-dev: 1 body, 2 reflection, 3 refraction, 4 spec, 5 foam, 6 fog/rim/alpha, 7 wake, 8 fresnel/foam/under, 9 pre-fog.
- `src/render/ocean/wake-foam.ts` (new) — `WakeFoamField`: ping-pong half-float world-locked field (300 m; 768 / 512 / 320 px by quality), texel-snapped origin with advection, decay (foam tau 9 s, aeration 5.5 s) + diffusion + lace erosion. Instanced stamps per surface hull: bow cushion, torn hull-shoulder lip, Kelvin arms at 19.47° with cusp lines, churned stern trail; circular splash stamps for torpedo hits / sinkings / depth charges. Replaces the V ribbon (kept hidden for API stability).

**Particles / VFX**
- `src/render/ocean/surface-effects.ts` — soft camera-facing lit sprites (spray tears with noise; forward-scattered backlit glow), flat foam rings on the sea, bubble rims, motes; per-instance life/seed via `instanceColor`; fixed the splash y = z bug; bow spray emission for hulls above ~2.4 m/s scaled by sea state; `setLighting()`.
- `src/render/vfx.ts` — pooled meshes / geometries / materials; explosions pushed to HDR for bloom.

**Physics / presentation**
- `src/render/presentation/hull-dynamics.ts` (new) — per-hull damped springs on heave / pitch / roll with class-sized natural periods (roll longest, zeta ~0.14), plus running attitude: squat proportional to v², bow-up trim, accel pitch, outward turn heel (yaw rate x speed). Wired in `GameScene.consumeVesselAttitudes`; presentation-only.
- `src/render/cameras.ts` — chase rides swell, leads into turns, banks with hull, speed FOV breathing; bridge pitches/rolls with the hull; tactical slow drone drift; all disabled under reduced motion / pause; surface motion fades with depth.

**Post / wiring**
- `src/render/post.ts` (new) + `renderer.ts` — `EffectComposer`: half-float MSAA HDR target -> UnrealBloom (quality-scaled, off on low) -> grade pass (log contrast, saturation, golden-hour split tone, lens falloff, underwater desaturation) -> `OutputPass` (ACES + sRGB). `EXPOSURE_CALIBRATION` 0.9; `renderer.info` counts all passes.
- `src/render/scene.ts` — wiring for all of the above; emissive readability glow now only ramps in below 3 m (player) / when the player is deep (contacts); player locator ring hidden in chase / bridge / periscope.

## Global constraints honoured

- One canvas, one rAF. CPU sim remains gameplay authority (`src/game/sim/**`); all new dynamics are presentation-only.
- No new CDN / runtime network fetches; CSP unchanged.
- `?world=` default unchanged (`legacy-v1`); `?ocean=gerstner` still a working rollback.
- Caribbean Noon stays the default preset; no preset is removed.
- No commits made.

## Verification (executing agent)

Machine checks run by the executing agent:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Browser captures: Playwright under **SwiftShader** (headless Chromium) of tactical / chase / bridge / periscope for `sunset-passage` and `caribbean-noon`, with console-error inspection (`?look=sunset-passage`, `?look=caribbean-noon`).

> **SwiftShader runs ~0.3–1 FPS.** Captures used a fixed-step virtual clock so wake/spray/dynamics advance deterministically. This is **NOT FPS evidence** and must not be cited toward the >= 55 FPS gate.

## Operator gates (do not self-approve)

Agents must not mark any of these accepted. Operator performs them on a real GPU:

- [ ] **GPU FPS >= 55** at 1440 x 900 with post-processing on (RTX-class desktop), on both presets.
- [ ] **Lighting eye-pass on all four presets** (Sunset Passage, Caribbean Noon, plus the remaining two existing presets), across tactical / chase / bridge / periscope.
- [ ] **Wake / spray eye-pass at flank speed** (bow cushion, Kelvin arms, stern trail, bow spray, no flat-plane artefacts).
- [ ] **Confirm noon still acceptable vs Plan 019** (water not milky, sky/HDR look intact, no regression from the new grade).
- [ ] **Confirm bloom strength** (sun road, explosions, foam not blown out).

**Rollback knobs:** `?ocean=gerstner` (drops spectral + planar optics path), `quality=low` (disables bloom, smaller wake field), preset switch back to Caribbean Noon, `uDebug` modes for diagnosing a single term.

## Known follow-ups

- Wake field is surface-only: subs deeper than 2.5 m leave none, by design.
- `hull-dynamics` outward-heel sign should be eye-checked in a hard turn.
- `RGBELoader` deprecation warning (switch to `HDRLoader`) is pre-existing and unrelated.

## STOP conditions

- Operator reports FPS < 55 on the reference scene: tune `post.ts` bloom / wake-field resolution before any further look work; do not approve.
- Noon regresses vs Plan 019: roll back grade / exposure defaults for non-golden presets first (`EXPOSURE_CALIBRATION`, grade pass strength).
- Milky water returns: use `uDebug` 3 / 6 to inspect the refraction path and hull-punch threshold before touching fog.
