# Plan 020 — Island / foliage art pass

> Water-first (Plan 019) stays the ocean default. This plan restyles the
> existing patrol cays only. Do not copy the 1100 m demo island, OrbitControls
> shell, or demo weather GUI. World stays `legacy-v1`.

**Goal:** Tactical island shallows and cay silhouettes read as Caribbean
littoral (sand shelf, olive foliage, rock, palms) rather than a lime cone on a
pale foam disc.

## Status

- **Priority:** P1 (only if 019 water is close but islands still toy-like)
- **Depends on:** Plan 019 water + HDR
- **Out of scope:** demo island transplant, new world default, GPU/fleet ACCEPT,
  Plan 009

## Steps

1. Drop the neon grass vertex tint and default `foliageColor`.
2. Quiet the island ring foam so it is not a milky plate in shallows.
3. Darken palm/shrub instance colors; keep wind + LOD.
4. Recapture `artifacts/plan-019/tactical-shallows.png` (shared look-report).

## Done criteria

- [x] Island grass is olive, not lime; foam ring is a thin lip
- [x] Palms/shrubs remain instanced with wind
- [ ] Operator lighting/fleet ACCEPT still not self-approved
