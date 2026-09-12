# Fleet source staging contract

Production meshes ship from **`public/assets/models/v2/`** (manifest v5). Licensed or
project-owned **source** GLBs are staged locally under **`artifacts/fleet-sources/`**
(gitignored). The tracked import contract lives in
**[`config/fleet-source-manifest.json`](../../config/fleet-source-manifest.json)**.

## Workflow

1. Place source files under `artifacts/fleet-sources/` using the relative `input` paths
   declared in the manifest (see table below).
2. Validate staging **without writing outputs**:
   ```bash
   npm run assets:import-modern -- --validate
   ```
3. Dry-run (validate + log planned outputs, still no GLB mutation):
   ```bash
   npm run assets:import-modern -- --dry-run
   ```
4. Import when sources are present:
   ```bash
   npm run assets:import-modern
   npm run assets:validate
   ```

The importer **never downloads**, reads cookies, substitutes production meshes as provenance,
or overwrites `models/v2` during validate/dry-run.

## Expected staging layout

| Entity | Manifest `input` | Notes |
| --- | --- | --- |
| `sub_nautilus` | `sketchfab/sub_nautilus.glb` | CC-BY Sketchfab export |
| `uboat` | `sketchfab/uboat.glb` | CC-BY Sketchfab export |
| `destroyer` | `sketchfab/destroyer.glb` | CC-BY Sketchfab export |
| `patrol` | `kenney-watercraft/boat-speed-e.glb` | Kenney Watercraft Kit |
| `cruiser` | `kenney-watercraft/ship-large.glb` | Kenney Watercraft Kit |
| `battleship` | `kenney-watercraft/ship-ocean-liner.glb` | Kenney Watercraft Kit |
| `freighter` | `kenney-watercraft/ship-cargo-a.glb` | Kenney Watercraft Kit |
| `fob_argus` | `kenney-watercraft/boat-house-d.glb` | Kenney Watercraft Kit |
| `crate` | `kenney-watercraft/crate.glb` | Kenney Watercraft Kit |
| `aircraft` | `staging/aircraft_src.glb` | OGA plane → Blender GLB export |
| `torpedo` | `procedural/torpedo.glb` | `npm run assets:export` → copy `models/v1/torpedo.glb` here |

Import reports (`import-report-v2.json`, `credits-v2.json`) are written under
`artifacts/fleet-sources/` after a successful mutating import.

## Missing sources

On a clean checkout, `--validate` exits non-zero with one actionable error per missing entity,
for example:

```
torpedo: missing staged source at artifacts/fleet-sources/procedural/torpedo.glb (manifest input: procedural/torpedo.glb)
```

Fix by staging the file at the path shown. Do **not** point the manifest at existing
`models/v2` outputs — those are immutable production artifacts, not import provenance.
